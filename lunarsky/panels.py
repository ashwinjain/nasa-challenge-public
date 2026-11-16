"""Where to put solar panels near a landing spot.

The lander sets down at one point; the panels go somewhere within walking
distance. This searches a ring around the landing spot (100–300 m by
default), computes the real skyline at each candidate spot, and runs the
same Sun track against each one.

One Sun track serves every candidate: 300 m is nothing next to the
distance to the Sun or Earth, so both sit in the same directions from all
of them. Only the skylines differ.

Two picks always come back:

- ``most_sunlight``: the highest sunlit fraction.
- ``shortest_night``: the shortest longest-dark stretch (sets battery size).

With ``size_for`` (a mission profile from ``lunarsky.power``), every spot
that passes the slope and path checks is also sized for that mission, array
plus battery, and a third pick comes back:

- ``lightest_kit``: the lowest array + battery mass (``kit_kg``).

That pick can be neither of the other two. The battery is set by the
deepest the store is ever drawn down, which counts back-to-back nights with
short sunny gaps between them, not just the single longest night; and the
array by the energy actually caught (Sun elevation and distance), not hours
of light. So a spot a little worse on both summary numbers can still need
the lighter kit. Sizing is cheap next to the skylines (~10 ms a spot).

Every 20 m grid point in the ring is scored (~640 skylines, ~40 s). A
coarse 40 m pass refined around the leaders was tried and rejected: the
longest dark stretch jumps from spot to spot (one ridge can split or merge
a night), and at Mons Mouton it missed a spot with a 166 h night, landing
on 224 h instead.

Spots steeper than ``max_slope_deg`` (20°, NASA's slope limit for
astronauts on foot) are left out of the picks but kept in ``candidates``
with ``too_steep: true``. Slope is measured across 40 m of the 20 m map, so
it's smoother than the ground a boot sees. Earth visibility is reported for
each spot but isn't used to rank them.

Quick start::

    from datetime import datetime, timezone
    from lunarsky import load_kernels
    from lunarsky.panels import find_panel_site

    k = load_kernels()
    res = find_panel_site(k, -86.00114, 2.05502, datetime(2026, 1, 1, tzinfo=timezone.utc))
    res["picks"]["most_sunlight"]
"""

from __future__ import annotations

import math
from datetime import datetime

import numpy as np

from .metrics import longest_run_hours
from .power import ANTENNA_HEIGHT_M, PANEL_HEIGHT_M, REACH_M, earth_contact, mission_profile, size_on_track
from .sky import DARK_BELOW, SkyTrack, sky_track
from .terrain import (
    DEFAULT_FINE_KM,
    R_M,
    Dems,
    _local_axes,
    compute_skyline,
    latlon_to_map,
    load_dems,
)

MIN_M = 100.0          # stand-off from the lander (its shadow, a work zone)
MAX_M = REACH_M        # 300 m: on-foot reach for carrying and cabling panels
SPACING_M = 20.0       # one pixel of the 20 m map
MAX_SLOPE_DEG = 20.0   # NASA's EVA slope limit
DAYS = 365.0
SLOPE_HALF_M = 20.0    # slope from heights 20 m either side


def _offset(lat: float, lon: float, east_m, north_m) -> tuple[np.ndarray, np.ndarray]:
    """Lat/lon of points ``east_m``, ``north_m`` from a site, along the sphere."""
    east_m, north_m = np.asarray(east_m, float), np.asarray(north_m, float)
    up, north, east = _local_axes(lat, lon)
    d = np.hypot(east_m, north_m)
    theta = d / R_M
    with np.errstate(invalid="ignore", divide="ignore"):
        ce = np.where(d > 0, east_m / d, 0.0)
        cn = np.where(d > 0, north_m / d, 0.0)
    p = (np.cos(theta)[..., None] * up
         + np.sin(theta)[..., None] * (cn[..., None] * north + ce[..., None] * east))
    return np.degrees(np.arcsin(np.clip(p[..., 2], -1, 1))), np.degrees(np.arctan2(p[..., 1], p[..., 0]))


def ring_offsets(min_m: float = MIN_M, max_m: float = MAX_M, spacing_m: float = SPACING_M):
    """East/north offsets (meters) of a square grid, kept where min_m ≤ distance ≤ max_m."""
    n = int(math.floor(max_m / spacing_m))
    g = np.arange(-n, n + 1) * spacing_m
    e, nn = np.meshgrid(g, g)
    d = np.hypot(e, nn)
    keep = (d >= min_m) & (d <= max_m)
    return e[keep], nn[keep]


def slope_deg(dems: Dems, lat: float, lon: float, half_m: float = SLOPE_HALF_M) -> float:
    """Ground slope at a point, from heights ``half_m`` east, west, north and south."""
    la, lo = _offset(lat, lon, [half_m, -half_m, 0, 0], [0, 0, half_m, -half_m])
    x, y = latlon_to_map(la, lo)
    h = dems.sample(x, y)
    if not np.all(np.isfinite(h)):
        return float("nan")
    de = (h[0] - h[1]) / (2 * half_m)
    dn = (h[2] - h[3]) / (2 * half_m)
    return float(np.degrees(np.arctan(np.hypot(de, dn))))


def _score(track: SkyTrack, sky, height_m: float, rule: str) -> dict:
    sun_hz, earth_hz = track.horizons(0.0, sky, height_m)
    share = track.sun_share(sun_hz)          # Sun: by how much of the disk shows
    seen = track.earth_margin_deg(earth_hz, rule) > 0.0
    return {
        "sunlit_fraction": round(float(share.mean()), 4),
        "longest_dark_hours": longest_run_hours(share < DARK_BELOW, track.step_hours),
        "earth_visible_fraction": round(float(seen.mean()), 4),
    }


def _most_key(c):           # more sunlight first, then the shorter night
    return (c["sunlit_fraction"], -c["longest_dark_hours"])


def _night_key(c):          # shorter night first, then more sunlight
    return (c["longest_dark_hours"], -c["sunlit_fraction"])


def _kit_key(c):            # lighter kit first, then the shorter night
    return (c["kit_kg"], c["longest_dark_hours"])


def _kit(track, sky, height_m: float, prof: dict | None, step_hours: float, contact=None) -> dict:
    """``kit_kg`` (array + battery) and its split for ``prof``; empty without a profile."""
    if prof is None:
        return {}
    r = size_on_track(track, sky.horizon_at(track.sun_az, height_m), prof, step_hours, contact=contact)
    if not r.get("feasible"):
        return {"kit_kg": None}
    b = r["best"]
    return {"kit_kg": b["total_kg"], "array_kg": b["array_kg"], "battery_kg": b["battery_kg"],
            "battery_kwh": b["battery_kwh"], "array_m2": b["array_m2"]}


def find_panel_site(k, lat: float, lon: float, start: datetime, days: float = DAYS,
                    height_m: float = PANEL_HEIGHT_M, min_m: float = MIN_M, max_m: float = MAX_M,
                    spacing_m: float = SPACING_M, max_slope_deg: float = MAX_SLOPE_DEG,
                    rule: str = "any", step_hours: float = 1.0, dems: Dems | None = None,
                    check_path: bool = False, size_for: str | None = None,
                    part: int = 0, parts: int = 1) -> dict:
    """Search the ring around a landing spot for the best panel sites.

    With ``check_path``, a spot is also left out of the picks (``path_blocked:
    true``) if the straight walk from the landing spot to it crosses ground
    steeper than ``max_slope_deg``, sampled every ``spacing_m`` (Phase 6).

    With ``size_for`` (a mission id such as ``"crew"``), the landing spot
    and every walkable candidate get ``kit_kg`` (array + battery for that
    mission over this window, at ``height_m``) and ``picks`` gains
    ``lightest_kit``. The mission's stay is set to ``days`` so the sizing
    matches the Sun track.

    With ``parts`` > 1, only every ``parts``-th ring spot from ``part`` on is
    scored, so the search can run as ``parts`` jobs side by side (the API's
    queue does this); ``merge_panel_parts`` joins them into the full answer.

    Raises ``ValueError`` if there's no terrain data at the landing spot.
    Returns a JSON-ready dict: ``landing``, ``picks``, ``candidates`` and
    ``settings``.
    """
    if not 0 <= min_m < max_m:
        raise ValueError("need 0 ≤ min_m < max_m")
    if not 0 <= part < parts:
        raise ValueError("need 0 ≤ part < parts")
    dems = dems or load_dems()
    # Read the 20 m window once for the whole search, wide enough for every candidate.
    x, y = latlon_to_map(lat, lon)
    near = dems.with_fine_window(float(x), float(y), DEFAULT_FINE_KM + max_m / 1000.0)

    track = sky_track(k, lat, lon, start, days, step_hours)
    heights = (float(height_m),)
    prof = None
    if size_for is not None:
        prof = {**mission_profile(size_for), "days": float(days)}

    land_sky = compute_skyline(lat, lon, heights_m=heights, dems=near, fine_km=0)
    # When the radio transmits: Earth contact from the landing spot's antenna.
    # Earth's direction barely changes over a few hundred metres, so every
    # candidate uses this one.
    contact = None
    if prof is not None:
        ant_sky = compute_skyline(lat, lon, heights_m=(ANTENNA_HEIGHT_M,), dems=near, fine_km=0)
        contact = earth_contact(k, track, ant_sky, start, days, step_hours)
    landing = {"lat": float(lat), "lon": float(lon), "ground_m": round(land_sky.ground_m, 1),
               "slope_deg": round(slope_deg(near, lat, lon), 1),
               **_score(track, land_sky, height_m, rule),
               **_kit(track, land_sky, height_m, prof, step_hours, contact)}

    def evaluate(e: float, n: float) -> dict | None:
        la, lo = (float(v) for v in _offset(lat, lon, e, n))
        try:
            sky = compute_skyline(la, lo, heights_m=heights, dems=near, fine_km=0)
        except ValueError:
            return None             # off the maps
        s = slope_deg(near, la, lo)
        blocked = False
        if check_path:
            d = math.hypot(e, n)
            for t in np.arange(spacing_m, d, spacing_m) / d:      # landing → spot, ends excluded
                pla, plo = (float(v) for v in _offset(lat, lon, e * t, n * t))
                ps = slope_deg(near, pla, plo)
                if not np.isfinite(ps) or ps > max_slope_deg:
                    blocked = True
                    break
        walkable = np.isfinite(s) and s <= max_slope_deg and not blocked
        return {
            "lat": round(la, 6), "lon": round(lo, 6), "east_m": float(e), "north_m": float(n),
            "distance_m": round(float(math.hypot(e, n)), 1),
            "bearing_deg": round(math.degrees(math.atan2(e, n)) % 360.0, 1),
            "ground_m": round(sky.ground_m, 1),
            "slope_deg": round(s, 1),
            "too_steep": bool(not np.isfinite(s) or s > max_slope_deg),
            "path_blocked": blocked,
            **_score(track, sky, height_m, rule),
            # Only walkable spots are sized: the rest can't be picked anyway.
            **(_kit(track, sky, height_m, prof, step_hours, contact) if walkable else {}),
        }

    ring = list(zip(*ring_offsets(min_m, max_m, spacing_m)))[part::parts]
    scored = (evaluate(float(e), float(n)) for e, n in ring)
    candidates = [c for c in scored if c is not None]

    iso = track.utc_iso()
    settings = {
        "height_m": float(height_m), "min_m": float(min_m), "max_m": float(max_m),
        "spacing_m": float(spacing_m), "max_slope_deg": float(max_slope_deg),
        "disk_rule": rule, "start_utc": iso[0], "end_utc": iso[-1],
        "step_hours": float(step_hours), "source": land_sky.source, "size_for": size_for,
        "check_path": bool(check_path),
    }
    out = _finish(landing, candidates, settings)
    if parts > 1:
        out["settings"].update(part=part, parts=parts)
    return out


def merge_panel_parts(results: list[dict]) -> dict:
    """Join the ``part``/``parts`` slices of one panel search into the full answer.

    The same as one ``find_panel_site`` call over the whole ring: the
    candidates go back into ring order, so ties pick the same spot.
    """
    if not results:
        raise ValueError("no parts to merge")
    parts = results[0]["settings"].get("parts", 1)
    got = sorted(r["settings"].get("part", 0) for r in results)
    if got != list(range(parts)):
        raise ValueError(f"need parts 0–{parts - 1} once each, got {got}")
    candidates = [c for r in results for c in r["candidates"]]
    candidates.sort(key=lambda c: (c["north_m"], c["east_m"]))   # ring_offsets order
    settings = {k: v for k, v in results[0]["settings"].items()
                if k not in ("part", "parts", "count", "too_steep", "path_blocked")}
    return _finish(results[0]["landing"], candidates, settings)


def _finish(landing: dict, candidates: list[dict], settings: dict) -> dict:
    """The picks and counts for a set of scored candidates."""
    ok = [c for c in candidates if not c["too_steep"] and not c["path_blocked"]]

    def pick(c):
        if c is None:
            return None
        out = {**c,
               "sunlit_gain_points": round((c["sunlit_fraction"] - landing["sunlit_fraction"]) * 100, 1),
               "dark_hours_saved": round(landing["longest_dark_hours"] - c["longest_dark_hours"], 1)}
        if c.get("kit_kg") is not None and landing.get("kit_kg") is not None:
            out["kit_kg_saved"] = round(landing["kit_kg"] - c["kit_kg"], 1)
        return out

    most = max(ok, key=_most_key, default=None)
    night = min(ok, key=_night_key, default=None)
    picks = {"most_sunlight": pick(most), "shortest_night": pick(night)}
    if settings["size_for"] is not None:
        sized = [c for c in ok if c.get("kit_kg") is not None]
        picks["lightest_kit"] = pick(min(sized, key=_kit_key, default=None))

    return {
        "landing": landing,
        "picks": picks,
        "candidates": candidates,
        "settings": {
            **settings,
            "count": len(candidates),
            "too_steep": sum(c["too_steep"] for c in candidates),
            "path_blocked": sum(c["path_blocked"] and not c["too_steep"] for c in candidates),
        },
    }
