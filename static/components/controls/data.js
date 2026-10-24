"use strict";

// UI components for data.js. Feature state and orchestration remain in that module.

/* One search field. There were three — the top bar, Groupings and Reviews — each
   styled separately and drifting apart. Same markup everywhere now, so the icon,
   the height, the radius and the focus ring can't disagree. */
function searchField(id, placeholder, value = "", cls = "") {
  return `<span class="field ${cls}">
    <svg class="ico" width="15" height="15" aria-hidden="true"><use href="#i-search"/></svg>
    <input id="${id}" type="search" placeholder="${escapeHtml(placeholder)}"
      value="${escapeHtml(String(value))}" autocomplete="off" spellcheck="false">
  </span>`;
}
