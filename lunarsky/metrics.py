"""Phase 1 metrics from a :class:`~lunarsky.sky.SkyTrack`.

Sunlit %, longest dark stretch, Earth-in-view %, longest blackout, and time
to the next sunset, sunrise, Earthset and Earthrise. Everything returned is
plain Python (floats, bools, None), so it serializes straight to JSON.

Run lengths are counted in whole samples, so they are accurate to about one
step. Rise/set times interpolate between samples, so they are better than
the step size.
"""

from __future__ import annotations

import numpy as np

from .sky import DARK_BELOW, SkyTrack
from .terrain import DEFAULT_EYE_M


def true_runs(mask) -> list[tuple[int, int]]:
    """Start and stop (exclusive) indices of each run of True in ``mask``."""
    m = np.asarray(mask, dtype=bool)
    if m.size == 0:
        return []
    padded = np.concatenate(([False], m, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [(int(edges[i]), int(edges[i + 1])) for i in range(0, len(edges), 2)]


def longest_run_hours(mask, step_hours: float) -> float:
    """Length in hours of the longest run of True. 0 if there is none."""
    runs = true_runs(mask)
    if not runs:
        return 0.0
    return float(max(stop - start for start, stop in runs) * step_hours)


def hours_to_crossing(margin, step_hours: float, direction: str) -> float | None:
    """Hours from the window start until ``margin`` first crosses zero.

    ``direction`` is ``"down"`` for a set (positive to non-positive) or
    ``"up"`` for a rise. Linear interpolation between the two samples around
    the crossing. ``None`` if it never happens inside the window.
    """
    m = np.asarray(margin, dtype=float)
    if m.size < 2:
        return None
    if direction == "down":
        idx = np.flatnonzero((m[:-1] > 0.0) & (m[1:] <= 0.0))
    elif direction == "up":
        idx = np.flatnonzero((m[:-1] <= 0.0) & (m[1:] > 0.0))
    else:
        raise ValueError("direction must be 'down' or 'up'")
    if idx.size == 0:
        return None
    i = int(idx[0])
    frac = m[i] / (m[i] - m[i + 1])
    return float((i + frac) * step_hours)


def _body_metrics(margin, el, step_hours: float, up_word: str, down_word: str) -> dict:
    up = margin > 0.0
    return {
        f"{up_word}_fraction": float(up.mean()),
        f"{up_word}_hours": float(up.sum() * step_hours),
        f"longest_{up_word}_hours": longest_run_hours(up, step_hours),
        f"longest_{down_word}_hours": longest_run_hours(~up, step_hours),
        f"{up_word}_at_start": bool(up[0]),
        "hours_to_next_set": hours_to_crossing(margin, step_hours, "down"),
        "hours_to_next_rise": hours_to_crossing(margin, step_hours, "up"),
        "elevation_at_start_deg": float(el[0]),
        "max_elevation_deg": float(el.max()),
        "min_elevation_deg": float(el.min()),
    }


def _sun_metrics(share, center_margin, el, step_hours: float) -> dict:
    """Sun numbers from the share of the disk showing (0–1) per sample.

    Sunlit % and hours count each sample for its share, so a sliver over a
    ridge counts as a sliver. "Lit" for runs, start and set/rise means at
    least half the disk shows, i.e. the disk center is above the skyline.
    """
    share = np.asarray(share, dtype=float)
    lit = share >= DARK_BELOW
    return {
        "sunlit_fraction": float(share.mean()),
        "sunlit_hours": float(share.sum() * step_hours),
        "longest_sunlit_hours": longest_run_hours(lit, step_hours),
        "longest_dark_hours": longest_run_hours(~lit, step_hours),
        "sunlit_at_start": bool(lit[0]),
        "hours_to_next_set": hours_to_crossing(center_margin, step_hours, "down"),
        "hours_to_next_rise": hours_to_crossing(center_margin, step_hours, "up"),
        "elevation_at_start_deg": float(el[0]),
        "max_elevation_deg": float(el.max()),
        "min_elevation_deg": float(el.min()),
    }


def phase1_metrics(track: SkyTrack, horizon_deg: float = 0.0, rule: str = "any",
                   skyline=None, height_m: float | None = None) -> dict:
    """All Phase 1 numbers for one site and window.

    ``horizon_deg`` is the smooth-Moon horizon elevation (0 at ground level;
    use ``-horizon_dip_deg(height_m)`` for a raised observer). ``rule`` says
    what counts as "up" for a disk: ``"any"``, ``"center"`` or ``"full"``.

    Pass a terrain ``skyline`` instead of ``horizon_deg`` to use the real
    skyline: every metric then counts the Sun or Earth as up only when it
    clears the terrain at its own azimuth. ``height_m`` picks which of the
    skyline's eye heights to use (default: the track's height).
    """
    h = track.step_hours
    iso = track.utc_iso()
    sun_hz, earth_hz = track.horizons(horizon_deg, skyline, height_m)

    sun = _sun_metrics(track.sun_share(sun_hz), track.sun_margin_deg(sun_hz, "center"), track.sun_el, h)
    earth = _body_metrics(track.earth_margin_deg(earth_hz, rule), track.earth_el, h, "visible", "blackout")

    if skyline is None:
        horizon = {"elevation_deg": float(horizon_deg), "disk_rule": rule, "terrain": False}
    else:
        horizon = {
            "terrain": True,
            "disk_rule": rule,
            "height_m": track.height_m if height_m is None else float(height_m),
            "source": skyline.source,
            "partial": skyline.partial,
        }
        sun["horizon_at_start_deg"] = float(sun_hz[0])
        earth["horizon_at_start_deg"] = float(earth_hz[0])

    return {
        "site": {"lat": track.lat, "lon": track.lon, "height_m": track.height_m},
        "window": {
            "start_utc": iso[0],
            "end_utc": iso[-1],
            "hours": float((len(track) - 1) * h),
            "step_hours": h,
            "samples": len(track),
        },
        "horizon": horizon,
        "sun": sun,
        "earth": earth,
    }


def terrain_results(track: SkyTrack, skyline, rule: str = "any") -> dict:
    """Terrain versions of the per-sample lists and metrics, at every eye height.

    This is the ``"terrain"`` block that the API and the precomputed files
    put next to the smooth-Moon results, so a page can switch between them
    (and between heights) without another request. ``skyline=None`` means
    the site has no terrain data; pass a reason string in its place.
    """
    if skyline is None or isinstance(skyline, str):
        return {"available": False, "reason": skyline or "no terrain data here"}
    heights = {}
    for h in skyline.heights_m:
        sun_hz, earth_hz = track.horizons(0.0, skyline, h)
        heights[f"{h:g}"] = {
            "sunlit": [bool(b) for b in track.sunlit(sun_hz, rule)],
            "earth_visible": [bool(b) for b in track.earth_visible(earth_hz, rule)],
            "metrics": phase1_metrics(track, rule=rule, skyline=skyline, height_m=h),
        }
    return {
        "available": True,
        "source": skyline.source,
        "partial": skyline.partial,
        "ground_m": round(float(skyline.ground_m), 1),
        "heights_m": [float(h) for h in skyline.heights_m],
        "default_height_m": DEFAULT_EYE_M if DEFAULT_EYE_M in skyline.heights_m else float(skyline.heights_m[0]),
        "heights": heights,
    }
