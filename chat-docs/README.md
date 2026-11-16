# Lunar Landing Site Navigator

Sun and Earth visibility at the lunar south pole, built for the NASA Space
Apps Challenge 2026.

The app compares NASA's nine Artemis III candidate regions for one crewed
mission: a crew of 4 landing in 2027, staying a year by default. Pick a
region and a date range, and see:
- **3D scene**: a Moon globe that flies to the region, and a first-person
  surface view on real terrain (eye height 2 m)
- **Timeline**: when the site is sunlit, when Earth is in view, and when both overlap
- **Metrics**: sunlit %, longest night, Earth-in-view %, longest comms
  blackout, time to the next sunset and Earthset
- **Plan & compare**: rank the nine regions for one landing date, find a
  region's best landing dates in any year from 2026 to 2035, and compare up
  to four stays side by side
- **Where to land?**: each region's safe landing targets, where the solar
  panels go, and the power kit the mission has to land

Near the south pole the app uses real terrain: each site gets a skyline
from NASA's LOLA elevation maps, and the Sun or Earth is up only when it
clears that skyline. Over the 9 Artemis regions, our sunlight is within
2.0 percentage points of NASA's own maps on average, against
19.7 points for a smooth Moon ([comparison](docs/nasa-comparison.md)).

## Heights

- **Solar panels and the comms antenna sit on a 10 m mast.** Every power
  number, the sunlight on the power card and in the landing-target ranking,
  and every Earth-contact number is at 10 m.
- **A person standing is 2 m.** The 3D view, the timeline, tiles and sky
  chart show the Sun at 2 m. We also check our sunlight against NASA's maps
  at 2 m.

## Reach

Panels and comms gear go at most **300 m** from the lander, carried on foot.
Since the lander can touch down anywhere within 100 m of its target, panel
spots are searched within 200 m of the target.

## What's built

### Phase 1: the sky at a site
- Sun and Earth positions match JPL Horizons to 0.00001°.
- The nine Artemis regions, each with a representative point.
- Timeline and metrics driven by the same ephemeris.

### Phase 2: real terrain
- Skylines at 0, 2, 10 and 20 m, from 20 m LOLA detail within 10 km of the
  site, then 80 m and 240 m maps out to 300 km.
- Terrain sunlight checked against NASA's maps (Mazarico et al. 2011) over
  18.6 years at 2 m: average gap 2.0 points, worst 7.0
  (Mons Mouton Plateau), against 19.7 points for a smooth Moon.
- First-person surface view on real terrain, with the Sun and Earth at their
  true elevations.

### Phase 3: compare sites and dates
- "Pick a date → where?": all 9 regions ranked for one stay (1–60 days), by
  sunlit %, longest night, Earth in view % or longest blackout.
- "Pick a site → when?": a region's score for every landing day of a year,
  with its best dates marked, for any year 2026–2035.
- Compare: up to 4 stays (any region, any dates) side by side.

### Phase 4: needs vs. supply
- One crewed mission: crew of 4, stay editable, default one year.
- The power load is an itemized list, about 10 kW for 4 crew (NASA's First
  Lunar Outpost habitat), plus add-ons you can pick.
- The kit is the power kit the mission lands: the solar array and the
  battery. Air, water and food are not counted: with a fixed crew and stay
  they weigh the same at every site.

### Phase 5: real communications
- Direct contact needs Earth above the 10 m antenna's skyline **and** a Deep
  Space Network complex (Goldstone, Madrid, Canberra) seeing the Moon at
  least 10° up.
- Two relay satellites in ESA's Lunar Pathfinder orbit, shown as "with
  relays".

### Phase 6: landing safety and the landing ellipse
- Slope from the 20 m LOLA map, checked against two real landers that
  tipped over: IM-1 measures 13.2° at its spot, against ~12° reported. IM-2
  tipped in a crater smaller than a pixel, so its spot looks flat (3°): the
  known 20 m limit.
- Landing targets for all 9 regions: at least 95% of a 100 m landing zone
  under 10°, shortlisted by NASA's sunlight map, 10 per region at least
  500 m apart.
- A panel spot for every target: every 20 m spot within 200 m (so at most
  300 m from any touchdown point), under 20°, with a straight walking path
  under 20°. Three picks per target (most sunlight, shortest night, lightest
  kit); the lightest kit wins.
- Targets ranked by kit weight, sized for the year-round crewed base over
  2027 with panels at 10 m. Ranking by kit weight rather than average sunlight saves mass in 8 of 9 regions, up to 10.1 t (de Gerlache Rim 2), but 0.2 t or less in three of them. In Nobile Rim 1, the target NASA's sunlight map rates best is also the lightest kit.
- Earth contact from ~21 touchdown points across each landing zone, direct
  and with relays, reported as worst-to-best.

Limits:
- **20 m pixels.** Small craters and boulders are invisible (IM-2), so a
  landing zone can be rougher than the map says.
- **One mission, one year.** Kit weights are for the crewed mission's
  year-round base over 2027.
- **Shortlist.** Targets are pre-ranked by NASA's average sunlight before the
  full calculation, so a target with a shorter night but lower average could
  be missed.
- Details and results: [navigator-plan.md, Phase 6](docs/space-apps/navigator-plan.md).
