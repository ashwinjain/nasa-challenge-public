# Phase 7 data: resources and the base

Phase 7 of the [navigator plan](../../docs/space-apps/navigator-plan.md)
asks **"can we actually live here?"** For a chosen site it shows:

1. **Ice:** the nearest permanently shadowed area, whether it's cold enough
   to hold ice, how deep the ice would be, and the drive to get there.
2. **Oxygen and water you could make**, as a range, because nobody knows
   exactly how much ice there is.
3. **Regolith:** how much soil to pile on a habitat for radiation shielding.
4. **Simple flags** for temperature, radiation (by solar cycle), neighbors
   and science value.

All of this is **information only**: it's shown
next to each site's results but doesn't change the power sizing, kit weight
or landing-target ranking.

## Files

| File | In git? | Size | What it is |
|---|---|---|---|
| `LPSR_80S_20MPP_ADJ.TIF` | No (Firebase) | 154 MB | **Map of permanently shadowed areas**, 80°S to the pole, 20 m pixels. 1 = never sunlit, 0 = sunlit sometimes. |
| `LPSR_80S_20MPP_ADJ_1km2.CSV` | No (Firebase) | 30 MB | **List of the 1,531 shadowed areas over 1 km²**: outline (WKT, polar stereographic m), area, ID |
| `dlre_prp_south.tab` | No (Firebase) | 605 MB | **Diviner temperatures and ice depth**, ~2.9 million small triangles from ~76°S to the pole |
| `dlre_prp_south.lbl`, `.xml` | Yes | small | Column definitions for the Diviner table |
| [`noaa_predicted_solar_cycle.json`](noaa_predicted_solar_cycle.json) | Yes | 17 KB | NOAA's monthly sunspot forecast, May 2026 – Dec 2030 |
| [`assumptions.csv`](assumptions.csv) | Yes | small | Ice amounts, regolith, radiation and drive limits, with sources |
| [`first_results.py`](first_results.py) | Yes | small | Makes `site_resources.csv` |
| [`site_resources.csv`](site_resources.csv) | Yes | small | First results for every polar site |

The shadow map and list come from the same NASA team and map family as the
Phase 2 and 6 elevation maps (PGDA product 90, Barker et al. 2023), so they
line up pixel for pixel with the 20 m map.

### The Diviner table

Diviner is LRO's heat camera. This table is the science team's model fit to
its first year of polar measurements. Each row is a small triangle on the
surface with:

| Column | Meaning |
|---|---|
| `tri_clon`, `tri_clat` | Center of the triangle (east longitude, latitude) |
| `temp_max` | Hottest surface temperature in a year (K) |
| `temp_avg` | Average temperature 2 cm down (K) |
| `ice_depth` | How deep you'd dig before ice would last (loses < 1 kg/m² per billion years), in m |

`ice_depth` codes: **0** = ice is stable right at the surface; **−999** = no
stable ice within 2.87 m. The file also has **−1**, which the label doesn't
explain. It appears only in the very coldest triangles (all of those with a
yearly max under 80 K), so we treat it as "stable at the surface" too.

Triangles are a few hundred meters across, coarser than the 20 m shadow map,
so a small shadowed area only holds a few of them, and the ones at its edge
mix in warmer ground.

## First results

For each of the 9 sites in [`sites.csv`](../phase-3/sites.csv): the nearest
shadowed area over 1 km², its temperature and ice, and a **straight-line**
drive from the site to its edge over the Phase 2 80 m elevation map.

| Site | Nearest shadow (km²) | Distance | Max temp (median) | Ice at surface | Steepest grade on the drive | Drive over 20° |
|---|---|---|---|---|---|---|
| Slater Plain | 60.6 | 9.7 km | 77 K | **100%** | 22° | 10% |
| Haworth | 3.6 | 9.4 km | 73 K | 76% | 24° | 9% |
| Mons Mouton | 6.3 | 6.0 km | 80 K | 67% | **18°** | **0%** |
| Mons Mouton Plateau | 6.3 | 12.0 km | 80 K | 67% | 22° | 1% |
| de Gerlache Rim 2 | 3.5 | 6.7 km | 141 K | 45% | 29° | 27% |
| Nobile Rim 1 | 1.0 | 5.0 km | 180 K | 29% | 25° | 15% |
| Nobile Rim 2 | 3.6 | 6.6 km | 235 K | 28% | 21° | 4% |
| Malapert Massif | 1.4 | 10.2 km | 159 K | 27% | 27° | 11% |
| Peak Near Cabeus B | 2.2 | 13.5 km | 221 K | 0% (buried ~0.24 m) | 34° | 49% |

What this shows:

- **No Artemis point has a 1 km² shadowed area within walking reach.** The
  nearest are 5–13 km away, far beyond the 300 m the crew carries gear on
  foot, so getting to ice needs a rover. That's
  expected: the sunniest points are on peaks, and ice is in the low,
  dark places.
- **Mons Mouton has the easiest drive**: 6 km, never steeper than 18°, to a
  shadowed area that's two-thirds cold enough for surface ice.
- **Slater Plain's nearest shadow is the coldest and largest** (61 km², all of
  it cold enough), but the drive has steep stretches.
- **Check:** the share of each area under 110 K (Diviner's max temperature)
  agrees within a few percent with the share the ice model puts at the
  surface. Two separate columns tell the same story, which is reassuring.

### How much water and oxygen? A worked example

With [`assumptions.csv`](assumptions.csv): one cubic meter of icy regolith
weighs ~1,660 kg. At 5.6% ice and 50% recovered, that's **~46 kg of water**
(4 kg at the low 0.5% end, 71 kg at the high 8.5% end). Splitting that water
gives **~41 kg of oxygen**.

A crew of 4 breathes ~3.4 kg of oxygen a day (0.84 kg each, Phase 4), so one
cubic meter at the central value covers about 12 days of oxygen for the
crew; at the low end (~3.6 kg of oxygen), about 1 day.

### Radiation

The Chang'e 4 lander measured ~1.37 mSv per day on the surface. The default
one-year crewed stay would be ~500 mSv, about 83% of NASA's 600 mSv career
limit, before any shielding: a year-round base needs a shielded habitat.
(Information only, like the rest of this page; it doesn't change any
calculation.) NOAA's forecast has the Sun
calming down through 2030 (sunspot number ~83 now, ~9 by late 2030). A quieter
Sun means fewer solar storms, but more cosmic rays reach the Moon.

## Limits

- **Straight-line drives.** Real routes would go around steep spots. Route
  planning (shortest path over the slope map) is a Phase 7 build task.
- **"Cold enough" isn't "has ice."** These maps show where ice *could*
  survive. How much is actually there is the big unknown, which is why yields
  are a range (0.5% to 8.5% by mass).
- **Shadowed areas under 1 km² are left out.** The full list has ~506,000,
  including small cold spots much closer to the sites. They're in the full
  `LPSR_80S_20MPP_ADJ.CSV` (209 MB) if needed later.
- **The `−1` ice code** is our reading, not documented.
- **Assumptions without a source:** extraction efficiency (50%) and shielding
  thickness (1 m) are marked "Our assumption" in the CSV.

## Sources

- **Shadowed areas:** Barker et al. 2023, Planet. Sci. J. 4, 183
  ([doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1)), via
  [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90).
- **Diviner temperatures and ice depth:** Paige et al., LRO DLRE Level 5
  Polar Resource Products V2.0 (LRO-L-DLRE-5-PRP-V2.0), PDS Geosciences Node,
  [data_derived_prp](https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/).
- **Solar cycle:** NOAA SWPC,
  [predicted-solar-cycle.json](https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json),
  downloaded.
- **Ice, radiation, regolith values:** see the `source` column in
  [`assumptions.csv`](assumptions.csv).

Downloaded:

| File | Bytes | SHA-256 |
|---|---|---|
| `LPSR_80S_20MPP_ADJ.TIF` | 154,221,202 | `ad95311b81db773039af441dd66a017f024327858c6e0314b8c92bf2f470834e` |
| `LPSR_80S_20MPP_ADJ_1km2.CSV` | 29,642,968 | `5d914b17887b385ad53c004751dad0235d8739959f3cf9063573575832c942d5` |
| `dlre_prp_south.tab` | 604,800,210 | `393deaa5d8925d45bb2ed608f937a824f5eae029c2558aad1d2da8206b83a62d` |

To download from the team's Firebase Storage (~790 MB; run `gcloud auth login` once first):

```bash
gcloud storage cp "gs://nasa-challenge-a8b4a.firebasestorage.app/data/phase-7/*" data/phase-7/
```

Or from the original sources:

```bash
cd data/phase-7 && G=https://pgda.gsfc.nasa.gov/data/LOLA_20mpp && P=https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp && curl -O $G/LPSR_80S_20MPP_ADJ.TIF -O $G/LPSR_80S_20MPP_ADJ_1km2.CSV -O $P/dlre_prp_south.tab -O $P/dlre_prp_south.lbl -O $P/dlre_prp_south.xml
```

Then, from the repo root (the first run reads the whole 605 MB Diviner table
and saves a 58 MB cache, `dlre_prp_south_xy.npz`, so later runs take seconds):

```bash
.venv/bin/python -I data/phase-7/first_results.py
```
