// "Pick a date → where?": every site ranked for one stay window.
import { METRICS, METRIC_ORDER, stayMetrics, touchdownContact } from "./windows.js";
import { scoreColor, BODY_COLOR } from "./colors.js";

const TOP_N = 5;   // rows shown before "Show all"
const passRank = (v) => (v.pass === true ? 0 : v.pass === null ? 1 : 2);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// The power kit to land (solar array + battery) for the crewed base landing that day.
const badge = (v) => v.pass === true && v.kg != null
  ? `<span class="verdict kit num" title="${esc(v.text)}">${v.kit ? v.kit.total : `${(v.kg / 1000).toFixed(2)} t`}</span>`
  : v.pass === false ? `<span class="verdict fail" title="${esc(v.text)}">✗ Fails</span>`
  : `<span class="verdict wait" title="${esc(v.text ?? "")}">…</span>`;

const touchdown = (t) => `<span class="touchdown td-${t.state}" title="${esc(t.title)}">${t.label}</span>`;

// ctx: { data, key, metric, startMs, hours, selectedSiteId, expanded,
//        pins, onToggleExpand(), onSelect(siteId), onPin(stay), onUnpin(stay),
//        onSort(metricId) }
export function renderRank(el, ctx) {
  const { data, key, metric, startMs, hours } = ctx;
  const M = METRICS[metric];
  const rows = data.sites
    .map((site) => {
      const startHour = site.hourOf(startMs);
      const m = stayMetrics(site, key, startHour, hours);
      // The power kit (Phase 4) for the crewed base landing that day.
      const v = ctx.verdict ? ctx.verdict(site, startHour) : { pass: null };
      return { site, startHour, m, v, score: M.score(M.value(m), hours) };
    })
    // Sites that work first (still-loading ones in between), then by the metric.
    .sort((a, b) => passRank(a.v) - passRank(b.v) || b.score - a.score);

  const head = `<div class="rank-row rank-head">
      <span></span><span>#</span><span>Site</span><span>${M.label}</span><span title="Power kit to land (solar array + battery) for the crewed base landing on this date, sized at the region's #1 landing target panel spot. Stay and crew are set in Customize (a year-round base by default)">Kit</span><span title="Suggested touchdown time (UTC) on the landing day: the earliest hour with direct contact with Earth, else through a relay satellite">Touchdown</span>
      ${METRIC_ORDER.map((id) => `<button type="button" class="num sort-btn${id === metric ? " sorted" : ""}" data-sort="${id}" title="Sort by ${METRICS[id].label}">${id === metric ? "▾ " : ""}${METRICS[id].label}</button>`).join("")}
    </div>`;
  const rowHtml = (r, i) => {
    const sel = r.site.id === ctx.selectedSiteId ? " selected" : "";
    const pinned = (ctx.pins ?? []).some((p) =>
      p.siteId === r.site.id && p.startHour === r.startHour && p.hours === hours);
    const cells = METRIC_ORDER.map((id) => {
      const X = METRICS[id];
      return `<span class="num${id === metric ? " sorted" : ""}" style="color:${BODY_COLOR[X.body]}">${X.format(X.value(r.m))}</span>`;
    }).join("");
    return `<div class="rank-row${sel}${pinned ? " pinned" : ""}" data-site="${r.site.id}">
        <input type="checkbox" class="compare-cb" data-pin="${r.site.id}" data-hour="${r.startHour}"${pinned ? " checked" : ""} title="Compare" aria-label="Compare ${r.site.name}">
        <span class="rank-n">${i + 1}</span>
        <span class="rank-name">${r.site.name}</span>
        <span class="rank-track"><span style="width:${(r.score * 100).toFixed(1)}%;background:${scoreColor(M.body, r.score)}"></span></span>
        ${badge(r.v)}
        ${touchdown(touchdownContact(r.site, key, r.startHour))}
        ${cells}
      </div>`;
  };
  // Collapsed: the top few, plus the selected site if it's further down.
  const shown = ctx.expanded ? rows.map((r, i) => [r, i])
    : rows.map((r, i) => [r, i]).filter(([r, i]) => i < TOP_N || r.site.id === ctx.selectedSiteId);
  const body = shown.map(([r, i]) => rowHtml(r, i)).join("");
  const more = rows.length > TOP_N
    ? `<button class="rank-more">${ctx.expanded ? "Show top " + TOP_N + " ▴" : `Show all ${rows.length} sites ▾`}</button>`
    : "";
  const prevScroll = el.querySelector(".rank-rows")?.scrollTop ?? 0;  // keep place on re-render
  el.innerHTML = `<div class="rank">${head}<div class="rank-rows${ctx.expanded ? " expanded" : ""}">${body}</div>${more}</div>`;
  el.querySelector(".rank-rows").scrollTop = prevScroll;
  const moreBtn = el.querySelector(".rank-more");
  if (moreBtn) moreBtn.addEventListener("click", ctx.onToggleExpand);

  el.querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => ctx.onSort(b.dataset.sort)));
  el.querySelectorAll(".rank-row[data-site]").forEach((row) =>
    row.addEventListener("click", () => ctx.onSelect(row.dataset.site)));
  el.querySelectorAll(".compare-cb").forEach((cb) => {
    cb.addEventListener("click", (e) => e.stopPropagation());   // don't also select the row
    cb.addEventListener("change", () => {
      const stay = { siteId: cb.dataset.pin, startHour: Number(cb.dataset.hour), hours };
      // Revert until state confirms: a successful pin/unpin re-renders the list,
      // a refused one (e.g. the 4-pin limit) leaves the box as it was.
      const want = cb.checked;
      cb.checked = !want;
      (want ? ctx.onPin : ctx.onUnpin)(stay);
    });
  });
}
