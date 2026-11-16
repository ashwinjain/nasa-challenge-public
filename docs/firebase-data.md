# Navigator data in Firebase Storage

The big NASA data files (maps, tables and ephemeris kernels, ~4.1 GB) live in the
team's Firebase project, not in git. This page explains where they are, how
to get them onto a computer, and how the website should read them.

**For Claude:** if you are starting the "read the data live" work, read the
whole page first, then see [Starting the implementation](#starting-the-implementation).

## Where the files are

- **Firebase project:** `nasa-challenge-a8b4a` (Blaze plan)
- **Bucket:** `gs://nasa-challenge-a8b4a.firebasestorage.app` (region `us-east1`)
- **Layout:** same paths as the repo, under `data/`

| Path in the bucket | Size | What it is | Used in |
|---|---|---|---|
| `data/phase-1/de421.bsp` | 17 MB | Sun, Earth and Moon positions (JPL ephemeris) | Phase 1 |
| `data/phase-1/moon_pa_de421_1900-2050.bpc` | 1.8 MB | Moon orientation (tilt and spin) | Phase 1 |
| `data/phase-1/moon_080317.tf` | 21 KB | Moon frame definitions (MOON_ME vs MOON_PA) | Phase 1 |
| `data/phase-1/pck00008.tpc` | 112 KB | Planet sizes and shapes | Phase 1 |
| `data/phase-2/LDEM_80S_80MPP_ADJ.TIF` | 189 MB | Elevation, 80°S to the pole, 80 m pixels | Phase 2 skylines |
| `data/phase-2/LDEM_60S_240MPP_ADJ.TIF` | 219 MB | Elevation, 60°S to the pole, 240 m pixels (distant mountains) | Phase 2 skylines |
| `data/phase-2/AVGVISIB_85S_060M_201608.TIF` | 34 MB | NASA's average-sunlight map, 60 m (check values) | Phases 2–3 |
| `data/phase-2/AVGVISIB_85S_060M_201608_EARTH.TIF` | 25 MB | NASA's average-Earth-visibility map, 60 m (check values) | Phases 2, 5 |
| `data/phase-3/AVGVISIB_75S_120M_201608.TIF` | 83 MB | Average-sunlight map, 75°S to the pole, 120 m | Phase 3 |
| `data/phase-6/LDEM_80S_20MPP_ADJ.TIF` | 2.7 GB | Elevation, 80°S to the pole, 20 m pixels | Phase 6 slopes |
| `data/phase-7/LPSR_80S_20MPP_ADJ.TIF` | 154 MB | Permanently shadowed areas, 20 m pixels (1 = never sunlit) | Phase 7 ice |
| `data/phase-7/LPSR_80S_20MPP_ADJ_1km2.CSV` | 30 MB | The 1,531 shadowed areas over 1 km²: outline, area, ID | Phase 7 ice |
| `data/phase-7/dlre_prp_south.tab` (+ `.lbl`, `.xml`) | 605 MB | Diviner yearly max/average temperature and ice depth, text table | Phase 7 ice |
| `data/phase-7/noaa_predicted_solar_cycle.json` | 17 KB | NOAA sunspot forecast to Dec 2030 | Phase 7 radiation |

**Still in git:** everything small, meaning each phase's `README.md` (with
SHA-256 checksums and what every file means), the CSVs (`sites.csv`,
assumptions, DSN stations), `artemis_regions.geojson` and the scripts. The
Phase 1 kernels are in both places. The phase READMEs, and the Phase 4 and 5
data, are on the `data-gathering` branch.

### What the map files look like inside

All `.TIF` files are GeoTIFFs in the same projection:
south polar stereographic on a 1737.4 km sphere,
`+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400`, X/Y in meters,
Moon frame MOON_ME (DE421).

| Files | Pixel type | Notes |
|---|---|---|
| `LDEM_*` | float32, meters above the 1737.4 km sphere (nodata = NaN) | Tiled 512×512, deflate, **built-in zoomed-out copies (overviews)** |
| `AVGVISIB_*` | int16, × 4e-5 = fraction of time (nodata = −32768) | Tiled 256×256, deflate, no overviews |

Because they're **tiled**, a program can read just one small area (a
"window") over the network with HTTP range requests, instead of downloading
the whole file. That's the key to using them live.

## Setting up a computer (one time)

You need to be a member of the Firebase project (Ashwin can add you as
Owner or Editor under Project settings → Users and permissions).

```bash
gcloud auth login
```

```bash
gcloud auth application-default login
```

The first lets the `gcloud` command use your account; the second lets
Python libraries (rasterio/GDAL, `google-cloud-storage`) use it too.

Download everything (~4.1 GB; skip Phase 6 if you don't need the 2.7 GB map):

```bash
gcloud storage cp -r "gs://nasa-challenge-a8b4a.firebasestorage.app/data/*" data/
```

Or one phase at a time:

```bash
gcloud storage cp "gs://nasa-challenge-a8b4a.firebasestorage.app/data/phase-2/*" data/phase-2/
```

`gcloud storage cp` checks each file's hash after download. To check a file
against the SHA-256 in its phase README: `shasum -a 256 data/phase-2/*.TIF`.

To add or replace a file (Owner/Editor only):

```bash
gcloud storage cp data/phase-N/NEWFILE.TIF gs://nasa-challenge-a8b4a.firebasestorage.app/data/phase-N/
```

## How the website should read the data

The site has two parts (see [deploy.md](deploy.md)): the frontend on Firebase
Hosting, and the Python API (`lunarsky/api.py`) on Cloud Run. The frontend
already calls only `/api/...`.

**Recommended: the API reads the files; the browser never touches the big
ones.**

```
Browser ──/api/...──▶ Cloud Run (lunarsky/api.py) ──range reads──▶ Firebase Storage bucket
                          small JSON back                     (only the tiles it needs)
```

### What goes in the image vs. the bucket

Decide per file by size, how much of it one request needs, and how often it
changes:

- **In the Cloud Run image:** small files that nearly every request needs
  (Phase 1 kernels, `sites.csv` and other CSVs, region outlines, small
  precomputed results). Fast, and files in the image don't use the
  instance's memory.
- **In the bucket, read a window at a time:** big tiled GeoTIFFs where one
  request needs a small area (the LDEM elevation maps, LPSR, AVGVISIB for
  point lookups). Don't download them whole at startup: Cloud Run's disk is
  memory, and deploys would upload gigabytes.
- **Precomputed offline:** anything slow, or that a request would need most
  of, or that can't be read in pieces (the 577 MB Diviner text table).
  Serve the small result from the image or `derived/` in the bucket.

### Reading a map: `lunarsky/data.py`

1. **Big maps: read a window from the API.** Example: for a site's skyline,
   the API opens the elevation map and reads only the area around the site,
   then returns a small JSON result. `open_raster` takes the file's path
   under `data/` and reads it from disk if it's there, otherwise from the
   bucket, fetching only the tiles it needs:

   ```python
   from rasterio.windows import from_bounds
   from lunarsky.data import open_raster

   with open_raster("phase-2/LDEM_80S_80MPP_ADJ.TIF") as src:
       win = from_bounds(x - 50_000, y - 50_000, x + 50_000, y + 50_000, src.transform)
       heights_m = src.read(1, window=win)
   ```

   Read inside the `with` block: bucket reads fetch tiles lazily and need the
   login in place. `x, y` are polar-stereographic meters (convert lat/lon
   with pyproj and the projection above). For a quick zoomed-out look, read
   from the overviews (`src.read(1, out_shape=...)` with a smaller shape).

   Settings: `LUNAR_DATA_SOURCE` = `auto` (default: disk, else bucket),
   `local` (disk only) or `bucket` (always the bucket, to try the Cloud Run
   path from a laptop). `LUNAR_DATA_BUCKET` overrides the bucket name.
   Install the libraries with `pip install -e ".[maps]"` (`make setup` does).

   **Login.** On Cloud Run the service's own account is used; it runs as the
   default compute account, which has Editor on the project and so can read
   the bucket with no extra role. On a laptop, Application Default
   Credentials (`gcloud auth application-default login`) are used if set up,
   otherwise your plain `gcloud auth login` account. Reads go over HTTPS with
   a bearer token (`/vsicurl/` plus an `Authorization` header), not GDAL's
   `/vsigs/`, so the same path works everywhere.

   **Tested** with `make check-bucket` / `scripts/check_bucket_read.py`:
   a 100×100 window at the pole read from the bucket is identical to the
   file on disk for the 80 m, 240 m and 20 m elevation maps and the 60 m
   sunlight map. The pole on the 80 m map is 1,282.3 m. A first read takes
   ~0.6–1.1 s from a laptop (three requests: file size, header, one tile
   range) and repeats ~0.02 s from GDAL's cache, even on the 2.5 GB map.
   **Also tested on Cloud Run** (revision `lunar-navigator-api-00003-vkx`):
   a one-off job from the same image and service account read the pole from
   the bucket, 1,282.3 m on the 80 m map (1.35 s) and 1,287.5 m on the 20 m
   map (0.82 s), matching disk. The image needs the system `libexpat1` for
   rasterio's GDAL; the Dockerfile installs it and fails the build if
   `import rasterio` breaks.

2. **Expensive results: compute once, store small.** Skylines (horizon masks)
   take time to compute and don't change. Compute each site's skyline once,
   save it as small JSON (e.g. `derived/skylines/<site>.json` in the bucket or
   `data/precomputed/` in git), and serve that. Only custom coordinates need a
   live computation.

3. **Small files can go straight to the browser** (optional). The sites list,
   region outlines or precomputed JSON can be fetched directly from Storage
   with the Firebase JS SDK (`getStorage`, `ref`, `getDownloadURL`). This needs
   the security rules below to allow reads, and a CORS setting on the bucket
   (`gcloud storage buckets update gs://... --cors-file=cors.json`), which
   isn't set yet. Going through `/api` avoids both.

**Region note:** the bucket is in `us-east1` and the Cloud Run service in
`us-central1`. That works, but each read crosses regions (a little slower,
small cost). If reads feel slow, deploy the API to `us-east1` too.

## Security rules: needs fixing before 2026-12-07

The bucket currently has Firebase's **test-mode** rules:

```
allow read, write: if request.time < timestamp.date(2026, 12, 7);
```

That means **anyone on the internet who knows the bucket name can read,
overwrite or delete the files until 7 Dec 2026**, and after that date all
browser/app access is blocked. (`gcloud`, and the API using its Google
account, aren't affected by these rules either way; they use project
permissions instead.)

Recommended rules (public read for the NASA data, no writes from apps):

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /data/{allPaths=**} {
      allow read: if true;
      allow write: if false;
    }
    match /derived/{allPaths=**} {
      allow read: if true;
      allow write: if false;
    }
  }
}
```

To manage these from the repo, save them as `storage.rules` and add
`"storage": { "rules": "storage.rules" }` to `firebase.json`, then:

```bash
npx firebase-tools deploy --only storage --project nasa-challenge-a8b4a
```

Make reads `if false` too if you'll only ever read through `/api`.

## Costs

Blaze plan, `us-east1`: free each month up to 5 GB stored and 100 GB
downloaded; beyond that, pennies per GB. We store ~4.1 GB. Each full download
of the Phase 6 map uses 2.7 GB of the 100 GB, so prefer windowed reads over
whole-file downloads. Deleted files are kept for 7 days (soft delete) and
count toward storage during that time.

## Starting the implementation

Suggested first prompt for Claude on a teammate's computer:

> Read `docs/firebase-data.md` and `docs/space-apps/navigator-plan.md`.
> Then add Phase 2 terrain to the API: a module in `lunarsky/` that opens
> `phase-2/LDEM_80S_80MPP_ADJ.TIF` (and the 240 m map for distant
> mountains) with `lunarsky.data.open_raster`, which already reads from
> `data/` or the Firebase bucket, and computes a site's skyline (horizon
> elevation for each compass direction). Add `pyproj` to the `maps` extra
> in `pyproject.toml` for the lat/lon conversion. Then expose the skyline
> through `/api/sky` so the timeline uses terrain.

Useful checks along the way:

- The 80 m map gives about 1,282 m at the south pole itself (x = 0, y = 0)
  with the file on disk. Reading the same pixel from the bucket should match.
- The Phase 3 sunniest points (`data/phase-3/sites.csv`) list NASA's average
  sunlight at each point (`avg_sunlit`). A skyline-based sunlight % for those
  points should come out close to that number.
