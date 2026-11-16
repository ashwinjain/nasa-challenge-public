"""Phase 4: how much solar array and battery a mission needs at a site.

The base draws a steady load. A vertical solar array on a mast turns to
face the Sun (NASA's VSAT design), so at the pole, where the Sun skims the
horizon, it catches nearly full sunlight whenever the Sun is up. When the
Sun is behind the terrain, the battery carries the load.

The sizing runs hour by hour over a real Sun track at the panel's height:

1. **Output per hour** = array area × sunlight at the Moon (by the actual
   Sun distance) × cell efficiency × packing × cos(Sun elevation) × the
   share of the Sun's disk above the skyline (a half-risen Sun gives half).
2. **Battery** = the deepest the store is ever drawn down, found by
   running the year twice (so the end wraps into the start) and tracking
   the shortfall ("sequent peak"). Charging loses ``storage_round_trip``.
   This catches the recharge problem: if the sunny stretch after a long
   night is too short to refill, the next night starts low and the
   battery must be bigger.
3. **Smallest array** that breaks even over the whole window (energy in,
   after losses, equals energy used). An array right at that size needs a
   huge battery, so a few larger sizes are tried and the lightest
   array + battery total is picked.

Assumptions come from ``data/phase-4/assumptions.csv``.

Quick start::

    from datetime import datetime, timezone
    from lunarsky import load_kernels
    from lunarsky.power import site_power

    k = load_kernels()
    r = site_power(k, -86.00114, 2.05502, datetime(2026, 1, 1, tzinfo=timezone.utc))
    r["best"]
"""

from __future__ import annotations

import csv
from datetime import datetime
from functools import lru_cache

import numpy as np

from .kernels import DEFAULT_DATA_DIR
from .metrics import longest_run_hours
from .sky import DARK_BELOW, disk_fraction

AU_KM = 149_597_870.7
# The mission: one crewed mission landing in early 2026.
# It names its rows in assumptions.csv. The stay can be
# changed (``days``); a stay of a year or more is sized to run year after
# year, so every night is covered, and a shorter one as a one-off.
PROFILES = {
    "crew": {"label": "Crewed mission",
             "crew": "crew_base", "days": "stay_long", "loads": "crew"},
}
DEFAULT_MISSION = "crew"
# Heights: solar panels and the comms antenna sit on a 10 m mast; a person's
# eye is at 2 m (terrain.DEFAULT_EYE_M), used only for what someone standing
# there sees. Every power and Earth-contact number is at the mast.
PANEL_HEIGHT_M = 10.0
ANTENNA_HEIGHT_M = PANEL_HEIGHT_M
# How far from the lander the crew carries and cables panels and comms gear,
# on foot. (The panel search subtracts the landing zone's radius, since the
# lander can touch down anywhere in it.)
REACH_M = 300.0
# The load list: each profile's default lines (assumption id, when it
# runs). "always" runs day and night; "day" only while the panel sees at
# least half the Sun (not DARK_BELOW), so the battery doesn't carry it;
# "contact" only while the site is in direct contact with Earth (the radio
# transmitting: Earth above the antenna's skyline and a DSN station up).
# When a line runs is fixed, not something the page lets you change.
# Crew lines are NASA's First Lunar Outpost habitat (TM-105925, 1993):
# 10 kWe by day, 9 kWe at night for 4 crew.
LOAD_LISTS = {
    "crew": [("li_crew_systems", "always"), ("li_crew_avionics", "always"),
             ("li_crew_radio", "contact"), ("li_crew_other", "always"), ("li_crew_lab", "day")],
}
# Lines the page offers under "+ Add a load".
EXTRA_LOADS = [("li_extra_rover", "day"), ("li_extra_crewed_rover", "always"),
               ("li_extra_drill", "day"), ("li_extra_lights", "always"),
               ("li_extra_custom", "always")]
# Our own estimates (no published figure): the page marks them * and lets
# you change their watts. Lines taken or worked out from a source are fixed.
ESTIMATED_LOADS = {"li_extra_lights", "li_crew_radio"}
EDITABLE_LOADS = ESTIMATED_LOADS | {"li_extra_custom"}
# Lines given per crew member; they scale with the crew size.
PER_CREW_LOADS = {"li_crew_systems"}
# Array sizes tried, as multiples of the break-even size.
ARRAY_MULTIPLIERS = (1.05, 1.1, 1.25, 1.5, 2.0, 3.0, 5.0)


@lru_cache(maxsize=1)
def load_assumptions() -> dict[str, dict]:
    """``assumptions.csv`` as {id: row}, with value/low/high as floats (None if blank)."""
    path = DEFAULT_DATA_DIR / "phase-4" / "assumptions.csv"
    out = {}
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            for k in ("value", "low", "high"):
                row[k] = float(row[k]) if row[k] else None
            out[row["id"]] = row
    return out


def assumption(name: str) -> float:
    return load_assumptions()[name]["value"]


def array_watts_per_m2(a=None) -> float:
    """Array output per m² facing the Sun at 1 AU."""
    a = a or {k: v["value"] for k, v in load_assumptions().items()}
    return a["solar_constant"] * a["cell_efficiency"] * a["array_packing"]


def battery_needed_wh(gen_w, load_w: float, step_hours: float, round_trip: float,
                      repeat: bool = True) -> float:
    """Usable battery energy (Wh) so the store, starting full, never runs out.

    ``gen_w`` is array output per sample. With ``repeat`` (a base that runs
    year after year) the series runs twice so a shortfall at the end
    carries into the start, and ``inf`` means the array doesn't break even.
    Without it (a one-off stay) the battery starts full and the stay ends
    when the series does.
    """
    net = (np.asarray(gen_w, dtype=float) - np.asarray(load_w, dtype=float)) * step_hours
    net = np.where(net > 0, net * round_trip, net)   # charging loses energy
    if repeat and net.sum() < 0:
        return float("inf")
    # Shortfall after each step: short_t = max(0, short_{t-1} - d_t), starting
    # at 0. That's the running total of draws minus its lowest point so far
    # (floored at 0), so the deepest shortfall comes out without a Python loop.
    draws = np.cumsum(-(np.concatenate([net, net]) if repeat else net))
    low = np.minimum.accumulate(np.minimum(draws, 0.0))
    return float(max(0.0, (draws - low).max(initial=0.0)))


def size_power(sun_share, sun_scale, load_w: float, step_hours: float = 1.0,
               assumptions: dict | None = None, repeat: bool = True, dark=None,
               day_w: float = 0.0, contact_w: float = 0.0, contact=None) -> dict:
    """Size the array and battery for a steady ``load_w``, plus ``day_w``
    that runs only while it isn't ``dark`` (so the battery never carries it),
    plus ``contact_w`` that runs only while ``contact`` (per sample, bool) is
    true; without a ``contact`` mask it runs always.

    ``sun_share``: per sample, the share of full output the array gets
    (disk fraction × cos elevation), 0–1. ``sun_scale``: per sample,
    sunlight relative to 1 AU (1/d²). Returns the break-even array, a list
    of options (bigger arrays, smaller batteries) and the lightest one.

    ``repeat``: True for a mission that runs year after year (must break
    even); False for a one-off stay that starts with a full battery, where
    a battery-only option (no array) is also tried.
    """
    a = assumptions or {k: v["value"] for k, v in load_assumptions().items()}
    rt = a["storage_round_trip"]
    # ``dark``: per sample, whether it counts as dark for "longest dark"
    # (site_power passes "less than half the Sun showing"); default: none of it.
    per_m2 = array_watts_per_m2(a) * np.asarray(sun_scale) * np.asarray(sun_share)
    lit = np.asarray(sun_share) > 0
    is_dark = ~lit if dark is None else np.asarray(dark, dtype=bool)
    longest_dark_h = longest_run_hours(is_dark, step_hours)
    # Load per sample: always-on, plus the daylight-only lines while it's light,
    # plus the radio while in contact with Earth.
    in_contact = np.ones(len(per_m2), dtype=bool) if contact is None else np.asarray(contact, dtype=bool)
    load = load_w + day_w * (~is_dark) + contact_w * in_contact
    out = {
        "load_w": load_w + day_w + contact_w,
        "always_w": load_w,
        "day_w": day_w,
        "contact_w": contact_w,
        "contact_fraction": float(in_contact.mean()) if len(in_contact) else 0.0,
        "step_hours": step_hours,
        "hours": len(per_m2) * step_hours,
        "sunlit_fraction": float(lit.mean()),
        "avg_sun_share": float(np.mean(sun_share)),
        "longest_dark_hours": longest_dark_h,
        "repeat": repeat,
        "array_w_per_m2": round(array_watts_per_m2(a), 1),
        "assumptions": {k: a[k] for k in ("solar_constant", "cell_efficiency", "array_packing",
                                           "array_specific_mass", "battery_specific_energy",
                                           "battery_dod", "storage_round_trip")},
    }
    if not lit.any() and repeat:
        out.update(feasible=False, reason="the Sun never rises at the panel in this window")
        return out

    # Break-even area: energy stored after losses equals energy used.
    #   Σ max(A·p − L, 0)·rt = Σ max(L − A·p, 0); the left side grows and the
    #   right shrinks with A, so bisect.
    def balance(area):
        net = area * per_m2 - load
        return np.sum(np.where(net > 0, net * rt, net))
    area_min = 0.0
    if lit.any():
        lo, hi = 0.0, max(float(load.max()), 1e-9) / per_m2[per_m2 > 0].min() * 10
        while balance(hi) < 0:
            hi *= 2
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if balance(mid) < 0 else (lo, mid)
        area_min = hi

    multiples = ARRAY_MULTIPLIERS if lit.any() else ()
    if not repeat:
        multiples = (0.0, *multiples)          # battery only, no array
    options = []
    for m in multiples:
        area = area_min * m
        usable_wh = battery_needed_wh(area * per_m2, load, step_hours, rt, repeat)
        rated_w = area * array_watts_per_m2(a)
        batt_wh = usable_wh / a["battery_dod"]
        array_kg = rated_w * a["array_specific_mass"]
        batt_kg = batt_wh / a["battery_specific_energy"]
        options.append({
            "array_multiple": m,
            "array_m2": round(area, 2),
            "array_rated_w": round(rated_w, 1),
            "array_kg": round(array_kg, 1),
            "battery_kwh": round(batt_wh / 1000, 2),
            "battery_kg": round(batt_kg, 1),
            "total_kg": round(array_kg + batt_kg, 1),
        })
    best = min(options, key=lambda o: o["total_kg"])
    # For comparison: the simple estimate that ignores recharge time.
    simple_wh = load_w * longest_dark_h / (a["battery_dod"] * rt)
    out.update(
        feasible=True,
        break_even_m2=round(area_min, 2),
        options=options,
        best=best,
        simple_battery_kwh=round(simple_wh / 1000, 2),
    )
    return out


def crew_supplies(crew: int, days: float, water_recovery: float | None = None) -> dict:
    """Oxygen, water and food (kg) for ``crew`` people over ``days``, brought from Earth.

    ``water_recovery`` (0–1) is the share of water recycled; the default
    is the assumption (0: nothing recycled).
    """
    a = {k: v["value"] for k, v in load_assumptions().items()}
    rec = a["water_recovery"] if water_recovery is None else water_recovery
    keep = 1.0 - rec
    per_day = {
        "oxygen_kg": a["o2_per_crew"],
        "water_kg": a["water_drink_per_crew"] * keep,
        "food_kg": a["food_per_crew"],
    }
    pad = 1.0 / (1.0 - a["supplies_margin"])   # margin as a share of what's carried
    out = {k: round(v * crew * days * pad, 1) for k, v in per_day.items()}
    out["total_kg"] = round(sum(out.values()), 1)
    out.update(crew=crew, days=days, margin=a["supplies_margin"], water_recovery=rec)
    return out


def _row(name: str) -> dict:
    """One assumption as {value, low, high, units, source} for the page."""
    r = load_assumptions()[name]
    return {k: r[k] for k in ("value", "low", "high", "units", "source")}


def editable_inputs(mission: str) -> dict:
    """The profile values the page lets you change, with their range and source.

    The page re-sizes for a new load, crew or water recycling itself: the
    array and battery scale in proportion to the load (see
    ``size_power``), and supplies are crew × days × the per-crew-day rates
    in ``rates``.
    """
    p = PROFILES[mission]
    out = {"water_recovery": _row("water_recovery"),
           "loads": [load_item(i, when) for i, when in LOAD_LISTS[p["loads"]]],
           "extra_loads": [load_item(i, when) for i, when in EXTRA_LOADS]}
    if p["crew"]:
        out["crew"] = _row(p["crew"])
    out["rates"] = {k: assumption(k) for k in
                    ("o2_per_crew", "water_drink_per_crew", "food_per_crew", "supplies_margin")}
    return out


def load_item(item_id: str, when: str) -> dict:
    """One load-list line for the page: id, name, watts (range, source), when it
    runs, and whether it's our estimate (editable) or per crew member."""
    r = load_assumptions()[item_id]
    return {"id": item_id, "name": r["parameter"], "w": r["value"], "low": r["low"],
            "high": r["high"], "when": when, "source": r["source"], "notes": r["notes"],
            "estimate": item_id in ESTIMATED_LOADS, "editable": item_id in EDITABLE_LOADS,
            "per_crew": item_id in PER_CREW_LOADS}


def load_split(items, crew: int = 0) -> tuple[float, float, float]:
    """(always-on W, daylight-only W, contact-only W) for ``{"w", "when",
    "per_crew"?}`` lines; per-crew lines count ``crew`` times."""
    watts = lambda i: i["w"] * (crew if i.get("per_crew") else 1)
    return tuple(sum(watts(i) for i in items if i["when"] == when)
                 for when in ("always", "day", "contact"))


def profile_loads(mission: str, crew: int | None = None) -> tuple[float, float, float]:
    """(always-on W, daylight-only W, contact-only W) of a profile's default load list for ``crew``."""
    p = PROFILES[mission]
    if crew is None:
        crew = int(assumption(p["crew"])) if p["crew"] else 0
    return load_split([load_item(i, w) for i, w in LOAD_LISTS[p["loads"]]], crew)


def mission_profile(mission: str) -> dict:
    """A profile's load (W), stay (days) and crew, from the assumptions."""
    if mission not in PROFILES:
        raise ValueError(f"mission must be one of {list(PROFILES)}, not {mission!r}")
    p = PROFILES[mission]
    always, day, contact = profile_loads(mission)
    return {
        "id": mission,
        "label": p["label"],
        # The default load list: total, and its always-on / daylight / contact split.
        "load_w": always + day + contact, "always_w": always, "day_w": day, "contact_w": contact,
        "days": assumption(p["days"]),
        "crew": int(assumption(p["crew"])) if p["crew"] else 0,
    }


def earth_contact(k, track, sky, start: datetime, days: float, step_hours: float = 1.0,
                  height_m: float = ANTENNA_HEIGHT_M):
    """Per sample, direct contact with Earth: Earth above the skyline at the
    antenna's height (the smooth Moon without ``sky``) and a DSN station can
    see the Moon. When the radio transmits (the "contact" load lines)."""
    from .dsn import dsn_visible
    earth_hz = sky.horizon_at(track.earth_az, height_m) if sky is not None else 0.0
    up = track.earth_margin_deg(earth_hz, "any") > 0.0
    dsn = dsn_visible(k, start, days, step_hours)["any"]
    if len(dsn) != len(up):
        raise ValueError(f"DSN has {len(dsn)} samples, sky track {len(up)}")
    return up & dsn


def _t(kg: float) -> str:
    return f"{kg / 1000:.1f} t" if kg >= 1000 else f"{kg:.0f} kg"


def verdict(res: dict, year: int | None = None) -> dict:
    """What the mission has to land: the tonnage to the Moon.

    The delivered mass is array + battery (the power kit), with the biggest
    item and why. No habitat, rover or lander structure is counted, only
    what Phase 4 sizes. Landers and prices are out of scope.
    ``year`` is accepted for older callers and not used.
    """
    if not res.get("feasible"):
        return {"ok": False, "text": f"Doesn't work: {res.get('reason', 'no option found')}."}
    b = res["best"]
    parts = {"battery": b["battery_kg"], "solar array": b["array_kg"]}
    # Air, water and food are left out (2026-11-14): crew and stay are fixed,
    # so they weigh the same at every site and don't change the comparison.
    total = sum(parts.values())
    driver = max(parts, key=parts.get)
    why = {
        "battery": f"the longest dark stretch is {res['longest_dark_hours']:.0f} h",
        "solar array": f"it powers a {res['sized_load_w'] / 1000:.1f} kW load (with margin) "
                       f"and the panel sees {res['sunlit_fraction']:.0%} of the Sun on average",
    }[driver]
    text = (f"Lands {_t(total)}. Biggest item: {driver}, {_t(parts[driver])}, because {why}. "
            f"Array {b['array_m2']:.0f} m², battery {b['battery_kwh']:.0f} kWh.")
    return {
        "ok": True,
        "total_kg": round(total, 1),
        "breakdown_kg": {k: round(v, 1) for k, v in parts.items()},
        "driver": driver,
        "text": text,
    }


def data_backlog(contact, step_hours: float = 1.0, gb_per_day: float | None = None,
                 rate_mbps: float | None = None, repeat: bool = True) -> dict:
    """On-board storage to hold data through Earth blackouts.

    Data piles up at ``gb_per_day`` (gigabits) and drains at ``rate_mbps``
    while ``contact`` (per sample, bool) is true. The largest pile is the
    storage needed. ``repeat``: a year-long stay wraps around, so run it
    twice to catch a blackout that spans the year's end. Sending the
    backlog needs no extra battery here: the radio line already draws its
    full power for every contact hour.
    """
    gb_per_day = assumption("data_per_day") if gb_per_day is None else gb_per_day
    rate_mbps = assumption("downlink_rate") if rate_mbps is None else rate_mbps
    c = np.asarray(contact, dtype=bool)
    gen = gb_per_day / 24.0 * step_hours            # Gb per sample
    drain = rate_mbps * 3600.0 * step_hours / 1000.0  # Gb per sample in contact
    pile, worst = 0.0, 0.0
    for i in range(len(c) * (2 if repeat else 1)):
        pile += gen
        if c[i % len(c)]:
            pile = max(0.0, pile - drain)
        worst = max(worst, pile)
    return {
        "data_per_day_gb": gb_per_day, "downlink_mbps": rate_mbps,
        "storage_gb": round(worst / 8.0, 1),           # gigabytes
        "longest_blackout_hours": longest_run_hours(~c, step_hours),
    }


def size_on_track(track, sun_hz, prof: dict, step_hours: float = 1.0, contact=None) -> dict:
    """Array + battery for ``prof`` (from ``mission_profile``) against a Sun
    track whose skyline elevation toward the Sun is ``sun_hz`` (degrees, per
    sample, or 0 for the smooth Moon). The track must span ``prof["days"]``.

    Shared by ``site_power`` and the panel search, which sizes every
    candidate spot against one track. ``contact``: per sample, direct contact
    with Earth (see ``earth_contact``); the radio line runs only then. Without
    it the radio runs always (the cautious answer).
    """
    frac = disk_fraction(track.sun_el, track.sun_radius_deg, sun_hz)
    share = frac * np.cos(np.radians(np.clip(track.sun_el, -90, 90)))
    scale = (AU_KM / track.sun_dist_km) ** 2
    # A year-long mission repeats every year; a shorter stay is one-off.
    # Size for the load plus NASA's concept-stage power margin.
    margin = assumption("power_margin")
    pad = 1.0 / (1.0 - margin)
    # Dark = less than half the Sun's disk showing: a sliver over a ridge
    # gives almost no power, so it shouldn't read as daylight.
    res = size_power(share, scale, prof["always_w"] * pad, step_hours, repeat=prof["days"] >= 365,
                     dark=frac < DARK_BELOW, day_w=prof["day_w"] * pad,
                     contact_w=prof.get("contact_w", 0.0) * pad, contact=contact)
    res.update(load_w=prof["load_w"], always_w=prof["always_w"], day_w=prof["day_w"],
               contact_w=prof.get("contact_w", 0.0),
               sized_load_w=round(prof["load_w"] * pad, 1), power_margin=margin)
    # Sunlit = how much of the Sun the panel sees, averaged over the stay:
    # a sliver above a ridge counts for its share of the disk.
    res["sunlit_fraction"] = round(float(np.mean(frac)), 4)
    if contact is not None:
        res["data"] = data_backlog(contact, step_hours, repeat=prof["days"] >= 365)
    return res


def site_power(k, lat: float, lon: float, start: datetime, mission: str = DEFAULT_MISSION,
               days: float | None = None, load_w: float | None = None,
               crew: int | None = None, water_recovery: float | None = None,
               height_m: float = PANEL_HEIGHT_M, step_hours: float = 1.0, dems=None,
               always_w: float | None = None, day_w: float | None = None,
               contact_w: float | None = None) -> dict:
    """Needs and supply for a mission at a site, starting at ``start``.

    ``mission`` picks the load, stay length and crew from the assumptions;
    ``days``, ``load_w`` and ``crew`` override them, and ``water_recovery`` overrides the recycled share. The Sun is checked against the
    terrain skyline at ``height_m`` (the panel's height, 10 m by default);
    Earth contact is always at the 10 m antenna. Outside the terrain maps it
    falls back to the smooth Moon.
    """
    from .sky import sky_track
    from .terrain import compute_skyline

    prof = mission_profile(mission)
    # Load: the profile's list, or the page's edited list (always_w / day_w),
    # or one steady load_w that's all always on.
    edited = always_w is not None or day_w is not None or contact_w is not None
    if load_w is not None and not edited:
        always_w, day_w, contact_w = load_w, 0.0, 0.0
    elif crew is not None and prof["crew"] and not edited:
        # Default list for this crew size (per-person lines scale).
        always_w, day_w, contact_w = profile_loads(mission, int(crew))
    if always_w is not None:
        prof["always_w"] = always_w
    if day_w is not None:
        prof["day_w"] = day_w
    if contact_w is not None:
        prof["contact_w"] = contact_w
    prof["load_w"] = prof["always_w"] + prof["day_w"] + prof["contact_w"]
    if days is not None:
        prof["days"] = days
    if crew is not None and prof["crew"]:
        prof["crew"] = int(crew)
    track = sky_track(k, lat, lon, start, prof["days"], step_hours)
    try:
        sky = compute_skyline(lat, lon, dems=dems)
        sun_hz = sky.horizon_at(track.sun_az, height_m)
        horizon = "terrain"
    except ValueError:
        sky = None
        sun_hz = 0.0
        horizon = "smooth"
    contact = earth_contact(k, track, sky, start, prof["days"], step_hours)
    res = size_on_track(track, sun_hz, prof, step_hours, contact=contact)
    res.update(site={"lat": lat, "lon": lon}, mission=prof, horizon=horizon,
               panel_height_m=height_m, start_utc=track.utc_iso()[0])
    res["inputs"] = editable_inputs(mission)
    res["verdict"] = verdict(res)
    return res
