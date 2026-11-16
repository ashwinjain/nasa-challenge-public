"""When the Sun and Earth are up at a site, over a long span, as compact runs.

The planning views (pick a date → where, pick a site → when, explore) score
thousands of possible stays: every site × every landing day × any length.
Shipping hourly flags for a year would be big; shipping *runs* is tiny. A
run is ``[start, stop)`` in sample indices (hours from ``start_utc`` with
the default 1-hour step) during which the body is up. A polar site has a
few dozen to a few hundred runs a year, so a whole year at every horizon
is a few KB.

The browser rebuilds the hourly flags from the runs and scores any stay
from them, so changing dates or stay length needs no server call.

Horizons, keyed like the frontend's toggle:

- ``smooth``: the smooth Moon (flat 0° horizon).
- ``terrain_0``, ``terrain_2``, ``terrain_10``, ``terrain_20``: the terrain
  skyline at each eye height the skyline has.

Quick start::

    from datetime import datetime, timezone
    from lunarsky import load_kernels, sky_track
    from lunarsky.windows import visibility_windows

    k = load_kernels()
    track = sky_track(k, -85.48, 29.52, datetime(2027, 1, 1, tzinfo=timezone.utc), 365)
    visibility_windows(track, skyline)["horizons"]["terrain_2"]["sun"][:3]
"""

from __future__ import annotations

import numpy as np

from .metrics import true_runs
from .sky import SkyTrack


def horizon_key(height_m: float | None) -> str:
    """``smooth`` for no terrain, else ``terrain_<height>`` (``terrain_2``)."""
    return "smooth" if height_m is None else f"terrain_{float(height_m):g}"


def _runs(mask) -> list[list[int]]:
    return [[a, b] for a, b in true_runs(mask)]


def _sun_part(track: SkyTrack, sun_hz) -> list[list[int]]:
    """Runs where the Sun is partly hidden: ``[start, stop, percent]``.

    ``percent`` (1–99) is the share of the disk above the skyline; a sliver
    still counts as 1. Hours inside a Sun-up run but not listed here show
    the whole Sun (100). Lets the page shade Sun bars and average sunlit %
    by how much of the Sun shows.
    """
    pct = np.round(track.sun_share(sun_hz) * 100).astype(int)
    up = track.sunlit(sun_hz, "any")
    pct = np.where(up, np.clip(pct, 1, 100), 0)
    out = []
    i, n = 0, len(pct)
    while i < n:
        j = i + 1
        while j < n and pct[j] == pct[i]:
            j += 1
        if 0 < pct[i] < 100:
            out.append([i, j, int(pct[i])])
        i = j
    return out


def visibility_windows(track: SkyTrack, skyline=None, rule: str = "any", relay=None,
                       relay_heights=None) -> dict:
    """Sun-up and Earth-up runs for the smooth Moon and, with a skyline, each eye height.

    With ``relay`` (a :class:`lunarsky.relay.RelayTrack`, or a list of them,
    one per relay, over the same hours), each horizon also gets ``"relay"``:
    hours the site can reach Earth through a relay satellite. ``relay_heights`` limits that to some eye heights
    (``None``: all, including the smooth Moon) to keep the files small.

    Returns a JSON-ready dict::

        {"start_utc", "end_utc", "step_hours", "samples", "disk_rule",
         "terrain_source",            # None without a skyline
         "horizons": {key: {"sun": [[start, stop], ...],
                            "sun_part": [[start, stop, percent], ...], "earth": [...],
                            "relay": [...]}}}    # only with ``relay``
    """
    from .relay import relay_runs

    def add_relay(entry, height_m):
        wanted = relay_heights is None or (height_m is not None and float(height_m) in relay_heights)
        if relay is not None and wanted:
            entry["relay"] = relay_runs(relay, track.lat, track.lon,
                                        None if height_m is None else skyline, height_m)
        return entry

    iso = track.utc_iso()
    if relay is not None:
        n_relay = (relay if hasattr(relay, "samples") else relay[0]).samples
        if n_relay != len(track):
            raise ValueError(f"relay track has {n_relay} samples, sky track {len(track)}")
    horizons = {
        horizon_key(None): add_relay({
            "sun": _runs(track.sunlit(0.0, rule)),
            "sun_part": _sun_part(track, 0.0),
            "earth": _runs(track.earth_visible(0.0, rule)),
        }, None)
    }
    if skyline is not None:
        for h in skyline.heights_m:
            sun_hz, earth_hz = track.horizons(0.0, skyline, h)
            horizons[horizon_key(h)] = add_relay({
                "sun": _runs(track.sunlit(sun_hz, rule)),
                "sun_part": _sun_part(track, sun_hz),
                "earth": _runs(track.earth_visible(earth_hz, rule)),
            }, h)
    return {
        "start_utc": iso[0],
        "end_utc": iso[-1],
        "step_hours": float(track.step_hours),
        "samples": len(track),
        "disk_rule": rule,
        "terrain_source": None if skyline is None else skyline.source,
        "horizons": horizons,
    }
