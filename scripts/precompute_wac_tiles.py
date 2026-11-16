"""Precompute per-site WAC imagery tiles for per-pixel surface draping.

precompute_albedo.py bakes one brightness byte per mesh VERTEX, which the GPU
interpolates — crisp near the site but soft in the mid/far field where mesh
rings are 100 m – 2.6 km apart. This script instead bakes a per-site TEXTURE
from the same NASA LROC WAC South Pole Summer Mosaic, sampled on a log-polar
grid (columns = azimuth, rows = log radius), so the fragment shader can sample
it per pixel with one closed-form uv mapping and the full 100 m crater detail
survives at every distance.

Processing per site:
  - sample the mosaic at TEX_N azimuths x TEX_N log-spaced radii (R0..R1 m);
  - flatten the low-frequency illumination gradient (divide by a heavy blur),
    keeping crater-scale contrast but removing the mosaic's regional shading;
  - normalise to mean 128 and write a greyscale JPEG.

Writes:
  - frontend/public/data/terrain/<id>_wac.jpg   (TEX_N x TEX_N, grey)
    for every site and every landing target (land-*; each region's #1 is in
    git, #2-#10 go to R2 with scripts/upload_terrain_r2.sh)

uv mapping used by the shader (frontend/src/terrainMaterial.js):
  u = azimuth / 2pi          (RepeatWrapping)
  v = log(r / R0) / log(R1 / R0), clamped to [0, 1]

Usage:
    .venv/bin/python scripts/precompute_wac_tiles.py
    .venv/bin/python scripts/precompute_wac_tiles.py land-hw land-sp   # only these ids
"""
import sys
from pathlib import Path

import numpy as np
import rasterio
import scipy.ndimage as ndi
from PIL import Image
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import precompute_terrain as pt

from lunarsky.terrain import HeightMap, R_M, _local_axes, _project, latlon_to_map

OUT_DIR = ROOT / "frontend" / "public" / "data" / "terrain"
SRC = ROOT / "data" / "phase-2" / "WAC_ROI_SOUTH_SUMMER_100M.TIF"

TEX_N = 2048            # texture size (azimuth x log-radius)
R0 = 20.0               # first radius row (m) — the mesh's finest ring
R1 = pt.MAX_KM * 1000.0 # last radius row = the mesh's 300 km edge
HALF_M = R1 + 5000.0    # mosaic window must cover the whole grid


def read_window(src, cx, cy):
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


def bake_tile(lat, lon, wac):
    up, north, east = _local_axes(lat, lon)
    az = np.radians(np.arange(TEX_N) * 360.0 / TEX_N)
    dirv = np.cos(az)[:, None] * north + np.sin(az)[:, None] * east   # (az, 3)
    radii = R0 * (R1 / R0) ** ((np.arange(TEX_N) + 0.5) / TEX_N)      # (rows,)
    out = np.empty((TEX_N, TEX_N), dtype=np.float32)
    for i0 in range(0, TEX_N, 256):                                   # row chunks
        ang = radii[i0:i0 + 256] / R_M
        u = (np.cos(ang)[:, None, None] * up
             + np.sin(ang)[:, None, None] * dirv[None, :, :])
        mx, my = _project(u)
        out[i0:i0 + 256] = wac.sample(mx, my)
    return out


def flatten_and_encode(a):
    """Remove the regional illumination gradient, keep crater contrast.

    In the permanently-shadowed patches the mosaic is near zero; dividing by
    the blur there amplifies stray bright pixels into confetti, so the flatten
    blends off in dark regions and absolute (dark) brightness is kept instead.
    The top rows (r < ~250 m) are at/below the mosaic's 100 m resolution and only
    smear into streaks — they fade to neutral (the regolith grain covers that
    scale in the shader).
    """
    a = np.nan_to_num(a, nan=np.nanmean(a) if np.isfinite(a).any() else 128.0)
    a = np.clip(a, 0.0, 255.0)
    low = ndi.gaussian_filter(a, 48.0, mode=("nearest", "wrap"))
    flat = np.clip(a / np.maximum(low, 12.0), 0.0, 2.0) * 128.0
    w = np.clip((low - 12.0) / 24.0, 0.0, 1.0)          # 0 = deep shadow
    out = w * flat + (1.0 - w) * a * 0.6                # PSRs stay dark, no confetti
    # Fade the unresolvable near field (top rows) to neutral grey.
    rows = np.arange(TEX_N, dtype=np.float32)
    r_of = R0 * (R1 / R0) ** (rows / TEX_N)
    near = np.clip((r_of - 25.0) / 35.0, 0.0, 1.0)[:, None]
    out = near * out + (1.0 - near) * 128.0
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="L")


def main():
    if not SRC.exists():
        sys.exit(f"missing {SRC.relative_to(ROOT)} — see data/phase-2/README.md")
    places = pt.imagery_places()                     # sites + landing targets
    if sys.argv[1:]:                                 # optional: only these ids
        places = [p for p in places if p[0] in sys.argv[1:]]
    print(f"WAC tiles: {TEX_N}x{TEX_N} log-polar, r = {R0:g} m .. {R1/1000:g} km")
    n = 0
    with rasterio.open(SRC) as src:
        for sid, name, lat, lon in places:
            cx, cy = latlon_to_map(lat, lon)
            wac = read_window(src, float(cx), float(cy))
            if wac is None:
                print(f"  {name:38s} — outside the mosaic, skipped")
                continue
            tile = bake_tile(lat, lon, wac)
            img = flatten_and_encode(tile)
            img.save(OUT_DIR / f"{sid}_wac.jpg", quality=87)
            kb = (OUT_DIR / f"{sid}_wac.jpg").stat().st_size // 1024
            print(f"  {name:38s} {kb:4d} KB  ✓")
            n += 1
    print(f"\n✓ {n} WAC tiles -> {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
