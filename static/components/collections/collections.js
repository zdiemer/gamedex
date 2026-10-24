"use strict";

// UI components for collections.js. Feature state and orchestration remain in that module.

// ---- rendering -----------------------------------------------------------

// Card badge: "🗂 6 games" (yellow while the compilation is unfinished).
function collectionBadgeHtml(row) {
  const c = collectionOf(row);
  if (!c) return "";
  const n = c.members.length;
  return `<span class="card-collection${c.complete ? "" : " partial"}">🗂 ${n} game${n !== 1 ? "s" : ""}</span>`;
}

// Drawer section: the games inside the collection, or a way back up to it.
function collectionSectionHtml(row) {
  const own = collectionOf(row);
  if (own) {
    const rows = own.members.map((m, i) => {
      const bits = [m.platform, m.date ? fmtDate(m.date) : null].filter(Boolean)
        .map((x) => escapeHtml(String(x))).join(" · ");
      const rating = m.rating != null
        ? `<span class="${ratingClass(m.rating)}">${Math.round(m.rating * 100)}%</span>` : "";
      const time = m.playTime != null ? `<span class="muted">${fmtHours(m.playTime)}</span>` : "";
      return `<button class="col-member" data-ci="${escapeHtml(own.id)}" data-mi="${i}">
        <span class="col-member-txt"><b>${escapeHtml(String(m.game))}</b><span class="muted">${bits}</span></span>
        ${time}${rating}</button>`;
    }).join("");
    const state = own.complete
      ? `<span class="col-state done">✓ Collection complete</span>`
      : `<span class="col-state partial">◐ Partially finished — the compilation isn't marked complete</span>`;
    return `<div class="col-section"><h3>🗂 In this collection <span class="muted">${own.members.length}</span></h3>
      ${state}<div class="col-members">${rows}</div></div>`;
  }

  const of = collectionOfMember(row);
  if (of) {
    return `<div class="col-section"><h3>🗂 Part of a collection</h3>
      <button class="col-parent" data-ci="${escapeHtml(of.id)}">
        <span>${escapeHtml(of.name)}</span>
        <span class="muted">${of.members.length} game${of.members.length !== 1 ? "s" : ""} finished →</span>
      </button></div>`;
  }
  return "";
}
