// Array + battery sizing in the browser: a port of size_power(),
// battery_needed_wh() and size_on_track() in lunarsky/power.py, so the power
// panel can re-size for any dates, crew or load list without a server.
//
// Input is the hourly Sun at the panel, which is all the Python uses:
//   frac      share of the Sun's disk above the skyline (0–1), per sample
//   sunEl     Sun elevation (degrees), per sample
//   sunDistKm Sun distance (km), per sample
// and the assumptions (assumptions.csv values by id).
//
// tests/test_power_js.py runs real site tracks through both and checks that
// every option's array, battery and total mass match.

export const AU_KM = 149_597_870.7;
export const DARK_BELOW = 0.5;   // lunarsky/sky.py: dark = less than half the disk showing
// Bigger arrays than break-even, each with a smaller battery (power.py ARRAY_MULTIPLIERS).
export const ARRAY_MULTIPLIERS = [1.05, 1.1, 1.25, 1.5, 2.0, 3.0, 5.0];

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/** Array output per m² facing the Sun at 1 AU. */
export function arrayWattsPerM2(a) {
  return a.solar_constant * a.cell_efficiency * a.array_packing;
}

/** Hours in the longest run of true (lunarsky/metrics.py longest_run_hours). */
export function longestRunHours(mask, stepHours) {
  let best = 0, run = 0;
  for (let i = 0; i < mask.length; i++) {
    run = mask[i] ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best * stepHours;
}

/**
 * Usable battery energy (Wh) so the store, starting full, never runs out.
 * gen: array output per sample (W); load: a number or one value per sample.
 * repeat: the series runs year after year (twice, so a shortfall at the end
 * carries into the start; Infinity if it doesn't break even). Otherwise a
 * one-off stay that starts with a full battery.
 */
export function batteryNeededWh(gen, load, stepHours, roundTrip, repeat = true) {
  const n = gen.length;
  const loadAt = typeof load === "number" ? () => load : (i) => load[i];
  const net = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    let v = (gen[i] - loadAt(i)) * stepHours;
    if (v > 0) v *= roundTrip;   // charging loses energy
    net[i] = v;
    sum += v;
  }
  if (repeat && sum < 0) return Infinity;
  // Shortfall after each step: running total of draws minus its lowest point
  // so far (floored at 0), the same as the Python's cumsum form.
  const passes = repeat ? 2 : 1;
  let draws = 0, low = 0, worst = 0;
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      draws -= net[i];
      low = Math.min(low, draws, 0);
      worst = Math.max(worst, draws - low);
    }
  }
  return Math.max(0, worst);
}

/**
 * Size the array and battery for a steady alwaysW plus dayW that runs only
 * while it isn't dark. sunShare: share of full output per sample (disk
 * fraction × cos elevation); sunScale: sunlight relative to 1 AU (1/d²).
 * Mirrors size_power() in lunarsky/power.py, returning the same fields.
 */
export function sizePower(sunShare, sunScale, alwaysW, a,
  { stepHours = 1, repeat = true, dark = null, dayW = 0, contactW = 0, contact = null } = {}) {
  const n = sunShare.length;
  const rt = a.storage_round_trip;
  const wPerM2 = arrayWattsPerM2(a);
  const perM2 = new Float64Array(n);
  const isDark = new Uint8Array(n);
  const load = new Float64Array(n);
  let litCount = 0, shareSum = 0, minLit = Infinity, maxLoad = 0, contactCount = 0;
  for (let i = 0; i < n; i++) {
    perM2[i] = wPerM2 * sunScale[i] * sunShare[i];
    const lit = sunShare[i] > 0;
    if (lit) litCount++;
    shareSum += sunShare[i];
    isDark[i] = dark ? (dark[i] ? 1 : 0) : (lit ? 0 : 1);
    // The radio (contactW) runs only while in contact; with no mask, always.
    const inContact = contact ? (contact[i] ? 1 : 0) : 1;
    contactCount += inContact;
    load[i] = alwaysW + dayW * (isDark[i] ? 0 : 1) + contactW * inContact;
    if (load[i] > maxLoad) maxLoad = load[i];
    if (perM2[i] > 0 && perM2[i] < minLit) minLit = perM2[i];
  }
  const anyLit = litCount > 0;
  const longestDark = longestRunHours(isDark, stepHours);
  const out = {
    load_w: alwaysW + dayW + contactW, always_w: alwaysW, day_w: dayW, contact_w: contactW,
    contact_fraction: n ? contactCount / n : 0,
    step_hours: stepHours, hours: n * stepHours,
    sunlit_fraction: n ? litCount / n : 0,
    avg_sun_share: n ? shareSum / n : 0,
    longest_dark_hours: longestDark,
    repeat,
    array_w_per_m2: round(wPerM2, 1),
  };
  if (!anyLit && repeat) {
    return { ...out, feasible: false, reason: "the Sun never rises at the panel in this window" };
  }

  // Break-even area: energy stored after losses equals energy used. Stored
  // grows and used shrinks with the area, so bisect (60 steps, as in Python).
  const balance = (area) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const v = area * perM2[i] - load[i];
      s += v > 0 ? v * rt : v;
    }
    return s;
  };
  let areaMin = 0;
  if (anyLit) {
    let lo = 0, hi = Math.max(maxLoad, 1e-9) / minLit * 10;
    while (balance(hi) < 0) hi *= 2;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (balance(mid) < 0) lo = mid; else hi = mid;
    }
    areaMin = hi;
  }

  const multiples = anyLit ? [...ARRAY_MULTIPLIERS] : [];
  if (!repeat) multiples.unshift(0);   // battery only, no array
  const gen = new Float64Array(n);
  const options = multiples.map((m) => {
    const area = areaMin * m;
    for (let i = 0; i < n; i++) gen[i] = area * perM2[i];
    const usableWh = batteryNeededWh(gen, load, stepHours, rt, repeat);
    const ratedW = area * wPerM2;
    const battWh = usableWh / a.battery_dod;
    const arrayKg = ratedW * a.array_specific_mass;
    const battKg = battWh / a.battery_specific_energy;
    return {
      array_multiple: m,
      array_m2: round(area, 2),
      array_rated_w: round(ratedW, 1),
      array_kg: round(arrayKg, 1),
      battery_kwh: round(battWh / 1000, 2),
      battery_kg: round(battKg, 1),
      total_kg: round(arrayKg + battKg, 1),
    };
  });
  const best = options.reduce((b, o) => (o.total_kg < b.total_kg ? o : b));
  // For comparison: the simple estimate that ignores recharge time.
  const simpleWh = alwaysW * longestDark / (a.battery_dod * rt);
  return {
    ...out, feasible: true,
    break_even_m2: round(areaMin, 2),
    options, best,
    simple_battery_kwh: round(simpleWh / 1000, 2),
  };
}

/**
 * Array + battery for a mission against an hourly Sun track at the panel.
 * prof: { always_w, day_w, contact_w, days } (the mission's load list and stay).
 * contact: per sample, direct contact with Earth (the radio line runs only
 * then); null runs it always.
 * Mirrors size_on_track() in lunarsky/power.py: the power margin pads the
 * load, a stay of a year or more repeats, dark is under half the disk.
 */
export function sizeOnTrack({ frac, sunEl, sunDistKm, contact = null }, prof, a, stepHours = 1) {
  const n = frac.length;
  const share = new Float64Array(n);
  const scale = new Float64Array(n);
  const dark = new Uint8Array(n);
  let fracSum = 0;
  for (let i = 0; i < n; i++) {
    const el = Math.min(90, Math.max(-90, sunEl[i]));
    share[i] = frac[i] * Math.cos(el * Math.PI / 180);
    scale[i] = (AU_KM / sunDistKm[i]) ** 2;
    dark[i] = frac[i] < DARK_BELOW ? 1 : 0;
    fracSum += frac[i];
  }
  const margin = a.power_margin;
  const pad = 1 / (1 - margin);
  const res = sizePower(share, scale, prof.always_w * pad, a, {
    stepHours, repeat: prof.days >= 365, dark, dayW: prof.day_w * pad,
    contactW: (prof.contact_w || 0) * pad, contact,
  });
  const loadW = prof.always_w + prof.day_w + (prof.contact_w || 0);
  return {
    ...res,
    load_w: loadW, always_w: prof.always_w, day_w: prof.day_w, contact_w: prof.contact_w || 0,
    sized_load_w: round(loadW * pad, 1), power_margin: margin,
    // Sunlit = share of the Sun the panel sees, averaged over the stay.
    sunlit_fraction: n ? round(fracSum / n, 4) : 0,
    ...(contact ? { data: dataBacklog(contact, a, stepHours, prof.days >= 365) } : {}),
  };
}

/**
 * On-board storage to hold data through Earth blackouts. Mirrors
 * data_backlog() in lunarsky/power.py: data piles up at a.data_per_day (Gb)
 * and drains at a.downlink_rate (Mbps) while in contact; the largest pile
 * is the storage needed. No extra battery: the radio line already draws for
 * every contact hour.
 */
export function dataBacklog(contact, a, stepHours = 1, repeat = true) {
  const n = contact.length;
  const gen = (a.data_per_day / 24) * stepHours;
  const drain = (a.downlink_rate * 3600 * stepHours) / 1000;
  let pile = 0, worst = 0, run = 0, longest = 0;
  for (let i = 0; i < n * (repeat ? 2 : 1); i++) {
    const on = !!contact[i % n];
    pile += gen;
    if (on) pile = Math.max(0, pile - drain);
    if (pile > worst) worst = pile;
    if (i < n) { if (!on) { if (++run > longest) longest = run; } else run = 0; }
  }
  return {
    data_per_day_gb: a.data_per_day, downlink_mbps: a.downlink_rate,
    storage_gb: round(worst / 8, 1),
    longest_blackout_hours: longest * stepHours,
  };
}
