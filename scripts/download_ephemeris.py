"""Make sure the Phase 1 SPICE kernels are present in data/phase-1.

They are committed to git, so normally this only confirms they load. If any
are missing, download them from NASA's NAIF server.
"""
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lunarsky.kernels import KERNEL_URLS, kernel_dir, load_kernels  # noqa: E402


def main():
    kdir = kernel_dir()
    kdir.mkdir(parents=True, exist_ok=True)
    for name, url in KERNEL_URLS.items():
        path = kdir / name
        if path.is_file() and path.stat().st_size > 1000:
            continue
        print(f"Downloading {name} from {url} ...", flush=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as out:
            while chunk := resp.read(1 << 20):
                out.write(chunk)
        tmp.replace(path)
    k = load_kernels()
    print(f"✓ Phase 1 kernels ready in {k.kernel_dir}")


if __name__ == "__main__":
    main()
