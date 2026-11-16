"""The browser's power sizing (frontend/src/plan/powerSize.js) gives the same
kit masses as lunarsky/power.py on real 10 m panel tracks.

Each case builds a Sun track and the 10 m skyline in Python, sizes it with
``size_on_track``, then sends the same hourly input (share of the Sun's
disk, Sun elevation, Sun distance) to Node and compares every option.
"""

import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from lunarsky import load_kernels, sky_track
from lunarsky.power import (ANTENNA_HEIGHT_M, disk_fraction, earth_contact, load_assumptions,
                            mission_profile, size_on_track)

ROOT = Path(__file__).resolve().parent.parent
RUNNER = ROOT / "tests" / "js" / "size_runner.mjs"
HEIGHT_M = 10.0

# (lat, lon, start, days, load override): a year-round base at two regions,
# a two-week one-off stay (which also tries battery only), and a heavy
# daylight-only load.
CASES = [
    ("Malapert Massif", -86.00114, 2.05502, datetime(2026, 1, 1), 365, None),
    ("Haworth", -86.36851, -23.27645, datetime(2026, 1, 1), 365, None),
    ("Malapert, 14 days", -86.00114, 2.05502, datetime(2026, 3, 1), 14, None),
    ("Haworth, daylight load", -86.36851, -23.27645, datetime(2026, 6, 1), 365, (6000.0, 8000.0)),
]

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs Node")


@pytest.fixture(scope="module")
def results(tmp_path_factory):
    from lunarsky.terrain import compute_skyline

    k = load_kernels()
    a = {key: row["value"] for key, row in load_assumptions().items()}
    py, cases = [], []
    for name, lat, lon, start, days, load in CASES:
        prof = mission_profile("crew")
        prof["days"] = days
        if load:
            prof["always_w"], prof["day_w"] = load
            prof["load_w"] = sum(load) + prof["contact_w"]
        track = sky_track(k, lat, lon, start.replace(tzinfo=timezone.utc), days, 1.0)
        try:
            sky = compute_skyline(lat, lon)
            sun_hz = sky.horizon_at(track.sun_az, HEIGHT_M)
        except (ValueError, FileNotFoundError) as e:
            pytest.skip(f"needs the terrain maps: {e}")
        # The radio runs only in contact with Earth.
        contact = earth_contact(k, track, sky, start.replace(tzinfo=timezone.utc), days, 1.0,
                                ANTENNA_HEIGHT_M)
        py.append((name, size_on_track(track, sun_hz, prof, 1.0, contact=contact)))
        frac = disk_fraction(track.sun_el, track.sun_radius_deg, sun_hz)
        cases.append({
            "frac": np.asarray(frac, float).tolist(),
            "sun_el": np.asarray(track.sun_el, float).tolist(),
            "sun_dist_km": np.asarray(track.sun_dist_km, float).tolist(),
            "prof": {"always_w": prof["always_w"], "day_w": prof["day_w"],
                     "contact_w": prof.get("contact_w", 0.0), "days": days},
            "contact": contact.astype(int).tolist(),
            "step_hours": 1.0,
        })
    path = tmp_path_factory.mktemp("js") / "cases.json"
    path.write_text(json.dumps({"assumptions": a, "cases": cases}))
    run = subprocess.run(["node", str(RUNNER), str(path)], capture_output=True, text=True, check=True)
    return list(zip(py, json.loads(run.stdout)))


@pytest.mark.parametrize("i", range(len(CASES)), ids=[c[0] for c in CASES])
def test_js_matches_python(results, i):
    (name, py), js = results[i]
    assert py["feasible"] and js["feasible"], name
    for key in ("break_even_m2", "longest_dark_hours", "sunlit_fraction", "sized_load_w",
                "simple_battery_kwh", "repeat", "contact_fraction"):
        assert js[key] == pytest.approx(py[key], abs=0.011), key
    for key in ("storage_gb", "longest_blackout_hours"):
        assert js["data"][key] == pytest.approx(py["data"][key], abs=0.11), key
    assert len(js["options"]) == len(py["options"])
    for o_py, o_js in zip(py["options"], js["options"]):
        for key in ("array_multiple", "array_m2", "array_kg", "battery_kwh", "battery_kg", "total_kg"):
            # Both round to 0.1 kg / 0.01 m²; allow one step of rounding apart.
            assert o_js[key] == pytest.approx(o_py[key], abs=0.11), (o_py["array_multiple"], key)
    assert js["best"]["array_multiple"] == py["best"]["array_multiple"]
    assert js["best"]["total_kg"] == pytest.approx(py["best"]["total_kg"], abs=0.11)
