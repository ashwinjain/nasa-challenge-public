// The chat's tools (docs/space-apps/chat-tools.md). They run in the browser
// on the same static files and scoring code as the app, so every number the
// model quotes is one the app would show. The model never does Moon math.
//
// Heights: Sun and power at 10 m (panels on a mast), Earth contact at 10 m
// (the antenna on a mast), the person's view at 2 m.

import { loadPlanData } from "../plan/windows.js";
import { localPower } from "../plan/sunPower.js";

const ANTENNA_KEY = "terrain_10";
const STAY_DEFAULT = 365;
// What the app itself lets you pick: landing years, stay and crew.
const YEAR_MIN = 2026, YEAR_MAX = 2035;
const DEFAULT_YEAR = 2027;   // default landing year (matches landing.json and the app)
const STAY_MAX = 365;
const CREW_MAX = 50;
const HOUR_MS = 3600e3;

// ── Data, loaded once ──
let landingP = null;
const years = new Map();   // year → Promise of loadPlanData(year)
const getLanding = () => (landingP ||= fetch("/data/landing.json").then((r) => r.json()));
const files = new Map();   // other static files, fetched once
const getFile = (url) => {
  if (!files.has(url)) files.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return files.get(url);
};
const getYear = (y) => {
  if (!years.has(y)) years.set(y, loadPlanData(y));
  return years.get(y);
};

const r1 = (v) => Math.round(v * 10) / 10;
const pct = (f) => Math.round(f * 1000) / 10;   // 0.8123 → 81.2 (%)
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const isoHour = (ms) => `${new Date(ms).toISOString().slice(0, 13)}:00Z`;

class ToolError extends Error {}

// Kit masses to 0.1 t, with the array as total minus battery so the two parts
// always add up to the total (0.35 t would round up or down by tool otherwise).
function kitParts(totalT, batteryT) {
  const total_t = r1(totalT), battery_t = r1(batteryT);
  return { total_t, battery_t, array_t: Math.max(0, r1(total_t - battery_t)) };
}

const MOON_RADIUS_KM = 1737.4;
const rad = (d) => (d * Math.PI) / 180;
// Distance along the surface between two points, km.
function surfaceKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * MOON_RADIUS_KM * Math.asin(Math.sqrt(a));
}
const kmFromSouthPole = (lat) => rad(90 + lat) * MOON_RADIUS_KM;

// Each region's place among the nine by its #1 target's kit mass (1 = lightest).
async function kitRanks() {
  const { regions } = await getLanding();
  const order = [...regions].filter((r) => r.targets[0]?.power).sort((a, b) => a.targets[0].power.total_t - b.targets[0].power.total_t);
  return new Map(order.map((r, i) => [r.site_id, i + 1]));
}

// The #1 target's longest night for the default stay, counted the way every
// other tool counts it (the Sun file), so tools agree to the hour.
async function defaultNight(siteId, fallback) {
  try {
    const { start_utc, days } = await getLanding();
    return (await panelSun(siteId, Date.parse(start_utc), days)).longest_night_h;
  } catch { return fallback; }
}

// Letters and digits only, so "de-Gerlache", "Nobile Rim1" and odd spacing still match.
const squash = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// A region by id ("artemis-ma"), name ("Malapert Massif"), part of one
// ("malapert") or a near miss ("Malapart Masif").
async function findRegion(q) {
  const { regions } = await getLanding();
  const names = regions.map((r) => r.region).join(", ");
  const s = squash(q);
  if (!s) throw new ToolError(`Which region? The 9 are: ${names}.`);
  const name = (r) => squash(r.region);
  let hit = regions.find((r) => r.site_id === String(q).trim().toLowerCase() || name(r) === s);
  if (hit) return hit;
  // "Nobile Rim" or "mouton" alone could be two regions: ask rather than guess.
  let near = s.length >= 3 ? regions.filter((r) => name(r).includes(s) || s.includes(name(r))) : [];
  const longest = near.filter((r) => s.includes(name(r))).sort((a, b) => b.region.length - a.region.length)[0];
  if (longest) return longest;
  if (!near.length) {
    // Typos: a word of the question within two letters of a word that names a region.
    const COMMON = new Set(["rim", "peak", "near", "mons", "plain", "massif", "the", "crater", "region", "site"]);
    const words = s.split(" ").filter((w) => w.length >= 4 && !COMMON.has(w));
    near = regions.filter((r) => name(r).split(" ").some((w) => !COMMON.has(w) && w.length >= 4 &&
      words.some((x) => editDistance(x, w) <= (w.length >= 7 ? 2 : 1))));
  }
  if (near.length > 1) throw new ToolError(`"${q}" could be ${near.map((r) => r.region).join(" or ")}. Ask which one is meant.`);
  if (!near.length) throw new ToolError(`No Artemis region matches "${q}". The app covers only these 9: ${names}.`);
  return near[0];
}

// A landing date: a real calendar day in the years the app plans for.
function parseDay(iso) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) || Number.isNaN(ms) || isoDay(ms) !== iso) {
    throw new ToolError(`Bad date "${iso}": use a real date as YYYY-MM-DD.`);
  }
  const y = new Date(ms).getUTCFullYear();
  if (y < YEAR_MIN || y > YEAR_MAX) throw new ToolError(`The app covers landing dates from ${YEAR_MIN} to ${YEAR_MAX}; ${iso} is outside that. Don't give numbers for it.`);
  return ms;
}

function wholeNumber(v, what, min, max, fallback) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ToolError(`${what} must be a whole number from ${min} to ${max}.`);
  return n;
}
const stayDays = (v) => wholeNumber(v, "Stay length (days)", 1, STAY_MAX, STAY_DEFAULT);

// ── Sun at the panels: the #1 target's panel spot, 10 m up ──
// data/sun/{id}.bin (scripts/precompute_sun.py) is the hourly share of the
// Sun's disk above that spot's skyline, 2026 onward: the same input the
// power sizing uses, so sunlight, nights and kit all describe one spot.
let sunIndexP = null;
const sunTracks = new Map();
const getSunIndex = () => (sunIndexP ||= fetch("/data/sun/index.json").then((r) => r.json()));
function sunTrack(id) {
  if (!sunTracks.has(id)) {
    sunTracks.set(id, (async () => {
      const ix = await getSunIndex();
      const res = await fetch(`/data/sun/${id}.bin`);
      const all = res.ok ? new Float32Array(await res.arrayBuffer()) : null;
      // Layers as index.json lists them (frac, sun_el, sun_dist_km, contact).
      const layers = ix.layout?.length ?? 3;
      const at = ix.layout?.indexOf("frac") ?? 0;
      if (!all || all.length !== layers * ix.n || at < 0) throw new ToolError("No Sun data for this region's panel spot.");
      const c = ix.layout?.indexOf("contact") ?? -1;
      // contact: 1 while the #1 target's antenna mast is in direct contact with Earth.
      return { ix, frac: all.subarray(at * ix.n, (at + 1) * ix.n), contact: c < 0 ? null : all.subarray(c * ix.n, (c + 1) * ix.n) };
    })());
  }
  return sunTracks.get(id);
}

// Sunlit % and longest night (hours under half the disk) over a stay, as
// size_on_track in lunarsky/power.py counts them (both endpoints included).
async function panelSun(id, startMs, days) {
  const { ix, frac } = await sunTrack(id);
  const step = ix.step_hours;
  const a = Math.round((startMs - Date.parse(ix.start_utc)) / (step * 3600e3));
  const n = Math.round((days * 24) / step) + 1;
  if (a < 0 || a + n > ix.n) {
    throw new ToolError(`Sun data runs from ${ix.start_utc.slice(0, 10)} to ${isoDay(Date.parse(ix.start_utc) + ix.n * step * 3600e3)}.`);
  }
  let sum = 0, run = 0, longest = 0;
  for (let i = a; i < a + n; i++) {
    sum += frac[i];
    if (frac[i] < 0.5) { if (++run > longest) longest = run; } else run = 0;
  }
  return { sunlit_pct: pct(sum / n), longest_night_h: longest * step };
}

// Stretches of `down(i)` over samples [0, n): [[first, count]].
function runsOf(n, down) {
  const out = [];
  for (let i = 0; i < n;) {
    if (!down(i)) { i++; continue; }
    let j = i;
    while (j < n && down(j)) j++;
    out.push([i, j - i]);
    i = j;
  }
  return out;
}

// The count, total and longest few of a list of runs starting at startMs.
function summarise(runs, startMs, stepH, top, endMs) {
  const period = ([i, len]) => {
    const end = startMs + (i + len) * stepH * HOUR_MS;
    return { start_utc: isoHour(startMs + i * stepH * HOUR_MS), end_utc: isoHour(end), hours: len * stepH,
             ...(i === 0 && { already_under_way_at_landing: true }), ...(end >= endMs && { still_going_at_end_of_stay: true }) };
  };
  return {
    count: runs.length,
    total_hours: runs.reduce((s, r) => s + r[1], 0) * stepH,
    first: runs.length ? period(runs[0]) : null,
    longest: [...runs].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, top).map(period),
  };
}

// ── The region's reference point: the windows files ──
// Used for the person's 2 m view of the Sun and for the relay satellites'
// hours. Each year's file runs from 1 Jan to 60 days into the next year; a
// stay that runs past that carries on in the next year's file.
async function yearSite(siteId, year) {
  let plan;
  try { plan = await getYear(year); } catch { plan = null; }
  return plan?.byId.get(siteId) || null;
}

// Hourly values over [startMs, startMs + hours) from `layers`:
// { name: (site) => array indexed by that file's hour }.
async function pinHours(siteId, startMs, hours, layers) {
  const out = Object.fromEntries(Object.keys(layers).map((k) => [k, new Uint8Array(hours)]));
  let done = 0;
  for (let year = new Date(startMs).getUTCFullYear(); done < hours; year++) {
    const site = await yearSite(siteId, year);
    const h0 = site ? site.hourOf(startMs + done * HOUR_MS) : -1;
    const take = site ? Math.min(hours - done, site.n - h0) : 0;
    if (!site || site.step !== 1 || h0 < 0 || take <= 0) {
      throw new ToolError(done
        ? `Earth-contact data ends on ${isoDay(startMs + done * HOUR_MS)} (the app covers ${YEAR_MIN}–${YEAR_MAX}); this stay runs past it.`
        : `No Earth-contact data for ${year}; years ${YEAR_MIN}–${YEAR_MAX} are covered.`);
    }
    for (const [k, get] of Object.entries(layers)) out[k].set(get(site).subarray(h0, h0 + take), done);
    done += take;
  }
  return out;
}

const longestDown = (m) => runsOf(m.length, (i) => !m[i]).reduce((x, r) => Math.max(x, r[1]), 0);

// ── Earth contact: the #1 target's antenna mast ──
// The Sun files carry a "contact" layer: 1 for each hour the 10 m antenna at
// the #1 target's panel spot is in direct contact (Earth above its skyline
// and a Deep Space Network dish seeing the Moon). It's what the power model
// runs the radio on, and it agrees with landing_targets. Hours [start, start + days).
async function directHours(siteId, startMs, days) {
  const { ix, contact } = await sunTrack(siteId);
  const a = Math.round((startMs - Date.parse(ix.start_utc)) / HOUR_MS);
  const n = days * 24;
  if (!contact || ix.step_hours !== 1 || a < 0 || a + n > ix.n) throw new ToolError(`Earth-contact data covers landing dates from ${YEAR_MIN} to ${YEAR_MAX}.`);
  return contact.subarray(a, a + n);
}
const directStats = (m) => ({
  direct_contact_pct: pct(m.reduce((x, v) => x + (v ? 1 : 0), 0) / m.length),
  longest_blackout_direct_h: longestDown(m),
});

async function earthAt(siteId, startMs, days) {
  let direct;
  try { direct = await directHours(siteId, startMs, days); }
  catch (err) { return { earth_note: err instanceof ToolError ? err.message : "Earth-contact data isn't available for these dates." }; }
  const out = { earth_at: "the #1 landing target's 10 m antenna mast", ...directStats(direct) };
  // With the two relay satellites: direct contact, or a relay in reach (the
  // relays' hours are worked out at the region's reference point).
  try {
    const { relayed } = await pinHours(siteId, startMs, days * 24, { relayed: (s) => s.mask(ANTENNA_KEY, "relayContact") });
    out.longest_blackout_with_relays_h = longestDown(direct.map((v, i) => (v || relayed[i] ? 1 : 0)));
  } catch { /* no relay hours for these dates: leave the figure out */ }
  return out;
}

// Sun at the panels (10 m, the #1 target's panel spot) or, for 2 m, at the
// region's reference point as the person in the 3D view sees it; Earth at
// the 10 m antenna.
async function conditions(siteId, startMs, days, heightM = 10) {
  let sun;
  if (heightM === 10) {
    sun = { sun_at: "panel spot of the #1 landing target, 10 m mast", ...(await panelSun(siteId, startMs, days)) };
  } else {
    const { p } = await pinHours(siteId, startMs, days * 24, { p: (s) => s.sunPct(`terrain_${heightM}`) });
    sun = {
      sun_at: `the region's reference point, a person standing (${heightM} m). A different spot from the panels, so not a like-for-like comparison with the 10 m figure`,
      sunlit_pct: pct(p.reduce((x, v) => x + v, 0) / (100 * p.length)),
      longest_night_h: runsOf(p.length, (i) => p[i] < 50).reduce((x, r) => Math.max(x, r[1]), 0),
    };
  }
  return { ...sun, ...(await earthAt(siteId, startMs, days)) };
}

async function power(siteId, start, days, { crew, extras = [] } = {}) {
  // "crewed rover, drill" or ["crewed_rover", "drill"]: one load per comma.
  if (!Array.isArray(extras)) extras = String(extras).split(",");
  extras = extras.map((x) => squash(x)).filter(Boolean);
  const custom = { stay: days };
  if (crew != null) custom.crew = crew;
  if (extras.length) {
    const inputs = await getFile("/data/power-inputs.json");
    const known = (inputs?.inputs.extra_loads || []).filter((k) => k.id !== "li_extra_custom");
    const key = (k) => squash(k.id.replace("li_extra_", ""));
    const picked = [...new Set(extras)].map((x) => {
      const l = known.find((k) => key(k) === x) || known.find((k) => squash(k.name).startsWith(x)) ||
        (x === "lights" || x === "work lights" ? known.find((k) => key(k) === "lights") : null);
      if (!l) throw new ToolError(`Unknown extra load "${x}". Options: ${known.map(key).map((k) => k.replace(/ /g, "_")).join(", ")}. Nothing else can be added here.`);
      return l;
    });
    custom.loads = [...inputs.inputs.loads, ...picked];
  }
  const res = await localPower({ id: siteId }, start, custom, STAY_DEFAULT);
  if (!res) throw new ToolError(`Power sizing covers landing dates from ${YEAR_MIN} to ${YEAR_MAX}.`);
  if (!res.feasible) return { feasible: false, reason: res.verdict.text };
  const v = res.verdict;
  return {
    feasible: true,
    ...kitParts(v.total_kg / 1000, res.best.battery_kg / 1000),
    battery_kwh: Math.round(res.best.battery_kwh),
    array_m2: Math.round(res.best.array_m2),
    biggest_item: v.driver,
    load_kw: r1(res.load_w / 1000),   // what the base draws; sized with the 25% margin on top
    ...(extras.length && { extras_added: extras.map((x) => x.replace(/ /g, "_")) }),
    crew: res.mission.crew,
    days,
    panel_height_m: res.panel_height_m,
    panel_sunlit_pct: pct(res.sunlit_fraction),
    longest_night_h: res.longest_dark_hours,
    // Storage for the data that piles up while Earth is out of direct contact (no battery cost).
    ...(res.data && { data_storage_gb: Math.round(res.data.storage_gb), direct_contact_pct: pct(res.contact_fraction ?? 0) }),
    not_counted: "air, water, food, habitat, lander, mast and cables",
  };
}

// How to read a target, sent with every landing_targets answer.
const TARGET_NOTES = {
  how_to_read: "Rank 1 is the lightest kit inside this region, not among all nine regions (see kit_rank_among_the_9_regions). "
    + "winning_candidate_spot only says which of three candidate panel spots at a target gave its lightest kit. "
    + "Earth contact here is across the 100 m-radius landing zone: the blackout hours are for the worst point in the zone, so they can be longer than the figure at the antenna mast that region_conditions and compare give. "
    + "The landing zone is a circle of 100 m radius.",
};

const PICK = { most_sunlight: "most sunlight", shortest_night: "shortest night", lightest_kit: "lightest kit" };
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

function targetBrief(t, top = null) {
  const pick = t.pick ?? t.panel?.pick ?? null;
  return {
    rank: t.rank,
    ...(top && top !== t && { distance_from_rank_1_target_km: r1(surfaceKm(top.lat, top.lon, t.lat, t.lon)) }),
    rank_by_nasa_sunlight_map: t.nasa_rank,
    lat: t.lat, lon: t.lon,
    landing_zone: { radius_m: 100, share_under_10deg_pct: pct(t.flat_share), steepest_deg: t.steepest_deg },
    panel_spot: t.panel && {
      distance_from_target_m: Math.round(t.panel.distance_m),
      // The lander may touch down anywhere in the 100 m-radius zone.
      farthest_carry_from_touchdown_m: Math.round(t.panel.distance_m) + 100,
      bearing_deg: Math.round(t.panel.bearing_deg),
      direction: COMPASS[Math.round(t.panel.bearing_deg / 45) % 8],
      slope_deg: t.panel.slope_deg, sunlit_pct: pct(t.panel.sunlit), longest_night_h: t.panel.night_h,
      // Three candidate spots are tried per target and the one giving the lightest kit is used.
      winning_candidate_spot: PICK[pick] || pick,
    },
    ...(t.landing_point && { at_the_landing_point_itself: { sunlit_pct: pct(t.landing_point.sunlit), longest_night_h: t.landing_point.night_h } }),
    kit: t.power && kitParts(t.power.total_t, t.power.battery_t),
    earth_contact_10m_antenna: t.contact && {
      direct_pct_at_target_centre: pct(t.contact.direct_target),
      direct_pct_worst_point_in_zone: pct(t.contact.direct_min),
      direct_pct_best_point_in_zone: t.contact.direct_max != null ? pct(t.contact.direct_max) : undefined,
      longest_blackout_direct_h_worst_point_in_zone: t.contact.direct_worst_gap_h,
      with_relays_pct_worst_point: pct(t.contact.relay_min),
      ...(t.contact.relay_worst_gap_h != null && { longest_blackout_with_relays_h_worst_point_in_zone: t.contact.relay_worst_gap_h }),
    },
  };
}

// What ranking by kit mass saves over taking the target NASA's sunlight map rates best.
function nasaSaving(r) {
  const best = r.targets[0], nasa = r.targets.find((t) => t.nasa_rank === 1);
  if (!best?.power || !nasa?.power) return null;
  if (nasa === best) return { same_target: true, note: "The target NASA's sunlight map rates best is also the lightest kit here." };
  return {
    same_target: false,
    sunniest_on_nasa_map: { our_rank: nasa.rank, kit_t: r1(nasa.power.total_t), longest_night_h: nasa.panel?.night_h },
    lightest_kit: { our_rank: best.rank, rank_by_nasa_sunlight_map: best.nasa_rank, kit_t: r1(best.power.total_t), longest_night_h: best.panel?.night_h },
    saving_t: r1(nasa.power.total_t - best.power.total_t),
  };
}

// ── Tool definitions (OpenAI-style function schemas) and their code ──
const REGION = { type: "string", description: "An Artemis region, by name (e.g. \"Malapert Massif\") or id (e.g. \"artemis-ma\")" };
const START = { type: "string", description: "Landing date, YYYY-MM-DD (UTC), from 2026-01-01 to 2035-12-31" };
const DAYS = { type: "integer", description: "Stay length in days, 1 to 365 (default 365)" };

export const TOOLS = [
  {
    name: "list_regions",
    description: "The 9 Artemis candidate regions: where each is (latitude and longitude of its #1 landing target, distance from the south pole), its area, its place among the nine by kit mass, how many safe landing targets were found, and the #1 target's power kit, panel sunlight and longest night over the default one-year stay from 2027-01-01.",
    parameters: { type: "object", properties: {} },
    async run() {
      const { regions, start_utc, days } = await getLanding();
      const ranks = await kitRanks();
      const pins = (await getFile("/data/sites.json")) || [];
      const nights = new Map();
      for (const r of regions) nights.set(r.site_id, await defaultNight(r.site_id, r.targets[0]?.panel?.night_h ?? null));
      return {
        default_stay: { start: start_utc.slice(0, 10), days, crew: 4 },
        regions: regions.map((r) => {
          const t = r.targets[0];
          const pin = pins.find((p) => p.id === r.site_id);
          return {
            name: r.region, area_km2: Math.round(r.area_km2),
            lat: t ? r1(t.lat) : null, lon: t ? r1(t.lon) : null,
            // Along the surface, from the region's reference point (its sunniest spot on NASA's map).
            ...(pin && { km_from_south_pole: Math.round(kmFromSouthPole(pin.lat)) }),
            kit_rank_among_the_9: ranks.get(r.site_id) ?? null,
            // Every 100 m landing zone tried across the region, and how many pass the 95%-under-10° rule.
            landing_zones_checked: r.pins, landing_zones_safe: r.passing,
            top_target_kit_t: t?.power ? kitParts(t.power.total_t, t.power.battery_t).total_t : null,
            top_target_battery_t: t?.power ? kitParts(t.power.total_t, t.power.battery_t).battery_t : null,
            top_target_array_t: t?.power ? kitParts(t.power.total_t, t.power.battery_t).array_t : null,
            top_target_panel_sunlit_pct: t?.panel ? pct(t.panel.sunlit) : null,
            top_target_longest_night_h: nights.get(r.site_id),
          };
        }),
      };
    },
  },
  {
    name: "region_conditions",
    description: "Sunlit %, longest night, direct Earth contact % and longest comms blackout (direct, and with the relay satellites) at one region for a given landing date and stay. Sun is at the panels (10 m mast, the #1 target's panel spot) by default; height_m 2 gives a person standing at the region's reference point instead (a different spot). Earth contact is at the 10 m antenna mast of the #1 target.",
    parameters: {
      type: "object",
      properties: { region: REGION, start: START, days: DAYS, height_m: { type: "integer", enum: [10, 2], description: "Sun height: 10 (panels at the #1 target, default) or 2 (a person at the region's reference point)" } },
      required: ["region", "start"],
    },
    async run({ region, start, days, height_m = 10 }) {
      const r = await findRegion(region);
      const startMs = parseDay(start);
      days = stayDays(days);
      height_m = Number(height_m);
      if (height_m !== 10 && height_m !== 2) throw new ToolError("height_m is 10 (panels) or 2 (a person standing).");
      const whole = arguments[0].days == null || arguments[0].days === "";
      return {
        region: r.region, start, days,
        ...(whole && { note: "No stay length was given, so this covers 365 days from the start date. For one day or one month, call again with days set (1, 30…); never scale these figures down to a day." }),
        antenna_height_m: 10, ...(await conditions(r.site_id, startMs, days, height_m)),
      };
    },
  },
  {
    name: "compare",
    description: "Rank options. Without `region`: ranks all 9 regions for a landing date (`start`, default 2027-01-01) and stay. With `region` (+ `year`, default 2027): ranks landing dates through that year at that region, 5 dates at least a week apart, for stays up to 60 days (a longer stay returns the same stay from four dates and from every year instead); use this for \"when should we land\" questions, with metric longest_night (what sizes the battery) or sunlit, and order \"worst\" for dates to avoid. kit_mass only ranks regions (with `region` it ranks dates by longest_night instead). Sun figures are at the #1 target's panel spot, 10 m up; Earth figures are direct contact at the 10 m antenna mast beside it (earth_in_view ranks by direct contact %).",
    parameters: {
      type: "object",
      properties: {
        metric: { type: "string", enum: ["kit_mass", "longest_night", "sunlit", "earth_in_view", "longest_blackout"] },
        days: DAYS,
        start: START,
        region: REGION,
        year: { type: "integer", description: "Year to search for landing dates (with `region`), 2026 to 2035" },
        order: { type: "string", enum: ["best", "worst"], description: "With `region`: the best landing dates (default) or the worst" },
      },
      required: ["metric"],
    },
    async run({ metric, days, start, region, year, order = "best" }) {
      // Dates can't be ranked by kit mass (a short stay's kit is mostly the
      // battery for its longest night), so rank them by that night instead.
      let note;
      if (region && metric === "kit_mass") {
        metric = "longest_night";
        note = "kit_mass ranks regions, not dates; these dates are ranked by longest night, which sets the battery.";
      }
      const SUN = { longest_night: "longest_night_h", sunlit: "sunlit_pct" };
      // Lower is better for every value below.
      const val = {
        kit_mass: (x) => (x.kit?.feasible ? x.kit.total_t : Infinity),
        longest_night: (x) => x.longest_night_h,
        sunlit: (x) => -x.sunlit_pct,
        earth_in_view: (x) => -(x.direct_contact_pct ?? -Infinity),   // old name for direct contact
        longest_blackout: (x) => x.longest_blackout_direct_h ?? Infinity,
      }[metric];
      if (!val) throw new ToolError(`Unknown metric "${metric}". Use kit_mass, longest_night, sunlit, earth_in_view or longest_blackout.`);

      if (region) {
        days = wholeNumber(days, "Stay length (days)", 1, STAY_MAX, 14);
        const r = await findRegion(region);
        const y = wholeNumber(year ?? (start ? new Date(parseDay(start)).getUTCFullYear() : DEFAULT_YEAR), "Year", YEAR_MIN, YEAR_MAX);
        if (days > 60) {
          // A long stay covers most of the year whatever day it starts, so
          // there is no best date to rank. Show how little the start moves
          // it, and how the years differ.
          const at = async (iso) => {
            const c = await conditions(r.site_id, parseDay(iso), days);
            return { sunlit_pct: c.sunlit_pct, longest_night_h: c.longest_night_h, direct_contact_pct: c.direct_contact_pct, longest_blackout_direct_h: c.longest_blackout_direct_h };
          };
          const starts = [];
          for (const md of ["01-01", "04-01", "07-01", "10-01"]) starts.push({ start: `${y}-${md}`, ...(await at(`${y}-${md}`)) });
          const years = [];
          for (let yy = YEAR_MIN; yy <= YEAR_MAX; yy++) years.push({ start: `${yy}-01-01`, ...(await at(`${yy}-01-01`)) });
          return {
            region: r.region, year: y, stay_days: days,
            note: `Landing dates are only ranked for stays up to 60 days. A ${days}-day stay covers most of the year whatever day it starts, so the landing date matters little: compare the four starts below. Sun at the panels (10 m), Earth contact at the 10 m antenna.`,
            same_stay_from_four_dates_in_the_year: starts,
            same_stay_landing_1_january_of_each_year: years,
          };
        }
        // Score a stay starting at 00:00 UTC on every day of the year: Sun at
        // the panels, direct Earth contact at the antenna beside them.
        const dayCount = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / (24 * HOUR_MS);
        const rows = [];
        for (let d = 0; d < dayCount; d++) {
          const ms = Date.UTC(y, 0, 1) + d * 24 * HOUR_MS;
          rows.push({ d, ms, ...(await panelSun(r.site_id, ms, days)), ...directStats(await directHours(r.site_id, ms, days)) });
        }
        // Ties are common (whole weeks with no night), so break them on the
        // other Sun figure, then on Earth contact. Picks are at least a stay
        // apart (a week minimum).
        const sign = order === "worst" ? -1 : 1;
        const tie = SUN[metric]
          ? [(x) => (metric === "sunlit" ? x.longest_night_h : -x.sunlit_pct), (x) => x.longest_blackout_direct_h]
          : [(x) => (metric === "earth_in_view" ? x.longest_blackout_direct_h : -x.direct_contact_pct), (x) => x.longest_night_h];
        const sorted = [...rows].sort((a, b) => sign * (val(a) - val(b)) || sign * (tie[0](a) - tie[0](b)) || sign * (tie[1](a) - tie[1](b)) || a.d - b.d);
        const gap = Math.max(7, days);
        const picks = [];
        for (const p of sorted) {
          if (picks.every((q) => Math.abs(q.d - p.d) >= gap)) picks.push(p);
          if (picks.length === 5) break;
        }
        const dates = [];
        for (const p of picks) dates.push({ start: isoDay(p.ms), ...(await conditions(r.site_id, p.ms, days)) });
        const top = val(sorted[0]);
        const tied = rows.filter((x) => val(x) === top).length;
        return {
          region: r.region, year: y, stay_days: days, metric, order, ...(note && { note }),
          applies_to: `stays of ${days} days only; a different stay length needs its own call`,
          ...(tied > 5 && { tied: `${tied} of ${rows.length} landing days tie on ${metric} with the first date below; ties are ordered by the other figures (Sun, then Earth contact).` }),
          [order === "worst" ? "worst_dates" : "best_dates"]: dates,
        };
      }

      start ||= `${DEFAULT_YEAR}-01-01`;
      const startMs = parseDay(start);
      days = stayDays(days);
      const { regions } = await getLanding();
      const rows = [];
      for (const r of regions) {
        const row = { region: r.region };
        try { Object.assign(row, await conditions(r.site_id, startMs, days)); } catch (e) { row.note = e.message; }
        if (metric === "kit_mass") {
          // One region without power data shouldn't sink the whole ranking.
          try {
            const k = await power(r.site_id, start, days);
            row.kit = k.feasible ? { feasible: true, total_t: k.total_t, battery_t: k.battery_t, array_t: k.array_t } : k;
          } catch (e) { row.kit = { feasible: false, reason: e.message }; }
        }
        rows.push(row);
      }
      rows.sort((a, b) => val(a) - val(b));
      return { start, days, metric, ranked: rows.map((x, i) => ({ rank: i + 1, ...x })) };
    },
  },
  {
    name: "landing_targets",
    description: "A region's ranked landing targets (flat spots for a 100 m landing zone), each with its panel spot within 200 m (300 m on-foot reach minus the landing zone; panels and antenna on a 10 m mast), the power kit mass and Earth contact across the zone. Also how many landing zones were checked and passed, and what ranking by kit mass saves over the target NASA's sunlight map rates best. Sized for the default one-year stay from 2027-01-01. Pass `rank` for one particular target.",
    parameters: { type: "object", properties: {
      region: { ...REGION, description: `${REGION.description}. Leave out to get the #1 target of all 9 regions` },
      top: { type: "integer", description: "How many targets, 1 to 10 (default 3)" },
      rank: { type: "integer", description: "Only this target, 1 to 10" },
    } },
    async run({ region, top, rank }) {
      const ranks = await kitRanks();
      if (!String(region ?? "").trim()) {
        const { regions } = await getLanding();
        return {
          sized_for: "a crew of 4 staying 365 days from 2027-01-01, panels and antenna on a 10 m mast",
          ...TARGET_NOTES,
          top_target_of_each_region: await Promise.all(regions.map(async (r) => {
            const b = targetBrief(r.targets[0]);
            if (b.panel_spot) b.panel_spot.longest_night_h = await defaultNight(r.site_id, b.panel_spot.longest_night_h);
            return { region: r.region, kit_rank_among_the_9_regions: ranks.get(r.site_id) ?? null, landing_zones_safe: r.passing,
                     kit_ranking_vs_nasa_sunlight_ranking: nasaSaving(r), ...b };
          })),
        };
      }
      const r = await findRegion(region);
      const n = r.targets.length;
      rank = wholeNumber(rank, "rank", 1, n, null);
      top = wholeNumber(top, "top", 1, n, 3);
      const targets = (rank ? r.targets.filter((t) => t.rank === rank) : r.targets.slice(0, top)).map((t) => targetBrief(t, r.targets[0]));
      for (const b of targets) if (b.rank === 1 && b.panel_spot) b.panel_spot.longest_night_h = await defaultNight(r.site_id, b.panel_spot.longest_night_h);
      return {
        region: r.region,
        // Targets are ranked inside this region only; this is where the region's #1 target stands among all nine.
        kit_rank_among_the_9_regions: ranks.get(r.site_id) ?? null,
        ...TARGET_NOTES,
        sized_for: "a crew of 4 staying 365 days from 2027-01-01, panels and antenna on a 10 m mast",
        landing_zones_checked: r.pins, landing_zones_safe: r.passing, targets_kept: n,
        sunniest_spot_in_region_on_nasa_map_pct: pct(r.nasa_best_sunlit),
        kit_ranking_vs_nasa_sunlight_ranking: nasaSaving(r),
        targets,
      };
    },
  },
  {
    name: "size_power",
    description: "Size the crewed mission's solar array and battery at a region's #1 landing target (panels at 10 m), for any landing date, stay, crew size and extra loads. Returns masses in tonnes, the biggest item, battery kWh, array m², the load in kW and the on-board data storage needed through Earth blackouts.",
    parameters: {
      type: "object",
      properties: {
        region: REGION, start: START, days: DAYS,
        crew: { type: "integer", description: "Crew size, 1 to 50 (default 4)" },
        extras: { type: "array", items: { type: "string", enum: ["rover", "crewed_rover", "drill", "lights"] }, description: "Extra loads to add: rover = a small robotic rover (450 W, daylight); crewed_rover = a rover the crew drives (1.4 kW, always); drill (100 W, daylight); lights = work lights (200 W, always)" },
      },
      required: ["region"],
    },
    async run({ region, start = `${DEFAULT_YEAR}-01-01`, days, crew, extras = [] }) {
      const r = await findRegion(region);
      parseDay(start);
      days = stayDays(days);
      crew = wholeNumber(crew, "Crew size", 1, CREW_MAX, null) ?? undefined;
      return { region: r.region, start, ...(await power(r.site_id, start, days, { crew, extras })) };
    },
  },
  {
    name: "dark_periods",
    description: "When the nights and comms blackouts fall during a stay: how many there are, their total hours, the first one after landing and the longest few with start and end times (UTC). Nights are at the panels (10 m, the #1 target's panel spot): hours with less than half the Sun's disk showing. Blackouts are hours with no direct contact with Earth from the 10 m antenna mast there. Use for \"when does the longest night start\", \"how many nights\", \"when do we lose Earth\".",
    parameters: {
      type: "object",
      properties: { region: REGION, start: START, days: DAYS, top: { type: "integer", description: "How many of the longest to list, 1 to 10 (default 3)" } },
      required: ["region", "start"],
    },
    async run({ region, start, days, top }) {
      const r = await findRegion(region);
      const startMs = parseDay(start);
      days = stayDays(days);
      top = wholeNumber(top, "top", 1, 10, 3);
      const endMs = startMs + days * 24 * HOUR_MS;
      const { ix, frac } = await sunTrack(r.site_id);
      const a = Math.round((startMs - Date.parse(ix.start_utc)) / (ix.step_hours * HOUR_MS));
      const n = Math.round((days * 24) / ix.step_hours) + 1;
      if (a < 0 || a + n > ix.n) throw new ToolError(`Sun data covers landing dates from ${YEAR_MIN} to ${YEAR_MAX}.`);
      const out = {
        region: r.region, start, days,
        nights: { at: "panel spot of the #1 landing target, 10 m mast", ...summarise(runsOf(n, (i) => frac[a + i] < 0.5), startMs, ix.step_hours, top, endMs) },
      };
      try {
        const direct = await directHours(r.site_id, startMs, days);
        out.blackouts = { at: "the #1 landing target's 10 m antenna mast; hours with no direct contact with Earth", ...summarise(runsOf(direct.length, (i) => !direct[i]), startMs, 1, top, endMs) };
      } catch (e) {
        out.blackouts_note = e instanceof ToolError ? e.message : "Earth-contact data isn't available for these dates.";
      }
      return out;
    },
  },
  {
    name: "water_ice",
    description: "Information only (it never changes a ranking or the kit): the nearest permanently shadowed area of at least 1 km² to a region's reference point, how far away it is, how cold it gets and what share of it is cold enough to hold water ice at the surface. Without `region`: all 9 regions.",
    parameters: { type: "object", properties: { region: REGION } },
    async run({ region }) {
      const data = await getFile("/data/water_ice.json");
      if (!data) throw new ToolError("Water-ice information isn't available right now.");
      let rows = data.regions;
      if (region) {
        const r = await findRegion(region);
        rows = rows.filter((x) => x.id === r.site_id);
      }
      return { note: data.note, cold_enough_below_K: data.cold_enough_below_K, regions: rows.map(({ id, ...rest }) => rest) };
    },
  },
  {
    name: "assumptions",
    description: "The numbers the power model assumes, each with its units and source: the itemized power load (about 10 kW for a crew of 4) and the add-on loads, solar cells and array, battery, margins, the data the base sends to Earth, and what a person needs per day in oxygen, water and food (for reference; supplies are not part of the kit mass). Use for \"what do you assume for…\" and \"what is the load made of\".",
    parameters: { type: "object", properties: {
      topic: { type: "string", enum: ["loads", "solar", "battery", "margins", "comms", "crew_supplies", "mission", "all"], description: "Which group (default all)" },
    } },
    async run({ topic = "all" }) {
      const data = await getFile("/data/assumptions.json");
      if (!data) throw new ToolError("The assumptions list isn't available right now.");
      const groups = topic === "all" ? data.groups : data.groups.filter((g) => g.topic === topic);
      if (!groups.length) throw new ToolError(`Unknown topic "${topic}". Use ${data.groups.map((g) => g.topic).join(", ")} or all.`);
      return { note: data.note, groups };
    },
  },
  {
    name: "search_docs",
    description: "Search the project's documentation for how and why things work: how to use the app, what each number means, the rules (slope limits, panel reach, mast height), the data sources, accuracy against NASA's maps, the Deep Space Network and relays, limits, and why the south pole. Returns passages with their source file.",
    parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    async run({ question }) {
      if (!String(question || "").trim()) throw new ToolError("Give a question to search for.");
      const res = await fetch("/api/docs-search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: String(question).slice(0, 500) }) });
      if (!res.ok) throw new ToolError("Document search isn't available right now.");
      const out = await res.json();
      if (!out.passages?.length) return { passages: [], note: "Nothing in the docs matched. Try once more with different words; if that's empty too, say the docs don't cover it." };
      // Name each passage's doc by what it is, so answers don't quote file paths.
      return { passages: out.passages.map((p) => ({ ...p, source: DOC_TITLE[String(p.source || "").split("/").pop()] || docTitle(p.source) })) };
    },
  },
  {
    name: "show_in_app",
    description: "Fly the app's 3D view to a region (its #1 landing target, or another rank). Use when your answer is about one region. When the answer recommends dates (a landing date and stay), pass `start` and `days` too so the app's timeline shows that window.",
    parameters: { type: "object", properties: {
      region: REGION, target_rank: { type: "integer", description: "Which landing target, 1 to 10 (default 1)" },
      start: { type: "string", description: "Optional: first day of the window to show, YYYY-MM-DD (UTC)" },
      days: { type: "integer", description: "Optional: length of that window in days (1-366)" },
    }, required: ["region"] },
    async run({ region, target_rank, start, days }) {
      const r = await findRegion(region);
      target_rank = wholeNumber(target_rank, "target_rank", 1, r.targets.length, 1);
      let range = null;
      if (start) {
        const s = parseDay(start);
        const n = Math.max(1, Math.min(366, Math.round(Number(days) || 14)));
        range = { start: isoDay(s), end: isoDay(s + n * 24 * HOUR_MS) };
      }
      window.dispatchEvent(new CustomEvent("chat:show", { detail: { siteId: r.site_id, region: r.region, rank: target_rank, range } }));
      return { shown: r.region, target_rank, ...(range ? { dates_shown: range } : {}) };
    },
  },
];

// What each chat doc is called in an answer.
const DOC_TITLE = {
  "faq.md": "the FAQ", "questions.md": "the how-it-works Q&A", "assumptions.md": "the Assumptions list",
  "nasa-comparison.md": "the comparison with NASA's maps", "navigator-plan.md": "the navigator plan",
  "datasets.md": "the datasets list", "water-ice.md": "the water-ice notes", "moon-surface-broken-down.md": "the surface model notes",
  "glossary.md": "the glossary", "references.md": "the references list", "south-pole-and-artemis.md": "the south pole and Artemis background",
};
const docTitle = (path) => {
  const p = String(path || "");
  const m = p.match(/phase-(\d)/);
  if (m) return `the Phase ${m[1]} data notes`;
  // docs/regions/haworth.md → "the Haworth region page"
  const region = p.match(/regions\/([a-z0-9-]+)\.md$/);
  if (region) return region[1] === "README" ? "the regions overview" : `the ${region[1].replace(/-/g, " ")} region page`;
  return "the app overview";
};

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Schemas for the model, without the code. */
export const toolSchemas = () => TOOLS.map(({ name, description, parameters }) => ({ type: "function", function: { name, description, parameters } }));

/** Run one tool call; errors come back as { error } so the model can recover. */
export async function runTool(name, args) {
  const t = byName.get(name);
  if (!t) return { error: `Unknown tool ${name}` };
  try {
    return await t.run(args || {});
  } catch (e) {
    return { error: e instanceof ToolError ? e.message : `Tool failed: ${e.message}` };
  }
}
