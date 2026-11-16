// Compare tray: pinned stays stacked vertically, each with its sunlight and
// contact with Earth drawn across the stay, and the five numbers.
// The Earth bar shows how the site reaches Earth hour by hour: directly,
// through one of the two relay satellites, or not at all (empty). A pin is
// { siteId, startHour, hours }; it's always scored with the current horizon
// setting, which is why rows don't repeat "terrain 2 m".
import { METRICS, METRIC_ORDER, stayMetrics, fmtRange, touchdownContact } from "./windows.js";
import { BODY_COLOR, GOOD, RELAY } from "./colors.js";

const CONTACT_COLOR = { direct: BODY_COLOR.earth, relay: RELAY };
const CONTACT_TITLE = { direct: "Direct to Earth", relay: "Through a relay satellite" };

// ctx: { data, key, pins, showDate(pin) → bool, onRemove(index) }
export function renderTray(el, ctx) {
  const { data, key, pins } = ctx;
  if (!pins.length) {
    el.innerHTML = `<div class="tray-empty">Tick a site to compare it here.</div>`;
    return;
  }
  const rows = pins.map((p) => {
    const site = data.byId.get(p.siteId);
    return { p, site, m: stayMetrics(site, key, p.startHour, p.hours) };
  });

  // Best value in each column, when there's more than one row to compare.
  const best = {};
  if (rows.length > 1) {
    for (const id of METRIC_ORDER) {
      const X = METRICS[id];
      const vals = rows.map((r) => X.value(r.m));
      if (Math.max(...vals) === Math.min(...vals)) continue;   // all equal: nothing stands out
      best[id] = X.better === "high" ? Math.max(...vals) : Math.min(...vals);
    }
  }

  const track = (site, p, body) => {
    const a = p.startHour, b = p.startHour + p.hours;
    const pos = (s, e) => `left:${((s - a) / (b - a)) * 100}%;width:${((e - s) / (b - a)) * 100}%`;
    // Sun: shaded like the main timeline, solid for the whole Sun, fainter
    // as less of it clears the skyline. Earth: direct or relay contact.
    const segs = body === "sun"
      ? site.sunShadesIn(key, a, b).map(([s, e, v]) =>
        `<i style="${pos(s, e)};background:${BODY_COLOR.sun};opacity:${(0.15 + 0.85 * v / 100).toFixed(3)}"${v < 100 ? ` title="${v}% of the Sun showing"` : ""}></i>`).join("")
      : site.contactIn(key, a, b).map(([s, e, c]) =>
        `<i style="${pos(s, e)};background:${CONTACT_COLOR[c]}" title="${CONTACT_TITLE[c]}"></i>`).join("");
    const days = Math.round(p.hours / 24);
    const ticks = days <= 31 ? Array.from({ length: days - 1 }, (_, d) =>
      `<b style="left:${((d + 1) / days) * 100}%"></b>`).join("") : "";
    return `<div class="tray-track">${segs}${ticks}</div>`;
  };

  const touchdownLine = (r) => {
    const t = touchdownContact(r.site, key, r.p.startHour);
    const txt = t.time ? `${t.time} UTC, ${t.state}` : "no contact";
    return `<div class="tray-date">Touchdown: <span class="touchdown td-${t.state}" title="${t.title}">${txt}</span></div>`;
  };

  el.innerHTML = `<div class="tray">
    <div class="tray-row tray-head"><span>Site</span><span class="tray-legend">Contact:
      <i style="background:${CONTACT_COLOR.direct}"></i>direct
      <i style="background:${CONTACT_COLOR.relay}"></i>relay
      <i class="none"></i>none</span>
      ${METRIC_ORDER.map((id) => `<span class="num">${METRICS[id].short}</span>`).join("")}<span></span></div>
    ${rows.map((r, i) => `<div class="tray-row">
      <div><div class="tray-name">${r.site.name}</div>${ctx.showDate(r.p)
        ? `<div class="tray-date">${fmtRange(r.site.msOf(r.p.startHour), r.p.hours)}</div>` : ""}${touchdownLine(r)}</div>
      <div class="tray-bars">${track(r.site, r.p, "sun")}${track(r.site, r.p, "earth")}</div>
      ${METRIC_ORDER.map((id) => {
        const X = METRICS[id];
        const v = X.value(r.m);
        const color = id in best && v === best[id] ? GOOD : BODY_COLOR[X.body];
        return `<span class="num big" style="color:${color}">${X.format(v)}</span>`;
      }).join("")}
      <button class="unpin" data-i="${i}" aria-label="Remove">✕</button>
    </div>`).join("")}
  </div>`;
  el.querySelectorAll(".unpin").forEach((b) => b.addEventListener("click", () => ctx.onRemove(Number(b.dataset.i))));
}
