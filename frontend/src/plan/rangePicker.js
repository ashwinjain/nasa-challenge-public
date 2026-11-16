// A date range in one calendar: click the landing day, then the last day.
// Used by "Pick a date → where?" in place of two separate date inputs.
//
// renderRangeField(el, { from, to, min, maxStart, maxEnd, maxDays, onPick(from, to) })
// draws a button showing the range into `el`; clicking it opens a two-month
// calendar as a popover. Dates are "YYYY-MM-DD" in UTC (shared/format.js).
// The popover is position: fixed on <body>, so the top bar's overflow
// doesn't clip it.
import { dateToMs, msToDate, addDays, daysBetween } from "../shared/format.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const fmt = (iso, withYear) => new Date(dateToMs(iso)).toLocaleDateString("en-US",
  { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });

export function rangeLabel(from, to) {
  const days = daysBetween(from, to);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmt(from, !sameYear)} – ${fmt(to, true)} · ${days} d`;
}

let open = null;   // the one open popover: { pop, close }

export function renderRangeField(el, opts) {
  el.innerHTML = `<button type="button" class="plan-input range-field" aria-haspopup="dialog">${rangeLabel(opts.from, opts.to)}</button>`;
  const btn = el.querySelector("button");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (open && open.anchor === btn) { open.close(); return; }
    openPicker(btn, opts);
  });
  // The page re-renders its top bar while you pick (e.g. when power results
  // arrive): keep the open calendar and hang it on the new button.
  if (open && open.fieldId === el.id) open.reattach(btn);
}

function openPicker(anchor, { from, to, min, maxStart, maxEnd, maxDays, onPick }) {
  const fieldId = anchor.parentElement?.id;
  if (open) open.close();
  // First month shown: the current landing month.
  let view = { y: Number(from.slice(0, 4)), m: Number(from.slice(5, 7)) - 1 };
  let start = from, end = to;     // what's drawn; `end` is null mid-pick
  let hover = null;

  const pop = document.createElement("div");
  pop.className = "range-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Pick the stay's dates");
  document.body.appendChild(pop);

  const lastEnd = (s) => {
    const cap = addDays(s, maxDays);
    return cap < maxEnd ? cap : maxEnd;
  };
  // Can this day be clicked right now?
  const enabled = (iso) => {
    if (end === null) {
      // Picking the end: after the start, within the longest stay. A day
      // before the start (still a valid landing day) restarts from there.
      return (iso >= start && iso <= lastEnd(start)) || (iso >= min && iso <= maxStart && iso < start);
    }
    return iso >= min && iso <= maxStart;
  };

  const monthHtml = (y, m) => {
    const first = Date.UTC(y, m, 1);
    const lead = (new Date(first).getUTCDay() + 6) % 7;     // Monday first
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const shownEnd = end ?? (hover && hover > start && hover <= lastEnd(start) ? hover : null);
    let cells = "";
    for (let i = 0; i < lead; i++) cells += `<span></span>`;
    for (let d = 1; d <= n; d++) {
      const iso = msToDate(Date.UTC(y, m, d));
      const cls = ["day"];
      if (iso === start) cls.push("start");
      if (shownEnd && iso === shownEnd) cls.push("end");
      if (shownEnd && iso > start && iso < shownEnd) cls.push("in");
      if (!enabled(iso)) cls.push("off");
      cells += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}"${cls.includes("off") ? " disabled" : ""}>${d}</button>`;
    }
    return `<div class="range-month"><div class="range-title">${MONTHS[m]} ${y}</div>
      <div class="range-grid">${WEEKDAYS.map((w) => `<i>${w}</i>`).join("")}${cells}</div></div>`;
  };

  const minMonth = Number(min.slice(0, 4)) * 12 + Number(min.slice(5, 7)) - 1;
  const maxMonth = Number(maxEnd.slice(0, 4)) * 12 + Number(maxEnd.slice(5, 7)) - 1;
  const draw = () => {
    const idx = view.y * 12 + view.m;
    const next = { y: Math.floor((idx + 1) / 12), m: (idx + 1) % 12 };
    const hint = end === null
      ? `Landing ${fmt(start)} · now pick the last day (up to ${maxDays} days)`
      : `${rangeLabel(start, end)} · click a day to pick a new landing day`;
    pop.innerHTML = `
      <div class="range-nav">
        <button type="button" class="range-step" data-step="-1" ${idx <= minMonth ? "disabled" : ""} aria-label="Previous month">‹</button>
        <button type="button" class="range-step" data-step="1" ${idx + 1 >= maxMonth ? "disabled" : ""} aria-label="Next month">›</button>
      </div>
      <div class="range-months">${monthHtml(view.y, view.m)}${monthHtml(next.y, next.m)}</div>
      <div class="range-hint">${hint}</div>`;
  };

  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.top = `${r.bottom + 6}px`;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  };

  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const step = e.target.closest("[data-step]");
    if (step) {
      const idx = view.y * 12 + view.m + Number(step.dataset.step);
      view = { y: Math.floor(idx / 12), m: idx % 12 };
      draw();
      return;
    }
    const day = e.target.closest(".day:not(.off)");
    if (!day) return;
    const iso = day.dataset.iso;
    if (end === null && iso > start) {
      end = iso;
      draw();
      onPick(start, end);
      close();
      return;
    }
    start = iso;          // a new landing day; wait for the last day
    end = null;
    hover = null;
    draw();
  });
  pop.addEventListener("mouseover", (e) => {
    if (end !== null) return;
    const day = e.target.closest(".day");
    const iso = day ? day.dataset.iso : null;
    if (iso === hover) return;
    hover = iso;
    draw();
  });

  const onDoc = () => close();
  // Capture Escape before the app's own handler (which closes the Plan view).
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    e.preventDefault();
    close();
  };
  const onResize = () => place();
  function close() {
    pop.remove();
    document.removeEventListener("click", onDoc);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    anchor.classList.remove("open");
    if (open && open.pop === pop) open = null;
  }
  document.addEventListener("click", onDoc);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  anchor.classList.add("open");
  open = {
    pop, anchor, fieldId, close,
    reattach(btn) {
      anchor = btn;
      open.anchor = btn;
      btn.classList.add("open");
      place();
    },
  };
  draw();
  place();
}

// Close any open calendar (e.g. when the Plan view closes or re-renders).
export function closeRangePicker() {
  if (open) open.close();
}
