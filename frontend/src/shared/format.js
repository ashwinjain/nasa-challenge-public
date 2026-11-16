// Formatting and date helpers shared by the main app (index.html) and the
// Plan view (src/plan/). All dates are "YYYY-MM-DD" in UTC.

export const DAY_MS = 24 * 3600 * 1000;

// A length of time: hours under two days, days after. `digits` sets the
// decimals on the hours (the main app's tiles show one).
export function fmtHours(h, digits = 0) {
  if (h < 48) return `${digits ? h.toFixed(digits) : Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export const dateToMs = (iso) => Date.parse(iso + "T00:00:00Z");
export const msToDate = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, n) => msToDate(dateToMs(iso) + n * DAY_MS);
export const daysBetween = (a, b) => (dateToMs(b) - dateToMs(a)) / DAY_MS;

// A power kit's rows: battery and total in tonnes (one decimal), the array in
// kg. The total is worked out from the parts as shown (battery as shown plus
// the array), so the rows visibly add up.
export function kitTonnes(batteryT, arrayT) {
  const b = Math.round(batteryT * 10) / 10;
  const aKg = Math.round(arrayT * 1000);
  const total = Math.round((b + aKg / 1000) * 10) / 10;
  return { battery: `${b.toFixed(1)} t`, array: `${aKg.toLocaleString("en-US")} kg`, total: `${total.toFixed(1)} t`, totalT: total };
}
