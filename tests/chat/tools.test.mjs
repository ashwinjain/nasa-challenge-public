// The chat's tools against the app's own data: run with
//   node --test tests/chat/tools.test.mjs
// No server needed (static data is read from frontend/public).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shown } from "./env.mjs";

const { runTool, TOOLS } = await import("../../frontend/src/chat/tools.js");
const { ask } = await import("../../frontend/src/chat/chat.js");
const landing = JSON.parse(readFileSync(new URL("../../frontend/public/data/landing.json", import.meta.url)));
const r1 = (v) => Math.round(v * 10) / 10;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test("a stay beyond the supported range never substitutes a shorter calculation", async () => {
  const history = [];
  const answer = await ask(history, "Can I plan a 500-day stay at Haworth?");
  assert.match(answer, /500 days is outside/);
  assert.ok(!history.some((m) => m.tool_calls || m.role === "tool"));
});

test("list_regions matches landing.json", async () => {
  const out = await runTool("list_regions", {});
  assert.equal(out.regions.length, 9);
  for (const r of landing.regions) {
    const row = out.regions.find((x) => x.name === r.region);
    const t = r.targets[0];
    assert.equal(row.top_target_kit_t, r1(t.power.total_t));
    const conditions = await runTool("region_conditions", { region: r.region, start: "2027-01-01" });
    assert.equal(row.top_target_longest_night_h, conditions.longest_night_h);
    assert.equal(row.landing_zones_safe, r.passing);
    assert.ok(!("id" in row), "no internal ids in the output");
  }
});

test("region_conditions over the default year agrees with the landing run", async () => {
  for (const r of landing.regions) {
    const t = r.targets[0];
    const out = await runTool("region_conditions", { region: r.region, start: "2027-01-01" });
    near(out.sunlit_pct, t.panel.sunlit * 100, 0.2, `${r.region} sunlit`);
    near(out.longest_night_h, t.panel.night_h, 1, `${r.region} night`);
    // Antenna mast at the panel spot vs the target's centre: close, not equal.
    near(out.direct_contact_pct, t.contact.direct_target * 100, 4, `${r.region} direct contact`);
    assert.ok(out.longest_blackout_with_relays_h <= out.longest_blackout_direct_h);
  }
});

test("size_power's default is the #1 target's kit, and compare ranks by it", async () => {
  for (const r of landing.regions) {
    const out = await runTool("size_power", { region: r.region });
    near(out.total_t, r.targets[0].power.total_t, 0.11, `${r.region} kit`);
    near(out.battery_t + out.array_t, out.total_t, 0.11, `${r.region} parts add up`);
  }
  const { ranked } = await runTool("compare", { metric: "kit_mass" });
  const want = [...landing.regions].sort((a, b) => a.targets[0].power.total_t - b.targets[0].power.total_t).map((r) => r.region);
  // Regions within 0.1 t of each other may swap; the first and last must hold.
  assert.equal(ranked[0].kit.total_t, r1(landing.regions.find((r) => r.region === want[0]).targets[0].power.total_t));
  assert.equal(ranked.at(-1).region, want.at(-1));
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i].kit.total_t >= ranked[i - 1].kit.total_t);
});

test("size_power responds to crew, stay and extra loads", async () => {
  const base = await runTool("size_power", { region: "Slater Plain" });
  const rover = await runTool("size_power", { region: "Slater Plain", extras: ["crewed_rover"] });
  const text = await runTool("size_power", { region: "Slater Plain", extras: "crewed rover" });
  assert.ok(rover.battery_t > base.battery_t);
  near(rover.load_kw - base.load_kw, 1.4, 0.01, "crewed rover adds 1.4 kW");
  assert.equal(text.load_kw, rover.load_kw, "\"crewed rover\" as text is one load, not two");
  assert.ok((await runTool("size_power", { region: "Slater Plain", crew: 6 })).total_t > base.total_t);
  assert.ok((await runTool("size_power", { region: "Slater Plain", days: 60 })).total_t < base.total_t);
  assert.ok(base.data_storage_gb > 0);
});

test("dark_periods agrees with region_conditions", async () => {
  for (const [region, start, days] of [["Haworth", "2026-01-01", 365], ["Slater Plain", "2026-06-01", 30], ["Mons Mouton", "2031-10-10", 90]]) {
    const c = await runTool("region_conditions", { region, start, days });
    const d = await runTool("dark_periods", { region, start, days });
    assert.equal(d.nights.longest[0]?.hours ?? 0, c.longest_night_h);
    assert.equal(d.blackouts.longest[0]?.hours ?? 0, c.longest_blackout_direct_h);
    assert.ok(d.nights.total_hours <= days * 24 + 1);
  }
});

test("compare: best and worst landing dates", async () => {
  const best = await runTool("compare", { metric: "longest_night", region: "Haworth", year: 2028, days: 30 });
  const worst = await runTool("compare", { metric: "longest_night", region: "Haworth", year: 2028, days: 30, order: "worst" });
  assert.equal(best.best_dates.length, 5);
  assert.ok(best.best_dates[0].longest_night_h <= best.best_dates[4].longest_night_h);
  assert.ok(worst.worst_dates[0].longest_night_h >= best.best_dates[0].longest_night_h);
  const days = best.best_dates.map((d) => Date.parse(d.start) / 86400e3);
  for (const a of days) for (const b of days) assert.ok(a === b || Math.abs(a - b) >= 30, "picks a stay apart");
  // The best date really is the best: no day of the year has a shorter longest night.
  for (const d of ["2028-01-15", "2028-04-01", "2028-07-04", "2028-12-01"]) {
    const c = await runTool("region_conditions", { region: "Haworth", start: d, days: 30 });
    assert.ok(c.longest_night_h >= best.best_dates[0].longest_night_h);
  }
  const k = await runTool("compare", { metric: "kit_mass", region: "Haworth", year: 2028, days: 30 });
  assert.equal(k.metric, "longest_night");
});

test("a stay that crosses into the next year still has Earth contact", async () => {
  const out = await runTool("region_conditions", { region: "Mons Mouton", start: "2026-06-01", days: 365 });
  assert.ok(out.direct_contact_pct > 0 && out.longest_blackout_with_relays_h >= 0);
  const two = await runTool("region_conditions", { region: "Mons Mouton", start: "2026-06-01", days: 365, height_m: 2 });
  assert.match(two.sun_at, /reference point/);
});

test("landing_targets", async () => {
  const mp = await runTool("landing_targets", { region: "Mons Mouton Plateau" });
  assert.equal(mp.targets.length, 3);
  const mpData = landing.regions.find((r) => r.region === "Mons Mouton Plateau");
  const nasaTop = mpData.targets.find((t) => t.nasa_rank === 1);
  assert.equal(mp.kit_ranking_vs_nasa_sunlight_ranking.saving_t,
    r1(nasaTop.power.total_t - mpData.targets[0].power.total_t));
  assert.equal((await runTool("landing_targets", { region: "Nobile Rim 1" })).kit_ranking_vs_nasa_sunlight_ranking.same_target, true);
  const one = await runTool("landing_targets", { region: "Haworth", rank: 7 });
  assert.equal(one.targets.length, 1);
  assert.equal(one.targets[0].rank, 7);
  for (const r of landing.regions) {
    const out = await runTool("landing_targets", { region: r.region, top: 10 });
    for (const t of out.targets) {
      assert.ok(t.landing_zone.share_under_10deg_pct >= 95);
      assert.ok(t.panel_spot.distance_from_target_m <= 200 && t.panel_spot.slope_deg < 20);
    }
  }
});

test("region names: ids, parts, typos, ambiguity, strangers", async () => {
  const name = async (q) => (await runTool("landing_targets", { region: q, top: 1 })).region;
  assert.equal(await name("artemis-ma"), "Malapert Massif");
  assert.equal(await name("malapert"), "Malapert Massif");
  assert.equal(await name("Malapart Masif"), "Malapert Massif");
  assert.equal(await name("Cabeus"), "Peak Near Cabeus B");
  assert.equal(await name("de-gerlache"), "de Gerlache Rim 2");
  assert.equal(await name("Mons Mouton"), "Mons Mouton");
  assert.equal(await name("mouton plateau"), "Mons Mouton Plateau");
  assert.equal(await name("Hayworth"), "Haworth");
  for (const q of ["Nobile Rim", "nobile", "mouton"]) assert.match((await runTool("landing_targets", { region: q })).error, /could be/);
  for (const q of ["Shackleton", "Apollo 11", "", "a", "the Moon"]) {
    assert.match((await runTool("region_conditions", { region: q, start: "2026-01-01" })).error, /No Artemis region|Which region/);
  }
  // landing_targets with no region: the #1 target of all nine.
  const all = await runTool("landing_targets", {});
  assert.equal(all.top_target_of_each_region.length, 9);
  assert.ok(all.top_target_of_each_region.every((t) => t.rank === 1 && t.kit.total_t > 0));
});

test("bad inputs are refused, not answered", async () => {
  const bad = [
    ["region_conditions", { region: "Haworth", start: "2025-06-01" }], ["region_conditions", { region: "Haworth", start: "2036-01-01" }],
    ["region_conditions", { region: "Haworth", start: "2026-02-30" }], ["region_conditions", { region: "Haworth", start: "June 1 2026" }],
    ["region_conditions", { region: "Haworth", start: "2026-06-01", days: 0 }], ["region_conditions", { region: "Haworth", start: "2026-06-01", days: 400 }],
    ["region_conditions", { region: "Haworth", start: "2026-06-01", days: 1.5 }], ["region_conditions", { region: "Haworth", start: "2026-06-01", height_m: 0 }],
    ["compare", { metric: "nights" }], ["compare", {}], ["compare", { metric: "kit_mass", start: "2040-01-01" }],
["compare", { metric: "sunlit", region: "Haworth", year: 2036 }],
    ["size_power", { region: "Haworth", crew: 0 }], ["size_power", { region: "Haworth", crew: 51 }], ["size_power", { region: "Haworth", extras: ["nuclear"] }],
    ["size_power", { region: "Haworth", start: "2036-02-01" }], ["landing_targets", { region: "Haworth", top: 0 }], ["landing_targets", { region: "Haworth", rank: 11 }],
    ["show_in_app", { region: "Haworth", target_rank: 99 }], ["show_in_app", { region: "Haworth", start: "soon" }],
    ["assumptions", { topic: "secrets" }], ["search_docs", { question: " " }], ["nope", {}],
  ];
  for (const [name, args] of bad) assert.ok((await runTool(name, args)).error, `${name} ${JSON.stringify(args)} should be an error`);
});

test("water_ice and assumptions", async () => {
  const ice = await runTool("water_ice", {});
  assert.equal(ice.regions.length, 9);
  const mm = await runTool("water_ice", { region: "Mons Mouton" });
  assert.equal(mm.regions[0].nearest_shadowed_area.distance_km, 6);
  assert.doesNotMatch(JSON.stringify(ice), /mSv|radiation/i);
  const loads = (await runTool("assumptions", { topic: "loads" })).groups[0].items.filter((i) => i.kind === "default load");
  const kw = loads.reduce((s, i) => s + i.value * (/per crew/.test(i.units) ? 4 : 1), 0) / 1000;
  assert.equal(kw, 10);
  assert.equal((await runTool("assumptions", { topic: "battery" })).groups[0].items[0].value, 150);
});

test("show_in_app sends the region and window to the page", async () => {
  const out = await runTool("show_in_app", { region: "Haworth", target_rank: 3, start: "2026-06-01", days: 14 });
  assert.deepEqual(out.dates_shown, { start: "2026-06-01", end: "2026-06-15" });
  assert.deepEqual(shown.at(-1), { siteId: "artemis-hw", region: "Haworth", rank: 3, range: out.dates_shown });
});

test("every tool has a schema the model can read", () => {
  for (const t of TOOLS) {
    assert.ok(t.description.length > 40 && t.parameters.type === "object");
    for (const req of t.parameters.required || []) assert.ok(t.parameters.properties[req], `${t.name}.${req}`);
  }
});

test("compare for a long stay shows the date matters little, and every year", async () => {
  const out = await runTool("compare", { metric: "longest_night", region: "Malapert Massif", year: 2031, days: 365 });
  assert.equal(out.same_stay_from_four_dates_in_the_year.length, 4);
  assert.equal(out.same_stay_landing_1_january_of_each_year.length, 10);
  const c = await runTool("region_conditions", { region: "Malapert Massif", start: "2031-01-01" });
  assert.equal(out.same_stay_from_four_dates_in_the_year[0].longest_night_h, c.longest_night_h);
});
