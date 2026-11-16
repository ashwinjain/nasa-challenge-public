"""Bake a south-polar cap for the orbital globe from the NASA polar products.

The globe wears one equirectangular wrap. That projection converges every
texture column onto the pole, so exactly where this app spends its time the
colour map carries ~1.33 km per texel north-south (the normal map ~2.67 km)
and smears into a radial pinch at 90 deg S. Both polar source products are far
finer and are already in the same polar stereographic frame as the LDEMs the
surface view uses, so the cap is a straight decimated crop - no reprojection.

Two outputs, both square, centred on the pole, spanning +/- HALF_M metres:

  pole_south_albedo.jpg  WAC mosaic with its illumination divided out, so it is
                         reflectance only. The globe shader lights it with the
                         live Sun, which is the whole point: a drape of the raw
                         mosaic would freeze the Sun where it stood when the
                         mosaic was taken and the shadows would never move.
  pole_south_normal.jpg  Surface normals from LOLA, for crater shading. Baked
                         rather than differenced in the shader so it can be
                         fine (TEX_N) while the height stays small; normals are
                         smooth, so JPEG carries them cheaply.
  pole_south_height.png  LOLA elevation for the cast-shadow march, 16-bit
                         packed into R (high byte) and G (low byte) because
                         browsers downconvert a true 16-bit PNG on load. Kept
                         at SHADOW_N: the march needs vertical precision (at a
                         1 deg Sun a 50 m error moves a shadow edge kilometres)
                         but not horizontal detail, and the low byte is noise
                         that PNG cannot compress - at TEX_N this file alone
                         came to 24 MB.

Permanently shadowed ground reads as near-zero in the mosaic, which carries no
albedo information at all. Dividing by the blur there amplifies sensor noise
into confetti, so those pixels fall back to neutral albedo and let the shadow
march blacken them - the physically right answer, and it keeps PSRs correctly
dark at every Sun position instead of only the one the mosaic captured.

Writes frontend/public/textures/ plus pole_south.json (the shader's decode
ring: extent, height range, source provenance).

Usage:
    .venv/bin/python scripts/precompute_polar_cap.py
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import rasterio
import scipy.ndimage as ndi
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "textures"
WAC = ROOT / "data" / "phase-2" / "WAC_ROI_SOUTH_SUMMER_100M.TIF"
LDEM = ROOT / "data" / "phase-2" / "LDEM_60S_240MPP_ADJ.TIF"

R_M = 1737400.0
TEX_N = 3072          # albedo / normal size (square, pole at the centre)
SHADOW_N = 1024       # height size, for the shadow march only
EDGE_LAT = -72.0      # the cap reaches this latitude at the edge of the square


def polar_radius(lat_deg):
    """Polar-stereographic radius (m) of a southern latitude, lat_ts = -90."""
    return 2.0 * R_M * math.tan(math.radians((90.0 + lat_deg) / 2.0))


HALF_M = polar_radius(EDGE_LAT)


def read_square(path, half_m, n, resampling):
    """Decimated read of the +/- half_m square around the pole, as n x n."""
    with rasterio.open(path) as src:
        win = from_bounds(-half_m, -half_m, half_m, half_m, transform=src.transform)
        arr = src.read(
            1, window=win, out_shape=(n, n),
            resampling=resampling, boundless=True, fill_value=np.nan,
        ).astype(np.float32)
        nodata = src.nodata
    if nodata is not None:
        arr[arr == nodata] = np.nan
    return arr


# Scale of the shading we are removing. The mosaic is a summer composite, so
# every frame was taken at a grazing Sun and each crater carries a long baked
# shadow a few km across. Dividing by a blur only wider than those shadows
# (tens of km) leaves them untouched: drape that and the pole looks superb and
# never changes as the clock runs, which is the one thing this app must not do.
# Blurring at roughly the shadow scale removes them instead.
FLATTEN_KM = 4.5
# How much surviving contrast to keep. Polar ground is all highland regolith,
# genuinely uniform to within a few percent, so most of what survives at this
# scale is residual shading rather than real reflectance. Keeping a fraction
# preserves true albedo marks - fresh ejecta, ray streaks - without reimposing
# a fixed Sun. Topography does the rest, lit live.
ALBEDO_STRENGTH = 0.45


def flatten_albedo(a, texel_m):
    """Reduce the mosaic to reflectance: shading out, true albedo marks kept.

    Returns uint8 with 128 = neutral. Permanently shadowed ground carries no
    albedo information at all - dividing there amplifies sensor noise into
    confetti - so it returns neutral and the shadow march blackens it, which
    keeps it dark at every Sun position rather than only the mosaic's.
    """
    a = np.where(np.isfinite(a), a, 0.0)
    a = np.clip(a, 0.0, 255.0)
    sigma = max(FLATTEN_KM * 1000.0 / texel_m, 1.0)
    low = ndi.gaussian_filter(a, sigma, mode="nearest")
    flat = np.clip(a / np.maximum(low, 12.0), 0.0, 2.0)
    flat = 1.0 + (flat - 1.0) * ALBEDO_STRENGTH
    signal = np.clip((low - 10.0) / 20.0, 0.0, 1.0)      # 0 where unlit
    out = (signal * flat + (1.0 - signal) * 1.0) * 128.0
    return np.clip(out, 0, 255).astype(np.uint8)


def bake_normal(h, texel_m):
    """Tangent-space normals from elevation, as an RGB image.

    Polar stereographic is conformal and its scale factor only runs from 1.000
    at the pole to 1.025 at the cap edge, so treating the grid as flat here
    costs under 3% - far below what the shading shows.
    """
    h = np.where(np.isfinite(h), h, np.nanmedian(h[np.isfinite(h)]))
    # np.gradient returns d/drow, d/dcol; rows run +y downward in image space.
    dzdy, dzdx = np.gradient(h, texel_m)
    inv = 1.0 / np.sqrt(dzdx * dzdx + dzdy * dzdy + 1.0)
    rgb = np.empty((*h.shape, 3), dtype=np.uint8)
    rgb[..., 0] = np.clip((-dzdx * inv) * 127.5 + 127.5, 0, 255).astype(np.uint8)
    rgb[..., 1] = np.clip((dzdy * inv) * 127.5 + 127.5, 0, 255).astype(np.uint8)
    rgb[..., 2] = np.clip(inv * 127.5 + 127.5, 0, 255).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def pack_height(h):
    """16-bit elevation packed into R (high) and G (low). Returns image, range."""
    finite = np.isfinite(h)
    if not finite.any():
        sys.exit("elevation window is entirely nodata")
    lo = float(np.nanmin(h))
    hi = float(np.nanmax(h))
    span = max(hi - lo, 1.0)
    h = np.where(finite, h, lo)
    q = np.clip(np.rint((h - lo) / span * 65535.0), 0, 65535).astype(np.uint16)
    rgb = np.zeros((*q.shape, 3), dtype=np.uint8)
    rgb[..., 0] = (q >> 8).astype(np.uint8)
    rgb[..., 1] = (q & 0xFF).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB"), lo, hi


def main():
    for p in (WAC, LDEM):
        if not p.exists():
            sys.exit(f"missing {p.relative_to(ROOT)} - see data/phase-2/README.md")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    scale = 2.0 * HALF_M / TEX_N
    print(f"south polar cap: {TEX_N}x{TEX_N}, edge at {EDGE_LAT:g} deg "
          f"(+/-{HALF_M/1000:.0f} km), {scale:.0f} m/texel")

    print("  albedo  <- WAC South Summer mosaic (100 m)")
    alb = flatten_albedo(read_square(WAC, HALF_M, TEX_N, Resampling.average), scale)
    Image.fromarray(alb, mode="L").save(OUT_DIR / "pole_south_albedo.jpg", quality=90)

    print("  normal  <- LDEM 60S (240 m)")
    bake_normal(read_square(LDEM, HALF_M, TEX_N, Resampling.bilinear), scale).save(
        OUT_DIR / "pole_south_normal.jpg", quality=92)

    print("  height  <- LDEM 60S (240 m)")
    img, lo, hi = pack_height(read_square(LDEM, HALF_M, SHADOW_N, Resampling.bilinear))
    img.save(OUT_DIR / "pole_south_height.png", optimize=True)

    meta = {
        "half_m": HALF_M,
        "edge_lat": EDGE_LAT,
        "texel_m": scale,
        "shadow_texel_m": 2.0 * HALF_M / SHADOW_N,
        "height_min_m": lo,
        "height_max_m": hi,
        "moon_radius_m": R_M,
        "albedo_source": "NASA LROC WAC South Pole Summer Mosaic, 100 m, "
                         "illumination divided out (reflectance only)",
        "normal_source": "NASA LOLA LDEM 60S, 240 m, tangent-space normals",
        "height_source": "NASA LOLA LDEM 60S, 240 m, 16-bit packed into R/G",
    }
    old = OUT_DIR / "pole_south.json"
    if old.exists():   # keep what precompute_psr_mask.py added
        prev = json.loads(old.read_text())
        if "psr_source" in prev:
            meta["psr_source"] = prev["psr_source"]
    (OUT_DIR / "pole_south.json").write_text(json.dumps(meta, indent=2) + "\n")

    for name in ("pole_south_albedo.jpg", "pole_south_normal.jpg",
                 "pole_south_height.png"):
        kb = (OUT_DIR / name).stat().st_size // 1024
        print(f"  {name:26s} {kb:6d} KB")
    print(f"  elevation range {lo:.0f} .. {hi:.0f} m")
    print(f"\n-> {OUT_DIR.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
