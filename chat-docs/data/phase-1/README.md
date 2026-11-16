# Phase 1 data: the sky at a site

These four files let us work out where the Sun and Earth appear in the sky
from any spot on the Moon, at any time in the app's planning years (2026 to
2035). That is all Phase 1 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
needs: when a site gets sunlight (power) and when it can see Earth
(communications).

All four come from NASA/JPL's NAIF server and are free to use. NAIF has
moved two of them into "old versions" folders because newer releases exist,
but we keep this set together on purpose: the Moon orientation file is
built to match DE421.

## The files

| File | In plain terms | What it actually is |
|---|---|---|
| `de421.bsp` | **Where everything is.** Give it a date and it tells you where the Sun, Earth and Moon are. | JPL planetary ephemeris DE421: positions of the Sun, Moon and planets in the inertial ICRF frame. |
| `moon_pa_de421` (lunar orientation kernel) | **Which way the Moon is facing.** The Moon slowly turns and wobbles; this records exactly how it is turned at every moment. | Binary PCK: orientation of the Moon's principal-axis (PA) frame over time, including physical libration, from the same model as DE421. |
| `moon_080317.tf` | **The address system.** Moon lat/long comes in two versions about a kilometer apart; this defines both. We use "mean Earth" (ME), the one NASA's maps use. | Frame kernel defining `MOON_PA` and `MOON_ME` and the fixed rotation between them. |
| `pck00008.tpc` | **Basic facts.** Mainly the Moon's size, so we stand on the surface, not at the center. | IAU planetary constants: body radii (Moon: 1737.4 km) and approximate rotation models. |

## How they fit together

```
site lat/long (ME)  ──tf──▶  PA frame  ──orientation @ time──▶  where the site is in space
                                                            │
                                    + Moon center from de421┘
                                                            │
                          look at the Sun / Earth from the site (de421)
                                                            │
                                    azimuth / elevation in the site's sky
```

Do that every hour and you get Phase 1's metrics: sunlit %, longest night,
Earth-in-view %, longest blackout, and time to the next sunset and Earthset.
Our Sun and Earth positions match JPL Horizons to about 0.00001°.

## What this data does not cover

- **Terrain.** On its own, this treats the Moon as a smooth ball, so
  mountains and crater walls don't block anything. At the south pole that
  matters a lot; Phase 2 adds LOLA elevation data to fix it.
- **Refraction.** None needed: the Moon has no atmosphere.
- **Disk size.** The Sun is ~0.53° across and Earth ~1.9° from the Moon. The
  app counts sunlight as the share of the Sun's disk above the skyline, and
  Earth as in view when any part of its disk is above the skyline.

## Sources

NASA/JPL NAIF generic kernels, `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/`:
`spk/planets/a_old_versions/de421.bsp`, the DE421 lunar orientation kernel in `pck/`,
`fk/satellites/moon_080317.tf`, `pck/a_old_versions/pck00008.tpc`.
