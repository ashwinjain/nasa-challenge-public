"""Precompute sky data for the 9 Artemis III sites → frontend/public/data/

Writes:
  - frontend/public/data/sites.json       (site list)
  - frontend/public/data/sky/{site_id}.json  (per-site sky data, smooth Moon
    plus a "terrain" block at each eye height)
  - frontend/public/data/skyline/{site_id}.json  (terrain skyline, polar
    sites only)
  - frontend/public/data/panel/{site_id}.json  (best solar panel spots within
    300 m, polar sites only; ~40 s per site, skip with --no-panels)

Needs the elevation maps in data/phase-2 (see data/phase-2/README.md).

Usage:
    .venv/bin/python scripts/precompute_static.py
    .venv/bin/python scripts/precompute_static.py --no-panels   # skip the slow panel search
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from lunarsky import load_kernels, load_sites, sky_track, phase1_metrics, terrain_results
from lunarsky.panels import find_panel_site
from lunarsky.terrain import compute_skyline, load_dems

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "data"
SKY_DIR = OUT_DIR / "sky"
SKYLINE_DIR = OUT_DIR / "skyline"
PANEL_DIR = OUT_DIR / "panel"
PANEL_START = datetime(2027, 1, 1, tzinfo=timezone.utc)   # one-year scoring window

DEFAULT_START = datetime(2027, 1, 1, tzinfo=timezone.utc)   # the main page's fixed timeline window
DEFAULT_DAYS = 31  # one month
STEP_HOURS = 1.0


def main(panels: bool = True):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    SKY_DIR.mkdir(parents=True, exist_ok=True)
    SKYLINE_DIR.mkdir(parents=True, exist_ok=True)
    PANEL_DIR.mkdir(parents=True, exist_ok=True)
    panel_cache = {}

    print("Loading kernels and elevation maps...")
    k = load_kernels()
    dems = load_dems()
    sites = load_sites()

    # ── sites.json ──
    # Carry every column from sites.csv so the frontend can show the full
    # provenance (method, sunlit map resolution, source, notes) on a site,
    # not just the coordinate. Empty text fields become null.
    def _clean(v):
        return v if (v is not None and str(v).strip() != "") else None

    sites_json = []
    for s in sites:
        sites_json.append({
            "id": s.id,
            "name": s.name,
            "group": getattr(s, "group", None),
            "kind": getattr(s, "kind", None),
            "lat": s.lat,
            "lon": s.lon,
            "avg_sunlit": getattr(s, "avg_sunlit", None),
            "sunlit_map": _clean(getattr(s, "sunlit_map", None)),
            "method": _clean(getattr(s, "method", None)),
            "source": _clean(getattr(s, "source", None)),
            "notes": _clean(getattr(s, "notes", None)),
        })

    sites_path = OUT_DIR / "sites.json"
    sites_path.write_text(json.dumps(sites_json, indent=2))
    print(f"✓ {sites_path.relative_to(ROOT)}  ({len(sites)} sites)")

    # ── ephemeris.json ──
    # Site-independent Sun/Earth orbital track that drives the 3D simulator's
    # lighting: the sub-solar and sub-Earth points (lat/lon in the Moon's
    # MOON_ME frame) at each instant. Same time grid as the sky files.
    n = int(round(DEFAULT_DAYS * 24.0 / STEP_HOURS)) + 1
    te = k.ts.utc(DEFAULT_START.year, DEFAULT_START.month, DEFAULT_START.day,
                  0.0 + np.arange(n) * STEP_HOURS)
    sun_lat, sun_lon, _ = (k.sun - k.moon).at(te).frame_latlon(k.frame)
    earth_lat, earth_lon, earth_d = (k.earth - k.moon).at(te).frame_latlon(k.frame)
    wrap180 = lambda a: ((np.asarray(a) + 180.0) % 360.0) - 180.0
    ephemeris = {
        "window": {
            "start_utc": DEFAULT_START.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "days": DEFAULT_DAYS, "step_hours": STEP_HOURS, "samples": n,
        },
        "times_utc": list(te.utc_iso()),
        "step_hours": STEP_HOURS,
        "subsolar_lat": [round(float(x), 4) for x in sun_lat.degrees],
        "subsolar_lon": [round(float(x), 4) for x in wrap180(sun_lon.degrees)],
        "subearth_lat": [round(float(x), 4) for x in earth_lat.degrees],
        "subearth_lon": [round(float(x), 4) for x in wrap180(earth_lon.degrees)],
        "earth_dist_km": [round(float(x), 1) for x in earth_d.km],
    }
    eph_path = OUT_DIR / "ephemeris.json"
    eph_path.write_text(json.dumps(ephemeris))
    print(f"✓ {eph_path.relative_to(ROOT)}  ({n} samples)")

    # ── sky/{site_id}.json ──
    for s in sites:
        print(f"  Computing {s.name}...", end="", flush=True)
        track = sky_track(k, s.lat, s.lon, DEFAULT_START, DEFAULT_DAYS, STEP_HOURS)
        metrics = phase1_metrics(track)
        payload = track.to_dict()
        payload["metrics"] = metrics
        payload["site_id"] = s.id
        payload["site_name"] = s.name

        try:
            skyline = compute_skyline(s.lat, s.lon, dems=dems)
        except ValueError as e:
            skyline = str(e)
        payload["terrain"] = terrain_results(track, skyline)
        if not isinstance(skyline, str):
            (SKYLINE_DIR / f"{s.id}.json").write_text(json.dumps(skyline.to_dict()))
            if panels:
                key = (s.lat, s.lon)
                if key not in panel_cache:
                    panel_cache[key] = find_panel_site(k, s.lat, s.lon, PANEL_START, dems=dems)
                (PANEL_DIR / f"{s.id}.json").write_text(json.dumps({"site_id": s.id, **panel_cache[key]}))

        out_path = SKY_DIR / f"{s.id}.json"
        out_path.write_text(json.dumps(payload))
        n = len(payload.get("times_utc", payload.get("times", [])))
        print(f" ✓ ({n} samples, terrain {'yes' if payload['terrain']['available'] else 'no'})")

    print(f"\n✓ All {len(sites)} sites precomputed to {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main(panels="--no-panels" not in sys.argv[1:])
