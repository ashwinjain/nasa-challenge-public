// "Where to land?" (Phase 6): for one Artemis region, the safest-to-land
// targets ranked by the power kit they need, from data/landing.json
// (scripts/precompute_landing.py). Left: the regions. Middle: the region
// outline with its numbered targets, and the selected target's landing zone,
// panel spot and walking path. Right of that: the ranked table.
import { SUN, EARTH, RELAY, GOOD, AXIS } from "../shared/colors.js";
import { PANEL_HEIGHT_M } from "../shared/assumptions.js";
import { kitTonnes } from "../shared/format.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (f) => `${Math.round(f * 100)}%`;
const days = (h) => `${(h / 24).toFixed(1)} d`;
const tonnes = (t) => `${t.toFixed(1)} t`;
// The kit's rows in tonnes, two decimals, total = the shown parts.
const kit = (p) => kitTonnes(p.battery_t, p.array_t);
const R_M = 1737400;
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

let landing = null;     // data/landing.json
let outlines = null;    // region name → [[lon, lat], ...]

export async function loadLanding(base = "/data") {
  if (landing) return landing;
  const [l, gj] = await Promise.all([
    fetch(`${base}/landing.json`).then((r) => r.json()),
    fetch(`${base}/artemis_regions.geojson`).then((r) => r.json()).catch(() => null),
  ]);
  outlines = new Map((gj?.features ?? []).map((f) => [f.properties.Region, f.geometry.coordinates[0]]));
  landing = l;
  return l;
}

export const landingRegionIds = () => (landing ? landing.regions.map((r) => r.site_id) : []);

// East/north metres from (lat0, lon0): fine over a region tens of km across.
function local(lat0, lon0, lat, lon) {
  const rad = Math.PI / 180;
  let dLon = lon - lon0;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  return [R_M * Math.cos(lat0 * rad) * dLon * rad, R_M * (lat - lat0) * rad];
}

// The region outline with every target, numbered by rank.
function regionMap(region, sel) {
  const W = 260, H = 260, PAD = 18;
  const ring = outlines.get(region.region) ?? [];
  const lat0 = region.targets.reduce((a, t) => a + t.lat, 0) / region.targets.length;
  const lon0 = region.targets[0].lon;
  const pts = [...ring.map(([lon, lat]) => local(lat0, lon0, lat, lon)),
    ...region.targets.map((t) => local(lat0, lon0, t.lat, t.lon))];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0, 1);
  const s = (Math.min(W, H) - 2 * PAD) / span;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const X = (x) => W / 2 + (x - cx) * s, Y = (y) => H / 2 - (y - cy) * s;
  const outline = ring.length
    ? `<polygon points="${ring.map(([lon, lat]) => { const [x, y] = local(lat0, lon0, lat, lon); return `${X(x).toFixed(1)},${Y(y).toFixed(1)}`; }).join(" ")}" fill="rgba(56,184,208,0.05)" stroke="${EARTH}" stroke-opacity="0.5" stroke-dasharray="3 3"/>`
    : "";
  const dots = region.targets.map((t, i) => {
    const [x, y] = local(lat0, lon0, t.lat, t.lon);
    const on = i === sel;
    return `<g class="land-dot" data-target="${i}" style="cursor:pointer">
        <circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="${on ? 8 : 6.5}" fill="${on ? GOOD : "#1a2030"}" stroke="${on ? "#fff" : GOOD}" stroke-width="1.2"/>
        <text x="${X(x).toFixed(1)}" y="${(Y(y) + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-family="var(--font-mono)" fill="${on ? "#06100a" : GOOD}">${t.rank}</text>
      </g>`;
  }).join("");
  // Scale bar: a round number of km near a quarter of the width.
  const kmSpan = (W / 4) / s / 1000;
  const km = [1, 2, 5, 10, 20, 50].find((v) => v >= kmSpan) ?? 50;
  const bar = km * 1000 * s;
  return `<svg class="land-map" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(region.region)} with its landing targets">
      ${outline}${dots}
      <text x="${W - 4}" y="12" text-anchor="end" font-size="9" fill="${AXIS}">N ↑</text>
      <line x1="8" y1="${H - 10}" x2="${8 + bar}" y2="${H - 10}" stroke="${AXIS}" stroke-width="2"/>
      <text x="8" y="${H - 14}" font-size="9" fill="${AXIS}">${km} km</text>
    </svg>`;
}

// One target up close: the 100 m landing zone, the 200 m panel reach, the
// panel spot and the walk to it.
function zoneMap(L, t) {
  const W = 220, H = 220, reach = L.panel_max_m, s = (W / 2 - 14) / reach;
  const c = W / 2;
  let panel = "";
  if (t.panel) {
    const b = (t.panel.bearing_deg * Math.PI) / 180;
    const px = c + Math.sin(b) * t.panel.distance_m * s, py = c - Math.cos(b) * t.panel.distance_m * s;
    panel = `<line x1="${c}" y1="${c}" x2="${px.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${SUN}" stroke-dasharray="4 3" stroke-width="1.5"/>
      <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="6" fill="${SUN}"/>
      <text x="${px.toFixed(1)}" y="${(py - 10).toFixed(1)}" text-anchor="middle" font-size="9" fill="${SUN}">panels</text>`;
  }
  return `<svg class="land-zone" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Landing zone and panel spot">
      <circle cx="${c}" cy="${c}" r="${reach * s}" fill="none" stroke="${AXIS}" stroke-dasharray="3 4"/>
      <text x="${c}" y="${c - reach * s + 11}" text-anchor="middle" font-size="9" fill="${AXIS}">${reach} m panel reach</text>
      <circle cx="${c}" cy="${c}" r="${L.ellipse_m * s}" fill="rgba(56,200,104,0.12)" stroke="${GOOD}"/>
      <text x="${c}" y="${c + L.ellipse_m * s - 5}" text-anchor="middle" font-size="9" fill="${GOOD}">${L.ellipse_m} m landing zone</text>
      <circle cx="${c}" cy="${c}" r="3" fill="#fff"/>
      ${panel}
      <text x="${W - 4}" y="12" text-anchor="end" font-size="9" fill="${AXIS}">N ↑</text>
    </svg>`;
}

function detail(L, region, t) {
  const p = t.power, c = t.contact;
  const nasa1 = region.targets.find((x) => x.nasa_rank === 1);
  const vsNasa = nasa1 && nasa1 !== t && nasa1.power && p
    ? `<div class="land-note">${tonnes(nasa1.power.total_t - p.total_t)} lighter than the target NASA's sunlight map rates best (#${nasa1.rank}).</div>`
    : t.nasa_rank === 1 ? `<div class="land-note">Also the sunniest safe target on NASA's sunlight map.</div>` : "";
  // Label/value blocks, the same layout as the 3D view's landing card.
  const rows = (pairs) => `<dl class="ps-kv">${pairs.map(([k, v, cls = ""]) => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`).join("")}</dl>`;
  const block = (title, tag, body) =>
    `<div class="ps-blk"><div class="ps-blk-h">${title}${tag ? `<span class="ps-tag">${tag}</span>` : ""}</div>${body}</div>`;
  const pickTag = { most_sunlight: "Most sunlight", shortest_night: "Shortest night", lightest_kit: "Lightest kit" };
  return `<div class="land-detail">
      <div class="land-title">Target #${t.rank} <span class="land-coords">${t.lat.toFixed(4)}°, ${t.lon.toFixed(4)}°</span></div>
      <div class="land-blocks">
        ${block("Landing zone", `${L.ellipse_m} m`, rows([
          [`Flat (under ${L.max_land_slope_deg}°)`, pct(t.flat_share), "ok"],
          ["Steepest", `${t.steepest_deg.toFixed(0)}°`],
        ]))}
        ${block("Panels", `at ${L.panel_height_m ?? PANEL_HEIGHT_M} m`, t.panel ? rows([
          ["Sunlit", pct(t.panel.sunlit), "sun"],
          ["Longest night", days(t.panel.night_h), "night"],
          ["Distance", `${Math.round(t.panel.distance_m)} m ${compass(t.panel.bearing_deg)}`],
          ["Slope", `${t.panel.slope_deg.toFixed(0)}°`],
          ["Night at target", days(t.landing_point.night_h)],
        ]) : `<div class="land-dim">No reachable spot</div>`)}
        ${block("Power kit", pickTag[t.panel?.pick] ?? "", p ? rows([
          ["Total", kit(p).total],
          ["Battery", kit(p).battery],
          ["Battery stores", `${Math.round(p.battery_kwh).toLocaleString()} kWh`],
          ["Array", kit(p).array],
        ]) : `<div class="land-dim">—</div>`)}
        ${block("Comms", `${PANEL_HEIGHT_M} m antenna`, rows([
          ["Direct contact", `${pct(c.direct_min)}–${pct(c.direct_max)}`, "earth"],
          ["Longest comms blackout", days(c.direct_worst_gap_h)],
          ["With relays", pct(c.relay_min), "relay"],
          ...(c.relay_worst_gap_h != null ? [["Blackout with relays", `${Math.round(c.relay_worst_gap_h)} h`]] : []),
        ]))}
      </div>
      ${vsNasa}
      ${t.terrain_id
        ? `<button type="button" class="land-3d" data-view3d>Stand here in 3D →</button>`
        : `<div class="land-dim land-3d-note">3D view: only each region's #1 target has terrain baked.</div>`}
    </div>`;
}

// ctx: { regionId, targetIdx, onRegion(siteId), onTarget(idx),
//        onView3D({ siteId, region, target, zoneM }) }
export function renderLand(el, ctx) {
  const L = landing;
  if (!L) { el.textContent = "Loading…"; return; }
  const region = L.regions.find((r) => r.site_id === ctx.regionId) ?? L.regions[0];
  const sel = Math.min(Math.max(ctx.targetIdx ?? 0, 0), region.targets.length - 1);
  const t = region.targets[sel];

  const list = L.regions.map((r) => {
    const best = r.targets[0]?.power?.total_t;
    return `<div class="site-row${r === region ? " active" : ""}" data-region="${r.site_id}">
        <span></span><button class="site-pick" data-region="${r.site_id}" title="${esc(r.region)}">${esc(r.region)}<span class="land-best">${best != null ? tonnes(best) : ""}</span></button>
      </div>`;
  }).join("");

  const rows = region.targets.map((x, i) => `<div class="rank-row land-row${i === sel ? " selected" : ""}" data-target="${i}">
      <span class="rank-n">${x.rank}</span>
      <span class="num">${x.power ? kit(x.power).total : "—"}</span>
      <span class="num" style="color:${SUN}">${x.panel ? days(x.panel.night_h) : "—"}</span>
      <span class="num" style="color:${SUN}">${x.panel ? pct(x.panel.sunlit) : "—"}</span>
      <span class="num" style="color:${GOOD}">${pct(x.flat_share)}</span>
      <span class="num" style="color:${EARTH}">${pct(x.contact.direct_min)}–${pct(x.contact.direct_max)}</span>
      <span class="num land-dim">#${x.nasa_rank}</span>
    </div>`).join("");
  const head = `<div class="rank-row land-row rank-head">
      <span>#</span><span class="num" title="Solar array + battery for a long-term base, sized over a year at the target's panel spot">Kit</span>
      <span class="num" title="Longest night at the panels (${L.panel_height_m ?? PANEL_HEIGHT_M} m): under half the Sun showing">Night</span>
      <span class="num" title="Share of the Sun's disk the panels see, averaged over the year">Sun</span>
      <span class="num" title="Share of the ${L.ellipse_m} m landing zone under ${L.max_land_slope_deg}°">Flat</span>
      <span class="num" title="Direct contact with Earth (Earth above the 10 m antenna's skyline and a DSN dish seeing the Moon), from the worst to the best touchdown point in the zone">Contact</span>
      <span class="num" title="Rank on NASA's average-sunlight map alone">NASA</span>
    </div>`;

  const year = L.start_utc.slice(0, 4);
  el.innerHTML = `<div class="land-layout">
      <div class="site-list land-regions">${list}</div>
      <div class="land-maps">${regionMap(region, sel)}${zoneMap(L, t)}</div>
      <div class="land-right">
        <div class="rank">${head}<div class="rank-rows expanded">${rows}</div></div>
        ${detail(L, region, t)}
      </div>
    </div>
    <div class="land-foot">${region.passing.toLocaleString()} of ${region.pins.toLocaleString()} spots in ${esc(region.region)} are safe to land on
      (${pct(L.min_flat)} of a ${L.ellipse_m} m zone under ${L.max_land_slope_deg}°). The ${region.targets.length} sunniest on NASA's map, at least 500 m apart, are shortlisted, then ranked by the power kit
      for a long-term crewed base over ${year}, with panels at ${L.panel_height_m ?? PANEL_HEIGHT_M} m anywhere within ${L.panel_max_m} m on a walkable path (under 20°).
      Every walkable spot is sized; the lightest array + battery wins, even when it isn't the sunniest or the shortest night.
      20 m elevation pixels can hide small craters and boulders.</div>`;

  el.querySelectorAll("[data-region]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.onRegion(b.dataset.region);
  }));
  const v3 = el.querySelector("[data-view3d]");
  if (v3 && ctx.onView3D) v3.addEventListener("click", () =>
    ctx.onView3D({ siteId: region.site_id, region: region.region, target: t, zoneM: L.ellipse_m }));
  el.querySelectorAll("[data-target]").forEach((b) =>
    b.addEventListener("click", () => ctx.onTarget(Number(b.dataset.target))));
}
