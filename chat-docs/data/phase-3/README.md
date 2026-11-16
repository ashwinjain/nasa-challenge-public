# Phase 3 data: the sites to compare

Phase 3 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
compares sites and dates side by side. It reuses the
[Phase 1](../phase-1/README.md) ephemeris and the
[Phase 2](../phase-2/README.md) terrain unchanged. The only new data is
**which sites to compare**: one coordinate for each.

## What's in the list (9 sites)

One coordinate for each of NASA's nine Artemis III candidate regions (Oct
2024): Haworth, Malapert Massif, Mons Mouton, Mons Mouton Plateau, Nobile
Rim 1, Nobile Rim 2, Peak Near Cabeus B, Slater Plain and de Gerlache Rim 2.
The app covers only these nine.

## How each coordinate was chosen

The pixel with the highest average sunlight inside the region, on NASA's
sunlight map. Ties go to the pixel nearest the region's center.

### Sunniest spot: which map

We use the **most detailed map that covers the whole region**: 60 m
(85°S–90°S) when it fits, otherwise 120 m (75°S–90°S).

This matters more than you'd expect. Near the pole, average sunlight can
go from ~35% to ~85% within a single 120 m pixel, because the sunniest
spots are small peaks and ridge crests. Switching from the 120 m to the
60 m map lowered the best values by a few percent and moved the chosen
points: some by tens of meters, others by kilometers, because a different
peak came out on top. Malapert's point moved ~9 km (84.5% → 81.9%) and
de Gerlache Rim 2's ~4 km. Several peaks in a region can be nearly tied,
so treat "the sunniest spot" as one good spot, not the only one. Three
regions only fit the 120 m map (Mons Mouton Plateau, Nobile Rim 2, Peak
Near Cabeus B), so their points are less precise.

## Limits

- **One point per site.** Sunlight changes sharply over a few hundred
  meters, so a different point in the same region could score quite
  differently. Phase 6 treats regions as areas: it finds safe landing
  targets across the whole region and a panel spot for each.
- **"Sunniest" ignores everything else.** The chosen pixel may be steep,
  rough, or poor for Earth contact. Phase 6's landing targets check slope.
- **Sunlight values are long-term averages** (18.6 years, ground level),
  from Mazarico et al. 2011. They pick and rank the points; the numbers the
  app shows for your dates come from our own hourly runs.

## Sources

- **Artemis region outlines:** USGS, *Down Selected Artemis III Candidate
  Landing Site Navigational Grids*
  ([ScienceBase](https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8)).
- **Sunlight maps:** Mazarico et al. 2011, Icarus 211, 1066–1081
  ([doi](https://doi.org/10.1016/j.icarus.2010.10.030)), via
  [PGDA product 69](https://pgda.gsfc.nasa.gov/products/69).
