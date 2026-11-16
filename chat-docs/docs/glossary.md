# Glossary: terms used in the navigator

Plain meanings for the words and abbreviations the app and its docs use.

## Places and missions

- **Artemis:** NASA's program to return astronauts to the Moon.
- **Artemis III:** the planned Artemis mission to land a crew near the
  Moon's south pole. The nine regions in the app are its candidate landing
  regions. The app's own mission (a crew of 4 staying a year) is a planning
  scenario, not NASA's Artemis III plan.
- **Region:** one of NASA's nine Artemis III candidate landing regions, each
  an outline on the map published by the US Geological Survey (USGS).
- **Reference point:** the sunniest pixel in a region on NASA's
  average-sunlight map. The timeline, tiles and 3D view use it.
- **Landing target:** a spot the lander aims for. Each region has ten safe
  ones, at least 500 m apart.
- **#1 landing target:** the region's target that needs the lightest power
  kit. The site card shows it.
- **Landing zone (landing ellipse):** the circle of 100 m radius around a
  target where the lander may actually touch down. NASA's precision-landing
  goal is to land within 100 m of the target.
- **Panel spot:** where the solar panels and the antenna mast go, within
  200 m of the target.
- **On-foot reach:** 300 m, the farthest the crew carries panels and comms
  gear from the lander.
- **IM-1 and IM-2:** Intuitive Machines' Odysseus (2024) and Athena (2025)
  landers. Both tipped over on landing; the app uses them to check its
  slope method.

## Sun, Earth and terrain

- **Skyline (horizon profile):** how high the terrain rises in every
  direction, seen from one spot. The Sun or Earth is up only when it clears
  the skyline.
- **Smooth Moon:** the Moon treated as a perfect sphere with no terrain.
  Used as a baseline to show how much the real terrain matters.
- **Mast height:** how high above the ground something sits. Panels and the
  antenna are on a 10 m mast; a person standing is 2 m.
- **Sunlit %:** the share of time the Sun is up. The Sun counts by the share
  of its disk above the skyline, so a half-risen Sun counts as half.
- **Night:** a stretch when less than half the Sun's disk is above the
  skyline. **Longest night** is the longest such stretch in the dates you
  picked.
- **Earth in view %:** the share of time any part of Earth's disk is above
  the skyline. Earth counts as in view or not, with no partial credit.
- **Libration:** the Moon's slow wobble as seen from Earth. At the south
  pole it makes Earth rise and sink near the horizon over each month.
- **18.6-year cycle:** the slow turning of the Moon's orbit that shifts
  polar lighting over the years. NASA's sunlight maps average over it.
- **Lunar day:** about 29.5 Earth days from one sunrise to the next at most
  of the Moon. Near the pole the Sun circles the horizon instead, so nights
  depend on terrain and can be much shorter or longer.
- **Permanently shadowed region (PSR):** ground the Sun never reaches,
  usually crater floors near the pole. Some are cold enough to hold water
  ice.
- **Cold trap:** a place cold enough (below about 110 K, −163 °C) for water
  ice to last for very long times.
- **Kelvin (K):** temperature from absolute zero. 0 °C is 273 K.

## Power

- **Power kit:** the solar array plus the battery the mission must land. Air,
  water, food, habitat, lander, mast and cables are not counted.
- **Load:** the power the base uses: about 10 kW by day and 8.7 kW at night
  for a crew of 4.
- **kW and kWh:** kilowatts measure power (how fast energy is used); kilowatt
  hours measure energy (how much). A 10 kW load for one hour uses 10 kWh.
- **t (tonne):** 1,000 kg.
- **Break-even array:** the smallest solar array whose output over the stay
  equals what the base uses.
- **Depth of discharge:** how much of a battery's stored energy is used. The
  app assumes 80%.
- **Specific energy:** energy stored per kilogram of battery (150 Wh/kg in
  the app).
- **Power margin:** extra capacity on top of the bare load: 25% in the app.
- **VSAT (Vertical Solar Array Technology):** a NASA project for tall,
  vertical, Sun-tracking solar arrays on masts, suited to the low polar Sun.

## Communications

- **Direct contact:** the base can talk straight to Earth: Earth is above the
  antenna's skyline and a Deep Space Network dish sees the Moon at least 10°
  up.
- **Comms blackout:** a stretch with no direct contact. **Longest blackout**
  is the longest one in the dates you picked.
- **DSN (Deep Space Network):** NASA's large radio dishes for talking to
  spacecraft, at three complexes: Goldstone (California), Madrid (Spain) and
  Canberra (Australia).
- **Relay satellite:** a satellite orbiting the Moon that passes messages
  between the base and Earth when Earth is hidden.
- **Lunar Pathfinder:** an ESA lunar communications satellite. The app puts
  two relays in its orbit.
- **ELFO (elliptical lunar frozen orbit):** a stretched orbit that stays
  stable for a long time. Lunar Pathfinder's is high over the south pole.
- **Gb, GB and Mbps:** gigabits, gigabytes (8 gigabits) and megabits per
  second. The base makes about 600 Gb of data a day and sends at 110 Mbps.

## Landing

- **Slope:** how steep the ground is, in degrees. The lander needs under 10°;
  astronauts on foot need under 20°.
- **Flat share:** the share of a landing zone under 10°. A target needs at
  least 95%.
- **Pixel (20 m, 60 m, 120 m):** the size of one square on a map. Anything
  smaller than a pixel, such as a boulder or a small crater, is invisible.

## Data and accuracy

- **LOLA (Lunar Orbiter Laser Altimeter):** a laser on NASA's Lunar
  Reconnaissance Orbiter that measured the Moon's surface height. Its maps
  give the app its terrain.
- **LRO (Lunar Reconnaissance Orbiter):** the NASA spacecraft, in lunar orbit
  since 2009, that carries LOLA and Diviner.
- **Diviner:** LRO's temperature-mapping instrument. Its maps show which
  shadowed areas are cold enough for ice.
- **PGDA (Planetary Geodesy Data Archive):** the NASA Goddard archive the
  elevation, sunlight and shadow maps come from.
- **NASA's sunlight map:** the long-term average share of time each spot is
  lit (Mazarico et al. 2011). The app uses it to pick reference points and
  shortlist targets, and checks its own sunlight against it.
- **Percentage points (pp):** the plain difference between two percentages.
  70% vs. 72% is 2 points apart.
- **Ephemeris:** a table of where the Sun, Earth and Moon are over time. The
  app uses NASA JPL's DE421.
- **JPL Horizons:** NASA JPL's online service for positions of solar system
  bodies. The app's Sun and Earth positions match it to about 0.00001°.
- **UTC:** Coordinated Universal Time, the time zone every date in the app
  uses.
