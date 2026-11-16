# Datasets used by the Lunar Landing Site Navigator

Every dataset we use, grouped by phase, with a link and why we need it.
More detail is in each phase's `data/phase-N/README.md`.

## Phase 1: Where the Sun and Earth are in the sky

| Dataset | Link | Why we use it |
|---|---|---|
| **DE421 ephemeris** (`de421.bsp`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/a_old_versions/de421.bsp) | JPL's record of where the Sun, Earth and Moon are on any date. It tells us where the Sun and Earth appear in the sky from a spot on the Moon. |
| **Moon orientation** (the DE421 lunar orientation kernel, `moon_pa_de421`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/) | How the Moon is tilted and spinning on any date. Without it, "up" and "north" at a site would be wrong. |
| **Moon frame definitions** (`moon_080317.tf`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf) | Defines the Moon's map coordinates, so the maps' lat/lon line up with the ephemeris. Using the wrong frame shifts positions by about 860 m. |
| **Planet constants** (`pck00008.tpc`) | [NAIF](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/a_old_versions/pck00008.tpc) | Sizes and shapes of the Moon and Earth, which the other files need. |

## Phase 2: Terrain (shadows and the horizon)

| Dataset | Link | Why we use it |
|---|---|---|
| **LOLA elevation, 20 m** (`LDEM_80S_20MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF) | The finest ground heights, used for the terrain within 10 km of a spot. |
| **LOLA elevation, 80 m** (`LDEM_80S_80MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF) | Ground height around each south-pole site. Hills and crater rims block the low polar Sun, so we use it to build each site's skyline. |
| **LOLA elevation, 240 m** (`LDEM_60S_240MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF) | Covers a much wider area, because mountains 100+ km away can still block the Sun. |
| **Average sunlight map, 60 m** (`AVGVISIB_85S_060M_201608.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608.TIF) | NASA's own answer for how often each spot is sunlit. We check our sunlight numbers against it. |
| **Average Earth-visibility map, 60 m** (`AVGVISIB_85S_060M_201608_EARTH.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF) | The same idea for seeing Earth, which is needed for direct contact. We check our Earth-visibility numbers against it. |
| **LROC WAC South Pole Summer Mosaic** | [LROC](https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/BROWSE/WAC_ROI/WAC_ROI_SOUTH_SUMMER/) | Real imagery of the ground, draped on the 3D surface view. |

## Phase 3: The site list

| Dataset | Link | Why we use it |
|---|---|---|
| **Average sunlight map, 120 m** (`AVGVISIB_75S_120M_201608.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_75S_120M_201608.TIF) | Covers regions too large for the 60 m map. We use it to pick the sunniest point in each region. |
| **Artemis region outlines** (`artemis_regions.geojson`) | [USGS ScienceBase](https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8) | The official outlines of NASA's nine Artemis III candidate regions. We search inside each outline for its sunniest point and its landing targets. |

## Phase 4: Needs vs. supply (no maps; the values are on the Assumptions page)

| Source | Why we use it |
|---|---|
| **NASA BVAD Rev2** (Baseline Values and Assumptions Document) | How much oxygen and food each crew member uses per day: 0.84 kg of oxygen per person per day, so 3.36 kg a day for a crew of 4 |
| **NASA-STD-3001** | Drinking water per person per day |
| **NASA TM-105925** (First Lunar Outpost power) | The itemized power load for a crew of 4: about 10 kW in all (crew systems, avionics and comms, the radio to Earth, other habitat systems and the science lab) |
| **NASA VSAT** (Vertical Solar Array Technology) | Solar array mass per watt for a mast-mounted, Sun-tracking array |
| **Csank 2023** (NASA surface habitat) | Crew size |
| **NASA GSFC-STD-1000** | The 25% power margin at concept stage |

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
| **NASA landing requirements** | [HLS Overview 2025](https://ntrs.nasa.gov/citations/20250009323), [Precision landing overview](https://ntrs.nasa.gov/citations/20250003778) | The real limits: under 10° slope to land, landing within 100 m of the target, under 20° slope for moonwalks |
| **IM-1 and IM-2 landing spots** | NASA and Intuitive Machines releases | Two real landers that tipped over. We measured the slope at their spots to check our slope method (see the [navigator plan](space-apps/navigator-plan.md), Phase 6). |

## Water ice (information only)

Nothing here changes a calculation or a ranking.

| Dataset | Link | Why we use it |
|---|---|---|
| **Permanently shadowed areas map, 20 m** (`LPSR_80S_20MPP_ADJ.TIF`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ.TIF) | Where the Sun never shines. Those are the only places ice can survive. |
| **List of shadowed areas over 1 km²** (`LPSR_80S_20MPP_ADJ_1km2.CSV`) | [PGDA](https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LPSR_80S_20MPP_ADJ_1km2.CSV) | Gives each area's outline and size, so we can find the nearest one to a site and how far away it is |
| **Diviner temperatures and ice depth** (`dlre_prp_south.tab`) | [PDS](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/) | Shows which shadowed spots are cold enough to keep ice (below about 110 K), and how deep you'd dig to reach it |
