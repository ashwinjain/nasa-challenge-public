# Phase 5 data: communications

Phase 5 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
works out when the base can talk to Earth, both directly and through relay
satellites. It reuses the hourly Sun and Earth positions from
[Phase 1](../phase-1/README.md) and the terrain skylines from
[Phase 2](../phase-2/README.md), seen from the 10 m antenna mast.

## Direct contact

A site has direct contact with Earth in an hour only when **both** are true:

1. **Earth is above the site's skyline**, seen from the antenna on its 10 m
   mast. Near the south pole Earth stays within a few degrees of the horizon and
   wobbles up and down over the month (libration), so crater rims and
   mountains hide it for days at a time.
2. **A Deep Space Network complex sees the Moon at least 10° above its own
   horizon.** NASA's Deep Space Network has three complexes, spaced about
   120° apart in longitude:

   | Complex | Latitude |
   |---|---|
   | Goldstone, California | 35.4° N |
   | Madrid, Spain | 40.4° N |
   | Canberra, Australia | 35.4° S |

   Most of the time at least one sees the Moon. Short gaps come on a
   roughly 27-day cycle, when the Moon is far south or far north in Earth's
   sky. 10° is a common DSN planning limit: lower down, a dish looks through
   a lot of atmosphere and nearby ground.

The DSN check is done once and shared by every site. All nine regions are
within about 200 km of the pole, which moves the Moon in a dish's sky by
under 0.05°.

## Relay satellites

The app also shows contact "with relays": two relay satellites in the orbit
of ESA's Lunar Pathfinder, half an orbit apart.

| Orbit value | Number |
|---|---|
| Type | Elliptical frozen orbit |
| Lowest point | About 673 km up, over the north pole |
| Highest point | About 7,331 km up, over the south pole |
| Tilt to the Moon's equator | 54.9° |
| One orbit | About 10.8 hours |

Because the satellite is high and slow over the south pole, it spends most
of each orbit above the polar sites. One relay already turns blackouts of
many days into gaps of a few hours; the second, half an orbit behind, fills
most of those. A site can use a relay when the relay is above the site's
skyline and the relay can see Earth. The relay still talks to Earth through
a DSN dish, so the DSN's own short gaps remain. An hour counts as covered if
a relay is usable for at least half of it.

The orbit is ESA's (from the SSTL Lunar Pathfinder Service Guide, which
calls its values indicative). The second relay and where both start in the
orbit are our choice.

## Results (year-round crewed base, 2026)

Direct contact at each region's #1 landing target, from about 21 points
across its 100 m landing zone:

| Region | Direct contact across the zone | Longest direct blackout at the target |
|---|---|---|
| Mons Mouton Plateau | 75–98% | 7.3 days |
| Peak Near Cabeus B | 97% | 1.5 days |
| Nobile Rim 2 | 78% | 6.4 days |
| Haworth | 75–78% | 7.2 days |
| Mons Mouton | 63–76% | 10.2 days |
| Nobile Rim 1 | 63–66% | 10.2 days |
| Malapert Massif | 58–66% | 11.8 days |
| de Gerlache Rim 2 | 59% | 11.5 days |
| Slater Plain | 47% | 14.7 days |

With the two relays, contact is about 98% from every point in every zone,
and the longest gap is about 2 hours.

## Power and data

The radio's 300 W transmitter runs only during direct contact. A blackout
costs no extra battery, but data piles up on board: about 600 Gb a day,
sent at 110 Mbps once contact returns. The app sizes the storage to the
largest pile (see [Phase 4](../phase-4/README.md)).

## Limits

- **Best case.** No dish scheduling (other missions share the DSN), weather,
  antenna pointing limits or link budget, so real contact can only be rarer.
- **Relay orbit is simplified.** The ellipse is held fixed; the real orbit
  drifts slowly, so exact pass times are approximate. Pass and gap lengths
  hardly depend on that.
- **Hourly steps.** Relay gaps shorter than 30 minutes disappear.

## Sources

- NASA DSN Telecommunications Link Design Handbook 810-005, Modules 101, 104
  and 301: station locations, antennas and the 10° planning limit.
- NASA/TP-2019-220391: reference lander radio power and data rates.
- SSTL Lunar Pathfinder Service Guide: the relay orbit and service.
