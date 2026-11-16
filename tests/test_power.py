"""Phase 4 power sizing on made-up sunlight where the answer is known by hand."""

import numpy as np
import pytest

from lunarsky.power import battery_needed_wh, disk_fraction, load_assumptions, size_power


def test_assumptions_load():
    a = load_assumptions()
    for key in ("o2_per_crew", "li_crew_systems", "battery_specific_energy", "battery_dod"):
        assert a[key]["value"] > 0


def test_disk_fraction():
    assert disk_fraction(0.0, 0.25, 0.0) == pytest.approx(0.5)
    assert disk_fraction(1.0, 0.25, 0.0) == pytest.approx(1.0)
    assert disk_fraction(-1.0, 0.25, 0.0) == pytest.approx(0.0)


def test_battery_simple_night():
    # 10 h of 2 kW sun, then 10 h of dark, load 1 kW, no losses.
    gen = np.array([2000.0] * 10 + [0.0] * 10)
    assert battery_needed_wh(gen, 1000.0, 1.0, 1.0) == pytest.approx(10_000)


def test_battery_short_recharge_needs_more():
    # Same energy per cycle, but two nights back to back with a short day
    # between: the short day can't refill, so the battery must cover more.
    even = np.array(([3000.0] * 10 + [0.0] * 10) * 2)
    uneven = np.array([3000.0] * 18 + [0.0] * 10 + [3000.0] * 2 + [0.0] * 10)
    assert battery_needed_wh(uneven, 1000.0, 1.0, 1.0) > battery_needed_wh(even, 1000.0, 1.0, 1.0)


def test_battery_infeasible():
    assert battery_needed_wh(np.array([500.0] * 10), 1000.0, 1.0, 1.0) == float("inf")


def test_size_power_break_even():
    # Half the time lit at full share, no losses: break-even output is 2× the load.
    a = {k: v["value"] for k, v in load_assumptions().items()}
    a["storage_round_trip"] = 1.0
    share = np.array([1.0] * 12 + [0.0] * 12)
    r = size_power(share, np.ones_like(share), 1000.0, 1.0, a)
    per_m2 = a["solar_constant"] * a["cell_efficiency"] * a["array_packing"]
    assert r["break_even_m2"] * per_m2 == pytest.approx(2000.0, rel=1e-3)
    assert r["longest_dark_hours"] == 12
    assert r["best"]["total_kg"] == min(o["total_kg"] for o in r["options"])
    # Bigger arrays never need a bigger battery.
    kwh = [o["battery_kwh"] for o in r["options"]]
    assert all(b2 <= b1 + 1e-9 for b1, b2 in zip(kwh, kwh[1:]))


def test_size_power_no_sun():
    r = size_power(np.zeros(24), np.ones(24), 1000.0)
    assert r["feasible"] is False


def test_profiles_and_supplies():
    from lunarsky.power import PROFILES, crew_supplies, mission_profile
    for pid in PROFILES:
        p = mission_profile(pid)
        assert p["load_w"] > 0 and p["days"] > 0
    p = mission_profile("crew")
    assert p["crew"] == 4 and p["days"] == 365
    s = crew_supplies(4, 7)
    a = load_assumptions()
    pad = 1 / (1 - a["supplies_margin"]["value"])
    assert s["oxygen_kg"] == pytest.approx(4 * 7 * a["o2_per_crew"]["value"] * pad, abs=0.1)
    assert s["total_kg"] == pytest.approx(s["oxygen_kg"] + s["water_kg"] + s["food_kg"], abs=0.2)


def test_one_off_stay_in_the_dark_uses_battery_only():
    # 48 h stay with no sun: battery covers it all, no array.
    a = {k: v["value"] for k, v in load_assumptions().items()}
    r = size_power(np.zeros(48), np.ones(48), 1000.0, 1.0, a, repeat=False)
    assert r["feasible"] is True
    assert r["best"]["array_m2"] == 0
    assert r["best"]["battery_kwh"] == pytest.approx(48 / a["battery_dod"], rel=1e-3)


def test_one_off_stay_in_full_sun_needs_no_battery():
    r = size_power(np.ones(48), np.ones(48), 1000.0, 1.0, repeat=False)
    assert r["best"]["battery_kwh"] == 0


def _res(battery_kg, supplies=None, dark=100.0):
    r = {"feasible": True, "longest_dark_hours": dark, "sunlit_fraction": 0.5, "sized_load_w": 1000,
         "mission": {"days": 7},
         "best": {"battery_kg": battery_kg, "array_kg": 20.0, "array_m2": 5, "battery_kwh": 60}}
    if supplies:
        r["supplies"] = {"total_kg": supplies, "crew": 4}
    return r


def test_verdict_reports_tonnage_only():
    from lunarsky.power import verdict
    v = verdict(_res(400.0, supplies=200.0))     # supplies left out: 420 kg
    assert v["ok"] is True
    assert v["total_kg"] == pytest.approx(420.0)
    assert v["breakdown_kg"] == {"battery": 400.0, "solar array": 20.0}
    assert v["driver"] == "battery" and "100 h" in v["text"]
    assert "landers" not in v and "$" not in v["text"]


def test_verdict_infeasible():
    from lunarsky.power import verdict
    assert verdict({"feasible": False, "reason": "no sun"})["ok"] is False


@pytest.mark.parametrize("repeat", [True, False])
def test_sizing_scales_with_the_load(repeat):
    # The page re-sizes for a new load by scaling one result, so the array
    # and battery must be exactly proportional to the load.
    rng = np.random.default_rng(1)
    share = np.clip(rng.normal(0.5, 0.4, 24 * 30), 0, 1)
    share[200:330] = 0.0                                  # a long night
    scale = np.full_like(share, 1.03)
    r1 = size_power(share, scale, 1000.0, repeat=repeat)
    r3 = size_power(share, scale, 3000.0, repeat=repeat)
    assert r3["best"]["array_multiple"] == r1["best"]["array_multiple"]
    for k in ("array_m2", "array_kg", "battery_kwh", "battery_kg", "total_kg"):
        assert r3["best"][k] == pytest.approx(3 * r1["best"][k], rel=1e-3, abs=0.2)
    assert r3["break_even_m2"] == pytest.approx(3 * r1["break_even_m2"], rel=1e-3)


def test_water_recovery_cuts_only_water():
    from lunarsky.power import crew_supplies
    none, most = crew_supplies(4, 30), crew_supplies(4, 30, water_recovery=0.9)
    assert most["water_kg"] == pytest.approx(none["water_kg"] * 0.1, abs=0.2)
    assert most["oxygen_kg"] == none["oxygen_kg"] and most["food_kg"] == none["food_kg"]
    assert most["water_recovery"] == 0.9


def test_editable_inputs():
    from lunarsky.power import editable_inputs
    crew = editable_inputs("crew")
    assert "load_w" not in crew            # sized from the load list, no single load figure
    assert sum(i["w"] * (4 if i["per_crew"] else 1) for i in crew["loads"]) == 10_000
    assert crew["crew"]["value"] == 4 and crew["rates"]["o2_per_crew"] > 0


def test_dark_mask_sets_longest_dark():
    # 10 h of full Sun, 5 h of a 3% sliver, 10 h of full Sun.
    share = np.r_[np.ones(10), np.full(5, 0.03), np.ones(10)]
    plain = size_power(share, np.ones_like(share), 1000.0, repeat=False)
    masked = size_power(share, np.ones_like(share), 1000.0, repeat=False, dark=share < 0.5)
    assert plain["longest_dark_hours"] == 0
    assert masked["longest_dark_hours"] == 5
    assert masked["best"] == plain["best"]          # sizing itself is unchanged


def test_daylight_only_load_skips_the_battery():
    # 12 h lit, 12 h dark. The same 1,000 W needs a smaller battery when
    # half of it runs only in daylight.
    from lunarsky.power import size_power
    share = np.array([1.0] * 12 + [0.0] * 12)
    dark = share == 0
    base = size_power(share, np.ones_like(share), 500.0, dark=dark)
    day = size_power(share, np.ones_like(share), 500.0, dark=dark, day_w=500.0)
    always = size_power(share, np.ones_like(share), 1000.0, dark=dark)
    assert day["load_w"] == 1000.0 and day["always_w"] == 500.0 and day["day_w"] == 500.0
    batt = lambda r: min(o["battery_kwh"] for o in r["options"] if o["array_multiple"] == 1.05)
    assert batt(always) > batt(day)
    assert day["simple_battery_kwh"] == base["simple_battery_kwh"]


def test_load_lists_match_their_sources():
    from lunarsky.power import (EDITABLE_LOADS, ESTIMATED_LOADS, EXTRA_LOADS, LOAD_LISTS,
                                load_item, load_split, profile_loads)
    # NASA First Lunar Outpost (TM-105925): 4 crew, 10 kWe by day, 9 kWe at night.
    # The Earth radio is split out of the avionics line and runs only in
    # contact, so with constant contact the list adds back to the memo's.
    always, day, contact = profile_loads("crew", 4)
    assert always + day + contact == pytest.approx(10_000)
    assert always + contact == pytest.approx(9_000) and contact > 0
    # Crew systems are per person: two more crew add 2 x 1.5 kW.
    a6, d6, c6 = profile_loads("crew", 6)
    assert a6 - always == pytest.approx(3_000) and d6 == day and c6 == contact
    assert ESTIMATED_LOADS <= EDITABLE_LOADS
    for items in [*LOAD_LISTS.values(), EXTRA_LOADS]:
        for i, when in items:
            row = load_item(i, when)
            assert row["w"] > 0 and row["source"] and when in ("always", "day", "contact")
            assert row["editable"] == (i in EDITABLE_LOADS)
    assert load_split([{"w": 3, "when": "always"}, {"w": 2, "when": "day", "per_crew": True},
                       {"w": 5, "when": "contact"}], 4) == (3, 8, 5)


@pytest.mark.parametrize("repeat", [True, False])
def test_battery_matches_the_step_by_step_shortfall(repeat):
    """The vectorized battery search equals the plain hour-by-hour loop."""
    rng = np.random.default_rng(7)
    for _ in range(20):
        gen = np.clip(rng.normal(120, 80, 500), 0, None) * (rng.random(500) > 0.3)
        net = (gen - 100.0)
        net = np.where(net > 0, net * 0.9, net)
        if repeat and net.sum() < 0:
            continue
        short = worst = 0.0
        for d in (np.concatenate([net, net]) if repeat else net):
            short = max(0.0, short - d)
            worst = max(worst, short)
        assert battery_needed_wh(gen, 100.0, 1.0, 0.9, repeat) == pytest.approx(worst)


def test_radio_runs_only_in_contact():
    """A contact-only line costs less than the same watts always on, and
    exactly as much when contact is constant."""
    from lunarsky.power import size_power
    share = np.tile(np.r_[np.ones(300), np.zeros(60)], 4).astype(float)
    ones = np.ones_like(share)
    contact = np.tile(np.r_[np.ones(180), np.zeros(180)], 4).astype(bool)
    always = size_power(share, ones, 1300.0)
    part = size_power(share, ones, 1000.0, contact_w=300.0, contact=contact)
    full = size_power(share, ones, 1000.0, contact_w=300.0, contact=np.ones_like(contact))
    assert part["best"]["total_kg"] < always["best"]["total_kg"]
    assert full["best"]["total_kg"] == pytest.approx(always["best"]["total_kg"])
    assert part["contact_fraction"] == pytest.approx(0.5)


def test_data_backlog_through_a_blackout():
    from lunarsky.power import data_backlog
    # 24 h blackout then 24 h contact: 600 Gb piles up (75 GB), and at
    # 110 Mbps (396 Gb/h) it clears in about 2 hours of contact.
    contact = [False] * 24 + [True] * 24
    d = data_backlog(contact, 1.0, gb_per_day=600, rate_mbps=110, repeat=False)
    assert d["storage_gb"] == pytest.approx(75.0, abs=0.1)
    assert d["longest_blackout_hours"] == 24
    # Always in contact: nothing waits more than the hour it's made in.
    assert data_backlog([True] * 48, 1.0, 600, 110)["storage_gb"] < 4
