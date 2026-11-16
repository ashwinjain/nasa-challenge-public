"""Tests for lunarsky.windows: sun/Earth up-time runs for the planning views."""

import json
from datetime import datetime, timezone

import numpy as np
import pytest

from lunarsky import load_kernels, sky_track
from lunarsky.windows import horizon_key, visibility_windows

T0 = datetime(2027, 1, 1, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def k():
    return load_kernels()


@pytest.fixture(scope="module")
def track(k):
    return sky_track(k, -89.5, 0.0, T0, 60)


def mask_from(runs, n):
    m = np.zeros(n, dtype=bool)
    for a, b in runs:
        m[a:b] = True
    return m


def flat_skyline(el=0.0, heights=(0.0, 2.0)):
    from lunarsky.terrain import Skyline
    az = np.arange(0.0, 360.0, 0.5)
    return Skyline(lat=-89.5, lon=0.0, heights_m=heights, az_deg=az,
                   el_deg=np.full((len(heights), az.size), el), ground_m=0.0,
                   reach_km=np.full(az.size, 300.0), max_km=300.0, source="test")


def test_horizon_keys():
    assert horizon_key(None) == "smooth"
    assert horizon_key(2.0) == "terrain_2"
    assert horizon_key(0) == "terrain_0"


def test_runs_rebuild_the_flags(track):
    w = visibility_windows(track)
    n = w["samples"]
    assert n == len(track)
    sm = w["horizons"]["smooth"]
    assert np.array_equal(mask_from(sm["sun"], n), track.sunlit())
    assert np.array_equal(mask_from(sm["earth"], n), track.earth_visible())
    assert w["terrain_source"] is None and list(w["horizons"]) == ["smooth"]
    json.dumps(w)


def test_flat_skyline_matches_smooth(track):
    w = visibility_windows(track, flat_skyline(0.0))
    assert set(w["horizons"]) == {"smooth", "terrain_0", "terrain_2"}
    assert w["horizons"]["terrain_2"] == w["horizons"]["smooth"]
    assert w["terrain_source"] == "test"


def test_high_wall_blocks_everything(track):
    w = visibility_windows(track, flat_skyline(45.0))
    assert w["horizons"]["terrain_0"] == {"sun": [], "sun_part": [], "earth": []}


def test_sun_part_marks_partly_hidden_hours():
    # Smooth Moon at the pole: the Sun skims the horizon, so some hours show
    # only part of the disk. Every dim run sits inside a Sun-up run.
    k = load_kernels()
    track = sky_track(k, -89.5, 0.0, datetime(2027, 1, 1, tzinfo=timezone.utc), 365)
    h = visibility_windows(track)["horizons"]["smooth"]
    up = np.zeros(len(track), bool)
    for a, b in h["sun"]:
        up[a:b] = True
    assert h["sun_part"]
    for a, b, v in h["sun_part"]:
        assert 1 <= v <= 99 and up[a:b].all()


# ── DSN ──

def test_dsn_lines_up_with_sky_track(k, track):
    from lunarsky.dsn import STATIONS, dsn_visible, dsn_windows
    w = dsn_windows(k, T0, 60)
    assert w["samples"] == len(track)
    assert set(w["runs"]) == {s.id for s in STATIONS} | {"any"}
    vis = dsn_visible(k, T0, 60)
    assert np.array_equal(mask_from(w["runs"]["any"], w["samples"]), vis["any"])
    json.dumps(w)


def test_dsn_covers_most_hours_with_short_gaps(k):
    from lunarsky.dsn import dsn_visible
    from lunarsky.metrics import true_runs
    vis = dsn_visible(k, T0, 60)
    # Three complexes ~120° apart: each sees the Moon ~40% of the time, and
    # together almost always, with gaps of an hour or two at handoffs.
    for sid in ("goldstone", "madrid", "canberra"):
        assert 0.3 < vis[sid].mean() < 0.5
    assert vis["any"].mean() > 0.9
    assert max(b - a for a, b in true_runs(~vis["any"])) <= 6


# ── Relay ──

def test_relay_frame_matches_skyfield(k):
    """Earth's direction through the relay code's site frame matches sky_track."""
    from lunarsky.relay import RelayTrack, relay_az_el, relay_track
    rt = relay_track(k, T0, 2, substeps=1)
    t = k.ts.utc(2027, 1, 1, np.arange(rt.samples))
    earth = (k.earth - k.moon).at(t).position.km.T
    fake = RelayTrack(np.einsum("ijn,nj->ni", k.frame.rotation_at(t), earth), rt.sees_earth, rt.samples, 1)
    az, el = relay_az_el(fake, -86.37, -23.28)
    st = sky_track(k, -86.37, -23.28, T0, 2)
    assert np.abs(((az - st.earth_az + 180) % 360) - 180).max() < 0.01
    assert np.abs(el - st.earth_el).max() < 0.01


def test_relay_period_and_coverage(k, track):
    from lunarsky.metrics import true_runs
    from lunarsky.relay import ELFO, relay_track, relay_usable
    assert 10.5 < ELFO.period_s / 3600 < 11.2          # Lunar Pathfinder: ~10.8 h
    rt = relay_track(k, T0, 60)
    use = relay_usable(rt, track.lat, track.lon)
    # Aposelene over the south pole: up most of each orbit, gaps of a few hours.
    assert 0.6 < use.mean() < 0.9
    assert max(b - a for a, b in true_runs(~use)) <= 6
    w = visibility_windows(track, flat_skyline(0.0), relay=rt)
    for h in w["horizons"].values():
        assert np.array_equal(mask_from(h["relay"], w["samples"]), use)


def test_two_relays_close_the_gaps(k, track):
    from lunarsky.metrics import true_runs
    from lunarsky.relay import RELAYS, relay_track, relay_tracks, relay_usable
    assert len(RELAYS) == 2
    lag = (RELAYS[1].epoch - RELAYS[0].epoch).total_seconds()
    assert abs(lag - RELAYS[0].period_s / 2) < 1            # half an orbit apart
    pair = relay_usable(relay_tracks(k, T0, 60), track.lat, track.lon)
    one = relay_usable(relay_track(k, T0, 60), track.lat, track.lon)
    assert np.all(pair >= one)                              # a second relay only adds
    assert pair.mean() > 0.95
    gaps = [b - a for a, b in true_runs(~pair)]
    assert not gaps or max(gaps) <= 2
