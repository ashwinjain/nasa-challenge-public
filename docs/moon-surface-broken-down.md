# Moon surface, broken down

A mental model for Phase 2. There are **three independent datasets**, and
only one step couples any of them. Keeping them separate keeps the work
separable: each can be built, tested, and rendered on its own.


---

## 1. Terrain — the actual floor

**What it is:** ground height, and nothing else. Each pixel of the LDEM
elevation maps is meters above/below the 1737.4 km reference sphere. This is
the literal surface you'd stand on.

**Source:** `LDEM_80S_80MPP_ADJ.TIF` (80 m, nearby) +
`LDEM_60S_240MPP_ADJ.TIF` (240 m, distant). PGDA product 90, MOON_ME/DE421
frame.

**Standalone.** Knows nothing about the Sun, Earth, or time. You can crop a
patch around a site and render the floor as a 3D heightfield with zero
ephemeris involved.

**In place today?** **The data is readable and the skyline (#3) is built from
it; the topology/mesh render is not.**
- ✅ Maps on disk (`data/phase-2/*.TIF`), `rasterio`+`pyproj` installed, and
  `open_raster` reads real heights: the pole (0,0) returns **1282.3 m** as
  expected. Projection confirmed `+proj=stere +lat_0=-90 +R=1737400`, grid
  7600×7600, float32. (See the build log below.)
- ✅ `lunarsky/terrain.py` reads these maps for the **horizon/skyline use**
  (`HeightMap`, `Dems`, `compute_skyline`). So the floor is queryable as
  heights and reduced to skylines — see #3.
- ✅ The **geometry use is built**: `scripts/precompute_terrain.py`
  bakes each site into a polar mesh, 720 spokes × 676 rings: 20 m cells
  underfoot, growing to ~2.6 km at 300 km. It reads the same maps, in the same
  finest-first order, as `compute_skyline` (20 m window → 80 m → 240 m), and
  its horizon matches the stored skylines to ≤ 0.1°.
- ✅ **Sunlight on that mesh** comes from each pixel's own skyline, not a
  shadow map (`frontend/src/terrainMaterial.js`): the shader walks toward the
  Sun's azimuth and lights the pixel by the fraction of the solar disk above
  that skyline. Same heights, formula and disk rule as the sunlight numbers;
  a Python port agrees with `compute_skyline` to ~0.1–0.2° on average.
- ✅ **Regolith photometry**: McEwen lunar-Lambert with a phase-dependent
  weight (bright with the Sun behind you, dark toward it), no glossy
  specular, and a ground-only exposure (`EXPOSURE`). `?sundebug` in the URL
  tints ground green (lit) / red (shadowed).
- The 3D globe's relief (`moon_normal_4k.png` normal map in `scene3d.js`) is
  still a **cosmetic lighting bump** on a smooth sphere — not LDEM, not real
  geometry.

### One dataset, two products

The LDEM heights are a single source of truth, read two different ways:

```
          ┌─ as a HORIZON  → skyline (#3) → illumination / "shading in the sun"  (physics)
LDEM heights ┤
          └─ as GEOMETRY   → displaced mesh → the terrain you see / render        (topology)
```

- **As a horizon** — reduce to a 1D skyline, compare to the Sun's elevation.
  A numeric yes/no over time. **✅ Built and validated** (`terrain.py`), see
  #3.
- **As geometry (topology)** — interpret the same heights as a displaced 3D
  mesh: real craters, ridges, and the horizon you'd actually see standing at
  a site. **✅ Built** (see above). The TIF carries
  *no image* — only shape.

### Rendering a surface view: three layers that stack

To "look like you're standing on the Moon," three independent layers compose
(they stack, they don't replace each other):

| Layer | Answers | Source | Today (surface view) |
|---|---|---|---|
| Color / albedo = *the image* (macro) | what the ground looks like, where | **LROC WAC South Pole Summer Mosaic**, registered per site | ✅ `<site>_albedo.bin`, baked per mesh vertex |
| Regolith grain (micro) | fine surface texture up close | tiled photo (luminance only) | ✅ real Apollo regolith, mirror-tiled |
| Normal map | fine bumps smaller than the mesh | the regolith photo's normal | ✅ sub-20 m relief, distance-faded |
| Height / geometry = *the shape* | where the ground rises/falls | **LDEM TIF** | ✅ polar mesh per site, 20/80/240 m |

- **Topology (geometry): done** — the surface mesh has real LDEM shape.
- **The image: done.** Two brightness layers compose: the **macro**
  layer is the real, geographically-registered **LROC WAC South Pole Summer
  Mosaic** (643 nm, 100 m, same polar-stereographic projection as the LDEMs),
  sampled per mesh vertex (`scripts/precompute_albedo.py` →
  `<site>_albedo.bin`) so real craters/ridges sit in the real places; the
  **micro** layer is a tiled regolith photo for close-up grain (hue discarded,
  luminance only). The *summer* mosaic composites each spot when it is best lit,
  so even permanently-dim polar terrain has usable imagery.
- Only brightness is modulated — the surface colour stays neutral Moon-grey —
  and the mosaic's own lighting is not used: our dynamic skyline shadows light
  the scene, so shadows stay correct as the Sun moves.

---

## 2. Sun / Earth — the sky

**What it is:** where the Sun and Earth are, and their azimuth/elevation from
a site over time.

**Source:** Phase 1 ephemeris — DE421 kernels (`data/phase-1/`), IAU 2009
Moon rotation with libration.

**Standalone.** Knows nothing about terrain. This is what Phase 1 already
produces.

**In place today?** **Yes.** This is done and validated against JPL Horizons
(Phase 1).

---

## 3. Skyline — still terrain, just reduced

**What it is:** the terrain floor collapsed from a 2D heightfield into a 1D
horizon profile — "from this point, how high does the floor rise in each of
720 compass directions," at observer (eye) heights 0 / 2 / 10 / 20 m.

**Source:** derived purely from dataset #1 (the LDEM maps). **No Sun needed.**
Same data as the floor, different shape.

**Standalone.** A pure-terrain product. Computed once per site via ray-casting
(see `docs/phase-2-plan.md`, Step 2).

**In place today?** **✅ Yes — built, tested, and validated against NASA.**
- `lunarsky/terrain.py` (`compute_skyline`): casts 720 rays, walks each great
  circle on the sphere, uses the exact curvature elevation formula
  `atan2(r·cosθ − r0, r·sinθ)`, keeps the max per azimuth. Azimuth 0=N/90=E,
  matching `SkyTrack.sun_az`. CRS is guarded. Reviewed — physics
  matches the plan.
- Wired into `lunarsky/sky.py` + `metrics.py`: pass a `skyline` and every
  metric counts the Sun/Earth as up only when it clears the terrain at its
  own azimuth.
- Precomputed to `frontend/public/data/skyline/*.json` (17 sites) and read by
  the frontend terrain view. The big maps stay out of git.
- **Validation** (`data/phase-2/terrain_validation.csv`, 16 sites vs NASA;
  re-run after the rebake): terrain cuts sunlit mean-abs-error from
  **19.9 pp** (smooth Moon) to **1.7 pp at 2 m** eye height (worst 5.7 pp,
  artemis-ma), vs 3.9 pp at 0 m. Earth ~2.5 pp. The Phase 2 "done when" is met,
  and the shipped mesh uses these same heights.

**Eye-height note (important for the demo):** the app's default eye height is
**2 m** (`DEFAULT_EYE_M`), *not* 0 m. At 0 m the eye lies on the terrain and
sub-pixel bumps block almost everything (18.5 pp error vs NASA). 2 m — roughly
a panel/instrument deck — best matches NASA's ground-level reference (~2 pp).
A deliberate, validated modeling choice; be ready to explain it.

**Open follow-ups:** (1) `apex-1` (−75°S, lon 132°, far-side flank) sits
outside the 80 m / 20 m polar maps, so both its skyline and its surface mesh
fall back to the **240 m** map — the one low-fidelity site. Its *sunlit* still
matches NASA to 0.6 pp; the gap is visual mesh detail, not physics. Its
Earth-visible = 0.000 is plausibly correct (Earth never clears the horizon
there), not an anomaly; `im-1` = 1.000 likewise (near-side, low latitude).
Both are outside the 85°S NASA Earth map, so there's no reference to confirm.
(2) Count reconciliation: 16 validated / 17 skyline JSONs / plan says 18.

---

## Where they couple

The three datasets meet at exactly **one** question: *is the Sun above the
terrain right now?*

```
illuminated?  =  Sun elevation (#2)  >  skyline at the Sun's azimuth (#3)
```

Earth visibility is the same comparison with Earth's azimuth/elevation. That
single comparison is the **only** place terrain and Sun touch. Everything
upstream of it — building the floor, reducing it to a skyline, computing Sun
positions — is independent.

NASA's reference maps (`AVGVISIB_85S_060M_*`) are pre-baked answers to this
coupled question (fraction of time sunlit / Earth-visible, at ground level,
averaged over 18.6 years). We never feed them into the model; they're the
answer key for validation — the Phase 2 "done when."

---

## Where it runs: precompute vs. backend vs. client

The raw LDEM maps are ~400 MB and never belong in git or in the browser as a
download. Where the terrain *work* happens depends on which sites:

- **The 26 predetermined sites → precomputed static. No backend.** Build the
  skylines (and any surface mesh / terrain products) once, offline on a
  laptop, from the local maps. Commit only the small outputs (skyline JSON a
  few KB each; a cropped mesh/heightmap per site if we render topology). The
  browser downloads a few KB per site. The big maps stay out of git. This
  covers the whole demo.
- **Custom coordinates (arbitrary lat/lon the user types) → needs compute
  next to the maps.** Two Cloud-Run-free-ish options plus the backend one:
  1. **Precompute only** — don't support live custom terrain at all
     (simplest; treat custom terrain as a stretch goal).
  2. **Client-side COG + `geotiff.js`** — store the maps as Cloud-Optimized
     GeoTIFFs on static hosting that honors HTTP range requests; the browser
     reads only the tiles around the point and runs the math in JS. **No
     Cloud Run.** (Caveat: PGDA TIFs may need a one-time `gdal_translate` to
     COG first; verify.)
  3. **Cloud Run `/api/skyline`** — server reads the bucket via `/vsicurl`
     and computes in the Python we're already writing. Costs a ~1 GB
     instance + cold starts.

**Decision:** precompute everything for the 26 curated sites first; custom-
coordinate live terrain is a stretch, and if we do it the COG+`geotiff.js`
route fits the Firebase-static setup best. (Pairs with the camera/coordinate
item in `docs/tech-debt.md`.)

## Provenance & build log

A running record of the exact files, where they live, and how they got there,
so this can be traced back later.

### Where things live

| Thing | Location | In git? | Notes |
|---|---|---|---|
| LDEM + AVGVISIB `.TIF` maps | **laptop** `data/phase-2/*.TIF` | No (`.gitignore`) | ~466 MB; also mirrored in the Firebase bucket for the Cloud Run path |
| The maps, bucket copy | Firebase Storage `nasa-challenge-a8b4a.firebasestorage.app` | n/a | read via `open_raster` `/vsicurl` when not on disk |
| Precomputed skyline JSON | **client** `frontend/public/data/skyline/{site_id}.json` | Yes | ✅ built, 17 sites |
| Terrain-aware sky JSON | **client** `frontend/public/data/sky/{site_id}.json` | Yes | ✅ extends existing sky data |
| Validation table | **laptop/git** `data/phase-2/terrain_validation.csv` | Yes | ✅ NASA vs smooth vs terrain, 16 sites |
| Per-site surface mesh heights | **client** `frontend/public/data/terrain/{site_id}.bin` + `index.json` | Yes | ✅ polar grid, ~1.9 MB each. Not raw Float32 — zigzag/delta/byte-plane encoded (`encode_heights`), decoded by `frontend/src/terrainFile.js`; Hosting Brotli-compresses on top |
| Per-site surface albedo | **client** `frontend/public/data/terrain/{site_id}_albedo.bin` | Yes | ✅ registered LROC WAC summer-mosaic brightness, 1 uint8/vertex (~475 KB each, 7.9 MB total), built by `scripts/precompute_albedo.py` |
| WAC South Pole Summer Mosaic | **laptop** `data/phase-2/WAC_ROI_SOUTH_SUMMER_100M.TIF` | No (`.gitignore`) | ~790 MB NASA/LROC source for the albedo bake; never shipped (only the baked bytes are) |

Rule of thumb: **big raw maps never reach the client or git** — only small
precomputed products do. The client gets the 26 sites; the bucket + Cloud Run
are only for live custom coordinates (see "Where it runs" above).

### Process log

- **deps installed.** `.venv/bin/pip install -e ".[maps]"` →
  `rasterio 1.5.2`, `pyproj 3.8.0`, `google-auth`, `requests`. Verified
  `from lunarsky.data import open_raster` imports.
- **maps downloaded.** `curl` from NASA Goddard PGDA into
  `data/phase-2/` (the exact URLs + SHA-256 are in
  `data/phase-2/README.md`): `LDEM_80S_80MPP_ADJ.TIF` (80 m, ~189 MB),
  `LDEM_60S_240MPP_ADJ.TIF` (240 m, ~219 MB),
  `AVGVISIB_85S_060M_201608.TIF` (~34 MB),
  `AVGVISIB_85S_060M_201608_EARTH.TIF` (~25 MB). SHA-256 of the 80 m map
  verified against `data/phase-2/README.md`.
- **sanity check passed.** `open_raster` reads the pole (0,0) at
  **1282.3 m** (expected ~1282). CRS `+proj=stere +lat_0=-90 +lat_ts=-90
  +lon_0=0 +R=1737400 +units=m`, grid 7600×7600, float32. The floor is now
  readable and trustworthy for skyline/topology work.
- **terrain built by a parallel agent (reviewed, accepted).**
  Discovered on a `git fetch` mid-session: a chain of commits
  (`ed6ab5f`…`36656b5`, on top of the Phase 1 close-out `d851de7`) added
  `lunarsky/terrain.py`, the `sky.py`/`metrics.py`/API integration, the 17
  precomputed `skyline/*.json`, the frontend terrain view + 26-site markers,
  and `terrain_validation.csv`. Reviewed here: physics correct, tests pass
  (20 passed, 1 skipped), validated to ~2.2 pp (sunlit, 2 m) / ~2.5 pp
  (Earth, 0 m) against NASA. `backup-pre-merge` holds the pre-merge tip.
- **topology render landed.** `scripts/precompute_terrain.py`
  rewritten to bake a **polar mesh** per site (720 spokes × ~676 geometric
  rings, 20 m cells underfoot → ~2.6 km at the 300 km horizon) instead of a
  flat grid patch. Heights read through the *same* `dems.sample` +
  `with_fine_window(20 m)` path as `compute_skyline`, so the rendered horizon
  is the terrain that decides sunlit. Output encoded by `encode_heights`
  (slope-tolerance rounding + zigzag/delta/byte-planes), decoded by
  `frontend/src/terrainFile.js`. Rendering: `frontend/src/scene3d.js`
  (`loadTerrain`, `standOnTerrain`) builds the mesh; `terrainMaterial.js`
  shades **per pixel** by marching that pixel's own skyline toward the Sun
  (real ~0.5° disk penumbra, lunar-Lambert/Lommel–Seeliger photometry) — true
  cast shadows to 300 km, no shadow map. Commit chain `abcc945` (mesh) →
  `cf53520` (lighting) → `38949ef` (lighter first load).
- **true-scale sky (in progress).** `scene3d.js` edit moving
  Earth to 384,400 km, the Sun to 1 AU, both at real radii, far plane 600,000,
  so from the surface they read as physically-honest distant specks (Earth
  ~1.9°, Sun ~0.53°). Uncommitted at time of writing.
- **rendered-mesh validation.** Re-ran `scripts/validate_terrain.py`
  against NASA AVGVISIB after the rebake (same heights the mesh uses) to
  confirm the shipped terrain still matches; see #3.
- **per-pixel imagery drape.** `scripts/precompute_wac_tiles.py`
  bakes a per-site 2048² **log-polar texture** (x = azimuth, y = log radius,
  20 m → 300 km) from the WAC summer mosaic — regional illumination flattened,
  PSRs kept dark without noise amplification, the sub-100 m near field faded to
  neutral (the regolith grain owns that scale). The fragment shader samples it
  per pixel with one closed-form uv mapping (no UV attributes), so the mosaic's
  full crater detail drapes the ground at every distance instead of being
  Gouraud-smoothed through mesh vertices; the per-vertex `aAlbedo` stays as the
  instant fallback while the ~600 KB tile streams. 17 tiles, ~11 MB. Verified
  in-browser at Mons Mouton / Nobile Rim 1.
- **surface lighting corrected (the big one).** The terrain's
  phase-dependent lunar-Lambert weight (McEwen fit) drove reflectance to plain
  Lambert when looking toward the Sun, which at a 1–6° polar Sun rendered the
  whole up-Sun hemisphere black and hid every texture/relief layer. Replaced
  with a fixed Lommel–Seeliger weight (L=0.8) for the terrain: regolith now
  stays bright at grazing light in all view directions (why the full Moon looks
  flat-bright). Also: crater relief shading from the real heights (band-passed
  high-frequency gradient of `uTerrainH`, exaggerated ~3×, so rims catch a
  grazing Sun without tilting whole hillsides dark), shadows lifted by an
  Earthshine/bounce fill (~7%) that is **gated by Sun elevation** (ungated it
  lit slopes through mountains and from below the horizon). Verified in-browser
  with screenshots: lit scenes, true blackouts (Jan 12 Nobile Rim 1 goes dark),
  and distant peaks staying sunlit during site blackout — the real
  "peaks of eternal light" effect, emerging from the per-pixel skyline march.
  Display-only changes; the validated metrics are precomputed and unaffected.
- **surface look: regolith grain + registered albedo.** Two steps.
  (a) `terrainMaterial.js` gained a tiled regolith detail layer (real Apollo 11
  AS11-40-5878 soil crop — reseau crosses/shadows inpainted, lighting
  flattened, mirror-tiled — hue discarded, luminance + normal only) and a dark-
  grey/exposure correction (regolith is albedo ~7–12 %, not sandy-bright).
  (b) **Registered real imagery:** downloaded the NASA LROC WAC South Pole
  Summer Mosaic (`WAC_ROI_SOUTH_SUMMER_100M`, 643 nm, 100 m, polar
  stereographic — identical projection to the LDEMs, 28786², ~790 MB,
  gitignored). `scripts/precompute_albedo.py` samples it per mesh vertex on the
  same polar grid, normalises each site to mid-grey, writes `<site>_albedo.bin`
  (uint8/vertex, 17 tiles, 7.9 MB). `scene3d.js` `loadTerrain` feeds it as the
  `aAlbedo` attribute; `terrainMaterial.js` blends the **macro** (real
  geography, right craters in the right places) with the **micro** regolith
  grain. The mosaic's own lighting is discarded — the dynamic skyline shadows
  light the scene, so shadows stay correct as the Sun moves.
- **per-pixel WAC drape + nadir cleanup.** Per-vertex albedo is
  crisp near the site but mesh-ring-soft in the mid/far field, so
  `scripts/precompute_wac_tiles.py` now bakes a 2048² **log-polar texture** per
  site from the same WAC mosaic (u = azimuth, v = log radius 20 m → 300 km);
  the fragment shader samples it per pixel with one closed-form uv — full
  100 m crater detail at every distance, 17 tiles ≈ 10 MB. Looking straight
  down initially showed radial streaks from four stacked causes, each fixed:
  relief exaggeration faded out underfoot; base normal taken from the DEM
  gradient instead of noisy mesh-spoke Gouraud normals; shadow march from the
  validated 2 m eye height (sub-resolution flipping); and an in-shader radius
  fade (deep log-polar mips bleed far-field rows into the nadir singularity —
  only fixable at sample time). The fade radius was then tuned by review:
  too-wide cuts (900 m, then 250 m) made the whole standing view fall back to
  synthetic grain, so the neutral patch is now only ~25–60 m around the
  landing point — below the mosaic's own 100 m/px resolution, where it has no
  real information anyway — and genuine WAC imagery covers everything beyond
  it. Verified in-browser at horizon and straight down.

- **south polar cap on the orbital globe.** The globe wore a
  single equirectangular wrap, which converges every texture column onto the
  pole: the one place this app cares about had ~1.33 km per texel of colour,
  ~2.67 km of relief, and a visible radial pinch at 90° S.
  `scripts/precompute_polar_cap.py` bakes a polar stereographic cap from the
  products already on disk — WAC mosaic for albedo, LDEM 60S for relief —
  reaching 72° S at 358 m/texel, and `moonMaterial.js` crossfades it in below
  73° S using the same closed-form projection as `lunarsky.terrain._project`,
  so no extra geometry and no seam. Three layers, each deliberate:
  **albedo** has the mosaic's illumination divided out at the scale of its own
  baked shadows (a few km) and its contrast cut to 45 %, because polar ground
  is uniform highland regolith and most of what survives at that scale is
  residual shading, not reflectance; **normals** come from LOLA, baked rather
  than differenced in-shader so they stay fine while the height stays small;
  **cast shadows** march the LOLA heights toward the live Sun, with the
  d²/2R term for the Moon curving away under the ray and a 0.25° penumbra.
  Draping the raw mosaic instead would have looked identical on a still frame
  and frozen every shadow where the Sun stood when it was taken — the one
  thing an app about changing illumination must not do. Verified in-browser:
  shadows redraw completely between Jan 1 (Sun 1.07°) and Jan 10 (Sun 2.69°),
  PSR floors stay black, no disc edge. ~6 MB, loaded lazily on the same
  magnification trigger as the full texture set, so the first paint is
  unchanged and the globe falls back to the plain wrap if it never arrives.
  Shadowed ground then carries the same 7% fill the surface view uses — light
  scattered off nearby sunlit slopes, plus faint Earthshine. Crushing it to
  zero was the *inaccurate* choice: polar crater floors are imaged precisely
  because they are not absolutely black. The fill is gated per pixel on the
  Sun being above that point's local horizon, since with nothing lit nearby
  there is nothing to scatter; ungated it behaves as a second Sun shining
  through mountains. The cap's edge stays a 3° feather and was deliberately
  not widened — a wider blend only spreads the transition over more ground
  without making any of it more correct.
- **Walking in surface view.** WASD or the arrow keys move you
  over the site's terrain patch (Shift sprints, R returns to the lander);
  `frontend/src/scene3d.js`, "Walking". Nothing new is loaded or computed:
  the eye follows the same baked heights the mesh is built from
  (`terrainHeightAlong`), and the shadows stay right because the terrain
  shader already works each pixel's sunlight from the heights, not from the
  site point. Three things to know:
  - **Bounds.** You can't leave the site's Artemis III region outline
    (`artemis_regions.geojson`); a low translucent wall marks it. A site with
    no outline (only reachable with `?sites=all`) gets a 2.3 km circle.
  - **Detail falls off.** The 20 m rings end 2.3 km from the lander and the
    regions are 16–67 km across, so the ground is smooth and blurry toward a
    far edge. Speeds are 25 m/s and 125 m/s sprinting, far above a real walk,
    because on a 20 m grid a real pace barely moves the ground.
  - **The Sky panel stays at the lander.** Its Sun/Earth tracks and skyline
    are the precomputed ones for the site point, so it is titled "Sky (from
    site origin)". Its view box still follows where you look: the site's
    north is carried along as you walk, so a heading means the same anywhere
    in the region. The sunlit/Earth numbers are likewise the lander's.

- **landing-zone boundary in surface view.** The Artemis region
  outline was drawn at 1.004 R, ~7 km up: fine from orbit, but from the ground
  it hung in the sky as a wireframe. It is now hidden on the surface and the
  boundary is draped on the real terrain instead, sampled with the same ground
  heights the markers use. Draping alone made it invisible, and that is
  geometry rather than a bug: the boundary is 10-33 km out while the horizon
  from eye height is ~6 km, so the band sits below it. It therefore also
  raises a red glow that fades out with height - anchored on the terrain, tall
  enough to clear a skyline that runs -4.2 to +2.2 deg, low enough to leave
  the sky the Sun and Earth tracks live in. Red because amber is Sun/power and
  cyan is Earth/comms in the panels.

- **horizon line in surface view.** With the Sun below the local
  skyline the ground and the sky are both near-black and the silhouette
  between them disappears, so you lose any sense of where the land ends. The
  surface view now traces it from `data/skyline/<site>.json` - the same
  elevation-per-azimuth curve the Sky panel plots and the illumination metrics
  are scored against - read at the 10 m eye height the surface camera uses, so
  the line sits on the real silhouette rather than near it. Drawn with depth
  testing off: it marks where terrain meets sky, so letting the mesh occlude it
  would hide it exactly where it is wanted. It is anchored at the site, so it
  is exact at the lander and drifts if you walk a few km from it.

## Summary

| # | Dataset | Is | Source | In place? |
|---|---|---|---|---|
| 1 | Terrain (floor) | ground height | LDEM 80 m + 240 m | ✅ readable as heights and rendered as a mesh |
| 2 | Sun / Earth (sky) | body az/el over time | DE421 ephemeris | ✅ Phase 1 |
| 3 | Skyline | floor → 1D horizon | derived from #1 | ✅ built, tested, validated to ~2 pp |
| — | Illumination | #2 vs #3 at matching azimuth | the coupling | ✅ wired into metrics/API, validated |

**What's left:** the physics path (floor → skyline → illumination → validate)
**and** the topology render (polar mesh + per-pixel skyline shading, standable
surface) are both **done and validated** — terrain accuracy is at the limit of
the source data (1.7 pp vs NASA at 2 m). The remaining items are polish, not
accuracy blockers:
1. ✅ **Albedo image layer — done.** Real registered LROC WAC
   summer-mosaic brightness (macro) + tiled regolith grain (micro). See the
   render-layers table and the process-log entry.
2. **`apex-1`** — only the 240 m map covers its *geometry*; needs a mid-latitude
   DEM for full mesh detail. Sunlit already matches NASA, and it now gets real
   registered albedo like every other site.
3. **Secondary light** — shadowed ground gets only a faint Earthshine floor;
   real lunar shadow also has inter-slope bounce. Minor.
4. **True-scale sky** — Earth/Sun at real size + distance in the surface view.
5. **Albedo resolution** — the mosaic is 100 m/px, so macro brightness is soft
   at extreme close-up; the regolith grain covers the micro scale. A higher-res
   source would sharpen the macro layer.
