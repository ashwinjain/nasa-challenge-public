"""Two relay satellites in an elliptical frozen orbit (ELFO) and when a site can use them.

Earth sits within a few degrees of the horizon at the south pole, so crater
rims and massifs hide it for days at a time (up to ~10 days at some
candidate sites). A relay in lunar orbit fills those blackouts: the site
talks to the relay, the relay talks to Earth.

The orbit is ESA's Lunar Pathfinder ELFO: low point (periselene) over the
north pole, high point (aposelene) over the south, so the relay moves slowly
over the south pole and spends most of each ~10.8 h orbit above it. The
orbit is much shorter than a blackout, so where the relay starts in its
orbit hardly matters: every blackout gets many passes. What one relay
leaves is a gap of a few hours each orbit while it swings round the north
side, so we fly two in the same orbit, half an orbit apart (:data:`RELAYS`):
while one is low over the north pole, the other is high over the south.
One relay already turns ~10-day blackouts into ~3-hour gaps; the second
closes most of those.

A site can use a relay when it is above the site's skyline (the same
terrain skyline used for the Sun and Earth) and it can see Earth (the Moon
isn't in the way).

Model and its limits:

- Two-body motion: the ellipse is fixed relative to the stars. The real
  orbit drifts slowly under Earth's pull and the Moon's uneven gravity
  (that's what "frozen" orbit design keeps in check), so long-run phasing
  is approximate. Coverage *patterns* (pass length, gap length) are not
  sensitive to that.
- Orbit phase (``ELFO.epoch``) is our own choice; the real one won't be known
  until after launch.
- The relay is a point; no antenna pointing limits or link budget.

Adapted from ``astra-compute/world_sim/lunar_orbit.py`` (decision 002).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone

import numpy as np

from .kernels import MOON_RADIUS_KM, Kernels
from .metrics import true_runs

MU_MOON = 4902.800   # km^3/s^2, the Moon's gravitational parameter
# The Moon's north pole on the ICRF sky (IAU mean values, without the small wobble terms)
POLE_RA, POLE_DEC = math.radians(269.9949), math.radians(66.5392)

# Hourly flags are built from finer samples: an hour counts as covered by the
# relay when it's usable for at least half of that hour.
SUBSTEPS = 6


def _rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def _rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def _moon_equator_to_icrf():
    """Columns: the Moon's equatorial axes in ICRF (x on the node, z the Moon's north pole)."""
    z = np.array([math.cos(POLE_DEC) * math.cos(POLE_RA),
                  math.cos(POLE_DEC) * math.sin(POLE_RA),
                  math.sin(POLE_DEC)])
    x = np.array([-math.sin(POLE_RA), math.cos(POLE_RA), 0.0])
    return np.column_stack([x, np.cross(z, x), z])


MOON_TO_ICRF = _moon_equator_to_icrf()


@dataclass(frozen=True)
class Elements:
    """The orbit's shape and orientation; angles are relative to the Moon's equator."""
    periselene_alt_km: float
    aposelene_alt_km: float
    inclination_deg: float
    raan_deg: float            # where the orbit crosses the equator going north
    arg_periselene_deg: float  # how far round the orbit periselene lies from that crossing
    epoch: datetime            # a moment when the relay is at periselene

    @property
    def a(self) -> float:
        return MOON_RADIUS_KM + (self.periselene_alt_km + self.aposelene_alt_km) / 2

    @property
    def e(self) -> float:
        rp = MOON_RADIUS_KM + self.periselene_alt_km
        ra = MOON_RADIUS_KM + self.aposelene_alt_km
        return (ra - rp) / (ra + rp)

    @property
    def period_s(self) -> float:
        return 2 * math.pi * math.sqrt(self.a ** 3 / MU_MOON)


# ESA's Lunar Pathfinder (SSTL Lunar Pathfinder Service Guide V004, section 3.4):
# a = 5740 km, e = 0.58, i = 54.856°, RAAN = 0, argument of pericentre = 86.322°.
# SSTL calls these indicative. The epoch (orbit phase) is our own choice.
ELFO = Elements(673, 7331, 54.856, 0.0, 86.322, epoch=datetime(2026, 11, 1, tzinfo=timezone.utc))

# The pair we assume: the same orbit, the second half an orbit behind.
RELAYS = (ELFO, replace(ELFO, epoch=ELFO.epoch + timedelta(seconds=ELFO.period_s / 2)))


def _eccentric_anomaly(M: np.ndarray, e: float) -> np.ndarray:
    """Solve Kepler's equation M = E - e sin E for E (vectorised Newton)."""
    E = np.where(e < 0.8, M, np.pi)
    for _ in range(30):
        step = (E - e * np.sin(E) - M) / (1 - e * np.cos(E))
        E = E - step
        if np.max(np.abs(step)) < 1e-12:
            break
    return E


def relay_icrf(el: Elements, seconds_since_epoch: np.ndarray) -> np.ndarray:
    """Relay position (N, 3) in km from the Moon's centre, on ICRF axes."""
    M = (2 * np.pi * np.asarray(seconds_since_epoch, float) / el.period_s) % (2 * np.pi)
    E = _eccentric_anomaly(M, el.e)
    flat = np.stack([el.a * (np.cos(E) - el.e),
                     el.a * math.sqrt(1 - el.e ** 2) * np.sin(E),
                     np.zeros_like(E)], axis=1)
    rot = (MOON_TO_ICRF @ _rot_z(math.radians(el.raan_deg))
           @ _rot_x(math.radians(el.inclination_deg))
           @ _rot_z(math.radians(el.arg_periselene_deg)))
    return flat @ rot.T


@dataclass
class RelayTrack:
    """The relay and Earth in the Moon's body-fixed frame (MOON_ME), at fine time steps.

    The same for every site, so build it once per span with :func:`relay_track`
    and reuse it for each site with :func:`relay_usable`.
    """
    relay_me: np.ndarray       # (N, 3) km, Moon-centred, MOON_ME axes
    sees_earth: np.ndarray     # (N,) bool: the Moon isn't between the relay and Earth
    samples: int               # hourly samples these fine steps cover
    substeps: int


def relay_track(k: Kernels, start: datetime, days: float, step_hours: float = 1.0,
                el: Elements = ELFO, substeps: int = SUBSTEPS) -> RelayTrack:
    """Relay positions over the span, ``substeps`` per hourly sample, centred on each hour.

    Hourly samples line up with :func:`lunarsky.sky_track` for the same
    ``start``, ``days`` and ``step_hours``.
    """
    start = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    n = int(round(days * 24.0 / step_hours)) + 1
    # Sub-samples spread evenly across each hour, centred on it.
    offs = (np.arange(substeps) + 0.5) / substeps - 0.5
    hours = (np.arange(n)[:, None] + offs[None, :]).ravel() * step_hours
    hour0 = start.hour + start.minute / 60.0 + start.second / 3600.0
    t = k.ts.utc(start.year, start.month, start.day, hour0 + hours)

    secs = (start - el.epoch).total_seconds() + hours * 3600.0
    relay = relay_icrf(el, secs)
    earth = (k.earth - k.moon).at(t).position.km.T          # Moon-centred ICRF

    # Relay → Earth blocked when the line passes within one Moon radius of the centre.
    d = earth - relay
    dn = d / np.linalg.norm(d, axis=1)[:, None]
    along = -np.einsum("ij,ij->i", relay, dn)
    closest = np.linalg.norm(relay + along[:, None] * dn, axis=1)
    sees_earth = ~((along > 0) & (closest < MOON_RADIUS_KM))

    R = k.frame.rotation_at(t)                               # (3, 3, N): ICRF → MOON_ME
    relay_me = np.einsum("ijn,nj->ni", R, relay)
    return RelayTrack(relay_me=relay_me, sees_earth=sees_earth, samples=n, substeps=substeps)


def relay_az_el(track: RelayTrack, lat_deg: float, lon_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Relay azimuth (0 = north, 90 = east) and elevation in degrees, seen from a site."""
    la, lo = math.radians(lat_deg), math.radians(lon_deg)
    up = np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])
    east = np.array([-math.sin(lo), math.cos(lo), 0.0])
    north = np.cross(up, east)
    los = track.relay_me - MOON_RADIUS_KM * up
    e, nn, u = los @ east, los @ north, los @ up
    az = np.degrees(np.arctan2(e, nn)) % 360.0
    elev = np.degrees(np.arctan2(u, np.hypot(e, nn)))
    return az, elev


def relay_tracks(k: Kernels, start: datetime, days: float, step_hours: float = 1.0,
                 relays=RELAYS, substeps: int = SUBSTEPS) -> list[RelayTrack]:
    """:func:`relay_track` for each relay in ``relays`` (default: the pair)."""
    return [relay_track(k, start, days, step_hours, el, substeps) for el in relays]


def relay_usable(tracks, lat_deg: float, lon_deg: float,
                 skyline=None, height_m: float | None = None) -> np.ndarray:
    """Hourly bool: can the site reach a relay for at least half of that hour?

    ``tracks`` is one :class:`RelayTrack` or a list (one per relay). Usable =
    some relay above the horizon (the terrain skyline at its azimuth for
    ``height_m``, else the smooth 0° horizon) that also sees Earth.
    """
    tracks = [tracks] if isinstance(tracks, RelayTrack) else list(tracks)
    ok = np.zeros(tracks[0].samples * tracks[0].substeps, dtype=bool)
    for track in tracks:
        az, elev = relay_az_el(track, lat_deg, lon_deg)
        hz = 0.0 if skyline is None else skyline.horizon_at(az, height_m)
        ok |= (elev > hz) & track.sees_earth
    t0 = tracks[0]
    return ok.reshape(t0.samples, t0.substeps).mean(axis=1) >= 0.5


def relay_runs(tracks, lat_deg: float, lon_deg: float,
               skyline=None, height_m: float | None = None) -> list[list[int]]:
    """:func:`relay_usable` as ``[[start, stop), ...]`` runs of hourly samples."""
    return [[a, b] for a, b in true_runs(relay_usable(tracks, lat_deg, lon_deg, skyline, height_m))]
