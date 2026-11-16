"""lunarsky: Phase 1 data loading and sky geometry for the Lunar Landing Site Navigator.

Reads the SPICE kernels in ``data/phase-1`` and the site list in
``data/phase-3``, then works out where the Sun and Earth are in the sky from
any point on the Moon and the Phase 1 metrics that follow: sunlit %, longest
dark stretch, Earth-in-view %, longest blackout, and time to the next sunset
and Earthset.

Quick start::

    from datetime import datetime, timezone
    from lunarsky import load_kernels, load_sites, site_by_id, sky_track, phase1_metrics

    k = load_kernels()                                   # once, at startup (~1 s)
    site = site_by_id(load_sites(), "artemis-ma")        # Malapert Massif
    track = sky_track(k, site.lat, site.lon,
                      datetime(2027, 1, 1, tzinfo=timezone.utc), days=30)
    metrics = phase1_metrics(track)                      # plain dict, JSON-ready
    payload = track.to_dict()                            # per-hour arrays for plotting

Command line: ``python -m lunarsky --help``.
"""

from .kernels import (
    MAX_YEAR,
    MIN_YEAR,
    MOON_RADIUS_KM,
    Kernels,
    horizon_dip_deg,
    load_kernels,
    site_observer,
)
from .metrics import hours_to_crossing, longest_run_hours, phase1_metrics, terrain_results, true_runs
from .sites import Site, load_artemis_regions, load_sites, site_by_id
from .sky import DISK_RULES, SkyTrack, disk_margin_deg, sky_track

__version__ = "0.1.0"

__all__ = [
    "Kernels",
    "load_kernels",
    "site_observer",
    "horizon_dip_deg",
    "MIN_YEAR",
    "MAX_YEAR",
    "MOON_RADIUS_KM",
    "Site",
    "load_sites",
    "site_by_id",
    "load_artemis_regions",
    "SkyTrack",
    "sky_track",
    "disk_margin_deg",
    "DISK_RULES",
    "phase1_metrics",
    "terrain_results",
    "hours_to_crossing",
    "longest_run_hours",
    "true_runs",
]
