# Phase 6 data: landing safety, landing targets and panel spots

Phase 6 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
treats each region as an area rather than one point. It finds safe landing
targets across the whole region, a panel spot for each, and the power kit
and Earth contact each one gets. It uses one new dataset, NASA's 20 m
elevation map, plus the sunlight map used in [Phase 3](../phase-3/README.md)
and the power model from [Phase 4](../phase-4/README.md).

## The data

| Dataset | What it gives |
|---|---|
| **LOLA elevation map, 20 m pixels** (south pole, 80°S–90°S) | Height of the ground every 20 m. Slope comes from it. Source: Barker et al. 2023, NASA PGDA product 90. |
| **NASA average-sunlight map** (60 m, or 120 m for large regions) | Long-term share of time each spot is sunlit. Used to shortlist targets. Source: Mazarico et al. 2011, NASA PGDA product 69. |
| **Artemis III region outlines** | Where to search. Source: USGS. |

## The rules

| Zone | Distance from the target | Rule | Why |
|---|---|---|---|
| Landing zone | 0–100 m | At least 95% of the area under 10° | 10° is NASA's touchdown limit; the lander can come down anywhere within 100 m (NASA's precision-landing goal). The 95% share is our choice. |
| Panel area | 0–200 m | Panel spot under 20° | 20° is NASA's limit for astronauts on foot. |
| Walking path | Target to panel spot, in a straight line | Every pixel under 20° | The crew carries the panels out on foot. |

A panel spot within 200 m of the target is at most 300 m from wherever the
lander actually touches down, the app's on-foot reach. Gaps in the elevation
map count as not flat.

## How it works

1. **Slope map.** Slope is worked out from the 20 m elevation map, over
   40 m (one pixel either side), only around each region.
2. **Every possible target.** A 100 m landing zone is slid across each
   region and checked against the 10° / 95% rule. About 1.1 million
   positions were tried across the nine regions, and about 270,000 passed.
3. **Shortlist.** Passing targets are ranked by NASA's sunlight map, and the
   top 10 per region are kept, at least 500 m apart (so they aren't ten
   copies of the same patch). Checking every passing target in full would
   take hundreds of computer hours.
4. **Panel search.** For each target, every 20 m spot within 200 m (about
   300 spots) gets its own skyline at 10 m and its own Sun track over 2027.
   Spots 20° or steeper, or with a steep pixel on the path, are skipped.
5. **Three picks per target:** the spot with the most sunlight, the one with
   the shortest night, and the one with the lightest power kit. The lightest
   kit becomes the target's panel spot.
6. **Ranking.** The ten targets are ranked by kit weight (array plus
   battery), sized for the crewed mission's year-round base over 2027. The
   #1 target is the one the site card shows.
7. **Earth contact across the zone.** About 21 points across the landing
   zone, 40 m apart, each get a skyline at the 10 m antenna and are checked
   for direct contact and with relays (see
   [Phase 5](../phase-5/README.md)). The app reports the range from worst to
   best.

## Checking the slope method

Two real landers that tipped over:

- **IM-1 (Odysseus), February 2024:** tipped on a slope of about 12°. We
  measure 13.2° at its spot, so the slope method works.
- **IM-2 (Athena), March 2025:** tipped in a crater smaller than one 20 m
  pixel. Its spot looks flat on the map (3°). This is the known limit of
  20 m data: small craters and boulders are invisible.

## Results (year-round crewed base, 2027, panels at 10 m)

- Ranking by kit weight rather than NASA's average sunlight saves mass in 8
  of 9 regions: 10.1 t at de Gerlache Rim 2, 8.1 t at Mons Mouton Plateau,
  2.4 t at Mons Mouton, 1.4 t at Malapert Massif, 0.6 t at Nobile Rim 2, and
  0.2 t or less at Slater Plain, Peak Near Cabeus B and Haworth. In Nobile
  Rim 1 the target NASA's map rates best is also the lightest kit.
- The 20° panel and path rules hardly bit: of 28,530 panel spots checked
  across all 90 targets, 6 were too steep and 3 more had a blocked path.
- Panel spots at the #1 targets are 60–200 m from the target.
- How much of each region passes the landing rule varies a lot: 43% of the
  zones tried at Slater Plain, but 7% at Malapert Massif and 3% at Peak Near
  Cabeus B.

Each region's own page (docs/regions/) gives its #1 target in full.

## In the app

Plan & compare → **Where to land?** shows the region map, the ranked
targets, each landing zone and panel spot, and the kit and contact numbers.
**Stand here in 3D** puts you at a target, with the landing-zone ring, the
panel pole and the walking path.

## Limits

- **20 m pixels.** Boulders and small craters are invisible, so a zone can
  be rougher than the map says (IM-2).
- **Shortlist.** Targets are pre-ranked by NASA's average sunlight, so a
  target with a lower average but a shorter night could be missed.
- **One case.** The ranking is for the year-round base over 2027; it
  doesn't change with the dates you pick.
- **In 3D,** the timeline and sky chart are the region's reference point,
  not the target.
