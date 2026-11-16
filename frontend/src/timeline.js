import * as d3 from "d3";
import { SUN, EARTH, AXIS } from "./shared/colors.js";

export function renderTimeline(data) {
  if (!data || !data.times || data.times.length === 0) return;

  const container = document.getElementById("timeline-panel");
  const rect = container.getBoundingClientRect();

  const margin = { top: 20, right: 15, bottom: 25, left: 50 };
  const width = rect.width - margin.left - margin.right - 16;

  // Fit the chart into the panel body's free space: body height minus its
  // padding, the note above the chart, and the metrics strip below it.
  const body = container.querySelector(".panel-body");
  const bodyStyle = getComputedStyle(body);
  const note = container.querySelector(".panel-note");
  const noteH = note ? note.offsetHeight + parseFloat(getComputedStyle(note).marginBottom) : 0;
  const metricsEl = document.getElementById("timeline-metrics");
  const metricsH =
    metricsEl && metricsEl.style.display !== "none" ? metricsEl.offsetHeight + 8 : 0;
  const avail =
    body.getBoundingClientRect().height -
    parseFloat(bodyStyle.paddingTop) -
    parseFloat(bodyStyle.paddingBottom) -
    noteH -
    metricsH;
  const height = avail - margin.top - margin.bottom - 6;

  if (width <= 0 || height <= 0) return;

  const svg = d3
    .select("#timeline-chart")
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  svg.selectAll("*").remove();

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const times = data.times.map((t) => new Date(t));
  const xScale = d3
    .scaleTime()
    .domain([times[0], times[times.length - 1]])
    .range([0, width]);

  const barHeight = Math.min(25, height / 3);
  const gap = 8;

  // Sun bar (y=0)
  const sunY = 0;
  // Earth bar
  const earthY = barHeight + gap;

  // Labels
  g.append("text")
    .attr("x", -5)
    .attr("y", sunY + barHeight / 2 + 3)
    .attr("text-anchor", "end")
    .attr("fill", SUN)
    .attr("font-size", "9px")
    .text("☀️ Power");

  g.append("text")
    .attr("x", -5)
    .attr("y", earthY + barHeight / 2 + 3)
    .attr("text-anchor", "end")
    .attr("fill", EARTH)
    .attr("font-size", "9px")
    .text("📡 Comms");

  // Background bars
  g.append("rect")
    .attr("x", 0)
    .attr("y", sunY)
    .attr("width", width)
    .attr("height", barHeight)
    .attr("fill", "rgba(30, 30, 45, 0.5)")
    .attr("rx", 2);

  g.append("rect")
    .attr("x", 0)
    .attr("y", earthY)
    .attr("width", width)
    .attr("height", barHeight)
    .attr("fill", "rgba(30, 30, 45, 0.5)")
    .attr("rx", 2);

  // Which samples count as "up": the backend's flags when present (they
  // apply the disk rule), otherwise elevation above zero.
  const upFlags = (flags, elevations) =>
    Array.isArray(flags) && flags.length === elevations.length
      ? flags.map(Boolean)
      : elevations.map((e) => e > 0);
  const sunUp = upFlags(data.sunlit, data.sun_el);
  const earthUp = upFlags(data.earth_visible, data.earth_el);

  // One rect per run of samples with the same share (to the whole percent).
  // Opacity follows the share: faint for a sliver of Sun, solid for all of it.
  const shaded = (share, color, y) => {
    const pct = share.map((v) => (v > 0 ? Math.max(1, Math.round(v * 100)) : 0));
    let start = 0;
    for (let i = 1; i <= pct.length; i++) {
      if (i < pct.length && pct[i] === pct[start]) continue;
      const p = pct[start];
      if (p) {
        const x1 = xScale(times[start]);
        const x2 = xScale(times[Math.min(i, times.length - 1)]);
        g.append("rect")
          .attr("x", x1).attr("y", y)
          .attr("width", Math.max(1, x2 - x1)).attr("height", barHeight)
          .attr("fill", color).attr("opacity", 0.15 + 0.75 * (p / 100))
          .append("title").text(`${p}% of the Sun showing`);
      }
      start = i;
    }
  };

  // Draw illuminated/visible segments
  const segments = (flags, color, y) => {
    let inSegment = false;
    let startIdx = 0;

    for (let i = 0; i <= flags.length; i++) {
      const above = i < flags.length && flags[i];

      if (above && !inSegment) {
        inSegment = true;
        startIdx = i;
      } else if (!above && inSegment) {
        inSegment = false;
        const x1 = xScale(times[startIdx]);
        const x2 = xScale(times[i - 1]);
        g.append("rect")
          .attr("x", x1)
          .attr("y", y)
          .attr("width", Math.max(1, x2 - x1))
          .attr("height", barHeight)
          .attr("fill", color)
          .attr("opacity", 0.7)
          .attr("rx", 1);
      }
    }
  };

  // Power bar: shaded by how much of the Sun's disk is above the skyline,
  // solid for the whole Sun, fainter for part of it, nothing when hidden.
  const sunShare = sunShares(data, sunUp);
  shaded(sunShare, SUN, sunY);
  segments(earthUp, EARTH, earthY);

  // Overlap bar (both sunlit and Earth visible)
  const overlapY = earthY + barHeight + gap;
  g.append("text")
    .attr("x", -5)
    .attr("y", overlapY + barHeight / 2 + 3)
    .attr("text-anchor", "end")
    .attr("fill", "#80e080")
    .attr("font-size", "9px")
    .text("Both");

  g.append("rect")
    .attr("x", 0)
    .attr("y", overlapY)
    .attr("width", width)
    .attr("height", barHeight)
    .attr("fill", "rgba(30, 30, 45, 0.5)")
    .attr("rx", 2);

  // Both: Earth in view, shaded by the Sun's share like the Power bar.
  shaded(sunShare.map((v, i) => (earthUp[i] ? v : 0)), "#80e080", overlapY);

  // X axis
  g.append("g")
    .attr("transform", `translate(0,${overlapY + barHeight + 4})`)
    .call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat("%b %d")))
    .selectAll("text,line,path")
    .attr("stroke", AXIS)
    .attr("fill", AXIS)
    .style("font-size", "9px");
}

// Share of the Sun's disk above the horizon at each sample (0–1): the
// terrain skyline at the Sun's azimuth when there is one, else level ground.
// Matches lunarsky.power.disk_fraction; hours the backend calls dark stay 0.
const SUN_RADIUS_DEG = 0.2666;
function sunShares(data, sunUp) {
  const sk = data.skyline;
  const horizonAt = sk && sk.az && sk.el ? interpPeriodic(sk.az, sk.el) : () => 0;
  return data.sun_el.map((el, i) => {
    if (!sunUp[i]) return 0;
    const u = Math.max(-1, Math.min(1, (el - horizonAt(data.sun_az[i])) / SUN_RADIUS_DEG));
    return 1 - (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
  });
}

// Linear interpolation over azimuth with wrap-around at 360°.
function interpPeriodic(xs, ys) {
  const n = xs.length;
  return (az) => {
    const a = ((az % 360) + 360) % 360;
    let hi = xs.findIndex((x) => x >= a);
    if (hi === -1) hi = n;                      // past the last point: wrap
    const lo = (hi - 1 + n) % n;
    const x0 = hi === 0 ? xs[n - 1] - 360 : xs[lo];
    const x1 = hi === n ? xs[0] + 360 : xs[hi];
    const y0 = ys[lo], y1 = ys[hi % n];
    return x1 === x0 ? y0 : y0 + ((a - x0) / (x1 - x0)) * (y1 - y0);
  };
}
