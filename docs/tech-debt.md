# Tech debt

Known shortcuts and things to harden. Each entry: what's wrong, why it
matters, and what "fixed" looks like. Add new items at the top.

---

## ~~Tie the radio's power to contact time (Phase 5)~~

**Status:** done 2026-11-14 · area: `data/phase-4/assumptions.csv`
(`li_crew_avionics`, `li_crew_radio`), `lunarsky/power.py`
(`earth_contact`, "contact" load lines), `lunarsky/panels.py`,
`frontend/src/plan/powerSize.js`, `sunPower.js`, `powerPanel.js`,
`scripts/precompute_sun.py` (a `contact` layer in `data/sun/*.bin`)

The Earth transmitter is its own line, "Radio transmitting to Earth", 300 W,
and it runs only during direct contact: Earth above the 10 m antenna's
skyline while a DSN station can see the Moon. It comes out of the memo's
1.8 kW avionics line, which drops to 1.5 kW and keeps receive and short-range
radio. At a site in constant contact the total is the same as before;
elsewhere the kit gets a little lighter. The 300 W is our estimate (marked *,
editable 100–300 W): NASA's link trades (NASA/TM-2019-220203) use 10–100 W of
RF output, taken as about 3× that in DC draw.

Still open: `landing.json` kit masses were sized with the radio always on
(slightly cautious) until `precompute_landing.py` is rerun. Relay contact
doesn't count as transmit time.

---

## Phase 5 leftovers (lower priority)

**Status:** open · area: Phase 5 communications

- ~~**Storing data and power through blackouts.**~~ Done 2026-11-14.
  `data_backlog` in `lunarsky/power.py` (mirrored in `powerSize.js`) piles
  data up at 600 Gb/day and drains it at 110 Mbps during direct contact
  (NESC Artemis surface-comms baseline, `data_per_day` / `downlink_rate` in
  `assumptions.csv`). The largest pile is the "Data storage" tile in the
  Power panel. No extra battery: the radio line already draws for every
  contact hour, so sending the backlog only fills time it's already on.
- **Data rate (optional in the plan).** No rough data rate from Earth's
  distance and elevation. Fixed: a rate estimate per contact window, or drop
  it from the plan.
- **No "Phase 5 Acceptance" in the README.** Phases 1–3 each have one saying
  what was checked and against what. Fixed: a section listing the DSN and
  relay checks (e.g. against the Lunar Pathfinder service guide).

---

## ~~3D terrain for every landing target, not just #1 (Phase 6)~~

**Status:** done 2026-11-14 · area: `scripts/precompute_landing.py`,
`frontend/functions/data/`, `scripts/upload_terrain_r2.sh`

All 90 targets in `landing.json` have their own terrain mesh (~167 MB in
all). The meshes live in the R2 bucket `lunar-navigator-terrain`, not in git,
and Pages serves them through `frontend/functions/data/`. Every target shows
"Stand here in 3D".

---

## Panel search samples slope off the slope-map grid (Phase 6)

**Status:** open · area: `lunarsky/panels.py`
(`slope_deg`, the `check_path` walk)

### The problem

The panel search lays its own 20 m grid centered on the landing target and
estimates slope at each spot by blending (bilinear) heights 20 m either side.
That grid is offset from the 20 m map's pixels, so a single steep pixel that
falls between two spots can be smoothed under 20° and never flagged, both as
a panel spot and on the walking path.

In one run, 3 of 90 targets had 1–4 pixels over 20° (max 23°) in
their 200 m circle that the search didn't flag. A direct check found **none**
of the 90 chosen panel spots or paths on or across such a pixel, so no
result changed.

### What "fixed" looks like

Read slope straight from the slope map (`lunarsky.landing.slope_map`) for
the spot and for every pixel the path crosses, so the 20° check is exact.

---

## Slope overlay on the 3D terrain (Phase 6)

**Status:** open · area: `frontend/src/terrainMaterial.js`,
`frontend/src/scene3d.js`

### The problem

Phase 6 computes a slope map and picks landing targets, panel spots and
walking paths, but the 3D view doesn't show any of it. You can't see why a
target passed or failed.

### Why it matters

It's the clearest way to explain landing safety to judges, and it lets you
spot a better target by eye.

### What "fixed" looks like

The terrain is tinted by slope: green under 10°, yellow 10–20°, red above 20°.
On top of that: the 100 m ellipse, the 200 m panel circle, the chosen panel
spot and the walking path.

---

## Camera + coordinate system: make framing viewport-aware

**Status:** open · area: `frontend/src/scene3d.js`,
`frontend/src/main.js`

### The problem

The launch framing was hand-tuned when the 3D canvas was the *full*
viewport. Then the timeline/scrubber and the dockable HUD panels were added
on top of the canvas, covering the bottom strip and the sides. The camera was
never told about that, so the Moon is still framed for an empty screen and now
sits low / partly behind the timeline.

Concretely, today:

- `DEFAULT_LAUNCH_VIEW` (`scene3d.js:233`) is a fixed world-space pose
  (`position [12.5, 10.5, -14.2]`, target `[0,0,0]`). `applyLaunchView()`
  **snaps** to it — there is no animation.
- `keepPanelsAboveScrubber()` (`main.js:750`) repositions only the **DOM
  panels** above the scrubber. It never touches the camera, so the 3D framing
  and the UI layout are solved independently and disagree.
- The framing is correct at exactly one window size and gets worse as the
  window changes, because nothing recomputes it against the visible region.

### Why it matters

This blocks three things we want to build on a clean footing:

1. **Position-based launching** — fly/frame to an arbitrary lat/lon or camera
   pose and have the subject land in the *visible* area, not under the HUD.
2. **Site-based launching** — select one of the 9 sites and have the camera
   frame that site's marker consistently. `updateSiteMarker()` /
   `latLonToScene()` already place the marker; there is no matching "frame
   this marker nicely" step.
3. **Camera-based / intro launching** — the first-visit intro should be able
   to tween into the launch pose (see Phase 1 acceptance: intro + "Skip intro"
   from frame 1). Can't layer an animated intro cleanly on a pose that is
   itself mis-framed.

### What "fixed" looks like

- **One source of truth for the usable viewport.** A helper that returns the
  on-screen rectangle actually free of UI (viewport minus the scrubber floor
  and the docked panel widths). `scrubberFloor()` already computes the bottom
  edge; reuse it instead of a second measurement.
- **Viewport-aware framing.** Use `camera.setViewOffset()` (or a
  `controls.target` shift) so the subject renders centered in that usable
  rect, not the full canvas. Recompute on resize and when panels dock/undock.
- **A single framing primitive** the three launch modes all call:
  `frameMoon()`, a future `frameSite(lat, lon)`, and the intro should route
  through the same "given a target + distance, place the camera so it lands in
  the usable rect" function — not re-tune poses by hand.
- **Animated transitions optional but supported.** Tween position + target
  (ease-out, ~1.5–2s) in the existing `onFrame` loop; snapping stays the
  instant path (used by "Skip intro", which must work from frame 1).
- **Verify at multiple window sizes**, not just the laptop it was tuned on.

### Notes / current API worth building on

- `scene3d.js` exports: `frameMoon(distanceUnits)`, `applyLaunchView(view)`,
  `latLonToScene(lat, lon, radiusScale)`, `updateSiteMarker(lat, lon, name)`,
  `worldToScreen(worldPos)`, `getScreenSize()`, `getCameraDebug()`.
- OrbitControls orbit the Moon at origin (`target [0,0,0]`), damping on,
  min/max distance clamps set in `initScene()`.
- Related open decision: the 3D scene's ×12 elevation exaggeration
  (`TODO.md` "Revisit"). Settle framing before the Phase 2 panorama view so
  the 3D view and the panorama agree.
