"""Where the Sun and Earth are in a site's sky, sampled over a date range.

Elevations are geometric (no atmosphere, so no refraction) and measured
from the local horizontal plane. By default the horizon is the smooth-Moon
horizon, one elevation for every direction. Pass a terrain ``Skyline``
(see :mod:`lunarsky.terrain`) to use the real skyline instead: each sample
then gets the skyline's elevation at the Sun's or Earth's own azimuth.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

from .kernels import MAX_YEAR, MIN_YEAR, Kernels, site_observer

SUN_RADIUS_KM = 695_700.0
EARTH_RADIUS_KM = 6_371.0

# What "above the horizon" means for a disk ~0.5° (Sun) or ~1.9° (Earth) wide.
#   any     any part of the disk is up    (upper limb above the horizon)
#   center  the disk's center is up
#   full    the whole disk is up          (lower limb above the horizon)
# NASA's Mazarico et al. 2011 Earth-visibility maps use "any".
DISK_RULES = ("any", "center", "full")


# The Sun counts by how much of its disk is above the skyline: sunlit % is
# the average share, and an hour is "dark" when less than half shows (the
# disk center is below the skyline). Earth stays in view / not in view.
DARK_BELOW = 0.5


def disk_fraction(el_deg, radius_deg, horizon_deg) -> np.ndarray:
    """Share of a disk's area above a horizontal line at ``horizon_deg`` (0–1)."""
    u = np.clip((np.asarray(el_deg) - horizon_deg) / radius_deg, -1.0, 1.0)
    return 1.0 - (np.arccos(u) - u * np.sqrt(1.0 - u * u)) / np.pi


def disk_margin_deg(el_deg, radius_deg, horizon_deg: float = 0.0, rule: str = "any"):
    """Degrees by which the body clears the horizon under ``rule``. Positive = up."""
    if rule == "any":
        return el_deg + radius_deg - horizon_deg
    if rule == "center":
        return el_deg - horizon_deg
    if rule == "full":
        return el_deg - radius_deg - horizon_deg
    raise ValueError(f"rule must be one of {DISK_RULES}, not {rule!r}")


@dataclass
class SkyTrack:
    """Sun and Earth azimuth/elevation at one site over a series of times."""

    lat: float
    lon: float
    height_m: float
    times: object            # skyfield Time array
    step_hours: float
    sun_az: np.ndarray       # degrees, 0 = north, 90 = east
    sun_el: np.ndarray       # degrees above horizontal, disk center
    sun_dist_km: np.ndarray
    earth_az: np.ndarray
    earth_el: np.ndarray
    earth_dist_km: np.ndarray

    def __len__(self) -> int:
        return len(self.sun_el)

    @property
    def hours(self) -> np.ndarray:
        """Hours since the start of the window, one per sample."""
        return np.arange(len(self)) * self.step_hours

    @property
    def sun_radius_deg(self) -> np.ndarray:
        return np.degrees(np.arcsin(SUN_RADIUS_KM / self.sun_dist_km))

    @property
    def earth_radius_deg(self) -> np.ndarray:
        return np.degrees(np.arcsin(EARTH_RADIUS_KM / self.earth_dist_km))

    def utc_iso(self) -> list[str]:
        return list(self.times.utc_iso(places=0))

    def horizons(self, horizon_deg=0.0, skyline=None, height_m: float | None = None):
        """Horizon elevation under the Sun and under Earth, per sample.

        Without a skyline both are just ``horizon_deg``. With one, each is
        the skyline's elevation at that body's azimuth, for ``height_m``
        (default: this track's own observer height).
        """
        if skyline is None:
            return horizon_deg, horizon_deg
        if np.any(np.asarray(horizon_deg) != 0.0):
            raise ValueError("pass either horizon_deg or a skyline, not both")
        h = self.height_m if height_m is None else float(height_m)
        return skyline.horizon_at(self.sun_az, h), skyline.horizon_at(self.earth_az, h)

    def sun_margin_deg(self, horizon_deg: float = 0.0, rule: str = "any") -> np.ndarray:
        return disk_margin_deg(self.sun_el, self.sun_radius_deg, horizon_deg, rule)

    def earth_margin_deg(self, horizon_deg: float = 0.0, rule: str = "any") -> np.ndarray:
        return disk_margin_deg(self.earth_el, self.earth_radius_deg, horizon_deg, rule)

    def sun_share(self, horizon_deg=0.0) -> np.ndarray:
        """Share of the Sun's disk above the horizon per sample (0–1)."""
        return disk_fraction(self.sun_el, self.sun_radius_deg, horizon_deg)

    def sunlit(self, horizon_deg: float = 0.0, rule: str = "any") -> np.ndarray:
        """Boolean per sample: is the site in sunlight?"""
        return self.sun_margin_deg(horizon_deg, rule) > 0.0

    def earth_visible(self, horizon_deg: float = 0.0, rule: str = "any") -> np.ndarray:
        """Boolean per sample: can the site see Earth (line of sight for comms)?"""
        return self.earth_margin_deg(horizon_deg, rule) > 0.0

    def to_dict(self, horizon_deg: float = 0.0, rule: str = "any", ndigits: int = 3,
                skyline=None, height_m: float | None = None) -> dict:
        """JSON-friendly payload for a web page: parallel lists, one entry per sample.

        With ``skyline``, ``sunlit`` and ``earth_visible`` use the terrain.
        """
        r = lambda a: [round(float(x), ndigits) for x in a]
        sun_hz, earth_hz = self.horizons(horizon_deg, skyline, height_m)
        return {
            "lat": self.lat,
            "lon": self.lon,
            "height_m": self.height_m,
            "step_hours": self.step_hours,
            "times_utc": self.utc_iso(),
            "sun_az": r(self.sun_az),
            "sun_el": r(self.sun_el),
            "earth_az": r(self.earth_az),
            "earth_el": r(self.earth_el),
            "sunlit": [bool(b) for b in self.sunlit(sun_hz, rule)],
            "earth_visible": [bool(b) for b in self.earth_visible(earth_hz, rule)],
        }


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def sky_track(
    k: Kernels,
    lat_deg: float,
    lon_deg: float,
    start: datetime,
    days: float,
    step_hours: float = 1.0,
    height_m: float = 0.0,
) -> SkyTrack:
    """Sun and Earth positions from a site, every ``step_hours`` for ``days``.

    ``start`` is UTC (naive datetimes are taken as UTC). The window includes
    both endpoints, so 30 days at 1-hour steps gives 721 samples.
    """
    if days <= 0:
        raise ValueError("days must be positive")
    if step_hours <= 0:
        raise ValueError("step_hours must be positive")

    start = _as_utc(start)
    n = int(round(days * 24.0 / step_hours)) + 1
    end = start + timedelta(hours=(n - 1) * step_hours)
    for edge in (start, end):
        if not MIN_YEAR <= edge.year < MAX_YEAR:
            raise ValueError(
                f"{edge.isoformat()} is outside the Moon orientation kernel's range "
                f"({MIN_YEAR}-01-01 to {MAX_YEAR}-01-01)"
            )

    hour0 = start.hour + start.minute / 60.0 + (start.second + start.microsecond / 1e6) / 3600.0
    t = k.ts.utc(start.year, start.month, start.day, hour0 + np.arange(n) * step_hours)

    here = site_observer(k, lat_deg, lon_deg, height_m).at(t)
    sun_alt, sun_az, sun_d = here.observe(k.sun).apparent().altaz()
    earth_alt, earth_az, earth_d = here.observe(k.earth).apparent().altaz()

    return SkyTrack(
        lat=float(lat_deg),
        lon=float(lon_deg),
        height_m=float(height_m),
        times=t,
        step_hours=float(step_hours),
        sun_az=np.atleast_1d(sun_az.degrees),
        sun_el=np.atleast_1d(sun_alt.degrees),
        sun_dist_km=np.atleast_1d(sun_d.km),
        earth_az=np.atleast_1d(earth_az.degrees),
        earth_el=np.atleast_1d(earth_alt.degrees),
        earth_dist_km=np.atleast_1d(earth_d.km),
    )
