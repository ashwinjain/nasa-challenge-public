# Lunar Landing Site Navigator: constraints and phased plan

The tool is built around one comparison:

$$
\text{needs (from the mission profile)} \;\le\; \text{supply (from site × date × equipment)}
$$

For every scenario it answers three questions: does that hold, where does it break, and which constraint breaks first?

---

## Mission scope

- **One mission:** a crewed mission landing in **2026**. Crew of 4, stay **editable, default 1 year** (a year-round base). The landing year is editable too, from 2026 to 2035.
- **Only the nine Artemis III candidate regions.** No other landing sites.
- **Report tonnage to the Moon only:** the power kit, the solar array plus the battery. Air, water and food are left out: crew and stay are fixed, so they weigh the same at every site and don't change the comparison. **No lander list, payload limits, first-flight years or prices.**
- **Heights:** solar panels and the comms antenna sit on a **10 m mast**; a person standing (the 3D view) is **2 m**. Earth contact is always worked out at the 10 m antenna.
- **Reach:** panels and comms gear go at most **300 m** from the lander, carried on foot.
- **Phase 6's results are for 2027** (lighting, contact and the target ranking by kit weight).

---

## 1. What we vary

| Axis | What it means | Examples |
|---|---|---|
| **Site** | Where the lander sets down | The nine Artemis III south-pole regions |
| **Spot and height** | Exact position within the landing ellipse, and how high panels or antennas sit | A few hundred meters off target; panels and antenna on a 10 m mast |
| **Date and time** | Landing date, time within the lunar day, and the mission window | Slipping two weeks; landing at local sunrise; a 14-day mission |
| **Long term** | Slow cycles that shift conditions over years | The 11-year solar cycle; the 18.6-year cycle of the Moon's orbit |
| **Mission profile** | What the mission needs | A crew of 4 landing in 2027, staying a year by default |
| **Equipment** | What we choose to bring | Panel height and type; battery size; how closed the recycling is |
| **Infrastructure** | What else is there to help | Relay satellites in lunar orbit; DSN load |
| **Uncertainty** | What we don't know precisely | Terrain data resolution; landing dispersion |

---

## 2. Constraints across the axes

Key: **Strong** means this axis can make or break the constraint. "—" means no meaningful effect.

### Power and environment

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Sunlight (power)** | **Strong**: latitude and terrain decide it | **Strong**: a few hundred meters or a 10 m mast changes it | **Strong** at the poles: season (±1.54°) and where the Sun is on its monthly circle | The 18.6-year cycle shifts polar lighting slightly | Sets how much power is needed | Panel height, orientation, efficiency | — | Terrain data resolution |
| **Longest night** | **Strong** | **Strong** | **Strong**: longer in polar winter | Slight | Sets the load to carry through the dark | Battery size | — | Terrain data resolution |

### Communications

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Earth in view** | **Strong**: latitude and terrain | **Strong** | **Strong**: libration moves Earth through the polar sky every month | — | How much contact is needed | Antenna mast height | — | Terrain data resolution |
| **DSN availability** | — | — | **Strong**: Earth's rotation decides which complex sees the Moon | — | — | — | Other missions competing for antennas | — |
| **Relay coverage** | **Strong**: the site's latitude vs. the relay's orbit | Terrain | Where the relay is in its orbit | — | — | Relay radio on the lander | Is a relay there? | — |

### Landing

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Landing safety (slope, boulders)** | **Strong** | **Strong**: varies across the landing ellipse | — | — | Lander size | Slope tolerance; hazard avoidance | — | Terrain data resolution |

### Life support (reference only, not counted in the kit)

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Oxygen** | — | — | — | — | Crew × days (0.84 kg per person-day, 3.36 kg a day for 4 crew) | Recycling | Resupply from Earth | — |
| **Water** | — | — | — | — | Crew × days (2.5 kg per person-day to drink) | Recycling (~93% on the ISS) | Resupply from Earth | — |
| **Food** | — | — | — | — | Crew × days (1.83 kg per person-day with packaging) | — | Resupply from Earth | — |

---

## 3. How each constraint shows up in the tool

| Constraint | Metric shown | Data source | Phase |
|---|---|---|---|
| Sunlight | Sunlit %, solar elevation, time to next sunset | DE421 + Moon orientation; LOLA skylines from Phase 2 | 1, 2 |
| Longest night | Hours; battery mass to survive it | Same | 1 (hours), 4 (mass) |
| Earth in view | Visible %, longest blackout, time to next Earthset | Same | 1 |
| Site comparison | Rankings and best dates across sites and dates | All of the above | 3 |
| Power needs | The power kit: array and battery to land; the biggest item | Mission profile + assumptions | 4 |
| DSN availability | Real contact windows | DSN complex locations; Earth rotation | 5 |
| Relay coverage | Blackouts with relays | ESA Lunar Pathfinder orbit | 5 |
| Landing safety | Flat share of the landing zone; worst case across the ellipse | LOLA elevation, 20 m | 6 |
| Water ice nearby | Nearest shadowed area, its temperature and distance | Shadowed-area maps (LRO) | Information only |

---

## 4. The phases

### Phase 1: The sky at a site (smooth Moon)

- The Moon's full orientation, including libration.
- The Sun's and Earth's azimuth and elevation at any latitude and longitude, over a date range, in 1-hour steps.
- The nine Artemis regions, each as a representative point.
- One page: pick a site and a date range, then see a sky plot with the Sun's and Earth's tracks, a timeline of when the site is sunlit and when Earth is in view, and the metrics: sunlit %, longest night, Earth-in-view %, longest blackout, time to the next sunset and Earthset, and solar elevation.

**Checked:** Sun and Earth positions match JPL Horizons to about 0.00001°, using a site on the Moon as the observer.

### Phase 2: Real terrain

- LOLA south-pole elevation maps from NASA's PGDA.
- A skyline for each site: the terrain's elevation in each direction, including distant massifs, not just nearby terrain.
- Skylines at 0, 2, 10 and 20 m above the ground. The app uses 10 m for panels and the antenna, and 2 m for a person standing.
- A panorama view: the skyline silhouette with the Sun's and Earth's tracks drawn over it.

**Checked:** against NASA's sunlight maps over the 9 Artemis regions at 2 m: average gap 2.0 points, against 19.7 for a smooth Moon ([nasa-comparison.md](../nasa-comparison.md)).

### Phase 3: Compare sites and dates

- A side-by-side view of 2–4 scenarios.
- "Pick a date → where?": every region ranked for one stay window, sortable by any metric.
- "Pick a site → when?": a region's best landing dates across a year (2026–2035).

### Phase 4: Needs vs. supply

- Mission profile: one crewed mission (see Mission scope), with an editable stay, crew size and power load list.
- A needs model: the power load, with every assumption stated on the page. Oxygen, water and food per person-day are listed for reference but not counted in the kit (they're the same at every site).
- **The load list:** about 10 kW for a crew of 4, from NASA's First Lunar Outpost habitat: crew systems (1.5 kW per person), avionics and communications (1.5 kW), the radio to Earth (300 W, only while in direct contact), other habitat systems (1.2 kW) and the science lab (1.0 kW, daylight only). Add-ons: a small rover, a crewed rover, a drill, work lights, or your own.
- A supply model: a Sun-tracking vertical solar array on a 10 m mast gives energy; the battery is sized hour by hour to the deepest drain over the stay, including nights that follow too short a recharge.
- A verdict for each scenario: the power kit you'd have to land (array and battery) and the biggest item.

### Phase 5: Real communications

- The DSN: Goldstone, Madrid and Canberra. A site has direct contact only when Earth is above its skyline, seen from the 10 m antenna, **and** a complex sees the Moon above 10°.
- Two relay satellites in ESA's Lunar Pathfinder orbit, half an orbit apart, shown as "with relays".
- **Power:** the radio's 300 W transmitter runs only while in direct contact with Earth. During a blackout it's off, and that saved power covers storing the data on board, so a blackout costs no extra battery. It does cost **storage**: data piles up at 600 Gb a day and drains at 110 Mbps in contact, and the app sizes the on-board storage to the largest pile.

### Phase 6: Landing safety and the landing ellipse

**Scope:** the nine Artemis regions only.

**The rules**

| Zone | Distance from the target | Rule |
|---|---|---|
| Landing ellipse | 0–100 m | At least 95% of the area under 10° slope (NASA's touchdown limit) |
| Panel area | 0–200 m (the ellipse plus a 100 m ring) | Panel spot under 20° (NASA's moonwalk limit) |
| Walking path | target → panel spot | Every pixel on the straight line under 20° |

- **One ellipse size for every lander:** 100 m radius, NASA's precision-landing goal.
- **Why 200 m:** we don't know where in the ellipse the lander ends up. A panel spot within 200 m of the target is at most 300 m from any touchdown point, our on-foot carrying limit.
- **Why the path starts at the target:** the touchdown point is unknown, and the ellipse is mostly flat, so astronauts can walk from wherever they land to the target, then follow the checked path out.
- **A flat patch smaller than the ellipse doesn't count.** The lander could come down anywhere in the ellipse, so the whole ellipse has to pass.

**How it works**
1. **Slope map** from the 20 m LOLA elevation map, read only around each region.
2. **Checked against real landings:** two landers that tipped over. IM-1 (Odysseus) tipped on a slope of about 12°; we measure 13.2° at its spot, so the slope method works. IM-2 (Athena) tipped into a crater smaller than a 20 m pixel, so its spot looks flat (3°) on the map: the known limit of 20 m data. Of the Artemis region points, Malapert (60%) and Nobile Rim 1 (90%) fail the 95% rule, as expected for sunniest-pixel points on peaks.
3. **Landing targets (shortlist):** slide the 100 m ellipse across each Artemis region, keep the targets where at least 95% of the ellipse is under 10° (slope only, fast), rank those by NASA's sunlight map, and keep the top 10 per region, at least 500 m apart. Checking every possible target in full would take hundreds of computer hours.
4. **Panel search for each target:** score **every** 20 m spot within 200 m (about 300 spots, each with its own skyline at 10 m):
   - skip spots 20° or steeper, and spots whose straight path from the target crosses a pixel of 20° or more;
   - no minimum distance from the target: the touchdown point is unknown, so a stand-off guarantees nothing and throws away the flattest ground;
   - no shortcut: in testing, a coarse search picked a 224 h night at Mons Mouton when a spot with a 166 h night was close by.
5. **Score each target:** three picks per target (most sunlight, shortest night, lightest kit) are sized with the Phase 4 model for the crewed mission (year-round base) over 2027; the lightest kit is the target's panel spot, and **targets are ranked by kit weight** (array + battery), not by longest night alone: the sizing also counts average sunlight and whether the battery can recharge between nights.
6. **Earth contact across the ellipse:** a skyline at every 40 m point in the ellipse (~21 points), at the 10 m antenna, each checked for direct contact (Earth above the skyline **and** a DSN dish sees the Moon) and with relays. Reports the target and the worst point.
7. **In the app:** Plan & compare → **Where to land?** (region map, ranked targets, landing zone and panel spot, kit and contact numbers), and **Stand here in 3D** for each target (landing-zone ring, panel pole, walking path).

**Results (year-round crewed base, 2027, panels at 10 m):**

| Region | Best kit | Kit at the target NASA's map rates best | Longest night at panels | Direct Earth contact across the zone |
|---|---|---|---|---|
| de Gerlache Rim 2 | 18.9 t | 29.0 t | 6.8 d | 59% |
| Nobile Rim 1 | 22.1 t | same target | 9.3 d | 64–66% |
| Mons Mouton Plateau | 22.5 t | 30.6 t | 9.3 d | 76–98% |
| Mons Mouton | 22.5 t | 24.9 t | 9.4 d | 64–77% |
| Malapert Massif | 25.3 t | 26.7 t | 7.2 d | 59–69% |
| Peak Near Cabeus B | 29.1 t | 29.2 t | 12.1 d | 96% |
| Haworth | 33.0 t | 33.0 t | 13.7 d | 75–81% |
| Slater Plain | 33.2 t | 33.4 t | 14.3 d | 47% |
| Nobile Rim 2 | 36.0 t | 36.6 t | 15.2 d | 62–64% |

- Ranking by kit weight rather than average sunlight saves mass in 8 of 9 regions: 10.1 t at de Gerlache Rim 2, 8.1 t at Mons Mouton Plateau, 2.4 t at Mons Mouton, 1.4 t at Malapert Massif, 0.6 t at Nobile Rim 2, and 0.2 t or less at Slater Plain, Peak Near Cabeus B and Haworth. In Nobile Rim 1, the target NASA's sunlight map rates best is also the lightest kit.
- Moving the panels a short walk matters: at Mons Mouton Plateau's best target the landing point itself has an 11.2-day night, the panel spot 200 m away 9.3 days.
- Panel spots at the #1 targets are 60–200 m from the target.
- The battery is the biggest item at every #1 target (17.8–35.6 t); the solar array is under 1.2 t. Air, water and food aren't counted: they're the same at every region.
- With the two relays, contact rises to about 98% from every point in every zone. The relays fill every terrain blackout, but they still talk to Earth through a DSN dish, so the DSN's own gaps (2 h at most) remain.
- The 20° panel and path rules barely bit: of 28,530 panel spots checked across all 90 targets, 6 were too steep and 3 more had a blocked path.

**Limits:** 20 m pixels miss boulders and smooth out small slopes, so the real slope under the lander's legs can be steeper (IM-2). The 95% rule and the 300 m reach are our own assumptions. Results are for one mission (the crewed mission's year-round base) and one year (2027). Targets are shortlisted by NASA's average-sunlight map, so a target with a lower average but a shorter night could be missed before the full calculation. In 3D, the timeline and sky chart are the region point's, not the target's.

### Water ice (information only)

The challenge doesn't ask us to account for water, so nothing here feeds the calculations: the kit weight and the target ranking stay exactly as they are. Each site just shows the nearest permanently shadowed area, whether it's cold enough to hold ice, and how far away it is.
