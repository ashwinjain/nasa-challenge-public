"""Precompute per-site surface albedo (brightness) for the first-person view.

Drapes REAL, geographically-registered lunar imagery on each site's surface
mesh: the NASA LRO LROC WAC South Pole Summer Mosaic (WAC_ROI_SOUTH_SUMMER_100M,
643 nm, 100 m/pixel). It is in the SAME polar-stereographic projection as the
LOLA elevation maps (+proj=stere +lat_0=-90 +lat_ts=-90 +R=1737400), so each
mesh vertex samples the mosaic at its true lat/lon — real craters and brightness
land in the real places. The "summer" mosaic composites each spot when it is
best lit, so even the dim polar terrain has usable imagery.

The ~0.8 GB mosaic is NOT downloaded: each site reads a small window straight
from the NASA/LROC server over /vsicurl (like the 20 m DEM). Only the small
baked bytes touch disk — one byte per mesh vertex, in the mesh's vertex order
(site point first, then ring by ring, 720 spokes x the same rings as
precompute_terrain.py, to 300 km), normalised so each site reads mid-grey.

Writes:
  - frontend/public/data/terrain/<id>_albedo.bin   (uint8, 1 + n_az*n_rings)
    for every site and every landing target (land-*; each region's #1 is in
    git, #2-#10 go to R2 with scripts/upload_terrain_r2.sh)

Usage:
    .venv/bin/python scripts/precompute_albedo.py
    .venv/bin/python scripts/precompute_albedo.py land-hw land-sp   # only these ids
"""
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import precompute_terrain as pt                     # same sites, grid and rings

from lunarsky.terrain import HeightMap, R_M, _local_axes, _project, latlon_to_map

OUT_DIR = ROOT / "frontend" / "public" / "data" / "terrain"
# Local copy of the NASA LROC WAC South Pole Summer Mosaic (gitignored, see
# data/phase-2/README.md). Downloaded once; not streamed (the LROC server rate-
# limits /vsicurl). Same polar-stereographic projection as the LOLA DEMs.
SRC = ROOT / "data" / "phase-2" / "WAC_ROI_SOUTH_SUMMER_100M.TIF"
HALF_M = (pt.MAX_KM + 5.0) * 1000.0                 # window covers the whole 300 km mesh


def grid_mapxy(lat, lon, radii):
    """Map x,y (m, polar stereographic) at the site point and every mesh vertex."""
    up, north, east = _local_axes(lat, lon)
    az = np.radians(np.arange(pt.N_AZ) * 360.0 / pt.N_AZ)
    dirv = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east
    ang = radii / R_M
    u = (np.cos(ang)[:, None, None] * up
         + np.sin(ang)[:, None, None] * dirv[None, :, :])
    return _project(u)                               # (n_rings, n_az) each


def read_window(src, cx, cy):
    """A HeightMap over the square cx,cy +/- HALF_M, read from the mosaic."""
    win = from_bounds(cx - HALF_M, cy - HALF_M, cx + HALF_M, cy + HALF_M,
                      transform=src.transform).round_offsets().round_lengths()
    try:
        win = win.intersection(Window(0, 0, src.width, src.height))
    except Exception:
        return None
    if win.width < 2 or win.height < 2:
        return None
    arr = src.read(1, window=win).astype(np.float32)
    t = src.window_transform(win)
    return HeightMap(arr, x0=t.c, y0=t.f, dx=t.a, dy=t.e, name="WAC")


def main():
    if not SRC.exists():
        sys.exit(f"missing {SRC.relative_to(ROOT)} — download it first (see data/phase-2/README.md)")
    places = pt.imagery_places()                     # sites + landing targets
    if sys.argv[1:]:                                 # optional: only these ids
        places = [p for p in places if p[0] in sys.argv[1:]]
    radii = pt.ring_radii()
    print(f"Albedo grid: {pt.N_AZ} spokes x {len(radii)} rings; mosaic {SRC.name}")

    n_done = 0
    with rasterio.open(SRC) as src:
        p = src.crs.to_dict() if src.crs else {}
        if p.get("proj") != "stere" or abs(float(p.get("lat_0", 0)) + 90) > 1e-6:
            sys.exit(f"mosaic projection {p} is not south-polar stereographic")
        for sid, name, lat, lon in places:
            cx, cy = latlon_to_map(lat, lon)
            hm = read_window(src, float(cx), float(cy))
            if hm is None:
                print(f"  {name:38s} — outside the mosaic, skipped")
                continue
            mx, my = grid_mapxy(lat, lon, radii)
            a = hm.sample(mx, my)                     # (n_rings, n_az)
            a0 = hm.sample(np.array([cx]), np.array([cy]))[0]

            flat = np.concatenate([[a0], a.reshape(-1)]).astype(np.float64)   # vertex order
            valid = np.isfinite(flat) & (flat > 0)   # 0 = permanent shadow / no data
            mean = flat[valid].mean() if valid.any() else 128.0
            out = np.clip(flat / mean * 128.0, 0, 255)   # site mean -> mid-grey
            out[~np.isfinite(flat)] = 128            # off-map holes -> neutral
            (OUT_DIR / f"{sid}_albedo.bin").write_bytes(out.astype(np.uint8).tobytes())
            print(f"  {name:38s} mean {mean:5.1f}  lit {100*valid.mean():4.0f}%  ✓")
            n_done += 1

    print(f"\n✓ {n_done} albedo tiles -> {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
