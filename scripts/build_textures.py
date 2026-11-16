"""Build web-ready Moon textures from NASA source data.

Inputs (downloaded to a working dir, not committed):
  - lroc_color_poles_16k.tif   LROC WAC color mosaic, 16384x8192 (NASA CGI Moon Kit)
  - ldem_16.tif                LOLA displacement, 5760x2880 float (NASA CGI Moon Kit)

Outputs:
  - moon_color_16k.jpg / 8k / 4k   equirectangular color (sRGB)
  - moon_normal_4k.png / 2k        tangent-space normal map (linear)

The sizes the page loads go to frontend/public/textures/ and ship with every
build (scene3d.js starts on the 4k color and 2k normal maps and swaps in the
8k and 4k ones up close). The 16k color map goes to data/textures/, outside
the build.

Usage:
  .venv/bin/python scripts/build_textures.py <work_dir>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "textures"   # served: what scene3d.js loads
SPARE = ROOT / "data" / "textures"                 # sizes the page doesn't use, kept out of the build
NOT_SERVED = {"moon_color_16k.jpg"}


def out_path(name: str) -> Path:
    return (SPARE if name in NOT_SERVED else OUT) / name

# Normal-map strength. Higher = more pronounced relief lighting.
# The displacement is in LOLA elevation units; this scales the gradient.
NORMAL_STRENGTH = 2.2


def build_color(work: Path):
    src = Image.open(work / "lroc_color_poles_16k.tif").convert("RGB")
    print(f"Color source: {src.size}")
    for name, w in [("moon_color_16k.jpg", 16384), ("moon_color_8k.jpg", 8192), ("moon_color_4k.jpg", 4096)]:
        h = w // 2
        img = src if src.size == (w, h) else src.resize((w, h), Image.LANCZOS)
        out = out_path(name)
        img.save(out, "JPEG", quality=92, optimize=True, progressive=True)
        print(f"  ✓ {name}  ({w}x{h}, {out.stat().st_size // 1024} KB)")


def build_normal(work: Path):
    dem = Image.open(work / "ldem_16.tif")
    h = np.asarray(dem, dtype=np.float32)
    print(f"Displacement source: {dem.size} range [{h.min():.1f}, {h.max():.1f}]")

    H, W = h.shape
    # Latitude per row (equirectangular): +90 at top row to -90 at bottom.
    lat = np.deg2rad(90.0 - (np.arange(H) + 0.5) * 180.0 / H)
    coslat = np.clip(np.cos(lat), 0.15, 1.0)  # clamp near poles (polar cap DEM handles poles)

    # Gradients (wrap horizontally for the seam, clamp vertically).
    dzdx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5
    dzdy = np.empty_like(h)
    dzdy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    dzdy[0, :] = h[1, :] - h[0, :]
    dzdy[-1, :] = h[-1, :] - h[-2, :]

    # Equirectangular correction: horizontal spacing shrinks toward the poles,
    # so a given height change over one pixel is a steeper real slope.
    dzdx = dzdx / coslat[:, None]

    # Tangent-space normal: (-dz/dx, -dz/dy, 1) scaled by strength, normalized.
    nx = -dzdx * NORMAL_STRENGTH
    ny = dzdy * NORMAL_STRENGTH  # +Y up in normal map (green-up convention)
    nz = np.ones_like(h)
    length = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx, ny, nz = nx / length, ny / length, nz / length

    # Encode [-1,1] → [0,255]
    rgb = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
    rgb = (rgb * 255.0).clip(0, 255).astype(np.uint8)
    normal = Image.fromarray(rgb, "RGB")

    # Normal maps MUST be lossless PNG — JPEG compression corrupts the encoded
    # normals, which shows up as sparkle/shimmer at the terminator under grazing light.
    for name, w in [("moon_normal_4k.png", 4096), ("moon_normal_2k.png", 2048)]:
        hh = w // 2
        img = normal if normal.size == (w, hh) else normal.resize((w, hh), Image.LANCZOS)
        out = out_path(name)
        img.save(out, "PNG", optimize=True)
        print(f"  ✓ {name}  ({w}x{hh}, {out.stat().st_size // 1024} KB)")


def main():
    if len(sys.argv) < 2:
        print("Usage: build_textures.py <work_dir>")
        sys.exit(1)
    work = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)
    SPARE.mkdir(parents=True, exist_ok=True)
    print("Building color textures...")
    build_color(work)
    print("Building normal maps...")
    build_normal(work)
    print(f"\n✓ Textures written to {OUT.relative_to(ROOT)}/ and {SPARE.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
