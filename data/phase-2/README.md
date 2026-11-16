# Phase 2 data: real terrain

Phase 1 treats the Moon as a smooth ball. At the south pole that isn't good
enough: the Sun and Earth sit low in the sky, so a ridge or a distant
mountain can block them. Phase 2 of the
[navigator plan](../../docs/space-apps/navigator-plan.md) fixes this by
computing each site's **skyline** (how high the terrain rises in every
direction) from real elevation maps. A site is then sunlit when the Sun is
above its skyline, and in contact when Earth is.

**The map files are not in git.** Each elevation map is over GitHub's 100 MB
limit, so `data/phase-2/*.TIF` is in `.gitignore`. Download them with the
command at the bottom of this page. Only the small skyline files we compute
from them get committed.

All files come from NASA Goddard's
[PGDA](https://pgda.gsfc.nasa.gov/) site, and they use the same Moon
coordinate system (MOON_ME, DE421) as the [Phase 1 data](../phase-1/README.md).
They're GeoTIFFs in south polar stereographic projection, with X/Y in meters
and the Moon as a 1737.4 km sphere.

## Elevation maps

From [PGDA product 90](https://pgda.gsfc.nasa.gov/products/90), the newest
LOLA south-pole maps (Barker et al. 2023). Each pixel is one height value,
in meters, for a square of ground.

| File | Covers | Pixel size | Size | Why we need it |
|---|---|---|---|---|
| `LDEM_80S_80MPP_ADJ.TIF` | 80°S to the pole | 80 m | 189 MB | **Nearby terrain.** Detailed heights around each site. Covers all nine Artemis regions. |
| `LDEM_60S_240MPP_ADJ.TIF` | 60°S to the pole | 240 m | 219 MB | **Distant mountains.** The 80°S map only reaches ~300 km from the pole, but mountains 100+ km away can still block the low polar Sun. |

### Why distant mountains matter

The Sun never gets more than ~1.5° above a flat horizon at the south pole.
A mountain 5 km taller than the site and 100 km away rises ~2.9° from
height and distance alone; the Moon's curvature lowers that by ~1.65°,
leaving ~1.2°. That's enough to block the Sun for part of the month.

### Upgrade later

`LDEM_80S_20MPP_ADJ.TIF` (2.7 GB) is the same nearby area at 20 m pixels.
Switch to it once the skyline code works. The code shouldn't need to change,
just the file.

## Reference maps (for checking our results)

From [PGDA product 69](https://pgda.gsfc.nasa.gov/products/69)
(Mazarico et al. 2011). JPL Horizons can check Phase 1, but it treats the
Moon as smooth, so it can't check terrain. These maps are NASA's own
terrain-based answers, and the plan's "done when" is matching them.

| File | Covers | Pixel size | Size | What it is |
|---|---|---|---|---|
| `AVGVISIB_85S_060M_201608.TIF` | 85°S to the pole | 60 m | 34 MB | Average fraction of time each spot is sunlit |
| `AVGVISIB_85S_060M_201608_EARTH.TIF` | 85°S to the pole | 60 m | 25 MB | Average fraction of time each spot can see Earth (any part of its disk) |

To compare fairly:
- **Ground level is implied, not stated.** Neither PGDA product 69 nor its
  README gives an observer height. They also don't say which DEM the 201608
  maps used, or how the horizon was computed. Compare our 0 m skyline, but
  treat that as an assumption.
- They're **averaged over 18.6 years** (the Moon's long orbital cycle), with
  hourly steps, so run our model over the same kind of span.

A second, shorter reference is in Barker et al. 2021
([doi:10.1016/j.pss.2020.105119](https://doi.org/10.1016/j.pss.2020.105119)):
illumination at 1 m and 5 m above the surface for Jan 2024 – Jan 2026 at a
few south-pole sites. That's numbers in a paper, not a download.

## What this data does not cover

- **Anything smaller than a pixel.** At 80 m, small ridges and crater rims
  blur out. Also, LOLA measured along separate tracks and the gaps between
  them are interpolated, so real detail is coarser than the pixel size,
  especially farther from the pole.
- **Boulders.** Even the 5 m site maps planned for Phase 6 don't show them.
- **North pole and the rest of the Moon.** Custom coordinates outside 60°S
  get the smooth-Moon result.

## Reading the files

A starting sketch, not yet run (`rasterio` and `pyproj` aren't installed
yet). Check the map's own CRS with `print(dem.crs)` before trusting the
lat/long conversion.

```python
import rasterio
from pyproj import CRS, Transformer

dem = rasterio.open('data/phase-2/LDEM_80S_80MPP_ADJ.TIF')
moon_ll = CRS.from_proj4('+proj=longlat +R=1737400 +no_defs')
to_map = Transformer.from_crs(moon_ll, dem.crs, always_xy=True)

x, y = to_map.transform(0.0, -89.5)        # lon, lat → map meters
row, col = dem.index(x, y)
height_m = dem.read(1, window=((row, row + 1), (col, col + 1)))[0, 0]
```

## Sources

Downloaded:

| File | URL | SHA-256 |
|---|---|---|
| `LDEM_80S_80MPP_ADJ.TIF` | `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF` | `82030dcbdd7c4bb0c7d858e9b4b293b9f2cda5a543ba31ec0f42784bd6beee5a` |
| `LDEM_60S_240MPP_ADJ.TIF` | `https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF` | `3f9663257b63022f2b0d5a623482ff3cadddceb91594a4e4ca14a94d8cec8b34` |
| `AVGVISIB_85S_060M_201608.TIF` | `https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608.TIF` | `ccf67d4f39e0a970c111196da7d6551ffcf50d075470b93067fb3904c0b05806` |
| `AVGVISIB_85S_060M_201608_EARTH.TIF` | `https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF` | `d71dc5adfff653e0e924e0a4cbf03795b996caa30b4ace3d5843a70a5ab2f3d2` |

Cite Barker et al. 2023 ([doi:10.3847/PSJ/acf3e1](https://doi.org/10.3847/PSJ/acf3e1))
for the elevation maps and Mazarico et al. 2011
([doi:10.1016/j.icarus.2010.10.030](https://doi.org/10.1016/j.icarus.2010.10.030))
for the reference maps.

To download (~466 MB):

```bash
mkdir -p data/phase-2 && cd data/phase-2 && curl -O https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF -O https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF -O https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608.TIF -O https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF
```

## Surface imagery (albedo)

`scripts/precompute_albedo.py` drapes real, geographically-registered imagery on
the surface mesh: the **NASA LRO LROC WAC South Pole Summer Mosaic** (643 nm,
100 m/pixel, polar stereographic — the same projection as the LDEMs). It is
~790 MB, gitignored, and not shipped; only the small baked `<site>_albedo.bin`
tiles reach the client. The LROC server rate-limits `/vsicurl`, so download the
whole file once instead of streaming:

```bash
cd data/phase-2 && curl -fL --retry 10 --retry-delay 60 --retry-all-errors \
  https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/EXTRAS/BROWSE/WAC_ROI/WAC_ROI_SOUTH_SUMMER/WAC_ROI_SOUTH_SUMMER_100M.TIF
```

Product `WAC_ROI_SOUTH_SUMMER_100M` (LROC RDR, LRO-L-LROC-5-RDR-V1.0). Cite the
LROC team / Robinson et al. 2010 for the WAC instrument and mosaic.
