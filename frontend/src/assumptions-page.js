// The Assumptions page (assumptions.html): every assumption from
// shared/assumptions.js, grouped by section, numbered so people can ask
// about "assumption 12".

import { SECTIONS } from "./shared/assumptions.js";

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function item(a) {
  const sources = (a.sources || []).map((s) =>
    `<a class="ap-src" href="${esc(s.url)}" target="_blank" rel="noopener">Source: ${esc(s.label)} ↗</a>`).join("");
  return `<article class="ap-item" id="a${a.n}">
    <h3><span class="ap-n">${a.n}</span>${esc(a.title)}${a.ours ? ' <span class="ap-ours">Our choice</span>' : ""}</h3>
    <p>${esc(a.body)}</p>
    <dl>
      <dt>Leaves out</dt><dd>${esc(a.costs)}</dd>
      <dt>Why</dt><dd>${esc(a.why)}</dd>
    </dl>
    ${sources}
  </article>`;
}

document.getElementById("ap-nav").innerHTML = SECTIONS
  .map((s) => `<a href="#${slug(s.title)}">${esc(s.title)}</a>`).join("");
document.getElementById("ap-list").innerHTML = SECTIONS
  .map((s) => `<section class="ap-sec" id="${slug(s.title)}"><h2>${esc(s.title)}</h2><div class="ap-grid">${s.items.map(item).join("")}</div></section>`)
  .join("");
// The list is drawn after load, so jump to #a12 (or a section) once it's there.
if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
