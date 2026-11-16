import * as d3 from "d3";
import { SUN, EARTH, AXIS, BG } from "./shared/colors.js";

// Sky plot: where the Sun and Earth travel across the site's sky over the
// loaded window. Azimuth (0° = north, 90° = east) runs left to right and
// elevation bottom to top, with the smooth-Moon horizon at 0°. Elevations are
// true values, as in the 3D scene. The y range fits the data, so a Sun that
// only climbs 4° at the pole still fills the chart.
//
// In surface view the plot doubles as a horizon minimap: a box marks the
// camera's field of view (setSkyPlotLook), and clicking the chart turns the
// camera to face that point (onSkyPlotClick).
//
// With terrain on, `data.skyline` ({az, el} at 0.5° steps) replaces the flat
// horizon: the ground is shaded up to the skyline, and a track is bright
// only where it clears the skyline. The flat 0° line stays as a faint
// reference.

// `upKey` is the backend's per-sample "up" flag (it applies the disk rule,
// so the Sun counts as up while any of its disk shows), as the timeline uses.
const BODIES = [
  { key: "sun", label: "Sun", color: SUN, upKey: "sunlit" },
  { key: "earth", label: "Earth", color: EARTH, upKey: "earth_visible" },
];
const SKYLINE = "#9aa4b8";
const PANEL_SKYLINE = "#7fd4a0";   // the panels' 10 m skyline (not amber: that's the Sun)
const COMPASS = [[0, "N"], [90, "E"], [180, "S"], [270, "W"], [360, "N"]];

let data = null;
let currentIdx = 0;
let plot = null;      // { x, y, markers, view } from the last draw, for moving the markers
let observer = null;
let look = null;      // { az, el, hfov, vfov } in degrees while on the surface, else null
let clickHandler = null;

// Draw the tracks for a newly loaded window.
export function renderSkyPlot(skyData) {
  if (!skyData || !skyData.times || !skyData.times.length) return;
  data = skyData;
  currentIdx = Math.min(currentIdx, data.times.length - 1);
  draw();
  // Redraw whenever the panel changes size: resized, uncollapsed, or shown
  // for the first time after the intro (it measures 0×0 while hidden).
  if (!observer) {
    observer = new ResizeObserver(() => draw());
    observer.observe(document.getElementById("sky-chart-wrap"));
  }
}

// Move the "now" markers to a sample; cheap enough to call every frame.
export function setSkyPlotTime(idx) {
  currentIdx = idx;
  placeMarkers();
}

// Show which part of the sky the surface camera sees, or hide the box (null).
export function setSkyPlotLook(next) {
  look = next;
  placeViewBox();
}

// Called with (az, el) in degrees when the chart is clicked.
export function onSkyPlotClick(cb) { clickHandler = cb; }

// Split a track wherever azimuth wraps past north (359° → 1°), adding a point
// on the chart's edge at each wrap so the line runs off one side and back on
// at the other instead of jumping across the whole chart.
function trackSegments(az, el) {
  const segments = [];
  let seg = [[az[0], el[0]]];
  for (let i = 1; i < az.length; i++) {
    const a0 = az[i - 1], a1 = az[i];
    if (Math.abs(a1 - a0) > 180) {
      const unwrapped = a1 < a0 ? a1 + 360 : a1 - 360;
      const edge = unwrapped > a0 ? 360 : 0;
      const t = (edge - a0) / (unwrapped - a0);
      const elEdge = el[i - 1] + t * (el[i] - el[i - 1]);
      seg.push([edge, elEdge]);
      segments.push(seg);
      seg = [[360 - edge, elEdge]];
    }
    seg.push([a1, el[i]]);
  }
  segments.push(seg);
  return segments;
}

function draw() {
  if (!data) return;
  const wrap = document.getElementById("sky-chart-wrap");
  const svg = d3.select("#sky-chart");
  const W = wrap.clientWidth, H = wrap.clientHeight;
  svg.selectAll("*").remove();
  plot = null;

  const margin = { top: 10, right: 12, bottom: 20, left: 36 };
  const width = W - margin.left - margin.right;
  const height = H - margin.top - margin.bottom;
  if (width <= 20 || height <= 20) return;

  svg.attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Skyline as a closed loop of [az, el] points from 0° to 360°.
  const sky = data.skyline && data.skyline.az && data.skyline.az.length
    ? data.skyline.az.map((a, i) => [a, data.skyline.el[i]]).concat([[360, data.skyline.el[0]]])
    : null;

  // Fit elevation to both tracks (and the skyline), always keeping 0° in view.
  const els = data.sun_el.concat(data.earth_el, sky ? sky.map((p) => p[1]) : []);
  const lo = Math.min(0, d3.min(els));
  const hi = Math.max(0, d3.max(els));
  const pad = Math.max(0.5, (hi - lo) * 0.08);
  const x = d3.scaleLinear().domain([0, 360]).range([0, width]);
  const y = d3.scaleLinear()
    .domain([lo - pad, hi + pad])
    .range([height, 0])
    .nice();
  // Rounding can overshoot what's possible; elevation never passes ±90°.
  const [y0, y1] = y.domain();
  y.domain([Math.max(-90, y0), Math.min(90, y1)]);
  const horizonY = y(0);

  // The ground: below the skyline with terrain, below 0° without.
  const skyLine = d3.line().x((p) => x(p[0])).y((p) => y(p[1]));
  const groundPath = sky
    ? `${skyLine(sky)}L${width},${height}L0,${height}Z`
    : `M0,${horizonY}L${width},${horizonY}L${width},${height}L0,${height}Z`;
  const airPath = sky
    ? `${skyLine(sky)}L${width},0L0,0Z`
    : `M0,0L${width},0L${width},${horizonY}L0,${horizonY}Z`;
  g.append("path")
    .attr("d", groundPath)
    .attr("fill", sky ? "rgba(120, 130, 150, 0.16)" : "rgba(80, 120, 180, 0.07)");

  // Compass gridlines.
  g.append("g")
    .selectAll("line")
    .data(COMPASS)
    .join("line")
    .attr("x1", (d) => x(d[0])).attr("x2", (d) => x(d[0]))
    .attr("y1", 0).attr("y2", height)
    .attr("stroke", "rgba(80, 120, 180, 0.12)");

  // Flat horizon line (just a reference once there's a skyline).
  g.append("line")
    .attr("x1", 0).attr("x2", width)
    .attr("y1", horizonY).attr("y2", horizonY)
    .attr("stroke", AXIS)
    .attr("stroke-opacity", sky ? 0.6 : 1)
    .attr("stroke-dasharray", "3 3");
  if (!sky) {
    g.append("text")
      .attr("x", 4).attr("y", horizonY - 3)
      .attr("fill", AXIS).attr("font-size", "8px")
      .text("HORIZON");
  } else {
    g.append("path")
      .attr("d", skyLine(sky))
      .attr("fill", "none")
      .attr("stroke", SKYLINE)
      .attr("stroke-width", 1.1)
      .attr("stroke-linejoin", "round");
    const eye = data.skyline.eye === "0" ? "GROUND LEVEL" : `YOU, ${data.skyline.eye} M`;
    const legend = g.append("text").attr("x", 4).attr("y", 9).attr("font-size", "8px");
    legend.append("tspan").attr("fill", SKYLINE).text(`— ${eye}`);
    if (data.skyline.panel) {
      // The panels on their 10 m mast see over more of the terrain: a lower line.
      const panelSky = data.skyline.az.map((a, i) => [a, data.skyline.panel[i]])
        .concat([[360, data.skyline.panel[0]]]);
      g.append("path")
        .attr("d", skyLine(panelSky))
        .attr("fill", "none")
        .attr("stroke", PANEL_SKYLINE)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4 2")
        .attr("stroke-linejoin", "round");
      legend.append("tspan").attr("fill", PANEL_SKYLINE).text("   - - PANELS, 10 M");
    }
    legend.append("tspan").attr("fill", AXIS).text("   ··· 0°");
  }

  // Axes: compass letters along the bottom, degrees up the side.
  const xAxis = g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).tickValues(COMPASS.map((d) => d[0]))
      .tickFormat((v) => COMPASS.find((d) => d[0] === v)[1]).tickSizeOuter(0));
  const yAxis = g.append("g")
    .call(d3.axisLeft(y).ticks(Math.max(2, Math.floor(height / 28))).tickFormat((v) => `${v}°`));
  for (const axis of [xAxis, yAxis]) {
    axis.selectAll("line,path").attr("stroke", AXIS);
    axis.selectAll("text").attr("fill", AXIS).style("font-size", "9px");
  }

  // Tracks: bright above the horizon or skyline, faint below it (two
  // copies, each clipped to its side).
  const defs = svg.append("defs");
  defs.append("clipPath").attr("id", "sky-clip-up").append("path").attr("d", airPath);
  defs.append("clipPath").attr("id", "sky-clip-down").append("path").attr("d", groundPath);
  const line = d3.line().x((p) => x(p[0])).y((p) => y(p[1]));

  for (const body of BODIES) {
    const segments = trackSegments(data[`${body.key}_az`], data[`${body.key}_el`]);
    for (const [clip, opacity] of [["sky-clip-up", 0.9], ["sky-clip-down", 0.3]]) {
      g.append("g")
        .attr("clip-path", `url(#${clip})`)
        .selectAll("path")
        .data(segments)
        .join("path")
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", body.color)
        .attr("stroke-width", 1.4)
        .attr("stroke-opacity", opacity)
        .attr("stroke-linejoin", "round");
    }
  }

  // Field-of-view box. Drawn three times, a full turn apart, so a view that
  // straddles north shows on both edges; the clip trims it to the plot.
  defs.append("clipPath").attr("id", "sky-clip-plot")
    .append("rect").attr("width", width).attr("height", height);
  const view = g.append("g").attr("class", "sky-view").attr("clip-path", "url(#sky-clip-plot)");
  view.selectAll("rect").data([-360, 0, 360]).join("rect")
    .attr("fill", "rgba(255, 255, 255, 0.07)")
    .attr("stroke", "rgba(255, 255, 255, 0.75)")
    .attr("stroke-width", 1)
    .attr("rx", 2);
  view.selectAll("line").data([-360, 0, 360]).join("line")   // centre tick: exact heading
    .attr("stroke", "rgba(255, 255, 255, 0.55)")
    .attr("stroke-dasharray", "2 2");

  // Press anywhere on the plot to look there, and keep dragging to sweep the
  // view across the horizon (the transparent rect gives the whole plot area
  // a hit target, not just the drawn lines). Pointer capture keeps the drag
  // going if the cursor leaves the chart; the point is clamped to the plot.
  g.insert("rect", ":first-child")
    .attr("width", width).attr("height", height)
    .attr("fill", "transparent");
  const lookAt = (event) => {
    if (!clickHandler) return;
    const [mx, my] = d3.pointer(event, g.node());
    const cx = Math.max(0, Math.min(width, mx)), cy = Math.max(0, Math.min(height, my));
    clickHandler(x.invert(cx), y.invert(cy));
  };
  let dragging = false;
  // d3's .on replaces a same-named listener, so redraws don't stack them on the svg.
  svg
    .on("pointerdown.look", (event) => {
      const [mx, my] = d3.pointer(event, g.node());
      if (mx < 0 || mx > width || my < 0 || my > height) return;
      dragging = true;
      svg.node().setPointerCapture(event.pointerId);
      svg.classed("dragging", true);
      lookAt(event);
      event.preventDefault();
    })
    .on("pointermove.look", (event) => { if (dragging) lookAt(event); })
    .on("pointerup.look pointercancel.look", (event) => {
      if (!dragging) return;
      dragging = false;
      svg.classed("dragging", false);
      if (svg.node().hasPointerCapture(event.pointerId)) svg.node().releasePointerCapture(event.pointerId);
    });

  // "Now" markers: filled while the body is above the horizon, hollow below.
  const markers = {};
  for (const body of BODIES) {
    const m = g.append("g").attr("class", `sky-marker ${body.key}`);
    m.append("circle").attr("r", 4.5).attr("stroke", body.color).attr("stroke-width", 1.5);
    m.append("text")
      .attr("x", 7).attr("y", -6)
      .attr("fill", body.color).attr("font-size", "9px")
      .text(body.label);
    markers[body.key] = m;
  }

  plot = { x, y, markers, view, height };
  placeMarkers();
  placeViewBox();
}

function placeViewBox() {
  if (!plot) return;
  plot.view.style("display", look ? null : "none");
  if (!look) return;
  const { x, y, view, height } = plot;
  const [elLo, elHi] = y.domain();
  // Vertical extent clamped to the plot. At the poles the y range is often
  // smaller than the camera's field of view, so the box spans it all.
  const top = y(Math.min(elHi, look.el + look.vfov / 2));
  const bottom = y(Math.max(elLo, look.el - look.vfov / 2));
  const w = x(look.hfov) - x(0);
  view.selectAll("rect")
    .attr("x", (off) => x(look.az + off) - w / 2)
    .attr("width", w)
    .attr("y", Math.min(top, bottom))
    .attr("height", Math.max(2, Math.abs(bottom - top)));
  view.selectAll("line")
    .attr("x1", (off) => x(look.az + off)).attr("x2", (off) => x(look.az + off))
    .attr("y1", 0).attr("y2", height);
}

function isUp(body, idx) {
  const flags = data[body.upKey];
  return Array.isArray(flags) ? Boolean(flags[idx]) : data[`${body.key}_el`][idx] > 0;
}

function placeMarkers() {
  if (!plot || !data || currentIdx >= data.times.length) return;
  for (const body of BODIES) {
    const az = data[`${body.key}_az`][currentIdx];
    const el = data[`${body.key}_el`][currentIdx];
    const m = plot.markers[body.key];
    m.attr("transform", `translate(${plot.x(az)},${plot.y(el)})`);
    m.select("circle").attr("fill", isUp(body, currentIdx) ? body.color : BG);
    // Keep the label inside the chart near the right edge.
    m.select("text")
      .attr("x", az > 320 ? -7 : 7)
      .attr("text-anchor", az > 320 ? "end" : "start");
  }
}
