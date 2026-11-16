// "Pick a site → when?": one bar per landing day of the year, scored for a
// stay of the chosen length. The three best landing days are marked ①②③,
// unless the metric barely changes over the year: then the chart says the
// landing date doesn't matter for it here instead of ranking near-ties.
import * as d3 from "d3";
import { METRICS, yearSeries, bestDays, fmtDay, touchdownContact } from "./windows.js";
import { fmtHours, DAY_MS } from "../shared/format.js";
import { scoreColor, HIGHLIGHT } from "./colors.js";
import { BG_PANEL } from "../shared/colors.js";

// A metric counts as flat when its score (0–1, the bar's scale) varies by
// less than this across all landing days.
const FLAT_SPREAD = 0.05;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ctx: { site, key, metric, year, stayDays, selectedDay, onSelectDay(point), tooltip }
export function renderWhen(el, ctx) {
  const { site, key, metric, year, stayDays } = ctx;
  const M = METRICS[metric];
  const stayH = stayDays * 24;
  const series = yearSeries(site, key, year, stayDays);
  el.innerHTML = `<div class="when-wrap"><svg class="when-chart"></svg></div>`;
  const svg = d3.select(el).select("svg");
  const W = Math.max(400, el.clientWidth), H = 262;
  const scores = series.map((p) => M.score(M.value(p.m), stayH));
  const flat = d3.max(scores) - d3.min(scores) < FLAT_SPREAD;
  // The three picks, kept far enough apart that their date labels don't
  // overlap (which depends on the plot width).
  const m = { top: 22, right: 6, bottom: 38, left: 40 };
  const pick = () => {
    const w0 = W - m.left - m.right;
    const labelDays = Math.ceil(90 / (w0 / series.length));
    return flat ? [] : bestDays(series, metric, stayH, 3, Math.max(7, stayDays, labelDays));
  };
  let best = pick();
  // A pick whose stay runs past Dec 31: reserve a strip on the right to show
  // it carrying on into next year.
  const NEXT_W = 40;
  if (best.some((p) => p.day + stayDays > series.length)) {
    m.right = NEXT_W + 6;
    best = pick();
  }
  const w = W - m.left - m.right, h = H - m.top - m.bottom;
  svg.attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  // x: one column per landing day, with a small gap between months so a
  // flat year (e.g. Earth in view 100%) still reads month by month.
  const GAP = 3;
  const monthStart = MONTHS.map((_, i) => (Date.UTC(year, i, 1) - Date.UTC(year, 0, 1)) / DAY_MS);
  const bw = (w - GAP * (MONTHS.length - 1)) / series.length;
  const monthOf = (d) => Math.max(0, Math.min(MONTHS.length - 1, d3.bisectRight(monthStart, Math.floor(d)) - 1));
  const x = (d) => d * bw + monthOf(d) * GAP;
  const xs = series.map((p) => x(p.day));

  // y: the metric's real value. Percent metrics run 0–100%; "longest" metrics
  // run from 0 to the whole stay (the worst case: dark the entire time).
  const pct = M.better === "high";
  const frac = (p) => pct ? M.value(p.m) : Math.min(1, M.value(p.m) / stayH);
  const y = (f) => h - f * h;
  // For "longest" metrics: whole-day ticks, plus the top (the full stay) when
  // it isn't too close to the last one.
  const dayTicks = () => {
    const t = d3.ticks(0, stayDays, 4).filter((d) => Number.isInteger(d));
    if (stayDays - t[t.length - 1] >= stayDays / 6) t.push(stayDays);
    return t.map((d) => d / stayDays);
  };
  const ticks = pct ? [0, 0.25, 0.5, 0.75, 1] : (stayDays >= 2 ? dayTicks() : [0, 0.5, 1]);
  const tickLabel = (f) => {
    if (pct) return `${Math.round(f * 100)}%`;
    if (f === 0) return "0";
    const d = f * stayDays;
    return stayDays >= 2 && Number.isInteger(Math.round(d * 1000) / 1000) ? `${Math.round(d)} d` : fmtHours(f * stayH);
  };
  const score = (p) => M.score(M.value(p.m), stayH);

  ticks.forEach((f) => {
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(f)).attr("y2", y(f))
      .attr("stroke", "rgba(80,120,180,0.12)");
    g.append("text").attr("x", -6).attr("y", y(f) + 3).attr("text-anchor", "end")
      .attr("class", "axis-label").text(tickLabel(f));
  });
  // What the bars mean, and which way is good.
  g.append("text").attr("x", -m.left + 2).attr("y", -10).attr("class", "axis-title")
    .text(`${M.label} · ${pct ? "higher" : "lower"} is better`);
  // Earth chart also carries the longest blackouts (no charts of their own).
  if (metric === "earth") {
    // Longest over every landing day: direct to Earth, and with the two relays.
    const hi = d3.max(series, (p) => METRICS.blackout.value(p.m));
    const relay = d3.max(series, (p) => METRICS.relayBlackout.value(p.m));
    // Days with one decimal ("3.2 days"); under a day, hours ("5 hours").
    // At or under the data's 1 h step it only says "under an hour".
    const f = (h) => (h <= 1 ? "under 1 hour" : h < 24 ? `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"}` : `${(h / 24).toFixed(1).replace(/\.0$/, "")} days`);
    const txt = `Longest comms blackout: ${f(hi)} · With two relays: ${f(relay)}`;
    g.append("text").attr("x", w).attr("y", -10).attr("text-anchor", "end")
      .attr("class", "axis-title blackout-note").text(txt);
  }
  MONTHS.forEach((name, i) => {
    g.append("text").attr("x", x(monthStart[i]) + 2).attr("y", h + 15).attr("class", "axis-label").text(name);
  });

  // Bars: height is the value; color is how good it is (bright = better).
  g.selectAll("rect.day").data(series).join("rect")
    .attr("class", "day")
    .attr("x", (p) => x(p.day)).attr("width", bw + 0.4)
    .attr("y", (p) => y(Math.max(frac(p), 1 / h))).attr("height", (p) => Math.max(1, frac(p) * h))
    .attr("fill", (p) => scoreColor(M.body, 0.25 + 0.75 * score(p)));

  // Selected stay (after a click): outline from landing day to the end of the stay.
  if (ctx.selectedDay != null) {
    g.append("rect").attr("class", "when-selected")
      .attr("x", x(ctx.selectedDay)).attr("y", -2)
      .attr("width", Math.max(2, x(ctx.selectedDay + stayDays) - x(ctx.selectedDay))).attr("height", h + 2);
  }

  // The three best stays: a shaded box over the stay on the chart, and its
  // dates on the x-axis under the months. Teal for Sun metrics (over amber
  // bars), earthy green for Earth metrics (over blue bars).
  const hi = HIGHLIGHT[M.body];
  const last = series.length;
  best.forEach((p, i) => {
    const x0 = x(p.day), x1 = x(Math.min(last, p.day + stayDays)) + (p.day + stayDays >= last ? bw : 0);
    // A stay landing late in the year runs past Dec 31, off the chart: draw
    // it open on the right with an arrow so it doesn't read as a short stay.
    const runsOn = p.day + stayDays > last;
    g.append("rect").attr("class", "best-box")
      .attr("x", x0).attr("y", 0).attr("width", Math.max(2, x1 - x0)).attr("height", h)
      .attr("fill", hi).attr("fill-opacity", 0.28)
      .attr("stroke", runsOn ? "none" : hi).attr("stroke-width", 1.2);
    if (runsOn) {
      // Box stays open on the right and carries on as a fading strip past
      // the end of the year, labelled with the year it runs into.
      g.append("path").attr("class", "best-box")
        .attr("d", `M${x1},0H${x0}V${h}H${x1}`).attr("fill", "none").attr("stroke", hi).attr("stroke-width", 1.2);
      const gid = `next-fade-${i}`;
      const grad = svg.append("defs").append("linearGradient").attr("id", gid);
      grad.append("stop").attr("offset", "0%").attr("stop-color", hi).attr("stop-opacity", 0.35);
      grad.append("stop").attr("offset", "100%").attr("stop-color", hi).attr("stop-opacity", 0);
      g.append("rect").attr("class", "best-box")
        .attr("x", x1).attr("y", 0).attr("width", NEXT_W).attr("height", h).attr("fill", `url(#${gid})`);
      g.append("path").attr("class", "best-box")
        .attr("d", `M${x1},0H${x1 + NEXT_W}M${x1},${h}H${x1 + NEXT_W}`)
        .attr("stroke", hi).attr("stroke-width", 1.2).attr("stroke-dasharray", "3 3");
      g.append("line").attr("class", "best-box")
        .attr("x1", x1).attr("x2", x1).attr("y1", 0).attr("y2", h)
        .attr("stroke", "var(--text-dim)").attr("stroke-width", 1).attr("stroke-dasharray", "2 3");
      g.append("text").attr("class", "next-year")
        .attr("x", x1 + NEXT_W / 2).attr("y", h / 2 - 4).attr("text-anchor", "middle").attr("fill", hi).text("→");
      g.append("text").attr("class", "next-year")
        .attr("x", x1 + NEXT_W / 2).attr("y", h / 2 + 10).attr("text-anchor", "middle").attr("fill", hi).text(year + 1);
    }
    // Solid edge on the landing day: that day's bar is the one the box is scored by.
    g.append("line").attr("class", "best-box")
      .attr("x1", x0).attr("x2", x0).attr("y1", 0).attr("y2", h)
      .attr("stroke", hi).attr("stroke-width", 2.5);
    // Rank (1 = best) in the box's top-left corner, on a small dark backing
    // so it reads over tall bars.
    g.append("rect").attr("class", "best-box")
      .attr("x", x0 + 3).attr("y", 3).attr("width", 11).attr("height", 13)
      .attr("fill", BG_PANEL).attr("fill-opacity", 0.85);
    g.append("text").attr("class", "best-rank")
      .attr("x", x0 + 8.5).attr("y", 13).attr("text-anchor", "middle").attr("fill", hi).text(i + 1);
    const endMs = p.ms + stayH * 3600 * 1000;
    const sameMonth = new Date(p.ms).getUTCMonth() === new Date(endMs).getUTCMonth();
    const dates = sameMonth ? `${fmtDay(p.ms)}–${new Date(endMs).getUTCDate()}` : `${fmtDay(p.ms)}–${fmtDay(endMs)}`;
    // The power kit for this landing date, when the page supplies it.
    const v = ctx.verdictFor ? ctx.verdictFor(p) : null;
    const label = v && v.pass === false ? `${dates} ✗` : dates;
    // Centered under the box, but nudged so the whole label stays on the chart.
    const tx = g.append("text").attr("class", "best-date")
      .attr("y", h + 31).attr("text-anchor", "middle").attr("fill", hi).text(label);
    if (v && v.text) tx.append("title").text(v.pass === false ? `Fails: ${v.text}` : `Power kit: ${v.text}`);
    const half = tx.node().getComputedTextLength() / 2;
    tx.attr("x", Math.max(half - m.left + 2, Math.min(w + m.right - half, (x0 + x1) / 2)));
  });

  // Flat year: say so in place of the ①②③ boxes.
  if (flat) {
    const vals = series.map((p) => M.value(p.m));
    const lo = M.format(d3.min(vals)), hi = M.format(d3.max(vals));
    const range = lo === hi ? `always ${lo}` : `${lo}–${hi} all year`;
    const msg = g.append("g").attr("class", "flat-note")
      .attr("transform", `translate(${w / 2},${h / 2})`);
    const line1 = `Landing date doesn't affect ${M.label.toLowerCase()} here`;
    const box = msg.append("rect").attr("rx", 3);
    msg.append("text").attr("class", "flat-title").attr("text-anchor", "middle").attr("y", -2).text(line1);
    msg.append("text").attr("class", "flat-sub").attr("text-anchor", "middle").attr("y", 15).text(range);
    const bb = msg.node().getBBox();
    box.attr("x", bb.x - 12).attr("y", bb.y - 8).attr("width", bb.width + 24).attr("height", bb.height + 16);
  }

  // Hover + click on any day.
  const hit = g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .style("cursor", "pointer");
  const dayAt = (ev) => Math.max(0, Math.min(series.length - 1, d3.bisectRight(xs, d3.pointer(ev)[0]) - 1));
  hit.on("mousemove", (ev) => {
    const p = series[dayAt(ev)];
    const t = touchdownContact(site, ctx.key, site.hourOf(p.ms));
    ctx.tooltip.show(ev, `<b>Land ${fmtDay(p.ms)}</b> · ${M.label} ${M.format(M.value(p.m))}`
      + `<br>Touchdown: <span class="touchdown td-${t.state}">${t.time ? `${t.time} UTC, ${t.state}` : "no contact all day"}</span>`);
  }).on("mouseleave", () => ctx.tooltip.hide())
    .on("click", (ev) => ctx.onSelectDay(series[dayAt(ev)]));
}
