"""Offline tests for lunarsky. Need the kernels in data/phase-1 and the site list in data/phase-3.

    .venv/bin/python -m pytest tests/
"""

import json
from datetime import datetime, timezone

import numpy as np
import pytest

from lunarsky import (
    horizon_dip_deg,
    hours_to_crossing,
    load_artemis_regions,
    load_kernels,
    load_sites,
    longest_run_hours,
    phase1_metrics,
    site_by_id,
    sky_track,
    true_runs,
)

SYNODIC_DAYS = 29.53
T0 = datetime(2027, 1, 1, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def k():
    return load_kernels()


@pytest.fixture(scope="module")
def sites():
    return load_sites()


# --- data files -----------------------------------------------------------

def test_site_list(sites):
    assert len(sites) == 9
    assert all(s.kind == "artemis_region" for s in sites)
    hw = site_by_id(sites, "artemis-hw")
    assert hw.name == "Haworth"
    assert hw.lat == pytest.approx(-86.36851)
    assert hw.lon == pytest.approx(-23.27645)
    assert hw.avg_sunlit == pytest.approx(0.705)
    assert hw.sunlit_map == "60m"
    assert len({s.id for s in sites}) == 9, "site ids must be unique"
    with pytest.raises(KeyError):
        site_by_id(sites, "nope")


def test_artemis_regions_geojson():
    gj = load_artemis_regions()
    assert gj["type"] == "FeatureCollection"
    assert len(gj["features"]) == 9


def test_missing_kernels_message(tmp_path):
    with pytest.raises(FileNotFoundError) as exc:
        load_kernels(tmp_path)
    assert "curl" in str(exc.value)


# --- sky geometry sanity checks --------------------------------------------

def test_near_side_equator(k):
    # A near-side point on the equator, 23.5 deg east of the sub-Earth point.
    tr = sky_track(k, 0.67, 23.47, T0, 2 * SYNODIC_DAYS)
    m = phase1_metrics(tr)
    # Two weeks of day, two weeks of night.
    assert 0.47 < m["sun"]["sunlit_fraction"] < 0.53
    assert 13.5 * 24 < m["sun"]["longest_dark_hours"] < 15.5 * 24
    assert m["sun"]["max_elevation_deg"] > 85  # Sun passes near the zenith
    # Earth hangs ~66 deg up (90 - 23.5 deg of longitude) and never sets.
    assert m["earth"]["visible_fraction"] == 1.0
    assert 55 < tr.earth_el.min() and tr.earth_el.max() < 78
    assert m["earth"]["hours_to_next_set"] is None
    assert m["earth"]["longest_blackout_hours"] == 0.0


def test_farside_never_sees_earth(k):
    tr = sky_track(k, -45.46, 177.59, T0, SYNODIC_DAYS)
    m = phase1_metrics(tr)
    assert tr.earth_el.max() < -30
    assert m["earth"]["visible_fraction"] == 0.0
    assert m["earth"]["longest_blackout_hours"] == pytest.approx(m["window"]["hours"], abs=1.0)
    assert m["earth"]["hours_to_next_rise"] is None


def test_south_pole_sun_grazes_horizon(k):
    tr = sky_track(k, -89.5, 0.0, T0, 365)
    assert -3.0 < tr.sun_el.min() and tr.sun_el.max() < 3.0
    m = phase1_metrics(tr)
    # Smooth Moon: roughly half the time lit over a year, with the disk rule nudging it up.
    assert 0.40 < m["sun"]["sunlit_fraction"] < 0.70
    # Earth wanders in and out of view with libration at this latitude.
    assert 0.0 < m["earth"]["visible_fraction"] < 1.0


def test_disk_rules_nest(k):
    tr = sky_track(k, -85.0, 30.0, T0, 60)
    full, center, any_ = tr.sunlit(rule="full"), tr.sunlit(rule="center"), tr.sunlit(rule="any")
    assert np.all(full <= center) and np.all(center <= any_)
    assert full.sum() < any_.sum()
    with pytest.raises(ValueError):
        tr.sunlit(rule="bogus")


def test_sun_radius_about_quarter_degree(k):
    tr = sky_track(k, 0.0, 0.0, T0, 1)
    assert tr.sun_radius_deg.mean() == pytest.approx(0.267, abs=0.01)
    assert tr.earth_radius_deg.mean() == pytest.approx(0.95, abs=0.1)


def test_window_shape_and_json(k):
    tr = sky_track(k, -86.0, 2.0, T0, 30, step_hours=1.0)
    assert len(tr) == 721
    assert tr.hours[-1] == pytest.approx(720.0)
    d = tr.to_dict()
    json.dumps(d)
    assert len(d["times_utc"]) == 721
    assert d["times_utc"][0] == "2027-01-01T00:00:00Z"
    json.dumps(phase1_metrics(tr))


def test_height_lowers_horizon_slightly(k):
    tr = sky_track(k, -89.5, 0.0, T0, 60)
    ground = tr.sunlit(horizon_deg=0.0).sum()
    mast = tr.sunlit(horizon_deg=-horizon_dip_deg(10.0)).sum()
    assert mast >= ground


def test_outside_kernel_range(k):
    with pytest.raises(ValueError):
        sky_track(k, 0.0, 0.0, datetime(2050, 6, 1, tzinfo=timezone.utc), 1)
    with pytest.raises(ValueError):
        sky_track(k, 0.0, 0.0, datetime(2049, 12, 31, tzinfo=timezone.utc), 2)
    with pytest.raises(ValueError):
        sky_track(k, 95.0, 0.0, T0, 1)


# --- pure helpers -----------------------------------------------------------

def test_true_runs_and_longest():
    mask = np.array([True, True, False, True, False, False, True, True, True])
    assert true_runs(mask) == [(0, 2), (3, 4), (6, 9)]
    assert longest_run_hours(mask, 2.0) == 6.0
    assert longest_run_hours(np.zeros(5, dtype=bool), 1.0) == 0.0
    assert true_runs(np.array([], dtype=bool)) == []


def test_crossing_interpolation():
    margin = np.array([1.0, 0.5, -0.5, -1.0, 0.5])
    assert hours_to_crossing(margin, 1.0, "down") == pytest.approx(1.5)
    assert hours_to_crossing(margin, 1.0, "up") == pytest.approx(3.0 + 1.0 / 1.5)
    assert hours_to_crossing(margin, 0.5, "down") == pytest.approx(0.75)
    assert hours_to_crossing(np.array([1.0, 2.0]), 1.0, "down") is None
    assert hours_to_crossing(np.array([1.0]), 1.0, "down") is None


def test_horizon_dip():
    assert horizon_dip_deg(0.0) == 0.0
    assert horizon_dip_deg(2.0) == pytest.approx(0.087, abs=0.005)
    assert horizon_dip_deg(10.0) == pytest.approx(0.194, abs=0.005)


# --- terrain skyline in the metrics ------------------------------------------

def make_skyline(el_by_az, heights=(0.0, 2.0)):
    """A hand-made Skyline: same elevation profile at every eye height."""
    from lunarsky.terrain import Skyline
    az = np.arange(0.0, 360.0, 0.5)
    row = np.array([el_by_az(a) for a in az], dtype=float)
    return Skyline(lat=-89.5, lon=0.0, heights_m=heights, az_deg=az,
                   el_deg=np.tile(row, (len(heights), 1)), ground_m=0.0,
                   reach_km=np.full(az.size, 300.0), max_km=300.0, source="test")


def test_flat_skyline_matches_smooth_moon(k):
    tr = sky_track(k, -89.5, 0.0, T0, 60)
    flat = make_skyline(lambda a: 0.0)
    smooth, terrain = phase1_metrics(tr), phase1_metrics(tr, skyline=flat)
    assert terrain["sun"]["sunlit_fraction"] == smooth["sun"]["sunlit_fraction"]
    assert terrain["earth"]["visible_fraction"] == smooth["earth"]["visible_fraction"]
    assert terrain["horizon"]["terrain"] is True
    assert terrain["horizon"]["source"] == "test"
    json.dumps(terrain)


def test_wall_blocks_sun_only_in_its_directions(k):
    tr = sky_track(k, -89.5, 0.0, T0, 60)
    wall = make_skyline(lambda a: 10.0 if a < 180.0 else 0.0)   # 10 deg wall from north to south via east
    d = tr.to_dict(skyline=wall)
    az = tr.sun_az % 360.0
    east = az < 180.0
    west = (az > 180.5) & (az < 359.5)       # skip the 0.5 deg blend at each wall edge
    lit = np.array(d["sunlit"])
    assert not lit[east].any()                                   # wall is far above the low polar Sun
    np.testing.assert_array_equal(lit[west], tr.sunlit()[west])  # west half unchanged
    m = phase1_metrics(tr, skyline=wall)
    # Sunlit % counts each hour by how much of the disk clears the wall.
    share = tr.sun_share(wall.horizon_at(tr.sun_az, tr.height_m))
    assert m["sun"]["sunlit_fraction"] == pytest.approx(share.mean())
    assert m["sun"]["sunlit_fraction"] <= lit.mean()


def test_skyline_height_choice(k):
    tr = sky_track(k, -89.5, 0.0, T0, 10)
    sky = make_skyline(lambda a: 0.0)
    assert phase1_metrics(tr, skyline=sky, height_m=2)["horizon"]["height_m"] == 2.0
    with pytest.raises(ValueError):
        phase1_metrics(tr, skyline=sky, height_m=5)               # no 5 m skyline
    with pytest.raises(ValueError):
        phase1_metrics(tr, horizon_deg=-0.1, skyline=sky)         # two horizons at once
