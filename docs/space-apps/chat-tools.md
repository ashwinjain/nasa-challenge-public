# AI chat: tools and questions

Spec, 2026-11-14. Built: tools in `frontend/src/chat/tools.js` (run in the page),
model turn in `frontend/functions/api/chat.js` (Pages Function, Workers AI
`@cf/openai/gpt-oss-120b`, picked over Llama 4 Scout, Llama 3.3 70B, Qwen3 30B and
Mistral Small 3.1 on these test questions). Scope: the 9 Artemis candidate regions, one crewed
mission (crew of 4, default one-year stay), dates from 2026. The model never
does Moon math and never states a number a tool didn't return. No custom
coordinates, no live panel search, no landers or costs.


Heights: panels and the comms antenna are on a 10 m mast, so every power,
sunlight and Earth-contact figure is at 10 m, at the #1 landing target's panel
spot (`data/sun/`), the same input the kit is sized from. The person's view
(sky chart, 3D) stays at 2 m, at the region's reference point: a different
spot, and the tools say so.

Words: "nights" / "dark periods" for the Sun, "blackouts" only for Earth.

Inputs are checked the way the app's own controls limit them: landing dates
2026-01-01 to 2035-12-31 (real calendar days), stays of 1–365 days, crew 1–50,
targets 1–10. Anything else comes back as an error the model reports, never a
number. Region names match by id, name, part of a name or a near miss
("Malapart Masif"); a name that fits two regions ("Nobile Rim") is an error
asking which. Kit masses are rounded to 0.1 t in every tool. No tool returns
the internal region ids.

## Tools

### `list_regions`
- **Inputs:** none
- **Returns:** the 9 regions: name, area, latitude and longitude of the #1
  target, landing zones checked and safe, the #1 target's kit (total, battery,
  array), panel sunlit %, longest night
- **Backed by:** `landing.json`
- **Example:** "What sites can I choose from?"

### `region_conditions`
- **Inputs:** `region`, `start` (date), `days`, `height_m` (10 default; 2 for the person's view)
- **Returns:** sunlit %, longest night, direct contact %, longest blackout
  (direct and with relays), over those dates
- **Backed by:** Sun files at the #1 target's panel spot for the Sun and, from
  their `contact` layer, direct Earth contact at the antenna mast there (so it
  agrees with `landing_targets` and with what the power model runs the radio
  on). The windows files at the region's reference point give the 2 m view and
  the relay hours; a stay that runs past one year's file carries on in the next.
- **Example:** "If we land at Malapert on 1 March 2026 for 30 days, how much is sunlit?"

### `compare`
One tool, two modes; give either a region or a start date and it varies the other.
- **Inputs:** `metric` (`kit_mass` | `longest_night` | `sunlit` | `earth_in_view` | `longest_blackout`),
  `days`, and either
  - `start` → ranks all 9 regions over those dates, or
  - `region` + `year` (+ `order`: `best` | `worst`) → ranks start dates through that year
- **Returns:** the ordered list (5 dates in date mode, at least a stay apart),
  and how many days tie with the first
- **Notes:** `earth_in_view` ranks by direct contact %. Date mode covers stays
  up to 60 days. Ties (weeks with no night) are broken on the other Sun
  figure, then on Earth contact. `kit_mass` with a region ranks dates by
  longest night.
- **Examples:** "Which region is best for a 30-day stay from 1 March?" /
  "When in 2026 should we land at Nobile Rim 1 for two weeks?" /
  "When is the worst time to land at Nobile Rim 2?"

### `landing_targets`
- **Inputs:** `region`, `top` (1–10, default 3) or `rank` (one target)
- **Returns:** landing zones checked and safe; what ranking by kit saves over
  the target NASA's map rates best; per target: zone flatness, panel spot
  (distance, bearing, compass direction, slope, which candidate it was), the
  Sun at the landing point itself, kit mass, Earth contact across the zone
- **Backed by:** `landing.json`
- **Example:** "Where do the panels go at Peak Near Cabeus B's best target?"

### `size_power`
- **Inputs:** `region`, `start`, `days`, `crew`, extra loads (rover, crewed rover, drill, lights)
- **Returns:** array and battery mass, total, battery kWh, array m², load kW,
  the biggest item, panel sunlit %, longest night, direct contact %, on-board
  data storage (GB)
- **Backed by:** the JS port of `lunarsky/power.py` on the #1 target's 10 m panel spot
- **Example:** "How heavy is the kit at Slater Plain if we add a crewed rover?"

### `dark_periods`
- **Inputs:** `region`, `start`, `days`, `top` (how many of the longest, default 3)
- **Returns:** for nights and for comms blackouts: count, total hours, the
  first one after landing, the longest few with start and end (UTC)
- **Backed by:** the Sun files (`frac` and `contact` layers)
- **Example:** "When does the longest night at Haworth start in 2026?"

### `water_ice`
- **Inputs:** `region` (optional)
- **Returns:** the nearest permanently shadowed area of at least 1 km²: size,
  distance, how hot it gets, share cold enough for surface ice. Information
  only.
- **Backed by:** `data/water_ice.json` (`scripts/build_chat_data.py`, from
  `data/phase-7/site_resources.csv`; no radiation or route columns)
- **Example:** "Is there water ice near Malapert Massif?"

### `assumptions`
- **Inputs:** `topic` (`loads` | `solar` | `battery` | `margins` | `comms` | `crew_supplies` | `mission` | `all`)
- **Returns:** each assumed value with units, range and source
- **Backed by:** `data/assumptions.json` (`scripts/build_chat_data.py`, from
  `data/phase-4/assumptions.csv`)
- **Example:** "What battery do you assume?" / "What is the 10 kW load made of?"

### `search_docs`
- **Inputs:** `question`
- **Returns:** up to 5 passages with their source file
- **Backed by:** AI Search over `chat-docs/` (cleaned copies; `scripts/upload_chat_docs.sh`).
  The Pages Function asks the index up to four times, because it sometimes
  answers with nothing. The page allows three searches per question.
- **Example:** "Why a 20° slope limit?"

### `show_in_app`
- **Inputs:** `region`, optional `target_rank`, `start`, `days`
- **Returns:** nothing; flies the 3D view to the region's target
- **Backed by:** frontend only

## Testing

`tests/chat/` holds the checks (see its README): `tools.test.mjs` runs every
tool against `landing.json` with no server, and `ask.mjs` + `check.mjs` put
`questions.json` (125 questions with what to expect) through the real chat
loop and flag wrong tools, missing facts and numbers no tool returned.

## Test questions

1. Which Artemis region is best for a year-long crewed base?
2. Why is Mons Mouton ranked above Haworth?
3. Which region has the shortest longest night?
4. Which regions keep Earth in view the most?
5. Land at Malapert on 1 March 2026 for 30 days: how much is sunlit, and what's the longest dark period?
6. When in 2026 should we land at Nobile Rim 1 for a two-week stay?
7. How long is the longest Earth blackout at de Gerlache Rim 2 in June?
8. How heavy is the power kit at Slater Plain for 4 crew for a year?
9. What happens to the battery if we add a crewed rover, or stay 60 days?
10. Where do the panels go at Peak Near Cabeus B's #1 target?
11. How flat is the landing zone at Haworth's #1 target?
12. Why isn't the sunniest target also the lightest kit?
13. Why a 20° slope limit and a 200 m panel reach?
14. Why put panels on 10 m masts?
15. How accurate is your sunlight compared to NASA's maps?
16. Is there water ice near this region? (Information only.)

Every number in an answer gets checked against the app.
