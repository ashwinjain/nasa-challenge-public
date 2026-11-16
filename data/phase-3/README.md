# Phase 3 data: the sites to compare

Phase 3 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
compares sites and dates side by side. It reuses the
[Phase 1](../phase-1/README.md) ephemeris and the
[Phase 2](../phase-2/README.md) terrain unchanged. The only new data is
**which sites to compare**: one coordinate for each, in
[`sites.csv`](sites.csv).

## What's in the list (9 sites)

One coordinate for each of NASA's nine Artemis III candidate regions (Oct
2024): Haworth, Malapert Massif, Mons Mouton, Mons Mouton Plateau, Nobile
Rim 1, Nobile Rim 2, Peak Near Cabeus B, Slater Plain and de Gerlache Rim 2.
The app is scoped to these nine (decided 2026-11-14); earlier versions also
listed past and planned missions.

## How each coordinate was chosen

Method `sunniest_in_region`: the pixel with the highest average sunlight
inside the region, on NASA's sunlight map. Ties go to the pixel nearest the
region's center.

### Sunniest spot: which map

We use the **most detailed map that covers the whole region**: 60 m
(85°S–90°S, from [Phase 2](../phase-2/README.md)) when it fits, otherwise
120 m (75°S–90°S, downloaded here). The `sunlit_map` column says which.

This matters more than you'd expect. Near the pole, average sunlight can
go from ~35% to ~85% within a single 120 m pixel, because the sunniest
spots are small peaks and ridge crests. Switching from the 120 m to the
60 m map lowered the best values by a few percent and moved the chosen
points: some by tens of meters, others by kilometers, because a different
peak came out on top. Malapert's point moved ~9 km (84.5% → 81.9%) and
de Gerlache Rim 2's ~4 km. Several peaks in a region can be nearly tied,
so treat "the sunniest spot" as one good spot, not the only one. Three regions only fit the 120 m map (Mons Mouton
Plateau, Nobile Rim 2, Peak Near Cabeus B), so their points are less
precise.

## Limits

- **One point per site.** Sunlight changes sharply over a few hundred
  meters, so a different point in the same region could score quite
  differently. Phase 6 treats regions as areas.
- **"Sunniest" ignores everything else.** The chosen pixel may be steep,
  rough, or poor for Earth contact. Phase 6 adds slope; a combined
  sunlight-plus-Earth rule is an easy later change in `build_sites.py`.
- **Sunlight values are long-term averages** (18.6 years, ground level),
  from Mazarico et al. 2011. They rank sites; they aren't the per-date
  values Phase 3 will compute.

## Files

| File | In git? | What it is |
|---|---|---|
| `sites.csv` | Yes | The site list. Columns below. |
| `build_sites.py` | Yes | Script that writes `sites.csv`. |
| `artemis_regions.geojson` | Yes | USGS outlines of the nine Artemis III regions (3.5 KB, lat/long, Moon sphere 1737.4 km). |
| `AVGVISIB_75S_120M_201608.TIF` | No (83 MB) | NASA average-sunlight map, 75°S–90°S at 120 m. |

`sites.csv` columns: `id`, `name`, `group` (core), `kind`,
`lat`, `lon` (degrees, east positive, MOON_ME frame), `method`,
`avg_sunlit` (0–1, long-term average, blank outside the maps),
`sunlit_map`, `source`, `notes`.

## Rebuilding

```bash
python3 -m venv .venv && .venv/bin/pip install rasterio pyproj shapely numpy
```

```bash
curl -o data/phase-3/AVGVISIB_75S_120M_201608.TIF https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_75S_120M_201608.TIF
```

```bash
.venv/bin/python data/phase-3/build_sites.py
```

The 60 m map comes from Phase 2's download.

## Sources

- **Artemis region outlines:** USGS, *Down Selected Artemis III Candidate
  Landing Site Navigational Grids*, file `A3_9regions-lonlat-simplified.zip`
  ([ScienceBase](https://www.sciencebase.gov/catalog/item/671a6fa8d34efed5620f89f8)).
  Downloading it needs a browser and a CAPTCHA; we kept only the GeoJSON.
- **Sunlight maps:** Mazarico et al. 2011, Icarus 211, 1066–1081
  ([doi](https://doi.org/10.1016/j.icarus.2010.10.030)), via
  [PGDA product 69](https://pgda.gsfc.nasa.gov/products/69).
  `AVGVISIB_75S_120M_201608.TIF` SHA-256:
  `d539467f16ccc5f51b6a904af6be5d16c9b2f194afe619b9f1f81841d9fec0bb`.
