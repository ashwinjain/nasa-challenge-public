// The small value-over-label tiles (.metrics-grid / .metric in style.css),
// used by the main app's Timeline panel and the planning page's Power panel.
// tiles: [{ value, label, kind }] where kind is "sun" | "earth" | "total" | "".
export function tilesHtml(tiles) {
  return tiles.filter(Boolean).map(({ value, label, kind = "", title = "" }) =>
    `<div class="metric ${kind}"${title ? ` title="${title.replace(/"/g, "&quot;")}"` : ""}><span class="metric-value">${value}</span><span class="metric-label">${label}</span></div>`).join("");
}
