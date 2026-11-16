"""Read a data file from the local ``data/`` folder or the Firebase Storage bucket.

On a laptop the big NASA maps are on disk (download them with the commands in
``docs/firebase-data.md``). On Cloud Run the image only carries the Phase 1
kernels and ``sites.csv``; the maps stay in the bucket, and a request reads
just the tiles it needs over HTTPS. Code asks for a file by its name under
``data/`` and doesn't care which::

    from lunarsky.data import open_raster

    with open_raster("phase-2/LDEM_80S_80MPP_ADJ.TIF") as src:
        heights_m = src.read(1, window=...)

Settings (environment variables):

``LUNAR_DATA_SOURCE``
    ``auto`` (default): the file on disk if it's there, otherwise the bucket.
    ``local``: disk only. ``bucket``: always the bucket, to try the Cloud Run
    path from a laptop.
``LUNAR_DATA_BUCKET``
    Bucket name, default ``nasa-challenge-a8b4a.firebasestorage.app``.
``LUNAR_DATA_DIR``
    The local data folder (see ``kernels.py``), default the repo's ``data/``.
``LUNAR_DATA_BASE_URL``
    Read files that aren't on disk from ``<base>/<name>`` over HTTPS instead of
    the Google bucket (the Cloudflare Container reads the 20 m map this way,
    through the API Worker's R2 route). ``LUNAR_DATA_HEADERS`` adds request
    headers, one ``Name: value`` per line (e.g. the shared key).

Bucket reads need a Google login with read access to the bucket. On Cloud Run
that's the service's own account. On a laptop it's Application Default
Credentials (``gcloud auth application-default login``) if set up, otherwise
the plain ``gcloud auth login`` account. ``rasterio`` and ``google-auth`` come
with the ``maps`` extra: ``pip install -e ".[maps]"``.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from .kernels import DEFAULT_DATA_DIR

DEFAULT_BUCKET = "nasa-challenge-a8b4a.firebasestorage.app"
SOURCES = ("auto", "local", "bucket")
READ_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only"

# GDAL settings for reading a GeoTIFF over HTTPS a few tiles at a time.
_GDAL_HTTP_OPTIONS = {
    # Don't list the "folder" looking for sidecar files; there aren't any.
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    # Retry a dropped connection or a 429/503 a few times.
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "1",
    # Merge neighboring tile reads into one request.
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
}


@dataclass(frozen=True)
class DataLocation:
    """Where one data file will be read from."""

    name: str        # path under data/, e.g. "phase-2/LDEM_80S_80MPP_ADJ.TIF"
    path: str        # local file path, or the object's https:// URL in the bucket
    in_bucket: bool


def _check_name(name: str) -> str:
    """Reject absolute paths and ``..`` so a name can only point inside data/."""
    p = PurePosixPath(name)
    if not name or p.is_absolute() or ".." in p.parts or "\\" in name:
        raise ValueError(f"data file name must be a relative path under data/, got {name!r}")
    return str(p)


def bucket_name() -> str:
    return os.environ.get("LUNAR_DATA_BUCKET", DEFAULT_BUCKET)


def locate(name: str, source: str | None = None, data_dir: str | os.PathLike | None = None) -> DataLocation:
    """Decide whether ``data/<name>`` comes from disk or from the bucket.

    ``source`` overrides ``LUNAR_DATA_SOURCE``; ``data_dir`` overrides the
    local data folder.
    """
    name = _check_name(name)
    source = source or os.environ.get("LUNAR_DATA_SOURCE", "auto")
    if source not in SOURCES:
        raise ValueError(f"LUNAR_DATA_SOURCE must be one of {SOURCES}, not {source!r}")

    local = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR
    local = local / name
    if source == "local" or (source == "auto" and local.is_file()):
        if not local.is_file():
            raise FileNotFoundError(
                f"{local} is not on disk. Download it with\n"
                f'  gcloud storage cp "gs://{bucket_name()}/data/{name}" {local}\n'
                f"or set LUNAR_DATA_SOURCE=auto (or bucket) to read it from the bucket."
            )
        return DataLocation(name, str(local), in_bucket=False)

    base = os.environ.get("LUNAR_DATA_BASE_URL")
    if base:
        return DataLocation(name, f"{base.rstrip('/')}/{quote(name, safe='/')}", in_bucket=True)
    url = f"https://storage.googleapis.com/{bucket_name()}/data/{quote(name, safe='/')}"
    return DataLocation(name, url, in_bucket=True)


# ── Google access token for the bucket ──
_token_lock = threading.Lock()
_credentials = None            # google-auth credentials, once found
_cli_token: tuple[str, float] | None = None   # (token, expiry as time.time())


def _token_from_gcloud_cli() -> str:
    """Access token for the account in ``gcloud auth login``. Cached ~45 min."""
    global _cli_token
    if _cli_token and time.time() < _cli_token[1]:
        return _cli_token[0]
    gcloud = shutil.which("gcloud")
    if not gcloud:
        raise RuntimeError(
            "No Google credentials for reading the data bucket. Run\n"
            "  gcloud auth application-default login\n"
            "or set LUNAR_DATA_SOURCE=local and download the files (docs/firebase-data.md)."
        )
    out = subprocess.run(
        [gcloud, "auth", "print-access-token"],
        capture_output=True, text=True, timeout=60,
    )
    if out.returncode != 0 or not out.stdout.strip():
        raise RuntimeError(f"`gcloud auth print-access-token` failed: {out.stderr.strip()}")
    _cli_token = (out.stdout.strip(), time.time() + 45 * 60)  # tokens last 60 min
    return _cli_token[0]


def _on_cloud_run() -> bool:
    # Cloud Run sets K_SERVICE for services and CLOUD_RUN_JOB for jobs.
    return bool(os.environ.get("K_SERVICE") or os.environ.get("CLOUD_RUN_JOB"))


def _adc_file() -> Path:
    """Where `gcloud auth application-default login` saves its credentials."""
    if os.environ.get("CLOUDSDK_CONFIG"):
        base = Path(os.environ["CLOUDSDK_CONFIG"])
    elif os.name == "nt":
        base = Path(os.environ.get("APPDATA", "")) / "gcloud"
    else:
        base = Path.home() / ".config" / "gcloud"
    return base / "application_default_credentials.json"


def _google_auth_token() -> str:
    """Token from Application Default Credentials (google-auth), cached and refreshed."""
    global _credentials
    import google.auth
    import google.auth.transport.requests

    if _credentials is None:
        _credentials, _ = google.auth.default(scopes=[READ_SCOPE])
    if not _credentials.valid:
        _credentials.refresh(google.auth.transport.requests.Request())
    return _credentials.token


def access_token() -> str:
    """An OAuth access token that can read the bucket.

    On Cloud Run, or with Application Default Credentials set up, google-auth
    supplies it (on Cloud Run that's the service's own account). Otherwise the
    gcloud CLI's login does. Without a credentials file, google-auth first
    probes for a Google Cloud metadata server, which takes ~10 s to give up on
    a laptop, so that path is only a last resort.
    """
    with _token_lock:
        if _on_cloud_run() or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or _adc_file().is_file():
            return _google_auth_token()
        if shutil.which("gcloud"):
            return _token_from_gcloud_cli()
        try:
            return _google_auth_token()   # e.g. a Compute Engine VM without gcloud
        except ImportError:
            return _token_from_gcloud_cli()   # raises the "no credentials" help text


def gdal_bucket_options() -> dict[str, str]:
    """GDAL config options for reading bucket objects through ``/vsicurl/``."""
    if os.environ.get("LUNAR_DATA_BASE_URL"):
        headers = os.environ.get("LUNAR_DATA_HEADERS", "").replace("\n", ",")
        return {**_GDAL_HTTP_OPTIONS, **({"GDAL_HTTP_HEADERS": headers} if headers else {})}
    return {**_GDAL_HTTP_OPTIONS, "GDAL_HTTP_HEADERS": f"Authorization: Bearer {access_token()}"}


@contextmanager
def open_raster(name: str, source: str | None = None, data_dir: str | os.PathLike | None = None):
    """Open ``data/<name>`` with rasterio, from disk or the bucket.

    A context manager: read inside the ``with`` block, because bucket reads
    fetch tiles lazily and need the login headers in place while they do.
    """
    import rasterio

    loc = locate(name, source, data_dir)
    if not loc.in_bucket:
        with rasterio.open(loc.path) as src:
            yield src
        return
    # rasterio.Env sets GDAL options for this thread only, so concurrent
    # requests in FastAPI's thread pool don't trip over each other.
    with rasterio.Env(**gdal_bucket_options()):
        with rasterio.open(f"/vsicurl/{loc.path}") as src:
            yield src
