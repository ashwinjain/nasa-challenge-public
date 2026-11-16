// "Power & landing" (Phase 4): for the chosen site and landing date, what the
// crewed mission needs (panels, battery) and the tonnage to
// land on the Moon. Every assumption is in data/phase-4/assumptions.csv.
//
// Numbers are worked out in the page (sunPower.js → powerSize.js, the same
// math as lunarsky/power.py) from the hourly Sun at the region's #1 landing
// target panel spot, panels 10 m up. Only what those files don't cover (a
// site without one, another panel height, dates outside 2026–2036) asks
// /api/power, at the same point.
//
// Customize: water recycling is applied on top of a result (powerModel.js);
// crew stay, crew size, the load list and panel height re-size it.

import { fmtHours as hrs, kitTonnes } from "../shared/format.js";
import { tilesHtml } from "../shared/tiles.js";
import { customize } from "./powerModel.js";
import { PANEL_HEIGHT_M } from "../shared/assumptions.js";
import { localPower, sunPoint } from "./sunPower.js";

// Panels on a 10 m mast, like NASA's VSAT reference design.
export const DEFAULT_PANEL_M = PANEL_HEIGHT_M;
// The crew stays a year by default (a year-round base); Customize can shorten it.
export const DEFAULT_STAY_DAYS = 365;

const cache = new Map();          // url → result (or a pending Promise)
let inputsSeen = null;            // result.inputs (ranges and sources), once one arrives
let shown = "";                   // url the panel is currently drawing
let last = null;                  // { el, ctx } of the latest renderPower call
let customOpen = null;            // Customize open/closed, kept across re-renders

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kw = (w) => (w >= 1000 ? `${+(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);

// (always-on W, daylight-only W, contact-only W) of a load list; per-person lines count
// ``crew`` times.
export function loadSplit(loads, crew = 0) {
  let always = 0, day = 0, contact = 0;
  for (const l of loads) {
    const w = l.w * (l.per_crew ? crew : 1);
    if (l.when === "day") day += w; else if (l.when === "contact") contact += w; else always += w;
  }
  return { always, day, contact };
}

// custom: state.custom; crew stay, panel height and an edited load list change the request.
// The point is the region's panel spot when there's a Sun file for it (so the
// server, if asked, sizes the same place), else the site itself.
function powerUrl(site, startIso, custom = {}) {
  const at = sunPoint(site.id) || site;
  const params = new URLSearchParams({ lat: at.lat, lon: at.lon, start: startIso });
  if (custom.stay != null && custom.stay !== DEFAULT_STAY_DAYS) params.set("days", String(custom.stay));
  // Always sent: the server's own default is 2 m.
  params.set("height_m", String(custom.panelM ?? DEFAULT_PANEL_M));
  // Crew size changes the per-person load lines, so it goes to the server.
  if (custom.crew != null) params.set("crew", String(custom.crew));
  if (custom.loads) {
    const crew = custom.crew ?? inputsSeen?.crew?.value ?? 0;
    const { always, day, contact } = loadSplit(custom.loads, crew);
    params.set("always_w", String(always));
    params.set("day_w", String(day));
    params.set("contact_w", String(contact));
  }
  return `/api/power?${params}`;
}

// The /api/power result, or null while it's loading (then
// ``onReady`` is called once it arrives). Shared by the panel and the
// Compare rows; each distinct request is fetched once.
// A request that hasn't answered by then is given up on, so one stuck
// request can't hold the panel on "Working out…" for good (a site's first
// request on Cloud Run reads terrain from the bucket, ~40 s). A failed result is kept briefly, then asked
// for again the next time the page redraws.
const TIMEOUT_MS = 120_000;
const RETRY_MS = 5_000;

export function getPower(site, startIso, custom, onReady) {
  const url = powerUrl(site, startIso, custom);
  let hit = cache.get(url);
  if (hit && hit.error && Date.now() - hit.at > RETRY_MS) hit = null;
  if (hit && !(hit instanceof Promise)) return hit;
  const p = hit || sizePower(site, startIso, custom, url);
  if (!hit) cache.set(url, p);
  p.then(() => onReady && onReady());
  return null;
}

// In the page when the Sun files cover it, else the server.
function sizePower(site, startIso, custom, url) {
  return localPower(site, startIso, custom, DEFAULT_STAY_DAYS)
    .catch(() => null)
    .then((res) => {
      if (!res) return fetchPower(url);
      if (res.inputs) inputsSeen = res.inputs;
      cache.set(url, res);
      return res;
    });
}

function fetchPower(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  return fetch(url, { signal: ctl.signal })
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      return r.ok ? j : { error: j.detail || `Server error ${r.status}` };
    })
    .catch(() => ({
      error: ctl.signal.aborted
        ? "The API took too long to answer. Change anything to try again."
        : "Can't reach the API. Start it with: .venv/bin/uvicorn lunarsky.api:app --port 8000",
    }))
    .then((res) => {
      clearTimeout(timer);
      if (res.error) res.at = Date.now();
      if (res.inputs) inputsSeen = res.inputs;
      cache.set(url, res);
      return res;
    });
}

// One line for a Compare row: the tonnage to land. {text, kg, pass}.
export function powerSummary(r, custom = {}) {
  if (!r) return { text: "Working out power and tonnage…", kg: null, pass: null };
  if (r.error) return { text: r.error, kg: null, pass: null };
  r = customize(r, custom);
  const v = r.verdict;
  if (!r.feasible || !v.ok) return { text: v.text, kg: null, pass: false };
  const kit = kitTonnes(r.best.battery_kg / 1000, r.best.array_kg / 1000);
  return { text: `${kit.total} to land`, kg: v.total_kg, kit, pass: true };
}

// ctx: { site, startIso, custom, onCustom }
//   custom: { stay, loads, crew, recycle (0–1), panelM } — only what's changed.
//   loads: [{ id, name, w, when: "always" | "day" }], the whole edited list.
//   onCustom(patch): patch values of undefined go back to the default;
//   onCustom(null) resets everything.
export function renderPower(el, ctx) {
  const { site, startIso } = ctx;
  const custom = ctx.custom || {};
  const url = powerUrl(site, startIso, custom);
  shown = url;
  last = { el, ctx };

  // Head, Customize and results are separate so dragging a slider only
  // redraws the results, never the slider itself.
  if (!el.querySelector(".pw-results")) {
    el.innerHTML = `<div class="pw-head"></div><details class="pw-custom"></details><div class="pw-results"></div>`;
  }
  const res = getPower(site, startIso, custom,
    () => { if (shown === url && last) renderPower(last.el, last.ctx); });
  const inputs = (res && res.inputs) || inputsSeen;

  el.querySelector(".pw-head").innerHTML = headHtml(ctx);
  const box = el.querySelector(".pw-custom");
  if (inputs && !box.dataset.built) buildCustomize(box, inputs);
  if (box.dataset.built) {
    box.querySelector(".pw-reset").hidden = !Object.keys(custom).length;
    box.querySelector(".pw-loads").refreshCrew?.();
  }

  const out = el.querySelector(".pw-results");
  // While it's being worked out: the tiles as dashes, never the last numbers.
  if (!res) out.innerHTML = loadingHtml();
  else if (res.error) out.innerHTML = `<div class="pw-msg">${esc(res.error)}</div>`;
  else out.innerHTML = body(customize(res, custom)) + footnote(custom.loads || inputs?.loads || []);
}

function headHtml({ site }) {
  return `<div class="pw-where"><b>${esc(site.name)}</b></div>`;
}

// ── Customize ──

// The editable fields. Values in the page's own units
// (`scale` converts to the model: W, people, fraction, metres).
function fields(inputs) {
  const list = [{
    key: "stay", label: "Crew stay", unit: "days", scale: 1, int: true, server: true,
    def: DEFAULT_STAY_DAYS, min: 1, max: 365, step: 1, sliderMin: 1, sliderMax: 365,
    source: "How long the crew stays, from the landing day. A full year is sized to run year after year, so every night is covered; a shorter stay is sized for its own days only",
  }];
  if (inputs.crew) {
    const C = inputs.crew;
    list.push({
      key: "crew", label: "Crew", unit: "people", scale: 1, int: true, server: true,
      def: C.value, low: C.low, high: C.high, min: 1, max: 50, step: 1,
      sliderMin: 1, sliderMax: 12, source: C.source, rangeName: "Planned range",
    });
  }
  list.push({
    key: "panelM", label: "Panel height", unit: "m", scale: 1, server: true,
    def: DEFAULT_PANEL_M, min: 0, max: 20, step: 0.5, sliderMin: 0, sliderMax: 20,
    source: "Height of the panel above the ground. A taller mast sees over more of the terrain; the skyline is redrawn for it",
  });
  return list;
}

const fmtNum = (v) => String(+v.toFixed(2));

function noteFor(f, v) {
  const u = f.unit === "%" ? "%" : ` ${f.unit}`;
  if (f.low == null) return { text: `Default ${fmtNum(f.def)}${u}`, out: false };
  const range = f.low === f.high ? `${fmtNum(f.low)}` : `${fmtNum(f.low)}–${fmtNum(f.high)}`;
  const out = v < f.low - 1e-9 || v > f.high + 1e-9;
  return { text: out ? `Outside ${f.rangeName.toLowerCase()} (${range}${u})` : `${f.rangeName} ${range}${u}`, out };
}

function buildCustomize(box, inputs) {
  const fs = fields(inputs);
  const custom = (last && last.ctx.custom) || {};
  const shownValue = (f) => (custom[f.key] != null ? custom[f.key] / f.scale : f.def);
  if (customOpen === null) customOpen = Object.keys(custom).length > 0;
  box.open = customOpen;
  box.dataset.built = "1";
  box.innerHTML = `<summary>Customize</summary>
    <div class="pw-loads"></div>
    <div class="pw-fields">${fs.map((f) => {
      const v = shownValue(f);
      const n = noteFor(f, v);
      return `<div class="pw-field${Math.abs(v - f.def) > 1e-9 ? " changed" : ""}" data-key="${f.key}">
        <label class="pw-flabel" for="pw-in-${f.key}">${f.label} <span class="pw-unit">${f.unit}</span></label>
        <div class="pw-frow">
          <input type="range" min="${f.sliderMin}" max="${f.sliderMax}" step="${f.step}" value="${v}" aria-label="${f.label}">
          <input id="pw-in-${f.key}" type="number" class="plan-input num-input" min="${f.min}" max="${f.max}" step="${f.step}" value="${fmtNum(v)}">
        </div>
        <div class="pw-fnote${n.out ? " out" : ""}" title="${esc(f.source)}">${n.text}</div>
      </div>`;
    }).join("")}</div>
    <div class="pw-customfoot"><button type="button" class="pw-reset" hidden>Reset to defaults</button></div>`;

  buildLoads(box.querySelector(".pw-loads"), inputs, custom.loads);
  box.addEventListener("toggle", () => { customOpen = box.open; });
  box.querySelector(".pw-reset").addEventListener("click", () => {
    box.dataset.built = "";               // rebuild with the default values
    last && last.ctx.onCustom && last.ctx.onCustom(null);
  });

  for (const f of fs) {
    const wrap = box.querySelector(`[data-key="${f.key}"]`);
    const [range, num] = wrap.querySelectorAll("input");
    const note = wrap.querySelector(".pw-fnote");
    let timer = 0;
    const apply = (v) => {
      if (f.int) v = Math.round(v);
      const isDef = Math.abs(v - f.def) < 1e-9;
      wrap.classList.toggle("changed", !isDef);
      const n = noteFor(f, v);
      note.textContent = n.text;
      note.classList.toggle("out", n.out);
      const model = isDef ? undefined : +(v * f.scale).toFixed(6);
      clearTimeout(timer);
      // Local fields redraw at once; panel height waits for a pause (a server call).
      timer = setTimeout(() => last && last.ctx.onCustom && last.ctx.onCustom({ [f.key]: model }), f.server ? 350 : 0);
    };
    range.addEventListener("input", () => {
      num.value = fmtNum(Number(range.value));
      num.classList.remove("invalid");
      apply(Number(range.value));
    });
    num.addEventListener("input", () => {
      const v = Number(num.value);
      const ok = num.value !== "" && Number.isFinite(v) && v >= f.min && v <= f.max && (!f.int || Number.isInteger(v));
      num.classList.toggle("invalid", !ok);
      if (!ok) return;
      range.value = String(v);
      apply(v);
    });
  }
}

// ── Load list ──
// One row per thing that draws power. Lines taken or worked out from a
// published source are fixed; our own estimates are marked * and their
// watts can be changed. When a line runs (always, or daylight only so the
// battery doesn't carry it) is fixed. Per-person lines scale with the crew.
// Edits go to the server after a pause; a list back at the default is
// dropped.

const WHEN_LABEL = { always: "Always", day: "Daylight", contact: "Earth contact" };
const sameList = (a, b) => a.length === b.length &&
  a.every((x, i) => x.id === b[i].id && x.w === b[i].w && x.name === b[i].name);
const lineW = (r, crew) => r.w * (r.per_crew ? crew : 1);

function buildLoads(el, inputs, saved) {
  const pick = ({ id, name, w, when, per_crew, estimate, editable }) => ({ id, name, w, when, per_crew, estimate, editable });
  const defaults = inputs.loads.map(pick);
  const byId = new Map([...inputs.loads, ...inputs.extra_loads].map((l) => [l.id, l]));
  const baseId = (id) => id.replace(/#\d+$/, "");
  // Saved lists from before fixed lines: take the flags and fixed values from the source.
  let rows = (saved || defaults).filter((r) => byId.has(baseId(r.id))).map((r) => {
    const src = pick(byId.get(baseId(r.id)));
    return { ...src, id: r.id, w: src.editable ? r.w : src.w, name: src.id === "li_extra_custom" ? r.name : src.name };
  });
  if (!rows.length) rows = defaults.map((r) => ({ ...r }));
  let timer = 0;
  let n = 0;                                  // makes ids of added rows unique
  const crewNow = () => (last && last.ctx.custom && last.ctx.custom.crew) ?? inputs.crew?.value ?? 0;

  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => last && last.ctx.onCustom &&
      last.ctx.onCustom({ loads: sameList(rows, defaults) ? undefined : rows.map((r) => ({ ...r })) }), 400);
  };
  const info = (r) => {
    const a = byId.get(baseId(r.id));
    if (!a) return "";
    const range = r.editable && a.low != null ? ` Range ${kw(a.low)}–${kw(a.high)}.` : "";
    return `${a.source}.${range} ${a.notes || ""}`;
  };
  const totals = () => {
    const { always, day, contact } = loadSplit(rows, crewNow());
    const radio = contact ? ` · + <b>${kw(contact)}</b> while talking to Earth` : "";
    return `<b>${kw(always + day)}</b> in sunlight · <b>${kw(always)}</b> at night${radio}`;
  };
  const fixedW = (r) => (r.per_crew
    ? `${kw(r.w)} × ${crewNow()} = <b>${kw(lineW(r, crewNow()))}</b>`
    : `<b>${kw(r.w)}</b>`);
  const isChanged = (r) => {
    const d = defaults.find((x) => x.id === r.id);
    return !d || d.w !== r.w;
  };

  const draw = () => {
    el.innerHTML = `<div class="pw-loads-head"><span>Power load</span><span>Watts</span><span>When it runs</span><span></span></div>
      ${rows.map((r, i) => {
        const star = r.estimate ? '<span class="pw-star" title="Our estimate: no published figure">*</span>' : "";
        const name = r.id.startsWith("li_extra_custom")
          ? `<input type="text" class="plan-input pw-load-name" value="${esc(r.name)}" aria-label="Load name" maxlength="40">`
          : `<span class="pw-load-name" title="${esc(info(r))}">${esc(r.name)}${star}</span>`;
        const watts = r.editable
          ? `<input type="number" class="plan-input num-input pw-load-w" min="0" max="1000000" step="10" value="${r.w}" aria-label="${esc(r.name)} watts">`
          : `<span class="pw-load-fixed" title="${esc(info(r))}">${fixedW(r)}</span>`;
        return `<div class="pw-load${isChanged(r) ? " changed" : ""}${r.editable ? "" : " fixed"}" data-i="${i}">
          ${name}${watts}
          <span class="pw-load-when">${WHEN_LABEL[r.when]}</span>
          <button type="button" class="pw-load-x" title="Remove" aria-label="Remove ${esc(r.name)}">✕</button>
        </div>`;
      }).join("")}
      <div class="pw-loads-foot">
        <select class="plan-input pw-load-add" aria-label="Add a load">
          <option value="">+ Add a load…</option>
          ${inputs.extra_loads.map((x) => `<option value="${x.id}">${esc(x.name)}${x.estimate ? "*" : ""} (${kw(x.w)})</option>`).join("")}
        </select>
        <span class="pw-load-total">${totals()}</span>
      </div>`;

    el.querySelectorAll(".pw-load").forEach((row) => {
      const r = rows[Number(row.dataset.i)];
      const w = row.querySelector(".pw-load-w");
      if (w) w.addEventListener("input", () => {
        const v = Number(w.value);
        const ok = w.value !== "" && Number.isFinite(v) && v >= 0 && v <= 1e6;
        w.classList.toggle("invalid", !ok);
        if (!ok) return;
        r.w = v;
        row.classList.toggle("changed", isChanged(r));
        el.querySelector(".pw-load-total").innerHTML = totals();
        const s = loadSplit(rows, crewNow());
        if (s.always + s.day > 0) send();
      });
      const nameIn = row.querySelector("input.pw-load-name");
      if (nameIn) nameIn.addEventListener("change", () => { r.name = nameIn.value.trim() || "Custom load"; send(); });
      row.querySelector(".pw-load-x").addEventListener("click", () => {
        if (rows.length === 1) return;          // keep at least one line
        rows.splice(Number(row.dataset.i), 1);
        draw();
        send();
      });
    });
    el.querySelector(".pw-load-add").addEventListener("change", (e) => {
      const x = byId.get(e.target.value);
      if (!x) return;
      // Repeats (two drills) get their own id.
      const id = rows.some((r) => r.id === x.id) ? `${x.id}#${++n + rows.length}` : x.id;
      rows.push({ ...pick(x), id });
      draw();
      send();
    });
  };
  draw();
  // Crew changed: redraw the per-person lines and the totals, not the inputs.
  el.refreshCrew = () => {
    el.querySelectorAll(".pw-load").forEach((row) => {
      const r = rows[Number(row.dataset.i)];
      if (r && r.per_crew) row.querySelector(".pw-load-fixed").innerHTML = fixedW(r);
    });
    el.querySelector(".pw-load-total").innerHTML = totals();
  };
}

// ── Results ──

// Under the results: what the * on a load line means.
function footnote(loads) {
  if (!loads.some((l) => l.estimate)) return "";
  return `<div class="pw-footnote"><span class="pw-star">*</span> Our estimate: no published figure was found for this line, so you can change its watts. Every other load line is taken or worked out from a published source (hover a line for it) and is fixed.</div>`;
}

// Blank the results to dashes now, e.g. while a new year's data loads.
export function showPowerLoading(el) {
  const out = el.querySelector(".pw-results");
  if (out) out.innerHTML = loadingHtml();
}

// The result tiles' layout with "—" for every value, while a result is on its way.
function loadingHtml() {
  const tiles = tilesHtml([
    { value: "—", label: `Sunlit · panels at ${fmtNum(DEFAULT_PANEL_M)} m`, kind: "sun" },
    { value: "—", label: "Longest night at panels", kind: "sun" },
    { value: "—", label: "Data storage", kind: "earth" },
    { value: "—", label: "Solar panels" },
    { value: "—", label: "Battery" },
    { value: "—", label: "Total to land", kind: "total" },
  ]);
  return `<div class="metrics-grid pw-tiles">${tiles}</div><div class="pw-foot">Working out panels and battery…</div>`;
}

function body(r) {
  const v = r.verdict;
  if (!r.feasible || !v.ok) return `<div class="pw-msg">${esc(v.text)}</div>`;
  const b = r.best;
  // Two decimals, and the total is the sum of the parts as shown.
  const kit = kitTonnes(b.battery_kg / 1000, b.array_kg / 1000);
  const tiles = tilesHtml([
    // Share of the Sun's disk the panel sees, averaged over the stay (a sliver
    // over a ridge counts as a sliver, not as "up").
    { value: `${Math.round(r.sunlit_fraction * 100)}%`, label: `Sunlit · panels at ${fmtNum(r.panel_height_m)} m`, kind: "sun" },
    { value: hrs(r.longest_dark_hours), label: "Longest night at panels", kind: "sun" },
    // Data piles up on board while Earth is out of contact; the biggest pile
    // is the storage needed. Sending it needs no extra battery: the radio
    // already draws for every contact hour.
    r.data && { value: `${fmtNum(Math.ceil(r.data.storage_gb))} GB`,
      label: `Data storage · ${hrs(r.data.longest_blackout_hours)} longest blackout`, kind: "earth",
      title: `${fmtNum(r.data.data_per_day_gb)} Gb/day made, sent at ${fmtNum(r.data.downlink_mbps)} Mbps while Earth is in direct contact (NASA NESC Artemis surface comms baseline). The largest backlog is the storage needed; the radio already runs every contact hour, so sending it adds no battery.` },
    { value: `${Math.round(b.array_m2)} m²`, label: `Solar panels · ${kit.array}` },
    { value: `${Math.round(b.battery_kwh)} kWh`, label: `Battery · ${kit.battery}` },
    { value: kit.total, label: "Total to land", kind: "total" },
  ]);
  const from = r.start_utc ? ` landing ${r.start_utc.slice(0, 10)}` : "";
  const stay = r.mission.days >= 365 ? `a year-round base${from} (Sunlit and night: the year from then)` : `a ${fmtNum(r.mission.days)}-day stay${from}`;
  const foot = `<div class="pw-foot">Sized for ${stay} · sun-tracking panels at ${fmtNum(r.panel_height_m)} m · ${kw(r.always_w)} always on + ${kw(r.day_w)} daylight only${r.contact_w ? ` + ${kw(r.contact_w)} radio during Earth contact (${Math.round((r.contact_fraction ?? 1) * 100)}% of the stay)` : ""}, + ${Math.round(r.power_margin * 100)}% margin · ${r.horizon === "terrain" ? "terrain skyline" : "smooth Moon (no terrain map)"}${r.panel_point ? ` · panels at landing target #${r.panel_point.target_rank}'s panel spot` : ""} · air, water, food, habitat, rover and lander structure not counted (same at every site)</div>`;
  return `<div class="metrics-grid pw-tiles">${tiles}</div>${foot}`;
}
