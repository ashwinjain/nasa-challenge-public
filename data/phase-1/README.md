# Phase 1 data: the sky at a site

These four files let us work out where the Sun and Earth appear in the sky
from any spot on the Moon, at any time between 1900 and 2050. That is all
Phase 1 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
needs: when a site gets sunlight (power) and when it can see Earth
(communications).

All four come from NASA/JPL's NAIF server and are free to use. NAIF has
moved two of them into "old versions" folders because newer releases exist,
but we keep this set together on purpose: the Moon orientation file is
built to match DE421.

## The files

| File | Size | In plain terms | What it actually is |
|---|---|---|---|
| `de421.bsp` | 16.8 MB | **Where everything is.** Give it a date and it tells you where the Sun, Earth and Moon are. | JPL planetary ephemeris DE421: positions of the Sun, Moon and planets in the inertial ICRF frame. |
| `moon_pa_de421_1900-2050.bpc` | 1.8 MB | **Which way the Moon is facing.** The Moon slowly turns and wobbles; this records exactly how it is turned at every moment. | Binary PCK: orientation of the Moon's principal-axis (PA) frame over time, including physical libration, from the same model as DE421. |
| `moon_080317.tf` | 21 KB | **The address system.** Moon lat/long comes in two versions about a kilometer apart; this defines both. We use "mean Earth" (ME), the one NASA's maps use. | Frame kernel defining `MOON_PA` and `MOON_ME` and the fixed rotation between them. |
| `pck00008.tpc` | 112 KB | **Basic facts.** Mainly the Moon's size, so we stand on the surface, not at the center. | IAU planetary constants: body radii (Moon: 1737.4 km) and approximate rotation models. |

## How they fit together

```
site lat/long (ME)  ──tf──▶  PA frame  ──bpc @ time──▶  where the site is in space
                                                            │
                                    + Moon center from de421┘
                                                            │
                          look at the Sun / Earth from the site (de421)
                                                            │
                                    azimuth / elevation in the site's sky
```

Do that every hour for a month and you get Phase 1's metrics: sunlit %,
longest dark stretch, Earth-in-view %, longest blackout, and time to the
next sunset and Earthset.

## Loading them in skyfield

```python
from skyfield.api import Loader, PlanetaryConstants

load = Loader('data/phase-1')
ts  = load.timescale()
eph = load('de421.bsp')

pc = PlanetaryConstants()
pc.read_text(load('moon_080317.tf'))
pc.read_text(load('pck00008.tpc'))
pc.read_binary(load('moon_pa_de421_1900-2050.bpc'))

frame = pc.build_frame_named('MOON_ME_DE421')
site  = eph['moon'] + pc.build_latlon_degrees(frame, -89.5, 0.0)  # lat, lon

t = ts.utc(2027, 1, 1, range(24 * 30))          # hourly for 30 days
alt, az, _ = site.at(t).observe(eph['sun']).apparent().altaz()
```

## What this data does not cover

- **Terrain.** The Moon is treated as a smooth ball, so mountains and crater
  walls don't block anything. At the south pole that matters a lot; Phase 2
  adds LOLA elevation data to fix it.
- **Refraction.** None needed: the Moon has no atmosphere.
- **Disk size.** The Sun is ~0.53° across and Earth ~1.9° from the Moon. We
  have to choose whether "sunlit" means the center, any part, or all of the
  disk is above the horizon, and use the same rule when checking against
  JPL Horizons.

## Sources

Downloaded from `https://naif.jpl.nasa.gov/pub/naif/generic_kernels/`:

| File | Path | SHA-256 |
|---|---|---|
| `de421.bsp` | `spk/planets/a_old_versions/de421.bsp` | `08b20db2ae22488650641c5a9033e5bfda4b1c4b440cfeaf20f621cfa18ecdb3` |
| `moon_pa_de421_1900-2050.bpc` | `pck/moon_pa_de421_1900-2050.bpc` | `656f90616403d75a75f0cd6c8830fc5b44f8cb4facb5ccb8915e752b397520cf` |
| `moon_080317.tf` | `fk/satellites/moon_080317.tf` | `78732477b96f9863e7b0d65bcee3c22b8707ca5ed0db56d1173319cb2e8c7993` |
| `pck00008.tpc` | `pck/a_old_versions/pck00008.tpc` | `ca07df56e9f1bca85a4c6748b618a46c0bf8e081f96f81e324896f2fdc54ea27` |

To re-download:

```bash
cd data/phase-1 && B=https://naif.jpl.nasa.gov/pub/naif/generic_kernels && curl -O $B/spk/planets/a_old_versions/de421.bsp -O $B/pck/moon_pa_de421_1900-2050.bpc -O $B/fk/satellites/moon_080317.tf -O $B/pck/a_old_versions/pck00008.tpc
```
