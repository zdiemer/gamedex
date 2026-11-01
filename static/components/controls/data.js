"use strict";

// UI components for data.js. Feature state and orchestration remain in that module.

/* One search field. There were three — the top bar, Groupings and Reviews — each
   styled separately and drifting apart. Same markup everywhere now, so the icon,
   the height, the radius and the focus ring can't disagree. */
/**
 * @component Render a search input with the shared search icon.
 * @param {string} id - Trusted, unique input ID.
 * @param {string} placeholder - Escaped placeholder text.
 * @param {string|number} [value=""] - Initial field value.
 * @param {string} [cls=""] - Trusted wrapper classes.
 * @returns {string} A .field wrapper and type="search" input.
 * @requires escapeHtml; i-search sprite symbol and .field styles.
 * @events Caller wires input/change events and supplies an accessible label; placeholder alone is not a label.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping placeholder and value are escaped. id and cls are interpolated unchanged and must be application constants.
 * @example
 * host.innerHTML = '<label for="gameQuery">Search games</label>' + searchField("gameQuery", "Title…");
 */
function searchField(id, placeholder, value = "", cls = "") {
  return `<span class="field ${cls}">
    <svg class="ico" width="15" height="15" aria-hidden="true"><use href="#i-search"/></svg>
    <input id="${id}" type="search" placeholder="${escapeHtml(placeholder)}"
      value="${escapeHtml(String(value))}" autocomplete="off" spellcheck="false">
  </span>`;
}
