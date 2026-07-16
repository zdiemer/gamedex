"use strict";

/* The bottom of the stack: config, the state every tab reads, and the helpers
   that everything else is written in ($, icon, glyph, escapeHtml, fmtCell).

   Loads first, and depends on nothing. Everything in static/ -- the files split
   out of app.js and the feature files after them -- assumes these globals exist,
   so this is the one file whose position in index.html is not negotiable. */

// ---- config -------------------------------------------------------------
let PAGE_SIZE = 50;
// How each tab presents its rows. This is PER TAB: one shared global meant the
// Completed tab's timeline followed you onto other tabs and rendered there.
//   view    — "table" | "grid" | "timeline" (Completed only)
//   combine — fold rows that are the same IGDB game into one entry. No longer a
//             user toggle: it's the default everywhere EXCEPT Completed, where
//             every finished game (each episode of a series included) stands on
//             its own. Orthogonal to the view: a list combines just as a grid does.
const VIEW_DEFAULT = { games: "grid", completed: "timeline", onOrder: "grid" };
const COMBINE_DEFAULT = { games: true, completed: false, onOrder: true };
const FACET_CAP = 12;              // values shown before "show more"
const FACET_FILTER_THRESHOLD = 12; // show a per-facet search box past this many values

// ---- state --------------------------------------------------------------
let DATA = null;            // {meta, sheets}
let activeTab = "home";
const TABS = ["games", "completed", "onOrder"];
// Per-tab UI state, isolated so switching tabs preserves filters.
const tabState = {};
// Filters/search/sort/page — wiped when you navigate to a tab afresh.
const freshState = () => ({ search: "", facets: {}, expanded: {}, sort: null, page: 1 });
// View/combine are display PREFERENCES, not filters: they survive a tab switch.
for (const t of TABS) {
  tabState[t] = { ...freshState(), view: VIEW_DEFAULT[t], combine: COMBINE_DEFAULT[t] };
}
const viewOf = () => tabState[activeTab].view;
const combineOn = () => tabState[activeTab].combine;

const $ = (sel) => document.querySelector(sel);

/* Icons. `icon("i-play")` -> inline SVG that inherits currentColor.
   `glyph(v)` renders an icon id if it looks like one, and otherwise passes the
   value straight through — because a custom challenge's icon is an emoji YOU
   chose, and that's data, not chrome. */
const icon = (id, size = 16) =>
  `<svg class="ico" width="${size}" height="${size}" aria-hidden="true"><use href="#${id}"/></svg>`;
const glyph = (v, size = 16) =>
  (typeof v === "string" && v.startsWith("i-")) ? icon(v, size) : `<span class="emo">${v || ""}</span>`;


// ---- formatting ---------------------------------------------------------
function fmtHours(h) {
  const total = Math.round(h * 60);
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  if (hrs && mins) return `${hrs}h ${mins}m`;
  if (hrs) return `${hrs}h`;
  return `${mins}m`;
}
function fmtDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function ratingClass(v) {
  return v >= 0.8 ? "rating-good" : v >= 0.6 ? "rating-mid" : "rating-bad";
}

// Returns an HTML string for a cell value given its column type.
function fmtCell(value, type) {
  if (value === undefined || value === null || value === "") return `<span class="muted">—</span>`;
  switch (type) {
    case "rating":
      return `<span class="${ratingClass(value)}">${Math.round(value * 100)}%</span>`;
    case "bool":
      return value ? `<span class="yes">Yes</span>` : `<span class="no">No</span>`;
    case "hours":
      return fmtHours(value);
    case "date":
      return escapeHtml(fmtDate(value));
    case "number":
      return typeof value === "number" ? escapeHtml(value.toLocaleString()) : escapeHtml(String(value));
    case "money":
      return typeof value === "number"
        ? "$" + escapeHtml(value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        : escapeHtml(String(value));
    default:
      return escapeHtml(String(value));
  }
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
