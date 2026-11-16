// Re-size a /api/power result for a custom crew or water recycling, in the
// page, without asking the server again.
//
// Why this is exact, not an estimate:
//  - Supplies: crew × days × the per-crew-day rates, the same arithmetic as
//    crew_supplies() in lunarsky/power.py.
//  - Tonnage: array + battery only (supplies are shown, not counted).
// Stay length, panel height and the load list change the Sun track, the
// skyline or the day/night split of the load, so those go to the server.
//
// custom: { crew, recycle } — any left out keep the result's value.

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function customize(r, custom = {}) {
  if (!r || r.error || !r.feasible || !r.verdict?.ok || !r.inputs) return r;
  const out = { ...r, best: { ...r.best }, mission: { ...r.mission } };
  if (r.supplies) {
    const crew = custom.crew ?? r.supplies.crew;
    const rec = custom.recycle ?? r.supplies.water_recovery ?? 0;
    out.supplies = supplies(r.inputs.rates, crew, r.supplies.days, rec);
    out.mission.crew = crew;
  }
  out.verdict = verdict(out);
  return out;
}

// Mirrors crew_supplies() in lunarsky/power.py.
export function supplies(rates, crew, days, rec) {
  const pad = 1 / (1 - rates.supplies_margin);
  const per = {
    oxygen_kg: rates.o2_per_crew,
    water_kg: rates.water_drink_per_crew * (1 - rec),
    food_kg: rates.food_per_crew,
  };
  const out = {};
  for (const [key, v] of Object.entries(per)) out[key] = round(v * crew * days * pad);
  out.total_kg = round(out.oxygen_kg + out.water_kg + out.food_kg);
  return { ...out, crew, days, margin: rates.supplies_margin, water_recovery: rec };
}

// Mirrors verdict() in lunarsky/power.py for a feasible result: the tonnage
// to land and its biggest item.
function verdict(r) {
  const parts = { battery: r.best.battery_kg, "solar array": r.best.array_kg };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  let driver = null;
  for (const [name, kg] of Object.entries(parts)) if (driver === null || kg > parts[driver]) driver = name;
  const breakdown = Object.fromEntries(Object.entries(parts).map(([n, kg]) => [n, round(kg)]));
  return { ok: true, total_kg: round(total), breakdown_kg: breakdown, driver, text: r.verdict.text };
}
