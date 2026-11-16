# Phase 2 data: real terrain

Phase 1 treats the Moon as a smooth ball. At the south pole that isn't good
enough: the Sun and Earth sit low in the sky, so a ridge or a distant
mountain can block them. Phase 2 of the
[navigator plan](../../docs/space-apps/navigator-plan.md) fixes this by
computing each site's **skyline** (how high the terrain rises in every
direction) from real elevation maps. A site is then sunlit when the Sun is
above its skyline, and in contact when Earth is.

All files come from NASA Goddard's [PGDA](https://pgda.gsfc.nasa.gov/) site,
and they use the same Moon coordinate system (MOON_ME, DE421) as the
[Phase 1 data](../phase-1/README.md). They're GeoTIFFs in south polar
stereographic projection, with X/Y in meters and the Moon as a 1737.4 km
sphere.

## Elevation maps

From [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90), the newest
LOLA south-pole maps (Barker et al. 2023). Each pixel is one height value,
in meters, for a square of ground. Each skyline uses the finest map first:

| Map | Covers | Pixel size | Used for |
|---|---|---|---|
| `LDEM_80S_20MPP_ADJ.TIF` | 80°S to the pole | 20 m | **Close terrain**, within 10 km of the spot, and the slope of landing zones and walking paths |
| `LDEM_80S_80MPP_ADJ.TIF` | 80°S to the pole | 80 m | **Nearby terrain** beyond that. Covers all nine Artemis regions |
| `LDEM_60S_240MPP_ADJ.TIF` | 60°S to the pole | 240 m | **Distant mountains**, out to 300 km. Mountains 100+ km away can still block the low polar Sun |

### Why distant mountains matter

The Sun never gets more than ~1.5° above a flat horizon at the south pole.
A mountain 5 km taller than the site and 100 km away rises ~2.9° from
height and distance alone; the Moon's curvature lowers that by ~1.65°,
leaving ~1.2°. That's enough to block the Sun for part of the month.

## Skyline heights

Every skyline is worked out at four heights above the ground: 0, 2, 10 and
20 m. The app uses two of them:

- **10 m: solar panels and the comms antenna,** which sit on a 10 m mast.
  Every power number, every sunlight number on the power card and in the
  landing-target ranking, and every Earth-contact number is at 10 m.
- **2 m: a person standing,** the eye height of the 3D view and of the
  sunlight shown in the timeline, tiles and sky chart. It's also the height
  we check against NASA's sunlight maps.

## Reference maps (for checking our results)

From [PGDA product 69](https://pgda.gsfc.nasa.gov/products/69)
(Mazarico et al. 2011). JPL Horizons can check Phase 1, but it treats the
Moon as smooth, so it can't check terrain. These maps are NASA's own
terrain-based answers.

| File | Covers | Pixel size | What it is |
|---|---|---|---|
| `AVGVISIB_85S_060M_201608.TIF` | 85°S to the pole | 60 m | Average fraction of time each spot is sunlit |
| `AVGVISIB_85S_060M_201608_EARTH.TIF` | 85°S to the pole | 60 m | Average fraction of time each spot can see Earth (any part of its disk) |

To compare fairly:
- **NASA doesn't state its observer height.** Neither PGDA product 69 nor
  its README gives one, or says which elevation model or horizon method the
  maps used. We compare from 2 m: at 0 m, small bumps in the 20 m map a few
  tens of meters away block the Sun, so 0 m runs much darker than NASA.
- They're **averaged over 18.6 years** (the Moon's long orbital cycle), with
  hourly steps, so we run our model over the same span.

A second, shorter reference is in Barker et al. 2021
([doi:10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119)):
illumination at 1 m and 5 m above the surface at a few south-pole sites.

## What this data does not cover

- **Anything smaller than a pixel.** Even at 20 m, small ridges, crater rims
  and boulders blur out. LOLA measured along separate tracks and the gaps
  between them are interpolated, so real detail is coarser than the pixel
  size, especially farther from the pole.
- **North pole and the rest of the Moon.** Outside 60°S the Moon is treated
  as smooth.

## Surface imagery

The 3D surface view drapes real imagery on the terrain: the **NASA LRO LROC
WAC South Pole Summer Mosaic** (643 nm, 100 m/pixel, the same polar
stereographic projection as the elevation maps). The mosaic's own shadows
aren't used; the app lights the ground from the live Sun position.

## Sources

Cite Barker et al. 2023 ([doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1))
for the elevation maps, Mazarico et al. 2011
([doi:10.1016/j.icarus.2010.10.030](https://doi.org/10.1016/j.icarus.2010.10.030))
for the reference maps, and the LROC team / Robinson et al. 2010 for the WAC
mosaic.
