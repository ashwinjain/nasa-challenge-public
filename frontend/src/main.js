import { renderSkyPlot, setSkyPlotTime, setSkyPlotLook, onSkyPlotClick } from "./skyplot.js";
import * as scene from "./scene3d.js";
import { fmtHours, addDays, daysBetween, kitTonnes } from "./shared/format.js";
import { tilesHtml } from "./shared/tiles.js";
import { mountChat } from "./chat/chat.js";
import { PANEL_HEIGHT_M } from "./shared/assumptions.js";
import { localPower } from "./plan/sunPower.js";

// ── State ──
let skyData = null;
let ephemerisData = null;
let currentView = "orbital"; // "orbital" | "surface"
let currentTimeIndex = 0;
let sites = [];
let selectedSiteName = null;

// ── Fallback site list (only used if sites.json fails to load) ──
const MOCK_SITES = [
  { name: "Haworth", lat: -86.36851, lon: -23.27645, kind: "artemis_region" },
  { name: "Malapert Massif", lat: -86.00114, lon: 2.05502, kind: "artemis_region" },
  { name: "Mons Mouton", lat: -85.44402, lon: 32.19651, kind: "artemis_region" },
  { name: "Mons Mouton Plateau", lat: -85.48429, lon: 29.51768, kind: "artemis_region" },
  { name: "Nobile Rim 1", lat: -85.30028, lon: 37.09893, kind: "artemis_region" },
  { name: "Nobile Rim 2", lat: -83.73716, lon: 59.396, kind: "artemis_region" },
  { name: "Peak Near Cabeus B", lat: -83.61575, lon: -68.59059, kind: "artemis_region" },
  { name: "Slater Plain", lat: -87.2719, lon: 127.60532, kind: "artemis_region" },
  { name: "de Gerlache Rim 2", lat: -88.46512, lon: -67.84885, kind: "artemis_region" },
];

// ── Per-frame overlays ──
// The overlays below run every frame but only redo their DOM work when
// something they depend on changed since the last frame. Most frames nothing
// has (the camera is still and time isn't playing), and then they cost nothing.
const lastInputs = new Map();
function unchanged(name, inputs) {
  const prev = lastInputs.get(name);
  lastInputs.set(name, inputs);
  return !!prev && prev.length === inputs.length && prev.every((v, i) => v === inputs[i]);
}

// ── Camera debug readout ──
function updateCameraDebug() {
  if (unchanged("camDebug", [scene.getVersions().view])) return;
  const el = document.getElementById("cam-debug");
  if (!el) return;
  const d = scene.getCameraDebug();
  el.textContent = `H:${d.az.toFixed(1)}° P:${d.el.toFixed(1)}° R:${d.rangeKm.toFixed(0)}km`;
}

// ── Sky plot view box (surface view's horizon minimap) ──
function updateSkyPlotLook() {
  if (unchanged("skyLook", [scene.getVersions().view, currentView])) return;
  setSkyPlotLook(currentView === "surface" ? scene.getSurfaceLook() : null);
}

// ── Walk hint (surface view) ──
// The keys while you stand at the lander; once you've walked, how far you are
// and how to get back; at the bounds, why you stopped.
function updateWalkHint() {
  const w = currentView === "surface" ? scene.getSurfaceWalk() : null;
  const dist = w ? Math.round(w.distM) : 0;
  if (unchanged("walkHint", [scene.getVersions().walk, currentView, w && w.ready, dist])) return;
  const el = document.getElementById("walk-hint");
  if (!el) return;
  el.hidden = !(w && w.ready);
  if (el.hidden) return;
  el.classList.toggle("at-edge", w.atEdge);
  const far = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${dist} m`;
  el.innerHTML = w.atEdge
    ? `Edge of the site region · <kbd>R</kbd> back to lander`
    : dist < 1
      ? `<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> sprint`
      : `${far} from lander · <kbd>R</kbd> back`;
  // Its width changes with the text: keep it beside Focus and the stats clear of it.
  placeWalkHint();
  positionMetricsStrip();
}

// ── Off-screen body indicators ──
// A small caret + label at the screen edge pointing toward an off-screen body.
// Only the caret rotates; the text stays upright. The two never overlap.
const _indicatorPositions = {};

// How much of each screen edge the HUD covers (top bar, site sidebar, and
// the time-scrubber strip above the status bar), so the indicators stay in
// the open part of the view. Measured once and kept until one of those
// changes size (watchHudInsets), not every frame.
const HUD_EDGE_IDS = ["top-bar", "site-sidebar", "sky-panel", "time-scrubber-container", "status-bar"];
let hudInsetsCache = null;

function hudInsets() {
  if (hudInsetsCache) return hudInsetsCache;
  const rect = (id) => {
    const el = document.getElementById(id);
    return el && el.offsetParent ? el.getBoundingClientRect() : null;
  };
  const top = rect("top-bar");
  const side = rect("site-sidebar");
  const card = rect("sky-panel");   // the Sky panel pinned top-right
  const bottom = rect("time-scrubber-container") || rect("status-bar");
  hudInsetsCache = {
    top: top ? top.bottom : 0,
    left: side ? side.right : 0,
    right: card ? window.innerWidth - card.left : 0,
    bottom: bottom ? window.innerHeight - bottom.top : 0,
  };
  return hudInsetsCache;
}

function watchHudInsets() {
  const reset = () => { hudInsetsCache = null; };
  window.addEventListener("resize", reset);
  // Also fires when the HUD first shows (its parts go from 0×0 to their size).
  const ro = new ResizeObserver(reset);
  for (const id of HUD_EDGE_IDS) {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  }
}

function updateOffscreenIndicators() {
  const insets = hudInsets();
  const v = scene.getVersions();
  if (unchanged("indicators", [v.view, v.bodies, insets])) return;
  _indicatorPositions.sun = null;
  _indicatorPositions.earth = null;
  computeIndicator("indicator-sun", "sun", insets);
  computeIndicator("indicator-earth", "earth", insets);
  separateIndicators();
}

function computeIndicator(elId, bodyKey, insets) {
  const el = document.getElementById(elId);
  if (!el) return;
  const world = scene.getBodyWorld(bodyKey);
  if (!world) { el.style.display = "none"; return; }

  const scr = scene.worldToScreen(world);
  const { w, h } = scene.getScreenSize();
  const cx = w / 2, cy = h / 2;

  if (scr.onScreen) { el.style.display = "none"; return; }

  // Direction from screen center toward the body (flip when behind camera).
  let dx = scr.x - cx, dy = scr.y - cy;
  if (scr.behind) { dx = -dx; dy = -dy; }
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) { el.style.display = "none"; return; }
  const angle = Math.atan2(dy, dx);

  const margin = 30;
  const minX = insets.left + margin;
  const maxX = w - (insets.right || 0) - margin;
  const minY = insets.top + margin;
  const maxY = h - insets.bottom - margin;
  const edgeX = Math.max(minX, Math.min(maxX, cx + Math.cos(angle) * (w / 2 - margin)));
  const edgeY = Math.max(minY, Math.min(maxY, cy + Math.sin(angle) * (h / 2 - margin)));

  _indicatorPositions[bodyKey] = { el, x: edgeX, y: edgeY };

  const caret = el.querySelector(".indicator-caret");
  if (caret) caret.style.transform = `rotate(${angle}rad)`;

  el.style.display = "flex";
  el.style.left = edgeX + "px";
  el.style.top = edgeY + "px";
  el.style.transform = "translate(-50%, -50%)";
}

function separateIndicators() {
  const a = _indicatorPositions.sun;
  const b = _indicatorPositions.earth;
  if (!a || !b) return;

  const dx = a.x - b.x, dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = 50;
  if (dist < minDist && dist > 0) {
    const push = (minDist - dist) / 2;
    const nx = dx / dist, ny = dy / dist;
    a.x += nx * push; a.y += ny * push;
    b.x -= nx * push; b.y -= ny * push;
    a.el.style.left = a.x + "px"; a.el.style.top = a.y + "px";
    b.el.style.left = b.x + "px"; b.el.style.top = b.y + "px";
  }
}

// ── Intro ──
async function playIntro() {
  const statusEl = document.getElementById("intro-status");
  const exploreBtn = document.getElementById("explore-btn");

  scene.applyLaunchView();
  statusEl.textContent = "Earth–Moon–Sun system";
  await delay(1200);
  statusEl.textContent = "Artemis south pole region";
  exploreBtn.style.display = "block";
}

function skipIntro() {
  document.getElementById("intro-overlay").classList.add("hidden");
  document.getElementById("main-hud").style.display = "block";
  scene.animateLaunchView();   // rotate in to the centred south-pole view
  // Panels can only be measured once the HUD is showing.
  keepPanelsAboveScrubber();
  applyViewLayout();   // now that the sidebar has size, attach the Solar panel under it
  // The first site's data usually loads during the intro, while the HUD is
  // hidden, and the chart can't be drawn into a zero-size panel. Draw it now.
  if (skyData) { const v = viewData(); renderScrubberTracks(v); }
}

// ── Data ──
// Try precomputed static JSON first (curated sites, default month only);
// fall back to the backend API (lunarsky/api.py) for custom sites or dates.
async function fetchSkyData(lat, lon, start, end, siteName) {
  const site = sites.find((s) => s.name === siteName);
  if (site && site.id) {
    try {
      const res = await fetch(`/data/sky/${site.id}.json`);
      if (res.ok) {
        const data = await res.json();
        // The file covers one window; use it only if the requested dates match.
        const w = data.metrics && data.metrics.window;
        if (w && w.start_utc.slice(0, 10) === start && w.end_utc.slice(0, 10) === end) {
          if (data.times_utc) data.times = data.times_utc;
          return data;
        }
      }
    } catch { /* fall through to API */ }
  }

  // Live backend for custom coords, other dates, or missing precomputed data.
  // Throws an Error whose message is fit to show the user. `terrain=true`
  // adds the same terrain block the precomputed files carry.
  const params = new URLSearchParams({ lat, lon, start, end, step_hours: 1, site_name: siteName, terrain: true });
  if (site && site.id) params.set("site_id", site.id);
  const unreachable = (why) =>
    new Error(`Couldn't get sky data from the backend (${why}). Locally, start it with \`make dev-backend\`.`);
  let res;
  try {
    res = await fetch(`/api/sky?${params}`);
  } catch {
    throw unreachable("no response");
  }
  if (!res.ok) {
    // FastAPI explains a rejected request in `detail` (a string for our own
    // checks, a list for parameter validation). Anything else means the
    // backend itself isn't there or broke.
    let detail = null;
    try {
      const body = await res.json();
      detail = Array.isArray(body.detail) ? body.detail.map((d) => d.msg).join("; ") : body.detail;
    } catch { /* not JSON */ }
    if (res.status < 500 && detail) throw new Error(detail);
    throw unreachable(`HTTP ${res.status}`);
  }
  const data = await res.json();
  if (data.times_utc) data.times = data.times_utc;
  return data;
}

// The terrain skyline for a point (az_deg, and el_deg per eye height), from
// the precomputed file for listed sites or the backend otherwise. Null if
// neither has one; the sky plot then just leaves the skyline out.
async function fetchSkyline(lat, lon, siteId) {
  const urls = [];
  if (siteId) urls.push(`/data/skyline/${siteId}.json`);
  urls.push(`/api/skyline?${new URLSearchParams({ lat, lon })}`);
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* try the next source */ }
  }
  return null;
}

// Site list: precomputed from data/phase-3/sites.csv → public/data/sites.json
async function fetchSites() {
  try {
    const res = await fetch("/data/sites.json");
    if (!res.ok) throw new Error(await res.text());
    const list = await res.json();
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    console.warn("Could not load sites.json, using built-in site list");
    return null;
  }
}

// Site-independent Sun/Earth orbital track for the default window; drives the
// simulator's lighting so it doesn't change when you switch sites.
async function fetchEphemeris() {
  try {
    const res = await fetch("/data/ephemeris.json");
    if (!res.ok) return null;
    const eph = await res.json();
    return Array.isArray(eph.subsolar_lat) ? eph : null;
  } catch {
    return null;
  }
}

// The terrain maps reach ~60°S to the pole. All 9 listed sites are inside
// them; a custom point outside gets the smooth-Moon answer only.
const inTerrainMaps = (s) => s.lat <= -60;

// ── UI: Site sidebar ──
function populateSiteSelector() {
  const list = document.getElementById("site-list");
  const count = document.getElementById("site-count");
  list.innerHTML = "";
  count.textContent = sites.length;


  const addItem = (site) => {
    const item = document.createElement("div");
    item.className = "site-item";
    item.dataset.name = site.name;

    const name = document.createElement("div");
    name.className = "site-name";
    name.textContent = site.name;

    const meta = document.createElement("div");
    meta.className = "site-meta";
    // Average sunlight lives on the ⓘ card, where it has room to say what it
    // means and where it came from. Repeating it per row made the list read as
    // a ranking rather than a browse list.
    meta.innerHTML = `<span>${site.lat.toFixed(2)}°, ${site.lon.toFixed(2)}°</span>`;

    // ⓘ opens the detail card on the right; clicking the row just selects + flies.
    const info = document.createElement("button");
    info.className = "site-info-btn";
    info.title = `Details for ${site.name}`;
    info.setAttribute("aria-label", `Details for ${site.name}`);
    info.innerHTML = `<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="4.1" r="0.95" fill="currentColor"/><rect x="6.25" y="6" width="1.5" height="4.3" fill="currentColor"/></svg>`;
    info.addEventListener("click", (e) => { e.stopPropagation(); selectSite(site.name, true, true); });

    item.append(name, meta, info);
    item.addEventListener("click", () => selectSite(site.name, false, true));
    list.appendChild(item);
  };

  const header = document.createElement("div");
  header.className = "site-group-header";
  header.textContent = "Artemis III";
  list.appendChild(header);
  for (const site of sites) addItem(site);

  const defaultSite = sites[0];
  if (defaultSite) selectSite(defaultSite.name);
}

// ── Site details popup ──
// Shows every field from the source sites.csv record, in plain language.
const KIND_LABELS = {
  artemis_region: "Artemis III candidate region",
};
const METHOD_LABELS = {
  sunniest_in_region: "Sunniest in region",
};

// Water ice near each region (Phase 7, information only): data/water_ice.json.
let waterIce = null;
fetch("/data/water_ice.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
  waterIce = j ? new Map(j.regions.map((x) => [x.id, x.nearest_shadowed_area])) : null;
}).catch(() => {});

// Label/value blocks, the same layout as the landing card. Long free text
// (source, notes) goes under its label instead of squeezed to the right.
function renderSiteInfo(site) {
  const body = document.getElementById("site-info-body");
  document.getElementById("site-info-name").textContent = site.name;
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = (pairs) => `<dl class="ps-kv">${pairs.map(([k, v, cls = ""]) => `<dt>${esc(k)}</dt><dd class="${cls}">${esc(v)}</dd>`).join("")}</dl>`;
  const text = (k, v) => `<div class="si-text"><div class="si-text-k">${esc(k)}</div><div class="si-text-v${v ? "" : " muted"}">${esc(v || "None recorded")}</div></div>`;
  const block = (title, tag, html) =>
    `<div class="ps-blk"><div class="ps-blk-h">${title}${tag ? `<span class="ps-tag">${esc(tag)}</span>` : ""}</div>${html}</div>`;
  body.innerHTML =
    block("Location", KIND_LABELS[site.kind] || site.kind || "", rows([
      ["Latitude", `${site.lat.toFixed(5)}°`],
      ["Longitude (east +)", `${site.lon.toFixed(5)}°`],
    ])) +
    block("Sunlight", site.sunlit_map ? `NASA map, ${String(site.sunlit_map).replace(/(\d)m$/, "$1 m")}` : "", site.avg_sunlit != null
      ? rows([["Average sunlit", `${(site.avg_sunlit * 100).toFixed(1)}%`, "sun"]])
      : `<div class="si-text-v muted">Not covered by the polar sunlight maps</div>`) +
    (waterIce?.get(site.id) ? (() => {
      const w = waterIce.get(site.id);
      return block("Water ice nearby", "info only", rows([
        ["Nearest shadowed area", `${w.area_km2} km², ${w.distance_km.toFixed(1)} km away`],
        ["Hottest it gets", `${Math.round(w.hottest_it_gets_K)} K`],
        ["Cold enough for surface ice", `${Math.round(w.share_cold_enough_for_surface_ice_pct)}%`],
      ]) + text("Note", "Too far to walk (300 m on foot), so reaching it needs a rover. Never counted in the kit or rankings."));
    })() : "") +
    block("Record", "", rows([
      ["Pin", METHOD_LABELS[site.method] || site.method || "—"],
      ["ID", site.id || "—"],
    ]) + (site.source ? text("Source", site.source) : "") + (site.notes ? text("Notes", site.notes) : ""));
}

function showSiteInfo(site) {
  if (!site) return;
  renderSiteInfo(site);
  const el = document.getElementById("site-info");
  el.style.display = "flex";
  positionSiteInfo();
}

// The details card opens on the right, under the Sky panel (or at the top
// when that's collapsed or hidden), and stops above whatever is below it:
// the chat box, and the timeline where the timeline reaches under it. It
// scrolls inside that height. Re-run by layoutHud on resize and whenever the
// Sky panel, timeline or chat change size.
function positionSiteInfo() {
  const el = document.getElementById("site-info");
  if (!el || el.style.display === "none") return;
  const sky = document.getElementById("sky-panel");
  const skyR = sky && sky.style.display !== "none" ? sky.getBoundingClientRect() : null;
  const topBar = document.getElementById("top-bar").getBoundingClientRect();
  const top = (skyR && skyR.height ? skyR.bottom : topBar.bottom) + 8;
  const right = window.innerWidth - 12;
  const width = Math.min(skyR && skyR.width ? skyR.width : 320, window.innerWidth - 24);
  const left = right - width;
  let floor = window.innerHeight - 12;
  const below = (id) => {
    const r = document.getElementById(id)?.getBoundingClientRect();
    if (r && r.height && r.left < right && r.right > left && r.top > top) floor = Math.min(floor, r.top - 8);
  };
  below("chat");
  below("time-scrubber-container");
  el.style.top = top + "px";
  el.style.width = width + "px";
  el.style.maxHeight = Math.max(80, floor - top) + "px";
}

function hideSiteInfo() {
  document.getElementById("site-info").style.display = "none";
}

// Click anywhere that isn't the detail card or the sites list dismisses it.
document.addEventListener("click", (e) => {
  const el = document.getElementById("site-info");
  if (!el || el.style.display === "none") return;
  if (el.contains(e.target) || e.target.closest("#site-sidebar")) return;
  hideSiteInfo();
});

function selectSite(name, openInfo = false, fly = false) {
  selectedSiteName = name;
  applyViewLayout();   // the Sky plot shows once a site is picked
  clearLandingFocus();
  const customDiv = document.getElementById("custom-coords");

  if (name === "__custom__") {
    hideSiteInfo();
    customDiv.style.display = "flex";
    document.querySelectorAll(".site-item").forEach(el => el.classList.remove("active"));
  } else {
    customDiv.style.display = "none";
    document.querySelectorAll(".site-item").forEach(el => {
      el.classList.toggle("active", el.dataset.name === name);
    });
    const url = new URL(window.location);
    url.searchParams.set("site", name);
    window.history.replaceState({}, "", url);

    const site = sites.find((s) => s.name === name);
    if (site) scene.highlightRegion(site.id || null);
    if (site?.id) warmSite(site.id);
    // A site click recenters the camera: stand on the spot in surface view, or
    // zoom/angle in to it in orbital view. The initial load passes fly=false so
    // it keeps the south-pole overview.
    if (site && fly) {
      if (currentView === "surface") enterSurfaceAt(site);
      else scene.focusSite(site.lat, site.lon);
    }

    // Open the details popup on a user click; if it's already open, keep it
    // in sync with the newly selected site.
    const infoOpen = document.getElementById("site-info").style.display !== "none";
    if (site && (openInfo || infoOpen)) showSiteInfo(site);

    renderYearMetrics();
    if (site && site.id) {
      const start = document.getElementById("date-start").value;
      const end = document.getElementById("date-end").value;
      const state = { siteName: name, lat: site.lat, lon: site.lon, start, end };
      loadAndRender(state);
    }
  }
}

// ── Site markers overlay (the 9 Artemis III regions on the globe) ──
// Labels declutter (selected + hovered + whatever fits without overlapping),
// and back-hemisphere markers are hidden. Markers use a neutral slate on
// purpose: amber and cyan are reserved for Sun/power and Earth/comms.
const siteColor = () => "#aab4c6";

let markerEls = [];       // { site, dot, label, leader }
let hoveredSiteId = null;

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function buildSiteMarkers() {
  const layer = document.getElementById("site-markers");
  const svg = document.getElementById("site-leaders");
  markerEls.forEach((m) => { m.dot.remove(); m.label.remove(); m.leader.remove(); });
  markerEls = [];

  for (const site of sites) {
    if (!site.id) continue;
    const offset = { ox: 0, oy: 0 };
    const dot = document.createElement("div");
    dot.className = "site-dot";
    dot.style.setProperty("--cat", siteColor(site)); // ring + pip colour (overridable when selected)

    const label = document.createElement("div");
    label.className = "site-label";
    label.textContent = site.name;

    const leader = document.createElementNS("http://www.w3.org/2000/svg", "line");
    leader.setAttribute("class", "site-leader");

    const enter = () => { hoveredSiteId = site.id; };
    const leave = () => { if (hoveredSiteId === site.id) hoveredSiteId = null; };
    const click = () => selectSite(site.name, true, true);
    for (const el of [dot, label]) {
      el.addEventListener("mouseenter", enter);
      el.addEventListener("mouseleave", leave);
      el.addEventListener("click", click);
    }

    svg.appendChild(leader);
    layer.appendChild(dot);
    layer.appendChild(label);
    markerEls.push({ site, dot, label, leader, offset });
  }
}

const LABEL_GAP = 14; // px from dot to label chip
// Toggle between the orbital (whole-globe) view and the first-person moon
// surface view of the currently selected site.
function setView(view) {
  if (view === currentView) return;
  const site = sites.find((s) => s.name === selectedSiteName);
  clearLandingFocus();
  if (view === "surface") {
    if (!site) return;
    enterSurfaceAt(site);
  } else {
    scene.exitSurfaceView();
  }
  currentView = view;
  updateSurfaceBtn();
  applyViewLayout();
}

// The surface toggle is a single prominent action: "Stand on the surface" from
// orbit, "Back to orbit" while on the ground.
function updateSurfaceBtn() {
  const btn = document.getElementById("surface-btn");
  const label = document.getElementById("surface-btn-label");
  if (!btn || !label) return;
  const onSurface = currentView === "surface";
  btn.classList.toggle("active", onSurface);
  label.textContent = onSurface ? "← Back to orbit" : "Stand on the surface";
}

// Show only the panels that make physical sense for the current view. The solar
// card is per-selected-site and stays in both views; the Sky track is
// surface-only (sun/Earth true elevation is only correct on the ground).
function applyViewLayout() {
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? "" : "none"; };
  const surface = currentView === "surface";
  document.body.classList.toggle("view-surface", surface);   // drives the surface-only "stand on the surface" hint
  // The Sky plot shows whenever a site is selected, in both views.
  show("sky-panel", !!selectedSiteName);
  show("panel-site-panel", true);
  positionSitePanel();
  positionMetricsStrip();
  positionSiteInfo();
  keepPanelsAboveScrubber();   // the Sky panel measures 0×0 until it's shown
  placeFocusHint();            // likewise the Plan button, until the HUD reveals
}

// The Solar panel is really per-selected-site info, so it hangs directly under
// the Sites card as one connected left column (not a separate floating box).
// The landing card hangs under the Sites card as one left column (the Sky
// panel is pinned top-right).
//
// The left column is: Sites card, landing card, then the map-layer toggle at
// the bottom. Its floor is the status bar, or the timeline when the timeline
// reaches under the column (narrow windows). The landing card's max-height
// is what's left between its real top and that floor, so the card never runs
// under the Sites card, the toggle or the timeline, and it scrolls instead of
// being clipped. Re-run on window resize and whenever the Sites card, the
// timeline or the Sky panel change size (watchLayout).
function leftColumnFloor() {
  const sb = document.getElementById("site-sidebar").getBoundingClientRect();
  const status = document.getElementById("status-bar")?.getBoundingClientRect();
  const scrub = document.getElementById("time-scrubber-container").getBoundingClientRect();
  let floor = status && status.height ? status.top : window.innerHeight;
  if (scrub.height && scrub.left < sb.right + 6) floor = Math.min(floor, scrub.top);
  return floor - 8;
}

const CARD_MIN_H = 150;   // the landing card's share of a short left column

function positionSitePanel() {
  const side = document.getElementById("site-sidebar");
  if (!side.getBoundingClientRect().height) return;   // HUD still hidden; positioned again on reveal
  let floor = leftColumnFloor();
  // On a short window the Sites list gives up height (it scrolls) so the
  // landing card keeps at least CARD_MIN_H.
  const toggleH = document.getElementById("psr-toggle")?.offsetHeight || 0;
  const sideTop = side.getBoundingClientRect().top;
  side.style.maxHeight = Math.max(120, floor - (toggleH ? toggleH + 8 : 0) - CARD_MIN_H - 8 - sideTop) + "px";
  const sb = side.getBoundingClientRect();
  // The globe's map-layer toggle docks at the bottom of the column.
  const toggle = document.getElementById("psr-toggle");
  if (toggle && toggle.offsetHeight) {
    toggle.style.bottom = "auto";
    toggle.style.top = (floor - toggle.offsetHeight) + "px";
    floor -= toggle.offsetHeight + 8;
  }
  const panel = document.getElementById("panel-site-panel");
  if (!panel || panel.style.display === "none") return;
  // Enlarged, the card lays over the Sites list for the room; otherwise it
  // sits under it.
  const top = panel.classList.contains("expanded") ? sb.top : sb.bottom + 8;
  panel.style.top = top + "px";
  panel.style.maxHeight = Math.max(60, floor - top) + "px";
}

// The full-year tiles sit in the top row, in the gap between the brand and
// left column and the Sky panel and top-right buttons (or the right edge),
// never on top of any of them; the tiles wrap when the gap is narrow.
function positionMetricsStrip() {
  const el = document.getElementById("timeline-metrics");
  if (!el || el.style.display === "none") return;
  const sb = document.getElementById("site-sidebar").getBoundingClientRect();
  if (!sb.height) return;
  const shown = (id) => {
    const e = document.getElementById(id);
    if (!e || getComputedStyle(e).display === "none") return null;
    const r = e.getBoundingClientRect();
    return r.width ? r : null;
  };
  const brand = shown("top-bar-brand");
  // The enlarged landing card reaches up beside the brand: stay right of it.
  const card = document.getElementById("panel-site-panel");
  const big = card && card.classList.contains("expanded") ? shown("panel-site-panel") : null;
  const left = Math.max(sb.right, brand ? brand.right : 0, big ? big.right : 0) + 12;
  const rightEdges = ["sky-panel", "walk-hint", "focus-hint", "plan-btn"].map(shown).filter(Boolean).map((r) => r.left);
  const right = Math.min(window.innerWidth, ...rightEdges) - 12;
  el.classList.add("fitted");
  el.style.left = left + "px";
  el.style.width = Math.max(0, right - left) + "px";
}

function layoutHud() {
  keepPanelsAboveScrubber();
  positionSitePanel();
  positionMetricsStrip();
  positionSiteInfo();
  placeFocusHint();
}

function watchLayout() {
  let raf = 0;
  const again = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layoutHud); };
  window.addEventListener("resize", () => { layoutHud(); again(); });
  const ro = new ResizeObserver(again);
  for (const id of ["site-sidebar", "time-scrubber-container", "sky-panel", "status-bar", "chat"]) {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  }
}

function updateSiteMarkers() {
  if (!markerEls.length) return;
  if (unchanged("sites", [scene.getVersions().view, currentView, selectedSiteName, hoveredSiteId, markerEls])) return;
  // No site pins while standing on the surface — you're inside the scene.
  if (currentView === "surface") {
    for (const m of markerEls) { m.dot.style.display = "none"; m.label.style.display = "none"; m.leader.style.display = "none"; }
    return;
  }
  const { w, h } = scene.getScreenSize();
  if (!w || !h) return;   // nothing on screen to place labels on

  // Project every site; decide near/far-side visibility.
  const items = markerEls.map((m) => {
    const p = scene.projectSurface(m.site.lat, m.site.lon);
    p.x += m.offset.ox;
    p.y += m.offset.oy;
    return { m, p };
  });
  for (const it of items) {
    it.visible = !it.p.behind && it.p.facing > 0.04;
    const { dot, label, leader } = it.m;
    if (!it.visible) {
      dot.style.display = "none";
      label.style.display = "none";
      leader.style.display = "none";
      continue;
    }
    dot.style.display = "block";
    dot.style.left = `${it.p.x}px`;
    dot.style.top = `${it.p.y}px`;
    dot.style.opacity = String(Math.min(1, (it.p.facing - 0.04) / 0.18 + 0.35)); // fade at the limb
  }

  // Label priority: selected, then hovered, then most face-on first.
  const visible = items.filter((it) => it.visible).sort((a, b) => {
    const as = a.m.site.name === selectedSiteName, bs = b.m.site.name === selectedSiteName;
    if (as !== bs) return as ? -1 : 1;
    const ah = a.m.site.id === hoveredSiteId, bh = b.m.site.id === hoveredSiteId;
    if (ah !== bh) return ah ? -1 : 1;
    return b.p.facing - a.p.facing;
  });

  const placed = [];
  for (const it of visible) {
    const { m, p } = it;
    const sel = m.site.name === selectedSiteName;
    const forced = sel || m.site.id === hoveredSiteId;
    const text = m.site.name;
    const approxW = text.length * 6.8 + 18;
    const side = (p.x + LABEL_GAP + approxW > w - 8) ? "left" : "right";
    const lx = side === "right" ? p.x + LABEL_GAP : p.x - LABEL_GAP - approxW;
    const rect = { x: lx, y: p.y - 11, w: approxW, h: 22 };

    const collides = placed.some((r) => rectsOverlap(r, rect));
    m.dot.classList.toggle("selected", sel);

    if (forced || !collides) {
      placed.push(rect);
      m.label.style.display = "block";
      m.label.style.left = `${lx}px`;
      m.label.style.top = `${p.y}px`;
      m.label.classList.toggle("selected", sel);
      m.leader.style.display = "block";
      m.leader.setAttribute("x1", p.x);
      m.leader.setAttribute("y1", p.y);
      m.leader.setAttribute("x2", side === "right" ? lx : lx + approxW);
      m.leader.setAttribute("y2", p.y);
      m.leader.classList.toggle("selected", sel);
    } else {
      m.label.style.display = "none";
      m.leader.style.display = "none";
    }
  }
}

async function fetchRegions() {
  try {
    const res = await fetch("/data/artemis_regions.geojson");
    if (!res.ok) return null;
    const gj = await res.json();
    return Array.isArray(gj.features) ? gj.features : null;
  } catch {
    return null;
  }
}

// ── Full-year metrics ──
const fmtSpan = (hours) => (hours == null ? "none in window" : fmtHours(hours, 1));

// Every number on the main page (the tiles and the landing card) is for a
// full year at the region's #1 landing target's panel spot, panels and
// antenna 10 m up: the same hourly Sun file and the same sizing code as
// Plan → Power & landing (plan/sunPower.js), so landing there on YEAR_START
// for a year gives the same numbers in both places. The playback window
// never changes them.
const YEAR_START = "2027-01-01";
const YEAR_LABEL = YEAR_START.slice(0, 4);
const yearPowerP = new Map();     // site id → Promise of the sized year (or null)
const yearPowerDone = new Map();  // site id → the result (or null) once it's in

function yearPower(siteId) {
  if (!yearPowerP.has(siteId)) {
    yearPowerP.set(siteId, localPower({ id: siteId }, YEAR_START, {}, 365)
      .catch((e) => { console.warn("Full-year power", siteId, e); return null; })
      .then((r) => { yearPowerDone.set(siteId, r || null); return r || null; }));
  }
  return yearPowerP.get(siteId);
}

const pctRound = (f) => `${Math.round(f * 100)}%`;

let metricsSeq = 0;
function renderYearMetrics() {
  const el = document.getElementById("timeline-metrics");
  if (!el) return;
  const site = sites.find((s) => s.name === selectedSiteName);
  const seq = ++metricsSeq;
  const hide = () => { el.style.display = "none"; el.innerHTML = ""; };
  if (!site || !site.id) { hide(); return; }
  const draw = (r) => {
    // r undefined: still working it out, so dashes, never the last site's numbers.
    const v = (f) => (r ? f(r) : "—");
    const tiles = [
      ["Sunlit", v((x) => pctRound(x.sunlit_fraction)), "sun"],
      ["Longest night", v((x) => fmtHours(x.longest_dark_hours)), "sun"],
      ["Earth contact", v((x) => pctRound(x.contact_fraction)), "earth"],   // Earth up and a DSN dish in view
      ["Longest Earth blackout", v((x) => (x.data ? fmtHours(x.data.longest_blackout_hours) : "—")), "earth"],
    ];
    const region = topTargets.get(site.id)?.region || site.name;
    el.innerHTML = tilesHtml(tiles.map(([label, value, kind]) => ({ label, value, kind })))
      + `<div class="metrics-scope" title="Full year ${YEAR_LABEL} at ${region}'s landing target #1 panel spot, panels and antenna ${PANEL_HEIGHT_M} m up: the same numbers as the card and as Plan → Power & landing for a year from ${YEAR_START}. Earth contact: Earth above the skyline and a DSN dish seeing the Moon. The playback window doesn't change them.">Full year ${YEAR_LABEL} · landing target #1 panel spot, ${PANEL_HEIGHT_M} m up</div>`;
    el.style.display = "flex";
    positionMetricsStrip();
  };
  if (yearPowerDone.has(site.id)) {
    const r = yearPowerDone.get(site.id);
    if (r) draw(r); else hide();
    return;
  }
  draw(undefined);
  yearPower(site.id).then((r) => {
    if (seq !== metricsSeq) return;
    if (r) draw(r); else hide();
  });
}

// ── Horizon model: smooth Moon or terrain skyline ──
// The loaded data always holds both answers: the top level is the smooth
// Moon, and `terrain.heights[h]` has the sunlit/earth_visible flags and
// metrics against the real skyline at each eye height. Switching only
// changes which one the tiles, timeline and sky plot are given; nothing is
// refetched. The 3D scene doesn't use either.
// Horizon is always the real terrain skyline now (the Smooth/Terrain toggle was
// removed). A site with no terrain map still falls back to the smooth answer
// automatically in viewData().
const horizonMode = "terrain";
// Always a person standing on the ground: 2 m. Key into terrain.heights / skyline.el_deg.
const eyeKey = "2";
// Earth contact: the antenna on a 10 m mast (plan/windows.js ANTENNA_HEIGHT_M).
const ANTENNA_KEY = "10";

function terrainOf(data) {
  const t = data && data.terrain;
  return t && t.available ? t : null;
}

// The loaded data as the chosen horizon model sees it.
function viewData() {
  if (!skyData) return null;
  const t = terrainOf(skyData);
  if (horizonMode !== "terrain" || !t) return { ...skyData, skyline: null };
  const key = t.heights[eyeKey] ? eyeKey : Object.keys(t.heights)[0];
  const h = t.heights[key];
  const file = skyData.skylineFile;
  const skyline = file && file.el_deg && file.el_deg[key]
    ? { az: file.az_deg, el: file.el_deg[key], eye: key,
        // The panels' view from their 10 m mast, drawn alongside the person's.
        panel: file.el_deg["10"] && key !== "10" ? file.el_deg["10"] : null }
    : null;
  // Earth contact is at the antenna on a 10 m mast; the Sun stays at the eye.
  const ant = t.heights[ANTENNA_KEY] || h;
  const metrics = h.metrics && ant.metrics ? { ...h.metrics, earth: ant.metrics.earth } : h.metrics;
  return { ...skyData, sunlit: h.sunlit, earth_visible: ant.earth_visible, metrics, skyline };
}

// "phase-6/LDEM_80S_20MPP_ADJ.TIF (±10 km) + phase-2/…80MPP… + …240MPP…"
// → "20 m map (±10 km), then 80 m and 240 m maps"
function describeSource(src) {
  if (!src) return "";
  const parts = src.split(" + ").map((p) => {
    const m = p.match(/_(\d+)MPP/);
    const win = p.match(/\(([^)]+)\)/);
    return m ? `${m[1]} m${win ? ` (${win[1]})` : ""}` : p;
  });
  if (parts.length === 1) return `${parts[0]} map`;
  const rest = parts.slice(1);
  const tail = rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(", ")} and ${rest[rest.length - 1]}`;
  return `${parts[0]} map, then ${tail} maps`;
}

function updateHorizonControls() {
  const t = terrainOf(skyData);
  const terrainOn = horizonMode === "terrain" && !!t;
  const note = document.getElementById("timeline-note");
  if (!note) return;
  if (terrainOn) {
    const eyeText = `${eyeKey} m eye`;
    note.textContent = `Terrain skyline · ${eyeText} · ${describeSource(t.source)}` +
      (t.partial ? " · some directions run off the maps" : "");
    note.title = t.source;
  } else {
    note.textContent = skyData && !t
      ? "Smooth Moon — no terrain map covers this spot (maps reach ~60°S)"
      : "Smooth Moon — terrain ignored";
    note.title = "";
  }
}

// Redraw everything that depends on the horizon model.
function renderView() {
  updateHorizonControls();
  const v = viewData();
  if (!v) return;
  // The tiles are full-year (renderYearMetrics), not this window's.
  renderScrubberTracks(v);
  renderSkyPlot(v);
}

// Paint power (amber = sunlit) and comms (cyan = Earth in view) as two thin
// tracks on the time scrubber, with little ticks at each transition
// (sunrise/sunset, comms acquire/loss). The viewBox is fixed 0..1000 and scales
// to the slider width, so no redraw is needed on resize.
function renderScrubberTracks(data) {
  const svg = document.getElementById("scrubber-tracks");
  if (!svg) return;
  if (!data || !data.times || data.times.length < 2) { svg.innerHTML = ""; return; }
  const n = data.times.length;
  const flags = (f, el) => (Array.isArray(f) && f.length === n) ? f.map(Boolean) : el.map((e) => e > 0);
  const sunUp = flags(data.sunlit, data.sun_el);
  const earthUp = flags(data.earth_visible, data.earth_el);
  const bothUp = sunUp.map((s, i) => s && earthUp[i]);
  const W = 1000, laneH = 5, gap = 2;
  const x = (i) => (i / (n - 1)) * W;
  const runs = (f) => { const segs = []; let s = null; for (let i = 0; i < n; i++) { if (f[i] && s === null) s = i; else if (!f[i] && s !== null) { segs.push([s, i]); s = null; } } if (s !== null) segs.push([s, n]); return segs; };
  const lane = (f, y, color) => {
    let h = `<rect x="0" y="${y}" width="${W}" height="${laneH}" rx="2" fill="rgba(255,255,255,0.07)"/>`;
    for (const [a, b] of runs(f)) {
      const x0 = x(a), x1 = x(Math.min(b, n - 1));
      h += `<rect x="${x0.toFixed(1)}" y="${y}" width="${Math.max(1, x1 - x0).toFixed(1)}" height="${laneH}" rx="1.5" fill="${color}"/>`;
    }
    return h;
  };
  // Shared date ticks: the labels under the slider AND faint gridlines across the
  // lanes sit at the same x, so each date reads straight up through the seeker.
  const TICKS = 5;
  const tickIdx = Array.from({ length: TICKS }, (_, k) => Math.round((k / (TICKS - 1)) * (n - 1)));
  const grid = tickIdx.map((i) => `<rect x="${(x(i) - 0.6).toFixed(1)}" y="0" width="1.2" height="20" fill="rgba(255,255,255,0.32)"/>`).join("");

  svg.innerHTML =
    lane(sunUp, 0, "var(--amber)") +
    lane(earthUp, laneH + gap, "var(--cyan)") +
    lane(bothUp, 2 * (laneH + gap), "var(--green)") + grid;

  const datesEl = document.getElementById("scrubber-dates");
  if (datesEl) {
    const fmt = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    datesEl.innerHTML = tickIdx.map((i) => `<span style="left:${((i / (n - 1)) * 100).toFixed(1)}%">${fmt(data.times[i])}</span>`).join("");
  }
}

function setupHorizonControls() {
  // Terrain is always on; just refresh the timeline-note describing the source.
  updateHorizonControls();
}

// ── Solar panel site search ──
// Where to put panels 100–300 m from the lander (lunarsky/panels.py): one
// year from 2027-01-01, panels 10 m up. Listed polar sites have it
// precomputed; anywhere else asks the backend, which takes 1–2 minutes the first
// time for a spot. It depends only on the location, not the date window.
const PANEL_START = "2027-01-01";
let panelKey = null;
let panelSeq = 0;

const COMPASS_16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compass = (deg) => COMPASS_16[Math.round(deg / 22.5) % 16];
const pct = (f) => `${(f * 100).toFixed(1)}%`;

function setPanelBody(html, cls = "") {
  const el = document.getElementById("panel-site-body");
  el.className = cls;
  el.innerHTML = html;
}

// The search is a backend job (/api/jobs/panel-site). On Cloudflare a queue
// splits it across 8 containers and answers 202 ({state, parts, done}) until
// it's done, so the page asks again every few seconds (api-worker/src/jobs.js);
// locally the backend answers the same path straight away. onProgress gets
// each 202; it stops (null) once isCurrent() says the user moved on.
const JOB_POLL_MS = 4000;
const JOB_GIVE_UP_MS = 30 * 60 * 1000;

async function fetchPanelSite(lat, lon, siteId, onProgress = () => {}, isCurrent = () => true) {
  if (siteId) {
    try {
      const res = await fetch(`/data/panel/${siteId}.json`);
      if (res.ok) return await res.json();
    } catch { /* not precomputed: ask the backend */ }
  }
  const url = `/api/jobs/panel-site?${new URLSearchParams({ lat, lon, start: PANEL_START })}`;
  const t0 = Date.now();
  let res;
  for (;;) {
    try {
      res = await fetch(url);
    } catch {
      throw new Error("Couldn't reach the backend for the panel search. Locally, start it with `make dev-backend`.");
    }
    if (res.status !== 202) break;
    onProgress(await res.json());
    if (Date.now() - t0 > JOB_GIVE_UP_MS) throw new Error("The panel search is taking unusually long. Try again later.");
    await new Promise((r) => setTimeout(r, JOB_POLL_MS));
    if (!isCurrent()) return null;
  }
  if (!res.ok) {
    let detail = null;
    try { detail = (await res.json()).detail; } catch { /* not JSON */ }
    throw new Error(typeof detail === "string" ? detail : `Panel search failed (HTTP ${res.status}).`);
  }
  return res.json();
}

async function loadPanelSite(lat, lon, siteId, hasTerrain) {
  // An Artemis site's card is its #1 landing target's, not a search at the pin.
  if (landingFocus) { panelKey = null; setLandingMarkers(); return; }
  const key = `${lat},${lon}`;
  if (key === panelKey) return;
  panelKey = key;
  const seq = ++panelSeq;
  setPanelMarkers(null);
  if (!hasTerrain) {
    setPanelBody("No terrain map covers this spot (the maps reach ~60°S to the pole), so there's nothing to search.", "ps-empty");
    return;
  }
  setPanelBody(
    `<div class="ps-spinner"></div>Searching every 20 m spot 100–300 m from the lander over a year of Sun…` +
    `<div class="ps-foot">Takes 1–2 minutes the first time for a new spot.</div>`, "ps-empty");
  const searchText = document.getElementById("panel-site-body").innerHTML.split('<div class="ps-foot">')[0];
  const progress = (job) => {
    if (seq !== panelSeq) return;
    const foot = job.state === "queued" && !job.done
      ? "Queued: waiting for a free search slot…"
      : `Split into ${job.parts} parts running side by side: ${job.done} of ${job.parts} done.`;
    setPanelBody(`${searchText}<div class="ps-foot">${foot}</div>`, "ps-empty");
  };
  try {
    const result = await fetchPanelSite(lat, lon, siteId, progress, () => seq === panelSeq);
    if (result && seq === panelSeq) renderPanelSite(result);
  } catch (e) {
    if (seq !== panelSeq) return;
    panelKey = null; // let a later load try again
    setPanelBody(e.message, "ps-empty");
  }
}

function renderPanelSite(r) {
  // Standing on a landing target: its card shows the target, not the pin.
  if (landingFocus) { lastPanelResult = r; setLandingMarkers(); return; }
  setPanelHeader("Solar panels");
  const L = r.landing;
  const s = r.settings;
  const most = r.picks.most_sunlight;
  const night = r.picks.shortest_night;

  // Only offer to walk somewhere if the gain is actually worth it — a 0.3%
  // bump or a few saved minutes is noise, not a decision.
  const SUN_MIN = 1.0;    // extra percentage points of sunlight
  const NIGHT_MIN = 1.0;  // hours of night shaved off
  const sunWorth = most && most.sunlit_gain_points >= SUN_MIN;
  const nightWorth = night && night.dark_hours_saved >= NIGHT_MIN;

  // Each row is where the panels go and what they get there: sunlight, night,
  // distance and the slope of the ground at that spot (not at the lander).
  // When nothing nearby is worth the walk, the panels stay at the lander, so
  // the row shows the lander's own numbers.
  const where = (p) => `${Math.round(p.distance_m)} m ${compass(p.bearing_deg)}`;
  // data-spot names the surface marker to turn toward. When both picks are the
  // same spot, setPanelMarkers draws one pole (id "sun"), so both rows aim there.
  const sameSpot = most && night && most.lat === night.lat && most.lon === night.lon;
  const row = (icon, label, value, p, cls, worth) => {
    const at = worth ? where(p) : "at the lander";
    const sub = `<span class="ps-alt-w">${at} · slope ${p.slope_deg.toFixed(0)}°</span>`;
    const head = `<span class="ps-alt-k">${icon} ${label}</span><b class="ps-alt-d ${cls}">${value}</b>`;
    return worth
      ? `<button type="button" class="ps-alt ps-alt-go ps-alt-stack" data-spot="${cls === "night" && sameSpot ? "sun" : cls}" title="Turn to face this spot on the surface">${head}${sub}</button>`
      : `<div class="ps-alt ps-alt-stack">${head}${sub}</div>`;
  };
  const sunSpot = sunWorth ? most : L;
  const nightSpot = nightWorth ? night : L;
  const surfaceHint = sunWorth || nightWorth
    ? `<button type="button" class="ps-surface-hint">Stand on the surface to see ${sunWorth && nightWorth && !sameSpot ? "these spots" : "this spot"} on the ground →</button>`
    : "";

  const html =
    row("☀", "Most Sunlight", pct(sunSpot.sunlit_fraction), sunSpot, "sun", sunWorth) +
    row("🌙", "Shortest Night", fmtSpan(nightSpot.longest_dark_hours), nightSpot, "night", nightWorth) +
    surfaceHint +
    // Panel siting needs a whole year of Sun, so these numbers deliberately
    // ignore the date range at the top of the screen.
    `<div class="ps-foot">Full year ${s.start_utc.slice(0, 4)}, not the playback window · ${s.count} spots ${s.min_m}-${s.max_m} m out, panels at ${s.height_m} m, ${s.too_steep} too steep (&gt;${s.max_slope_deg}°)</div>`;
  setPanelBody(html);
  setPanelMarkers(r);
}

// ── Lander and panel-spot markers in the surface view ──
// The same picks the Solar panels card shows, as markers on the ground: a
// ring where you stand (the lander) and a pole at each spot that beats it.
// A spot that doesn't beat the lander gets no marker (the card says "keep
// the panels there").
const PANEL_MARKER_COLORS = { sun: 0xe8a020, night: 0x5cdcf0 };   // --amber, --cyan-bright
let panelLabels = {};   // id → label element

let lastPanelResult = null;   // the selected site's panel search, to restore after a landing target

// A label with `go` set turns you to face its marker when clicked.
function addSurfaceLabel(id, cls, title, sub, go = false) {
  const el = document.createElement("div");
  el.className = `surf-label ${cls}${go ? " go" : ""}`;
  if (go) {
    el.title = "Turn to face this spot";
    el.addEventListener("click", () => scene.lookAtSurfaceMarker(id));
  }
  el.innerHTML = `<span class="surf-title">${title}</span><span class="surf-sub">${sub}</span>`;
  document.getElementById("surface-markers").appendChild(el);
  panelLabels[id] = el;
}

function setPanelMarkers(r) {
  lastPanelResult = r;
  if (landingFocus) { setLandingMarkers(); return; }
  const layer = document.getElementById("surface-markers");
  layer.innerHTML = "";
  panelLabels = {};
  if (!r) { scene.setSurfaceMarkers(null); return; }

  const most = r.picks.most_sunlight, night = r.picks.shortest_night;
  const spots = [];
  if (most && most.sunlit_gain_points > 0) spots.push({ id: "sun", title: "Panels: most sunlight", p: most });
  if (night && night.dark_hours_saved > 0) {
    if (spots.length && most.lat === night.lat && most.lon === night.lon) spots[0].title = "Panels: most sun, shortest night";
    else spots.push({ id: "night", title: "Panels: shortest night", p: night });
  }

  const addLabel = addSurfaceLabel;
  addLabel("lander", "lander", "Lander, you are here",
    spots.length ? `${pct(r.landing.sunlit_fraction)} sunlit` : `${pct(r.landing.sunlit_fraction)} sunlit · best panel spot`);
  for (const s of spots) {
    addLabel(s.id, s.id, s.title,
      `${Math.round(s.p.distance_m)} m ${compass(s.p.bearing_deg)} of the lander · ${pct(s.p.sunlit_fraction)} sunlit`);
  }

  scene.setSurfaceMarkers({
    lat: r.landing.lat, lon: r.landing.lon, ground_m: r.landing.ground_m,
    spots: spots.map((s) => ({ id: s.id, lat: s.p.lat, lon: s.p.lon, ground_m: s.p.ground_m, color: PANEL_MARKER_COLORS[s.id] })),
  });
}

// ── Phase 6: standing on a landing target ──
// An Artemis site opens on its region's #1 landing target (ranked by power
// kit in Plan → Where to land?), not on the region's pin: the pin isn't a
// checked landing spot, and power only matters where you can land. Plan can
// also send you to any other target. The surface view stands on the target,
// with its own terrain mesh (terrain/land-<code>.bin), the landing zone as a
// ring and the panel spot as a pole. The sky timeline stays the region pin's:
// the Sun's direction in space is the same a few km away, so the lighting is
// right.
let landingFocus = null;     // { siteId, region, target, zoneM }
let topTargets = new Map();  // site id → its region's #1 target, as landingFocus
let regionTargets = new Map(); // site id → its targets with a mesh, best rank first
let landingYear = "2027";      // the year landing.json's targets were sized over

// Background download of target meshes, so standing on another target is
// instant: the request lands in the browser's HTTP cache (the R2 function
// sends max-age), and loadTerrain's fetch of the same URL is then served from
// it. One at a time and at low priority, so it never competes with what the
// person is looking at.
const warmed = new Set();
const warmQueue = [];
let warming = false;
function warmTerrain(ids) {
  for (const id of ids) if (id && !warmed.has(id)) { warmed.add(id); warmQueue.push(id); }
  if (warming || !warmQueue.length) return;
  warming = true;
  (async () => {
    while (warmQueue.length) {
      const id = warmQueue.shift();
      // The mesh and its imagery: everything loadTerrain asks for.
      try {
        for (const f of [`${id}.bin`, `${id}_albedo.bin`, `${id}_wac.jpg`]) {
          const r = await fetch(`/data/terrain/${f}`, { priority: "low" });
          if (r.ok) await r.arrayBuffer();
        }
      } catch { warmed.delete(id); }     // offline or failed: allow a later retry
    }
    warming = false;
  })();
}
// A site was opened: its #2 and #3 targets. Standing on target `rank`: the
// next best one not yet downloaded.
function warmSite(siteId) {
  const ts = regionTargets.get(siteId) || [];
  warmTerrain(ts.filter((t) => t.rank === 2 || t.rank === 3).map((t) => t.terrain_id));
}
function warmNextTarget(siteId, rank) {
  const next = (regionTargets.get(siteId) || []).find((t) => t.rank > rank && !warmed.has(t.terrain_id));
  if (next) warmTerrain([next.terrain_id]);
}

async function fetchTopTargets() {
  try {
    const res = await fetch("/data/landing.json");
    if (!res.ok) return;
    const l = await res.json();
    if (l.start_utc) landingYear = l.start_utc.slice(0, 4);
    for (const r of l.regions) {
      regionTargets.set(r.site_id, r.targets.filter((x) => x.terrain_id).sort((a, b) => a.rank - b.rank));
      const t = r.targets.find((x) => x.rank === 1);
      if (t && t.terrain_id) topTargets.set(r.site_id, { siteId: r.site_id, region: r.region, target: t, zoneM: l.ellipse_m });
    }
  } catch { /* no landing data: sites fall back to their pin */ }
}

// The selected site's own focus: its region's #1 target, or null for a
// spot with no landing targets (custom coordinates).
function homeFocus() {
  const site = sites.find((s) => s.name === selectedSiteName);
  return (site && topTargets.get(site.id)) || null;
}

// Stand on the surface at the current focus (a landing target), else the pin.
function enterSurfaceAt(site) {
  const t = landingFocus?.target;
  if (!t) { scene.enterSurfaceView(site.lat, site.lon, site.id); return; }
  scene.enterSurfaceView(t.lat, t.lon, t.terrain_id);
  setLandingMarkers();
  if (t.panel) scene.faceSurfacePoint(t.panel.lat, t.panel.lon);
}

// ⓘ tooltips: one fixed element on <body>, shown on hover/focus of any
// .ps-info and clamped inside the viewport (a CSS ::after got clipped by the
// panel's overflow and ran off its left edge).
function initInfoTips() {
  const tip = document.createElement("div");
  tip.id = "info-tip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  document.body.appendChild(tip);
  const M = 8;
  const show = (el) => {
    if (!el.dataset.tip) return;
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let left = Math.min(r.right - w + 4, window.innerWidth - w - M);
    left = Math.max(M, left);
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - M) top = Math.max(M, r.top - h - 6);
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  const hide = () => { tip.hidden = true; };
  document.querySelectorAll(".ps-info").forEach((el) => {
    el.addEventListener("mouseenter", () => show(el));
    el.addEventListener("focus", () => show(el));
    el.addEventListener("mouseleave", () => { if (document.activeElement !== el) hide(); });
    el.addEventListener("blur", hide);
  });
  window.addEventListener("scroll", hide, true);
}

const PICK_LABEL = { lightest_kit: "Lightest kit", most_sunlight: "Most sunlight", shortest_night: "Shortest night" };

// The card's header: region, subtitle, kit tonnage and an ⓘ with the context.
function setPanelHeader(title, sub = "", kit = "", info = "") {
  document.getElementById("ps-head-title").textContent = title || "Landing & power";
  document.getElementById("ps-head-sub").textContent = sub;
  document.getElementById("ps-head-kit").textContent = kit;
  const i = document.getElementById("ps-head-info");
  i.hidden = !info;
  i.dataset.tip = info;
  i.setAttribute("aria-label", info);
}

function setLandingMarkers() {
  const focus = landingFocus;
  const { target: t, region, zoneM } = focus;
  // The region's #1 target is the spot the Sun file is for: its panels and
  // kit are the full year YEAR_START, worked out in the page exactly as Plan
  // does. Any other target (sent here from Plan → Where to land?) shows its
  // precomputed full year (landing.json).
  const live = t.rank === 1 && !!t.panel;
  const yr = live ? yearPowerDone.get(focus.siteId) : null;   // undefined: still loading
  const useLive = live && yr !== null;
  if (live && yr === undefined) {
    yearPower(focus.siteId).then(() => { if (landingFocus === focus) setLandingMarkers(); });
  }
  const year = useLive ? YEAR_LABEL : landingYear;
  const dash = "—";
  const sunlit = useLive ? (yr ? pctRound(yr.sunlit_fraction) : dash) : t.panel && pctRound(t.panel.sunlit);
  const night = useLive ? (yr ? fmtHours(yr.longest_dark_hours) : dash) : t.panel && fmtHours(t.panel.night_h);
  const kit = useLive
    ? (yr?.best ? kitTonnes(yr.best.battery_kg / 1000, yr.best.array_kg / 1000) : null)
    : (t.power ? kitTonnes(t.power.battery_t, t.power.array_t) : null);
  const showKit = useLive || !!t.power;
  // Label/value rows instead of sentences; the context sentence lives in the
  // header's ⓘ tooltip.
  const rows = (pairs) => `<dl class="ps-kv">${pairs.map(([k, v, cls = ""]) => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`).join("")}</dl>`;
  // A block with `go` is a button: it turns you to face that marker (and
  // stands you on the surface first from the globe). See goToSpot.
  const block = (title, tag, body, go = null) => go
    ? `<div class="ps-blk ps-blk-go" data-spot="${go.spot}" role="button" tabindex="0" title="Turn to face the ${go.what}">` +
      `<div class="ps-blk-h"><span class="ps-blk-title">${title}<span class="ps-go-ico" aria-hidden="true">↗</span></span>` +
      `${tag ? `<span class="ps-tag">${tag}</span>` : ""}</div>${body}` +
      `<div class="ps-go-hint">Click to face the ${go.what} on the surface →</div></div>`
    : `<div class="ps-blk"><div class="ps-blk-h">${title}${tag ? `<span class="ps-tag">${tag}</span>` : ""}</div>${body}</div>`;
  setPanelBody(
    block("Landing zone", `${zoneM} m`, rows([
      ["Flat (under 10°)", `${Math.round(t.flat_share * 100)}%`, "ok"],
      ["Steepest", `${t.steepest_deg.toFixed(0)}°`],
    ]), { spot: "zone", what: "landing zone" }) +
    (t.panel ? block("Panels", `at ${PANEL_HEIGHT_M} m · full year ${year}`, rows([
      ["Sunlit", sunlit, "sun"],
      ["Longest night", night, "night"],
      ["Distance", `${Math.round(t.panel.distance_m)} m ${compass(t.panel.bearing_deg)}`],
      ["Slope", `${t.panel.slope_deg.toFixed(0)}°`],
    ]), { spot: "panel", what: "panels" }) : "") +
    (showKit ? block("Power kit", PICK_LABEL[t.panel?.pick] || "", rows([
      ["Total", kit ? kit.total : dash],
      ["Battery", kit ? kit.battery : dash],
      ["Array", kit ? kit.array : dash],
    ])) : ""));
  setPanelHeader(region, `Landing target #${t.rank}`, kit ? kit.total : (showKit ? dash : ""),
    `${t.rank === 1 ? "The region's best landing target by power-kit weight" : "A landing target from Plan → Where to land?"}. ` +
    `Panels and antenna at ${PANEL_HEIGHT_M} m, sized over the full year ${year} for a crew of 4` +
    (useLive ? ` (the same numbers as Plan → Power & landing for a year from ${YEAR_START}). Targets are ranked on the ${landingYear} precomputed kit.` : ".") +
    ` The playback window only moves the timeline, the Sun and Earth, and the Sky chart, which are for the region's pin.`);
  document.getElementById("surface-markers").innerHTML = "";
  panelLabels = {};
  addSurfaceLabel("lander", "lander", `Landing target #${t.rank}, you are here`, region);
  addSurfaceLabel("zone", "zone", `${zoneM} m landing zone`,
    `${Math.round(t.flat_share * 100)}% under 10° · the lander could touch down anywhere in it`, true);
  const spots = [];
  if (t.panel) {
    addSurfaceLabel("panel", "sun", `Panels at ${PANEL_HEIGHT_M} m`,
      `${Math.round(t.panel.distance_m)} m ${compass(t.panel.bearing_deg)} · ${sunlit} sunlit · ` +
      `longest night ${night}`, true);
    spots.push({ id: "panel", lat: t.panel.lat, lon: t.panel.lon, color: PANEL_MARKER_COLORS.sun });
  }
  scene.setSurfaceMarkers({ lat: t.lat, lon: t.lon, ground_m: 0, zone_m: zoneM, spots });
}

// Leave a target Plan sent you to: back to the selected site's own focus
// (its region's #1 target), or its pin's panel markers if it has none.
function clearLandingFocus() {
  const home = homeFocus();
  if (landingFocus === home) return;
  landingFocus = home;
  if (home) setLandingMarkers();
  else if (lastPanelResult) renderPanelSite(lastPanelResult);
  else { setPanelMarkers(null); setPanelBody("", "ps-empty"); }
}

function viewLandingTarget({ siteId, region, target, zoneM }) {
  if (!target.terrain_id) return;
  closePlanView();
  const site = sites.find((s) => s.id === siteId);
  if (site && site.name !== selectedSiteName) selectSite(site.name);
  hideSiteInfo();
  landingFocus = { siteId, region, target, zoneM };
  warmed.add(target.terrain_id);
  warmNextTarget(siteId, target.rank);
  enterSurfaceAt(site);
  currentView = "surface";
  document.querySelectorAll("#view-toggle .vt-btn")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === "surface"));
}

function updatePanelLabels() {
  const v = scene.getVersions();
  if (unchanged("panelLabels", [v.view, v.markers, currentView, panelLabels])) return;
  const screens = currentView === "surface" ? scene.getSurfaceMarkerScreens() : {};
  for (const [id, el] of Object.entries(panelLabels)) {
    const s = screens[id];
    if (!s || !s.onScreen) { el.style.display = "none"; continue; }
    el.style.display = "flex";
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
  }
}

function setupTimeScrubber() {
  const scrubber = document.getElementById("time-scrubber");
  scrubber.addEventListener("input", () => {
    if (!skyData) return;
    setPlaying(false); // the user took over the slider
    // loadAndRender sets the slider's range to 0..samples-1, so its value
    // is the sample index: far left = start date, far right = end date.
    const last = skyData.times.length - 1;
    const idx = Math.max(0, Math.min(last, Math.round(Number(scrubber.value))));
    currentTimeIndex = idx;
    updateAtTime(idx);
  });

  document.getElementById("play-btn").addEventListener("click", () => setPlaying(!playing));
  const speedBtn = document.getElementById("speed-btn");
  speedBtn.textContent = PLAY_SPEEDS[playSpeedIdx].label;
  speedBtn.addEventListener("click", () => {
    playSpeedIdx = (playSpeedIdx + 1) % PLAY_SPEEDS.length;
    speedBtn.textContent = PLAY_SPEEDS[playSpeedIdx].label;
  });

  // Ephemeris provenance popover: toggle on the ⓘ, dismiss on outside click or Esc.
  const ephBtn = document.getElementById("eph-info-btn");
  const ephPop = document.getElementById("eph-info-pop");
  if (ephBtn && ephPop) {
    const setEph = (open) => {
      ephPop.hidden = !open;
      ephBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    ephBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setEph(ephPop.hidden);
    });
    ephPop.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => setEph(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !ephPop.hidden) setEph(false);
    });
  }

  // Space toggles playback, except while typing or on a focused button
  // (where Space already clicks it). The slider itself is fine.
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat || !skyData || planOpen) return;
    const t = e.target;
    if (t instanceof Element &&
        t.matches('input:not([type="range"]), textarea, select, button, [contenteditable]')) return;
    e.preventDefault();
    setPlaying(!playing);
  });

  // F toggles focus mode: fade all the HUD except the timeline seeker.
  document.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() !== "f" || e.repeat || planOpen) return;
    const t = e.target;
    if (t instanceof Element && t.matches('input, textarea, select, [contenteditable]')) return;
    toggleFocusMode();
  });
  // Globe layer: permanently shadowed regions (info only, default on).
  const psrToggle = document.getElementById("psr-toggle-input");
  if (psrToggle) psrToggle.addEventListener("change", () => scene.setPsrOverlay(psrToggle.checked));

  const focusHint = document.getElementById("focus-hint");
  if (focusHint) focusHint.addEventListener("click", toggleFocusMode);
}

function toggleFocusMode() {
  const on = document.getElementById("main-hud").classList.toggle("focus-mode");
  const label = document.getElementById("focus-hint-label");
  if (label) label.textContent = on ? "Exit" : "Focus";
}

// ── Playback ──
// Plays the loaded window from the current position to the end. Speeds are
// days of data per second, so they feel the same whatever the step size.
const PLAY_SPEEDS = [
  { daysPerSec: 1 / 24, label: "1 h/s" },
  { daysPerSec: 6 / 24, label: "6 h/s" },
  { daysPerSec: 12 / 24, label: "12 h/s" },
  { daysPerSec: 1, label: "1 d/s" },
  { daysPerSec: 4, label: "4 d/s" },
];
let playSpeedIdx = 3;
let playing = false;
let playRaf = 0;
let playPos = 0;    // fractional sample index, so slow speeds still advance
let playLastT = 0;

function setPlaying(on) {
  if (on && !skyData) return;
  const btn = document.getElementById("play-btn");
  if (on && !playing) {
    // Pressing play at the end starts over from the beginning.
    if (currentTimeIndex >= skyData.times.length - 1) seekTo(0);
    playPos = currentTimeIndex;
    playLastT = performance.now();
    playRaf = requestAnimationFrame(playStep);
  } else if (!on) {
    cancelAnimationFrame(playRaf);
  }
  playing = on;
  btn.classList.toggle("playing", on);
  btn.title = on ? "Pause (Space)" : "Play (Space)";
  btn.setAttribute("aria-label", on ? "Pause" : "Play");
}

function playStep(now) {
  if (!playing || !skyData) return;
  // Cap the step so a backgrounded tab (no frames at all) doesn't jump far
  // ahead on return, while slow frame rates still play at the labelled speed.
  const dt = Math.min(1, (now - playLastT) / 1000);
  playLastT = now;
  const samplesPerSec = (PLAY_SPEEDS[playSpeedIdx].daysPerSec * 24) / (skyData.step_hours || 1);
  const last = skyData.times.length - 1;
  playPos = Math.min(last, playPos + dt * samplesPerSec);
  const idx = Math.floor(playPos);
  if (idx !== currentTimeIndex) seekTo(idx);
  if (playPos >= last) {
    setPlaying(false);
    return;
  }
  playRaf = requestAnimationFrame(playStep);
}

// Move the slider and the scene to a sample without firing the slider's
// "input" handler (which would pause playback).
function seekTo(idx) {
  currentTimeIndex = idx;
  document.getElementById("time-scrubber").value = idx;
  updateAtTime(idx);
}

// ── Custom date picker ──
// Match what /api/sky accepts: the Moon orientation kernel runs out on
// 2050-01-01 (lunarsky/kernels.py), and one window is at most 366 days.
const MIN_YEAR = 1900;
const MAX_YEAR = 2049;
const MIN_DATE = "1900-01-01";
const MAX_DATE = "2049-12-31";
const MAX_WINDOW_DAYS = 366;
const DEFAULT_WINDOW_DAYS = 31;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// One calendar picks the whole range: the first click sets the start, the
// second the end. dpStart/dpEnd are the picks in progress; the inputs only
// change once both are chosen.
let dpOpen = false;
let dpYear = 2027;
let dpMonth = 0;
let dpStart = null;
let dpEnd = null;
let dpHover = null;

function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function isDateInRange(str) {
  return isValidDate(str) && str >= MIN_DATE && str <= MAX_DATE;
}


// A date was picked from the calendar or typed and committed. If that left
// the range backwards or too long, move the other end so the window keeps
// the length of the one on screen, then load the new range.
function onDatePicked(changedId) {
  const startEl = document.getElementById("date-start");
  const endEl = document.getElementById("date-end");
  const changed = document.getElementById(changedId);
  if (!isDateInRange(changed.value)) {
    changed.classList.add("invalid");
    return;
  }

  const span = loadedRange
    ? Math.min(MAX_WINDOW_DAYS, Math.max(1, daysBetween(loadedRange.start, loadedRange.end)))
    : DEFAULT_WINDOW_DAYS;
  const ok = (s, e) => isDateInRange(s) && isDateInRange(e) && s < e && daysBetween(s, e) <= MAX_WINDOW_DAYS;
  if (!ok(startEl.value, endEl.value)) {
    // ISO dates compare correctly as strings; clamp to the ephemeris range.
    if (changedId === "date-start") {
      const end = addDays(startEl.value, span);
      endEl.value = end > MAX_DATE ? MAX_DATE : end;
    } else {
      const start = addDays(endEl.value, -span);
      startEl.value = start < MIN_DATE ? MIN_DATE : start;
    }
    startEl.classList.remove("invalid");
    endEl.classList.remove("invalid");
  }

  // Custom site with no coordinates yet: nothing to load until they're in.
  if (selectedSiteName === "__custom__") {
    const lat = parseFloat(document.getElementById("custom-lat").value);
    const lon = parseFloat(document.getElementById("custom-lon").value);
    if (isNaN(lat) || isNaN(lon)) return;
  }
  onCompute();
}

function handleDateInput(input) {
  if (!isValidDate(input.value) || !isDateInRange(input.value)) {
    input.classList.add("invalid");
  } else {
    input.classList.remove("invalid");
  }
}

function setupDatePicker() {
  const picker = document.getElementById("date-picker");

  // One pill opens/closes the range calendar; the calendar auto-applies the
  // range when you finish picking (no Compute button).
  document.getElementById("date-pill").addEventListener("click", (e) => {
    e.stopPropagation();
    if (dpOpen) closeDatePicker(); else openDatePicker();
  });
  updateDatePill();

  document.getElementById("dp-prev-year").addEventListener("click", (e) => {
    e.stopPropagation(); dpYear = Math.max(MIN_YEAR, dpYear - 1); renderDatePicker();
  });
  document.getElementById("dp-next-year").addEventListener("click", (e) => {
    e.stopPropagation(); dpYear = Math.min(MAX_YEAR, dpYear + 1); renderDatePicker();
  });
  document.getElementById("dp-prev-month").addEventListener("click", (e) => {
    e.stopPropagation(); dpMonth--;
    if (dpMonth < 0) { dpMonth = 11; dpYear = Math.max(MIN_YEAR, dpYear - 1); }
    renderDatePicker();
  });
  document.getElementById("dp-next-month").addEventListener("click", (e) => {
    e.stopPropagation(); dpMonth++;
    if (dpMonth > 11) { dpMonth = 0; dpYear = Math.min(MAX_YEAR, dpYear + 1); }
    renderDatePicker();
  });

  // Day cells are re-rendered on every month change, so listen on the grid.
  const daysEl = document.getElementById("dp-days");
  daysEl.addEventListener("click", (e) => {
    const el = e.target.closest(".dp-day:not(.disabled)");
    if (el) pickDay(el.dataset.date);
  });
  daysEl.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".dp-day");
    const date = el ? el.dataset.date : null;
    if (date !== dpHover) { dpHover = date; paintRange(); }
  });
  daysEl.addEventListener("mouseleave", () => { dpHover = null; paintRange(); });

  document.addEventListener("click", () => closeDatePicker());
  picker.addEventListener("click", (e) => e.stopPropagation());
}

function openDatePicker() {
  if (dpOpen) return;
  dpOpen = true;
  const startVal = document.getElementById("date-start").value;
  const endVal = document.getElementById("date-end").value;
  // Show the current range; the next click starts a new one.
  dpStart = isValidDate(startVal) ? startVal : null;
  dpEnd = isValidDate(endVal) ? endVal : null;
  dpHover = null;
  if (dpStart) {
    const [y, m] = dpStart.split("-").map(Number);
    dpYear = y; dpMonth = m - 1;
  }
  // The calendar opens upward from the playback pill in the timeline.
  const picker = document.getElementById("date-picker");
  const anchor = document.getElementById("date-range");
  const rect = anchor.getBoundingClientRect();
  const box = document.getElementById("time-scrubber-container");
  const boxR = box.getBoundingClientRect();
  box.classList.add("picker-open");
  picker.style.display = "block";
  // Right edge in line with the pill's.
  picker.style.left = Math.max(0, rect.right - boxR.left - picker.offsetWidth) + "px";
  document.getElementById("date-pill").classList.add("active");
  setPickerHint();
  renderDatePicker();
}

function closeDatePicker() {
  dpOpen = false;
  dpStart = dpEnd = dpHover = null;
  document.getElementById("date-picker").style.display = "none";
  document.getElementById("time-scrubber-container").classList.remove("picker-open");
  document.getElementById("date-pill").classList.remove("active");
}

// Show the applied range on the pill, e.g. "Jan 1 – Feb 1".
function updateDatePill() {
  const label = document.getElementById("date-pill-label");
  if (!label) return;
  const s = document.getElementById("date-start").value;
  const e = document.getElementById("date-end").value;
  if (!isValidDate(s) || !isValidDate(e)) return;
  const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const ds = parse(s), de = parse(e);
  const md = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  // Include the year; only repeat it on the start if the range spans two years.
  label.textContent = ds.getUTCFullYear() === de.getUTCFullYear()
    ? `${md(ds)} – ${md(de)}, ${de.getUTCFullYear()}`
    : `${md(ds)}, ${ds.getUTCFullYear()} – ${md(de)}, ${de.getUTCFullYear()}`;
}

// What the next click does, under the calendar.
function setPickerHint(msg = null, isError = false) {
  const hint = document.getElementById("dp-hint");
  const choosingEnd = dpStart && !dpEnd;
  hint.textContent = msg ?? (choosingEnd
    ? `From ${dpStart} · now pick the end date`
    : "Pick a start date");
  hint.classList.toggle("error", isError);
}

function pickDay(date) {
  // First click (or a click before the start): this is the start.
  if (!dpStart || dpEnd || date <= dpStart) {
    dpStart = date;
    dpEnd = null;
    setPickerHint();
    paintRange();
    return;
  }
  if (daysBetween(dpStart, date) > MAX_WINDOW_DAYS) {
    setPickerHint(`Up to ${MAX_WINDOW_DAYS} days · pick an end before ${addDays(dpStart, MAX_WINDOW_DAYS + 1)}`, true);
    return;
  }
  dpEnd = date;
  paintRange();
  const startEl = document.getElementById("date-start");
  const endEl = document.getElementById("date-end");
  startEl.value = dpStart;
  endEl.value = dpEnd;
  startEl.classList.remove("invalid");
  endEl.classList.remove("invalid");
  updateDatePill();
  // Let the finished range show for a moment before the picker closes.
  setTimeout(() => {
    closeDatePicker();
    onDatePicked("date-end");
  }, 220);
}

// Mark the start, the end, and the days between. While the end is still to
// be picked, the days up to the one under the cursor show as a preview.
function paintRange() {
  const end = dpEnd ?? (dpStart && dpHover && dpHover > dpStart ? dpHover : null);
  const tooLong = !dpEnd && end && daysBetween(dpStart, end) > MAX_WINDOW_DAYS;
  document.querySelectorAll("#dp-days .dp-day").forEach((el) => {
    const d = el.dataset.date;
    el.classList.toggle("range-start", d === dpStart);
    el.classList.toggle("range-end", !!end && d === end);
    el.classList.toggle("in-range", !!end && d > dpStart && d < end);
    el.classList.toggle("preview", !dpEnd && !!end);
    el.classList.toggle("too-long", !!tooLong && !!end && d > dpStart && d <= end);
  });
}

function renderDatePicker() {
  document.getElementById("dp-title").textContent = `${MONTHS[dpMonth]} ${dpYear}`;
  const daysEl = document.getElementById("dp-days");
  const firstDay = new Date(dpYear, dpMonth, 1).getDay();
  const daysInMonth = new Date(dpYear, dpMonth + 1, 0).getDate();
  const daysInPrev = new Date(dpYear, dpMonth, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);
  const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  let html = "";
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    let m = dpMonth - 1, y = dpYear;
    if (m < 0) { m = 11; y--; }
    const disabled = y < MIN_YEAR || y > MAX_YEAR;
    html += `<div class="dp-day other-month${disabled ? " disabled" : ""}" data-date="${iso(y, m, d)}">${d}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = iso(dpYear, dpMonth, d);
    html += `<div class="dp-day${date === today ? " today" : ""}" data-date="${date}">${d}</div>`;
  }
  const total = firstDay + daysInMonth;
  const remaining = (total <= 35 ? 35 : 42) - total;
  for (let d = 1; d <= remaining; d++) {
    let m = dpMonth + 1, y = dpYear;
    if (m > 11) { m = 0; y++; }
    const disabled = y > MAX_YEAR;
    html += `<div class="dp-day other-month${disabled ? " disabled" : ""}" data-date="${iso(y, m, d)}">${d}</div>`;
  }
  daysEl.innerHTML = html;
  paintRange();
}

function updateDateDisplay(inputId) {
  const input = document.getElementById(inputId);
  if (input) input.classList.remove("invalid");
}

// ── Dockable panel system ──

function setupPanelToggles() {
  // Panels are static placements now — no drag, resize, or docking. The only
  // interaction left is collapse/expand via the header chevron.
  document.querySelectorAll(".panel-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById(btn.dataset.panel).classList.toggle("collapsed");
    });
  });
  initInfoTips();
  // The landing card's ⤢ enlarges it in place: bigger text, more room, over
  // the Sites list. It stays live and clickable, and nothing else pauses.
  const card = document.getElementById("panel-site-panel");
  const expandBtn = document.getElementById("ps-expand");
  const setExpanded = (on) => {
    card.classList.toggle("expanded", on);
    if (on) card.classList.remove("collapsed");
    expandBtn.title = on ? "Shrink the card (Esc)" : "Enlarge the card";
    expandBtn.setAttribute("aria-pressed", String(on));
    layoutHud();
  };
  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setExpanded(!card.classList.contains("expanded"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && card.classList.contains("expanded")) setExpanded(false);
  });
  // The landing card collapses from anywhere on its header, down to one row.
  document.querySelectorAll(".ps-header").forEach((h) => {
    h.addEventListener("click", (e) => {
      if (e.target.closest(".ps-info, .ps-expand")) return;
      document.getElementById(h.dataset.panel).classList.toggle("collapsed");
    });
  });
  keepPanelsAboveScrubber();
  placeFocusHint();
  watchLayout();
}

// The F / Focus button sits just left of Plan & Compare, level with it. It's
// not in the top bar (focus mode hides that), so it's placed from the
// button's position; while the bar is hidden it keeps its last spot.
function placeFocusHint() {
  const plan = document.getElementById("plan-btn").getBoundingClientRect();
  const hint = document.getElementById("focus-hint");
  if (!plan.width || !hint) return;
  hint.style.right = (window.innerWidth - plan.left + 8) + "px";
  hint.style.top = (plan.top + (plan.height - hint.offsetHeight) / 2) + "px";
  placeWalkHint();
}

// The surface view's WASD / distance hint sits just left of the Focus
// button, level with it.
function placeWalkHint() {
  const hint = document.getElementById("walk-hint");
  const focus = document.getElementById("focus-hint");
  if (!hint || hint.hidden || !focus) return;
  const f = focus.getBoundingClientRect();
  if (!f.width) return;
  hint.style.left = "auto";
  hint.style.bottom = "auto";
  hint.style.right = (window.innerWidth - f.left + 8) + "px";
  hint.style.top = (f.top + (f.height - hint.offsetHeight) / 2) + "px";
}

// The time scrubber has the strip above the status bar to itself. This is the
// lowest y a panel's bottom edge may reach, or null while the HUD is hidden.
function scrubberFloor() {
  const r = document.getElementById("time-scrubber-container").getBoundingClientRect();
  return r.height ? r.top - 6 : null;
}

const PANEL_MIN_TOP = 48; // just under the 42px top bar

// Move any panel that would sit on top of the scrubber back above it. A
// bottom-anchored panel (the Sky panel) shares the scrubber's bottom margin
// when the screen is wide enough for the two to sit side by side, and is
// lifted above it only when they would overlap.
function keepPanelsAboveScrubber() {
  const floor = scrubberFloor();
  if (floor == null) return;
  const scrub = document.getElementById("time-scrubber-container").getBoundingClientRect();
  document.querySelectorAll(".panel.dockable").forEach((panel) => {
    if (panel.id === "panel-site-panel") return;   // positionSitePanel caps it to the column
    const topAnchored = panel.style.top && panel.style.top !== "auto";
    if (!topAnchored) panel.style.bottom = "";        // back to the CSS position, then re-check
    const r = panel.getBoundingClientRect();
    if (!r.height || r.bottom <= floor) return;
    const sideBySide = r.right <= scrub.left - 6 || r.left >= scrub.right + 6;
    if (!topAnchored && sideBySide) return;
    if (topAnchored) {
      panel.style.top = Math.max(PANEL_MIN_TOP, floor - r.height) + "px";
    } else {
      panel.style.bottom = "var(--panel-bottom)";
    }
  });
}


// Drive the 3D Sun/Earth from the site-independent orbital ephemeris when its
// time grid matches the loaded window (the default Jan 2027 playback window). For custom
// date windows (served live by the backend, no precomputed global track) fall
// back to the selected site's topocentric track.
function placeBodiesAtTime(idx) {
  const aligned = ephemerisData &&
    (!skyData || !skyData.times || skyData.times[0] === ephemerisData.times_utc[0]);
  if (aligned && idx < ephemerisData.subsolar_lat.length) {
    scene.updateBodiesFromEphemeris(ephemerisData, idx);
  } else if (skyData) {
    scene.updateBodiesFromSky(skyData, idx);
  }
}

function updateAtTime(idx) {
  if (!skyData || idx >= skyData.times.length) return;
  const sunEl = skyData.sun_el[idx];
  const earthEl = skyData.earth_el[idx];
  const time = skyData.times[idx];

  placeBodiesAtTime(idx);
  setSkyPlotTime(idx);
  document.getElementById("time-label").innerHTML =
    `<span class="tl-date">${time.slice(0, 10)} UTC</span>` +
    `<span class="tl-ang">Sun ${sunEl.toFixed(2)}° · Earth ${earthEl.toFixed(2)}°</span>`;
  // Fill the seeker track up to the current position (Apple/Google-style progress).
  const s = document.getElementById("time-scrubber");
  if (s) { const max = Number(s.max) || 1; s.style.setProperty("--seek", ((idx / max) * 100).toFixed(2) + "%"); }
}

async function onCompute() {
  const start = document.getElementById("date-start").value;
  const end = document.getElementById("date-end").value;

  const reject = (msg) => {
    alert(msg);
    showLoadedRange();
  };
  if (!isDateInRange(start) || !isDateInRange(end)) {
    reject(`Invalid date. Pick a date between ${MIN_DATE} and ${MAX_DATE}.`);
    return;
  }
  if (start >= end) { reject("End date must be after the start date."); return; }
  if (daysBetween(start, end) > MAX_WINDOW_DAYS) {
    reject(`Pick a range of at most ${MAX_WINDOW_DAYS} days.`);
    return;
  }

  let lat, lon, siteName;
  if (selectedSiteName === "__custom__") {
    lat = parseFloat(document.getElementById("custom-lat").value);
    lon = parseFloat(document.getElementById("custom-lon").value);
    siteName = "Custom";
    if (isNaN(lat) || isNaN(lon)) { alert("Enter valid coordinates"); return; }
  } else {
    const site = sites.find((s) => s.name === selectedSiteName);
    if (!site) { alert("Select a site first"); return; }
    lat = site.lat; lon = site.lon; siteName = site.name;
  }

  const state = { siteName, lat, lon, start, end };
  await loadAndRender(state);
}

// The date window currently on screen ({start, end} as YYYY-MM-DD), or null.
let loadedRange = null;
// Bumped by every load, so a slow response can't overwrite a newer one
// (e.g. picking dates quickly, or switching sites mid-load).
let loadSeq = 0;
const BUSY_DELAY_MS = 150;  // wait this long before showing "Computing..."
let busyTimer = null;

// Put the FROM/TO fields back to the window that's actually on screen.
function showLoadedRange() {
  if (!loadedRange) return;
  document.getElementById("date-start").value = loadedRange.start;
  document.getElementById("date-end").value = loadedRange.end;
  updateDateDisplay("date-start");
  updateDateDisplay("date-end");
  updateDatePill();
}

// Fetch sky data for a state and render everything (scene, timeline, HUD).
// Returns true on success. Used by Compute and site selection.
async function loadAndRender(state) {
  const seq = ++loadSeq;
  const pill = document.getElementById("date-pill");
  const pillLabel = document.getElementById("date-pill-label");
  // Only show "Computing..." if the load is slow. Cached sites load in a few
  // ms, and flashing the label for them looks jumpy.
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => {
    if (pillLabel) pillLabel.textContent = "Computing…";
    if (pill) pill.disabled = true;
  }, BUSY_DELAY_MS);

  const siteId = (sites.find((s) => s.name === state.siteName) || {}).id;
  // A listed site in the terrain maps has a precomputed skyline: fetch it
  // alongside the sky data, not after it. (A custom point waits: its skyline
  // comes from the backend, which is already computing it for /api/sky.)
  const earlySkyline = siteId && inTerrainMaps(state) ? fetchSkyline(state.lat, state.lon, siteId) : null;
  let data = null;
  let error = null;
  try {
    data = await fetchSkyData(state.lat, state.lon, state.start, state.end, state.siteName);
  } catch (e) {
    error = e;
  }
  if (data && terrainOf(data)) {
    data.skylineFile = await (earlySkyline ?? fetchSkyline(state.lat, state.lon, siteId));
  }
  if (seq !== loadSeq) return false; // a newer load has taken over

  clearTimeout(busyTimer);
  if (pill) pill.disabled = false;
  updateDatePill();

  if (!data || !data.times || !data.times.length) {
    // Keep showing the previous window, and say so in the date fields.
    showLoadedRange();
    alert(error ? error.message : "No sky data came back for that range.");
    return false;
  }
  // The time scrubber is global state. Switching sites keeps the same window,
  // so hold the current instant (and playback) in place and just re-render the
  // new site at that time. Only a genuinely new date window resets to hour 0.
  const prevTimes = skyData && skyData.times;
  const sameWindow = prevTimes &&
    data.times[0] === prevTimes[0] && data.times.length === prevTimes.length;
  if (!sameWindow) setPlaying(false);
  skyData = data;

  // Sync the top date range to the actual loaded data window, so the fields
  // always reflect what's really being shown (never stale defaults).
  loadedRange = {
    start: skyData.times[0].slice(0, 10),
    end: skyData.times[skyData.times.length - 1].slice(0, 10),
  };
  showLoadedRange();

  document.getElementById("time-scrubber-container").style.visibility = "visible";
  document.getElementById("play-btn").disabled = false;
  const scrubber = document.getElementById("time-scrubber");
  scrubber.max = skyData.times.length - 1;
  const keepIdx = sameWindow ? Math.min(currentTimeIndex, skyData.times.length - 1) : 0;
  scrubber.value = keepIdx;
  currentTimeIndex = keepIdx;

  updateAtTime(keepIdx);
  renderView();
  loadPanelSite(state.lat, state.lon, siteId, !!terrainOf(skyData));
  return true;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Plan & compare (src/plan/) ──
// A full-screen view over the 3D scene. Its code and styles load the first
// time it's opened, so the 3D app's first load stays light. The scene stops
// drawing while it's covered. Plan and the 3D view share the selected site.
let planModule = null;
let planOpen = false;
let planStartSite = null;   // the site selected when Plan opened

async function openPlanView({ fromLink = false } = {}) {
  if (planOpen) return;
  planOpen = true;
  if (playing) setPlaying(false);
  scene.setPaused(true);
  hideSiteInfo();
  planStartSite = selectedSiteName;
  try {
    planModule ??= await import("./plan/main.js");
  } catch (e) {
    console.error(e);
    planOpen = false;
    scene.setPaused(false);
    return;
  }
  if (!planOpen) return;    // closed while loading
  const site = sites.find((s) => s.name === selectedSiteName);
  await planModule.openPlan({
    // A shared link carries its own site; otherwise plan for the 3D view's.
    siteId: fromLink ? null : site?.id ?? null,
    onSiteChange: (id) => {
      const s = sites.find((x) => x.id === id);
      if (s && s.name !== selectedSiteName) selectSite(s.name);
    },
    onViewTarget: viewLandingTarget,
  });
  // A shared link's site becomes the 3D view's site too.
  if (fromLink && planOpen) {
    const s = sites.find((x) => x.id === planModule.planSiteId());
    if (s && s.name !== selectedSiteName) selectSite(s.name);
  }
}

function closePlanView() {
  if (!planOpen) return;
  planOpen = false;
  planModule?.closePlan();
  scene.setPaused(false);
  // Picked a different site in Plan: fly to it, as a click on it would.
  if (selectedSiteName && selectedSiteName !== planStartSite) selectSite(selectedSiteName, true);
}

// ── Init ──
async function main() {
  scene.initScene("scene-container");
  if (import.meta.env.DEV) window.__scene = scene;   // console debugging only
  scene.onFrame(updateOffscreenIndicators);
  scene.onFrame(updateCameraDebug);
  scene.onFrame(updateSkyPlotLook);
  scene.onFrame(updateWalkHint);
  onSkyPlotClick((az, el) => scene.setSurfaceLook(az, el));

  // The chat (src/chat/): its show_in_app tool flies to a region. Selecting
  // a site already stands on its region's #1 landing target.
  mountChat();
  window.addEventListener("chat:show", (e) => {
    const site = sites.find((s) => s.id === e.detail.siteId);
    if (!site) return;
    closePlanView();
    selectSite(site.name, true, true);
    // Dates the answer recommends: show that window on the timeline. A newer
    // load wins over the site's default one (loadSeq), so no race.
    const range = e.detail.range;
    if (range && isValidDate(range.start) && isValidDate(range.end)) {
      document.getElementById("date-start").value = range.start;
      document.getElementById("date-end").value = range.end;
      updateDatePill();
      onCompute();
    }
  });

  const urlSite = new URL(window.location).searchParams.get("site");

  // The startup files don't depend on each other: ask for them all at once.
  fetch("/data/terrain/index.json").then((r) => r.ok ? r.json() : null)
    .then((idx) => { if (idx) scene.setTerrainIndex(idx); }).catch(() => {});
  fetchRegions().then((features) => { if (features) scene.setRegionOutlines(features); });
  const [eph, siteList] = await Promise.all([fetchEphemeris(), fetchSites(), fetchTopTargets()]);
  ephemerisData = eph;
  if (ephemerisData) scene.updateBodiesFromEphemeris(ephemerisData, 0);
  // Once the page has settled, every region's #2 and #3 meshes and imagery
  // in the background; skipped when the browser asks to save data.
  if (!navigator.connection?.saveData) {
    const warmAll = () => { for (const id of regionTargets.keys()) warmSite(id); };
    setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(warmAll) : warmAll()), 8000);
  }
  sites = siteList ?? MOCK_SITES;
  setupHorizonControls();
  populateSiteSelector();
  buildSiteMarkers();
  watchHudInsets();
  scene.onFrame(updateSiteMarkers);
  scene.onFrame(updatePanelLabels);
  setupTimeScrubber();
  setupDatePicker();
  setupPanelToggles();
  applyViewLayout();   // no site picked yet → the Sky panel stays hidden

  document.getElementById("skip-intro").addEventListener("click", skipIntro);
  document.getElementById("explore-btn").addEventListener("click", skipIntro);
  document.getElementById("site-info-close").addEventListener("click", hideSiteInfo);
  document.getElementById("surface-btn").addEventListener("click", () =>
    setView(currentView === "orbital" ? "surface" : "orbital"));
  // Clicking a panel pick ("More sun" / "Shorter night") lands you on the
  // surface (if you aren't already) and turns you to face that spot's pole.
  // The hint just lands you there.
  const panelBody = document.getElementById("panel-site-body");
  const goToSpot = (target) => {
    const pick = target.closest(".ps-alt-go, .ps-blk-go");
    if (!pick && !target.closest(".ps-surface-hint")) return false;
    setView("surface");
    if (pick && currentView === "surface") scene.lookAtSurfaceMarker(pick.dataset.spot);
    return true;
  };
  panelBody.addEventListener("click", (e) => { goToSpot(e.target); });
  panelBody.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".ps-blk-go")) {
      e.preventDefault();
      goToSpot(e.target);
    }
  });
  document.getElementById("plan-btn").addEventListener("click", () => openPlanView());
  document.getElementById("plan-back").addEventListener("click", closePlanView);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && planOpen && !e.target.closest?.("input, select")) closePlanView();
  });

  if (urlSite && sites.some((s) => s.name === urlSite)) {
    selectSite(urlSite);
  }

  // A Plan link (#s=…, also what old /compare.html links redirect to)
  // opens straight into Plan.
  if (location.hash.startsWith("#s=")) {
    skipIntro();
    openPlanView({ fromLink: true });
    return;
  }

  const hasVisited = sessionStorage.getItem("intro_played");
  if (hasVisited) {
    skipIntro();
  } else {
    playIntro();
    sessionStorage.setItem("intro_played", "1");
  }
}

main().catch(console.error);
