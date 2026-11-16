"""Phase 6: landing targets and panel spots for the nine Artemis regions.

For each region: the top landing targets from ``lunarsky.landing`` (flat
enough to land on, ranked by NASA's average sunlight), then a full panel
search around each target: every 20 m spot within 200 m, under 20°, with a
walkable straight path from the target, with the panels on a 10 m mast.
Every walkable spot is sized for a long-term crewed base with the Phase 4
model (array + battery), so the search returns three picks: most sunlight,
shortest night, and lightest kit, which can be neither of the other two.
All three are sized again with the full model and the lightest is the
target's panel spot. Targets are then re-ranked by that kit. Each target also gets Earth contact
across its whole landing ellipse (direct via the DSN, and with relays).

Panel searches already in the output file are reused if they were run at the
same panel height and reach and include the lightest-kit pick; pass --fresh
to redo them.

Writes data/phase-6/landing_targets.json (everything) and a compact copy
for the app, frontend/public/data/landing.json. About 20 s per target;
--export-only just rewrites the app's copy. --terrain also bakes a 3D
terrain mesh (frontend/public/data/terrain/land-<code>.bin) for each
region's top target, so the surface view can stand there.

    .venv/bin/python scripts/precompute_landing.py              # all nine
    .venv/bin/python scripts/precompute_landing.py "Mons Mouton"
"""

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lunarsky import load_kernels                       # noqa: E402
from lunarsky.dsn import dsn_visible                    # noqa: E402
from lunarsky.landing import ELLIPSE_M, ellipse_contact, find_landing_targets, load_regions   # noqa: E402
from lunarsky.power import PANEL_HEIGHT_M, REACH_M, site_power   # noqa: E402
from lunarsky.relay import relay_tracks                 # noqa: E402
from lunarsky.panels import find_panel_site             # noqa: E402
from lunarsky.terrain import load_dems                  # noqa: E402

OUT = ROOT / "data" / "phase-6" / "landing_targets.json"
WEB = ROOT / "frontend" / "public" / "data" / "landing.json"
START = datetime(2027, 1, 1, tzinfo=timezone.utc)       # the crewed mission lands in early 2027
DAYS = 365
PANEL_MAX_M = REACH_M - ELLIPSE_M                       # 300 m reach − 100 m ellipse = 200 m
MISSION = "crew"                                        # the crewed mission, default 1-year stay
PICKS = ("panel_most_sunlight", "panel_shortest_night", "panel_lightest_kit")


def _brief(c):
    if c is None:
        return None
    keep = ("lat", "lon", "distance_m", "bearing_deg", "slope_deg", "sunlit_fraction",
            "longest_dark_hours", "earth_visible_fraction", "sunlit_gain_points", "dark_hours_saved",
            "kit_kg", "kit_kg_saved")
    return {key: c[key] for key in keep if key in c}


def _power(k, dems, pick):
    if pick is None:
        return None
    r = site_power(k, pick["lat"], pick["lon"], START, mission=MISSION, dems=dems,
                   height_m=PANEL_HEIGHT_M)
    if not r.get("feasible"):
        return {"feasible": False, "reason": r.get("reason")}
    b, v = r["best"], r["verdict"]
    return {"feasible": True, "total_kg": v["total_kg"], "breakdown_kg": v["breakdown_kg"],
            "battery_kwh": b["battery_kwh"], "array_m2": b["array_m2"],
            "longest_dark_hours": r["longest_dark_hours"]}


def main(names, fresh=False):
    k = load_kernels()
    dems = load_dems()
    regions = load_regions()
    dsn_any = dsn_visible(k, START, DAYS)["any"]
    relay = relay_tracks(k, START, DAYS)
    out = json.loads(OUT.read_text()) if OUT.exists() else {"regions": {}}
    for name in names or sorted(regions):
        t0 = time.time()
        res = find_landing_targets(name, regions=regions)
        seen = {(t["lat"], t["lon"]): t for t in out["regions"].get(name, {}).get("targets", [])}
        old = {} if fresh else seen
        for t in res["targets"]:
            if seen.get((t["lat"], t["lon"]), {}).get("terrain_id"):
                t["terrain_id"] = seen[(t["lat"], t["lon"])]["terrain_id"]   # its 3D mesh depends only on where it is
            prev = old.get((t["lat"], t["lon"]))
            if (prev and prev.get("panel_height_m") == PANEL_HEIGHT_M and "panel_lightest_kit" in prev
                    and prev.get("panel_max_m", 200.0) == PANEL_MAX_M):     # older runs: 200 m
                for key in ("landing_point", "panel_height_m", "panel_max_m", *PICKS, "panel_counts"):
                    t[key] = prev[key]
            else:
                _panel_search(k, dems, t)
            for key in PICKS:
                if t[key] is not None:
                    t[key]["power"] = _power(k, dems, t[key])
            sized = [(key, t[key]) for key in PICKS
                     if t[key] and t[key]["power"] and t[key]["power"]["feasible"]]
            if sized:
                key, spot = min(sized, key=lambda kc: kc[1]["power"]["total_kg"])
                t["panel_spot"] = {**spot, "pick": key.removeprefix("panel_")}
            else:
                t["panel_spot"] = None
            t["earth_contact"] = ellipse_contact(k, t["lat"], t["lon"], START, DAYS, dems, dsn_any, relay)
            print(f"  {name} #{t['rank']}: {time.time() - t0:.0f}s", flush=True)

        def key(t):
            s = t["panel_spot"]
            return float("inf") if s is None else s["power"]["total_kg"]
        res["targets"].sort(key=key)
        for i, t in enumerate(res["targets"]):
            t["nasa_rank"] = t.pop("rank")
            t["rank"] = i + 1
        res["panel_search"] = {"max_m": PANEL_MAX_M, "start_utc": START.isoformat(), "days": DAYS,
                               "mission": MISSION, "panel_height_m": PANEL_HEIGHT_M,
                               "ranked_by": "lightest power kit (array + battery) at the target's panel spot"}
        out["regions"][name] = res
        OUT.write_text(json.dumps(out, indent=1))
        print(f"{name}: {len(res['targets'])} targets in {time.time() - t0:.0f}s", flush=True)


def _panel_search(k, dems, t):
    p = find_panel_site(k, t["lat"], t["lon"], START, dems=dems,
                        min_m=0.0, max_m=PANEL_MAX_M, check_path=True,
                        height_m=PANEL_HEIGHT_M, size_for=MISSION)
    s = p["settings"]
    t["landing_point"] = {key: p["landing"][key] for key in
                          ("sunlit_fraction", "longest_dark_hours", "earth_visible_fraction", "kit_kg")
                          if key in p["landing"]}
    t["panel_height_m"] = PANEL_HEIGHT_M
    t["panel_max_m"] = PANEL_MAX_M
    for key in PICKS:
        t[key] = _brief(p["picks"][key.removeprefix("panel_")])
    t["panel_counts"] = {"spots": s["count"], "too_steep": s["too_steep"],
                         "path_blocked": s["path_blocked"]}


TERRAIN_TOP_N = 10    # targets per region with a 3D terrain mesh (~2 MB each; ranks 2-10 are served from R2, not git)


def terrain_id(code, rank):
    return f"land-{code.lower()}" + ("" if rank == 1 else f"-{rank}")


def build_target_terrain():
    """Terrain meshes for each region's top targets, added to terrain/index.json."""
    import importlib.util

    import numpy as np

    from lunarsky.terrain import DEFAULT_FINE_KM, latlon_to_map

    spec = importlib.util.spec_from_file_location("precompute_terrain", ROOT / "scripts" / "precompute_terrain.py")
    pt = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pt)
    index_path = pt.OUT_DIR / "index.json"
    index = json.loads(index_path.read_text())
    radii = np.asarray(index["radii_m"], float)
    dems = load_dems()
    # Meshes and their imagery (land-*_albedo.bin, land-*_wac.jpg): targets may
    # have moved, so rebake imagery afterwards (precompute_albedo.py,
    # precompute_wac_tiles.py).
    for old in pt.OUT_DIR.glob("land-*"):
        old.unlink()
    index["sites"] = {k: v for k, v in index["sites"].items() if not k.startswith("land-")}
    full = json.loads(OUT.read_text())
    for name, r in sorted(full["regions"].items()):
        for t in r["targets"][:TERRAIN_TOP_N]:
            tid = terrain_id(r["code"], t["rank"])
            x, y = latlon_to_map(t["lat"], t["lon"])
            d = dems.with_fine_window(float(x), float(y), DEFAULT_FINE_KM)
            h0, h, cov = pt.build_heights(t["lat"], t["lon"], d, radii)
            (pt.OUT_DIR / f"{tid}.bin").write_bytes(pt.encode_heights(h0, h, radii))
            t["terrain_id"] = tid
            index["sites"][tid] = {"coverage": round(cov, 3), "ground_m": round(h0, 1),
                                   "h_min": round(float(min(h0, h.min())), 1),
                                   "h_max": round(float(max(h0, h.max())), 1), "near_pixel_m": 20.0}
            print(f"  {tid}: {name} #{t['rank']}", flush=True)
    index_path.write_text(json.dumps(index, indent=1))
    OUT.write_text(json.dumps(full, indent=1))


def export_frontend():
    """The app's copy: per region, the ranked targets with what the Landing view shows."""
    full = json.loads(OUT.read_text())["regions"]
    t_ = lambda kg: round(kg / 1000, 2)

    def target(t, code):
        s = t["panel_spot"]
        p = s["power"] if s else None
        c = t["earth_contact"]
        b = p["breakdown_kg"] if p else {}
        # The mesh baked for this target's spot. Its name keeps the rank the
        # target had when it was baked, so a re-ranking needs no rebake.
        tid = t.get("terrain_id") or terrain_id(code, t["rank"])
        return {
            "rank": t["rank"], "nasa_rank": t["nasa_rank"], "lat": t["lat"], "lon": t["lon"],
            "terrain_id": tid if (ROOT / "frontend" / "public" / "data" / "terrain" / f"{tid}.bin").exists() else None,
            "nasa_sunlit": t["avg_sunlit"], "flat_share": t["flat_share"],
            "steepest_deg": t["steepest_deg"], "slope_deg": t["slope_at_pin_deg"],
            "landing_point": {"sunlit": t["landing_point"]["sunlit_fraction"],
                              "night_h": t["landing_point"]["longest_dark_hours"]},
            "panel": None if not s else {
                "lat": s["lat"], "lon": s["lon"], "distance_m": s["distance_m"],
                "bearing_deg": s["bearing_deg"], "slope_deg": s["slope_deg"],
                "sunlit": s["sunlit_fraction"], "night_h": s["longest_dark_hours"],
                "pick": s.get("pick")},
            "power": None if not p else {
                "total_t": t_(b.get("battery", 0) + b.get("solar array", 0)),  # power kit only, no supplies
                "battery_t": t_(b.get("battery", 0)),
                "array_t": t_(b.get("solar array", 0)),
                "battery_kwh": p["battery_kwh"], "array_m2": p["array_m2"]},
            "contact": {
                "direct_target": c["at_target"]["direct"],
                "direct_min": c["spread_direct"][0], "direct_max": c["spread_direct"][1],
                "direct_worst_gap_h": c["worst_direct"]["direct_longest_gap_hours"],
                "relay_min": c["worst_with_relay"]["with_relay"],
                "relay_worst_gap_h": c["worst_with_relay"]["with_relay_longest_gap_hours"]},
        }

    regions = []
    for name, r in sorted(full.items()):
        if "panel_search" not in r or "mission" not in r["panel_search"]:
            continue
        regions.append({
            "site_id": "artemis-" + r["code"].lower(), "region": name, "area_km2": r["area_km2"],
            "pins": r["pins"], "passing": r["passing"], "nasa_best_sunlit": r["best_sunlit_any"],
            "sun_map": r["settings"]["sun_map"], "targets": [target(t, r["code"]) for t in r["targets"]],
        })
    any_r = next(iter(full.values()))
    out = {
        "start_utc": any_r["panel_search"]["start_utc"], "days": any_r["panel_search"]["days"],
        "mission": any_r["panel_search"]["mission"],
        "ellipse_m": any_r["settings"]["ellipse_m"], "max_land_slope_deg": any_r["settings"]["max_slope_deg"],
        "min_flat": any_r["settings"]["min_flat"], "panel_max_m": any_r["panel_search"]["max_m"],
        "panel_height_m": any_r["panel_search"].get("panel_height_m", PANEL_HEIGHT_M),
        "regions": regions,
    }
    WEB.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {WEB.relative_to(ROOT)} ({WEB.stat().st_size // 1024} KB, {len(regions)} regions)")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--export-only" not in args:
        main([a for a in args if not a.startswith("--")], fresh="--fresh" in args)
    if "--terrain" in args:
        build_target_terrain()
    export_frontend()
