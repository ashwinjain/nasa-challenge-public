# lunarsky: Phase 1 data loading and sky geometry

`lunarsky` is the glue between the data on this branch and a Phase 1 page.
Give it a site and a date range and it returns where the Sun and Earth are
in the site's sky, hour by hour, plus the Phase 1 metrics: sunlit %, longest
dark stretch, Earth-in-view %, longest blackout, and time to the next sunset
and Earthset.

It reads two things, both already in `data/`:

| Input | Path | What it is |
|---|---|---|
| SPICE kernels | `data/phase-1/*.bsp, *.bpc, *.tf, *.tpc` | Sun/Earth/Moon positions and the Moon's orientation, 1900–2050 ([details](../data/phase-1/README.md)) |
| Site list | `data/phase-3/sites.csv` | The 9 Artemis III sites with lat/lon ([details](../data/phase-3/README.md)) |

It does **not** need a database, a network connection, or Firebase.
Everything is computed from these files on the fly, in about a second per
site-month.

Checked against JPL Horizons (observer on the lunar surface): Sun and Earth
positions agree to 0.00001°. The Phase 1 target was 0.1°.

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

The kernels are in git. If `data/phase-1` is ever empty, `load_kernels()`
raises an error that includes the download command.

## Using it from Python

```python
from datetime import datetime, timezone
from lunarsky import load_kernels, load_sites, site_by_id, sky_track, phase1_metrics

k = load_kernels()                      # once at startup; ~1 s

sites = load_sites()                    # list[Site]; .id .name .lat .lon .avg_sunlit ...
site = site_by_id(sites, "artemis-ma")  # Malapert Massif

track = sky_track(k, site.lat, site.lon,
                  start=datetime(2027, 1, 1, tzinfo=timezone.utc),
                  days=30, step_hours=1.0)

metrics = phase1_metrics(track)         # dict of plain floats/bools/None, JSON-ready
payload = track.to_dict()               # per-sample lists for plotting
```

Custom coordinates skip the CSV: `sky_track(k, -89.5, 0.0, start, days=14)`.

### What `sky_track` returns

A `SkyTrack` with one entry per sample (30 days at 1 h = 721 samples):

| Field | Meaning |
|---|---|
| `times` / `utc_iso()` | the sample times |
| `sun_az`, `sun_el` | Sun azimuth (0 = north, 90 = east) and elevation above horizontal, degrees |
| `earth_az`, `earth_el` | same for Earth |
| `sun_dist_km`, `earth_dist_km` | distances, used for the disk sizes |
| `sunlit(horizon_deg, rule)` | boolean array: is any part of the Sun's disk above the horizon? |
| `earth_visible(horizon_deg, rule)` | boolean array: is any part of Earth's disk above the horizon? |
| `to_dict()` | all of the above as JSON-friendly lists |

`rule` is what counts as "up" for a disk: `"any"` (default, any part of the
disk; what NASA's Earth-visibility maps use), `"center"`, or `"full"`.

### What `phase1_metrics` returns

```json
{
  "site":    {"lat": -86.00114, "lon": 2.05502, "height_m": 0.0},
  "window":  {"start_utc": "2027-01-01T00:00:00Z", "end_utc": "2027-01-31T00:00:00Z",
              "hours": 720.0, "step_hours": 1.0, "samples": 721},
  "horizon": {"elevation_deg": 0.0, "disk_rule": "any", "terrain": false},
  "sun": {
    "sunlit_fraction": 0.581,  "sunlit_hours": 419.0,
    "longest_sunlit_hours": 400.0,  "longest_dark_hours": 289.0,
    "sunlit_at_start": true,
    "hours_to_next_set": 18.9,  "hours_to_next_rise": 307.1,
    "elevation_at_start_deg": 0.39,  "max_elevation_deg": 4.51,  "min_elevation_deg": -3.09
  },
  "earth": {
    "visible_fraction": 0.656,  "visible_hours": 473.0,
    "longest_visible_hours": 473.0,  "longest_blackout_hours": 146.0,
    "visible_at_start": false,
    "hours_to_next_set": 618.1,  "hours_to_next_rise": 145.2,
    "elevation_at_start_deg": -2.27,  "max_elevation_deg": 10.46,  "min_elevation_deg": -3.11
  }
}
```

`hours_to_next_set` / `hours_to_next_rise` are `null` when the event does
not happen inside the window (for example, Earth never sets on the near-side equator).
Run lengths are counted in whole samples, so they are good to about one
step. Rise and set times interpolate between samples, so they are better.

### Panel or mast height

`sky_track(..., height_m=10)` raises the observer. On a smooth Moon this
only lowers the horizon by a fraction of a degree
(`horizon_dip_deg(10)` ≈ 0.19°), so pass that as the horizon when you want
it counted: `phase1_metrics(track, horizon_deg=-horizon_dip_deg(10))`.
Height matters much more with terrain: near the pole, raising the eye
from 0 m to 2 m can add tens of points of sunlight, because it lifts the
eye over nearby bumps. `terrain_results` computes 0, 2, 10 and 20 m.

## Command line

```bash
.venv/bin/python -m lunarsky --list
```

```bash
.venv/bin/python -m lunarsky --site artemis-ma --start 2027-01-01 --days 30
```

```bash
.venv/bin/python -m lunarsky --latlon=-89.5,0 --start 2027-01-01T06:00 --days 14 --step 0.5 --json
```

Write `--latlon=-89.5,0` with the `=` so the minus sign is not read as an
option. Add `--track` to `--json` to include the per-sample arrays.

## Serving it to a web page

The plan calls for FastAPI plus a static page. A minimal API is about 20 lines:

```python
from datetime import datetime
from fastapi import FastAPI
from lunarsky import load_kernels, load_sites, sky_track, phase1_metrics

app = FastAPI()
K = load_kernels()
SITES = load_sites()

@app.get("/api/sites")
def sites():
    return [s.to_dict() for s in SITES]

@app.get("/api/sky")
def sky(lat: float, lon: float, start: datetime, days: float = 29.53, step_hours: float = 1.0):
    track = sky_track(K, lat, lon, start, days, step_hours)
    return {"metrics": phase1_metrics(track), "track": track.to_dict()}
```

For a static demo with no server, loop over `SITES` and a fixed date range,
write each result to a JSON file, and have the page fetch those.

## Tests and validation

```bash
.venv/bin/python -m pytest tests/
```

The tests are offline and cover the site list, equatorial day/night on
the near side, Earth never visible from the far side, the Sun grazing the horizon
at the south pole, and the metric helpers.

```bash
.venv/bin/python -m lunarsky.check_horizons
```

This one needs the network. It asks JPL Horizons for the same sites and
times and prints the worst disagreement.

## Limits

- **Terrain only near the south pole.** `terrain.py` builds skylines from
  LOLA maps (20 m within 10 km of the site, then 80 m and 240 m). North of
  ~60°S there's no map, so results use the smooth Moon. Against NASA's
  sunlight maps the terrain results are within 2.2 points on average
  (`docs/nasa-comparison.md`).
- **No boulders** or anything smaller than a map pixel.
- **One point per site.** The landing ellipse arrives in Phase 6.
- **Dates 1900 to 2049.** That is the span of the Moon orientation kernel.
- **No refraction, correctly.** The Moon has no atmosphere.

## Files

| File | What it does |
|---|---|
| `kernels.py` | loads the four kernels; builds a surface observer; `horizon_dip_deg` |
| `sites.py` | reads `sites.csv` and the Artemis GeoJSON |
| `sky.py` | `sky_track`: Sun and Earth az/el over time; disk rules |
| `metrics.py` | `phase1_metrics`, `terrain_results` and the run-length / crossing helpers |
| `terrain.py` | `compute_skyline`: a site's terrain skyline from the LOLA maps |
| `__main__.py` | the command line |
| `check_horizons.py` | validation against JPL Horizons |
