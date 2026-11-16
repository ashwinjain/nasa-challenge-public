# Lunar Landing Site Navigator

Sun and Earth visibility from any point on the Moon — built for the NASA Space Apps Challenge 2026.

Pick one of the nine Artemis III candidate regions or enter custom coordinates, choose
a date range, and see:
- **3D scene**: Three.js Moon globe, camera flies to your site
- **Timeline**: when the site is sunlit, when Earth is in view, and when both overlap
- **Metrics**: sunlit %, longest dark stretch, Earth-in-view %, longest comm blackout, time to the next sunset and Earthset
- **Plan & compare**: rank the nine regions for one landing date, find a site's best landing dates in any year from 2026 to 2035, and compare up to four stays side by side
- **Where to land?**: each region's safe landing targets, where the solar
  panels go (within 200 m, on a 10 m mast), and the power kit (solar array +
  battery) a year-round crewed base has to land

Near the south pole the app uses real terrain: each site gets a skyline
from NASA's LOLA elevation maps, and the Sun or Earth is up only when it
clears that skyline. Over the nine Artemis regions our sunlight is within
2.0 percentage points of NASA's own maps on average, versus 19.7 points for
a smooth Moon ([comparison](docs/nasa-comparison.md)). North of 60°S the
Moon is treated as smooth.

**Hosting:** the page and the chat run on Cloudflare Pages; the Python API
(`lunarsky/api.py`) runs in a Cloudflare Container (`api-worker/`), with the
older Cloud Run service as a fallback. `docs/deploy.md` covers the original
Firebase + Cloud Run setup.

## Quick Start

**Prerequisites:** Python 3.10+, Node.js 18+, npm

```bash
git clone https://github.com/ashwinjain/nasa-challenge.git
cd nasa-challenge

# One-shot setup: Python venv + deps, checks the kernel files, installs frontend deps
make setup

# Start the dev servers (backend on :8000, frontend on :5173)
make dev
```

Then open http://localhost:5173

The ephemeris data is already in the repo (`data/phase-1`, ~19 MB), so
setup needs no downloads beyond pip and npm packages.

## Manual Setup (if `make` isn't available)

```bash
# Backend
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
python scripts/download_ephemeris.py   # only verifies; downloads kernels if missing

# Frontend
cd frontend && npm install && cd ..

# Run
.venv/bin/uvicorn lunarsky.api:app --reload --port 8000 &
cd frontend && npm run dev
```

## Commands

| Command | What it does |
|---|---|
| `make setup` | One-shot install (Python + Node; verifies the kernel files) |
| `make dev` | Start both servers for development |
| `make test` | Run the test suite |
| `make check-bucket` | Read a few elevation-map tiles from the Firebase Storage bucket and compare with `data/` (needs a gcloud login) |
| `make precompute` | Precompute the 9 Artemis III sites (default month) to `frontend/public/data/` |
| `make precompute-landing` | Phase 6: landing targets, panel spots, power and contact for the 9 Artemis regions (~30 min; needs the 20 m map in `data/phase-6/`) |
| `make clean` | Remove venv and node_modules |
| `python -m lunarsky --site artemis-ma --start 2027-01-01 --days 30` | Sky metrics for a site from the terminal |
| `python -m lunarsky.check_horizons` | Compare against JPL Horizons (needs network) |

## How the pieces fit

```
data/phase-1/   SPICE kernels: where the Sun, Earth and Moon are, and which way the Moon faces
data/phase-3/   sites.csv: the 9 Artemis III sites with lat/lon
      │
      ▼
lunarsky/       reads the kernels + site list → Sun/Earth az/el at a site → Phase 1 metrics
      │
      ▼
lunarsky/api.py FastAPI: /api/sites and /api/sky for custom sites and dates
      │
      ▼
frontend/       Vite + Three.js + D3: 3D scene, timeline, metrics strip
```

## Project Structure

```
data/
  phase-1/           SPICE kernels (DE421 + Moon orientation), see its README
  phase-2/           README for the LOLA terrain maps (not in git, ~450 MB)
  phase-3/           sites.csv (9 Artemis III sites), region outlines, build script
  phase-4/           Needs-vs-supply assumptions
  phase-6/           20 m LOLA map (not in git, 2.7 GB) and landing_targets.json (Phase 6 results)
lunarsky/            Phase 1 engine: kernel loader, site list, sky tracks, metrics, CLI
  api.py             FastAPI: /api/sky, /api/skyline, /api/power, /api/panel-site
frontend/            Vite + Three.js + D3
  src/main.js        3D scene, intro sequence, data fetching, metrics strip
  src/timeline.js    Sunlit / visible / both timeline bars (D3)
scripts/             Setup helpers
tests/               pytest suite (API, ephemeris, lunarsky)
docs/                Plans and specs
```

## API

| Endpoint | Returns |
|---|---|
The page loads the 9 Artemis III sites for the default month (Jan 2026, when the crewed mission lands) from
static files in `frontend/public/data/`. Custom coordinates and other dates
go to the API (`lunarsky/api.py`), which returns the same shape.

| Endpoint | Returns |
|---|---|
| `GET /api/sites` | The 9 sites: `id`, `name`, `group`, `kind`, `lat`, `lon`, `avg_sunlit`. Optional `?kind=artemis_region` filter. |
| `GET /api/sky?lat&lon&start&end&step_hours&site_name` | Per-sample `times_utc`, `sun_az`, `sun_el`, `earth_az`, `earth_el`, `sunlit`, `earth_visible`, plus `metrics` (the `phase1_metrics` dict: `metrics.sun.*`, `metrics.earth.*`, see `lunarsky/README.md`). |
| `GET /api/skyline?lat&lon` | The terrain skyline around a point (elevation angle in every direction, at each eye height). 404 north of 60°S. |
| `GET /api/panel-site?lat&lon&start&height_m&min_m&max_m` | Best spots for solar panels within walking distance (at most 300 m) of a landing spot, scored over one year. ~40 s the first time for a spot. |
| `GET /api/health` | `{"ok": true}` |

`sunlit` and `earth_visible` count any part of the disk above the smooth
horizon. Add `terrain=true` to `/api/sky` for a `terrain` block with the
same results against the real skyline at each eye height (0, 2, 10 and
20 m). Dates must fall between 1900 and 2049 (the span of the Moon
orientation kernel); a window can be up to 366 days.

## Stack

- **Compute:** Python, skyfield + DE421 + JPL's DE421 lunar orientation kernel (`lunarsky/`)
- **API:** FastAPI + uvicorn
- **3D:** Three.js (Moon globe, plus real-terrain patches for the surface view at polar sites)
- **Charts:** D3.js
- **Build:** Vite

## Phase 1 Acceptance

- [x] Sun and Earth positions match JPL Horizons within ~0.1° (measured: 0.00001°, 4 sites, `python -m lunarsky.check_horizons`)
- [x] One year at 1-hour steps computes in under a few seconds
- [x] All 9 Artemis regions selectable + custom coordinates
- [x] Timeline and metrics driven by the same ephemeris source
- [x] 3D intro plays on first visit; "Skip intro" visible from frame 1
- [x] 30+ fps on a normal laptop

## Phase 2 Acceptance

- [x] Terrain sunlight agrees with NASA's published maps (Mazarico et al. 2011): mean gap 2.0 points, worst 7.0 (Mons Mouton Plateau), over the 9 Artemis regions at 2 m eye height, versus 19.7 points for a smooth Moon (`scripts/validate_terrain.py`, [comparison](docs/nasa-comparison.md))
- [x] Earth visibility checked against NASA's Earth map at the 7 regions it covers: ours runs 3.4 points high on average
- [x] Skylines at 0, 2, 10 and 20 m eye heights, from 20 m LOLA detail within 10 km of the site, then 80 m and 240 m maps out to 60°S
- [x] The terrain skyline drives the timeline, metrics and sky plot (a person at 2 m; Earth contact at the 10 m antenna)
- [x] Skylines, solar panel picks and surface-view terrain precomputed for the listed polar sites; any other point south of 60°S computed live by the API
- [x] Solar panel search: every 20 m spot within 200 m of a landing target (300 m reach minus the 100 m landing zone), marked on the ground in the surface view
- [x] First-person surface view on real terrain, with the Sun and Earth at their true elevations (no exaggeration)
- [x] Terrain and panel tests pass (`pytest tests/test_terrain.py tests/test_panels.py`: 25 passed)

## Phase 3 Acceptance

- [x] "Pick a date → where?": all 9 Artemis III sites ranked for one stay (1–60 days), sortable by sunlit %, longest dark, Earth in view % or longest blackout
- [x] "Pick a site → when?": a site's score for every landing day of a year, with its best dates marked, for any year 2026–2035
- [x] Compare: up to 4 stays (any site, any dates) side by side
- [x] The 9 Artemis III candidate regions
- [x] Opens inside the main app ("Plan & compare"), sharing the selected site with the 3D view; the view and its pins are a shareable link
- [x] Hourly up/down runs for 2026–2035 precomputed from the 2 m terrain skylines (`scripts/precompute_windows.py`, 724 KB), so the views need no server
- [x] Window tests pass (`pytest tests/test_windows.py`: 4 passed)

Limits:
- **One point per site, 2 m eye height.** A spot a few hundred meters away can score differently.
- **Geometry only.** The scores say how much Sun and Earth a stay gets, not whether that's enough for a mission. Phase 4 (Power & landing panel) starts to answer that.

## Phase 6 Acceptance

- [x] Slope map from the 20 m LOLA map checked against real landings: IM-1 (tipped over) measures 13.2° at its spot, against ~12° reported. IM-2 (tipped over in a crater smaller than a pixel) looks flat (3°): the known 20 m limit
- [x] Landing targets for all 9 Artemis regions: at least 95% of a 100 m landing zone under 10°, shortlisted by NASA's sunlight map, 10 per region at least 500 m apart (`lunarsky/landing.py`)
- [x] Panel spot for every target: every 20 m spot within 200 m (so at most 300 m from any touchdown point), under 20°, with a straight walking path under 20° (`find_panel_site(..., check_path=True)`)
- [x] Each target sized with the Phase 4 power model (long-term crewed base, 2026) and ranked by kit weight (solar array + battery only; air, water and food are left out because crew and stay are fixed, so they weigh the same at every site); panels on a 10 m mast; ranking by kit weight rather than NASA's average sunlight saves mass in 8 of 9 regions, up to 9.3 t (de Gerlache Rim 2), though only ~0.1 t in three of them
- [x] Every walkable panel spot sized, not just the sunniest and shortest-night picks: a third pick, **lightest kit**, can beat both (`find_panel_site(..., size_for="crew_long")`)
- [x] Earth contact from ~21 touchdown points across each landing zone, direct (DSN) and with relays (still through the DSN, so ~98%, not 100%), reported as worst-to-best
- [x] Plan & compare → **Where to land?**: region map, ranked targets, landing zone and panel spot; **Stand here in 3D** for every target
- [x] Precomputed, so the view needs no server (`scripts/precompute_landing.py`, `frontend/public/data/landing.json`, 50 KB)
- [x] Landing and panel tests pass (`pytest tests/test_landing.py tests/test_panels.py`: 16 passed)

Limits:
- **20 m pixels.** Small craters and boulders are invisible (IM-2), so a landing zone can be rougher than the map says.
- **One mission, one year.** Kit weights are for the crewed mission's year-round base over 2026; the view doesn't follow the year picker or Customize.
- **Shortlist.** Targets are pre-ranked by NASA's average sunlight before the full calculation, so a target with a shorter night but lower average could be missed.
- **3D meshes.** Each of the 90 targets has its own ~2 MB terrain mesh, served from R2 on the live site (`frontend/functions/data/terrain/`).
- Details and results: [navigator-plan.md, Phase 6](docs/space-apps/navigator-plan.md).

## Use of AI (Super Intelligence) tools

- Much of the code (frontend, API worker, Python `lunarsky` package, scripts) was written with help from an AI coding assistant (Claude). We directed, reviewed and tested it.
- The in-app chat uses a Cloudflare Workers AI model (`frontend/functions/api/chat.js`). The Moon calculations it reports run in our own deterministic code, not the model.
- AI also helped with documentation.
- No NASA logos, flags or mission identifiers were generated or modified by AI.
