"""Phase 6 landing-target search: geometry and slope helpers on synthetic data."""

import math

import numpy as np
import pytest

from lunarsky.landing import (
    _inside,
    disk_stats,
    latlon_xy,
    map_to_latlon,
    scale_factor,
    slope_map,
    spread_out,
)
from lunarsky.terrain import latlon_to_map


def test_projection_matches_terrain_and_round_trips():
    for lat, lon in [(-85.44402, 32.19651), (-89.9, -120.0), (-80.13, 1.44)]:
        x, y = latlon_xy(lat, lon)
        tx, ty = latlon_to_map(lat, lon)
        assert x == pytest.approx(float(tx), abs=1e-6)
        assert y == pytest.approx(float(ty), abs=1e-6)
        la, lo = map_to_latlon(x, y)
        assert la == pytest.approx(lat, abs=1e-9)
        assert lo == pytest.approx(lon, abs=1e-9)


def test_scale_factor_matches_formula():
    lat = -80.0
    x, y = latlon_xy(lat, 0.0)
    assert scale_factor(x, y) == pytest.approx(2 / (1 + math.sin(math.radians(80))), rel=1e-9)
    assert scale_factor(0.0, 0.0) == pytest.approx(1.0)


def _plane(deg, n=40, px=20.0, x0=0.0, y0=0.0):
    """A plane tilted ``deg`` toward +x, near the pole (scale ≈ 1)."""
    xs = x0 + (np.arange(n) + 0.5) * px
    ys = y0 - (np.arange(n) + 0.5) * px
    h = np.tan(math.radians(deg)) * xs[None, :].repeat(n, 0)
    return h, xs, ys


def test_slope_of_a_tilted_plane():
    h, xs, ys = _plane(7.0)
    s = slope_map(h, xs, ys)
    assert np.isnan(s[0, 0]) and np.isnan(s[-1, -1])
    assert np.nanmax(np.abs(s - 7.0)) < 1e-3


def test_disk_stats_flat_share_and_steepest():
    s = np.full((30, 30), 5.0)
    s[15, 15] = 30.0                       # one steep pixel
    frac, mx = disk_stats(s, radius_px=5.0, limit_deg=10.0)
    n = sum(1 for i in range(-5, 6) for j in range(-5, 6) if i * i + j * j <= 25)
    assert frac[15, 15] == pytest.approx(1 - 1 / n)
    assert mx[15, 15] == 30.0
    assert frac[15, 23] == pytest.approx(1.0)      # disk misses the steep pixel
    assert np.isnan(frac[0, 0])                     # disk runs off the edge


def test_missing_pixels_count_as_not_flat():
    s = np.full((20, 20), 2.0)
    s[10, 10] = np.nan
    frac, _ = disk_stats(s, radius_px=3.0, limit_deg=10.0)
    assert frac[10, 10] < 1.0


def test_spread_out_keeps_targets_apart():
    x = np.array([0.0, 100.0, 600.0, 650.0, 2000.0])
    y = np.zeros(5)
    picks = spread_out(np.arange(5), x, y, n=10, min_sep_m=500.0)
    assert picks == [0, 2, 4]
    assert spread_out(np.arange(5), x, y, n=2, min_sep_m=500.0) == [0, 2]


def test_inside_polygon():
    px = np.array([0.0, 10.0, 10.0, 0.0, 0.0])
    py = np.array([0.0, 0.0, 10.0, 10.0, 0.0])
    got = _inside(px, py, np.array([5.0, 15.0, -1.0]), np.array([5.0, 5.0, 5.0]))
    assert got.tolist() == [True, False, False]


def test_ellipse_contact_on_flat_ground_is_the_same_everywhere():
    """Flat ground: every touchdown point sees Earth the same, so worst = target."""
    from datetime import datetime, timezone

    from lunarsky import load_kernels
    from lunarsky.dsn import dsn_visible
    from lunarsky.landing import ellipse_contact
    from lunarsky.relay import relay_tracks
    from lunarsky.terrain import Dems, HeightMap

    k = load_kernels()
    start = datetime(2027, 1, 1, tzinfo=timezone.utc)
    n, px = 4000, 200.0
    dems = Dems([HeightMap(np.zeros((n, n), np.float32), x0=-n * px / 2, y0=n * px / 2, dx=px, dy=-px)])
    dsn = dsn_visible(k, start, 5)["any"]
    r = ellipse_contact(k, -89.0, 0.0, start, 5, dems, dsn, relay_tracks(k, start, 5))
    assert r["points"] >= 15
    lo, hi = r["spread_direct"]
    assert hi - lo < 0.02
    assert r["worst_direct"]["direct"] == pytest.approx(r["at_target"]["direct"], abs=0.02)
    assert r["at_target"]["with_relay"] >= r["at_target"]["direct"]
