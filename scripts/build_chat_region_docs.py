"""The chat's region pages, written from the app's own data.

    python scripts/build_chat_region_docs.py

Writes chat-docs/docs/regions/<region>.md (one per Artemis region) and the
side-by-side table in chat-docs/docs/regions/README.md from
frontend/public/data/landing.json, sites.json and water_ice.json. Rerun after
any of those change (a new landing year, a landing-target rerun), then upload
with scripts/upload_chat_docs.sh.

Each page keeps its hand-written opening line (where the name comes from);
everything with a number in it is regenerated.
"""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "frontend" / "public" / "data"
OUT = ROOT / "chat-docs" / "docs" / "regions"
MOON_R_KM = 1737.4


def surface_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * MOON_R_KM * math.asin(math.sqrt(a))


def pole_km(lat):
    return math.radians(90 + lat) * MOON_R_KM


def latlon(lat, lon):
    return f"{abs(lat):.2f}°{'S' if lat < 0 else 'N'}, {abs(lon):.2f}°{'W' if lon < 0 else 'E'}"


def pct(f):
    return f"{round(f * 100)}%"


def days(h):
    return f"{h / 24:.1f} days"


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def kit(p):
    # Parts that add up to the total at 0.1 t, as the app and the chat show them.
    total = round(p["total_t"], 1)
    battery = round(p["battery_t"], 1)
    return total, battery, round(total - battery, 1)


def main():
    landing = json.loads((DATA / "landing.json").read_text())
    pins = {s["id"]: s for s in json.loads((DATA / "sites.json").read_text())}
    ice = {r["id"]: r for r in json.loads((DATA / "water_ice.json").read_text())["regions"]}
    year = landing["start_utc"][:4]
    case = f"year-round crewed base, {year}"

    rows = []
    for r in landing["regions"]:
        t = r["targets"][0]
        pin = pins[r["site_id"]]
        rows.append({
            "r": r, "t": t, "pin": pin, "ice": ice[r["site_id"]]["nearest_shadowed_area"],
            "pole": pole_km(pin["lat"]), "kit": kit(t["power"]), "night": t["panel"]["night_h"],
            "sun": t["panel"]["sunlit"], "contact": t["contact"]["direct_target"],
            "safe": r["passing"] / r["pins"],
        })
    by_kit = sorted(rows, key=lambda x: x["t"]["power"]["total_t"])
    for i, x in enumerate(by_kit):
        x["kit_rank"] = i + 1

    def extreme(key, fn=max):
        return fn(rows, key=lambda x: x[key])["r"]["region"]

    sunniest, shortest, longest = extreme("sun"), extreme("night", min), extreme("night")
    best_contact, worst_contact = extreme("contact"), extreme("contact", min)
    rugged, closest, farthest = extreme("safe", min), extreme("pole", min), extreme("pole")
    ice_near = min(rows, key=lambda x: x["ice"]["distance_km"])["r"]["region"]
    ice_cold = min(rows, key=lambda x: x["ice"]["hottest_it_gets_K"])["r"]["region"]
    lightest, heaviest = by_kit[0]["r"]["region"], by_kit[-1]["r"]["region"]

    for x in rows:
        r, t, pin, ic = x["r"], x["t"], x["pin"], x["ice"]
        name, (total, battery, array) = r["region"], x["kit"]
        pan, c, lp = t["panel"], t["contact"], t["landing_point"]
        nasa_best = next(tt for tt in r["targets"] if tt["nasa_rank"] == 1)
        kits = [tt["power"]["total_t"] for tt in r["targets"] if tt.get("power")]
        page = OUT / f"{slug(name)}.md"
        old = page.read_text().split("\n") if page.exists() else []
        intro = old[2] if len(old) > 2 and old[2].startswith(name) else (
            f"{name} is one of NASA's nine Artemis III candidate landing regions near the Moon's south pole.")

        if nasa_best is t:
            vs_nasa = "The #1 target is also the one NASA's average-sunlight map rates best, so ranking by kit weight and by sunlight pick the same spot here."
        else:
            saving = round(nasa_best["power"]["total_t"], 1) - total
            vs_nasa = (f"The #1 target is number {t['nasa_rank']} of the ten on NASA's average-sunlight map. "
                       f"The target that map rates best needs {nasa_best['power']['total_t']:.1f} t, so ranking by kit weight saves {saving:.1f} t.")

        stand = []
        if name == lightest:
            stand.append(f"The lightest power kit of the nine ({total:.1f} t).")
        elif name == heaviest:
            stand.append(f"The heaviest power kit of the nine ({total:.1f} t).")
        else:
            stand.append(f"Its kit ranks {x['kit_rank']} of the 9 regions by weight ({total:.1f} t; 1 is lightest).")
        if name == sunniest:
            stand.append(f"The sunniest panels of the nine ({pct(x['sun'])} of the year).")
        if name == shortest:
            stand.append(f"The shortest night of the nine at its panels ({days(x['night'])}).")
        if name == longest:
            stand.append(f"The longest night of the nine at its panels ({days(x['night'])}), which is why its battery is so big.")
        if name == best_contact:
            stand.append(f"The best direct Earth contact of the nine ({pct(x['contact'])} at the target).")
        if name == worst_contact:
            stand.append(f"The lowest direct Earth contact of the nine ({pct(x['contact'])} at the target); the relays matter most here.")
        if name == rugged:
            stand.append(f"The most rugged: only {pct(x['safe'])} of the landing zones tried pass the slope rule.")
        if name == closest:
            stand.append(f"The closest to the pole ({x['pole']:.0f} km).")
        if name == farthest:
            stand.append(f"The farthest from the pole ({x['pole']:.0f} km).")
        if name == ice_near:
            stand.append(f"Its nearest shadowed area is the closest of the nine ({ic['distance_km']:.1f} km).")
        if name == ice_cold:
            stand.append(f"Its nearest shadowed area is the coldest of the nine ({ic['hottest_it_gets_K']:.0f} K at its hottest).")
        if ic["share_cold_enough_for_surface_ice_pct"] == 0:
            stand.append(f"Its nearest shadowed area is never cold enough for ice at the surface ({ic['hottest_it_gets_K']:.0f} K at its hottest); ice could last about {ic['typical_depth_to_stable_ice_m']} m down.")
        if pan["distance_m"] <= 30:
            stand.append(f"Its panels sit just {pan['distance_m']:.0f} m from the target.")
        elif pan["distance_m"] >= 195:
            stand.append(f"The panel spot is {pan['distance_m']:.0f} m from the target, at the edge of the panel search.")
        if lp["night_h"] - pan["night_h"] >= 48:
            stand.append(f"Moving the panels a short walk matters here: the landing point has a {days(lp['night_h'])} night, the panel spot {days(pan['night_h'])}.")
        if pin.get("sunlit_map") and pin["sunlit_map"] != "60m":
            stand.append(f"The region only fits NASA's coarser {pin['sunlit_map'].replace('m', ' m')} sunlight map, so its reference point is less precise.")

        ref_km = surface_km(pin["lat"], pin["lon"], t["lat"], t["lon"])
        relay_gap = f"; longest gap {c['relay_worst_gap_h']:.0f} hours" if c.get("relay_worst_gap_h") is not None else ""
        text = f"""# {name}

{intro}

## Where it is

- **Size:** about {r['area_km2']:.0f} km².
- **Reference point** (its sunniest pixel on NASA's sunlight map): {latlon(pin['lat'], pin['lon'])}, about {x['pole']:.0f} km from the pole.
- **Sunlight at the reference point:** {pct(pin['avg_sunlit'])} on NASA's long-term average map ({pin.get('sunlit_map', '60m').replace('m', ' m')} pixels).
- **Landing zones that pass the slope rule:** {pct(x['safe'])} of those tried (at least 95% of a landing zone of 100 m radius under 10°).

## The #1 landing target ({case})

The target that needs the lightest power kit. The site card in the app shows it. By kit weight it ranks {x['kit_rank']} of the 9 regions (1 is lightest).

- **Where:** {latlon(t['lat'], t['lon'])}, {ref_km:.1f} km from the reference point.
- **Landing zone:** {pct(t['flat_share'])} under 10°; average slope {t['slope_deg']:.1f}°, steepest pixel {t['steepest_deg']:.1f}°.
- **Panel spot:** {pan['distance_m']:.0f} m from the target, slope {pan['slope_deg']:.1f}°, on a 10 m mast.
- **Sunlight at the panels:** {pct(pan['sunlit'])} of the year; longest night {days(pan['night_h'])} ({pan['night_h']:.0f} hours).
- **At the landing point itself:** {pct(lp['sunlit'])} sunlight, longest night {days(lp['night_h'])}.
- **Power kit:** {total:.1f} t: battery {battery:.1f} t ({t['power']['battery_kwh']:,.0f} kWh), solar array {array:.1f} t ({t['power']['array_m2']:.0f} m²).
- **Direct Earth contact:** {pct(c['direct_target'])} at the target ({pct(c['direct_min'])}–{pct(c['direct_max'])} across the zone); longest direct blackout {c['direct_worst_gap_h']:.0f} hours ({days(c['direct_worst_gap_h'])}) at the worst point in the zone.
- **With the two relays:** about {pct(c['relay_min'])} from every point in the zone{relay_gap}.

## Against NASA's sunlight map

{vs_nasa}
Across the region's ten targets the kit runs from {min(kits):.1f} t to {max(kits):.1f} t.

## Water ice nearby (information only)

The nearest permanently shadowed area of at least 1 km² is {ic['distance_km']:.1f} km from the reference point ({ic['area_km2']:.1f} km²). At its hottest it reaches {ic['hottest_it_gets_K']:.0f} K; {ic['share_cold_enough_for_surface_ice_pct']:.0f}% of it is cold enough for ice at the surface. It is too far to walk (the on-foot reach is 300 m), and it never changes the kit or a ranking.

## What stands out

{chr(10).join('- ' + s for s in stand)}

## Limits

- Numbers are for one case: the crewed mission's year-round base over {year}, panels and antenna at 10 m. Other dates and stays come from the app's own runs.
- Slope comes from 20 m pixels, so boulders and small craters are invisible.
- The ten targets are shortlisted by NASA's average-sunlight map before the full calculation, so a target with a shorter night but lower average could be missed.
"""
        page.write_text(text)
        print("wrote", page.relative_to(ROOT))

    # The overview: its table and the summary under it.
    readme = OUT / "README.md"
    s = readme.read_text()
    table = "\n".join(
        [f"## Side by side (#1 target, {case})", "",
         "| Region | From the pole | Power kit | Longest night at the panels | Sunlight at the panels | Direct Earth contact at the target |",
         "|---|---|---|---|---|---|"]
        + [f"| {x['r']['region']} | {x['pole']:.0f} km | {x['kit'][0]:.1f} t | {days(x['night'])} | {pct(x['sun'])} | {pct(x['contact'])} |" for x in by_kit])
    top = [x["r"]["region"] for x in by_kit[:3]]
    bottom = [x["r"]["region"] for x in by_kit[-3:]][::-1]
    by_contact = sorted(rows, key=lambda x: -x["contact"])[:2]
    by_rugged = sorted(rows, key=lambda x: x["safe"])[:2]
    short = next(x for x in rows if x["r"]["region"] == shortest)
    summary = f"""## What sets them apart

- **Lightest kits:** {top[0]} ({by_kit[0]['kit'][0]:.1f} t), then {top[1]} and {top[2]} ({by_kit[1]['kit'][0]:.1f} t and {by_kit[2]['kit'][0]:.1f} t).
- **Shortest night:** {shortest} ({days(short['night'])}); its kit ranks {short['kit_rank']} of 9.
- **Best direct Earth contact:** {by_contact[0]['r']['region']} and {by_contact[1]['r']['region']}, near the most the Deep Space Network allows (about 98%).
- **Heaviest kits:** {', '.join(bottom[:-1])} and {bottom[-1]}, where nights at the panels last about two weeks.
- **Most rugged:** {by_rugged[0]['r']['region']} and {by_rugged[1]['r']['region']}, where only {pct(by_rugged[0]['safe'])} and {pct(by_rugged[1]['safe'])} of the landing zones tried pass the slope rule.
"""
    s = re.sub(r"## Side by side.*?(?=\n\nWith the two relay)", table, s, flags=re.S)
    s = re.sub(r"## What sets them apart.*", summary, s, flags=re.S)
    s = re.sub(r"over \d{4}, panels and antenna on a 10 m mast", f"over {year}, panels and antenna on a 10 m mast", s)
    readme.write_text(s)
    print("wrote", readme.relative_to(ROOT))


if __name__ == "__main__":
    main()
