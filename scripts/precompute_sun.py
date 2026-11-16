"""Hourly Sun at each Artemis region's panel spot → frontend/public/data/sun/

The browser sizes power itself (frontend/src/plan/powerSize.js) from three
numbers per hour, which are all lunarsky/power.py uses:

  - frac        share of the Sun's disk above the skyline at the panel (0–1)
  - sun_el      Sun elevation (degrees)
  - sun_dist_km Sun distance (km)

The point is each region's #1 landing target's panel spot (Phase 6,
data/phase-6/landing_targets.json), with the panels PANEL_HEIGHT_M up,
against the same skyline /api/power uses there. So the page's numbers for a
year-round base from 2027-01-01 equal that target's precomputed kit.

Writes:
  - sun/{site_id}.bin   float32 little-endian: frac[n], sun_el[n], sun_dist_km[n]
  - sun/index.json      span, height, and per site the point and its source
  - power-inputs.json   the assumptions and the Customize inputs (loads,
                        crew, rates), what /api/power returns as ``inputs``

Regions whose targets weren't rerun at PANEL_HEIGHT_M are skipped. Needs the
elevation maps. ~10–20 s per site.

    .venv/bin/python scripts/precompute_sun.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lunarsky import load_kernels, load_sites, sky_track      # noqa: E402
from lunarsky.power import (DEFAULT_MISSION, PANEL_HEIGHT_M, disk_fraction,    # noqa: E402
                            earth_contact, editable_inputs, load_assumptions, mission_profile)
from lunarsky.terrain import compute_skyline, load_dems         # noqa: E402

LANDING = ROOT / "data" / "phase-6" / "landing_targets.json"
DATA = ROOT / "frontend" / "public" / "data"
OUT = DATA / "sun"
START = datetime(2026, 1, 1, tzinfo=timezone.utc)
END = datetime(2037, 1, 1, tzinfo=timezone.utc)   # a year-long stay can start on 2035-12-31
STEP_HOURS = 1.0


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    regions = json.loads(LANDING.read_text())["regions"]
    sites = {s.name: s for s in load_sites() if s.kind == "artemis_region"}
    k = load_kernels()
    dems = load_dems()
    days = (END - START).total_seconds() / 86400
    index = {"start_utc": START.strftime("%Y-%m-%dT%H:%M:%SZ"), "step_hours": STEP_HOURS,
             "height_m": PANEL_HEIGHT_M, "layout": ["frac", "sun_el", "sun_dist_km", "contact"],
             "dtype": "float32-le", "sites": {}}
    for name, r in sorted(regions.items()):
        site = sites.get(name)
        top = r["targets"][0] if r.get("targets") else None
        if not site or not top:
            continue
        if top.get("panel_height_m") != PANEL_HEIGHT_M or not top.get("panel_spot"):
            print(f"  {name}: not rerun at {PANEL_HEIGHT_M:g} m yet, skipped")
            continue
        p = top["panel_spot"]
        track = sky_track(k, p["lat"], p["lon"], START, days, STEP_HOURS)
        sky = compute_skyline(p["lat"], p["lon"], dems=dems)
        sun_hz = sky.horizon_at(track.sun_az, PANEL_HEIGHT_M)
        frac = disk_fraction(track.sun_el, track.sun_radius_deg, sun_hz)
        # 1 while in direct contact with Earth (antenna on the panel mast):
        # the radio's load line runs only then.
        contact = earth_contact(k, track, sky, START, days, STEP_HOURS)
        block = np.concatenate([frac, track.sun_el, track.sun_dist_km, contact]).astype("<f4")
        (OUT / f"{site.id}.bin").write_bytes(block.tobytes())
        index["n"] = len(frac)
        index["sites"][site.id] = {
            "region": name, "lat": p["lat"], "lon": p["lon"], "target_rank": top["rank"],
            "target": {"lat": top["lat"], "lon": top["lon"]}, "pick": p.get("pick"),
            "kit_total_kg": (p.get("power") or {}).get("total_kg"),
        }
        print(f"  {name} → {site.id}.bin ({block.nbytes / 1e6:.1f} MB)")
    (OUT / "index.json").write_text(json.dumps(index, indent=1))

    a = {key: row["value"] for key, row in load_assumptions().items()}
    inputs = editable_inputs(DEFAULT_MISSION)
    (DATA / "power-inputs.json").write_text(json.dumps(
        {"assumptions": a, "mission": mission_profile(DEFAULT_MISSION), "inputs": inputs}, indent=1))
    print(f"✓ {len(index['sites'])} sites → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
