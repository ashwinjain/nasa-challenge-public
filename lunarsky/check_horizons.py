"""Check lunarsky's Sun and Earth positions against JPL Horizons.

Horizons is asked for an observer on the Moon's surface (CENTER='coord@301',
MOON_ME coordinates) at the same sites and times. The Phase 1 "done when"
is agreement within 0.1 degrees. Needs network access.

    python -m lunarsky.check_horizons
"""

from __future__ import annotations

import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np

from . import load_kernels, sky_track

HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
TOLERANCE_DEG = 0.1

SITES = [
    ("Near south pole", -89.5, 0.0),
    ("Malapert Massif", -86.00114, 2.05502),
    ("Equator, near side", 0.0, 0.0),
    ("Far side", -45.0, 180.0),
]
BODIES = [("Sun", "10"), ("Earth", "399")]


def horizons_altaz(body_id: str, lat: float, lon: float, start: datetime, stop: datetime, step: str) -> list[tuple[str, float, float]]:
    fmt = "%Y-%m-%d %H:%M"
    params = {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon},{lat},0'",
        "START_TIME": f"'{start.strftime(fmt)}'",
        "STOP_TIME": f"'{stop.strftime(fmt)}'",
        "STEP_SIZE": f"'{step}'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "CAL_FORMAT": "'CAL'",
    }
    url = HORIZONS + "?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode()
    if "$$SOE" not in text:
        raise RuntimeError("Horizons returned no ephemeris:\n" + text[:2000])
    rows = []
    for line in text.split("$$SOE")[1].split("$$EOE")[0].strip().splitlines():
        parts = line.split()
        # e.g. "2027-Jan-01 00:00 *m  212.007180   1.095385"; the flag column may be absent
        rows.append((parts[0] + " " + parts[1], float(parts[-2]), float(parts[-1])))
    return rows


def main() -> int:
    k = load_kernels()
    start = datetime(2027, 1, 1, tzinfo=timezone.utc)
    hours = 24
    stop = start + timedelta(hours=hours)
    worst = 0.0
    print(f"{'site':22s} {'body':6s} {'n':>3s} {'max dEl':>9s} {'max dAz*cosEl':>14s}")
    for name, lat, lon in SITES:
        tr = sky_track(k, lat, lon, start, hours / 24.0, 1.0)
        for body, bid in BODIES:
            rows = horizons_altaz(bid, lat, lon, start, stop, "1 h")
            h_az = np.array([r[1] for r in rows])
            h_el = np.array([r[2] for r in rows])
            ours_az = tr.sun_az if body == "Sun" else tr.earth_az
            ours_el = tr.sun_el if body == "Sun" else tr.earth_el
            if len(rows) != len(ours_az):
                raise RuntimeError(f"sample count mismatch: Horizons {len(rows)}, ours {len(ours_az)}")
            d_el = np.abs(ours_el - h_el)
            d_az = np.abs((ours_az - h_az + 180.0) % 360.0 - 180.0) * np.cos(np.radians(h_el))
            worst = max(worst, float(d_el.max()), float(d_az.max()))
            print(f"{name:22s} {body:6s} {len(rows):3d} {d_el.max():9.5f} {d_az.max():14.5f}")
    print()
    if worst <= TOLERANCE_DEG:
        print(f"PASS: worst disagreement {worst:.5f} deg is within {TOLERANCE_DEG} deg")
        return 0
    print(f"FAIL: worst disagreement {worst:.5f} deg exceeds {TOLERANCE_DEG} deg")
    return 1


if __name__ == "__main__":
    sys.exit(main())
