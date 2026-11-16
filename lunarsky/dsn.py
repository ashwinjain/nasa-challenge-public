"""When the Deep Space Network can talk to the lunar south pole.

Earth being above a site's skyline is half of a direct link. The other half
is a dish on Earth that has the Moon above its own horizon. NASA's Deep
Space Network has three complexes about 120° apart in longitude, so most of
the time at least one of them sees the Moon:

    Goldstone, California   35.4° N
    Madrid, Spain           40.4° N
    Canberra, Australia     35.4° S

A complex counts when the Moon's south pole is at least ``MIN_ELEVATION_DEG``
above its horizon. The gaps come when the Moon is far south in Earth's sky
(only Canberra sees it well) or far north (Canberra loses it), on a ~27-day
cycle.

This doesn't depend on which polar site you pick: every candidate site is
within ~200 km of the pole, which moves the Moon in a station's sky by
under 0.05°. So it's computed once per span and shared by every site.
Direct contact at a site = Earth above its skyline AND :func:`dsn_visible`.

Not modelled: DSN scheduling (other missions share the dishes), weather,
and each antenna's own pointing limits. All three only make contact rarer,
so this is the best case.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
from skyfield.api import wgs84

from .kernels import Kernels

# Below ~10° a dish looks through a lot of atmosphere and the ground
# nearby; DSN planning commonly uses 10° (navigator-plan.md, Phase 5).
MIN_ELEVATION_DEG = 10.0


@dataclass(frozen=True)
class Station:
    id: str
    name: str
    lat: float      # degrees, north-positive
    lon: float      # degrees, east-positive
    height_m: float


# One 70 m dish per complex (DSS-14, DSS-63, DSS-43); the others at each
# complex are within a few km, which makes no difference here.
STATIONS = (
    Station("goldstone", "Goldstone", 35.4259, -116.8895, 1002.0),
    Station("madrid", "Madrid", 40.4313, -4.2481, 865.0),
    Station("canberra", "Canberra", -35.4024, 148.9813, 689.0),
)


def _times(k: Kernels, start: datetime, days: float, step_hours: float):
    start = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    n = int(round(days * 24.0 / step_hours)) + 1
    hour0 = start.hour + start.minute / 60.0 + start.second / 3600.0
    return k.ts.utc(start.year, start.month, start.day, hour0 + np.arange(n) * step_hours)


def moon_elevation(k: Kernels, t, station: Station) -> np.ndarray:
    """Elevation (degrees) of the Moon's south pole above ``station``'s horizon."""
    pole = k.moon + k.pc.build_latlon_degrees(k.frame, -90.0, 0.0)
    here = k.earth + wgs84.latlon(station.lat, station.lon, elevation_m=station.height_m)
    alt, _, _ = here.at(t).observe(pole).apparent().altaz()
    return np.atleast_1d(alt.degrees)


def dsn_visible(k: Kernels, start: datetime, days: float, step_hours: float = 1.0,
                min_el: float = MIN_ELEVATION_DEG) -> dict[str, np.ndarray]:
    """Per sample, can each station see the Moon? ``{station_id: bool array, "any": ...}``.

    Samples line up with :func:`lunarsky.sky_track` for the same ``start``,
    ``days`` and ``step_hours``.
    """
    t = _times(k, start, days, step_hours)
    out = {s.id: moon_elevation(k, t, s) >= min_el for s in STATIONS}
    out["any"] = np.logical_or.reduce([out[s.id] for s in STATIONS])
    return out


def dsn_windows(k: Kernels, start: datetime, days: float, step_hours: float = 1.0,
                min_el: float = MIN_ELEVATION_DEG) -> dict:
    """JSON-ready runs of DSN coverage, in the same form as :mod:`lunarsky.windows`.

        {"start_utc", "end_utc", "step_hours", "samples", "min_elevation_deg",
         "stations": [{"id", "name", "lat", "lon"}, ...],
         "runs": {"goldstone": [[start, stop], ...], "madrid": ..., "canberra": ...,
                  "any": [...]}}
    """
    from .metrics import true_runs

    vis = dsn_visible(k, start, days, step_hours, min_el)
    n = len(vis["any"])
    start = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    iso = lambda dt: dt.isoformat().replace("+00:00", "Z")
    return {
        "start_utc": iso(start),
        "end_utc": iso(start + timedelta(hours=(n - 1) * step_hours)),
        "step_hours": float(step_hours),
        "samples": n,
        "min_elevation_deg": float(min_el),
        "stations": [{"id": s.id, "name": s.name, "lat": s.lat, "lon": s.lon} for s in STATIONS],
        "runs": {key: [[a, b] for a, b in true_runs(m)] for key, m in vis.items()},
    }
