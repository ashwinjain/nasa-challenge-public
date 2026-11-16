"""Test the FastAPI endpoints in lunarsky/api.py."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lunarsky.api import app

client = TestClient(app)
STATIC = Path(__file__).resolve().parents[1] / "frontend" / "public" / "data"
MAPS = Path(__file__).resolve().parents[1] / "data" / "phase-2"
needs_maps = pytest.mark.skipif(
    not all((MAPS / f).exists() for f in ("LDEM_80S_80MPP_ADJ.TIF", "LDEM_60S_240MPP_ADJ.TIF")),
    reason="elevation maps not downloaded")


def test_list_sites():
    res = client.get("/api/sites")
    assert res.status_code == 200
    sites = res.json()
    assert len(sites) == 9
    assert all({"id", "name", "lat", "lon", "group", "kind", "avg_sunlit"} <= s.keys() for s in sites)
    assert all(s["kind"] == "artemis_region" for s in sites)
    assert sites[0]["name"] == "Haworth"  # Artemis regions come first
    assert sites[0]["avg_sunlit"] == 0.705


def test_list_sites_filter():
    res = client.get("/api/sites", params={"kind": "artemis_region"})
    assert res.status_code == 200
    assert len(res.json()) == 9
    assert client.get("/api/sites", params={"kind": "nope"}).json() == []


def test_get_sky():
    res = client.get("/api/sky", params={
        "lat": -89.44, "lon": 130.5, "start": "2026-01-01", "end": "2026-01-02",
        "step_hours": 6, "site_name": "Test",
    })
    assert res.status_code == 200
    data = res.json()
    n = len(data["times_utc"])
    assert n == 5  # 0, 6, 12, 18, 24 h
    for key in ("sun_az", "sun_el", "earth_az", "earth_el", "sunlit", "earth_visible"):
        assert len(data[key]) == n
    assert data["step_hours"] == 6
    assert data["site_name"] == "Test"
    m = data["metrics"]
    assert {"sunlit_fraction", "longest_dark_hours", "hours_to_next_set"} <= m["sun"].keys()
    assert {"visible_fraction", "longest_blackout_hours", "hours_to_next_set"} <= m["earth"].keys()


def test_matches_static_file():
    """The API and the precomputed files must agree, since the page reads both."""
    static = json.loads((STATIC / "sky" / "artemis-ma.json").read_text())
    res = client.get("/api/sky", params={
        "lat": static["lat"], "lon": static["lon"],
        "start": static["metrics"]["window"]["start_utc"],
        "end": static["metrics"]["window"]["end_utc"],
        "site_name": static["site_name"], "site_id": static["site_id"],
        "terrain": "terrain" in static,
    })
    assert res.status_code == 200
    assert res.json() == static


def test_invalid_coords():
    res = client.get("/api/sky", params={"lat": 100, "lon": 0, "start": "2026-01-01", "end": "2026-01-02"})
    assert res.status_code == 422


def test_bad_dates():
    for start, end in [("2026-02-01", "2026-01-01"),   # backwards
                       ("2060-01-01", "2060-01-02"),   # past the ephemeris
                       ("not-a-date", "2026-01-02"),
                       ("2026-01-01", "2028-01-01")]:  # longer than a year
        res = client.get("/api/sky", params={"lat": 0, "lon": 0, "start": start, "end": end})
        assert res.status_code == 400, (start, end)


@needs_maps
def test_sky_with_terrain():
    res = client.get("/api/sky", params={
        "lat": -86.00114, "lon": 2.05502, "start": "2026-01-01", "end": "2026-01-03",
        "step_hours": 6, "terrain": "true",
    })
    assert res.status_code == 200
    data = res.json()
    t = data["terrain"]
    assert t["available"] and t["heights_m"] == [0.0, 2.0, 10.0, 20.0]
    n = len(data["times_utc"])
    for h in ("0", "2", "10", "20"):
        assert len(t["heights"][h]["sunlit"]) == n
        assert t["heights"][h]["metrics"]["horizon"]["terrain"] is True
    assert data["metrics"]["horizon"]["terrain"] is False   # top level stays smooth Moon


@needs_maps
def test_terrain_unavailable_off_the_maps():
    res = client.get("/api/sky", params={
        "lat": 0.67, "lon": 23.47, "start": "2026-01-01", "end": "2026-01-02", "terrain": "true"})
    assert res.status_code == 200
    assert res.json()["terrain"]["available"] is False
    assert client.get("/api/skyline", params={"lat": 0.67, "lon": 23.47}).status_code == 404


@needs_maps
def test_skyline_endpoint():
    res = client.get("/api/skyline", params={"lat": -86.00114, "lon": 2.05502})
    assert res.status_code == 200
    d = res.json()
    assert len(d["az_deg"]) == 720 and set(d["el_deg"]) == {"0", "2", "10", "20"}


@needs_maps
def test_panel_site_endpoint():
    res = client.get("/api/panel-site", params={"lat": -86.00114, "lon": 2.05502, "min_m": 100, "max_m": 120})
    assert res.status_code == 200
    d = res.json()
    assert {"landing", "picks", "candidates", "settings"} <= d.keys()
    assert d["settings"]["height_m"] == 10.0
    assert 100 <= d["picks"]["most_sunlight"]["distance_m"] <= 120


@needs_maps
def test_panel_site_parts_and_merge():
    """The slices the queue runs side by side join into the one-call answer."""
    q = {"lat": -86.00114, "lon": 2.05502, "min_m": 100, "max_m": 160}
    whole = client.get("/api/panel-site", params=q).json()
    parts = [client.get("/api/panel-site", params={**q, "part": i, "parts": 3}).json() for i in range(3)]
    assert all(p["settings"]["parts"] == 3 for p in parts)
    merged = client.post("/api/panel-site/merge", json=parts)
    assert merged.status_code == 200 and merged.json() == whole
    assert client.post("/api/panel-site/merge", json=parts[:2]).status_code == 400
    # Without the Worker's queue in front, the jobs path answers inline.
    assert client.get("/api/jobs/panel-site", params=q).json() == whole


def test_panel_site_rejects_bad_input():
    assert client.get("/api/panel-site", params={"lat": -86, "lon": 2, "max_m": 500}).status_code == 422
    assert client.get("/api/panel-site", params={"lat": -86, "lon": 2, "min_m": 200, "max_m": 150}).status_code == 400
    assert client.get("/api/panel-site", params={"lat": -86, "lon": 2, "part": 2, "parts": 2}).status_code == 400


@needs_maps
def test_panel_site_off_the_maps():
    assert client.get("/api/panel-site", params={"lat": 0.67, "lon": 23.47}).status_code == 404


def test_power_endpoint_validates_mission():
    r = client.get("/api/power", params={"lat": -86.0, "lon": 2.05, "start": "2027-01-01", "mission": "nope"})
    assert r.status_code == 400


@needs_maps
def test_power_endpoint():
    r = client.get("/api/power", params={"lat": -86.00114, "lon": 2.05502, "start": "2026-01-01",
                                         "days": 7})
    assert r.status_code == 200
    body = r.json()
    assert body["horizon"] == "terrain"
    assert body["mission"]["id"] == "crew"
    v = body["verdict"]
    assert "landers" not in v and v["total_kg"] == pytest.approx(sum(v["breakdown_kg"].values()), abs=0.5)
    assert 0 <= body["sunlit_fraction"] <= 1


@needs_maps
def test_power_endpoint_overrides():
    base = {"lat": -86.00114, "lon": 2.05502, "start": "2026-01-01", "days": 7}
    # One steady load (all always on, the radio included), then twice it.
    a = client.get("/api/power", params={**base, "load_w": 10_000}).json()
    b = client.get("/api/power", params={**base, "load_w": a["load_w"] * 2, "crew": 6,
                                         "water_recovery": 0.5}).json()
    assert b["load_w"] == a["load_w"] * 2 and b["mission"]["crew"] == 6
    assert b["best"]["battery_kwh"] == pytest.approx(2 * a["best"]["battery_kwh"], rel=1e-2)
    assert "supplies" not in b
    assert "crew" in a["inputs"] and a["inputs"]["rates"]["food_per_crew"] > 0
    hi = client.get("/api/power", params={**base, "height_m": 10}).json()
    assert hi["panel_height_m"] == 10


@needs_maps
def test_power_endpoint_load_list():
    base = {"lat": -86.00114, "lon": 2.05502, "start": "2026-01-01", "days": 7}
    a = client.get("/api/power", params=base).json()
    assert [l["id"] for l in a["inputs"]["loads"]][0] == "li_crew_systems"
    assert a["inputs"]["extra_loads"]
    # Moving the science lab from daylight-only to always-on can only grow the battery.
    b = client.get("/api/power", params={**base, "always_w": a["load_w"], "day_w": 0}).json()
    assert b["always_w"] == a["load_w"] and b["day_w"] == 0
    assert b["best"]["battery_kwh"] >= a["best"]["battery_kwh"]
    bad = client.get("/api/power", params={**base, "always_w": 0, "day_w": 0})
    assert bad.status_code == 400


@needs_maps
def test_power_endpoint_crew_scales_load():
    base = {"lat": -86.00114, "lon": 2.05502, "start": "2026-01-01", "days": 7}
    four = client.get("/api/power", params={**base, "crew": 4}).json()
    six = client.get("/api/power", params={**base, "crew": 6}).json()
    assert six["load_w"] - four["load_w"] == pytest.approx(3000)
