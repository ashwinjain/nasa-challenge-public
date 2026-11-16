"""The site list from ``data/phase-3/sites.csv`` and the Artemis region outlines.

9 sites, one per Artemis III candidate region. See ``data/phase-3/README.md`` for how
each coordinate was chosen.
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from .kernels import DEFAULT_DATA_DIR

SITES_CSV = Path("phase-3") / "sites.csv"
REGIONS_GEOJSON = Path("phase-3") / "artemis_regions.geojson"


@dataclass(frozen=True)
class Site:
    id: str
    name: str
    group: str                 # "core"
    kind: str                  # "artemis_region"
    lat: float                 # degrees, MOON_ME frame
    lon: float                 # degrees, east positive
    method: str                # "sunniest_in_region"
    avg_sunlit: float | None   # long-term average sunlit fraction (Mazarico 2011); None outside the maps
    sunlit_map: str            # "60m", "120m" or ""
    source: str
    notes: str

    def to_dict(self) -> dict:
        return asdict(self)


def _resolve(path, default_rel: Path, data_dir) -> Path:
    if path is not None:
        return Path(path)
    base = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR
    return base / default_rel


def load_sites(path: str | os.PathLike | None = None, data_dir: str | os.PathLike | None = None) -> list[Site]:
    """Read ``sites.csv`` into a list of :class:`Site`, in file order."""
    p = _resolve(path, SITES_CSV, data_dir)
    with p.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    sites = []
    for r in rows:
        avg = r.get("avg_sunlit", "").strip()
        sites.append(
            Site(
                id=r["id"],
                name=r["name"],
                group=r["group"],
                kind=r["kind"],
                lat=float(r["lat"]),
                lon=float(r["lon"]),
                method=r["method"],
                avg_sunlit=float(avg) if avg else None,
                sunlit_map=r.get("sunlit_map", ""),
                source=r.get("source", ""),
                notes=r.get("notes", ""),
            )
        )
    return sites


def site_by_id(sites: list[Site], site_id: str) -> Site:
    for s in sites:
        if s.id == site_id:
            return s
    raise KeyError(f"No site {site_id!r}. Known ids: {', '.join(s.id for s in sites)}")


def load_artemis_regions(path: str | os.PathLike | None = None, data_dir: str | os.PathLike | None = None) -> dict:
    """The USGS outlines of the nine Artemis III regions, as a GeoJSON dict."""
    p = _resolve(path, REGIONS_GEOJSON, data_dir)
    with p.open(encoding="utf-8") as f:
        return json.load(f)
