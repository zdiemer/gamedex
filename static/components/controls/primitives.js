"use strict";

// Shared controls. Escape labels and attributes; callers own actions and state.

/**
 * @component Render a text action button; use an anchor for navigation.
 * @param {string|number} label - Visible text; nullish values become an empty label.
 * @param {Object} [options={}] - Optional button attributes.
 * @param {string} [options.id=""] - Unique ID for caller wiring.
 * @param {"default"|"ghost"|"danger"} [options.variant="default"] - Unknown variants throw TypeError.
 * @param {boolean} [options.disabled=false] - Native disabled state.
 * @param {string} [options.title=""] - Optional tooltip.
 * @returns {string} HTML for a type="button" control.
 * @requires escapeHtml from foundations/core.js; shared .btn styles.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Text and attribute values are escaped; do not pass markup as labels.
 * @example
 * host.innerHTML = buttonHtml("Save", { id: "save", disabled: busy });
 * host.querySelector("#save").onclick = save;
 */
function buttonHtml(label, { id = "", variant = "default", disabled = false, title = "" } = {}) {
  const variants = { default: "btn", ghost: "btn ghost", danger: "btn danger" };
  if (!Object.hasOwn(variants, variant)) throw new TypeError(`Unknown button variant: ${variant}`);
  return `<button type="button" class="${variants[variant]}"${id ? ` id="${escapeHtml(String(id))}"` : ""}${title ? ` title="${escapeHtml(String(title))}"` : ""}${disabled ? " disabled" : ""}>${escapeHtml(String(label ?? ""))}</button>`;
}

/**
 * @component Render metadata or a delegated facet chip.
 * @param {string|number} value - Chip text and facet value; nullish values become empty.
 * @param {Object} [options={}] - Chip options.
 * @param {string} [options.facet=""] - Facet key; empty renders a non-interactive span.
 * @returns {string} Chip span, with data-fk/data-fv when a facet is provided.
 * @requires escapeHtml; .chip styles; app facet delegation for interactive chips.
 * @events Facet clicks are handled by app delegation, not this builder.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Text and attribute values are escaped; do not pass markup as labels.
 * @example
 * chipHtml("Adventure", { facet: "genre" });
 */
function chipHtml(value, { facet = "" } = {}) {
  const text = escapeHtml(String(value ?? ""));
  return facet
    ? `<span class="chip facet-link" data-fk="${escapeHtml(String(facet))}" data-fv="${text}">${text}</span>`
    : `<span class="chip">${text}</span>`;
}

/**
 * @component Wrap a collection of metadata or facet chips.
 * @param {Array<string|number>|null} arr - Chip values; absent or empty returns an empty string.
 * @param {string} [fk] - Optional facet key shared by every chip.
 * @returns {string} A .chips wrapper or an empty string.
 * @requires chipHtml from this file.
 * @events Delegated facet behavior is inherited from chipHtml.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Text and attribute values are escaped; do not pass markup as labels.
 * @example
 * chips(["Adventure", "Puzzle"], "genre");
 */
function chips(arr, fk) {
  return arr && arr.length
    ? `<div class="chips">${arr.map((value) => chipHtml(value, { facet: fk })).join("")}</div>` : "";
}

/**
 * @component Render an empty-results message with an optional action.
 * @param {string} title - Main message.
 * @param {string} hint - Supporting message.
 * @param {string|null} [action] - Action label; omitted or empty hides the button.
 * @param {Object} [options={}] - Action options.
 * @param {string} [options.actionId="emptyAction"] - Use a unique ID when multiple empty states coexist.
 * @returns {string} Empty-state HTML.
 * @requires icon, escapeHtml, buttonHtml; i-library sprite symbol and .empty styles.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Text and attribute values are escaped; do not pass markup as labels.
 * @example
 * host.innerHTML = emptyState("No games", "Try another filter.", "Reset", { actionId: "resetFilters" });
 * host.querySelector("#resetFilters").onclick = resetFilters;
 */
function emptyState(title, hint, action, { actionId = "emptyAction" } = {}) {
  return `<div class="empty">
    <div class="empty-art">${icon("i-library", 40)}</div>
    <h3>${escapeHtml(String(title ?? ""))}</h3>
    <p>${escapeHtml(String(hint ?? ""))}</p>
    ${action ? buttonHtml(action, { id: actionId }) : ""}
  </div>`;
}
