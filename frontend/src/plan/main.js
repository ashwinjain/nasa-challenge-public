// Plan & compare: the full-screen view over the main app's 3D scene
// (#plan-overlay in index.html). State and wiring only; the views
// (rankView, whenView, compareTray, powerPanel) and the scoring (windows.js)
// live in their own files. The main app loads this module the first time
// Plan is opened and drives it through openPlan() / closePlan().
import "./plan.css";
import { loadPlanData, loadYears, METRICS, METRIC_ORDER, horizonKey, yearSeries, bestDays } from "./windows.js";
import { dateToMs, daysBetween, addDays } from "../shared/format.js";
import { renderRank } from "./rankView.js";
import { renderWhen } from "./whenView.js";
import { renderTray } from "./compareTray.js";
import { renderSiteList } from "./siteList.js";
import { renderRangeField, closeRangePicker } from "./rangePicker.js";
import { renderLand, loadLanding, landingRegionIds } from "./landView.js";
import { renderPower, getPower, powerSummary, showPowerLoading } from "./powerPanel.js";

const STORAGE_KEY = "lunar-nav-plan";
const MAX_PINS = 4;
const VIEWS = [
  ["date", "Pick a date → where?"],
  ["site", "Pick a site → when?"],
  ["land", "Where to land?"],
];
// Always a person standing on the ground: a 2 m eye height.
const EYE = "2";
// The year "Where to land?" is precomputed for (scripts/precompute_landing.py).
const LANDING_YEAR = 2027;
// The year Plan opens on (the crewed mission lands in early 2027). The
// windows files' own default_year is only a fallback if it isn't there.
const DEFAULT_YEAR = 2027;

let data = null;
let years = null;            // { years: [...], default_year }
let rankExpanded = false;   // "Pick a date" list: top few, or all sites
const state = {
  view: "date",
  metric: "sunlit",
  year: null,            // filled from the data on first load
  // Lands Jan 1, 2027: with the year-long default stay, Power & landing then
  // shows the same full-year numbers as the main page's card and tiles.
  from: "2027-01-01",
  to: "2027-01-08",
  siteId: "artemis-mp",
  stayDays: 7,
  selectedDay: null,     // day of year clicked in the "when?" view
  pins: [],              // { siteId, startHour, hours }
  custom: {},            // Customize: { stay, loads, crew, recycle, panelM }, only what's changed
  landTarget: 0,         // "Where to land?": selected target (index in the region's ranking)
};

// State lives in the URL (#s=…) so a view with its pins is a link you can
// share; localStorage only fills in when there's no link.
function load() {
  try {
    const m = location.hash.match(/^#s=(.+)$/);
    const saved = m ? decodeURIComponent(m[1]) : localStorage.getItem(STORAGE_KEY);
    Object.assign(state, JSON.parse(saved || "{}"));
  } catch { /* storage unavailable or a bad link */ }
  // Older links and saved state carried a smooth/terrain "mode"; it's always
  // terrain now.
  delete state.mode;
  delete state.eye;      // eye height is fixed at 2 m now
  if (state.view === "explore") state.view = "site";   // Explore was removed
  if (!METRICS[state.metric]) state.metric = "sunlit";  // e.g. the short-lived "contact"
  if (!state.custom || typeof state.custom !== "object") state.custom = {};
  delete state.custom.loadW;   // the single load slider became the load list
  // One crewed mission now: the robotic and short-crew profiles
  // are gone, and a load list or crew size saved for them doesn't apply.
  if (state.mission && state.mission !== "crew_long") { delete state.custom.loads; delete state.custom.crew; }
  delete state.mission;
}
function save() {
  const json = JSON.stringify(state);
  if (isOpen) history.replaceState(null, "", `${location.pathname}${location.search}#s=${encodeURIComponent(json)}`);
  try { localStorage.setItem(STORAGE_KEY, json); } catch { /* storage unavailable */ }
}

const $ = (id) => document.getElementById(id);
const key = () => horizonKey(EYE);
const year = () => state.year;
const stayHoursFromDates = () => (dateToMs(state.to) - dateToMs(state.from)) / 3600000;

// "Pick a site → when?" has no blackout charts: Earth's cycle is monthly,
// so the Earth in view chart states the longest blackouts instead.
const BLACKOUTS = ["blackout", "relayBlackout"];
const viewMetrics = () => (state.view === "site" ? METRIC_ORDER.filter((id) => !BLACKOUTS.includes(id)) : METRIC_ORDER);
const viewMetric = () => (viewMetrics().includes(state.metric) ? state.metric : "earth");

// ── Tooltip ──
const tooltip = {
  show(ev, html) {
    const t = $("plan-tooltip");
    t.innerHTML = html;
    t.style.display = "block";
    const pad = 12, r = t.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  },
  hide() { $("plan-tooltip").style.display = "none"; },
};

// ── Top bar: only the inputs the current view needs ──
function renderInputs() {
  const el = $("plan-inputs");
  const yr = `<span class="date-label">YEAR</span>
    <input id="in-year" class="plan-input num-input year-input" type="number" min="${years.years[0]}" max="${years.years[years.years.length - 1]}" step="1" value="${year()}">`;
  const stay = `<span class="date-label">STAY</span>
    <input id="in-stay" class="plan-input num-input" type="number" min="1" max="${data.index.max_stay_days}" step="1" value="${state.stayDays}">
    <span class="date-label">DAYS</span>`;
  // One calendar for the whole stay: click the landing day, then the last day.
  const dates = `<span class="date-label">DATES</span><span id="in-dates"></span>`;
  const div = `<div class="toolbar-divider"></div>`;
  // "Where to land?" is precomputed for the default mission and year; say so instead.
  const landNote = `<span class="date-label">CREWED BASE · ${LANDING_YEAR} · PRECOMPUTED</span>`;
  el.innerHTML = state.view === "land" ? landNote : {
    date: yr + div + dates,
    site: stay + div + yr,
  }[state.view];

  const on = (id, fn) => $(id) && $(id).addEventListener("change", fn);
  on("in-stay", (e) => {
    const v = Math.round(Number(e.target.value));
    if (!(v >= 1 && v <= data.index.max_stay_days)) { e.target.classList.add("invalid"); return; }
    state.stayDays = v; state.selectedDay = null; update();
  });
  if (!$("in-dates")) closeRangePicker();   // e.g. switched to "Pick a site"
  else {
    // Landing days run through Dec 31; the data runs on past it for long stays.
    const dataEnd = addDays(data.index.end_utc.slice(0, 10), -1);
    renderRangeField($("in-dates"), {
      from: state.from, to: state.to,
      min: `${year()}-01-01`, maxStart: `${year()}-12-31`, maxEnd: dataEnd,
      maxDays: data.index.max_stay_days,
      onPick: (from, to) => {
        if (!(daysBetween(from, to) >= 1 && daysBetween(from, to) <= data.index.max_stay_days)) return;
        state.from = from; state.to = to; update();
      },
    });
  }
  on("in-year", (e) => {
    const v = Math.round(Number(e.target.value));
    if (!years.years.includes(v)) { e.target.classList.add("invalid"); return; }
    setYear(v);
  });
}

function renderStatic() {
  $("plan-views").innerHTML = VIEWS.map(([v, label]) =>
    `<button class="seg-btn${state.view === v ? " active" : ""}" data-view="${v}">${label}</button>`).join("");
  $("plan-metrics").innerHTML = viewMetrics().map((id) =>
    `<button class="seg-btn${viewMetric() === id ? " active" : ""}" data-metric="${id}">${METRICS[id].label}</button>`).join("");
  // The rank table sorts by clicking its column headers instead.
  $("plan-metrics").style.display = state.view === "site" ? "" : "none";
  $("tray-count").textContent = state.pins.length ? `· ${state.pins.length} of ${MAX_PINS}` : "";
}

function pin(stay) {
  if (!stay) return;
  const same = (p) => p.siteId === stay.siteId && p.startHour === stay.startHour && p.hours === stay.hours;
  if (state.pins.some(same)) return flash("Already pinned");
  if (state.pins.length >= MAX_PINS) return flash(`Up to ${MAX_PINS} pins: remove one first`);
  state.pins.push(stay);
  update();
}

const samePin = (a, b) => a.siteId === b.siteId && a.startHour === b.startHour && a.hours === b.hours;
const isPinned = (stay) => state.pins.some((p) => samePin(p, stay));

// The stay a site's checkbox pins in "Pick a site → when?": the day you
// clicked on the chart if it's the charted site, otherwise its best day (①).
function siteStay(siteId) {
  const site = data.byId.get(siteId);
  const series = yearSeries(site, key(), year(), state.stayDays);
  const day = siteId === state.siteId && state.selectedDay != null
    ? state.selectedDay
    : bestDays(series, viewMetric(), state.stayDays * 24, 1)[0].day;
  return { siteId, startHour: site.hourOf(series[day].ms), hours: state.stayDays * 24 };
}

function unpin(stay) {
  const i = state.pins.findIndex((p) => samePin(p, stay));
  if (i < 0) return;
  state.pins.splice(i, 1);
  update();
}

function flash(msg) {
  const el = $("tray-flash");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(flash.t);
  flash.t = setTimeout(() => el.classList.remove("show"), 1800);
}

// Switch years: load that year's data and move the dates along with it.
// Pins are hours into one year's data, so they're cleared.
async function setYear(y) {
  if (y === state.year) return;
  const shift = (iso) => `${y + (Number(iso.slice(0, 4)) - state.year)}${iso.slice(4)}`;
  showPowerLoading($("power-body"));   // dashes, not last year's numbers, while it loads
  data = await loadPlanData(y);
  state.from = shift(state.from);
  state.to = shift(state.to);
  if (state.from.slice(5) === "02-29" && !isLeap(y)) state.from = `${y}-02-28`;
  if (state.to.endsWith("-02-29") && !isLeap(Number(state.to.slice(0, 4)))) state.to = state.to.replace("-02-29", "-03-01");
  const hadPins = state.pins.length > 0;
  state.year = y;
  state.selectedDay = null;
  state.pins = [];
  update();
  if (hadPins) flash(`Compare cleared for ${y}`);
}
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// ── Render everything from state ──
function update() {
  save();
  renderStatic();
  renderInputs();
  tooltip.hide();
  renderBody();
  renderTrayPanel();
  renderPowerPanel();
}

// The main view: ranking ("pick a date") or best dates ("pick a site").
function renderBody() {
  const body = $("plan-body");
  if (state.view === "date") {
    renderRank(body, {
      data, key: key(), metric: state.metric,
      startMs: dateToMs(state.from), hours: stayHoursFromDates(),
      selectedSiteId: state.siteId,
      expanded: rankExpanded,
      onToggleExpand: () => { rankExpanded = !rankExpanded; update(); },
      onSelect: (id) => setSite(id),
      pins: state.pins,
      onPin: pin,
      onUnpin: unpin,
      onSort: (id) => { state.metric = id; update(); },
      verdict: (site, startHour) => verdictAt(site, site.msOf(startHour)),
    });
  } else if (state.view === "land") {
    loadLanding().then(() => {
      if (state.view !== "land") return;
      const ids = landingRegionIds();
      renderLand(body, {
        regionId: ids.includes(state.siteId) ? state.siteId : ids[0],
        targetIdx: state.landTarget,
        onRegion: (id) => { state.landTarget = 0; setSite(id); },
        onTarget: (i) => { state.landTarget = i; save(); renderBody(); },
        onView3D: hooks.onViewTarget,
      });
    }).catch((e) => {
      body.textContent = "Couldn't load /data/landing.json. Run scripts/precompute_landing.py --export-only.";
      console.error(e);
    });
  } else if (state.view === "site") {
    body.innerHTML = `<div class="when-layout"><div class="site-list" id="plan-site-list"></div><div id="plan-when-chart"></div></div>`;
    renderSiteList($("plan-site-list"), {
      data, selectedId: state.siteId,
      onSelect: (id) => { state.selectedDay = null; setSite(id); },
      stayFor: siteStay, isPinned, onPin: pin, onUnpin: unpin,
    });
    renderWhen($("plan-when-chart"), {
      site: data.byId.get(state.siteId), key: key(), metric: viewMetric(),
      year: year(), stayDays: state.stayDays, selectedDay: state.selectedDay, tooltip,
      onSelectDay: (p) => { state.selectedDay = p.day; update(); },
      verdictFor: (p) => verdictAt(data.byId.get(state.siteId), p.ms),
    });
  }
}

// Customize changed: re-draw what depends on it, but not the inputs above.
function onCustom(patch) {
  if (patch === null) state.custom = {};
  else for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete state.custom[k];
    else state.custom[k] = v;
  }
  save();
  renderBody();          // pass/fail depends on the load and crew
  renderTrayPanel();
  renderPowerPanel();
}

function renderTrayPanel() {
  renderTray($("tray-body"), {
    data, key: key(), pins: state.pins,
    // In "pick a date", rows on the top-bar dates don't repeat them.
    showDate: (p) => {
      if (state.view !== "date") return true;
      const site = data.byId.get(p.siteId);
      return !(p.startHour === site.hourOf(dateToMs(state.from)) && p.hours === stayHoursFromDates());
    },
    onRemove: (i) => { state.pins.splice(i, 1); update(); },
  });
}

// Pass/fail for one site landing at ``ms``, on the page's Customize
// settings (the crew stay is one of them): {pass: true|false|null (loading), text}.
function verdictAt(site, ms) {
  const startIso = new Date(ms).toISOString().slice(0, 10);
  return powerSummary(getPower(site, startIso, state.custom, scheduleUpdate), state.custom);
}

// Re-render once after power results arrive (several can land together).
let updateQueued = false;
function scheduleUpdate() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => { updateQueued = false; update(); });
}

// Power & landing: the selected site, landed on the top-bar date ("pick a
// date") or the chosen/best day ("pick a site"). The crew stay is set in
// Customize (a year by default), not by the page's dates.
function renderPowerPanel() {
  // "Where to land?" carries its own power numbers (a precomputed year-round
  // base); a live panel with other settings next to it would contradict them.
  const section = $("power-body").closest("section");
  section.hidden = state.view === "land";
  if (section.hidden) return;
  const site = data.byId.get(state.siteId);
  let startMs;
  if (state.view === "date") {
    startMs = dateToMs(state.from);
  } else {
    const series = yearSeries(site, key(), year(), state.stayDays);
    const day = state.selectedDay ?? bestDays(series, viewMetric(), state.stayDays * 24, 1)[0].day;
    startMs = series[day].ms;
  }
  renderPower($("power-body"), {
    site, startIso: new Date(startMs).toISOString().slice(0, 10), custom: state.custom, onCustom,
  });
}

// Picking a site here also selects it in the 3D view (the main app's
// onSiteChange), so going back shows the site you were planning for.
function setSite(id) {
  state.siteId = id;
  update();
  if (hooks.onSiteChange) hooks.onSiteChange(id);
}

let isOpen = false;
let ready = null;            // the one-time setup, shared by every open
let hooks = {};

async function init() {
  load();
  years = await loadYears();
  if (!years.years.includes(state.year)) {
    state.year = years.years.includes(DEFAULT_YEAR) ? DEFAULT_YEAR : years.default_year;
  }
  // Dates outside the year (e.g. the defaults when the year fell back): Jan 1–8.
  if (state.from.slice(0, 4) !== String(state.year)) {
    state.from = `${state.year}-01-01`;
    state.to = `${state.year}-01-08`;
  }
  data = await loadPlanData(state.year);
  if (!data.byId.has(state.siteId)) state.siteId = data.sites[0].id;
  // Drop pins for sites that no longer have data.
  state.pins = state.pins.filter((p) => data.byId.has(p.siteId));

  $("plan-views").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) { state.view = b.dataset.view; update(); }
  });
  $("plan-metrics").addEventListener("click", (e) => {
    const b = e.target.closest("[data-metric]");
    if (b) { state.metric = b.dataset.metric; update(); }
  });
  let t = 0;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => isOpen && state.view === "site" && update(), 120);
  });
  $("plan-overlay").addEventListener("scroll", () => tooltip.hide(), { passive: true });
}

// Show the Plan view. siteId: the site selected in the 3D view, if any; it
// becomes the planned site.
// onSiteChange(siteId): called when a site is picked here.
// Returns false if the planning data couldn't be loaded.
export async function openPlan({ siteId = null, onSiteChange = null, onViewTarget = null } = {}) {
  hooks = { onSiteChange, onViewTarget };
  $("plan-overlay").hidden = false;
  isOpen = true;
  ready ??= init();
  try {
    await ready;
  } catch (e) {
    ready = null;              // try again on the next open
    $("plan-body").textContent = "Couldn't load /data/windows. Run scripts/precompute_windows.py.";
    console.error(e);
    return false;
  }
  if (!isOpen) return true;    // closed again while loading
  if (siteId && data.byId.has(siteId) && siteId !== state.siteId) {
    state.siteId = siteId;
    state.selectedDay = null;
  }
  update();
  return true;
}

// Hide the Plan view and take its #s= state out of the address bar. The
// state stays saved in localStorage for the next open.
export function closePlan() {
  if (!isOpen) return;
  isOpen = false;
  tooltip.hide();
  closeRangePicker();
  $("plan-overlay").hidden = true;
  if (location.hash.startsWith("#s=")) history.replaceState(null, "", `${location.pathname}${location.search}`);
}

export const planSiteId = () => state.siteId;
