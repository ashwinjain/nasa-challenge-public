# What the navigator assumes

Every assumption behind the app's numbers: what is assumed, what that leaves
out, and why. This is the same list the Assumptions button in the app opens.
The numbers keep their place, so "assumption 33" always means the same one.

# Sun, Earth and terrain

## 1. Where the Sun and Earth are

Sun, Earth and Moon positions come from JPL's DE421 ephemeris.

- **What it leaves out:** Only dates from 1900 to 2049.
- **Why:** JPL's standard data. Our positions match JPL Horizons to 0.00001°.
- **Source:** JPL NAIF kernels; Our check against JPL Horizons

## 2. No refraction

Light travels in straight lines to the site.

- **What it leaves out:** Nothing.
- **Why:** The Moon has no atmosphere to bend it.

## 3. The Moon is a sphere

The Moon is a 1737.4 km sphere; heights are measured from it.

- **What it leaves out:** The Moon's 2 km flattening.
- **Why:** The LOLA elevation maps use the same sphere.
- **Source:** NASA PGDA product 90 (LOLA maps)

## 4. Real terrain near the south pole

South of 60°S the horizon is the terrain's skyline: 720 directions, out to 300 km.

- **What it leaves out:** Nothing beyond 300 km, and nothing smaller than 20 m (boulders, small rims).
- **Why:** Far mountains block the low polar Sun. Over the 9 Artemis regions, our sunlight lands within 2.0 points of NASA's maps on average.
- **Source:** Our comparison with NASA's maps; Mazarico et al. 2011

## 6. Sunlight

Sunlight is the share of the Sun's disk above the skyline.

- **What it leaves out:** No limb darkening.
- **Why:** A half-risen Sun gives about half the power. NASA's maps are checked the same way.
- **Source:** Our comparison with NASA's maps

## 7. Night

Night means less than half of the Sun's disk is above the skyline. Losing contact with Earth is a comms blackout, not night.

- **What it leaves out:** A sliver of Sun counts as night.
- **Why:** A sliver gives almost no power. (Our choice.)

## 8. Earth in view

Earth is in view when any part of its disk is above the skyline.

- **What it leaves out:** A sliver of Earth counts as in view.
- **Why:** NASA's Earth-visibility maps use the same rule.
- **Source:** NASA PGDA product 69 (sunlight and Earth maps)

## 9. Sun at 2 m everywhere else

Outside the power numbers, the Sun is measured for a person standing (2 m): the timeline, the sky chart, the 3D view and Plan's site table. The main page's tiles are full-year power numbers, at the panels (10 m).

- **What it leaves out:** The power card and landing-target ranking use panels at 10 m, so one site can show two Sunlit %.
- **Why:** 2 m matches NASA's sunlight map to about 2 points; at 0 m, bumps in the map hide the Sun.
- **Source:** Our comparison with NASA's maps

## 10. Direct sunlight only

Only light straight from the Sun counts.

- **What it leaves out:** No earthshine, no light bounced off nearby terrain.
- **Why:** A simplification. (Our choice.)

# Power

## 11. Sun-tracking panels

A vertical solar array on a mast turns to face the Sun.

- **What it leaves out:** No dust, heat, ageing or one panel shading another.
- **Why:** NASA's VSAT design, built for the low polar Sun.
- **Source:** NASA VSAT report (NTRS 20240003162)

## 12. Sunlight strength

Sunlight is 1361 W/m² at 1 AU, scaled by the real Sun distance each hour.

- **What it leaves out:** No change over the solar cycle.
- **Why:** The measured value.
- **Source:** Kopp & Lean 2011

## 13. Solar cells

Cells are 28% efficient at end of life; 85% of the array area is cells.

- **What it leaves out:** Real arrays range 22–32% and 75–90%.
- **Why:** Vendor datasheets for efficiency. Packing has no single source.

## 15. Battery

150 Wh/kg at pack level, 80% usable, 90% charge-discharge efficiency.

- **What it leaves out:** No self-discharge, cold loss or ageing.
- **Why:** Typical lithium-ion figures. No single source. (Our choice.)

## 16. Battery size

The battery is sized to the deepest drain over the stay. It starts full and never runs empty.

- **What it leaves out:** Nothing.
- **Why:** Catches a night that follows too short a recharge.

## 19. Power margin

The load is sized with a 25% margin.

- **What it leaves out:** A bigger kit than the bare load needs.
- **Why:** NASA GSFC-STD-1000 asks for 25% at concept stage.

## 20. A year that repeats

A one-year stay repeats every year, so the panels must break even over the year.

- **What it leaves out:** The Moon's 18.6-year lighting cycle.

## 21. Array sizes tried

Seven array sizes are tried, from 1.05× to 5× break-even; the lightest kit wins.

- **What it leaves out:** The best size may fall between them.
- **Why:** A simple search. (Our choice.)

## 24. Add-on loads

Rover 450 W, crewed rover 1.4 kW, drill 100 W, work lights 200 W.

- **What it leaves out:** Nothing.
- **Why:** NASA VIPER, NASA TM-105925 and the TRIDENT drill. Lights are our estimate.
- **Source:** NASA VIPER overview (NTRS 20230011558)

# Communications

## 25. Comms blackout

A stretch with no direct radio contact with Earth: Earth is behind the terrain as seen from a 10 m antenna mast, or no Deep Space Network complex (Goldstone, Madrid, Canberra) has the Moon at least 10° above its horizon. "With relays" also counts the relay satellites.

- **What it leaves out:** No dish scheduling, weather or link budget, so this is the best case.
- **Why:** 10° is a common DSN planning limit.
- **Source:** NASA DSN Handbook 810-005, Module 301

## 26. One DSN check for every site

Deep Space Network visibility is worked out once and shared by every site.

- **What it leaves out:** Under 0.05° of error.
- **Why:** Every site is within 200 km of the pole.

## 27. Two relay satellites

Two relays fly ESA's Lunar Pathfinder orbit, half an orbit apart.

- **What it leaves out:** No orbit drift; where they start in the orbit is a guess.
- **Why:** The orbit is ESA's. The second relay and the start point are our choice.
- **Source:** SSTL Lunar Pathfinder Service Guide

## 28. Relay hours

An hour counts as covered if a relay is usable for half of it.

- **What it leaves out:** Gaps under 30 minutes disappear.
- **Why:** Fits the hourly grid the rest of the app uses. (Our choice.)

# Landing and panels

## 29. Landing accuracy

The lander comes down within 100 m of its target.

- **What it leaves out:** Nothing.
- **Why:** NASA's precision-landing goal.
- **Source:** NASA precision landing (NTRS 20250003778)

## 30. Safe landing zone

A target is safe if 95% of its 100 m zone slopes under 10°.

- **What it leaves out:** Slope is measured over 40 m, so rocks and small craters are missed.
- **Why:** 10° is NASA's touchdown limit. The 95% share is our choice.
- **Source:** NASA HLS overview, 2025 (NTRS 20250009323)

## 31. Ten targets per region

Ten targets per region, at least 500 m apart, shortlisted by NASA's long-term sunlight map, then ranked by the power kit they need over 2027.

- **What it leaves out:** A target with a lower average but a shorter night could miss the shortlist. The ranking ignores the dates you pick.
- **Why:** Checking every flat spot in full would take hundreds of computer hours. Count and spacing are our choice.
- **Source:** NASA PGDA product 69 (sunlight and Earth maps)

## 33. Panels and antenna at 10 m

Solar panels and the comms antenna sit on a 10 m mast, so they see over nearby hills. Every power number and every comms number is measured there.

- **What it leaves out:** A shorter mast would see less Sun and less Earth.
- **Why:** NASA's VSAT project is building masts of this kind.
- **Source:** NASA VSAT report (NTRS 20240003162)

## 34. Moonwalks

Panels and comms gear go at most 300 m from the lander, carried on foot, on slopes under 20°.

- **What it leaves out:** Spots farther out are never considered.
- **Why:** 300 m is our conservative limit for carrying and cabling gear; 20° is NASA's slope limit for astronauts on foot.
- **Source:** NASA HLS overview, 2025 (NTRS 20250009323)

## 35. Missing map pixels

Gaps in the elevation map count as not flat.

- **What it leaves out:** A few good spots are rejected.
- **Why:** Safer than landing on unknown ground.

# Data sources

## 36. Elevation maps

NASA's LOLA elevation maps (20, 80 and 240 m pixels) are right to the pixel.

- **What it leaves out:** If the 20 m map is missing, the app quietly uses the 80 m map.
- **Why:** NASA's newest polar maps.
- **Source:** Barker et al. 2023; NASA PGDA product 90 (LOLA maps)

## 37. NASA's sunlight maps

NASA's average-sunlight maps pick and rank the points we study.

- **What it leaves out:** NASA doesn't state its eye height or elevation model.
- **Why:** NASA's own answer for how often each spot is lit.
- **Source:** Mazarico et al. 2011; NASA PGDA product 69 (sunlight and Earth maps)

## 38. One point per region

Each region is represented by its sunniest pixel.

- **What it leaves out:** Ignores slope and Earth; three regions only fit the coarser 120 m map.
- **Why:** One rule, the same for every region.

## 39. Nine Artemis III regions

Only NASA's nine Artemis III candidate regions are listed.

- **What it leaves out:** No other sites.
- **Why:** The official outlines.
- **Source:** USGS Artemis III region outlines

# Time and scope

## 41. Hourly steps

Everything is sampled once an hour, in UTC.

- **What it leaves out:** Durations are good to about an hour.
- **Why:** The Sun moves about one disk width an hour, and hourly files stay small.

## 43. Planning years

Planning covers 2026 to 2035.

- **What it leaves out:** Later years.
- **Why:** A span long enough to compare landing dates. (Our choice.)

## 44. How accurate it is

Checked over 18.6 years against NASA's maps at the 9 Artemis regions, from 2 m.

- **What it leaves out:** Sunlight is off by 2.0 points on average (7.0 at worst); Earth in view runs 3.4 points high.
- **Why:** 18.6 years is the Moon's full cycle, the span NASA's maps average over.
- **Source:** Our comparison with NASA's maps

## 45. One mission

One crewed mission: a crew of 4 staying a year.

- **What it leaves out:** No robotic missions.

## 46. Solar and battery only

Power comes from solar panels and batteries.

- **What it leaves out:** No nuclear power or fuel cells. The battery is most of the kit (20–51 t), so a fission power unit would likely be lighter for a year-round base.
- **Why:** The challenge is about sunlight and Earth contact, and solar plus battery is the option those decide. Mass is what lets regions be compared fairly. (Our choice.)

## 47. What the verdict counts

The verdict is the mass of panels and battery to land. Air, water and food are left out: crew and stay are fixed, so they weigh the same at every site.

- **What it leaves out:** No habitat, lander or cable mass.

## 48. Left out

No heat, dust, radiation risk, descent path or launch windows.

- **What it leaves out:** All of those.
- **Why:** Not part of this project's scope.
