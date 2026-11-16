"""Static files for the chat's water_ice and assumptions tools.

    python scripts/build_chat_data.py

Writes frontend/public/data/water_ice.json (from data/phase-7/site_resources.csv)
and frontend/public/data/assumptions.json (from data/phase-4/assumptions.csv).
Both are information the app already publishes; nothing here feeds a
calculation. Rerun after either CSV changes.
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "data"


def num(v):
    return None if v in ("", None) else float(v)


def water_ice():
    rows = list(csv.DictReader((ROOT / "data/phase-7/site_resources.csv").open()))
    regions = []
    for r in rows:
        surface = float(r["share_ice_at_surface"])
        regions.append({
            "id": r["id"], "region": r["name"],
            "nearest_shadowed_area": {
                "area_km2": float(r["psr_area_km2"]),
                "distance_km": round(float(r["dist_km"]), 1),
                "hottest_it_gets_K": round(float(r["tmax_median_K"])),
                "share_cold_enough_for_surface_ice_pct": round(surface * 100),
                "share_with_stable_ice_within_3m_depth_pct": round(float(r["share_ice_within_2_87m"]) * 100),
                "typical_depth_to_stable_ice_m": float(r["ice_depth_median_m"]),
            },
        })
    regions.sort(key=lambda x: x["region"].lower())
    return {
        "note": ("Information only: it never changes the kit or a ranking. Distances are straight lines from each "
                 "region's reference point (its sunniest spot) to the edge of the nearest permanently shadowed area "
                 "of at least 1 km2; smaller shadowed spots closer by are not counted. 'Cold enough' means ice could "
                 "survive there, not that ice has been found. Every one is too far to walk (the on-foot reach is 300 m), "
                 "so reaching it needs a rover."),
        "cold_enough_below_K": 110,
        "sources": ["Permanently shadowed areas: LOLA 20 m map, Barker et al. 2023 (NASA PGDA product 90)",
                    "Temperatures and ice depth: LRO Diviner polar resource products, Paige et al."],
        "regions": regions,
    }


# Which chat topic each CSV row belongs to.
TOPIC = {"solar": "solar", "storage": "battery", "margin": "margins", "comms": "comms", "crew": "crew_supplies",
         "mission": "mission", "load_item": "loads"}
TITLE = {"loads": "Power load list (crew of 4: about 10 kW by day, 9 kW at night)", "solar": "Solar array",
         "battery": "Battery", "margins": "Margins", "comms": "Data sent to Earth",
         "crew_supplies": "What a person needs per day (reference only: not part of the kit mass)",
         "mission": "Mission"}


def assumptions():
    groups = {}
    for r in csv.DictReader((ROOT / "data/phase-4/assumptions.csv").open()):
        if r["id"] in ("li_extra_custom", "water_recovery"):
            continue
        item = {"name": r["parameter"], "value": num(r["value"]), "units": r["units"], "source": r["source"]}
        if r["low"] and r["high"]:
            item["range"] = [num(r["low"]), num(r["high"])]
        if r["category"] == "load_item":
            notes = r["notes"]
            item["runs"] = ("only while in direct contact with Earth" if "only while Earth" in notes
                            else "daylight only" if "Daylight only" in notes else "always")
            item["kind"] = "add-on (not in the default load)" if r["id"].startswith("li_extra_") else "default load"
        groups.setdefault(TOPIC[r["category"]], []).append(item)
    order = ["loads", "solar", "battery", "margins", "comms", "crew_supplies", "mission"]
    return {
        "note": ("The kit mass is the solar array plus the battery only. Air, water, food, habitat, lander, mast and "
                 "cable mass are not counted. Default load for a crew of 4: crew systems 6.0 kW (1.5 kW each), "
                 "avionics and communications 1.5 kW, radio to Earth 0.3 kW (only in direct contact), other habitat "
                 "systems 1.2 kW, science lab 1.0 kW (daylight only): 10 kW in all. Power comes from solar panels "
                 "and batteries only; nuclear power and fuel cells are not modelled."),
        "groups": [{"topic": t, "title": TITLE[t], "items": groups[t]} for t in order if t in groups],
    }


def main():
    for name, data in (("water_ice.json", water_ice()), ("assumptions.json", assumptions())):
        (OUT / name).write_text(json.dumps(data, indent=1) + "\n")
        print(f"✓ {name}")


if __name__ == "__main__":
    main()
