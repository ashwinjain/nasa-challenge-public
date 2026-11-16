"""Tests for lunarsky.panels: the solar panel site search.

The synthetic tests use small made-up maps; the last one uses the real
maps in data/phase-2 and data/phase-6 and is skipped without them.
"""

from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from lunarsky import load_kernels
from lunarsky.panels import _offset, find_panel_site, merge_panel_parts, ring_offsets, slope_deg
from lunarsky.terrain import Dems, HeightMap, latlon_to_map

DATA = Path(__file__).resolve().parent.parent / "data"
T0 = datetime(2027, 1, 1, tzinfo=timezone.utc)
SITE = (-89.0, 0.0)


@pytest.fixture(scope="module")
def k():
    return load_kernels()


def plane_map(slope_x: float = 0.0, half_km: float = 400.0, pixel_m: float = 200.0) -> Dems:
    """A plane ``height = slope_x * map_x`` around the pole."""
    n = int(2 * half_km * 1000 / pixel_m)
    xs = -half_km * 1000 + (np.arange(n) + 0.5) * pixel_m
    h = np.tile((slope_x * xs).astype(np.float32), (n, 1))
    return Dems([HeightMap(h, x0=-half_km * 1000.0, y0=half_km * 1000.0, dx=pixel_m, dy=-pixel_m)])


def test_ring_offsets_stay_in_the_ring():
    e, n = ring_offsets(100, 300, 20)
    d = np.hypot(e, n)
    assert d.min() >= 100 and d.max() <= 300
    # Area of the ring / area of a grid cell, within a few percent.
    assert len(e) == pytest.approx(np.pi * (300**2 - 100**2) / 400, rel=0.05)


def test_offset_distance_and_direction():
    la, lo = _offset(*SITE, 0.0, 300.0)          # 300 m due north
    assert la == pytest.approx(SITE[0] + np.degrees(300 / 1737400), abs=1e-9)
    assert lo == pytest.approx(SITE[1], abs=1e-6)
    x0, y0 = latlon_to_map(*SITE)
    x1, y1 = latlon_to_map(*_offset(*SITE, 200.0, 0.0))   # 200 m east
    assert np.hypot(x1 - x0, y1 - y0) == pytest.approx(200.0, rel=0.01)


def test_slope_of_a_tilted_plane():
    assert slope_deg(plane_map(0.0), *SITE) == pytest.approx(0.0, abs=1e-6)
    assert slope_deg(plane_map(np.tan(np.radians(10))), *SITE) == pytest.approx(10.0, abs=0.2)


def test_flat_ground_gains_nothing(k):
    r = find_panel_site(k, *SITE, T0, days=10, dems=plane_map(0.0), spacing_m=50)
    best = r["picks"]["most_sunlight"]
    assert r["settings"]["too_steep"] == 0
    assert best["sunlit_fraction"] == pytest.approx(r["landing"]["sunlit_fraction"], abs=0.01)
    assert 100 <= best["distance_m"] <= 300


def test_too_steep_spots_are_listed_but_not_picked(k):
    r = find_panel_site(k, *SITE, T0, days=10, dems=plane_map(np.tan(np.radians(30))), spacing_m=50)
    assert r["candidates"] and all(c["too_steep"] for c in r["candidates"])
    assert r["picks"] == {"most_sunlight": None, "shortest_night": None}


def test_no_terrain_raises(k):
    with pytest.raises(ValueError):
        find_panel_site(k, 0.0, 0.0, T0, days=2, dems=plane_map(0.0))


@pytest.mark.skipif(not (DATA / "phase-6/LDEM_80S_20MPP_ADJ.TIF").exists(), reason="20 m map not downloaded")
def test_real_site_small_ring(k):
    r = find_panel_site(k, -86.00114, 2.05502, T0, days=60, min_m=100, max_m=140)
    assert "20MPP" in r["settings"]["source"]
    for pick in r["picks"].values():
        assert 100 <= pick["distance_m"] <= 140 and pick["slope_deg"] <= 20
    most = r["picks"]["most_sunlight"]
    assert all(c["sunlit_fraction"] <= most["sunlit_fraction"] for c in r["candidates"] if not c["too_steep"])


def test_path_check_blocks_spots_behind_a_steep_wall(k):
    """Flat ground with a 30° wall 90–130 m east: spots past it are flat but unreachable."""
    sx, sy = (float(v) for v in latlon_to_map(*SITE))
    px, half = 10.0, 1000.0
    n = int(2 * half / px)
    xs = sx - half + (np.arange(n) + 0.5) * px
    rise = np.clip(xs - (sx + 90.0), 0.0, 40.0) * np.tan(np.radians(30))
    h = np.tile(rise.astype(np.float32), (n, 1))
    dems = Dems([HeightMap(h, x0=sx - half, y0=sy + half, dx=px, dy=-px)])
    r = find_panel_site(k, *SITE, T0, days=2, dems=dems, min_m=0, max_m=200,
                        spacing_m=20, check_path=True)
    flat = [c for c in r["candidates"] if not c["too_steep"]]
    east = [c for c in flat if c["east_m"] >= 160 and abs(c["north_m"]) <= 20]
    west = [c for c in flat if c["east_m"] <= -60]
    assert east and all(c["path_blocked"] for c in east)
    assert west and not any(c["path_blocked"] for c in west)
    assert r["settings"]["path_blocked"] > 0


def test_size_for_adds_the_lightest_kit_pick(k):
    """Every walkable spot gets a kit mass, and lightest_kit is the lightest of them."""
    r = find_panel_site(k, *SITE, T0, days=10, dems=plane_map(np.tan(np.radians(5))),
                        spacing_m=50, height_m=10.0, size_for="crew")
    assert set(r["picks"]) == {"most_sunlight", "shortest_night", "lightest_kit"}
    assert r["settings"]["size_for"] == "crew"
    sized = [c["kit_kg"] for c in r["candidates"] if c.get("kit_kg") is not None]
    assert sized and r["landing"]["kit_kg"] is not None
    lightest = r["picks"]["lightest_kit"]
    assert lightest["kit_kg"] == min(sized)
    assert lightest["kit_kg_saved"] == pytest.approx(r["landing"]["kit_kg"] - lightest["kit_kg"], abs=0.11)
    for name in ("most_sunlight", "shortest_night"):
        assert lightest["kit_kg"] <= r["picks"][name]["kit_kg"]


def test_without_size_for_no_kit_is_computed(k):
    r = find_panel_site(k, *SITE, T0, days=10, dems=plane_map(0.0), spacing_m=50)
    assert "lightest_kit" not in r["picks"]
    assert not any("kit_kg" in c for c in r["candidates"])


def bumpy_map(half_km: float = 400.0, pixel_m: float = 50.0) -> Dems:
    """Rolling hills around the pole, so the spots differ and ties are rare."""
    n = int(2 * half_km * 1000 / pixel_m)
    xs = -half_km * 1000 + (np.arange(n) + 0.5) * pixel_m
    X, Y = np.meshgrid(xs, -xs)
    h = (40 * np.sin(X / 900) * np.cos(Y / 700) + 0.05 * X).astype(np.float32)
    return Dems([HeightMap(h, x0=-half_km * 1000.0, y0=half_km * 1000.0, dx=pixel_m, dy=-pixel_m)])


@pytest.mark.parametrize("parts", [1, 3, 7])
def test_parts_merge_to_the_single_search(k, parts):
    """The queue's split search (api-worker) gives exactly the one-call answer."""
    kw = dict(days=10, dems=bumpy_map(), min_m=100, max_m=500, spacing_m=100,
              size_for="crew", check_path=True)
    whole = find_panel_site(k, *SITE, T0, **kw)
    sliced = [find_panel_site(k, *SITE, T0, part=i, parts=parts, **kw) for i in range(parts)]
    assert sum(len(r["candidates"]) for r in sliced) == len(whole["candidates"])
    merged = merge_panel_parts(sliced[::-1])          # the order the parts finish in doesn't matter
    assert merged == whole


def test_merge_needs_every_part_once(k):
    kw = dict(days=2, dems=plane_map(0.0), spacing_m=100, parts=3)
    a, b = (find_panel_site(k, *SITE, T0, part=i, **kw) for i in (0, 1))
    with pytest.raises(ValueError):
        merge_panel_parts([a, b])
    with pytest.raises(ValueError):
        merge_panel_parts([a, a, b])
    with pytest.raises(ValueError):
        find_panel_site(k, *SITE, T0, part=3, **kw)
