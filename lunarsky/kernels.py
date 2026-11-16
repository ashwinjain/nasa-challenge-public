"""Load the Phase 1 SPICE kernels and build an observer on the lunar surface.

The four files live in ``data/phase-1`` (see ``data/phase-1/README.md``):

    de421.bsp                    where the Sun, Earth and Moon are
    moon_pa_de421_1900-2050.bpc  which way the Moon is facing (incl. libration)
    moon_080317.tf               defines the MOON_PA and MOON_ME frames
    pck00008.tpc                 the Moon's radius

Sites are given in the mean-Earth/polar-axis frame (MOON_ME), which is what
LOLA maps, Quickmap, the Phase 3 site list and JPL Horizons all use.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from math import acos, degrees
from pathlib import Path

from skyfield.api import Loader, PlanetaryConstants

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = Path(os.environ.get("LUNAR_DATA_DIR", REPO_ROOT / "data"))

KERNEL_SUBDIR = "phase-1"
KERNEL_FILES = (
    "de421.bsp",
    "moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf",
    "pck00008.tpc",
)
FRAME_NAME = "MOON_ME_DE421"

# The orientation kernel covers 1900-01-01 to 2050-01-01. Stay inside it.
MIN_YEAR = 1900
MAX_YEAR = 2050  # exclusive

MOON_RADIUS_KM = 1737.4

NAIF = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels"
KERNEL_URLS = {
    "de421.bsp": f"{NAIF}/spk/planets/a_old_versions/de421.bsp",
    "moon_pa_de421_1900-2050.bpc": f"{NAIF}/pck/moon_pa_de421_1900-2050.bpc",
    "moon_080317.tf": f"{NAIF}/fk/satellites/moon_080317.tf",
    "pck00008.tpc": f"{NAIF}/pck/a_old_versions/pck00008.tpc",
}
DOWNLOAD_CMD = "cd data/phase-1 && curl " + " ".join(f"-O {u}" for u in KERNEL_URLS.values())


@dataclass
class Kernels:
    """Everything skyfield needs, loaded once. Build with :func:`load_kernels`."""

    ts: object            # skyfield Timescale
    eph: object           # skyfield SpiceKernel (DE421)
    pc: PlanetaryConstants
    frame: object         # the MOON_ME_DE421 frame
    kernel_dir: Path

    @property
    def moon(self):
        return self.eph["moon"]

    @property
    def sun(self):
        return self.eph["sun"]

    @property
    def earth(self):
        return self.eph["earth"]


def kernel_dir(data_dir: str | os.PathLike | None = None) -> Path:
    base = Path(data_dir) if data_dir is not None else DEFAULT_DATA_DIR
    return base / KERNEL_SUBDIR


def load_kernels(data_dir: str | os.PathLike | None = None) -> Kernels:
    """Load the four kernels from ``<data_dir>/phase-1``.

    ``data_dir`` defaults to the repo's ``data/`` folder, or to the
    ``LUNAR_DATA_DIR`` environment variable if set. Nothing is downloaded:
    if a file is missing you get a clear error with the download command.
    """
    kdir = kernel_dir(data_dir)
    missing = [name for name in KERNEL_FILES if not (kdir / name).is_file()]
    if missing:
        raise FileNotFoundError(
            f"Missing kernel file(s) in {kdir}: {', '.join(missing)}.\n"
            f"Download them with:\n  {DOWNLOAD_CMD}"
        )

    load = Loader(str(kdir), verbose=False)
    ts = load.timescale()  # built-in leap-second table; no download
    eph = load(KERNEL_FILES[0])

    pc = PlanetaryConstants()
    pc.read_text(load("moon_080317.tf"))
    pc.read_text(load("pck00008.tpc"))
    pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
    frame = pc.build_frame_named(FRAME_NAME)

    return Kernels(ts=ts, eph=eph, pc=pc, frame=frame, kernel_dir=kdir)


def site_observer(k: Kernels, lat_deg: float, lon_deg: float, height_m: float = 0.0):
    """A point on (or above) the lunar surface you can observe the sky from.

    ``lat_deg`` and ``lon_deg`` are degrees in the MOON_ME frame, longitude
    east-positive. ``height_m`` raises the observer above the sphere, for a
    panel or antenna mast. Returns a skyfield vector: call
    ``.at(t).observe(k.sun).apparent().altaz()`` on it.
    """
    if not -90.0 <= lat_deg <= 90.0:
        raise ValueError(f"latitude {lat_deg} out of range [-90, 90]")
    lon_deg = ((lon_deg + 180.0) % 360.0) - 180.0
    place = k.pc.build_latlon_degrees(k.frame, lat_deg, lon_deg, elevation_m=height_m)
    return k.moon + place


def horizon_dip_deg(height_m: float, radius_km: float = MOON_RADIUS_KM) -> float:
    """How far below horizontal the smooth-Moon horizon is from ``height_m`` up.

    Ground level: 0°. A 2 m panel: 0.09°. A 10 m mast: 0.19°. Small, but at
    the poles the Sun only ever reaches ~1.5°, so it is not nothing.
    """
    if height_m <= 0.0:
        return 0.0
    r = radius_km * 1000.0
    return degrees(acos(r / (r + height_m)))
