"""Tests for lunarsky.data: deciding disk vs bucket, and the bucket login.

Offline: nothing here touches the network. The real bucket read is checked
by scripts/check_bucket_read.py.
"""

import numpy as np
import pytest

from lunarsky import data
from lunarsky.data import DEFAULT_BUCKET, locate, open_raster

NAME = "phase-2/LDEM_80S_80MPP_ADJ.TIF"
URL = f"https://storage.googleapis.com/{DEFAULT_BUCKET}/data/{NAME}"


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for var in ("LUNAR_DATA_SOURCE", "LUNAR_DATA_BUCKET", "K_SERVICE", "CLOUD_RUN_JOB",
                "GOOGLE_APPLICATION_CREDENTIALS"):
        monkeypatch.delenv(var, raising=False)


@pytest.fixture
def data_dir(tmp_path):
    (tmp_path / "phase-2").mkdir()
    (tmp_path / NAME).write_bytes(b"stand-in")
    return tmp_path


# --- locate ---------------------------------------------------------------

def test_auto_prefers_the_file_on_disk(data_dir):
    loc = locate(NAME, data_dir=data_dir)
    assert not loc.in_bucket
    assert loc.path == str(data_dir / NAME)


def test_auto_falls_back_to_the_bucket(tmp_path):
    loc = locate(NAME, data_dir=tmp_path)
    assert loc.in_bucket
    assert loc.path == URL


def test_bucket_source_ignores_the_disk(data_dir, monkeypatch):
    monkeypatch.setenv("LUNAR_DATA_SOURCE", "bucket")
    assert locate(NAME, data_dir=data_dir).in_bucket


def test_local_source_needs_the_file(tmp_path):
    with pytest.raises(FileNotFoundError, match="gcloud storage cp"):
        locate(NAME, source="local", data_dir=tmp_path)


def test_bucket_name_setting(tmp_path, monkeypatch):
    monkeypatch.setenv("LUNAR_DATA_BUCKET", "other-bucket")
    assert locate(NAME, data_dir=tmp_path).path.startswith("https://storage.googleapis.com/other-bucket/data/")


def test_rejects_unknown_source(tmp_path):
    with pytest.raises(ValueError, match="LUNAR_DATA_SOURCE"):
        locate(NAME, source="s3", data_dir=tmp_path)


@pytest.mark.parametrize("bad", ["", "/etc/passwd", "../secrets.txt", "phase-2/../../x", "phase-2\\x.tif"])
def test_names_stay_inside_data(bad, tmp_path):
    with pytest.raises(ValueError):
        locate(bad, data_dir=tmp_path)


def test_url_escapes_odd_characters(tmp_path):
    assert locate("phase-9/a b#c.tif", data_dir=tmp_path).path.endswith("/data/phase-9/a%20b%23c.tif")


# --- which login is used --------------------------------------------------

@pytest.fixture
def logins(monkeypatch, tmp_path):
    """Record which token source access_token() picks; no real logins."""
    used = []
    monkeypatch.setattr(data, "_google_auth_token", lambda: used.append("google-auth") or "t1")
    monkeypatch.setattr(data, "_token_from_gcloud_cli", lambda: used.append("gcloud") or "t2")
    monkeypatch.setattr(data, "_adc_file", lambda: tmp_path / "no-such-file.json")
    monkeypatch.setattr(data.shutil, "which", lambda cmd: "/usr/bin/gcloud")
    return used


def test_laptop_without_adc_uses_gcloud_not_the_slow_probe(logins):
    data.access_token()
    assert logins == ["gcloud"]


def test_cloud_run_uses_its_service_account(logins, monkeypatch):
    monkeypatch.setenv("K_SERVICE", "lunar-navigator-api")
    data.access_token()
    assert logins == ["google-auth"]


def test_adc_file_uses_google_auth(logins, monkeypatch, tmp_path):
    adc = tmp_path / "adc.json"
    adc.write_text("{}")
    monkeypatch.setattr(data, "_adc_file", lambda: adc)
    data.access_token()
    assert logins == ["google-auth"]


def test_bucket_options_carry_the_token(logins):
    opts = data.gdal_bucket_options()
    assert opts["GDAL_HTTP_HEADERS"] == "Authorization: Bearer t2"
    assert opts["GDAL_DISABLE_READDIR_ON_OPEN"] == "EMPTY_DIR"


# --- open_raster from disk ------------------------------------------------

def test_open_raster_reads_a_local_geotiff(tmp_path):
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    (tmp_path / "phase-x").mkdir()
    pixels = np.arange(16, dtype="float32").reshape(4, 4)
    with rasterio.open(
        tmp_path / "phase-x" / "tiny.tif", "w", driver="GTiff",
        width=4, height=4, count=1, dtype="float32", transform=from_origin(-2, 2, 1, 1),
    ) as dst:
        dst.write(pixels, 1)

    with open_raster("phase-x/tiny.tif", data_dir=tmp_path) as src:
        assert np.array_equal(src.read(1), pixels)
