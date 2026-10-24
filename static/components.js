"use strict";

/* Gamedex UI primitives. Load after core.js, before feature scripts.
   Styles and theme tokens live in style.css; inventory: docs/components.md.
   HTML builders escape data. Dialogs in components/dialog.js own overlay lifecycle and dismissal;
   features own business state and actions. */

function buttonHtml(label, { id = "", variant = "default", disabled = false, title = "" } = {}) {
  const variants = { default: "btn", ghost: "btn ghost", danger: "btn danger" };
  if (!Object.hasOwn(variants, variant)) throw new TypeError(`Unknown button variant: ${variant}`);
  return `<button type="button" class="${variants[variant]}"${id ? ` id="${escapeHtml(String(id))}"` : ""}${title ? ` title="${escapeHtml(String(title))}"` : ""}${disabled ? " disabled" : ""}>${escapeHtml(String(label ?? ""))}</button>`;
}

// Facet chips keep the existing delegated .facet-link / data-fk / data-fv contract.
function chipHtml(value, { facet = "" } = {}) {
  const text = escapeHtml(String(value ?? ""));
  return facet
    ? `<span class="chip facet-link" data-fk="${escapeHtml(String(facet))}" data-fv="${text}">${text}</span>`
    : `<span class="chip">${text}</span>`;
}

function chips(arr, fk) {
  return arr && arr.length
    ? `<div class="chips">${arr.map((value) => chipHtml(value, { facet: fk })).join("")}</div>` : "";
}

// Existing positional API remains compatible. Override actionId when rendering
// more than one actionable empty state; the listing delegates to #emptyAction.
function emptyState(title, hint, action, { actionId = "emptyAction" } = {}) {
  return `<div class="empty">
    <div class="empty-art">${icon("i-library", 40)}</div>
    <h3>${escapeHtml(String(title ?? ""))}</h3>
    <p>${escapeHtml(String(hint ?? ""))}</p>
    ${action ? buttonHtml(action, { id: actionId }) : ""}
  </div>`;
}
