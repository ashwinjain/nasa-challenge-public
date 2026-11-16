# Phase 2 plan: real terrain

Phase 1 status, then what Phase 2 builds, which data
it uses, how to read that data, and how the results feed into the app.

## Where Phase 1 stands

From the acceptance list in the README:

| Item | Status |
|---|---|
| Sun/Earth positions match JPL Horizons within 0.1° | Done (0.00001°, 4 sites) |
| One year at 1-hour steps in a few seconds | Done |
| All 9 Artemis regions + custom coordinates (plus 17 more sites) | Done |
| Timeline and metrics from the same ephemeris | Done |
| 3D intro on first visit, "Skip intro" visible from frame 1 | Built (`playIntro` / `skipIntro` in `frontend/src/main.js`); box not ticked, needs a check |
| 30+ fps on a normal laptop | Not measured |

The "Current" section of `TODO.md` is done too: `frontend/public/data/` has
`sites.json` and sky JSON for all 26 sites, and the frontend reads them.
`TODO.md` is out of date (it still mentions CesiumJS; the scene is Three.js
now) and should be updated.

**To close Phase 1:** measure fps, check the intro, tick both boxes, update
`TODO.md`.

## What Phase 2 adds

Phase 1 treats the Moon as a smooth ball, so "sunlit" means "Sun above 0°".
At the south pole the Sun never rises more than about 1.5° above a flat
horizon (about 6° at 85°S), so a ridge, a crater rim or a mountain 100 km
away can block it. Phase 2 replaces the flat 0° horizon with each site's
real **skyline**: how high the terrain rises in every compass direction. The
Sun is up when it clears the skyline *at its own azimuth*. Earth works the
same way.

From the navigator plan, Phase 2 is done when the terrain results agree with
a published illumination value for a well-studied polar spot.

---

## The data

All four files are already in `data/phase-2/` (not in git, also in the
Firebase bucket). `lunarsky.data.open_raster` opens them from either place.

| File | What a pixel is | Grid | Covers | Used for |
|---|---|---|---|---|
| `LDEM_80S_80MPP_ADJ.TIF` | Height in meters (float32) | 7600 × 7600, 80 m | ±304 km from the pole (to ~80°S) | Nearby terrain |
| `LDEM_60S_240MPP_ADJ.TIF` | Height in meters (float32) | 7760 × 7760, 240 m | ±931 km from the pole (to ~59°S) | Distant mountains |
| `AVGVISIB_85S_060M_201608.TIF` | Average fraction of time sunlit (int16, scaled) | 5058 × 5058, 60 m | ±152 km (to ~85°S) | Checking our sunlight numbers |
| `AVGVISIB_85S_060M_201608_EARTH.TIF` | Average fraction of time Earth is visible (int16, scaled) | same | same | Checking our Earth numbers |

`data/phase-6/LDEM_80S_20MPP_ADJ.TIF` (2.7 GB, 20 m) is in use.
It's too big to load whole, so each skyline reads only a
±10 km window of it around the site. The 80 m and 240 m maps cover
everything beyond that.

### How to read it

All four maps use the same projection, checked from the files:

```
+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m
```

- **Projection.** South polar stereographic on a 1737.4 km sphere. The pole
  is at (x=0, y=0). X and Y are in meters *on the map*, not on the ground.
- **Map meters are not ground meters.** Stereographic stretches distances
  away from the pole (about 0.8% at 80°S, about 2.5% at 70°S). Use the map
  only to look up heights. Do all distance and angle math on the sphere.
- **Heights.** Each LDEM value is meters above or below the 1737.4 km
  reference sphere. A point's distance from the Moon's center is
  `1737400 + height`. Example: about 1,282 m at the pole itself.
- **No data.** LDEM uses NaN. AVGVISIB uses -32768. Treat both as missing.
- **AVGVISIB scaling.** Multiply raw values by the file's scale factor
  (`src.scales[0]`), as `data/phase-3/build_sites.py` already does, to get a
  0–1 fraction.
- **Coordinates match Phase 1.** The maps use MOON_ME, the same frame as the
  DE421 ephemeris setup. Site lat/lon go straight in; no frame shift needed.
- **Resolution limits.** LOLA measured along tracks and filled the gaps by
  interpolation, so real detail is coarser than the pixel size, more so
  farther from the pole. Boulders and features under ~80 m don't exist in
  this data.

Converting a site to map coordinates (needs `pyproj`):

```python
from pyproj import CRS, Transformer
moon_ll = CRS.from_proj4("+proj=longlat +R=1737400 +no_defs")
to_map = Transformer.from_crs(moon_ll, dem.crs, always_xy=True)
x, y = to_map.transform(lon, lat)   # note: lon first
```

### Which sites get terrain

18 of the 26 sites are covered: the 9 Artemis regions, IM-1, IM-2, Chang'e-7,
Blue Moon MK1, VIPER, Griffin-1, APEX-1 (75°S) and Chandrayaan-3 (69°S, at
the edge, see below). The Apollo sites, Chang'e-4/6 and IM-3 are too far
north. They keep the smooth-Moon result and the UI says so.

The 18 polar sites already carry NASA's average sunlight (`avg_sunlit` in
`data/phase-3/sites.csv`, read from the 60 m map). That gives a reference
value to check against for every Artemis site.

---

## The steps

### Step 1: Setup

- Add `pyproj` to the `maps` extra in `pyproject.toml`; `pip install -e ".[maps,dev]"`.
- Sanity check: open the 80 m map from disk and from the bucket and read
  about 1,282 m at (0, 0) both times.

### Step 2: Compute a skyline (`lunarsky/terrain.py`)

For one site and one observer height, produce `horizon[az]`: the terrain's
elevation angle in each compass direction, for example 720 values at 0.5°
steps.

How to compute it:

1. **Site height.** Look up the ground height at the site (bilinear
   interpolation). The observer sits at radius `r0 = R + h_site + h_obs`.
2. **Cast a ray in each azimuth.** Walk outward along the great circle from
   the site at that bearing (azimuth 0 = north, 90 = east, the same as
   `SkyTrack.sun_az`). At the pole, "north" is the direction toward lon 0;
   check this matches skyfield's convention there.
3. **Sample along the ray.** Start about 2 pixels out so the site's own
   pixel doesn't shadow itself. Use steps about one pixel long nearby and
   longer ones farther away (for example, grow the step by 1–2% each
   time). Each sample takes its height from the finest map that covers it:
   the 20 m window (±10 km), then the 80 m map, then the 240 m map.
4. **Elevation angle of each sample, curvature included.** For a sample at
   ground distance `d` (central angle `θ = d / R`) and height `h`, with
   `r = R + h`:

   ```
   elev = atan2(r·cos θ − r0, r·sin θ)
   ```

   This is exact on a sphere, so the drop from curvature is built in (about
   1.65° at 100 km).
5. **Keep the maximum** along each ray. That is `horizon[az]`.
6. **How far to go.** About 300 km covers it. Past that, curvature hides
   anything the Moon has. You can stop early once even the tallest point in
   the map couldn't beat the current maximum at that distance.
7. **Map edges.** If a ray leaves the 240 m map before 300 km (sites north
   of about 70°S), record the distance it reached and flag the skyline as
   partial. That affects Chandrayaan-3.

Cost: 720 rays × about 1,000 samples is under a million bilinear lookups,
well under a second with numpy once the maps are in memory.

Checks:
- A flat synthetic map gives a skyline of `-dip(h_obs)`, matching
  `horizon_dip_deg` in Phase 1.
- A single synthetic peak shows up at the right azimuth and angle.
- Known landmarks: from the Shackleton rim, Malapert Massif and the de
  Gerlache ridge should be the obvious bumps.

### Step 3: Several heights

Compute skylines at 0 m, 2 m, 10 m and 20 m (ground, solar panel, comms
mast, and the up-to-20 m masts NASA's Vertical Solar Array Technology
project is building).

**Reach on foot: 300 m.** Anything that moves equipment away from the
landing point, such as a "best power spot nearby" search, looks no farther
than 300 m. Artemis III planning allows EVAs out to about 2 km; 300 m is our
own, more conservative cap for carrying and cabling panels.

**Near-field terrain: keep it.** Rays keep starting
2 px out. Nearby terrain is the most consequential blocker, so skipping it
would hide real shadows. Panels set up away from the lander are handled by
a separate **panel-site search**. It looks at a ring around the landing
point, from 100 m out to 300 m. It computes a full skyline at each
candidate (about 0.05 s each) and picks the sunniest one at the chosen mast
height. 100 m is the default minimum and the user can change it. That
distance keeps the lander's own shadow down to roughly 1–2% lost sunlight
(a 10 m wide lander blocks about 6° of azimuth at 100 m). It also leaves a
work zone around the lander, and the ring still covers 89% of the full
circle. It doesn't protect against exhaust dust from a later landing: dust
travels farther than 300 m.

The ring is only 200 m wide, about 2.5 pixels on the 80 m map. That's why
every skyline now starts from the 20 m map (see Data); the panel search
gets it for free. Optional later: add the lander to each candidate's skyline as a block of
known height and width. The app shows both the landing point and the panel
site, plus the distance between them. Moving the landing point re-runs the
search.

**Built: `lunarsky/panels.py`.**

- **Picks.** It returns two picks: `most_sunlight` (highest sunlit %) and
  `shortest_night` (shortest longest-dark stretch, which sets battery
  size). Each has its distance and bearing from the lander, plus its gain
  over the landing spot. Earth visibility is reported for every spot but
  isn't ranked, because comms is a separate job from power.
- **How it scores.** It scores every 20 m grid point in the ring (~640
  spots) at 2 m height, over one year at hourly steps, against one shared
  Sun track.
- **Slope.** Slope is measured across 40 m of the 20 m map. Spots over 20°
  (NASA's EVA slope limit) stay in `candidates` with `too_steep: true` but
  aren't picked. No official slope limit exists for the panels themselves;
  Astrobotic's VOLT array rover levels itself with a gimbal and has been
  tested on 20° slopes.
- **Speed.** A search takes ~40 s (53 ms per skyline). A coarse 40 m pass
  refined around the leaders was 3× faster, but it was rejected: the
  longest night jumps from spot to spot, and at Mons Mouton it missed a
  166 h spot and landed on 224 h.
- **First results.** At Malapert the landing spot is already about as
  sunny as anything nearby (NASA picked these as the sunniest in each
  region). Even so, a spot 161 m north cuts the longest night from 278 h
  to 261 h. At Mons Mouton a spot about 240 m west cuts it from 233 h to
  166 h.

Raising the observer lowers the skyline, most of all for nearby terrain.
This is what makes mast height a design choice.

### Step 4: Use the skyline for sunlit and Earth-visible

`lunarsky/sky.py` already has the hook: `disk_margin_deg(el, radius,
horizon_deg, rule)` subtracts a horizon elevation. Today that's one number.
For terrain it becomes one number per time step:

```python
sun_horizon = np.interp(track.sun_az, skyline_az, skyline_el, period=360)
sunlit = track.sun_margin_deg(sun_horizon, rule) > 0
```

Same for Earth with `earth_az`.

Changes needed:
- `phase1_metrics` does `float(horizon_deg)` in its `"horizon"` block, so an
  array would break it. Add a terrain path: accept a skyline, compute the
  per-step horizon, and report `terrain: true`, the observer height and the
  skyline source instead of one elevation.
- Keep the disk rules as they are. A disk is about 0.5° (Sun) or 2° (Earth)
  wide, so using the skyline at the disk center's azimuth is close enough.
- Every metric (sunlit %, longest dark stretch, blackouts, time to sunset or
  Earthset) then picks up terrain automatically. Phase 1 numbers keep their
  meaning; only their accuracy improves.

### Step 5: Check against NASA

This is the "done when" for Phase 2.

1. For each of the 18 polar sites, run sunlight over a long window and
   compare to `avg_sunlit`. NASA's map averages hourly samples over 18.6
   years (the Moon's long cycle), so use the same span. That's about 163,000
   samples, a few seconds per site. Compare at **2 m** (see "Default eye
   height" below). NASA doesn't
   state the map's observer height. PGDA product 69 only says that "height
   above the surface" needs further analysis, so ground level is implied
   but not confirmed. The same sources don't say which DEM the 201608 maps
   used, or how the horizon was computed. Mazarico et al. 2011 used 240 m
   maps; the 201608 update is newer but unspecified. Our maps are Barker
   et al. 2023, so part of any gap may be a different DEM, not a bug.
2. Do the same for Earth visibility with the `_EARTH` map, sampled at each
   site's pixel.
3. Expect agreement within a few percentage points. Look harder at bigger
   gaps: 80 m vs 60 m pixels, the site sitting on a pixel edge, or a wrong
   azimuth convention (that error would show up as a consistent pattern).
4. A stricter check: Barker et al. 2021 gives illumination at 1 m and 5 m
   above ground for Jan 2024 – Jan 2026 at a few south-pole sites.
5. Write the comparison up as a table (site, NASA, ours smooth, ours
   terrain). It is also the clearest evidence for the presentation.

**Default eye height: 2 m.** Switching the nearby
terrain to the 20 m map made the 0 m results much darker. Gap to NASA,
sunlit %, 14 unique sites:

| Map, eye height | Mean gap | Mean size of gap | Worst |
|---|---|---|---|
| 80 m, 0 m | −3.3 | 3.9 | −13.1 |
| 80 m, 2 m | −1.1 | 1.8 | −5.7 |
| 20 m, 0 m | −17.4 | 17.6 | −39.2 (Mons Mouton) |
| 20 m, 2 m | −1.5 | 2.2 | −7.0 |
| 20 m, 10 m | +0.9 | 1.7 | +4.7 |

The cause: with 20 m pixels the first sample is 40 m away. A 2 m bump
there blocks ~3°, which is more than the polar Sun ever climbs. A 0 m eye
lies on the ground, so it mostly measures small bumps in the map. At 2 m
and up the bumps drop below eye level, and the two maps agree. No real
equipment sits at 0 m, so the app opens at 2 m. 0 m stays in the data,
labeled "ground level (sensitive to small bumps)".

Earth visibility moves too. At 2 m the 20 m map shifts it by −1.2 points
on average. Mons Mouton Plateau moves the most, from 74.6% to 68.2%,
which halves its gap to NASA (61.6%). At 2 m we're still a few points
sunnier than NASA's Earth map at Haworth and Nobile Rim 1 (about +6
each). At 0 m the 20 m map takes 4.5 points off Earth visibility on
average.

### Step 6: Precompute and ship

- `scripts/precompute_static.py` gets a terrain pass: per site, write the
  three skylines (720 floats each, a few KB) and sky JSON with both smooth
  and terrain results, so the toggle is instant with no backend.
- Put the skylines next to the existing sky data, for example
  `frontend/public/data/skyline/{site_id}.json`, and commit them. They're
  small. The maps stay out of git.
- **Custom coordinates (decision needed).** Computing a skyline live means
  the backend needs the maps. Two options:
  - Load both maps into memory when the Cloud Run instance starts (about
    400 MB as float32). Simple and fast after a slow cold start; needs
    about 1 GB of instance memory.
  - Read only the windows a ray needs, through `open_raster` from the
    bucket. Less memory, slower per request.

  Start with the first; it's less code.

### Step 7: Frontend

- **Panorama view.** Azimuth 0–360° across, elevation up. Draw the skyline
  as a filled silhouette with the Sun and Earth tracks over it. Places where
  a track dips under the silhouette are exactly when the terrain blocks it.
  This can extend `frontend/src/skyplot.js`.
- **Smooth vs terrain toggle.** Switches the timeline and metrics between
  the two results. This is the "why terrain matters" moment for the demo.
- **Height picker.** 2 m (default, `terrain.default_height_m`) / 10 m /
  20 m, plus 0 m labeled "ground level (sensitive to small bumps)".
- **Coverage label.** Non-polar sites show "smooth Moon: no terrain data
  here"; Chandrayaan-3 shows "partial skyline".
- The 3D scene's ×12 elevation exaggeration (in `TODO.md`) matters more now:
  decide it before the panorama goes in, so the 3D view and the panorama
  don't disagree.

### Step 8: Docs and limits

- README: a Phase 2 acceptance list; update the "Phase 1 uses a smooth Moon"
  line.
- `PRESENTATION-DETAILS.md`: replace "Phase 1 limitations" with the Phase 2
  limits: 20 m resolution near the site (80 m beyond 10 km), no boulders, sites above ~60°S get smooth Moon,
  a fixed observer height per skyline.
- `lunarsky/README.md`: document `terrain.py` and the skyline-aware metrics.

## Interfaces

What the new code looks like from the outside. Names are proposals.

### `lunarsky/terrain.py`

```python
@dataclass
class Skyline:
    lat: float
    lon: float
    heights_m: tuple[float, ...]   # (0, 2, 10)
    az_deg: np.ndarray             # (720,) 0, 0.5, … 359.5; 0 = north, 90 = east
    el_deg: np.ndarray             # (len(heights_m), 720) terrain elevation angle
    ground_m: float                # site height above the 1737.4 km sphere
    reach_km: np.ndarray           # (720,) how far each ray got (< max_km = partial)
    partial: bool                  # any ray left the maps early
    source: str                    # "LDEM 80m + 240m"

    def horizon_at(self, az_deg, height_m=0.0) -> np.ndarray: ...
        # skyline elevation at the given azimuths (wraps at 360)
    def to_dict(self) -> dict: ...
    @classmethod
    def from_dict(cls, d) -> "Skyline": ...

def load_dems(source=None) -> Dems: ...
    # opens both LDEM maps once (via data.open_raster) and keeps them in memory

def has_terrain(lat, lon) -> bool: ...
    # inside the 240 m map with room for the rays

def compute_skyline(lat, lon, heights_m=(0, 2, 10), n_az=720,
                    max_km=300, dems=None) -> Skyline: ...
```

### Changes to existing code

```python
# lunarsky/metrics.py
phase1_metrics(track, horizon_deg=0.0, rule="any",
               skyline=None, height_m=0.0) -> dict
#   skyline given → per-step horizon from skyline.horizon_at(track.sun_az / earth_az)
#   "horizon" block → {"terrain": True, "height_m": 2.0, "source": ..., "partial": ...}

# lunarsky/sky.py
SkyTrack.to_dict(..., skyline=None, height_m=0.0)   # sunlit / earth_visible use terrain
```

### API (`lunarsky/api.py`)

```
GET /api/sky?lat&lon&start&end&step_hours&terrain=true&height_m=2
    → same response as today; metrics.horizon.terrain = true
GET /api/skyline?lat&lon
    → Skyline.to_dict(), or 404 {"reason": "no terrain data north of ~60°S"}
GET /api/panel-site?lat&lon&start=2026-01-01&height_m=2&min_m=100&max_m=300
    → {landing, picks: {most_sunlight, shortest_night}, candidates, settings}
      ~40 s the first time per spot, then cached; 404 off the maps
```

### Static files (`scripts/precompute_static.py`)

```
frontend/public/data/skyline/{site_id}.json     # Skyline.to_dict(), a few KB
frontend/public/data/sky/{site_id}.json         # adds "terrain": {"0": {...}, "2": {...}, "10": {...}}
                                                #   (sunlit, earth_visible, metrics per height)
```

### Checks (`tests/test_terrain.py`, `scripts/validate_terrain.py`)

- Flat synthetic map → skyline equals `-horizon_dip_deg(h)`.
- One synthetic peak → right azimuth and angle.
- Map reads 1,282 m (±1) at the pole, from disk and from the bucket.
- `validate_terrain.py` writes the site / NASA / smooth / terrain table for
  the 18 polar sites over 18.6 years.

## Order and dependencies

```
1 setup → 2 skyline → 3 heights ─┬→ 4 metrics → 5 validate
                                 └→ 6 precompute → 7 frontend → 8 docs
```

Steps 2 and 5 carry the risk. Get one site's skyline right and check it
against `avg_sunlit` before building the rest. If the numbers are off, it's
almost always the azimuth convention, the curvature formula or the map
lookup, and it's cheaper to find that with one site than with 26.
