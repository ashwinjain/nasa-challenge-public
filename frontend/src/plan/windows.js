// Planning data and scoring: no DOM in here, so it moves into the main app as is.
//
// Each polar site has a precomputed file of "runs" (scripts/precompute_windows.py,
// lunarsky/windows.py): [start, stop) hour indices during which the Sun or Earth
// is up against the terrain skyline at each eye height. From
// those we rebuild hourly flags and score any stay (site + landing hour + length)
// in the browser, so changing dates, stay length or metric is instant.
//
// Contact (Phase 5): direct contact is Earth above the site's skyline AND a
// Deep Space Network dish seeing the Moon. The DSN half is the same for every
// polar site, so it's one file per year (windows/{year}/dsn.json). With a
// pair of relay satellites, the site can also reach Earth whenever either is
// above its skyline (the "relay" runs), still through the DSN.

import { PANEL_HEIGHT_M } from "../shared/assumptions.js";
import { fmtHours } from "../shared/format.js";

const HOUR_MS = 3600 * 1000;
// Blackouts are counted in whole steps of the windows files (1 h), so a
// value at or below one step only says "shorter than the step".
const WINDOW_STEP_H = 1;
const fmtGap = (h) => (h <= WINDOW_STEP_H ? `<${WINDOW_STEP_H} h` : fmtHours(h));

// ── Metrics ──
// `score` maps a value to 0..1 where 1 is best, so every view can draw
// "taller / brighter = better" whatever the metric's direction.
export const METRICS = {
  sunlit: {
    label: "Sunlit %", short: "Sunlit", body: "sun", better: "high",
    value: (m) => m.sunlit,
    format: (v) => `${Math.round(v * 100)}%`,
    score: (v) => v,
  },
  dark: {
    label: "Longest night", short: "Night", body: "sun", better: "low",
    value: (m) => m.longestDarkH,
    format: fmtHours,
    score: (v, stayH) => 1 - Math.min(1, v / stayH),
  },
  earth: {
    label: "Earth in view", short: "Earth", body: "earth", better: "high",
    value: (m) => m.earth,
    format: (v) => `${Math.round(v * 100)}%`,
    score: (v) => v,
  },
  // A blackout is any stretch with no contact with Earth: Earth behind the
  // terrain or no DSN dish seeing the Moon, and, with the relays, both
  // relays also out of reach.
  blackout: {
    label: "Longest comms blackout", short: "Comms out", body: "earth", better: "low",
    value: (m) => m.longestBlackoutH,
    format: fmtGap,
    score: (v, stayH) => 1 - Math.min(1, v / stayH),
  },
  relayBlackout: {
    label: "Blackout w/ relays", short: "w/ relays", body: "earth", better: "low",
    value: (m) => m.longestBlackoutRelayH,
    format: fmtGap,
    score: (v, stayH) => 1 - Math.min(1, v / stayH),
  },
};
export const METRIC_ORDER = ["sunlit", "dark", "earth", "blackout", "relayBlackout"];


// Always the terrain skyline: "terrain_<eye>", matching the keys in the
// windows files. (The files also hold a "smooth" key; the app never uses it.)
export function horizonKey(eyeKey) {
  return `terrain_${eyeKey}`;
}

// Earth contact (Earth, the relay, DSN) is always at the antenna: a 10 m mast,
// like the panels. The person's eye height only changes the Sun.
export const ANTENNA_HEIGHT_M = PANEL_HEIGHT_M;
const ANTENNA_BODIES = new Set(["earth", "relay", "contact", "relayContact"]);
function bodyKey(key, body) {
  return ANTENNA_BODIES.has(body) && key.startsWith("terrain_") ? horizonKey(ANTENNA_HEIGHT_M) : key;
}

// ── Dates ──
// All dates are "YYYY-MM-DD" in UTC, like the rest of the app
// (parsing and arithmetic are in shared/format.js).
export function fmtDay(ms, opts = { month: "short", day: "numeric" }) {
  return new Date(ms).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}
export function fmtRange(startMs, hours) {
  const endMs = startMs + hours * HOUR_MS;
  return `${fmtDay(startMs)} – ${fmtDay(endMs, { month: "short", day: "numeric", year: "numeric" })}`;
}

// ── One site's year ──
export class SiteYear {
  // dsn: hourly 0/1 flags (a DSN dish sees the Moon) on the same hours, or
  // null to treat the DSN as always available.
  constructor(json, dsn = null) {
    this.dsn = dsn;
    this.id = json.site_id;
    this.name = json.name;
    this.lat = json.lat;
    this.lon = json.lon;
    this.t0 = Date.parse(json.start_utc);
    this.step = json.step_hours;
    this.n = json.samples;
    this.horizons = json.horizons;
    this._masks = new Map();
  }

  // Hourly 0/1 flags for one body under one horizon, built once and cached.
  // "contact": Earth in view and a DSN dish sees the Moon.
  // "relayContact": Earth or the relay in view, and a DSN dish sees the Moon.
  // A file without relay runs gives no relay (relayContact = contact).
  mask(key, body) {
    key = bodyKey(key, body);
    const id = `${key}/${body}`;
    let m = this._masks.get(id);
    if (!m) {
      if (body === "contact" || body === "relayContact") {
        m = this.mask(key, "earth").slice();
        if (body === "relayContact") {
          const relay = this.mask(key, "relay");
          for (let i = 0; i < m.length; i++) m[i] |= relay[i];
        }
        if (this.dsn) for (let i = 0; i < m.length; i++) m[i] &= this.dsn[i];
      } else {
        m = new Uint8Array(this.n);
        for (const [a, b] of this.horizons[key][body] ?? []) m.fill(1, a, b);
      }
      this._masks.set(id, m);
    }
    return m;
  }


  // Hourly percent of the Sun's disk showing (0–100), built once and cached.
  sunPct(key) {
    const id = `${key}/sunPct`;
    let m = this._masks.get(id);
    if (!m) {
      m = new Uint8Array(this.n);
      for (const [a, b] of this.horizons[key].sun) m.fill(100, a, b);
      for (const [a, b, v] of this.horizons[key].sun_part ?? []) m.fill(v, a, b);
      this._masks.set(id, m);
    }
    return m;
  }

  // Runs that overlap [a, b), clipped to it (for drawing bars).
  runsIn(key, body, a, b) {
    key = bodyKey(key, body);
    const out = [];
    for (const [s, e] of this.horizons[key][body]) {
      if (e <= a) continue;
      if (s >= b) break;
      out.push([Math.max(s, a), Math.min(e, b)]);
    }
    return out;
  }

  // Sun-up stretches clipped to [a, b), split wherever the share changes:
  // [[start, stop, percent]], 100 = the whole Sun, 1 = a sliver.
  sunShadesIn(key, a, b) {
    const pct = this.sunPct(key);
    const out = [];
    for (let i = a; i < b;) {
      let j = i + 1;
      while (j < b && pct[j] === pct[i]) j++;
      if (pct[i]) out.push([i, j, pct[i]]);
      i = j;
    }
    return out;
  }

  // How the site reaches Earth at one hour: "direct" (Earth in view and a
  // DSN dish sees the Moon), "relay" (only through a relay satellite) or
  // "none".
  contactAt(key, hour) {
    if (hour < 0 || hour >= this.n) return "none";
    if (this.mask(key, "contact")[hour]) return "direct";
    return this.mask(key, "relayContact")[hour] ? "relay" : "none";
  }

  // Contact stretches clipped to [a, b): [[start, stop, "direct" | "relay"]].
  // Hours with no contact are left out.
  contactIn(key, a, b) {
    const out = [];
    for (let i = Math.max(0, a), end = Math.min(this.n, b); i < end;) {
      const c = this.contactAt(key, i);
      let j = i + 1;
      while (j < end && this.contactAt(key, j) === c) j++;
      if (c !== "none") out.push([i, j, c]);
      i = j;
    }
    return out;
  }

  hourOf(ms) {
    return Math.round((ms - this.t0) / HOUR_MS / this.step);
  }
  msOf(hour) {
    return this.t0 + hour * this.step * HOUR_MS;
  }
}

// Fraction up and longest stretch down (hours) over samples [a, b).
function upStats(mask, a, b, step) {
  let on = 0, run = 0, longest = 0;
  for (let i = a; i < b; i++) {
    if (mask[i]) { on++; run = 0; }
    else if (++run > longest) longest = run;
  }
  return { frac: on / (b - a), longestDownH: longest * step };
}

// The four numbers for one stay: landing at `startHour`, lasting `hours`.
export function stayMetrics(site, key, startHour, hours) {
  const a = Math.max(0, startHour);
  const b = Math.min(site.n, startHour + Math.round(hours / site.step));
  // Sun: by how much of the disk shows. Sunlit % is the average share;
  // an hour is dark when less than half of the Sun is above the skyline.
  const pct = site.sunPct(key);
  let sum = 0, run = 0, longest = 0;
  for (let i = a; i < b; i++) {
    sum += pct[i];
    if (pct[i] < 50) { if (++run > longest) longest = run; } else run = 0;
  }
  const earth = upStats(site.mask(key, "earth"), a, b, site.step);
  const direct = upStats(site.mask(key, "contact"), a, b, site.step);
  const relayed = upStats(site.mask(key, "relayContact"), a, b, site.step);
  return {
    sunlit: b > a ? sum / (100 * (b - a)) : 0,
    longestDarkH: longest * site.step,
    earth: earth.frac,
    longestBlackoutH: direct.longestDownH,
    longestBlackoutRelayH: relayed.longestDownH,
  };
}

// Suggested touchdown time on a landing day: the earliest hour (UTC) with
// direct contact with Earth; failing that, the earliest through a relay.
// `dayStartHour` is 00:00 UTC on the landing day. Returns
// { state: "direct" | "relay" | "none", hour, time: "HH:00", label, title }.
// The stay's numbers still count from 00:00; a few hours makes no difference.
const TOUCHDOWN_TITLE = {
  direct: "Earth in view: the lander talks to Earth directly as it lands",
  relay: "Earth hidden all day: the lander talks to Earth through a relay satellite as it lands",
  none: "No hour on this day has contact with Earth, directly or through the relays",
};
export function touchdownContact(site, key, dayStartHour) {
  let pick = null;
  for (let h = dayStartHour; h < dayStartHour + 24; h++) {
    const c = site.contactAt(key, h);
    if (c === "direct") { pick = { state: c, hour: h }; break; }
    if (c === "relay" && !pick) pick = { state: c, hour: h };
  }
  if (!pick) return { state: "none", hour: null, time: null, label: "None", title: TOUCHDOWN_TITLE.none };
  const time = `${String(new Date(site.msOf(pick.hour)).getUTCHours()).padStart(2, "0")}:00`;
  const how = pick.state === "direct" ? "direct" : "relay";
  return { ...pick, time, label: `${time} · ${how}`, title: `Land at ${time} UTC. ${TOUCHDOWN_TITLE[pick.state]}` };
}

// Metrics for a stay of `stayDays` starting at 00:00 UTC on each day of the year.
// Cached per (site, horizon, length): the views redraw often with the same inputs.
const seriesCache = new Map();
export function yearSeries(site, key, year, stayDays) {
  const id = `${site.id}|${key}|${year}|${stayDays}`;
  let s = seriesCache.get(id);
  if (!s) {
    const first = site.hourOf(Date.UTC(year, 0, 1));
    const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / (24 * HOUR_MS);
    s = [];
    for (let d = 0; d < days; d++) {
      const h = first + d * 24;
      s.push({ day: d, ms: site.msOf(h), m: stayMetrics(site, key, h, stayDays * 24) });
    }
    seriesCache.set(id, s);
  }
  return s;
}

// The `k` best landing days, at least `gapDays` apart, best first.
export function bestDays(series, metricId, stayH, k = 3, gapDays = 7) {
  const M = METRICS[metricId];
  // Ties are common (a whole summer at 100% sunlit), so break them with the
  // average of all four scores: among equally sunny days, prefer more Earth.
  const overall = (m) => METRIC_ORDER.reduce((s, id) => s + METRICS[id].score(METRICS[id].value(m), stayH), 0);
  const ranked = series
    .map((p) => ({ ...p, score: M.score(M.value(p.m), stayH), overall: overall(p.m) }))
    .sort((x, y) => y.score - x.score || y.overall - x.overall || x.day - y.day);
  const picks = [];
  for (const p of ranked) {
    if (picks.every((q) => Math.abs(q.day - p.day) >= gapDays)) picks.push(p);
    if (picks.length === k) break;
  }
  return picks;
}

// ── Loading ──
// The years with precomputed windows: { years: [...], default_year }.
export async function loadYears(base = "/data") {
  return (await fetch(`${base}/windows/index.json`)).json();
}

// One year's sites. Each year lives in its own folder (windows/{year}/).
export async function loadPlanData(year, base = "/data") {
  const dir = `${base}/windows/${year}`;
  const index = await (await fetch(`${dir}/index.json`)).json();
  let names = {};
  try {
    const list = await (await fetch(`${base}/sites.json`)).json();
    names = Object.fromEntries(list.map((s) => [s.id, s.name]));
  } catch { /* fall back to the names in the windows files */ }
  const dsn = await loadDsn(dir);
  const sites = await Promise.all(
    index.sites.map(async (id) => {
      const site = new SiteYear(await (await fetch(`${dir}/${id}.json`)).json(), dsn?.mask);
      if (names[id]) site.name = names[id];
      return site;
    }),
  );
  return { index, sites, dsn, byId: new Map(sites.map((s) => [s.id, s])) };
}

// The year's DSN coverage as hourly flags, or null if the file is missing
// (older data): contact then falls back to Earth in view.
async function loadDsn(dir) {
  try {
    const r = await fetch(`${dir}/dsn.json`);
    if (!r.ok) return null;
    const json = await r.json();
    const mask = new Uint8Array(json.samples);
    for (const [a, b] of json.runs.any) mask.fill(1, a, b);
    return { ...json, mask };
  } catch {
    return null;
  }
}
