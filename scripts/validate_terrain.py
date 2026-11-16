"""Compare our terrain-aware sunlight (and Earth visibility) with NASA's maps.

Phase 2's "done when": the terrain results agree with published illumination
values. For every site with a NASA value (``avg_sunlit`` in
data/phase-3/sites.csv), this computes the site's skyline, runs the Sun and
Earth over 18.6 years at 1-hour steps (the span NASA's maps average over),
and counts how often each clears the skyline at its own azimuth.

Skylines use the same maps as the app: a ±10 km window of the 20 m map,
then the 80 m and 240 m maps. Compare at 2 m (the app's default height):
at 0 m the eye lies on the ground and small bumps in the 20 m map, 40 m
away, shadow it, so 0 m runs far darker than NASA.

    .venv/bin/python scripts/validate_terrain.py              # all polar sites
    .venv/bin/python scripts/validate_terrain.py artemis-ma   # one site

Columns:
  smooth      Phase 1: any part of the Sun above a flat 0° horizon
  disk        terrain, 0 m: average fraction of the Sun's disk above the skyline
  any         terrain, 0 m: any part of the Sun above the skyline
  NASA        avg_sunlit from sites.csv (Mazarico et al. 2011 maps)
  earth_*     the same for Earth (any part of the disk), where NASA's 60 m
              Earth map covers the site (85°S to the pole)

Writes data/phase-2/terrain_validation.csv.
"""

from __future__ import annotations

import csv
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from lunarsky import load_kernels, sky_track
from lunarsky.terrain import compute_skyline, latlon_to_map, load_dems

ROOT = Path(__file__).resolve().parent.parent
SITES_CSV = ROOT / "data/phase-3/sites.csv"
OUT_CSV = ROOT / "data/phase-2/terrain_validation.csv"
EARTH_MAP = "phase-2/AVGVISIB_85S_060M_201608_EARTH.TIF"

START = datetime(2025, 1, 1, tzinfo=timezone.utc)
DAYS = 18.6 * 365.25                    # one lunar nodal cycle


def disk_fraction(el_deg, radius_deg, horizon_deg) -> np.ndarray:
    """Fraction of a disk's area above a horizontal line at ``horizon_deg``."""
    u = np.clip((el_deg - horizon_deg) / radius_deg, -1.0, 1.0)
    return 1.0 - (np.arccos(u) - u * np.sqrt(1.0 - u * u)) / np.pi


def nasa_earth_at(lat: float, lon: float) -> float | None:
    """NASA's average Earth visibility at a site, or None outside the 85°S map."""
    from rasterio.windows import Window

    from lunarsky.data import open_raster

    x, y = latlon_to_map(lat, lon)
    with open_raster(EARTH_MAP, source="local") as src:
        row, col = src.index(float(x), float(y))
        if not (0 <= row < src.height and 0 <= col < src.width):
            return None
        v = src.read(1, window=Window(col, row, 1, 1))[0, 0]
        if v == src.nodata:
            return None
        return float(v) * src.scales[0]


def main(only: list[str]) -> int:
    sites = [r for r in csv.DictReader(SITES_CSV.open()) if r["avg_sunlit"]]
    if only:
        sites = [r for r in sites if r["id"] in only]
    if not sites:
        print("no matching sites with a NASA value")
        return 1

    k = load_kernels()
    dems = load_dems(source="local")
    rows = []
    print(f"{len(sites)} sites, {DAYS / 365.25:.1f} years hourly from {START.date()}\n")
    head = (f"{'site':<15}{'smooth':>7}{'disk':>7}{'any':>7}{'NASA':>7}{'Δ disk':>8}"
            f"{'earth':>7}{'NASA':>7}  2m/10m/20m disk")
    print(head)
    print("-" * len(head))

    for r in sites:
        t0 = time.perf_counter()
        lat, lon = float(r["lat"]), float(r["lon"])
        sky = compute_skyline(lat, lon, dems=dems)
        tr = sky_track(k, lat, lon, START, days=DAYS)

        smooth = float(np.mean(tr.sunlit(0.0, "any")))
        by_height = {}
        for h in sky.heights_m:
            sun_hz = sky.horizon_at(tr.sun_az, h)
            by_height[h] = {
                "disk": float(np.mean(disk_fraction(tr.sun_el, tr.sun_radius_deg, sun_hz))),
                "any": float(np.mean(tr.sunlit(sun_hz, "any"))),
                "earth": float(np.mean(tr.earth_visible(sky.horizon_at(tr.earth_az, h), "any"))),
            }
        g = by_height[0.0]
        nasa = float(r["avg_sunlit"])
        nasa_earth = nasa_earth_at(lat, lon)

        rows.append({
            "id": r["id"], "lat": lat, "lon": lon, "nasa_map": r["sunlit_map"],
            "ground_m": round(sky.ground_m, 1),
            "nasa_sunlit": nasa, "smooth_sunlit": round(smooth, 4),
            **{f"sunlit_disk_{h:g}m": round(v["disk"], 4) for h, v in by_height.items()},
            **{f"sunlit_any_{h:g}m": round(v["any"], 4) for h, v in by_height.items()},
            **{f"earth_{h:g}m": round(v["earth"], 4) for h, v in by_height.items()},
            "nasa_earth": None if nasa_earth is None else round(nasa_earth, 4),
            "skyline_partial": sky.partial,
        })
        e_nasa = "" if nasa_earth is None else f"{nasa_earth * 100:6.1f}%"
        heights = "/".join(f"{by_height[h]['disk'] * 100:.0f}" for h in sky.heights_m if h > 0)
        print(f"{r['id']:<15}{smooth * 100:6.1f}%{g['disk'] * 100:6.1f}%{g['any'] * 100:6.1f}%"
              f"{nasa * 100:6.1f}%{(g['disk'] - nasa) * 100:+7.1f}"
              f"{g['earth'] * 100:6.1f}%{e_nasa:>7}  {heights}"
              f"   ({time.perf_counter() - t0:.1f}s)")

    print()
    for h in ("2", "0", "10"):     # 2 m first: the app's default height
        d = np.array([x[f"sunlit_disk_{h}m"] - x["nasa_sunlit"] for x in rows])
        note = "  (default)" if h == "2" else "  (eye on the ground: sensitive to map bumps)" if h == "0" else ""
        print(f"terrain (disk, {h:>2} m) minus NASA: mean {d.mean() * 100:+.1f}, "
              f"mean |Δ| {np.abs(d).mean() * 100:.1f}, worst {d[np.argmax(np.abs(d))] * 100:+.1f} points{note}")
    s = np.array([x["smooth_sunlit"] - x["nasa_sunlit"] for x in rows])
    print(f"smooth Moon minus NASA:         mean {s.mean() * 100:+.1f}, mean |Δ| {np.abs(s).mean() * 100:.1f}")

    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\nwrote {OUT_CSV.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
