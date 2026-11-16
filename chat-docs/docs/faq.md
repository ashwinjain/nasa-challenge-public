# Using the navigator: common questions

Short answers to what people ask first. Each answer is about the app as it
is today: the nine Artemis III candidate regions, one crewed mission, landing
dates from 2026 to 2035.

## What is the Lunar Landing Site Navigator?

A planning tool for one crewed mission to the Moon's south pole, built for
the NASA Space Apps Challenge 2026. It compares NASA's nine Artemis III
candidate regions and answers three questions for each: how much sunlight is
there (power), how long are the nights (battery), and how often can the base
talk to Earth (communications). It then finds safe landing targets in each
region and works out the power kit, the solar array and battery, the mission
would have to land there.

## How do I use the app?

1. **Pick a region** from the Sites list (there are nine). The Moon globe
   flies to it.
2. **Pick a date range** with the calendar at the top. The timeline shows
   when the site is sunlit, when Earth is in view, and when both overlap.
   Use the Sun / Earth / Both buttons to switch what the timeline shows, and
   drag along it to move through time.
3. **Stand on the surface** opens the first-person 3D view on real terrain.
   Walk with WASD or the arrow keys.
4. **Landing & power** on the right shows the panel spot and the power kit
   for the site.
5. **Plan & Compare** opens the planning view, with three tabs:
   - **Pick a date → where?** ranks all nine regions for one landing date and
     stay.
   - **Pick a site → when?** shows one region's score for every landing day
     of a year and marks the best dates.
   - **Where to land?** shows each region's ranked landing targets, the
     landing zone, the panel spot and the kit.
   To compare stays side by side, tick the checkbox next to a site in the
   Plan view's site list. Each ticked stay is added to the Compare tray, up
   to four at a time, with its sunlight and Earth-contact bars and its
   numbers; the best value in each column is marked.
6. **Assumptions** (bottom left) opens the full list of what the model
   assumes, with sources.
7. **Ask the navigator** (the bar at the bottom, or Cmd/Ctrl + K) answers
   questions in plain language using the app's own numbers.

## How do I compare two stays side by side?

Open **Plan & Compare**, choose the landing date and stay, then tick the
checkbox next to each site you want. Every ticked stay goes into the Compare
tray, up to four at a time. Each row shows the stay's sunlight and its
contact with Earth across the stay (direct, through a relay satellite, or
none) and the numbers: sunlit %, longest night, Earth in view, longest comms
blackout, and blackout with relays. The best value in each column is marked.
Untick a site to remove it.

## What do the timeline colors mean?

The timeline under the 3D view has three bands, named in its legend: **Sun**
(the site is sunlit), **Earth** (Earth is in view) and **Both** (sunlit and
Earth in view at the same time). Sun is amber, Earth is cyan (blue-green)
and Both is green. In the Compare tray, contact through a relay satellite is
purple. Use the Sun / Earth / Both buttons to choose
which the timeline shows, and drag along it to move through the date range.

## What is Artemis III, and what are the nine regions?

Artemis III is NASA's planned mission to land astronauts near the Moon's
south pole, part of the Artemis program. In October 2024 NASA named nine
candidate landing regions for it, and the US Geological Survey published
their outlines: Haworth, Malapert Massif, Mons Mouton, Mons Mouton Plateau,
Nobile Rim 1, Nobile Rim 2, Peak Near Cabeus B, Slater Plain and de Gerlache
Rim 2.

The navigator uses those nine regions as its map. The mission it plans is
its own scenario, not NASA's Artemis III plan: a crew of 4 staying up to a
year, landing in 2027 by default (any year 2026 to 2035). The app says nothing
about NASA's actual schedule, rockets, landers or crew.

## Is the navigator better than NASA's site selection?

It isn't a competition, and the app doesn't judge NASA's selection. NASA
chose the nine regions; the navigator works inside them. What it adds is a
different way to rank spots within a region: by the weight of the power kit
(solar array plus battery) a year-round base would need there, instead of by
average sunlight alone. NASA's sunlight map gives the long-term average, not
the longest night, and the longest night sets the battery. Ranking by kit
weight rather than average sunlight saves mass in 8 of the 9 regions: up to
10.1 t at de Gerlache Rim 2, but 0.2 t or less in three of them. In Nobile
Rim 1 the spot NASA's map rates best is also the lightest kit.

## What can I ask the chat?

Anything about the nine regions: which is best for a stay, when to land,
how much sunlight and Earth contact a region gets on given dates, when the
nights and comms blackouts fall, where the landing targets and panel spots
are, how heavy the power kit is (also with a different crew, stay or extra
loads such as a rover), what the model assumes, and how and why it works the
way it does. It can also fly the 3D view to a region. Every number it gives
comes from the app's data; it doesn't estimate.

## Which regions can I choose? Can I pick my own location?

The nine Artemis III candidate regions NASA announced in October 2024:
Haworth, Malapert Massif, Mons Mouton, Mons Mouton Plateau, Nobile Rim 1,
Nobile Rim 2, Peak Near Cabeus B, Slater Plain and de Gerlache Rim 2. The
planning views, the landing targets and the chat cover only these nine.
Other places (Shackleton crater, the Apollo sites, the Connecting Ridge and
so on) are not included.

## What dates, stay lengths and crew sizes can I plan for?

- **Landing dates:** any day from 1 January 2026 to 31 December 2035.
- **Stay:** 1 to 365 days. The default is a full year, a year-round base.
- **Crew:** 4 by default. The power card lets you change it.
- **Ranking landing dates** ("when should we land?") works for stays up to 60
  days. A longer stay covers most of the year whatever day it starts, so the
  landing date matters little.

The landing-target ranking in "Where to land?" is worked out once, for a crew
of 4 staying a year from 1 January 2026.

## What do the numbers mean?

- **Sunlit %:** the average share of the Sun's disk above the local skyline
  over the stay. A half-risen Sun counts as half.
- **Longest night:** the longest unbroken run of hours with less than half of
  the Sun's disk showing. It sets the battery size.
- **Direct contact %:** the share of hours the base can talk straight to
  Earth: Earth is above the skyline seen from the 10 m antenna, and a Deep
  Space Network dish on Earth can see the Moon.
- **Longest comms blackout:** the longest run of hours with no direct
  contact. "With relays" also counts two relay satellites.
- **Kit mass:** the solar array plus the battery the mission has to land, in
  tonnes.

"Night" and "dark" always mean the Sun. "Blackout" always means losing
contact with Earth.

## Why can one region show two different sunlight numbers?

Because they are measured at two places and two heights:

- The timeline, the sky chart, the 3D view and the Plan tables show the Sun
  for **a person standing (2 m)** at the region's reference point, its
  sunniest spot on NASA's map.
- The power card, the landing targets and the chat's power figures show the
  Sun at **the panels, on a 10 m mast**, at the panel spot of the region's
  best safe landing target.

The reference point is often a steep peak where a lander can't set down, so
the landing target is somewhere else, sometimes kilometers away. The two
numbers are both right; they describe different spots. For planning power,
use the 10 m panel figure.

## Why put the panels and the antenna on a 10 m mast?

So they see over the nearby ground. At the south pole the Sun never climbs
more than about 1.5° above a flat horizon, and Earth sits only a few degrees
up, so small rises close by block them: a 2 m bump 40 m away hides about 3°
of sky. Ten meters up, the panels and antenna look over those bumps and
nearby hills, which means more sunlight, shorter nights and more contact
with Earth. A shorter mast would see less Sun and less Earth. NASA's
Vertical Solar Array Technology (VSAT) project is building Sun-tracking
arrays on masts of this kind for the lunar south pole, which is why the app
uses 10 m. Every power number and every Earth-contact number is at 10 m.

## What is in the power kit, and what is left out?

The kit is the **solar array and the battery**. That's the mass the app
reports and ranks by.

Left out: air, water and food (the crew and stay are fixed, so they weigh
the same at every site and don't change the comparison), the habitat, the
lander, the mast, cables and structure.

## Why is the battery by far the biggest item?

Because of the nights. The base draws about 9 kW through the dark, and the
longest night at the nine regions' best targets runs from about 163 hours
(de Gerlache Rim 2) to 365 hours (Nobile Rim 2) over 2027. Carrying that load
through one night takes thousands of kilowatt-hours, and at 150 Wh per kg
that is 18 to 36 tonnes of battery. The solar array is light by comparison:
under 1.2 tonnes at every region. So a site with a shorter longest night
needs a much lighter kit, even if its average sunlight is a little lower.

## How much power does the crew need?

About 10 kW by day and 9 kW at night for a crew of 4, from NASA's First
Lunar Outpost study:

| Load | Power | Runs |
|---|---|---|
| Crew systems | 6.0 kW (1.5 kW per person) | always |
| Avionics and communications | 1.5 kW | always |
| Other habitat systems | 1.2 kW | always |
| Science lab | 1.0 kW | daylight only |
| Radio transmitting to Earth | 0.3 kW | only in direct contact |

Add-ons you can switch on: a small rover (450 W, daylight), a crewed rover
(1.4 kW, always), a drill (100 W, daylight) and work lights (200 W, always).
A 25% margin is added on top when sizing.

## What battery and solar panels does the model assume?

- **Battery:** lithium-ion, 150 Wh per kg at pack level, 80% usable depth of
  discharge, 90% charge-discharge efficiency.
- **Solar cells:** 28% efficient at end of life; 85% of the array area is
  cells; sunlight is 1361 W/m² at Earth's distance, scaled by the real Sun
  distance each hour.
- **Array:** a vertical, Sun-tracking array on a 10 m mast, 0.0133 kg per
  watt (NASA's VSAT targets).
- **Margin:** 25% on power, NASA's concept-stage rule (GSFC-STD-1000).

Power comes from solar panels and batteries only. Nuclear power and fuel
cells are not modelled.

## Does losing contact with Earth cost extra battery?

No. The radio's transmitter runs only while there is direct contact, so
during a blackout it is off, and the power saved covers storing the data on
board. What a blackout costs is storage: the base makes about 600 Gb of data
a day and sends it at 110 Mbps while in contact, and the app sizes on-board
storage for the largest pile that builds up.

## Why isn't Earth always visible? The Moon always faces Earth.

From the middle of the Moon's near side Earth hangs high in the sky. From
the south pole it sits only a few degrees above the horizon, and it moves
up, down and sideways by several degrees over each month as the Moon wobbles
(libration). So a ridge on the Earth side of a site can hide it for days at
a time. On top of that, direct contact needs a Deep Space Network dish
(California, Spain or Australia) to see the Moon at least 10° above its own
horizon.

## What are the relay satellites?

Two satellites in the orbit of ESA's Lunar Pathfinder, half an orbit apart.
When Earth is hidden from the site, the base can reach a relay instead, and
the relay passes the signal to Earth. A relay still needs a Deep Space
Network dish to be listening, so contact with relays is about 98%, with gaps
of two hours at most, rather than 100%.

## Why aren't the nights two weeks long, as on the rest of the Moon?

Away from the poles the Sun rises, crosses the sky and sets, giving about
two weeks of day and two weeks of night. At the south pole the Sun instead
circles the horizon once a month, never more than about 1.5° above it. A
site is dark only while the Sun passes behind a hill or a distant mountain,
so the pattern depends on the terrain around that exact spot: a high ridge
may see only short nights, while lower ground can be dark for two weeks.
Season matters too: the Sun's height changes by about 1.5° over the year,
so nights are longer in polar winter.

## Why is the lunar south pole a good place for a base?

Two reasons show up in the app's data. First, sunlight: because the Sun
skims the horizon all year, high ridges are lit 64 to 84% of the time, far
more than the roughly 50% a flat Moon would give, so solar power can work
with a manageable battery. Second, permanently shadowed areas lie a few
kilometers from every region; they are cold enough that water ice could
survive there. All nine of NASA's Artemis III candidate regions are near
the south pole.

## When is the best time to land?

It depends on the region and the stay. For stays up to 60 days, use
"Pick a site → when?" in Plan & Compare, or ask the chat "when in 2027
should we land at Haworth for 30 days?". The best dates are the ones with
the shortest longest night, because that sets the battery; in polar summer
many regions have landing dates with no night at all for a two-week stay.
For a year-long stay the landing date barely matters, since the stay covers
every season.

## How accurate are the sunlight numbers?

Checked against NASA's own south-pole sunlight maps over 18.6 years at the
nine regions, the app's sunlight is within 2.0 percentage points on average
(7.0 at worst, at Mons Mouton Plateau). Treating the Moon as a smooth ball
would be off by 19.7 points. The limit is the 20 m elevation map: boulders
and craters smaller than a pixel are invisible.

## Is the data real?

Yes. Sun, Earth and Moon positions come from JPL's DE421 ephemeris and match
JPL Horizons to about 0.00001°. The terrain is NASA's LOLA elevation maps
(20, 80 and 240 m pixels). The region outlines are the official USGS
outlines of NASA's nine candidate regions. The power and crew figures come
from NASA documents listed on the Assumptions page.

## What does the navigator not cover?

- Places outside the nine Artemis regions.
- Cost, launch vehicles, landers and payload limits.
- Radiation, temperature, heat and dust.
- Nuclear power and fuel cells.
- The descent path and launch windows.
- Habitat, lander, mast and cable mass, and the crew's air, water and food.
- Anything smaller than the 20 m map pixels (boulders, small craters).
- Dates before 2026 or after 2035.

## Where can I see every assumption and its source?

The **Assumptions** button at the bottom left of the app opens the full
list: what is assumed, what that leaves out, why, and the source.
