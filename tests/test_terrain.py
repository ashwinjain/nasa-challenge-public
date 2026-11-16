"""Tests for lunarsky.terrain: projection, map lookups and skylines.

Most tests use small synthetic maps, so they run without the big LOLA files.
The last few use the real maps in data/phase-2 and are skipped if those
aren't downloaded.
"""

from pathlib import Path

import numpy as np
import pytest

from lunarsky import horizon_dip_deg
from lunarsky.terrain import (
    R_M,
    Dems,
    HeightMap,
    Skyline,
    compute_skyline,
    latlon_to_map,
    sample_distances,
)

DATA = Path(__file__).resolve().parent.parent / "data"
HAVE_MAPS = all((DATA / f"phase-2/{f}").exists()
                for f in ("LDEM_80S_80MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF"))

SITE = (-85.0, 0.0)       # synthetic tests stand here


def flat_map(half_km=500, pixel_m=1000.0) -> HeightMap:
    """A flat map (height 0) centered on the pole, ±half_km on each side."""
    n = int(2 * half_km * 1000 / pixel_m)
    return HeightMap(np.zeros((n, n), dtype=np.float32),
                     x0=-half_km * 1000.0, y0=half_km * 1000.0, dx=pixel_m, dy=-pixel_m, name="flat")


def destination(lat, lon, bearing_deg, km):
    """Standard great-circle destination formula (independent of terrain.py's vectors)."""
    p1, l1, b = np.radians(lat), np.radians(lon), np.radians(bearing_deg)
    d = km * 1000.0 / R_M
    p2 = np.arcsin(np.sin(p1) * np.cos(d) + np.cos(p1) * np.sin(d) * np.cos(b))
    l2 = l1 + np.arctan2(np.sin(b) * np.sin(d) * np.cos(p1), np.cos(d) - np.sin(p1) * np.sin(p2))
    return float(np.degrees(p2)), float(np.degrees(l2))


def raise_block(m: HeightMap, lat, lon, height_m, half_px=3):
    """Put a square plateau of ``height_m`` centered on lat/lon."""
    x, y = latlon_to_map(lat, lon)
    col = int((x - m.x0) / m.dx)
    row = int((y - m.y0) / m.dy)
    m.heights[row - half_px:row + half_px + 1, col - half_px:col + half_px + 1] = height_m


# ── Projection and lookups ───────────────────────────────────────────────────

def test_projection_matches_pyproj():
    pyproj = pytest.importorskip("pyproj")
    moon_ll = pyproj.CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")
    stere = pyproj.CRS.from_proj4("+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs")
    to_map = pyproj.Transformer.from_crs(moon_ll, stere, always_xy=True)
    lat = np.array([-89.99, -86.00114, -83.6, -75.0, -60.0, -89.5])
    lon = np.array([0.0, 2.05502, 120.0, -45.0, 200.0, -179.9])
    want_x, want_y = to_map.transform(lon, lat)
    got_x, got_y = latlon_to_map(lat, lon)
    np.testing.assert_allclose(got_x, want_x, atol=1e-3)
    np.testing.assert_allclose(got_y, want_y, atol=1e-3)


def test_pole_is_map_origin():
    x, y = latlon_to_map(-90.0, 0.0)
    assert abs(x) < 1e-6 and abs(y) < 1e-6


def test_bilinear_reproduces_a_plane():
    m = flat_map(half_km=10, pixel_m=1000.0)
    rows, cols = m.heights.shape
    cx = m.x0 + (np.arange(cols) + 0.5) * m.dx            # pixel centers
    cy = m.y0 + (np.arange(rows) + 0.5) * m.dy
    m.heights[:] = (cx[None, :] + 2 * cy[:, None]).astype(np.float32)
    x = np.array([-3210.0, 0.0, 4321.5])
    y = np.array([2500.0, -1234.0, 0.0])
    np.testing.assert_allclose(m.sample(x, y), x + 2 * y, atol=0.1)


def test_sample_outside_map_is_nan():
    m = flat_map(half_km=10)
    assert np.isnan(m.sample(np.array([50_000.0]), np.array([0.0]))[0])


def test_dems_fall_back_to_coarser_map():
    near = flat_map(half_km=10, pixel_m=100.0)
    near.heights[:] = 1.0
    far = flat_map(half_km=100, pixel_m=1000.0)
    far.heights[:] = 2.0
    d = Dems([near, far])
    np.testing.assert_array_equal(d.sample(np.array([0.0, 50_000.0]), np.array([0.0, 0.0])), [1.0, 2.0])


def test_sample_distances_grow_and_end_at_max():
    d = sample_distances(80.0, max_km=300)
    assert d[0] == pytest.approx(160.0)
    assert d[1] - d[0] == pytest.approx(80.0)
    assert d[-1] == pytest.approx(300_000.0)
    steps = np.diff(d[:-1])
    assert np.all(np.diff(steps) > 0)                    # each step longer than the last
    assert 400 < len(d) < 1000


# ── Skylines on synthetic terrain ────────────────────────────────────────────

def test_flat_moon_skyline_is_the_horizon_dip():
    sky = compute_skyline(*SITE, heights_m=(0, 10), n_az=72, dems=Dems([flat_map()]))
    assert sky.ground_m == 0.0
    # At ground level the nearest sample (2 km out) is a hair below eye level.
    assert np.all(sky.el_deg[0] < 0) and np.all(sky.el_deg[0] > -0.05)
    # From 10 m up, the skyline is the smooth-Moon dip from Phase 1.
    np.testing.assert_allclose(sky.el_deg[1], -horizon_dip_deg(10), atol=0.01)
    assert not sky.partial


def test_mountain_to_the_north_shows_up_at_azimuth_0():
    m = flat_map()
    raise_block(m, -84.0, 0.0, 3000.0)             # 1° (30.3 km) due north of the site
    sky = compute_skyline(*SITE, heights_m=(0,), n_az=720, dems=Dems([m]))
    el = sky.el_deg[0]
    peak = sky.az_deg[np.argmax(el)]
    assert min(peak, 360 - peak) <= 1.0
    # 3 km up, 27–31 km away, minus curvature: about 5–6.5° above eye level.
    assert 5.0 < el.max() < 6.5
    assert 26 < sky.blocker_km[0][np.argmax(el)] < 32
    # The other way is flat.
    assert sky.horizon_at(180) < 0


def test_mountain_to_the_east_shows_up_at_azimuth_90():
    m = flat_map()
    raise_block(m, *destination(*SITE, 90.0, 60.0), 3000.0)   # 60 km due east
    sky = compute_skyline(*SITE, heights_m=(0,), n_az=720, dems=Dems([m]))
    peak = sky.az_deg[np.argmax(sky.el_deg[0])]
    assert 85 <= peak <= 95                        # east, not west
    assert sky.horizon_at(270) < 0


def test_raising_the_eye_lowers_a_nearby_bump_more_than_a_distant_one():
    m = flat_map(pixel_m=200.0)
    raise_block(m, *destination(*SITE, 0.0, 0.6), 5.0, half_px=1)       # 5 m bump 600 m north
    raise_block(m, *destination(*SITE, 90.0, 40.0), 2000.0, half_px=2)  # 2 km mountain 40 km east
    sky = compute_skyline(*SITE, heights_m=(0, 10), n_az=360, dems=Dems([m]))
    near_drop = sky.horizon_at(0, 0) - sky.horizon_at(0, 10)
    far_drop = sky.horizon_at(90, 0) - sky.horizon_at(90, 10)
    assert near_drop > 0.5                         # the bump nearly disappears
    assert far_drop < 0.05                         # the mountain barely moves


def test_curvature_hides_a_distant_mountain():
    # 1 km tall, 250 km away: below eye level once the Moon curves away.
    m = flat_map(half_km=600)
    raise_block(m, -85.0 + np.degrees(250_000 / R_M), 0.0, 1000.0)
    sky = compute_skyline(*SITE, heights_m=(0,), n_az=360, dems=Dems([m]))
    assert sky.horizon_at(0) < 0


def test_ray_off_the_map_is_partial():
    sky = compute_skyline(*SITE, heights_m=(0,), n_az=36, dems=Dems([flat_map(half_km=200)]))
    assert sky.partial
    assert sky.reach_km.min() < 300


def test_no_data_at_site_raises():
    with pytest.raises(ValueError, match="no terrain data"):
        compute_skyline(-40.0, 0.0, dems=Dems([flat_map(half_km=50)]))


def test_round_trip_and_horizon_wraps():
    m = flat_map()
    raise_block(m, -84.0, 0.0, 3000.0)
    sky = compute_skyline(*SITE, heights_m=(0, 2), n_az=72, dems=Dems([m]))
    back = Skyline.from_dict(sky.to_dict())
    np.testing.assert_allclose(back.el_deg, sky.el_deg, atol=1e-4)
    assert back.heights_m == (0.0, 2.0)
    assert sky.horizon_at(360.0) == pytest.approx(sky.horizon_at(0.0))
    assert sky.horizon_at(-5.0) == pytest.approx(sky.horizon_at(355.0))
    with pytest.raises(ValueError):
        sky.horizon_at(0, height_m=7)


# ── Real LOLA maps ───────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real_dems():
    if not HAVE_MAPS:
        pytest.skip("LOLA maps not downloaded (see data/phase-2/README.md)")
    from lunarsky.terrain import load_dems
    return load_dems(source="local")


def test_real_map_heights(real_dems):
    # (0, 0) is a pixel corner; the pixel just past it is the one rasterio's
    # index(0, 0) reads, centered at (40, -40) m.
    pole = real_dems.sample(np.array([40.0]), np.array([-40.0]))[0]
    assert pole == pytest.approx(1282.3, abs=0.1)
    x, y = latlon_to_map(-86.00114, 2.05502)          # Malapert Massif
    assert 5000 < real_dems.sample(np.atleast_1d(x), np.atleast_1d(y))[0] < 5300


def test_real_skyline_is_sane(real_dems):
    sky = compute_skyline(-86.00114, 2.05502, dems=real_dems)   # Malapert, near its top
    assert not sky.partial
    assert np.all(np.isfinite(sky.el_deg))
    # Standing on a 5 km massif: much of the skyline is below eye level.
    assert np.median(sky.el_deg[0]) < 0
    assert np.all(sky.el_deg[2] <= sky.el_deg[0] + 1e-9)        # 10 m up never sees more terrain


# --- the 20 m window ----------------------------------------------------------

def test_missing_fine_map_falls_back():
    d = Dems([flat_map()], fine_name="phase-6/NO_SUCH_MAP.TIF")
    assert d.with_fine_window(0.0, 0.0) is d
    sky = compute_skyline(*SITE, dems=d, n_az=8, max_km=50)
    assert "NO_SUCH" not in sky.source


FINE = DATA / "phase-6/LDEM_80S_20MPP_ADJ.TIF"


@pytest.mark.skipif(not FINE.exists(), reason="20 m map not downloaded")
def test_fine_window_reads_the_right_square():
    x, y = latlon_to_map(-86.00114, 2.05502)
    win = HeightMap.window_from_raster("phase-6/LDEM_80S_20MPP_ADJ.TIF", float(x), float(y), 2000.0)
    assert win.pixel_m == 20.0
    assert win.heights.shape == (200, 200)
    # Same ground as the 80 m map to within a few meters (the maps share one survey).
    near = HeightMap.window_from_raster("phase-2/LDEM_80S_80MPP_ADJ.TIF", float(x), float(y), 2000.0)
    assert abs(float(win.sample(x, y)) - float(near.sample(x, y))) < 15.0
    assert HeightMap.window_from_raster("phase-6/LDEM_80S_20MPP_ADJ.TIF", 1e7, 1e7, 1000.0) is None
