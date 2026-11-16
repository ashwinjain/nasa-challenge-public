# Lunar Landing Site Navigator: constraints and phased plan

Challenge: [Lunar Landing Site Navigator](lunar-landing-site-navigator.md)

The tool is built around one comparison:

$$
\text{needs (from the mission profile)} \;\le\; \text{supply (from site × date × equipment)}
$$

For every scenario it answers three questions: does that hold, where does it break, and which constraint breaks first?

---

## 1. What we vary

| Axis | What it means | Examples |
|---|---|---|
| **Site** | Where the lander sets down | The nine Artemis III south-pole regions, or a custom latitude and longitude |
| **Spot and height** | Exact position within the landing ellipse, and how high panels or antennas sit | A few hundred meters off target; a panel at 2 m vs. a 10 m mast |
| **Date and time** | Landing date, time within the lunar day, and the mission window | Slipping two weeks; landing at local sunrise; a 14-day mission |
| **Long term** | Slow cycles that shift conditions over years | The 11-year solar cycle; the 18.6-year cycle of the Moon's orbit |
| **Mission profile** | What the mission needs | A crew of 4 landing in early 2026, staying a year by default |
| **Equipment** | What we choose to bring | Panel height and type; battery, fuel cell or nuclear; how closed the recycling is; shielding depth |
| **Infrastructure** | What else is there to help | A relay in lunar orbit (our ELFO); DSN load; a power cable to a sunlit peak |
| **Uncertainty** | What we don't know precisely | Ice concentration; terrain data resolution; landing dispersion |

---

## 2. Constraints across the axes

Key: **Strong** means this axis can make or break the constraint. "—" means no meaningful effect.

### Power and environment

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Sunlight (power)** | **Strong**: latitude and terrain decide it | **Strong**: a few hundred meters or a 10 m mast changes it | **Strong** at the poles: season (±1.54°) and where the Sun is on its monthly circle | The 18.6-year cycle shifts polar lighting slightly | Sets how much power is needed | Panel height, orientation, efficiency | Cable to a sunlit peak | Terrain data resolution |
| **Longest dark stretch** | **Strong** | **Strong** | **Strong**: longer in polar winter | Slight | Sets the load to carry through the dark | Storage type and size: battery, fuel cell, nuclear | Cable to a sunlit peak | Terrain data resolution |
| **Temperature** | Rims vs. crater floors | Nearby shadows | Day vs. night; season | — | Heating and cooling load | Insulation, regolith heat storage, radiators | — | — |
| **Radiation** | Slight: crater walls block some sky | — | Solar storms | **Strong**: the 11-year solar cycle | Crew vs. robotic tolerance; duration | Shielding depth; radiation-tolerant electronics | — | When storms happen |
| **Dust** | Surface type | Distance from the landing pad | Worse near the day–night boundary | — | Number of landings and rover traffic | Sintered pads, berms | Neighbors' landings | — |

### Communications

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Earth in view** | **Strong**: latitude and terrain | **Strong** | **Strong**: libration moves Earth through the polar sky every month | — | How much contact is needed | Antenna mast height | — | Terrain data resolution |
| **DSN availability** | — | — | **Strong**: Earth's rotation decides which complex sees the Moon | — | — | — | Other missions competing for antennas | — |
| **Data rate** | Earth's elevation at the site | — | Earth's distance and elevation | — | Data volume needed | Antenna size, transmitter power | Relay; DSN antenna size | — |
| **Relay coverage** | **Strong**: the site's latitude vs. the relay's orbit | Terrain | Where the relay is in its orbit | — | — | Relay radio on the lander | Is a relay there? | — |

### Landing

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Landing safety (slope, boulders)** | **Strong** | **Strong**: varies across the landing ellipse | — | — | Lander size | Slope tolerance; hazard avoidance | — | Terrain data resolution |
| **Lighting at touchdown** | **Strong** | — | **Strong**: time of day | — | — | Camera vs. lidar navigation | — | — |
| **Earth in view at touchdown** | **Strong** | — | **Strong** | — | — | — | A relay can stand in | — |
| **Getting there** | **Strong**: some sites only in some months | — | **Strong**: orbit alignment and launch windows | — | Lander fuel | Lander performance | Staging orbit | — |

### Life support (crewed missions)

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Oxygen** | Distance to ice | — | Power available to make it | — | Crew × days (~0.84 kg per person-day) | Extraction method; recycling | — | Ice concentration |
| **Nitrogen** | — | — | — | — | Crew × days; leak rate | Leak rate; airlock design | Resupply from Earth | — |
| **Water** | Distance to ice | Which shadowed crater | Power available to process it | — | Crew × days | Recycling (~98% on the ISS) | Resupply from Earth | Ice concentration |
| **Food** | Sunlight, if growing crops | — | How continuous the sunlight is | — | Crew × days (~10–30 kW per person to grow it all) | Bring vs. grow; crops vs. microbes | Resupply from Earth | — |
| **Shelter and shielding** | Regolith depth; how easy it is to dig | — | — | Solar cycle | Crew × duration | Digging machines | — | — |

### Operations and science

| Constraint | Site | Spot and height | Date and time | Long term | Mission profile | Equipment | Infrastructure | Uncertainty |
|---|---|---|---|---|---|---|---|---|
| **Access to ice** | **Strong**: distance to a shadowed crater | **Strong** | Lighting along the route | — | Whether ice is needed | Rover range; cold tolerance | — | Where the ice actually is |
| **Getting around** | Slopes | — | Lighting along the route | — | Distances to drive | Rover | — | Terrain data resolution |
| **Science value** | **Strong** | — | — | — | Mission goals | Instruments | — | — |
| **Neighbors** | **Strong** | — | More missions over time | — | — | — | Other missions' sites | — |

---

## 3. How each constraint shows up in the tool

| Constraint | Metric shown | Data source | Phase |
|---|---|---|---|
| Sunlight | Sunlit %, solar elevation, time to next sunset | DE421 + Moon orientation; LOLA horizons from Phase 2 | 1 |
| Longest dark stretch | Hours; storage mass to survive it | Same | 1 (hours), 4 (mass) |
| Earth in view | Visible %, longest blackout, time to next Earthset | Same | 1 |
| Site comparison | Grid of any metric across sites × dates | All of the above | 3 |
| Power, air, water, food needs | Pass/fail; which constraint fails first; what you'd need to bring | Mission profile + assumptions | 4 |
| DSN availability, data rate | Real contact windows | DSN complex locations; Earth rotation | 5 |
| Relay coverage | Coverage gained | `world_sim/lunar_orbit.py` | 5 |
| Earth in view at touchdown | Yes/no at the landing time | Same as Earth in view | 5 |
| Landing safety | Slope map; worst case across the ellipse | LOLA elevation | 6 |
| Lighting at touchdown | Sun elevation and shadow length at landing | DE421 + terrain | 6 |
| Access to ice, getting around | Drive distance and slope to the nearest shadowed crater | Shadowed-crater maps (LRO); LOLA | 7 |
| Oxygen and water yield | Range, given uncertain ice content | Assumed ranges | 7 |
| Temperature, radiation, dust, neighbors, science | Simple scores or flags | Simple models; published site lists | 7 |
| Getting there | Out of scope for now | — | — |

---

## 4. Phased plan

Rules for every phase:

- **Each phase ends in something we can submit:** a working demo, a short video, and a write-up of what it does and what it doesn't do yet.
- **Later phases add layers, never rework.** Phase 1's numbers keep their meaning when terrain arrives; only their accuracy improves.
- **The "limits" note stays current.** If we stop, the submission is honest about what's missing.
- **Order is value per effort.** The earliest phases cover the most challenge objectives for the least work.

### Phase 1: The sky at a site (smooth Moon)

**Build**
- The Moon's full orientation, including libration, from skyfield's lunar frame files. Today `world_sim` uses only the Moon's mean pole. That's fine for the relay's orbit but not for a point on the surface. The main project's Phase 1 needs this too.
- The Sun's and Earth's azimuth and elevation at any latitude and longitude, over a date range, in 1-hour steps.
- A smooth-Moon horizon, either 0° or a fixed minimum elevation.
- The nine Artemis regions, each as a representative point, plus custom coordinates.
- One page: pick a site and a date range, then see:
  - a sky plot with the Sun's and Earth's tracks,
  - a timeline of when the site is sunlit and when Earth is in view,
  - metrics: sunlit %, longest dark stretch, Earth-in-view %, longest blackout, time to the next sunset and Earthset, and solar elevation.

**Deliverable:** "Pick any site and date, and see where the Sun and Earth are, when they set, and how much power and contact you'd get."

**Challenge objectives covered:** Sun and Earth visualization, time until sunset and Earthset, date flexibility, custom coordinates, power and communication metrics.

**Done when:** Sun and Earth positions for one site and time match JPL Horizons, using a site on the Moon as the observer, to within ~0.1°.

**Limits if we stop here:** smooth Moon, so polar results ignore terrain and are only approximate.

### Phase 2: Real terrain

**Build**
- Download the LOLA south-pole elevation data from PGDA.
- Compute a horizon mask for each site: the skyline's elevation in each direction. It has to include distant massifs, not just nearby terrain.
- Compute masks at a few heights (ground, 2 m, 10 m), so panel and mast height become a choice.
- Precompute all of this offline and ship it as small files.
- A panorama view: the skyline silhouette with the Sun's and Earth's tracks drawn over it.
- A smooth-vs-terrain toggle that shows why terrain matters.

**Deliverable:** accurate south-pole lighting and Earth visibility using real topography.

**Done when:** the terrain results agree with a published illumination value for a well-studied polar spot.

**Limits if we stop here:** one point per site; custom coordinates get terrain only inside the mapped polar area.

**Shared with the main project:** these are the horizon masks planned in [PROJECT_SPEC.md](../PROJECT_SPEC.md).

### Phase 3: Compare sites and dates

**Build**
- A side-by-side view of 2–4 scenarios.
- "Pick a date → where?": every site ranked for one stay window, sortable by any metric.
- "Pick a site → when?": a site's best landing dates across a year (2026–2035).

*Dropped:* the sites × dates grid ("Explore", removed in `38949ef`; it's in
`b10c2b0` if needed) and a "slip the launch" control. The two
views above answer the same questions more directly.

**Deliverable:** rapid scenario comparison, the challenge's central ask.

**Done when:** both views and Compare work for every site and every year 2026–2035, inside the main app. ✅ Done (README "Phase 3 Acceptance").

**Limits if we stop here:** the metrics are geometry only. Nothing yet says whether they're good enough for a given mission.

### Phase 4: Needs vs. supply

**Build**
- Mission profile: one crewed mission (see Mission scope), with editable crew stay, crew size and power load. *(Originally three profiles, robotic, crew for a week and long-term base, plus a cost on each lander; since narrowed.)*
- A needs model: power load, plus oxygen, water and food per person-day, with every assumption stated on the page.
- A supply model: panel area and height give energy; the storage type gives the mass needed to survive the longest dark stretch.
- A verdict for each scenario: pass/fail, the biggest item, and the tonnage you'd have to land (panels, battery, supplies).
- The Phase 3 ranking and best-dates views can now show pass/fail.

Every later phase that adds equipment or activity (radios, rovers, ice
processing) adds its power draw to this model, so the verdict always
reflects the whole mission.

**Deliverable:** the question moves from "where is the Sun?" to "does this mission work here, and what breaks first?"

**Limits if we stop here:** communication means only "Earth is in view"; the landing point is treated as exact.

### Phase 5: Real communications

**Build**
- The DSN: Goldstone, Madrid and Canberra. A site has contact only when Earth is above its skyline **and** a complex sees the Moon above 10°.
- Earth in view at the touchdown time.
- Optional: a rough data rate from Earth's distance and elevation.
- A relay overlay: the ELFO from `world_sim/lunar_orbit.py`, visible when it's above the site's skyline, showing how much coverage it adds.
- **Power feeds back into Phase 4:** the radio's transmit power is added to the base load, and a longer blackout can mean storing more data (and power) between contacts.
- **Tech debt from Phase 4: the load list.** Phase 4's Customize panel takes the power load as one number (kW). Before the radio's power can be added, replace it with a short list you can edit: habitat, survival heaters, radio, rover charging, with the total feeding the sizing. Phase 5 adds the radio line. The sizing doesn't change: the array and battery scale in proportion to the total load, so the page re-sizes for a new list without asking the server (`frontend/src/plan/powerModel.js`).

**Deliverable:** real contact windows, and how much a relay adds. This connects to [decision 002](../decisions/002-lunar-relay.md).

**Limits if we stop here:** each site is still treated as an exact point.

### Phase 6: Landing safety and the landing ellipse

**Scope:** the nine Artemis regions only. Nothing else is precomputed.

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

**Build**
1. **Slope map** from the 20 m LOLA elevation map (`data/phase-6/LDEM_80S_20MPP_ADJ.TIF`), read only around each region.
2. **Check against NASA before tuning** (done): IM-1 measures 13.2° at its pin (reported ~12°), so the slope method works. IM-2 looks flat (3°) because the crater it tipped into is smaller than a 20 m pixel. Chandrayaan-3 (69°S) is outside the 20 m map. Of the Artemis pins, Malapert (60%) and Nobile Rim 1 (90%) fail the 95% rule, as expected for sunniest-pixel pins on peaks.
3. **Landing targets (shortlist):** slide the 100 m ellipse across each Artemis region, keep the targets where at least 95% of the ellipse is under 10° (slope only, fast), rank those by NASA's sunlight map, and keep the top ~10 per region. Brute-forcing every target was considered and dropped (hundreds of CPU-hours).
4. **Panel search for each shortlisted target:** score **every** 20 m spot within 200 m (~300 skylines, ~20 s), using the Phase 4 code in `lunarsky/panels.py`:
   - skip spots 20° or steeper, and spots whose straight path from the target crosses a pixel of 20° or more;
   - **no minimum distance from the target** (the old 100 m stand-off is dropped: the touchdown point is unknown, so it guaranteed nothing, and it threw away the flattest ground);
   - no "rank by height" shortcut: Phase 4 found that a shortcut misses short-night spots (at Mons Mouton it picked a 224 h night over a nearby 166 h one).
5. **Score each target:** both panel picks (most sunlight, shortest night) are sized with the Phase 4 model for the crewed mission (year-round base) over 2026; the lighter kit is the target's panel spot, and **targets are ranked by kit weight** (array + battery + supplies), not by longest night alone: the sizing also counts average sunlight and whether the battery can recharge between nights.
6. **Earth contact across the ellipse:** a skyline at every 40 m point in the ellipse (~21 points), each checked for direct contact (Earth above the skyline **and** a DSN dish sees the Moon) and with relays. Reports the target and the worst point.
7. ~~Lighting at touchdown~~: dropped. Landers scan for hazards with lidar and carry lights, so it would only ever be a warning.
8. **In the app:** Plan & compare → **Where to land?** (region map, ranked targets, landing zone and panel spot, kit and contact numbers), and **Stand here in 3D** for each region's #1 target (landing-zone ring, panel pole, walking path).

*Dropped:* per-lander ellipse sizes, a roughness map (at 20 m pixels it adds little beyond slope), and the touchdown-lighting warning.
*Later* (`docs/tech-debt.md`): a slope overlay on the 3D terrain; 3D terrain for all 10 targets per region (waits on Josepher's terrain work); reading slope straight from the slope map in the panel search.

**Status:** ✅ Built (README "Phase 6 Acceptance").

**Results (long-term crewed base, 2026):**

| Region | Best kit | NASA's top pick | Longest night at panels | Direct Earth contact across the zone |
|---|---|---|---|---|
| Nobile Rim 1 | 31.9 t | same target | 9.3 d | 50–65% |
| Mons Mouton Plateau | 33.4 t | 41.5 t | 9.8 d | 41–83% |
| de Gerlache Rim 2 | 33.9 t | 42.0 t | 11.1 d | 47–59% |
| Malapert Massif | 35.2 t | 37.0 t | 7.9 d | 42–67% |
| Peak Near Cabeus B | 39.3 t | same target | 12.1 d | 49–83% |
| Mons Mouton | 40.0 t | 46.6 t | 10.4 d | 45–64% |
| Haworth | 43.1 t | 43.2 t | 13.7 d | 56–78% |
| Slater Plain | 44.4 t | 45.4 t | 14.3 d | 46–47% |
| Nobile Rim 2 | 46.2 t | 46.8 t | 15.1 d | 57–79% |

- Ranking by kit weight beats NASA's sunniest safe target in 8 of 9 regions (panels at 10 m, 2026): by 9.5 t at de Gerlache Rim 2, 6.8 t at Mons Mouton Plateau, 2.6 t at Mons Mouton, 1.5 t at Malapert Massif, and by 0.5 t or less in the other four. In Nobile Rim 1 NASA's sunniest is also our #1.
- Moving the panels a short walk matters: at Malapert's best target the landing point itself has a 20-day night, the panel spot 83 m away 7.9 days.
- The battery dominates (21–36 t). No single lander carries a long-term base kit, as Phase 4 found.
- With the two relays, contact is 100% from every point in every zone (straight from the Phase 5 relay model; worth checking against the Lunar Pathfinder guide).
- The 20° panel and path rules barely bit: targets chosen for flat landing zones sit in gentle terrain.

**Deliverable:** for each Artemis region, the best landing targets that are safe even if you land off target, with where the panels go and what that means for power and contact.

**Limits if we stop here:** 20 m pixels miss boulders and smooth out small slopes, so the real slope under the lander's legs can be steeper (IM-2). The 95% rule and the 300 m reach are our own assumptions. Results are for one mission (the crewed mission's year-round base) and one year (2026), precomputed. Targets are shortlisted by NASA's average-sunlight map, so a target with a lower average but a shorter night could be missed before the full calculation. In 3D, the timeline and sky chart are still the region pin's (the lighting is right; the "% sunlit" numbers are the pin's).

### Phase 7: Resources and the base

**Scope:** information only. The challenge doesn't ask us to account for water, so nothing here feeds the calculations: Phase 4's sizing, kit weight and Phase 6's target ranking stay exactly as they are. Each site just shows these facts alongside its results.

**Build**
- **Nearest water ice:** the nearest permanently shadowed area, whether it's cold enough to hold ice, and the straight-line distance and steepest grade to reach it.
- Ice concentration as a range, with the water and oxygen it could give, shown as context only.
- Regolith: shielding tonnage and digging effort.
- Simple flags for temperature, radiation by solar-cycle phase, neighbors and science value.

*Dropped:* feeding ice processing and driving into Phase 4's power load, and cutting supplies brought from Earth by locally made water and oxygen. Both would change the kit weight that ranks Phase 6's targets, and water isn't part of the challenge's scope.

**Deliverable:** a resources panel for each site: facts to read, not inputs to the plan.

### Add-ons (any time after Phase 1)

- **Lander in a jar:** the heat lamp replays the chosen site's sunlight timeline while the Pi's chip temperature follows it. This uses the existing lamp and `tools/lamp_cycle.py`.
- **Educational mode:** drag the pin and watch sunlight change; a libration animation; plain-language explanations; side-by-side comparisons of Earth and Moon conditions.
- **Uncertainty runs:** show ranges instead of single values wherever inputs are uncertain.

---

## Mission scope

- **One mission:** a crewed mission landing in **early 2026**. Crew of 4, stay **editable, default 1 year** (the long-term base profile). The year is editable too, defaulting to 2026.
- **Robotic profiles are removed** (Robot · short, Robot · year).
- **Report tonnage to the Moon only:** total mass to land, broken down into panels, battery and supplies. **No lander list, payload limits, first-flight years or prices.**
- **Phase 6's precompute stays on 2026** (lighting, contact and the target ranking by kit weight). The mission year moved back from 2026 to 2026 on 2026-11-14.

## 5. Build approach

- **Compute in Python,** reusing skyfield, DE421 and `world_sim`. Put the navigator in a new `navigator/` package.
- **Serve it like the dashboard:** FastAPI plus a static page.
- **Precompute the curated sites** to files, so a static copy can be hosted for judges. Custom coordinates go through the API.

## 6. Open questions

- Event dates and the challenge's Resources tab are still unchecked.
- ~~Is the entry aimed at a robotic CLPS-style lander or a crewed base?~~ Decided: a crewed mission in early 2026 (year changed from 2028 on 2026-11-14) (see Mission scope).
- Where do we host the demo?
