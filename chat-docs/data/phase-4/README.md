# Phase 4 data: needs vs. supply (power)

Phase 4 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
works out how much power the crew needs and what solar array and battery a
site needs to supply it. There are no maps in this phase. It runs on a table
of assumptions, each with a central value, a low/high range, units and a
source, plus the hourly Sun track from [Phase 1](../phase-1/README.md) and
the terrain skylines from [Phase 2](../phase-2/README.md). The app's
Assumptions page lists every value.

## The mission

One crewed mission: a crew of 4, staying a year by default (the stay and
crew size can be changed), landing in 2027 by default (any year 2026 to 2035).
The answer is the **power kit to land**: the solar array plus the battery.

## The power load

About 10 kW for a crew of 4, itemized from NASA's First Lunar Outpost
habitat study (NASA TM-105925):

| Item | Power | When it runs |
|---|---|---|
| Crew systems | 1.5 kW per person (6.0 kW for 4) | Always |
| Avionics and communications | 1.5 kW | Always |
| Other habitat systems | 1.2 kW | Always |
| Science lab | 1.0 kW | Daylight only |
| Radio transmitting to Earth | 0.3 kW | Only while in direct contact |

So about 8.7 kW through the night and 10 kW by day. Add-ons you can pick:
a small rover (450 W), a crewed rover (1.4 kW), a drill (100 W), work lights
(200 W) or a custom load. The load gets a 25% margin, as NASA's
GSFC-STD-1000 asks for at the concept stage.

## The supply

| Part | Value | Source |
|---|---|---|
| Sunlight at the Moon | 1361 W/m² at 1 AU, scaled by the real Sun distance each hour | Kopp & Lean 2011 |
| Solar cells | 28% efficient at end of life; 85% of the array area is cells | Vendor datasheets |
| Array mass | 0.0133 kg per watt (75 W/kg) | NASA VSAT program targets |
| Battery | 150 Wh/kg at pack level, 80% usable, 90% charge-discharge efficiency | Typical lithium-ion figures |
| Mount | Vertical, Sun-tracking array on a 10 m mast | NASA VSAT design |

The array is vertical and turns to face the Sun. Near the pole the Sun stays
within a few degrees of the horizon, so a vertical panel catches nearly full
sunlight whenever the Sun is up.

## How the kit is sized

The model runs hour by hour through the stay, using the Sun track at the
panel's spot and height:

1. **Output each hour** = array area × sunlight × cell efficiency × packing
   × the share of the Sun's disk above the skyline (a half-risen Sun gives
   half).
2. **Smallest array:** the size that breaks even over the stay, where energy
   in (after charging losses) equals energy used.
3. **Battery:** the deepest the battery is ever drawn down over the stay.
   A year-long stay is run twice, so the end wraps into the start. This
   catches a night that follows too short a recharge: the next night then
   starts with the battery low, so the battery must be bigger.
4. **Lightest total:** an array right at break-even needs a huge battery, so
   seven sizes are tried (1.05×, 1.1×, 1.25×, 1.5×, 2×, 3× and 5× break-even)
   and the lightest array plus battery wins.

The result is the kit mass, its split between array and battery, and the
biggest item. At every region's #1 landing target the battery is by far the
biggest item (about 20–36 t); the solar array is under 1.2 t.

## Data storage during blackouts

The base sends about 600 Gb (gigabits) of data a day and downlinks at
110 Mbps while in direct contact with Earth. During a blackout the data
piles up on board. The app sizes the storage to the largest pile over the
stay. A blackout costs no extra battery: the radio is off while there is no
contact, and the radio's power is already counted for every contact hour.

## Not counted

- **Air, water and food.** Oxygen (0.84 kg per person per day), drinking
  water (2.5 kg) and food with packaging (1.83 kg) are listed for reference.
  With a fixed crew and stay they weigh the same at every site, so they don't
  change the comparison.
- **Habitat, lander, mast and cable mass.**
- **Nuclear power and fuel cells.** Power comes from solar panels and
  batteries only.
- **Dust, heat, panel ageing and one panel shading another.**

## Sources

- NASA TM-105925 (1993), First Lunar Outpost power: the load list.
- NASA VSAT report (NTRS 20240003162) and VSAT program targets (LSIC, May
  2021): array design and mass per watt.
- Kopp & Lean 2011: the solar constant.
- NASA GSFC-STD-1000: the 25% power margin.
- NASA BVAD Rev2 and NASA-STD-3001: oxygen, food and drinking water per
  person (reference only).
