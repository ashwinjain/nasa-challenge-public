// Power & landing without a server: size the crewed mission in the page from
// the hourly Sun at the region's panel spot (data/sun/, written by
// scripts/precompute_sun.py) and the assumptions (data/power-inputs.json).
//
// localPower() returns a result shaped like /api/power's, or null when the
// files don't cover the request (no Sun file for this site, a panel height
// other than the files', or dates outside them). Then the caller asks the
// server. Same numbers as the server: powerSize.js mirrors
// lunarsky/power.py (tests/test_power_js.py).

import { sizeOnTrack } from "./powerSize.js";

let indexP = null;        // Promise of sun/index.json (null on failure)
let inputsP = null;       // Promise of power-inputs.json
const tracks = new Map(); // site id → Promise of { frac, sunEl, sunDistKm }
let index = null, inputs = null;

const getJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** Load the index and inputs once; resolves to true when the page can size locally. */
export function ready() {
  indexP ||= getJson("/data/sun/index.json").then((j) => (index = j));
  inputsP ||= getJson("/data/power-inputs.json").then((j) => (inputs = j));
  return Promise.all([indexP, inputsP]).then(() => !!(index && inputs));
}

/** The panel spot the Sun file is for: { lat, lon, region, target_rank, ... } or null. */
export function sunPoint(siteId) {
  return index?.sites?.[siteId] || null;
}

export const sunHeight = () => index?.height_m ?? null;

function loadTrack(siteId) {
  if (!tracks.has(siteId)) {
    tracks.set(siteId, fetch(`/data/sun/${siteId}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((buf) => {
        if (!buf) return null;
        const n = index.n, all = new Float32Array(buf);
        const layers = index.layout?.length ?? 3;
        if (all.length !== layers * n) return null;
        const layer = (name) => {
          const i = index.layout?.indexOf(name) ?? -1;
          return i < 0 ? null : all.subarray(i * n, (i + 1) * n);
        };
        // contact: 1 while in direct contact with Earth (older files: none,
        // so the radio runs always).
        return { frac: layer("frac"), sunEl: layer("sun_el"), sunDistKm: layer("sun_dist_km"),
                 contact: layer("contact") };
      })
      .catch(() => null));
  }
  return tracks.get(siteId);
}

// (always-on W, daylight-only W, contact-only W) of a load list; per-person lines count crew times.
function split(loads, crew) {
  let always = 0, day = 0, contact = 0;
  for (const l of loads) {
    const w = l.w * (l.per_crew ? crew : 1);
    if (l.when === "day") day += w; else if (l.when === "contact") contact += w; else always += w;
  }
  return { always, day, contact };
}

const t = (kg) => (kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`);

// Mirrors verdict() in lunarsky/power.py.
function verdict(res) {
  if (!res.feasible) return { ok: false, text: `Doesn't work: ${res.reason || "no option found"}.` };
  const b = res.best;
  const parts = { battery: b.battery_kg, "solar array": b.array_kg };
  const total = Object.values(parts).reduce((x, y) => x + y, 0);
  const driver = Object.keys(parts).reduce((d, k) => (parts[k] > parts[d] ? k : d));
  const why = {
    battery: `the longest dark stretch is ${res.longest_dark_hours.toFixed(0)} h`,
    "solar array": `it powers a ${(res.sized_load_w / 1000).toFixed(1)} kW load (with margin) ` +
      `and the panel sees ${Math.round(res.sunlit_fraction * 100)}% of the Sun on average`,
  }[driver];
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    ok: true,
    total_kg: r1(total),
    breakdown_kg: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r1(v)])),
    driver,
    text: `Lands ${t(total)}. Biggest item: ${driver}, ${t(parts[driver])}, because ${why}. ` +
      `Array ${b.array_m2.toFixed(0)} m², battery ${b.battery_kwh.toFixed(0)} kWh.`,
  };
}

/**
 * The crewed mission at ``site`` landing on ``startIso`` (YYYY-MM-DD), sized in
 * the page. custom: { stay, crew, loads, panelM } (recycling is applied later
 * by powerModel.customize). Resolves to a result, or null to ask the server.
 */
export async function localPower(site, startIso, custom = {}, defaultStay = 365) {
  if (!(await ready())) return null;
  const point = sunPoint(site.id);
  if (!point) return null;
  if (custom.panelM != null && custom.panelM !== index.height_m) return null;
  const track = await loadTrack(site.id);
  if (!track) return null;

  const days = custom.stay ?? defaultStay;
  const step = index.step_hours;
  const t0 = Date.parse(index.start_utc);
  const off = Math.round((Date.parse(`${startIso}T00:00:00Z`) - t0) / (step * 3600e3));
  const n = Math.round((days * 24) / step) + 1;   // sky_track: both endpoints
  if (!(off >= 0) || off + n > index.n) return null;

  // The load: an edited list, or the default list for this crew size (as site_power).
  const prof = { ...inputs.mission };
  const crew = custom.crew ?? prof.crew;
  if (custom.loads) {
    const s = split(custom.loads, crew);
    prof.always_w = s.always; prof.day_w = s.day; prof.contact_w = s.contact;
  } else if (custom.crew != null) {
    const s = split(inputs.inputs.loads, crew);
    prof.always_w = s.always; prof.day_w = s.day; prof.contact_w = s.contact;
  }
  prof.contact_w ||= 0;
  prof.load_w = prof.always_w + prof.day_w + prof.contact_w;
  prof.days = days;
  prof.crew = crew;

  const slice = (a) => a.subarray(off, off + n);
  const res = sizeOnTrack({ frac: slice(track.frac), sunEl: slice(track.sunEl), sunDistKm: slice(track.sunDistKm),
                            contact: track.contact && slice(track.contact) },
    prof, inputs.assumptions, step);
  res.site = { lat: point.lat, lon: point.lon };
  res.mission = prof;
  res.horizon = "terrain";
  res.panel_height_m = index.height_m;
  res.start_utc = `${startIso}T00:00:00Z`;
  res.panel_point = point;
  res.local = true;
  res.inputs = inputs.inputs;
  res.verdict = verdict(res);
  return res;
}
