// Site list for "Pick a site → when?". Click a name to chart it (it also
// becomes the 3D view's selected site); tick the box to add that site's stay
// to Compare. Lists only sites with planning data (the polar ones).

// ctx: { data, selectedId, onSelect(siteId),
//        stayFor(siteId) → stay, isPinned(stay) → bool, onPin(stay), onUnpin(stay) }
export function renderSiteList(el, ctx) {
  const prevScroll = el.scrollTop;   // keep place on re-render
  el.innerHTML = ctx.data.sites.map((s) => {
    const pinned = ctx.isPinned(ctx.stayFor(s.id));
    return `<div class="site-row${s.id === ctx.selectedId ? " active" : ""}${pinned ? " pinned" : ""}" data-site="${s.id}">
        <input type="checkbox" class="compare-cb" data-site="${s.id}"${pinned ? " checked" : ""} title="Compare" aria-label="Compare ${s.name}">
        <button class="site-pick" data-site="${s.id}" title="${s.name}">${s.name}</button>
      </div>`;
  }).join("");
  el.scrollTop = prevScroll;
  // Keep the charted site visible (e.g. on first load, or after picking it elsewhere).
  const active = el.querySelector(".site-row.active");
  if (active && (active.offsetTop < el.scrollTop || active.offsetTop + active.offsetHeight > el.scrollTop + el.clientHeight)) {
    el.scrollTop = active.offsetTop - el.clientHeight / 2 + active.offsetHeight / 2;
  }
  el.querySelectorAll(".site-pick").forEach((b) =>
    b.addEventListener("click", () => ctx.onSelect(b.dataset.site)));
  el.querySelectorAll(".compare-cb").forEach((cb) =>
    cb.addEventListener("change", () => {
      const stay = ctx.stayFor(cb.dataset.site);
      if (cb.checked) {
        cb.checked = false;          // re-render sets it if the pin was accepted
        ctx.onPin(stay);
      } else {
        ctx.onUnpin(stay);
      }
    }));
}
