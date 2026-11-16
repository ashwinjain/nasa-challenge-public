# Datasets used by the Lunar Landing Site Navigator

Every dataset we use, grouped by phase, with a link and why we need it.
Details, file sizes and checksums are in each phase's `data/phase-N/README.md`.

## Phase 1: Where the Sun and Earth are in the sky

| Dataset | Link | Why we use it |
|---|---|---|
| **DE421 ephemeris** (`de421.bsp`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp) | JPL's record of where the Sun, Earth and Moon are on any date. It tells us where the Sun and Earth appear in the sky from a spot on the Moon. |
| **Moon orientation** (`moon_pa_de421_1900-2050.bpc`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de421_1900-2050.bpc) | How the Moon is tilted and spinning on any date. Without it, "up" and "north" at a site would be wrong. |
| **Moon frame definitions** (`moon_080317.tf`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf) | Defines the Moon's map coordinates, so the maps' lat/lon line up with the ephemeris. Using the wrong frame shifts positions by about 860 m. |
| **Planet constants** (`pck00008.tpc`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/a_old_versions/pck00008.tpc) | Sizes and shapes of the Moon and Earth, which the other files need. |

## Phase 2: Terrain (shadows and the horizon)

| Dataset | Link | Why we use it |
|---|---|---|
| **LOLA elevation, 80 m** (`LDEM_80S_80MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF) | Ground height near each south-pole site. Hills and crater rims block the low polar Sun, so we use it to build each site's skyline. |
| **LOLA elevation, 240 m** (`LDEM_60S_240MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF) | Covers a much wider area, because mountains 100+ km away can still block the Sun. |
| **Average sunlight map, 60 m** (`AVGVISIB_85S_060M_201608.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608.TIF) | NASA's own answer for how often each spot is sunlit. We check our sunlight numbers against it. |
| **Average Earth-visibility map, 60 m** (`AVGVISIB_85S_060M_201608_EARTH.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF) | The same idea for seeing Earth, which is needed for direct contact. We check our Earth-visibility numbers against it. |

## Phase 3: The site list

| Dataset | Link | Why we use it |
|---|---|---|
| **Average sunlight map, 120 m** (`AVGVISIB_75S_120M_201608.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_75S_120M_201608.TIF) | Covers regions too large for the 60 m map. We use it to pick the sunniest point in each region. |
| **Artemis region outlines** (`artemis_regions.geojson`) | [USGS ScienceBase](https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8) | The official outlines of NASA's candidate landing regions. We search inside each outline for its sunniest point. |
| **Past landing sites** | [NSSDC](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_sites.html), LROC releases | Real landing spots (Apollo, Chang'e, Chandrayaan-3, IM-1, IM-2) to compare against and check our results with. |

## Phase 4: Needs vs. supply (`data/phase-4/assumptions.csv`, no maps)

| Source | Why we use it |
|---|---|
| **NASA BVAD Rev2** (Baseline Values and Assumptions Document) | How much oxygen, water and food each crew member uses per day, plus solar-array and battery masses |
| **Csank 2023** (NASA surface habitat) | Crew size, mission length and habitat power for the default crewed base |
| **NASA VSAT and fission-power reports** | Vertical solar array size and nuclear power unit size, for comparing power options |

## Phase 5: Communications

| Dataset | Link | Why we use it |
|---|---|---|
| **DSN station locations and antenna specs** | [DSN 810-005, Module 301](https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301N.pdf), [104](https://deepspace.jpl.nasa.gov/dsndocs/810-005/104/104L.pdf), [101](https://deepspace.jpl.nasa.gov/dsndocs/810-005/101/101G.pdf) | Where NASA's 14 Deep Space Network antennas are, and how sensitive they are. A site can talk to Earth only when an antenna there can see the Moon. |
| **NASA reference lander radio** | [NASA/TP-2019-220391](https://www.lpi.usra.edu/lunar/strategies/NASA-TP-2019-220391.pdf) | Realistic lander radio power and data rates |
| **Lunar Pathfinder service guide** | [SSTL](https://www.sstl.co.uk/getmedia/edaaa697-405c-458d-8394-97f83130d54a/Lunar-Pathfinder-Service-Guide-V2-2.pdf) | ESA's relay satellite: its orbit, data rates and coverage gaps. It's the second way to reach Earth, and we used its numbers to check our relay model. |

## Phase 6: Landing safety

| Dataset | Link | Why we use it |
|---|---|---|
| **LOLA elevation, 20 m** (`LDEM_80S_20MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF) | Detailed enough to measure slope where a lander touches down. Too steep and it tips over, as IM-1 did. |
| **NASA landing requirements** | [HLS Overview 2025](https://ntrs.nasa.gov/citations/20250009323), [Precision landing overview](https://ntrs.nasa.gov/citations/20250003778) | The real limits: under 10° slope, land within 100 m, under 20° slope for moonwalks |

## Phase 7: Resources and the base

| Dataset | Link | Why we use it |
|---|---|---|
| **Permanently shadowed areas map, 20 m** (`LPSR_80S_20MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF) | Where the Sun never shines. Those are the only places ice can survive. |
| **List of shadowed areas over 1 km²** (`LPSR_80S_20MPP_ADJ_1km2.CSV`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ_1km2.CSV) | Gives each area's outline and size, so we can find the nearest one to a site and how far away it is |
| **Diviner temperatures and ice depth** (`dlre_prp_south.tab`) | [PDS](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/) | Shows which shadowed spots are cold enough to keep ice (below about 110 K), and how deep you'd dig to reach it |
| **NOAA solar-cycle forecast** | [NOAA SWPC](https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json) | Where the Sun is in its 11-year cycle, which affects radiation (solar storms vs. cosmic rays) |
| **Ice, radiation and regolith values** | LCROSS (Colaprete 2010), Chang'e 4 radiation measurements (Zhang 2020), Lunar Sourcebook, NASA-STD-3001 | The ice-content range, surface radiation dose, soil density and the astronaut radiation limit. Each source is listed in `data/phase-7/assumptions.csv`. |

## Where they're stored

- **Big files** (all the maps, the ephemeris files and the Diviner table, about 4.1 GB): in the team's Firebase Storage bucket `gs://nasa-challenge-a8b4a.firebasestorage.app`, under `data/phase-N/`. [firebase-data.md](firebase-data.md) explains how to download or read them.
- **Small files** (CSVs, READMEs and scripts): in git on the `data-gathering` branch.
