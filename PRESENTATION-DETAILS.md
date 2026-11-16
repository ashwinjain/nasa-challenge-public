# Visualization Details — Lunar Landing Site Navigator

Technical notes on how the 3D scene represents the Sun–Earth–Moon system.
Keep this handy in case judges or reviewers ask about accuracy.

## Scale: everything is true size

The 3D scene uses one true scale (1 unit = 1,000 km): the Moon (1,737 km),
Earth (6,371 km) and the Sun (696,000 km) are their real sizes, at their real
distances (Earth 384,400 km away, the Sun 1 AU). From the Moon, Earth spans
~1.9° and the Sun ~0.53°, exactly as an astronaut would see them, so up close
they read as small discs. Nothing is enlarged or moved closer for effect.

## What IS accurate

| Property | Source | Accuracy |
|---|---|---|
| Sun azimuth/elevation from each site | JPL DE421 ephemeris via SPICE kernels | Verified to 0.00001° against JPL Horizons |
| Earth azimuth/elevation from each site | JPL DE421 ephemeris via SPICE kernels | Verified to 0.00001° against JPL Horizons |
| Moon rotation/orientation | IAU 2009 model (moon_pa_de421_1900-2050.bpc) | Standard lunar reference frame |
| Site coordinates (lat/lon) | USGS region outlines + NASA sunlight maps | Region-best point for each Artemis III region |
| Average sunlight percentage | Mazarico et al. 2011 (18.6-year average) | 60m and 120m resolution NASA sunlight maps |
| Sunlit/dark periods per site | Computed from Sun elevation + terrain skyline | Hourly; sunlight counts the share of the Sun's disk above the skyline, and "night" is under half the disk |
| Earth visibility periods per site | Computed from Earth elevation + terrain skyline | Hourly; Earth is in view when any part of its disk clears the skyline |
| Date range | 1900–2049 | Span of the Moon-orientation kernel; planning views cover 2026–2035 |

## Data pipeline

The positions shown in the 3D scene come from a real ephemeris computation, not made-up values:

1. **SPICE kernels** (JPL DE421) contain Sun/Earth/Moon positions from 1900–2050
2. **lunarsky engine** (Python + skyfield) computes where the Sun and Earth appear in the sky from any point on the Moon's surface at any time
3. **Precomputed JSON** files store the results for the 9 Artemis III regions (hourly, 2026–2035)
4. **Frontend** reads the JSON and positions the 3D bodies at the correct azimuth/elevation angles from the Moon

The angular positions, sizes and distances are all real.

## Phase 1 limitations

- ~~Smooth Moon~~ — fixed in Phase 2 for the south pole (see below).
- **One point per site** — sunlight can change dramatically over a few hundred meters near the poles.

## Phase 2: real terrain

Each polar site gets a **skyline**: how high the terrain rises in every compass direction, from NASA's LOLA elevation maps. The Sun or Earth is up only when it clears the skyline at its own direction. Checked against NASA's sunlight maps at the nine Artemis regions, we're off by **2.0 points** on average (worst 7.0), where a smooth Moon was off by 19.7 ([full table](docs/nasa-comparison.md)).

Limits:
- **20 m detail only within 10 km of a site.** Beyond that the skyline uses 80 m and then 240 m maps, so small features far away blur out.
- **No boulders.** Nothing smaller than a map pixel is in the skyline.
- **Smooth Moon north of ~60°S.** The elevation maps only cover the south polar region, so a custom point farther north uses a flat horizon.
- **Fixed heights.** Skylines are computed at 0, 2, 10 and 20 m. A person standing is 2 m; solar panels and the comms antenna sit on a 10 m mast.
- **No refraction** — correct, because the Moon has no atmosphere.

## Phase 3: compare sites and dates

The challenge's central ask is comparing scenarios quickly. "Plan & compare" (a button in the top bar) answers it two ways:

- **Pick a date → where?** Choose a landing date and stay length; the nine regions are ranked by sunlit %, longest night, Earth in view % or longest blackout.
- **Pick a site → when?** Choose a site and a year (2026–2035); a chart scores every possible landing day and marks the best ones.

Any stay from either view can be pinned to **Compare**, up to four side by side. Picking a site in Plan also selects it in the 3D view, and the whole setup is a link you can share.

All of it runs from hourly data precomputed from the terrain skylines (under 1 MB), so it's instant and needs no server.

Limits:
- **One point per region** at a 2 m eye height; the Where to land? view goes down to individual landing targets.
- **Geometry only.** How much Sun and Earth a stay gets, not whether it's enough; the Power & landing panel (Phase 4) starts on that.
