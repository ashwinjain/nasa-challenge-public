// Runs frontend/src/plan/powerSize.js on cases from tests/test_power_js.py.
// Usage: node size_runner.mjs cases.json  → prints one result per case (JSON).
import { readFileSync } from "node:fs";
import { sizeOnTrack } from "../../frontend/src/plan/powerSize.js";

const { assumptions, cases } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const out = cases.map((c) => sizeOnTrack(
  { frac: c.frac, sunEl: c.sun_el, sunDistKm: c.sun_dist_km, contact: c.contact }, c.prof, assumptions, c.step_hours));
// Infinity isn't JSON; no case should hit it, but don't hide it if one does.
process.stdout.write(JSON.stringify(out, (k, v) => (v === Infinity ? "Infinity" : v)));
