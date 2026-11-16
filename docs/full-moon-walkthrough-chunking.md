# Full Moon Walk-Through: Chunking Logic

A feature-idea thread, captured so we can return to it. The goal: let a user
walk the Moon's surface **anywhere** (not just the 17 precomputed polar sites)
by generating terrain **chunks** on demand when they click a new area.

This is a design note, not built yet.

---

## The idea in one line

Click a spot on the Moon → the backend crops a terrain **chunk** there from the
DEM, bakes it into geometry, and returns it → the frontend drops the mesh in and
you stand on it. The 17 precomputed site patches become just a **warm cache** of
that same operation.

---

## Where we are today (the starting point)

- **Surface view works** for the 17 polar sites (first-person, real sky, real
  shadows). See `docs/moon-surface-broken-down.md`.
- **Terrain is precomputed per site**, not on demand:
  `scripts/precompute_terrain.py` runs `build_patch(lat, lon, dems)` for each
  site and writes `frontend/public/data/terrain/<id>.bin` (baked scene-space
  vertex positions) + `index.json`. The patch is 24 km across, 160×160 grid
  (~150 m spacing), tapered to the sphere at the edge.
- **The frontend** loads `<id>.bin` in `enterSurfaceView(lat, lon, siteId)`
  (`scene3d.js`), builds a `BufferGeometry`, and lights it with a dedicated
  shadow-casting sun.

The key realization: **`build_patch()` already is the chunk generator.** It
takes an arbitrary lat/lon. Chunking = exposing it as a backend route and
calling it from a click instead of only at build time.

---

## What data we actually have (the hard limit)

Terrain data is **south-polar only** — there is no whole-Moon DEM in the project.

| Map | Resolution | Coverage | Size |
|---|---|---|---|
| `LDEM_80S_80MPP_ADJ.TIF` | 80 m/px | ~80–90°S | ~190 MB |
| `LDEM_60S_240MPP_ADJ.TIF` | 240 m/px | ~59–90°S | ~219 MB |

So "full Moon walk-through" has two phases:

1. **South polar cap (below ~59°S):** we have the data. Chunking works here
   today with no new downloads. This covers every mission-relevant site.
2. **The rest of the Moon (equator, far side, north):** needs a **global DEM**
   (NASA LOLA/SLDEM — e.g. a 118 m global, or SLDEM2015). Downloadable, large,
   and would need the same bucket + chunk pipeline. Separate step.

Note: the orbital globe's bumpy look is a **cosmetic normal map**
(`moon_normal_4k.png`), not geometry — making the *orbital* globe show real
elevation everywhere is a different, bigger effort.

---

## Infra: why this fits what we already deploy

The deploy is two pieces (see `docs/deploy.md`):

- **Firebase Hosting** — static frontend + all precomputed `.bin`/JSON.
- **Cloud Run** — the FastAPI backend (`lunarsky/api.py`), routes under
  `/api/**`, which Hosting rewrites to the Cloud Run service.

### Why Cloud Run and not Cloud Functions

Settled in this thread:

- **2nd-gen Cloud Functions *run on* Cloud Run under the hood.** "Use Functions
  instead" isn't a lighter runtime — it's the same thing with a thinner wrapper
  and less control.
- The backend is a **container with native geospatial deps** (`rasterio`/GDAL,
  the `Dockerfile` even pins the system `libexpat`) plus SPICE kernels. Your own
  Docker image (Cloud Run) is the clean way to do that; a Functions buildpack
  fights it.
- It's a **multi-route FastAPI app**, not one handler → one Cloud Run service is
  natural.
- Needs **2 GiB memory + long timeouts** (terrain ~790 MB peak; panel search
  ~2 min). Cloud Run handles it; Functions would have no upside.
- **Scales to zero** like Functions — same idle cost.

**Conclusion:** chunking needs **zero new infra.** It's a new route on the
existing Cloud Run service, which already reads the big maps from the bucket.

---

## Proposed chunking flow

```
user clicks a spot (lat, lon)
      │
      ▼
frontend: is there a precomputed/cached chunk for this tile?
      │ yes → fetch the .bin from Hosting/bucket (instant)
      │ no  ↓
      ▼
GET /api/terrain?lat=..&lon=..   (Cloud Run)
      │  • load_dems() reads the DEM from the Firebase Storage bucket
      │  • build_patch(lat, lon, dems) → baked scene-space positions
      │  • (optional) write the .bin back to the bucket as a cache
      ▼
returns the .bin  →  frontend builds the mesh, drops you on it
```

- **The endpoint is `build_patch()` verbatim.** `scripts/precompute_terrain.py`
  and the route share one function — the script just calls it ahead of time.
- **Precomputed sites = warm cache.** Same bytes, generated early.

---

## The real design questions (not infra — latency, coverage, caching)

1. **Cold-start latency.** Cloud Run scales to zero, and the *first* terrain
   request reads a ~190 MB DEM from the bucket. A cold chunk could take several
   seconds. Options:
   - Accept the cold hit with a clear "generating terrain…" state.
   - Keep one instance warm (min-instances = 1) — costs money when idle.
   - Keep the DEM resident once loaded (`_get_dems()` already memoizes within an
     instance), so only the *first* chunk per instance is slow.

2. **Tile scheme.** Snap clicks to a fixed grid of tiles (e.g. a lat/lon or
   stereographic grid) so chunks are reusable and cacheable, instead of a unique
   patch per exact click. Decide tile size (reuse the 24 km patch?) and overlap
   so neighbouring chunks seam cleanly.

3. **Caching generated chunks.** Write each generated `.bin` back to the bucket
   (or Hosting) keyed by tile id, so the *second* visitor to a tile gets it
   instantly. Turns the backend into a lazy, self-populating cache.

4. **Continuous roam vs. teleport.** Today you jump to a site and look around.
   "Walk-through" implies moving across tiles — which needs **loading adjacent
   chunks** as you approach an edge, and **LOD** (coarse far, fine near) so the
   whole visible area isn't one giant mesh. The 80 m map alone is ~58 M samples;
   you cannot load it whole.

5. **Coverage UX.** Outside DEM coverage there's no terrain. Decide the
   behaviour: block the click, show smooth sphere, or (later) fall back to a
   global DEM chunk.

6. **Seams with the background sphere.** Patches currently taper to the sphere
   at the edge. For continuous roam, adjacent chunks must taper to *each other*,
   not to 0, or share an edge — otherwise visible cracks/cliffs.

---

## Rough phasing (if we build it)

1. **On-demand chunk endpoint** — `GET /api/terrain`, wraps `build_patch()`,
   reads the bucket DEM. Click anywhere in the polar cap → generate + stand on
   it. Precomputed sites stay as the warm cache. (Smallest useful step.)
2. **Bucket cache** — write generated chunks back, keyed by tile id.
3. **Tiling + adjacency** — snap to a tile grid, load neighbours, taper chunks
   to each other for continuous walking.
4. **LOD** — coarse distant tiles, fine near tiles, so a wide area is affordable.
5. **Global DEM** — download LOLA/SLDEM into the bucket to extend chunking (and
   the orbital globe) beyond the south pole.

---

## Open decisions to make next time

- Tile size + grid (reuse 24 km / 160² patch, or go bigger/coarser for roam?).
- Cold-start policy (accept it / min-instances / warm the DEM).
- Cache location (bucket vs. Hosting) and invalidation.
- Do we want continuous walking, or is click-to-teleport-and-look enough?
- When (if) to pull in a global DEM for the rest of the Moon.

---

## Pointers

- `scripts/precompute_terrain.py` — `build_patch()`, the chunk generator.
- `lunarsky/terrain.py` — DEM loading/sampling (`load_dems`, `Dems.sample`,
  `_local_axes`, `_project`), reads from disk or the bucket.
- `lunarsky/data.py` — `open_raster`, the local-or-bucket reader.
- `lunarsky/api.py` — where a `/api/terrain` route would live.
- `frontend/src/scene3d.js` — `enterSurfaceView`, `loadTerrain`, the surface sun.
- `docs/moon-surface-broken-down.md` — the three-dataset mental model.
- `docs/deploy.md` — Hosting + Cloud Run layout.
