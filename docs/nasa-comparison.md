# Our sunlight vs NASA's

Does the app's terrain model give the right answer? We checked it against
NASA's own south-pole sunlight and Earth-visibility maps (Mazarico et al.
2011, [PGDA product 69](https://pgda.gsfc.nasa.gov/products/69)) at the
nine Artemis regions.

**Result:** treating the Moon as a smooth ball is off by **19.7
points** on average. With real terrain it's off by **2.0 points**.

| | Average gap from NASA | Worst gap |
|---|---|---|
| Smooth Moon | 19.7 points | 31.3 points (Nobile Rim 1) |
| Real terrain, 2 m | **2.0 points** | 7.0 points (Mons Mouton Plateau) |

## Sunlight

Share of the Sun's disk above the skyline at each region's point, averaged
over 18.6 years. "Gap" is ours minus NASA's, in percentage points.

| Region | Lat | NASA | Smooth Moon | Gap | Terrain, 2 m | Gap |
|---|---|---|---|---|---|---|
| Haworth | -86.4° | 70.5% | 52.4% | -18.1 | 70.6% | **+0.1** |
| Malapert Massif | -86.0° | 81.9% | 52.2% | -29.7 | 80.0% | **-1.9** |
| Mons Mouton | -85.4° | 74.7% | 51.9% | -22.8 | 70.9% | **-3.8** |
| Mons Mouton Plateau | -85.5° | 78.4% | 51.9% | -26.5 | 71.4% | **-7.0** |
| Nobile Rim 1 | -85.3° | 83.1% | 51.8% | -31.3 | 83.9% | **+0.8** |
| Nobile Rim 2 | -83.7° | 53.9% | 51.3% | -2.6 | 52.3% | **-1.6** |
| Peak Near Cabeus B | -83.6° | 68.4% | 51.3% | -17.1 | 68.5% | **+0.1** |
| Slater Plain | -87.3° | 65.8% | 53.3% | -12.5 | 63.7% | **-2.1** |
| de Gerlache Rim 2 | -88.5° | 75.1% | 58.2% | -16.9 | 75.3% | **+0.2** |

Why the smooth Moon is so far off: near the pole the Sun skims the horizon.
On a smooth ball every site is lit about half the time. In reality, sites on
high ridges see over the surrounding ground and are lit 64–84% of the time,
while lower ground, like Nobile Rim 2's point (52%), sees no more than a smooth
ball would. Only the terrain
model gets both right.

## Earth visibility

Share of time any part of Earth is above the skyline. NASA's Earth map only
covers 85°S to the pole, so two regions (Nobile Rim 2 and Peak Near Cabeus B)
have no reference.

| Region | NASA | Terrain, 2 m | Gap |
|---|---|---|---|
| Haworth | 60.1% | 65.7% | +5.6 |
| Malapert Massif | 58.7% | 61.2% | +2.5 |
| Mons Mouton | 56.8% | 58.7% | +1.9 |
| Mons Mouton Plateau | 61.6% | 68.2% | +6.7 |
| Nobile Rim 1 | 59.9% | 65.6% | +5.7 |
| Slater Plain | 49.8% | 49.9% | +0.1 |
| de Gerlache Rim 2 | 60.2% | 61.8% | +1.6 |

Average gap 3.4 points at 2 m. We run a little higher than NASA at
most regions, and NASA doesn't state its observer height.

The app itself shows Earth contact at the **10 m antenna mast**, not at 2 m.
From 10 m the antenna sees over more of the nearby ground, so Earth is in
view more often than in NASA's map; this check is about whether the terrain
model is right, which is why it uses the same 2 m as the sunlight check.

## How we compared

- **Same span:** 18.6 years at 1-hour steps, the Moon's full nodal cycle
  that NASA's maps average over.
- **Sunlight counted by the visible part of the Sun's disk**, so a half-risen
  Sun counts as half lit.
- **Height 2 m**, a person standing. NASA doesn't state its observer
  height. At 0 m our eye sits on the ground and small bumps in the elevation
  map 40 m away block the Sun, so 0 m is much darker than NASA.
- **Elevation maps:** LOLA (Barker et al. 2023), 20 m detail within 10 km of
  the site, then 80 m and 240 m maps out to 300 km.

## Limits

- Detail finer than 20 m (boulders, small rims) isn't in the maps.
- The largest sunlight gaps are a few points darker than NASA. Small bumps
  close to the eye are one likely cause, since raising the eye to 10 m closes
  most of the gap at those sites.
- NASA's maps don't say which elevation model or observer height they used,
  so some disagreement is expected even with a perfect model.

To reproduce: `.venv/bin/python scripts/validate_terrain.py` (writes
`data/phase-2/terrain_validation.csv`, which also holds a few sites outside the
nine regions; this page reports the nine).
