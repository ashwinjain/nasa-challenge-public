// Three.js scene for the Lunar Landing Site Navigator.
// Replaces the previous CesiumJS scene. Exposes a small API that main.js drives.
//
// Conventions (scene units: 1 unit = 1000 km):
//   - Moon at the origin, radius 1.7374 units.
//   - North pole = +Y. Texture-registered: selenographic lon 0 faces +X,
//     lon +90°E faces -Z (matches the equirectangular colour map).
//   - Sun/Earth are placed around the Moon from the precomputed az/el data.
//   - TRUE SCALE: both body sizes AND distances are real (Earth at 384,400 km,
//     Sun at 1 AU), so angular sizes are honest (Earth ~1.9°, Sun ~0.53°). A
//     logarithmic depth buffer spans the ~2 m eye height to the 1 AU Sun.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { createMoonMaterial } from "./moonMaterial.js";
import { createTerrainMaterial } from "./terrainMaterial.js";
import { decodeTerrainHeights } from "./terrainFile.js";
import { EYE_HEIGHT_M } from "./shared/assumptions.js";

// ── Scale constants (1 unit = 1000 km) ──
export const MOON_RADIUS = 1.7374;        // 1,737.4 km (real)
export const EARTH_RADIUS = 6.371;        // 6,371 km (real, 3.67× Moon)
// TRUE SCALE (1 unit = 1000 km): real radii and real distances, so Earth and the
// Sun sit at their true size and separation in both the orbital and surface
// views. Earth is ~221 Moon-radii away and the Sun ~390× farther still, so from
// up close the Moon fills the view and they read as distant specks — physically
// honest. Earth subtends ~1.9° and the Sun ~0.53° from the Moon.
const SUN_VISUAL_RADIUS = 696;            // 696,000 km (true)
const EARTH_MOON_DIST = 384.4;            // 384,400 km (true mean distance)
const SUN_DIST = 149600;                  // 149,600,000 km = 1 AU (true)

let renderer, scene, camera, controls;
let moon, earth, earthGlow, sunMesh, sunLight, starfield;
let poleAxis = null, poleSprites = [];   // N/S axis + labels; fade out when zoomed in
let siteMarker = null, siteFlag = null;
let container;
// Container size, kept by onResize. The overlays project points every frame,
// and reading clientWidth there would force a layout each time.
let screenW = 0, screenH = 0;
let onFrameCallbacks = [];
const clock = new THREE.Clock();
let focusTween = null;                    // smooth fly-to when a site becomes the focus
let focusTarget = null;                   // the site we're in "site focus view" on, else null (orbital view)
const DEFAULT_MIN_DISTANCE = MOON_RADIUS * 1.3;
const FOCUS_EXIT_DIST = MOON_RADIUS * 3.0; // zoom out past this while focused → back to orbital view

const ASSET = (p) => `/textures/${p}`;

export function initScene(containerId) {
  container = document.getElementById(containerId);
  const w = container.clientWidth, h = container.clientHeight;
  screenW = w; screenH = h;

  // Logarithmic depth buffer: the scene spans from a ~1.8 m surface eye height
  // to stars thousands of units out, far too wide for a normal depth buffer.
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color("#05060c");

  camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 600000);
  camera.position.set(0, 10, 40);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.5;
  controls.target.set(0, 0, 0); // orbit around the Moon
  controls.minDistance = DEFAULT_MIN_DISTANCE;
  controls.maxDistance = SUN_DIST * 1.5;

  // Faint ambient so the Moon's dark side isn't pure black
  scene.add(new THREE.AmbientLight(0x222a38, 1.0));

  addStarfield();
  addBodies();

  window.addEventListener("resize", onResize);
  renderer.setAnimationLoop(render);
  return { scene, camera, renderer, controls };
}

function onResize() {
  const w = container.clientWidth, h = container.clientHeight;
  screenW = w; screenH = h;
  if (!w || !h) return;   // hidden or collapsed window: 0/0 would make the camera NaN
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// Fade the N/S pole axis + labels out as the camera moves in, so they don't
// clutter the view when zoomed into the surface. Fully shown when far, gone
// when close.
const POLE_FADE_NEAR = MOON_RADIUS * 3.5;  // fully hidden at/below this distance
const POLE_FADE_FAR = MOON_RADIUS * 6;     // fully shown at/above this distance
function updatePoleFade() {
  const dist = camera.position.length();
  const t = THREE.MathUtils.clamp((dist - POLE_FADE_NEAR) / (POLE_FADE_FAR - POLE_FADE_NEAR), 0, 1);
  if (poleAxis) {
    poleAxis.material.opacity = 0.4 * t;
    poleAxis.visible = t > 0;
  }
  for (const spr of poleSprites) {
    spr.material.opacity = 0.22 * t;
    spr.visible = t > 0;
  }
}

// ── Focus a site: re-target the orbit onto its surface point and fly in to a
// low, surface-skimming vantage so the user can spin around it. ──
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const _qIdentity = new THREE.Quaternion();

export function focusSite(lat, lon) {
  const P = latLonToScene(lat, lon, 1.0);
  const normal = P.clone().normalize();                       // local vertical at the site
  const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3().crossVectors(ref, normal).normalize(); // along the surface
  // Camera sits low and off to the side of the site: mostly tangential (for a
  // horizon-skimming angle) with a little lift, looking at the point.
  const camPos = P.clone()
    .add(normal.clone().multiplyScalar(MOON_RADIUS * 0.26))
    .add(tangent.clone().multiplyScalar(MOON_RADIUS * 0.58));
  controls.minDistance = MOON_RADIUS * 0.08;                  // allow getting right down to the surface
  // Make the site's local vertical the screen's "up" so the surface sits at the
  // bottom and space is overhead — like standing on the ground looking out.
  startFocusTween(P, camPos, normal.clone());
  focusTarget = P.clone();                                    // now in "site focus view"
}

// Reset the orbit back to the whole globe ("orbital view").
export function clearFocus() {
  if (!focusTarget && !focusTween) return;
  focusTarget = null;
  controls.minDistance = DEFAULT_MIN_DISTANCE;
  startFocusTween(
    new THREE.Vector3(0, 0, 0),
    camera.position.clone().setLength(MOON_RADIUS * 8),
    WORLD_UP.clone(),
  );
}

// While in site focus view, pulling the camera far enough back returns to the
// orbital (whole-globe) view on its own.
function checkFocusExit() {
  if (focusTarget && !focusTween && camera.position.length() > FOCUS_EXIT_DIST) {
    clearFocus();
  }
}

function startFocusTween(toTarget, toCam, toUp) {
  const fromUp = camera.up.clone().normalize();
  focusTween = {
    fromT: controls.target.clone(), toT: toTarget,
    fromC: camera.position.clone(), toC: toCam,
    fromUp, qUp: new THREE.Quaternion().setFromUnitVectors(fromUp, toUp), toUp,
    t: 0, dur: 0.75,
  };
}

// Keep OrbitControls' orbit frame aligned with the current up vector, so
// dragging rotates around the site's local vertical (not the Moon's pole).
function syncControlsUp() {
  if (controls._quat) {
    controls._quat.setFromUnitVectors(camera.up, WORLD_UP);
    controls._quatInverse.copy(controls._quat).invert();
  }
}

function updateFocusTween(dt) {
  if (!focusTween) return;
  focusTween.t = Math.min(1, focusTween.t + dt / focusTween.dur);
  const e = easeInOut(focusTween.t);
  controls.target.lerpVectors(focusTween.fromT, focusTween.toT, e);
  camera.position.lerpVectors(focusTween.fromC, focusTween.toC, e);
  // Rotate the up vector along the shortest arc (handles the ~180° pole case).
  const q = _qIdentity.clone().slerp(focusTween.qUp, e);
  camera.up.copy(focusTween.fromUp).applyQuaternion(q).normalize();
  syncControlsUp();
  if (focusTween.t >= 1) { camera.up.copy(focusTween.toUp); syncControlsUp(); focusTween = null; }
}

// ── Moon surface view: first-person, standing on the surface of a site ──
// The camera is pinned to the site's surface point; dragging looks around.
// The Sun, Earth and stars are the scene's real bodies, so they appear at the
// true positions for this site and sweep the sky as the time scrubber moves.
// (A smooth sphere has no terrain yet, so the horizon is a clean arc and there
// are no cast shadows — those come with the terrain pass.)
// { pos, east, north, up, yaw, pitch, … } when active, else null. east/north/up
// are the frame AT THE SITE and never change; least/lnorth/lup are the same
// frame carried to where you've walked (see placeWalker).
let surface = null;
let surfDrag = null;
let terrainIndex = null;  // { n_az, radii_m, sites:{id:{...}} } of precomputed meshes
let terrainMesh = null;   // the displaced terrain mesh currently shown
let surfaceSun = null;    // shadow-casting sun used only in surface view
let terrainToken = 0;     // guards against a late patch load after exit/switch
// Camera eye height above the ground in surface view: a person standing,
// 2 m (shared/assumptions.js EYE_HEIGHT_M, terrain.DEFAULT_EYE_M). It is the
// vantage point only; the power and Earth numbers are at the 10 m mast.
const SURFACE_EYE_M = EYE_HEIGHT_M;
let surfMarkerSpec = null;  // { lat, lon, ground_m, spots:[{id, lat, lon, ground_m, color}] }
let surfMarkerGroup = null; // lander ring, panel poles and paths, while shown
let surfMarkerAnchors = {}; // id → world point each label hangs from

export function setTerrainIndex(idx) { terrainIndex = idx; }
export function hasTerrain(siteId) { return !!(terrainIndex && terrainIndex.sites && terrainIndex.sites[siteId]); }

// Build the terrain mesh from its baked heights.
//
// The layout is a polar grid centered on the site (see
// scripts/precompute_terrain.py): the site point, then rings outward, each
// ring n_az heights from azimuth 0 (north) going east. Rings are 20 m apart
// underfoot and spread out with distance to 300 km, so the mesh is fine
// where you stand and coarse at the horizon, with no seams between levels.
//
// Vertices are stored relative to the site and the mesh is placed there:
// world coordinates are ~1.7 units, where float32 only resolves ~0.1 m,
// but offsets within 300 km keep centimetre precision on the GPU.
const R_M = 1737400;                         // reference sphere the heights are measured from
let terrainGrid = null;                      // { nAz, radii, h, up, north, east } for ground lookups
let terrainMat = null;                       // skyline-sun material of the current mesh
// ?sundebug in the URL tints the ground green (Sun up) / red (Sun hidden).
const SUN_DEBUG = new URLSearchParams(location.search).has("sundebug");

async function loadTerrain(siteId) {
  clearTerrain();
  if (!hasTerrain(siteId)) return;
  const token = ++terrainToken;
  let h;
  try {
    const res = await fetch(`/data/terrain/${siteId}.bin`);
    if (!res.ok) return;
    h = decodeTerrainHeights(await res.arrayBuffer());
  } catch { return; }
  if (!h) return;
  if (token !== terrainToken || !surface) return;     // exited or switched while loading

  const nAz = terrainIndex.n_az;
  const radii = terrainIndex.radii_m;
  const nR = radii.length;
  if (h.length !== 1 + nR * nAz) return;              // stale or mismatched file

  // Registered surface brightness: real NASA LROC WAC South Pole Summer Mosaic
  // sampled per vertex (see scripts/precompute_albedo.py). One byte per vertex,
  // same order as heights; 128 = the site's mean, so /128 gives a multiplier
  // around 1.0. Missing file -> flat (no tint), so older sites still render.
  let alb = null;
  try {
    const ar = await fetch(`/data/terrain/${siteId}_albedo.bin`);
    if (ar.ok) {
      const bytes = new Uint8Array(await ar.arrayBuffer());
      if (bytes.length === h.length) {
        alb = new Float32Array(h.length);
        for (let k = 0; k < h.length; k++) alb[k] = bytes[k] / 128;
      }
    }
  } catch { /* no albedo for this site */ }
  if (token !== terrainToken || !surface) return;     // exited or switched while loading
  if (!alb) alb = new Float32Array(h.length).fill(1.0);

  const { up, north, east } = surface;

  // Precompute each spoke's horizontal direction (scene space).
  const dx = new Float64Array(nAz), dy = new Float64Array(nAz), dz = new Float64Array(nAz);
  for (let j = 0; j < nAz; j++) {
    const az = (j / nAz) * Math.PI * 2;
    const c = Math.cos(az), s = Math.sin(az);
    dx[j] = north.x * c + east.x * s;
    dy[j] = north.y * c + east.y * s;
    dz[j] = north.z * c + east.z * s;
  }
  const r0 = (R_M + h[0]) / 1e6;                      // site point, scene units
  const ox = up.x * r0, oy = up.y * r0, oz = up.z * r0;
  const pos = new Float32Array(h.length * 3);         // vertex 0 is the site itself: (0,0,0)
  for (let i = 0; i < nR; i++) {
    const a = radii[i] / R_M;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < nAz; j++) {
      const k = 1 + i * nAz + j;
      const r = (R_M + h[k]) / 1e6;
      pos[k * 3] = (up.x * ca + dx[j] * sa) * r - ox;
      pos[k * 3 + 1] = (up.y * ca + dy[j] * sa) * r - oy;
      pos[k * 3 + 2] = (up.z * ca + dz[j] * sa) * r - oz;
    }
  }

  // Azimuth increases clockwise seen from above, so these orders wind CCW
  // and the normals point up out of the ground (FrontSide stays visible).
  const idx = new Uint32Array((nAz + (nR - 1) * nAz * 2) * 3);
  let t = 0;
  for (let j = 0; j < nAz; j++) {                     // fan around the site point
    const jn = (j + 1) % nAz;
    idx[t++] = 0; idx[t++] = 1 + jn; idx[t++] = 1 + j;
  }
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < nAz; j++) {
      const jn = (j + 1) % nAz;
      const A = 1 + i * nAz + j, B = 1 + i * nAz + jn;
      const C = A + nAz, D = B + nAz;
      idx[t++] = A; idx[t++] = B; idx[t++] = C;
      idx[t++] = B; idx[t++] = D; idx[t++] = C;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aHeight", new THREE.BufferAttribute(h, 1));   // m above the sphere, for the sun test
  geo.setAttribute("aAlbedo", new THREE.BufferAttribute(alb, 1)); // registered WAC brightness, ~1.0 = site mean
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  // Sunlight per pixel from its own skyline (see terrainMaterial.js), so no
  // shadow map: shadows reach the full 300 km and match the sunlight numbers.
  const info = terrainIndex.sites[siteId];
  terrainMat = createTerrainMaterial({
    heights: h, nAz, radii, siteUp: up, siteNorth: north, siteEast: east,
    siteR: R_M + h[0], hMax: info.h_max, renderer, debug: SUN_DEBUG,
    wacUrl: `/data/terrain/${siteId}_wac.jpg`,   // per-pixel registered imagery
  });
  terrainMat.setSunDir(sunMesh.position);
  terrainMesh = new THREE.Mesh(geo, terrainMat.material);
  terrainMesh.position.set(ox, oy, oz);
  scene.add(terrainMesh);
  terrainGrid = { nAz, radii, h, up: up.clone(), north: north.clone(), east: east.clone() };
  standOnTerrain();
  if (surface.face) faceSurfacePoint(surface.face.lat, surface.face.lon, surface.face.aboveM, surface.face.downDeg);
  buildSurfaceMarkers();
  buildZone(siteId);
  syncRegionLines();
  buildWalkWall();
  buildHorizon(siteId);
}

// Ground height (m above the sphere) along a unit direction from the Moon's
// center, interpolated from the polar grid. Replaces raycasting the ~1M
// triangle mesh, which would take tens of ms per marker point.
function terrainHeightAlong(dir) {
  const g = terrainGrid;
  const cosA = dir.dot(g.up);
  const tx = dir.x - g.up.x * cosA, ty = dir.y - g.up.y * cosA, tz = dir.z - g.up.z * cosA;
  const sinA = Math.hypot(tx, ty, tz);
  const r = Math.atan2(sinA, cosA) * R_M;             // ground distance; atan2 stays exact near 0
  let az = Math.atan2(tx * g.east.x + ty * g.east.y + tz * g.east.z,
                      tx * g.north.x + ty * g.north.y + tz * g.north.z);
  if (az < 0) az += Math.PI * 2;
  const fj = (az / (Math.PI * 2)) * g.nAz;
  const j0 = Math.floor(fj) % g.nAz, j1 = (j0 + 1) % g.nAz, tj = fj - Math.floor(fj);
  const ringH = (i) => {                               // height on ring i at this azimuth
    const b = 1 + i * g.nAz;
    return g.h[b + j0] * (1 - tj) + g.h[b + j1] * tj;
  };
  const R = g.radii, n = R.length;
  if (r <= R[0]) return g.h[0] + (ringH(0) - g.h[0]) * (r / R[0]);
  if (r >= R[n - 1]) return ringH(n - 1);
  let lo = 0, hi = n - 1;                              // R[lo] <= r < R[hi]
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (R[m] <= r) lo = m; else hi = m; }
  const f = (r - R[lo]) / (R[hi] - R[lo]);
  return ringH(lo) * (1 - f) + ringH(hi) * f;
}

// Put the eye SURFACE_EYE_M above the rendered ground. enterSurfaceView starts from
// index.json's ground_m, which is sampled at the grid node nearest the site
// (the grid has an even count, so no node sits on it); on a slope that can be
// tens of metres off, leaving you floating or buried.
function standOnTerrain() {
  if (!surface || !terrainMesh) return;
  placeWalker();
}

function clearTerrain() {
  terrainToken++;
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh = null;
  }
  if (terrainMat) { terrainMat.dispose(); terrainMat = null; }
  terrainGrid = null;
  clearZone();
  syncRegionLines();
  clearWalkWall();
  clearHorizon();
}

// A dedicated sun that lights the terrain in surface view. It replaces the
// global sun light (same direction); the terrain material decides per pixel
// how much of the Sun's disk clears that pixel's skyline.
function setupSurfaceSun(center) {
  if (!surfaceSun) surfaceSun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  scene.add(surfaceSun);
  scene.add(surfaceSun.target);
  updateSurfaceSun(center);
  sunLight.intensity = 0;                              // avoid double-lighting
}

function updateSurfaceSun(center) {
  if (!surfaceSun) return;
  const sunDir = sunMesh.position.clone().normalize();
  surfaceSun.position.copy(center).addScaledVector(sunDir, 0.08);
  surfaceSun.target.position.copy(center);
  surfaceSun.target.updateMatrixWorld();
  if (terrainMat) terrainMat.setSunDir(sunDir);
}

function teardownSurfaceSun() {
  if (!surfaceSun) return;
  scene.remove(surfaceSun);
  scene.remove(surfaceSun.target);
  sunLight.intensity = 2.6;                            // restore the global sun
}

export function enterSurfaceView(lat, lon, siteId) {
  const P = latLonToScene(lat, lon, 1.0);
  const up = P.clone().normalize();
  const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon);
  // Local north = d(position)/d(lat); east = north × up.
  const north = new THREE.Vector3(
    -Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo),
  ).normalize();
  const east = new THREE.Vector3().crossVectors(north, up).normalize();
  // Stand on the terrain: lift by the real ground height at the site, then eye height.
  const info = terrainIndex && terrainIndex.sites && terrainIndex.sites[siteId];
  const ground = info ? info.ground_m / 1e6 : 0;     // metres → scene units
  const eye = SURFACE_EYE_M * 1e-6;                  // camera vantage height (see SURFACE_EYE_M; 1 unit = 1000 km)
  const center = P.clone().add(up.clone().multiplyScalar(ground));
  const pos = center.clone().add(up.clone().multiplyScalar(eye));

  // Start facing the Sun, a little above the horizon.
  const toSun = sunMesh.position.clone().sub(pos).normalize();
  const yaw = Math.atan2(toSun.dot(east), toSun.dot(north));
  const sunEl = Math.asin(THREE.MathUtils.clamp(toSun.dot(up), -1, 1));
  const pitch = THREE.MathUtils.clamp(sunEl, THREE.MathUtils.degToRad(4), THREE.MathUtils.degToRad(35));

  surface = {
    pos, east, north, up, yaw, pitch, lat, lon, siteId,
    least: east.clone(), lnorth: north.clone(), lup: up.clone(),
    walk: { x: 0, y: 0, vx: 0, vy: 0, eyeH: null, atEdge: false },
    bounds: undefined,                               // see walkBounds
  };
  versions.walk++;
  clearSurfaceMarkers();
  focusTween = null;
  focusTarget = null;
  controls.enabled = false;                          // we drive the camera ourselves
  // Eye height is ~1.8 m, far closer than the orbital near plane; the log depth
  // buffer lets us pull the near plane right in without z-fighting.
  camera.near = 5e-7;                                // ~0.5 m
  camera.far = 600000;                               // reaches the true Sun (149,600) and stars (448,800)
  camera.updateProjectionMatrix();
  camera.position.copy(pos);
  applySurfaceOrientation();

  // Hide the smooth reference-sphere globe: the real ground sits at
  // R + ground_m, which can be below that sphere (a crater floor several km down),
  // so leaving it visible puts the camera "under the Moon". The terrain
  // patch is the surface now.
  moon.visible = false;

  // Real terrain geometry + cast shadows for sites the DEMs cover.
  setupSurfaceSun(center);
  loadTerrain(siteId);

  renderer.domElement.addEventListener("pointerdown", onSurfDown);
  renderer.domElement.style.cursor = "grab";
  // Re-entering (a site switch while on the surface) must not stack these.
  window.removeEventListener("keydown", onWalkKey);
  window.removeEventListener("keyup", onWalkKey);
  window.removeEventListener("blur", onWalkBlur);
  window.addEventListener("keydown", onWalkKey);
  window.addEventListener("keyup", onWalkKey);
  window.addEventListener("blur", onWalkBlur);
  onWalkBlur();
}

// Turn the surface camera toward a nearby point on the ground (used to face
// the panel spot from a landing target).
// Applied again once the terrain has loaded, when the ground heights are real.
export function faceSurfacePoint(lat, lon, aboveM = 0, downDeg = 5) {
  if (!surface) return;
  surface.face = { lat, lon, aboveM, downDeg };
  const g = groundPoint(lat, lon, 0);
  const d = g.addScaledVector(g.clone().normalize(), aboveM * M).sub(surface.pos);
  const h = Math.hypot(d.dot(surface.east), d.dot(surface.north));
  surface.yaw = Math.atan2(d.dot(surface.east), d.dot(surface.north));
  // A few degrees below the spot, so the ground in between (the landing
  // zone's ring and the walking path) is in view, not just the horizon.
  surface.pitch = Math.atan2(d.dot(surface.up), h) - THREE.MathUtils.degToRad(downDeg);
  applySurfaceOrientation();
}

export function exitSurfaceView() {
  if (!surface) return;
  renderer.domElement.removeEventListener("pointerdown", onSurfDown);
  onSurfUp();
  window.removeEventListener("keydown", onWalkKey);
  window.removeEventListener("keyup", onWalkKey);
  window.removeEventListener("blur", onWalkBlur);
  onWalkBlur();
  renderer.domElement.style.cursor = "";
  surface = null;
  versions.walk++;
  lookTween = null;
  pendingLookId = null;
  clearSurfaceMarkers();
  clearTerrain();
  moon.visible = true;                                // restore the orbital globe
  teardownSurfaceSun();
  controls.enabled = true;
  controls.minDistance = DEFAULT_MIN_DISTANCE;
  camera.near = 0.1;                                  // restore the orbital frustum
  camera.far = 600000;
  camera.updateProjectionMatrix();
  // Ease back out to the orbital view (slerps up from local vertical to world).
  startFocusTween(
    new THREE.Vector3(0, 0, 0),
    camera.position.clone().setLength(MOON_RADIUS * 8),
    WORLD_UP.clone(),
  );
}

function applySurfaceOrientation() {
  const { pos, least: east, lnorth: north, lup: up, yaw, pitch } = surface;
  const ce = Math.cos(pitch), se = Math.sin(pitch);
  const dir = new THREE.Vector3()
    .addScaledVector(north, ce * Math.cos(yaw))
    .addScaledVector(east, ce * Math.sin(yaw))
    .addScaledVector(up, se);
  camera.up.copy(up);
  camera.lookAt(pos.clone().add(dir));
}

function onSurfDown(e) {
  lookTween = null;                                  // grabbing the view cancels a turn in progress
  pendingLookId = null;
  surfDrag = { x: e.clientX, y: e.clientY };
  window.addEventListener("pointermove", onSurfMove);
  window.addEventListener("pointerup", onSurfUp);
  renderer.domElement.style.cursor = "grabbing";
}
function onSurfMove(e) {
  if (!surface || !surfDrag) return;
  const dx = e.clientX - surfDrag.x, dy = e.clientY - surfDrag.y;
  surfDrag.x = e.clientX; surfDrag.y = e.clientY;
  const sens = 0.0032;
  surface.yaw -= dx * sens;                          // drag to look around ("grab the sky")
  surface.pitch = THREE.MathUtils.clamp(
    // Up/down at half the left/right rate.
    surface.pitch + dy * sens * 0.5, THREE.MathUtils.degToRad(-25), THREE.MathUtils.degToRad(85));
  applySurfaceOrientation();
}
function onSurfUp() {
  surfDrag = null;
  window.removeEventListener("pointermove", onSurfMove);
  window.removeEventListener("pointerup", onSurfUp);
  if (surface && renderer) renderer.domElement.style.cursor = "grab";
}

// ── Walking (surface view) ──
// WASD or the arrow keys move you over the terrain in the direction you face;
// Shift sprints, R returns to the lander. Your position is an (east, north)
// offset in metres on the plane tangent to the Moon at the site, which is
// also where the bounds are tested: the site's Artemis region outline, or a
// circle around the lander for a site that has none.
//
// The speeds are far above a real walk on purpose: the terrain is a 20 m
// grid, so at 1.4 m/s the ground would hardly seem to move.
const WALK_MPS = 25;
const SPRINT_FACTOR = 5;
const WALK_EASE_S = 0.15;        // time to reach speed / to stop
const EYE_EASE_S = 0.12;         // smooths the eye over the grid's creases
const WALK_RADIUS_M = 2300;      // bounds without an outline: where the 20 m rings end
const WALL_M = 25;               // height of the translucent wall on the bounds
const WALK_CODES = {
  KeyW: "f", ArrowUp: "f", KeyS: "b", ArrowDown: "b",
  KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
};
const walkKeys = new Set();
let walkSprint = false;
let walkWall = null;             // the wall mesh, while shown

function onWalkKey(e) {
  if (!surface) return;
  const down = e.type === "keydown";
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") { walkSprint = down; return; }
  const k = WALK_CODES[e.code];
  if (!k && e.code !== "KeyR") return;
  if (!down) { walkKeys.delete(k); return; }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Typing stays typing. The time slider keeps the arrow keys, but letters
  // mean nothing to it, so WASD still walks after you've dragged it.
  const t = e.target;
  if (t instanceof Element) {
    if (t.matches('input:not([type="range"]), textarea, select, [contenteditable]')) return;
    if (t.matches('input[type="range"]') && e.code.startsWith("Arrow")) return;
  }
  if (e.code === "KeyR") { if (!e.repeat) resetSurfaceWalk(); return; }
  e.preventDefault();
  walkKeys.add(k);
}
function onWalkBlur() { walkKeys.clear(); walkSprint = false; }

// Direction from the Moon's center to a tangent-plane offset.
function walkDir(x, y) {
  return surface.up.clone()
    .addScaledVector(surface.east, x / R_M)
    .addScaledVector(surface.north, y / R_M)
    .normalize();
}

// The site's region outline as tangent-plane points, or null. The outlines
// load on their own, so this is looked up when first needed.
function walkBounds() {
  if (surface.bounds !== undefined) return surface.bounds;
  const region = regionOutlines.find((r) => r.id === surface.siteId);
  if (!region) return regionOutlines.length ? (surface.bounds = null) : null;
  const poly = [];
  for (const [lon, lat] of region.ring) {
    const d = latLonToScene(lat, lon).normalize();
    const c = d.dot(surface.up);
    poly.push([R_M * d.dot(surface.east) / c, R_M * d.dot(surface.north) / c]);
  }
  const a = poly[0], b = poly[poly.length - 1];
  if (poly.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) poly.pop();   // closed ring
  // A site outside its own outline would be stuck at once: use the circle.
  surface.bounds = poly.length >= 3 && insidePoly(poly, 0, 0) ? poly : null;
  return surface.bounds;
}

function insidePoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[j];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

// One step from (x, y) by (dx, dy), kept inside the bounds: a step that
// would cross slides along the edge instead. Returns [x, y, blocked].
function walkStep(x, y, dx, dy) {
  const nx = x + dx, ny = y + dy;
  const poly = walkBounds();
  if (!poly) {
    const r = Math.hypot(nx, ny);
    if (r <= WALK_RADIUS_M) return [nx, ny, false];
    return [nx * WALK_RADIUS_M / r, ny * WALK_RADIUS_M / r, true];
  }
  if (insidePoly(poly, nx, ny)) return [nx, ny, false];
  let best = Infinity, tx = 0, ty = 0;                 // the edge nearest the blocked point
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    const ex = x2 - x1, ey = y2 - y1, len2 = ex * ex + ey * ey;
    const u = Math.max(0, Math.min(1, ((nx - x1) * ex + (ny - y1) * ey) / len2));
    const d = Math.hypot(nx - (x1 + u * ex), ny - (y1 + u * ey));
    if (d < best) { best = d; const len = Math.sqrt(len2); tx = ex / len; ty = ey / len; }
  }
  const along = dx * tx + dy * ty;
  const sx = x + tx * along, sy = y + ty * along;
  return insidePoly(poly, sx, sy) ? [sx, sy, true] : [x, y, true];
}

// Put the camera at the walk position, eye height above the rendered ground,
// and stand the view up along the local vertical there. Without dt the eye
// snaps to its height; with it, it eases.
function placeWalker(dt) {
  const s = surface, w = s.walk;
  const dir = walkDir(w.x, w.y);
  const ground = terrainHeightAlong(dir);
  const target = ground + SURFACE_EYE_M;
  if (dt == null || w.eyeH == null) w.eyeH = target;
  else w.eyeH = Math.max(ground + 2, w.eyeH + (target - w.eyeH) * (1 - Math.exp(-dt / EYE_EASE_S)));
  s.pos.copy(dir).multiplyScalar(MOON_RADIUS + w.eyeH * M);
  // Carry the site's north along, so a heading means the same as at the
  // lander and the Sky panel's view box stays true.
  s.lup.copy(dir);
  s.lnorth.copy(s.north).addScaledVector(dir, -s.north.dot(dir)).normalize();
  s.least.crossVectors(s.lnorth, s.lup).normalize();
  camera.position.copy(s.pos);
  applySurfaceOrientation();
}

function updateWalk(dt) {
  if (!surface || !terrainGrid) return;
  const w = surface.walk;
  const f = (walkKeys.has("f") ? 1 : 0) - (walkKeys.has("b") ? 1 : 0);
  const r = (walkKeys.has("r") ? 1 : 0) - (walkKeys.has("l") ? 1 : 0);
  let tvx = 0, tvy = 0;
  if (f || r) {
    const speed = WALK_MPS * (walkSprint ? SPRINT_FACTOR : 1) / Math.hypot(f, r);
    const sy = Math.sin(surface.yaw), cy = Math.cos(surface.yaw);
    tvx = (f * sy + r * cy) * speed;                   // east
    tvy = (f * cy - r * sy) * speed;                   // north
  }
  const k = 1 - Math.exp(-dt / WALK_EASE_S);
  w.vx += (tvx - w.vx) * k;
  w.vy += (tvy - w.vy) * k;
  if (!f && !r && Math.hypot(w.vx, w.vy) < 0.05) {
    w.vx = w.vy = 0;
    if (w.atEdge) { w.atEdge = false; versions.walk++; }
    return;
  }
  const [x, y, blocked] = walkStep(w.x, w.y, w.vx * dt, w.vy * dt);
  if (blocked) { w.vx = (x - w.x) / dt; w.vy = (y - w.y) / dt; }
  w.x = x; w.y = y;
  if (blocked !== w.atEdge) { w.atEdge = blocked; versions.walk++; }
  placeWalker(dt);
}

// Back to the lander.
export function resetSurfaceWalk() {
  if (!surface) return;
  const w = surface.walk;
  w.x = w.y = w.vx = w.vy = 0;
  w.atEdge = false;
  versions.walk++;
  if (terrainGrid) placeWalker();
}

// For the walk hint: whether walking works yet, how far you are from the
// lander, and whether the bounds are stopping you.
export function getSurfaceWalk() {
  if (!surface) return null;
  const w = surface.walk;
  return { ready: !!terrainGrid, distM: Math.hypot(w.x, w.y), atEdge: w.atEdge };
}

// A low translucent wall along the bounds, draped over the ground, so the
// edge shows before you reach it.
function buildWalkWall() {
  clearWalkWall();
  if (!surface || !terrainMesh) return;
  const poly = walkBounds();
  const ring = [];                                     // [x, y] samples along the bounds
  if (poly) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 40));
      for (let q = 0; q < n; q++) ring.push([x1 + (x2 - x1) * q / n, y1 + (y2 - y1) * q / n]);
    }
  } else {
    const n = 360;
    for (let q = 0; q < n; q++) {
      const a = (q / n) * Math.PI * 2;
      ring.push([WALK_RADIUS_M * Math.sin(a), WALK_RADIUS_M * Math.cos(a)]);
    }
  }
  // Relative to the terrain mesh's origin, like the mesh itself, so the
  // small offsets keep their precision on the GPU.
  const origin = terrainMesh.position;
  const verts = new Float32Array(ring.length * 6);
  const index = new Uint32Array(ring.length * 6);
  for (let i = 0; i < ring.length; i++) {
    const dir = walkDir(ring[i][0], ring[i][1]);
    const h = terrainHeightAlong(dir);
    const lo = dir.clone().multiplyScalar(MOON_RADIUS + (h + 0.5) * M).sub(origin);
    const hi = dir.clone().multiplyScalar(MOON_RADIUS + (h + WALL_M) * M).sub(origin);
    verts.set([lo.x, lo.y, lo.z, hi.x, hi.y, hi.z], i * 6);
    const a = i * 2, b = ((i + 1) % ring.length) * 2;
    index.set([a, a + 1, b, a + 1, b + 1, b], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  walkWall = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xe6ebf3, side: THREE.DoubleSide, transparent: true, opacity: 0.22, depthWrite: false,
  }));
  walkWall.position.copy(origin);
  scene.add(walkWall);
}

function clearWalkWall() {
  if (!walkWall) return;
  scene.remove(walkWall);
  walkWall.geometry.dispose();
  walkWall.material.dispose();
  walkWall = null;
}

// ── Lander and panel-spot markers (surface view only) ──
// You stand at the lander, so it's a ring around you, wide enough (20 m) to
// show below the horizon even when looking straight ahead. Each panel spot
// gets a tall pole (visible from a few hundred metres) and a path along the
// ground back to the lander. Labels are DOM, placed by main.js from
// getSurfaceMarkerScreens().
const M = 1e-6;                              // one metre in scene units
const POLE_M = 15;

export function setSurfaceMarkers(spec) {
  surfMarkerSpec = spec;
  buildSurfaceMarkers();
}

// The point on the rendered ground under lat/lon. Dropped onto the terrain
// mesh so markers sit on the ground you see (within ~20 m of the site the
// mesh is the same 20 m map the panel search used).
function groundPoint(lat, lon, groundM) {
  return groundAlong(latLonToScene(lat, lon).normalize(), groundM);
}

function groundAlong(dir, groundM = 0) {
  const d = dir.clone().normalize();
  const h = terrainGrid ? terrainHeightAlong(d) : (groundM || 0);
  return d.multiplyScalar(MOON_RADIUS + h * M);
}

function clearSurfaceMarkers() {
  if (!surfMarkerGroup) return;
  scene.remove(surfMarkerGroup);
  surfMarkerGroup.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  surfMarkerGroup = null;
  surfMarkerAnchors = {};
  versions.markers++;
}

function buildSurfaceMarkers() {
  clearSurfaceMarkers();
  const spec = surfMarkerSpec;
  if (!surface || !spec || !terrainMesh) return;
  // Only for the site we're standing on (a switch can land before its panel data).
  if (Math.abs(spec.lat - surface.lat) > 1e-4 || Math.abs(spec.lon - surface.lon) > 1e-4) return;

  // Children are placed relative to the lander so their small offsets keep
  // full precision on the GPU (world coordinates are ~1.7 units).
  const origin = groundPoint(spec.lat, spec.lon, spec.ground_m);
  const group = new THREE.Group();
  group.position.copy(origin);
  const local = (w) => w.clone().sub(origin);
  const upAt = (w) => w.clone().normalize();
  const yAxis = new THREE.Vector3(0, 1, 0);

  // Lander: a ring around you, draped over the ground (the site can slope
  // several degrees, which would bury half of a flat 20 m ring).
  const RING_M = 20;                         // ~6° below eye level: on screen, clear of the time bar
  const up0 = upAt(origin);
  const e0 = surface.east, n0 = surface.north;
  const ringAt = (radiusM, bandM, color, opacity, overGround = false) => {
    const verts = [], index = [];
    const SEG = Math.max(64, Math.round(radiusM * 1.5));
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const h = e0.clone().multiplyScalar(Math.cos(a)).addScaledVector(n0, Math.sin(a));
      const outer = groundAlong(up0.clone().addScaledVector(h, radiusM * M / MOON_RADIUS).normalize())
        .addScaledVector(up0, 0.3 * M);
      const inner = outer.clone().addScaledVector(h, -bandM * M);
      verts.push(...local(inner).toArray(), ...local(outer).toArray());
      if (i < SEG) { const k = i * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity, depthTest: !overGround }));
    if (overGround) mesh.renderOrder = 10;   // drawn after the terrain
    group.add(mesh);
  };
  ringAt(RING_M, 0.8, 0xe6ebf3, 0.85);
  // Phase 6: the landing zone around the target (the lander could be anywhere
  // in it). Drawn over the ground so it still shows where a rise hides it:
  // from eye height, most of a 100 m circle is behind the nearest crest.
  if (spec.zone_m) ringAt(spec.zone_m, 3, 0x38c868, 0.75, true);

  // Its label sits on the ring's edge toward the first panel spot (or north),
  // so it's on screen when you look that way; under your feet it never is.
  const toward = spec.spots.length
    ? groundPoint(spec.spots[0].lat, spec.spots[0].lon, spec.spots[0].ground_m).sub(origin)
    : surface.north.clone();
  toward.addScaledVector(upAt(origin), -toward.dot(upAt(origin))).normalize();
  surfMarkerAnchors.lander = groundAlong(up0.clone().addScaledVector(toward, RING_M * M / MOON_RADIUS).normalize())
    .addScaledVector(up0, 0.3 * M);
  if (spec.zone_m) {
    // The zone's label on its far edge, opposite the panels, so the two don't overlap.
    surfMarkerAnchors.zone = groundAlong(up0.clone().addScaledVector(toward, -spec.zone_m * M / MOON_RADIUS).normalize())
      .addScaledVector(up0, 1 * M);
  }

  for (const s of spec.spots) {
    const base = groundPoint(s.lat, s.lon, s.ground_m);
    const up = upAt(base);
    const mat = () => new THREE.MeshBasicMaterial({ color: s.color });

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * M, 0.5 * M, POLE_M * M, 12), mat());
    pole.quaternion.setFromUnitVectors(yAxis, up);
    pole.position.copy(local(base).addScaledVector(up, (POLE_M / 2) * M));
    group.add(pole);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.5 * M, 16, 12), mat());
    cap.position.copy(local(base).addScaledVector(up, POLE_M * M));
    group.add(cap);

    // Path from the lander, draped over the ground 0.5 m up.
    const pts = [];
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const f = i / N;
      // Interpolate in 3D, not lat/lon, so a path near the pole can't wrap
      // the long way round across ±180°.
      const g = groundAlong(upAt(origin).lerp(up, f).normalize());
      pts.push(local(g).addScaledVector(upAt(g), 0.5 * M));
    }
    const path = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: s.color, dashSize: 4 * M, gapSize: 3 * M }),
    );
    path.computeLineDistances();
    group.add(path);

    surfMarkerAnchors[s.id] = base.clone().addScaledVector(up, (POLE_M + 3) * M);
  }

  scene.add(group);
  surfMarkerGroup = group;
  versions.markers++;
  if (pendingLookId && surfMarkerAnchors[pendingLookId]) lookAtSurfaceMarker(pendingLookId);
}

// ── Turning to face a marker ("More sun" / "Shorter night" in the card) ──
// The camera swings over ~0.7 s, the short way round, to centre the marker's
// label with its pole hanging below. Markers are built only once the terrain
// has loaded, so a request that arrives first (clicking a pick from orbit)
// waits in pendingLookId and runs when they appear.
let pendingLookId = null;
let lookTween = null;     // { yaw0, dYaw, pitch0, dPitch, t } while turning
const LOOK_TURN_S = 0.7;

export function lookAtSurfaceMarker(id) {
  if (!surface) return;
  const target = surfMarkerAnchors[id];
  if (!target) { pendingLookId = id; return; }
  pendingLookId = null;
  const d = target.clone().sub(surface.pos).normalize();
  const yaw = Math.atan2(d.dot(surface.least), d.dot(surface.lnorth));
  const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.dot(surface.lup), -1, 1)),
    THREE.MathUtils.degToRad(-25), THREE.MathUtils.degToRad(85));
  let dYaw = (yaw - surface.yaw) % (2 * Math.PI);
  if (dYaw > Math.PI) dYaw -= 2 * Math.PI;
  if (dYaw < -Math.PI) dYaw += 2 * Math.PI;
  lookTween = { yaw0: surface.yaw, dYaw, pitch0: surface.pitch, dPitch: pitch - surface.pitch, t: 0 };
}

function updateLookTween(dt) {
  if (!lookTween || !surface) return;
  lookTween.t = Math.min(1, lookTween.t + dt / LOOK_TURN_S);
  const k = 1 - Math.pow(1 - lookTween.t, 3);          // ease out
  surface.yaw = lookTween.yaw0 + lookTween.dYaw * k;
  surface.pitch = lookTween.pitch0 + lookTween.dPitch * k;
  applySurfaceOrientation();
  if (lookTween.t >= 1) lookTween = null;
}

// Screen positions for the labels: { id: {x, y, onScreen} }.
export function getSurfaceMarkerScreens() {
  const out = {};
  for (const [id, w] of Object.entries(surfMarkerAnchors)) out[id] = worldToScreen(w);
  return out;
}

function render() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateFocusTween(dt);
  if (!surface) {                                    // surface view drives the camera itself
    controls.update();
    checkFocusExit();
  } else {
    updateSurfaceSun(surface.pos);                   // keep sunlight tracking the Sun as time scrubs
    updateLookTween(dt);
    updateWalk(dt);
  }
  updatePoleFade();
  trackView();
  maybeUpgradeMoonTextures();
  for (const cb of onFrameCallbacks) cb();
  renderer.render(scene, camera);
}

export function onFrame(cb) { onFrameCallbacks.push(cb); }

// Stop drawing while something covers the whole scene (the Plan view), and
// pick up where it left off after. The clock is reset so the first frame back
// doesn't see the paused time as one huge step.
export function setPaused(paused) {
  renderer.setAnimationLoop(paused ? null : render);
  if (!paused) clock.getDelta();
}

// Counters the per-frame overlays in main.js compare to skip their work when
// nothing they depend on has changed: `view` goes up when the camera or the
// canvas size changes, `bodies` when the Sun or Earth moves, and `markers`
// when the surface markers are rebuilt or cleared, and `walk` when you enter
// or leave the surface, return to the lander, or reach or leave the bounds.
const versions = { view: 0, bodies: 0, markers: 0, walk: 0 };
export function getVersions() { return versions; }

const _lastView = new THREE.Matrix4(), _lastProj = new THREE.Matrix4();
let _lastW = -1, _lastH = -1;
let lastViewChangeMs = 0;

// Camera matrix entries are rotations (about 1) and positions (a few units).
// A change under 1e-7 moves nothing visibly on screen, and ignoring it lets
// OrbitControls' damping tail die out instead of counting as motion.
function matrixMoved(a, b) {
  const x = a.elements, y = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(x[i] - y[i]) > 1e-7) return true;
  return false;
}

function trackView() {
  // Update now so the overlays project with this frame's camera; otherwise it
  // only happens inside renderer.render, after them, and they lag a frame.
  camera.updateMatrixWorld();
  if (matrixMoved(camera.matrixWorld, _lastView) || !camera.projectionMatrix.equals(_lastProj)
      || screenW !== _lastW || screenH !== _lastH) {
    _lastView.copy(camera.matrixWorld);
    _lastProj.copy(camera.projectionMatrix);
    _lastW = screenW; _lastH = screenH;
    versions.view++;
    lastViewChangeMs = performance.now();
  }
}

// ── Moon textures: a light set first, the full set up close ──
// From the launch view a 4k color map already has more texels across the
// disk than the screen has pixels, and the GPU samples a smaller mipmap
// anyway, so the 8k color and 4k normal maps (24 MB, most of the first
// load) only show once you zoom in. The light set is 6.5 MB.
const MOON_TEXTURES = {
  light: { map: "moon_color_4k.jpg", normalMap: "moon_normal_2k.png" },
  full: { map: "moon_color_8k.jpg", normalMap: "moon_normal_4k.png" },
};
// Texels per radian around the equator in the coarser light texture (the 2k
// normal map). Up to ~1.5× magnification, linear filtering hides the
// difference; past that, fetch the full set.
const LIGHT_TEXELS_PER_RAD = 2048 / (2 * Math.PI);
const UPGRADE_AT_MAGNIFICATION = 1.5;
// The first upload of an 8k texture can stall a frame, so the swap waits
// until the camera has been still this long.
const SWAP_WHEN_STILL_MS = 250;
let moonTextureState = "light";   // → "loading" → "ready" (waiting to swap) → "full", or "failed"
let fullMoonTextures = null;
let polarCapState = "idle";       // → "loading" → "on", or "failed"

// Decode the full set off the main thread where the browser can: the same
// test three's GLTFLoader uses for createImageBitmap with options. Elsewhere
// the image is decoded during the upload, on the main thread.
function canDecodeOffThread() {
  if (typeof createImageBitmap === "undefined") return false;
  const ua = navigator.userAgent;
  if (/^((?!chrome|android).)*safari/i.test(ua)) return parseInt((ua.match(/Version\/(\d+)/) || [])[1], 10) >= 17;
  if (ua.includes("Firefox")) return parseInt((ua.match(/Firefox\/(\d+)\./) || [])[1], 10) >= 98;
  return true;
}

async function loadFullMoonTexture(file, colorSpace) {
  let tex;
  if (canDecodeOffThread()) {
    const bitmap = await new THREE.ImageBitmapLoader()
      .setOptions({ imageOrientation: "flipY", premultiplyAlpha: "none" })
      .loadAsync(ASSET(file));
    tex = new THREE.Texture(bitmap);
    tex.flipY = false;                                 // flipped while decoding, like TextureLoader's upload
    tex.needsUpdate = true;
  } else {
    tex = await new THREE.TextureLoader().loadAsync(ASSET(file));
  }
  tex.colorSpace = colorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Screen pixels per radian of ground at the point nearest the camera.
function moonPxPerRad() {
  const focalPx = (screenH * renderer.getPixelRatio()) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return (focalPx * MOON_RADIUS) / Math.max(camera.position.length() - MOON_RADIUS, 1e-9);
}

// The south polar cap is ~6 MB and only pays for itself once the pole covers
// enough screen to out-resolve the equirectangular wrap, so it rides the same
// magnification trigger as the full texture set. Until it lands, uCapReady
// stays 0 and the globe looks exactly as it did before.
// Show or hide the permanently-shadowed-region tint on the polar cap.
export function setPsrOverlay(on) {
  if (moon && moon.material.setPsrVisible) moon.material.setPsrVisible(on);
}

function maybeLoadPolarCap() {
  if (polarCapState !== "idle" || surface || focusTween) return;
  if (moonPxPerRad() < UPGRADE_AT_MAGNIFICATION * LIGHT_TEXELS_PER_RAD) return;
  polarCapState = "loading";
  const loader = new THREE.TextureLoader();
  const tex = (file) => loader.loadAsync(ASSET(file)).then((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  });
  Promise.all([
    tex("pole_south_albedo.jpg"),
    tex("pole_south_normal.jpg"),
    tex("pole_south_height.png"),
    fetch(ASSET("pole_south.json")).then((r) => r.json()),
  ]).then(([albedo, normal, height, meta]) => {
    // The height map packs 16-bit elevation across two 8-bit channels. Linear
    // filtering of that is exact (both the packing and the blend are linear),
    // but the shadow march reads it inside a loop where screen-space
    // derivatives are undefined, so mipmaps would hand back an arbitrary
    // level. Sample one level only.
    height.generateMipmaps = false;
    height.minFilter = THREE.LinearFilter;
    height.anisotropy = 1;
    moon.material.setPolarCap({ albedo, normal, height, meta });
    moon.material.setCapSunDir(sunLight.position);
    polarCapState = "on";
    // Permanently shadowed regions overlay: optional, loaded after the cap so
    // a missing or failed mask never holds the cap back.
    tex("pole_south_psr.png")
      .then((psr) => moon.material.setPsrMask(psr))
      .catch(() => {});
  }).catch(() => { polarCapState = "failed"; });
}

function maybeUpgradeMoonTextures() {
  maybeLoadPolarCap();
  if (moonTextureState === "light") {
    // Not in surface view (the globe is hidden) or mid fly-to: flying out
    // of surface view starts at the ground but ends far off.
    if (surface || focusTween) return;
    if (moonPxPerRad() < UPGRADE_AT_MAGNIFICATION * LIGHT_TEXELS_PER_RAD) return;
    moonTextureState = "loading";
    Promise.all([
      loadFullMoonTexture(MOON_TEXTURES.full.map, THREE.NoColorSpace),   // sRGB, decoded in the shader
      loadFullMoonTexture(MOON_TEXTURES.full.normalMap, THREE.NoColorSpace),
    ]).then(([map, normalMap]) => {
      fullMoonTextures = { map, normalMap };
      moonTextureState = "ready";
    }).catch(() => { moonTextureState = "failed"; });  // keep the light set
  } else if (moonTextureState === "ready" && performance.now() - lastViewChangeMs > SWAP_WHEN_STILL_MS) {
    const mat = moon.material;
    const old = [mat.map, mat.normalMap];
    mat.map = fullMoonTextures.map;
    mat.normalMap = fullMoonTextures.normalMap;
    for (const tex of old) tex.dispose();
    fullMoonTextures = null;
    moonTextureState = "full";
  }
}

// ── Bodies ──
function addBodies() {
  const loader = new THREE.TextureLoader();

  // Moon — textured sphere with photometry shader. Starts on the light
  // texture set; maybeUpgradeMoonTextures swaps in the full one up close.
  const setUp = (tex, colorSpace) => {
    tex.colorSpace = colorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  };
  // The color map is sRGB, decoded in the shader (moonMaterial.js).
  const colorMap = setUp(loader.load(ASSET(MOON_TEXTURES.light.map)), THREE.NoColorSpace);
  const normalMap = setUp(loader.load(ASSET(MOON_TEXTURES.light.normalMap)), THREE.NoColorSpace);

  const moonMat = createMoonMaterial({ map: colorMap, normalMap, cap: true });
  moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS, 128, 128), moonMat);
  scene.add(moon);

  // Polar axis line (N at +Y, S at -Y)
  const axisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, MOON_RADIUS * 1.15, 0),
    new THREE.Vector3(0, -MOON_RADIUS * 1.15, 0),
  ]);
  poleAxis = new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: 0x6a7590, transparent: true, opacity: 0.4 }));
  scene.add(poleAxis);

  // N / S labels at the axis ends
  const makeAxisLabel = (text, y) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#cfd6e4";
    g.font = "bold 44px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.22, depthTest: false }));
    spr.position.set(0, y, 0);
    spr.scale.setScalar(MOON_RADIUS * 0.04);
    scene.add(spr);
    poleSprites.push(spr);
  };
  makeAxisLabel("N", MOON_RADIUS * 1.21);
  makeAxisLabel("S", -MOON_RADIUS * 1.21);

  // Earth — textured sphere + faint atmosphere glow
  const earthTex = loader.load(ASSET("2k_earth_daymap.jpg"));
  earthTex.colorSpace = THREE.SRGBColorSpace;
  earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 48, 48),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 1, metalness: 0 })
  );
  earthGlow = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.06, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0x3060c0, transparent: true, opacity: 0.12, side: THREE.BackSide })
  );
  earth.add(earthGlow);
  scene.add(earth);

  // Sun — emissive sphere + directional light
  // The Sun is ~120 px across on screen: 512 px of texture covers it.
  const sunTex = loader.load(ASSET("sun_512.jpg"));
  sunTex.colorSpace = THREE.SRGBColorSpace;
  sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_VISUAL_RADIUS, 48, 48),
    new THREE.MeshBasicMaterial({ map: sunTex, color: 0xfff4d6 })
  );
  scene.add(sunMesh);

  sunLight = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sunLight.position.set(-1, 0, 0);
  scene.add(sunLight);

  // Default placements until data loads
  earth.position.copy(azElToDir(90, 5).multiplyScalar(EARTH_MOON_DIST));
  placeSun(azElToDir(270, 10).multiplyScalar(SUN_DIST));
}

// Direction in the scene for an az/el seen from a site. Az/el are local to
// the site (0 = north, 90 = east, el above the site's horizon), so build the
// site's own east/north/up axes and combine them. Without a site, +Y is up
// (only used for placeholder positions before data loads).
function azElToDir(azDeg, elDeg, lat = null, lon = null) {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  let east = new THREE.Vector3(1, 0, 0), north = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
  if (lat != null && lon != null) {
    // Take the axes from latLonToScene itself so they match the globe exactly.
    const d = 1e-3;
    up = latLonToScene(lat, lon).normalize();
    east = latLonToScene(lat, lon + d).sub(latLonToScene(lat, lon - d));
    north = latLonToScene(lat + d, lon).sub(latLonToScene(lat - d, lon));
    north.addScaledVector(up, -north.dot(up)).normalize();
    east.addScaledVector(up, -east.dot(up)).addScaledVector(north, -east.dot(north)).normalize();
  }
  return new THREE.Vector3()
    .addScaledVector(north, Math.cos(el) * Math.cos(az))
    .addScaledVector(east, Math.cos(el) * Math.sin(az))
    .addScaledVector(up, Math.sin(el));
}

function placeSun(pos) {
  sunMesh.position.copy(pos);
  sunLight.position.copy(pos).normalize();
  // The polar cap casts its own shadows, so it needs the Sun too.
  if (moon) moon.material.setCapSunDir(sunLight.position);
}

// Position Sun and Earth from az/el at a given sample index.
// NOTE: az/el is topocentric (a single site's local sky), so this moves the
// light when you switch sites. Prefer updateBodiesFromEphemeris, which is
// site-independent; this remains only as a fallback for custom date windows
// that have no precomputed global ephemeris.
export function updateBodiesFromSky(skyData, idx) {
  // True angles, no exaggeration: the old 12× stretch made the Sun look far
  // too high from the surface view.
  if (!skyData) return;
  const lat = skyData.lat ?? skyData.metrics?.site?.lat;
  const lon = skyData.lon ?? skyData.metrics?.site?.lon;
  const sunDir = azElToDir(skyData.sun_az[idx], skyData.sun_el[idx], lat, lon);
  const earthDir = azElToDir(skyData.earth_az[idx], skyData.earth_el[idx], lat, lon);
  placeSun(sunDir.clone().multiplyScalar(SUN_DIST));
  earth.position.copy(earthDir.clone().multiplyScalar(EARTH_MOON_DIST));
  versions.bodies++;
}

// Position Sun and Earth from the site-independent orbital track: the
// sub-solar and sub-Earth points (lat/lon in the Moon frame) at this instant.
// The sub-solar point is where the Sun is directly overhead, so lighting the
// scene from that direction gives the true terminator — and it does not depend
// on which site is selected, so switching sites leaves the lighting untouched.
export function updateBodiesFromEphemeris(eph, idx) {
  if (!eph || idx == null) return;
  const sunDir = latLonToScene(eph.subsolar_lat[idx], eph.subsolar_lon[idx], 1.0).normalize();
  const earthDir = latLonToScene(eph.subearth_lat[idx], eph.subearth_lon[idx], 1.0).normalize();
  placeSun(sunDir.multiplyScalar(SUN_DIST));
  earth.position.copy(earthDir.multiplyScalar(EARTH_MOON_DIST));
  versions.bodies++;
}

// ── Starfield ──
function addStarfield() {
  const N = 3000;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const R = SUN_DIST * 3;
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(R);
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  // Fixed screen size (pixels): stars are effectively at infinity, so they
  // shouldn't grow or shrink with zoom. With sizeAttenuation on, a size in
  // scene units this large drew each star as a big square that filled the sky.
  const mat = new THREE.PointsMaterial({ color: 0xaab4c8, size: 2, sizeAttenuation: false });
  starfield = new THREE.Points(geo, mat);
  scene.add(starfield);
}

// ── Site markers ──
// lat/lon → scene position, registered to the equirectangular colour texture.
// North pole +Y. The texture (standard north-up, lon-0-centred map) places
// selenographic lon 0 at +X and lon +90°E at -Z; this matches it exactly, so a
// pin lands on the real feature. (Earth is positioned from az/el data, not lon.)
export function latLonToScene(lat, lon, radiusScale = 1.0) {
  const la = THREE.MathUtils.degToRad(lat);
  const lo = THREE.MathUtils.degToRad(lon);
  const r = MOON_RADIUS * radiusScale;
  return new THREE.Vector3(
    r * Math.cos(la) * Math.cos(lo),
    r * Math.sin(la),
    -r * Math.cos(la) * Math.sin(lo)
  );
}

export function updateSiteMarker(lat, lon, name) {
  const surface = latLonToScene(lat, lon);
  const tip = latLonToScene(lat, lon, 1.14);

  if (!siteMarker) {
    const flagGeo = new THREE.BufferGeometry().setFromPoints([surface, tip]);
    siteFlag = new THREE.Line(flagGeo, new THREE.LineBasicMaterial({ color: 0xff4060 }));
    scene.add(siteFlag);

    siteMarker = new THREE.Mesh(
      new THREE.SphereGeometry(MOON_RADIUS * 0.02, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff4060 })
    );
    scene.add(siteMarker);
  } else {
    siteFlag.geometry.setFromPoints([surface, tip]);
  }
  siteMarker.position.copy(tip);
  siteMarker.userData.name = name;
  siteMarker.userData.surface = surface;
}

// ── Multi-site markers (DOM overlay driven from main.js) ──
// Project a surface point to screen pixels, and report whether it sits on the
// near hemisphere (front-facing) so the overlay can hide back-side markers.
const _proj = new THREE.Vector3(), _normal = new THREE.Vector3(), _toCam = new THREE.Vector3();

export function projectSurface(lat, lon) {
  const world = latLonToScene(lat, lon, 1.0);
  const v = _proj.copy(world).project(camera);
  const normal = _normal.copy(world).normalize();
  const toCam = _toCam.copy(camera.position).sub(world).normalize();
  return {
    x: (v.x * 0.5 + 0.5) * screenW,
    y: (-v.y * 0.5 + 0.5) * screenH,
    facing: normal.dot(toCam),   // >0 near side, <0 far side
    behind: v.z > 1,
  };
}

// ── Artemis III region outlines (real polygons on the sphere) ──
let regionOutlines = [];
let regionHighlight = null;   // site id to highlight, kept for outlines that load later
const regionRings = new Map();  // site id -> boundary ring, for the surface-view zone
// Neutral, not amber/cyan: those are Sun/power and Earth/comms in the data panels.
const REGION_BASE = 0x7f8a9e, REGION_SEL = 0xffffff;

export function setRegionOutlines(features) {
  for (const o of regionOutlines) scene.remove(o.line);
  regionOutlines = [];
  regionRings.clear();
  for (const f of features) {
    const code = f.properties && f.properties.RegionCode;
    if (!code) continue;
    const ring = f.geometry.coordinates[0]; // outer ring, [lon, lat] pairs
    regionRings.set("artemis-" + code.toLowerCase(), ring);
    const pts = ring.map(([lon, lat]) => latLonToScene(lat, lon, 1.004));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: REGION_BASE, transparent: true, opacity: 0.3 });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    regionOutlines.push({ id: "artemis-" + code.toLowerCase(), line, mat, ring });   // ring: walk bounds
  }
  // The outlines usually arrive after the first site is selected.
  highlightRegion(regionHighlight);
  // Already on the surface: swap the stand-in circle for the real bounds.
  if (surface) { surface.bounds = undefined; buildWalkWall(); }
}

export function highlightRegion(siteId) {
  regionHighlight = siteId;
  for (const r of regionOutlines) {
    const on = r.id === siteId;
    r.mat.color.setHex(on ? REGION_SEL : REGION_BASE);
    r.mat.opacity = on ? 0.9 : 0.3;
  }
}

// ── Horizon line (surface view) ──
// In shadow the ground and the sky are both near-black, and the silhouette
// between them vanishes - you lose all sense of where the land ends. This
// traces it from the precomputed skyline: the same elevation-per-azimuth
// curve the Sky panel plots and the illumination metrics are scored against,
// read at the eye height the surface camera actually uses, so the line lands
// exactly on the real silhouette rather than near it.
//
// Drawn with depth testing off. The line marks where terrain meets sky, so it
// has to stay visible over the terrain it is tracing; letting the mesh occlude
// it would hide it precisely where it is wanted.
const HORIZON_COLOR = 0x9fb0c4;
const HORIZON_R_M = 120000;   // far enough to read as the horizon, inside the 300 km mesh
let horizonLine = null;

function clearHorizon() {
  if (!horizonLine) return;
  scene.remove(horizonLine);
  horizonLine.geometry.dispose();
  horizonLine.material.dispose();
  horizonLine = null;
}

async function buildHorizon(siteId) {
  clearHorizon();
  if (!surface || !terrainMesh) return;
  const token = terrainToken;
  let sk;
  try {
    const r = await fetch(`/data/skyline/${siteId}.json`);
    if (!r.ok) return;
    sk = await r.json();
  } catch { return; }
  if (token !== terrainToken || !surface || !terrainMesh) return;   // switched while loading
  const az = sk && sk.az_deg;
  const elByHeight = sk && sk.el_deg;
  if (!Array.isArray(az) || !elByHeight) return;
  // Match the camera's vantage; fall back to the validated 2 m curve.
  const el = elByHeight[String(SURFACE_EYE_M)] || elByHeight["2"] || elByHeight[Object.keys(elByHeight)[0]];
  if (!Array.isArray(el) || el.length !== az.length) return;

  const { up, north, east } = surface;
  const o = terrainMesh.position;
  const r = HORIZON_R_M / 1e6;
  const pos = new Float32Array(az.length * 3);
  for (let i = 0; i < az.length; i++) {
    const a = THREE.MathUtils.degToRad(az[i]);
    const e = THREE.MathUtils.degToRad(el[i]);
    const ch = Math.cos(e) * r, cv = Math.sin(e) * r;
    const ca = Math.cos(a), sa = Math.sin(a);
    pos[i * 3] = (north.x * ca + east.x * sa) * ch + up.x * cv;
    pos[i * 3 + 1] = (north.y * ca + east.y * sa) * ch + up.y * cv;
    pos[i * 3 + 2] = (north.z * ca + east.z * sa) * ch + up.z * cv;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  horizonLine = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({
    color: HORIZON_COLOR, transparent: true, opacity: 0.4, depthTest: false, depthWrite: false,
  }));
  horizonLine.position.copy(o);
  horizonLine.renderOrder = 3;
  horizonLine.frustumCulled = false;
  scene.add(horizonLine);
}

// ── Landing-zone glow (surface view) ──
// The orbital outline is drawn at 1.004 R — about 7 km up — which reads as
// lying on the ground from orbit but hangs in the sky as a wireframe once you
// are standing on the surface. Down here we hide it and drape this instead:
// the boundary resampled every ZONE_STEP_M, every sample dropped onto the same
// ground height the markers use, then widened into a strip that fades to
// nothing at both edges. Additive blending makes those faded edges cost
// nothing, so it reads as a soft glow lying on the regolith, not a drawn line.
const ZONE_HALF_M = 400;    // half-width on the ground: the boundary is 10-30 km out, so a
                            // narrow band would subtend under a degree from the lander
const ZONE_LIFT_M = 4;      // sits this far above the ground, clear of z-fighting
const ZONE_STEP_M = 250;    // resample spacing along the boundary
// Red: amber is Sun/power and cyan is Earth/comms in the data panels, so red is
// the one strong colour left that reads as "edge of the allowed area".
const ZONE_COLOR = new THREE.Color(0xff3b30);
// A flat band on the ground is hidden by the Moon's curvature long before you
// reach it - the boundary is 10-30 km out and the horizon is ~6 km - so the
// band also raises a glow that fades out with height. Anchored on the terrain,
// not floating: it is tall enough to clear the horizon, not tall enough to
// read as a wall.
// Deliberately low-key. The boundary is 10-33 km out, so at this height it
// subtends well under a degree from the lander and mostly stays below the
// terrain skyline (Haworth's runs -4.2 to +2.2 deg): a hint on the horizon
// rather than a wall. It reads properly once you walk near it, which is where
// the distance fade below takes over anyway.
const ZONE_FENCE_M = 120;
// How the boundary reads with range. Beyond ZONE_FAR_M it is the full standing
// glow; inside ZONE_NEAR_M it has folded down to a line ZONE_NEAR_WIDTH as wide
// as the far band. Walking made this necessary: the glow was sized to be seen
// from the lander 5-30 km off, and standing against it filled the screen.
const ZONE_NEAR_M = 400;
const ZONE_FAR_M = 4000;
// 0.006 of the far band = a ~5 m line. Anything wider fills the view from two
// metres up, since the walk bound leaves you standing on top of it.
const ZONE_NEAR_WIDTH = 0.015;
let zoneMesh = null;

function clearZone() {
  if (!zoneMesh) return;
  scene.remove(zoneMesh);
  zoneMesh.geometry.dispose();
  zoneMesh.material.dispose();
  zoneMesh = null;
}

// The floating outlines belong to the orbital view only.
function syncRegionLines() {
  for (const r of regionOutlines) r.line.visible = !surface;
}

function buildZone(siteId) {
  clearZone();
  const ring = regionRings.get(siteId);
  if (!ring || !terrainGrid || !terrainMesh || !surface) return;

  const dirs = [];
  const unit = (p) => latLonToScene(p[1], p[0], 1).normalize();
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = unit(ring[i]), b = unit(ring[i + 1]);
    const steps = Math.max(1, Math.ceil((a.angleTo(b) * R_M) / ZONE_STEP_M));
    for (let k = 0; k < steps; k++) dirs.push(a.clone().lerp(b, k / steps).normalize());
  }
  const n = dirs.length;
  if (n < 3) return;

  // Four vertices per sample, all anchored at the same point on the ground:
  // the band's outer edge, its centre, its inner edge, and the top of the
  // glow. The two offsets that pull them apart ride along as attributes so the
  // vertex shader can scale them by how far away you are. Far off, the glow
  // stands tall enough to clear the skyline; walk up to it and it folds down
  // into a bright line on the regolith you cannot step over.
  const o = terrainMesh.position;
  const pos = new Float32Array(n * 4 * 3);   // the ground point, repeated
  const side = new Float32Array(n * 4 * 3);  // across the boundary
  const lift = new Float32Array(n * 4 * 3);  // up from it
  const col = new Float32Array(n * 4 * 3);
  const half = ZONE_HALF_M / R_M;
  const tang = new THREE.Vector3(), perp = new THREE.Vector3(), off = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    const d = dirs[i];
    tang.subVectors(dirs[(i + 1) % n], dirs[(i - 1 + n) % n]);   // along the boundary
    perp.crossVectors(d, tang).normalize();                      // across it, in the tangent plane
    const ground = terrainHeightAlong(d);
    const gr = (R_M + ground + ZONE_LIFT_M) / 1e6;
    const gx = d.x * gr - o.x, gy = d.y * gr - o.y, gz = d.z * gr - o.z;
    for (let row = 0; row < 4; row++) {
      const k = (i * 4 + row) * 3;
      pos[k] = gx; pos[k + 1] = gy; pos[k + 2] = gz;
      if (row === 0 || row === 2) {                              // the band's two edges
        const sgn = row === 0 ? -1 : 1;
        off.copy(d).addScaledVector(perp, sgn * half).normalize();
        const er = (R_M + terrainHeightAlong(off) + ZONE_LIFT_M) / 1e6;
        side[k] = off.x * er - o.x - gx;
        side[k + 1] = off.y * er - o.y - gy;
        side[k + 2] = off.z * er - o.z - gz;
      } else if (row === 3) {                                    // top of the glow
        lift[k] = d.x * ZONE_FENCE_M / 1e6;
        lift[k + 1] = d.y * ZONE_FENCE_M / 1e6;
        lift[k + 2] = d.z * ZONE_FENCE_M / 1e6;
      }
      const f = row === 1 ? 1 : 0;                               // bright centre, edges and top fade out
      col[k] = ZONE_COLOR.r * f; col[k + 1] = ZONE_COLOR.g * f; col[k + 2] = ZONE_COLOR.b * f;
    }
  }

  const idx = new Uint32Array(n * 3 * 6);
  let t = 0;
  const quad = (A, B, C, D) => { idx[t++] = A; idx[t++] = C; idx[t++] = B; idx[t++] = B; idx[t++] = C; idx[t++] = D; };
  for (let i = 0; i < n; i++) {
    const a = i * 4, b = ((i + 1) % n) * 4;
    quad(a, a + 1, b, b + 1);         // ground, outer half
    quad(a + 1, a + 2, b + 1, b + 2); // ground, inner half
    quad(a + 1, a + 3, b + 1, b + 3); // the glow standing above the centre line
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSide", new THREE.BufferAttribute(side, 3));
  geo.setAttribute("aLift", new THREE.BufferAttribute(lift, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uZoneNear = { value: ZONE_NEAR_M / 1e6 };
    sh.uniforms.uZoneFar = { value: ZONE_FAR_M / 1e6 };
    sh.uniforms.uZoneNarrow = { value: ZONE_NEAR_WIDTH };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec3 aSide;
        attribute vec3 aLift;
        uniform float uZoneNear, uZoneFar, uZoneNarrow;`)
      // Distance to the eye decides the shape: a tall wide glow far off, a
      // narrow line underfoot once you reach it. Worked out here because
      // three runs <color_vertex> before <begin_vertex>, and both need it.
      .replace("#include <color_vertex>", `#include <color_vertex>
        float zoneT = smoothstep( uZoneNear, uZoneFar,
          distance( ( modelMatrix * vec4( position, 1.0 ) ).xyz, cameraPosition ) );
        // Dim it as it closes in: at arm's length a full-strength glow washes
        // the ground out, far off it needs the brightness to carry.
        vColor *= mix( 0.75, 1.0, zoneT );`)
      .replace("#include <begin_vertex>", `
        vec3 transformed = position
          + aSide * mix( uZoneNarrow, 1.0, zoneT )
          + aLift * zoneT;`);
  };
  mat.customProgramCacheKey = () => "zone-distance-v1";

  zoneMesh = new THREE.Mesh(geo, mat);
  zoneMesh.position.copy(o);
  zoneMesh.renderOrder = 2;
  zoneMesh.frustumCulled = false;   // vertices move in the shader, so the baked box lies
  scene.add(zoneMesh);
}

// ── Camera framing & launch view ──
export function frameMoon(distanceUnits = MOON_RADIUS * 8) {
  camera.position.set(distanceUnits * 0.4, distanceUnits * 0.3, distanceUnits);
  controls.target.set(0, 0, 0);
  controls.update();
}

const DEFAULT_LAUNCH_VIEW = {
  // Orbit the Moon's centre (focus stays the Moon), with the camera nearly
  // straight below so the south pole faces us, centred. (Kept just off the exact
  // -Y axis so the +Y up vector stays well-defined.)
  position: [1.3, -7.5, 1.3],
  target: [0, 0, 0],
};

export function applyLaunchView(view = DEFAULT_LAUNCH_VIEW) {
  camera.position.set(...view.position);
  controls.target.set(...view.target);
  controls.update();
}

// Like applyLaunchView, but rotates in: starts swung around the pole axis and a
// little further out, then eases into the centred south-pole framing on load.
export function animateLaunchView() {
  const endPos = new THREE.Vector3(...DEFAULT_LAUNCH_VIEW.position);
  const endTarget = new THREE.Vector3(...DEFAULT_LAUNCH_VIEW.target);
  // Start from the far side near the equator, then sweep ~160° around and down to
  // the south pole — a big spin that brings the pole into view.
  const startPos = new THREE.Vector3(-6.8, 1.6, -3.2);
  camera.position.copy(startPos);
  controls.target.copy(endTarget);
  camera.up.copy(WORLD_UP);
  controls.update();
  startFocusTween(endTarget, endPos, WORLD_UP.clone());
  if (focusTween) focusTween.dur = 2.8;
}

// ── Screen projection (for off-screen indicators + labels) ──
export function worldToScreen(worldPos) {
  const v = _proj.copy(worldPos).project(camera);
  const behind = v.z > 1;
  return {
    x: (v.x * 0.5 + 0.5) * screenW,
    y: (-v.y * 0.5 + 0.5) * screenH,
    behind,
    onScreen: !behind && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1,
  };
}

export function getBodyWorld(which) {
  if (which === "sun") return sunMesh.position;
  if (which === "earth") return earth.position;
  if (which === "moon") return moon.position;
  return null;
}

// Camera debug readout: distance from Moon + spherical angles.
export function getCameraDebug() {
  const p = camera.position;
  const range = p.length() * 1000; // km
  const az = THREE.MathUtils.radToDeg(Math.atan2(p.x, -p.z));
  const el = THREE.MathUtils.radToDeg(Math.asin(p.y / p.length()));
  return { az: ((az % 360) + 360) % 360, el, rangeKm: range, raw: [p.x, p.y, p.z] };
}

// Where the surface camera points, for the sky plot's view box: azimuth
// (0° = north, clockwise, same convention as the sky plot), elevation, and
// the horizontal/vertical field of view, all in degrees. Null in orbit.
export function getSurfaceLook() {
  if (!surface) return null;
  const az = THREE.MathUtils.radToDeg(surface.yaw);
  const vfov = camera.fov;
  const hfov = THREE.MathUtils.radToDeg(
    2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vfov / 2)) * camera.aspect));
  return { az: ((az % 360) + 360) % 360, el: THREE.MathUtils.radToDeg(surface.pitch), hfov, vfov };
}

// Turn the surface camera to face an azimuth (and optionally an elevation),
// e.g. from a click on the sky plot. No-op in orbit.
export function setSurfaceLook(azDeg, elDeg) {
  if (!surface) return;
  lookTween = null;                                  // the sky-plot drag takes over
  pendingLookId = null;
  surface.yaw = THREE.MathUtils.degToRad(azDeg);
  if (elDeg != null) {
    surface.pitch = THREE.MathUtils.clamp(
      THREE.MathUtils.degToRad(elDeg), THREE.MathUtils.degToRad(-25), THREE.MathUtils.degToRad(85));
  }
  applySurfaceOrientation();
}

export function getScreenSize() {
  return { w: screenW, h: screenH };
}
