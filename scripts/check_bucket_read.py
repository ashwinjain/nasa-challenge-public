"""Prove the API can read the big maps from the Firebase Storage bucket.

Reads a small window around the south pole from each map, once from the
bucket and (when the file is on disk) once from data/, and checks the two
are identical. Only the tiles in the window are fetched, not the whole file.

    .venv/bin/python scripts/check_bucket_read.py
    .venv/bin/python scripts/check_bucket_read.py phase-6/LDEM_80S_20MPP_ADJ.TIF

Needs the maps extra (pip install -e ".[maps]") and a Google login that can
read the bucket (see lunarsky/data.py). Exit status 1 if any read fails or
the bucket and disk disagree.
"""

from __future__ import annotations

import sys
import time

import numpy as np

from lunarsky.data import locate, open_raster

DEFAULT_FILES = ["phase-2/LDEM_80S_80MPP_ADJ.TIF"]
WINDOW_PX = 100   # square window, centered on the pole (x = 0, y = 0 m)


def read_pole_window(name: str, source: str) -> tuple[np.ndarray, float, int, float]:
    """Pixels around the pole, the value at the pole, the image width, seconds taken."""
    from rasterio.windows import Window

    t0 = time.perf_counter()
    with open_raster(name, source=source) as src:
        row, col = src.index(0.0, 0.0)            # polar stereographic origin = the pole
        half = WINDOW_PX // 2
        win = Window(col - half, row - half, WINDOW_PX, WINDOW_PX)
        block = src.read(1, window=win)
        pole = float(src.read(1, window=Window(col, row, 1, 1))[0, 0])
        width = src.width
    return block, pole, width, time.perf_counter() - t0


def main(names: list[str]) -> int:
    ok = True
    for name in names:
        print(f"\n{name}")
        try:
            remote, pole, width, secs = read_pole_window(name, "bucket")
        except Exception as e:  # report and carry on with the next file
            print(f"  bucket: FAILED: {e}")
            ok = False
            continue
        print(f"  bucket: {locate(name, 'bucket').path}")
        print(f"          {WINDOW_PX}x{WINDOW_PX} window of a {width}-px-wide map in {secs:.2f} s; "
              f"value at the pole {pole:.1f}, range {np.nanmin(remote):.1f} to {np.nanmax(remote):.1f}")

        if not locate(name, "auto").in_bucket:
            local, local_pole, _, secs = read_pole_window(name, "local")
            same = np.array_equal(local, remote, equal_nan=True)
            print(f"  disk:   {secs:.2f} s; value at the pole {local_pole:.1f}; "
                  f"{'identical to the bucket' if same else 'DIFFERENT from the bucket'}")
            ok &= same
        else:
            print("  disk:   not downloaded, so no comparison")
    print("\nOK" if ok else "\nFAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or DEFAULT_FILES))
