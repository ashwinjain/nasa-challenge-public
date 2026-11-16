"""Web API for lunarsky, run on Cloud Run behind Firebase Hosting (/api/**).

The page loads the 9 Artemis region sites for the default month from the static
files in ``frontend/public/data/``. This API covers everything else: custom
coordinates and any other date range. Its ``/api/sky`` response has the same
shape as those files (``scripts/precompute_static.py``), so the page reads
both the same way.

Run locally:  .venv/bin/uvicorn lunarsky.api:app --reload --port 8000

FastAPI is only needed here; ``import lunarsky`` doesn't pull it in.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import Body, FastAPI, HTTPException, Query

from .kernels import MAX_YEAR, MIN_YEAR, load_kernels
from .metrics import phase1_metrics, terrain_results
from .sites import load_sites
from .sky import sky_track

MAX_DAYS = 366          # one window at most a year long
MAX_SAMPLES = 20_000    # e.g. a year at 30-minute steps

app = FastAPI(title="Lunar Landing Site Navigator", version="0.1.0")

_kernels = load_kernels()   # ~1 s, once per server start
_sites = load_sites()
_dems = None                # elevation maps, loaded on the first terrain request
_dems_lock = threading.Lock()


def _get_dems():
    """The LOLA maps (~400 MB, a few seconds), loaded once and kept.

    Requests run in a thread pool, and the Plan page asks for several at
    once; the lock makes the others wait for one load instead of each
    loading their own copy.
    """
    global _dems
    if _dems is None:
        with _dems_lock:
            if _dems is None:
                from .terrain import load_dems
                _dems = load_dems()
    return _dems


@lru_cache(maxsize=256)
def _skyline(lat: float, lon: float):
    """Skyline for a point, or a reason string if there's no terrain data there."""
    from .terrain import compute_skyline
    try:
        return compute_skyline(lat, lon, dems=_get_dems())
    except ValueError as e:
        return str(e)


def _parse_utc(s: str, name: str) -> datetime:
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"{name} must be an ISO date like 2026-01-01, got {s!r}")
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


@app.get("/api/health")
def health(fine: bool = False):
    """``?fine=1`` also opens the 20 m map, which skylines quietly skip when
    it can't be read, and says where it came from or why it failed."""
    if not fine:
        return {"ok": True}
    from .data import locate, open_raster
    from .terrain import FINE_MAP
    out = {"ok": True, "fine_map": FINE_MAP, "location": locate(FINE_MAP).path}
    try:
        with open_raster(FINE_MAP) as src:
            out.update(fine_ok=True, width=src.width, height=src.height,
                       sample=float(src.read(1, window=((src.height // 2, src.height // 2 + 1),
                                                        (src.width // 2, src.width // 2 + 1)))[0, 0]))
    except Exception as e:
        out.update(fine_ok=False, error=f"{type(e).__name__}: {e}")
    return out


@app.get("/api/sites")
def list_sites(kind: str | None = None):
    """The curated sites from data/phase-3/sites.csv, optionally filtered by kind."""
    return [
        {"id": s.id, "name": s.name, "group": s.group, "kind": s.kind,
         "lat": s.lat, "lon": s.lon, "avg_sunlit": s.avg_sunlit}
        for s in _sites
        if kind is None or s.kind == kind
    ]


@app.get("/api/sky")
def get_sky(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: str = Query(..., description="UTC start, ISO date or datetime, e.g. 2026-01-01"),
    end: str = Query(..., description="UTC end, ISO date or datetime, e.g. 2026-02-01"),
    step_hours: float = Query(1.0, ge=0.25, le=24),
    height_m: float = Query(0.0, ge=0, le=100),
    site_name: str = Query("Custom"),
    site_id: str | None = None,
    terrain: bool = Query(False, description="also return terrain results at each eye height"),
):
    """Sun and Earth tracks plus Phase 1 metrics for one site and window.

    The top level is always the smooth-Moon answer. With ``terrain=true``
    a ``terrain`` block is added, the same as in the precomputed files.
    """
    t0, t1 = _parse_utc(start, "start"), _parse_utc(end, "end")
    if t1 <= t0:
        raise HTTPException(400, "end must be after start")
    if t0.year < MIN_YEAR or t1.year >= MAX_YEAR:
        raise HTTPException(400, f"dates must be within {MIN_YEAR}-{MAX_YEAR - 1} (the ephemeris range)")
    days = (t1 - t0).total_seconds() / 86400
    if days > MAX_DAYS:
        raise HTTPException(400, f"window is {days:.0f} days; the limit is {MAX_DAYS}")
    if days * 24 / step_hours > MAX_SAMPLES:
        raise HTTPException(400, f"too many samples; use a larger step_hours (limit {MAX_SAMPLES})")

    track = sky_track(_kernels, lat, lon, t0, days, step_hours, height_m)
    payload = track.to_dict()
    payload["metrics"] = phase1_metrics(track)
    payload["site_id"] = site_id
    payload["site_name"] = site_name
    if terrain:
        payload["terrain"] = terrain_results(track, _skyline(lat, lon))
    return payload


@lru_cache(maxsize=64)
def _panel_site(lat, lon, start, height_m, min_m, max_m, part=0, parts=1):
    from .panels import find_panel_site
    return find_panel_site(_kernels, lat, lon, start, height_m=height_m,
                           min_m=min_m, max_m=max_m, dems=_get_dems(), part=part, parts=parts)


@app.get("/api/panel-site")
def get_panel_site(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: str = Query("2026-01-01", description="UTC start of the one-year scoring window"),
    height_m: float = Query(10.0, ge=0, le=20, description="panel height above the ground (10 m mast)"),
    min_m: float = Query(100.0, ge=0, le=290, description="stand-off from the lander"),
    max_m: float = Query(300.0, ge=10, le=300, description="on-foot reach (at most 300 m)"),
    part: int = Query(0, ge=0, description="score only this slice of the ring (see parts)"),
    parts: int = Query(1, ge=1, le=64, description="split the ring into this many slices; join them with POST /api/panel-site/merge"),
):
    """Best spots for solar panels within walking distance of a landing spot.

    Scores every 20 m grid point in the ring over one year. Slow (~40 s) the
    first time for a spot; repeats are cached.
    On Cloudflare the page asks ``/api/jobs/panel-site`` instead: a queue
    runs the slices on separate containers side by side (api-worker/).
    """
    t0 = _parse_utc(start, "start")
    if t0.year < MIN_YEAR or t0.year + 1 >= MAX_YEAR:
        raise HTTPException(400, f"start must be within {MIN_YEAR}-{MAX_YEAR - 2} (a year must fit the ephemeris)")
    if min_m >= max_m:
        raise HTTPException(400, "min_m must be less than max_m")
    if part >= parts:
        raise HTTPException(400, "part must be less than parts")
    try:
        return _panel_site(lat, lon, t0, height_m, min_m, max_m, part, parts)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/panel-site/merge")
def merge_panel_site(results: list[dict] = Body(..., description="every slice of one search, from /api/panel-site?part=…&parts=…")):
    """Join the slices of one panel search into the answer a single call gives."""
    from .panels import merge_panel_parts
    try:
        return merge_panel_parts(results)
    except (ValueError, KeyError) as e:
        raise HTTPException(400, f"can't merge these parts: {e}")


# The page asks /api/jobs/panel-site. On Cloudflare the API Worker answers
# that path itself: it queues the search, splits it across containers and
# returns 202 with progress until it's done (api-worker/src/jobs.js). With
# no Worker in front (``make dev-backend``), it's just the search, inline:
# 200 with the answer, the same as a finished job.
app.get("/api/jobs/panel-site")(get_panel_site)


@app.get("/api/skyline")
def get_skyline(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    """The terrain skyline around a point: elevation angle in every direction."""
    sky = _skyline(lat, lon)
    if isinstance(sky, str):
        raise HTTPException(404, sky)
    return sky.to_dict()


@lru_cache(maxsize=256)
def _power(lat, lon, start, mission, days, load_w, crew, water_recovery, height_m,
           always_w=None, day_w=None, contact_w=None):
    from .power import site_power
    return site_power(_kernels, lat, lon, start, mission=mission, days=days, load_w=load_w,
                      crew=crew, water_recovery=water_recovery, height_m=height_m,
                      dems=_get_dems(), always_w=always_w, day_w=day_w, contact_w=contact_w)


@app.get("/api/power")
def get_power(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: str = Query(..., description="UTC landing date, e.g. 2027-08-14"),
    mission: str = Query("crew", description="the mission profile; only 'crew' (a crewed mission)"),
    days: float | None = Query(None, gt=0, le=366, description="crew stay in days; default 365 (a year-round base)"),
    load_w: float | None = Query(None, gt=0, le=1_000_000, description="one steady load (W), all always on; default is the profile's load list"),
    always_w: float | None = Query(None, ge=0, le=1_000_000, description="load list: total of the lines that run day and night (W)"),
    day_w: float | None = Query(None, ge=0, le=1_000_000, description="load list: total of the daylight-only lines (W)"),
    contact_w: float | None = Query(None, ge=0, le=1_000_000, description="load list: total of the lines that run only in direct contact with Earth (the radio, W)"),
    crew: int | None = Query(None, ge=1, le=50, description="crew size; default 4"),
    water_recovery: float | None = Query(None, ge=0, lt=1, description="share of water recycled; default 0"),
    height_m: float = Query(10.0, ge=0, le=20, description="panel height above the ground (10 m mast)"),
):
    """Phase 4: panels and battery for the crewed mission, and the tonnage to land (no supplies).

    A stay of a year or more is sized to run year after year; a shorter
    one over its stay only. Panels at ``height_m`` (10 m by default), against the
    terrain skyline where the maps reach. The page changes load, crew and
    water recycling itself from one result; the overrides here give the
    same numbers from the server. A fraction of a second once the elevation maps are loaded.
    """
    from .power import PROFILES
    if mission not in PROFILES:
        raise HTTPException(400, f"mission must be one of {list(PROFILES)}")
    t0 = _parse_utc(start, "start")
    if t0.year < MIN_YEAR or t0.year + 1 >= MAX_YEAR:
        raise HTTPException(400, f"start must be within {MIN_YEAR}-{MAX_YEAR - 2}")
    if (always_w is not None or day_w is not None or contact_w is not None) and \
            (always_w or 0) + (day_w or 0) + (contact_w or 0) <= 0:
        raise HTTPException(400, "the load list must add up to more than 0 W")
    res = _power(lat, lon, t0, mission, days, load_w, crew, water_recovery, height_m, always_w, day_w, contact_w)
    out = {k: v for k, v in res.items() if k != "options"}   # keep the payload small
    out["options"] = res.get("options", [])
    return out
