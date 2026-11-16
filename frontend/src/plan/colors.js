import * as d3 from "d3";
import { BODY_COLOR, GOOD, EARTH, RELAY } from "../shared/colors.js";

export { BODY_COLOR, GOOD, RELAY };

// Sequential ramps, dark → bright = worse → better. Sun metrics use the app's
// amber, Earth metrics its cyan (style.css --amber / --cyan).
const RAMPS = {
  sun: d3.interpolateRgb("#1a1206", "#ffd27a"),
  earth: d3.interpolateRgb("#061418", "#8fe4f2"),
};

// Color for a 0..1 score (1 = best) of a metric about `body` ("sun" | "earth").
export function scoreColor(body, score) {
  return RAMPS[body](Math.max(0, Math.min(1, score)));
}

// Highlight for the best stays: teal over the amber Sun bars, earthy green
// over the blue Earth bars.
export const HIGHLIGHT = { sun: EARTH, earth: "#8db86b" };
