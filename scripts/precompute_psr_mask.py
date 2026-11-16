"""Bake a permanently-shadowed-region (PSR) mask for the globe's south polar cap.

Input: data/phase-7/LPSR_80S_20MPP_ADJ_1km2.CSV, the 1,531 PSR outlines over
1 km^2 from NASA PGDA product 90 (Barker et al. 2023, LOLA 20 m). Outlines are
WKT in the same Moon sphere (R = 1737.4 km) south polar stereographic metres
(lat_0 = -90, lon_0 = 0) as the LDEM the cap was cut from, so no reprojection.

Output: frontend/public/textures/pole_south_psr.png, single-channel 8-bit,
on exactly the albedo/normal grid of scripts/precompute_polar_cap.py (TEX_N
square, +/- HALF_M, row 0 = +y, column 0 = -x). Each texel is the fraction of
it covered by PSR, from a SUPER x SUPER supersample, so 1 km^2 regions
(~3 texels across) survive as soft spots rather than dropping out.

Display only: water ice is info-only in this app and never enters a calculation.

Usage:
    .venv/bin/python scripts/precompute_psr_mask.py
"""
import csv
import json
import math
import sys
import warnings
from pathlib import Path

import numpy as np
import rasterio
import rasterio.errors
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely import wkt

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "frontend" / "public" / "textures"
CSV_PATH = ROOT / "data" / "phase-7" / "LPSR_80S_20MPP_ADJ_1km2.CSV"
META = OUT_DIR / "pole_south.json"

TEX_N = 3072   # must match precompute_polar_cap.TEX_N
SUPER = 4      # supersample factor for coverage


def main():
    if not CSV_PATH.exists():
        sys.exit(f"missing {CSV_PATH.relative_to(ROOT)} - see data/phase-7/README.md")
    meta = json.loads(META.read_text())
    half = float(meta["half_m"])
    texel = 2.0 * half / TEX_N
    if not math.isclose(texel, meta["texel_m"], rel_tol=1e-9):
        sys.exit("TEX_N does not match pole_south.json texel_m")

    csv.field_size_limit(sys.maxsize)
    shapes = []
    with CSV_PATH.open(newline="") as f:
        for row in csv.DictReader(f):
            shapes.append((wkt.loads(row["WKT"]), 1))
    print(f"{len(shapes)} PSR polygons")

    n = TEX_N * SUPER
    fine = rasterize(
        shapes, out_shape=(n, n), fill=0, dtype="uint8",
        transform=from_origin(-half, half, texel / SUPER, texel / SUPER),
    )
    cov = fine.reshape(TEX_N, SUPER, TEX_N, SUPER).mean(axis=(1, 3))
    mask = np.clip(np.rint(cov * 255.0), 0, 255).astype(np.uint8)
    print(f"covered: {np.count_nonzero(fine) * (texel / SUPER) ** 2 / 1e6:.0f} km^2")

    out = OUT_DIR / "pole_south_psr.png"
    warnings.filterwarnings("ignore", category=rasterio.errors.NotGeoreferencedWarning)
    with rasterio.open(out, "w", driver="PNG", width=TEX_N, height=TEX_N,
                       count=1, dtype="uint8", ZLEVEL=9) as dst:
        dst.write(mask, 1)
    for side in out.parent.glob(out.name + ".aux.xml"):
        side.unlink()

    meta["psr_source"] = ("NASA PGDA 90 (Barker et al. 2023) LOLA 20 m permanently "
                          "shadowed regions >= 1 km^2, LPSR_80S_20MPP_ADJ_1km2; "
                          "8-bit coverage fraction on the albedo grid")
    META.write_text(json.dumps(meta, indent=2) + "\n")
    print(f"-> {out.relative_to(ROOT)} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
