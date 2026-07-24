"use strict";

/* The bottom of the stack: config, the state every tab reads, and the helpers
   that everything else is written in ($, icon, glyph, escapeHtml, fmtCell).

   Loads first, and depends on nothing. Everything in static/ -- the files split
   out of app.js and the feature files after them -- assumes these globals exist,
   so this is the one file whose position in index.html is not negotiable. */

// ---- config -------------------------------------------------------------
const PAGE_SIZE_DEFAULT = 50;
// How each tab presents its rows. This is PER TAB: one shared global meant the
// Completed tab's timeline followed you onto other tabs and rendered there.
//   view    — "table" | "grid" | "timeline" (Completed only)
//   combine — fold rows that are the same IGDB game into one entry. No longer a
//             user toggle: it's the default everywhere EXCEPT Completed, where
//             every finished game (each episode of a series included) stands on
//             its own. Orthogonal to the view: a list combines just as a grid does.
const VIEW_DEFAULT = { games: "grid", completed: "timeline", onOrder: "grid", wishlist: "grid", recs: "grid" };
const COMBINE_DEFAULT = { games: true, completed: false, onOrder: true, wishlist: false, recs: false };
const FACET_CAP = 12;              // values shown before "show more"
const FACET_FILTER_THRESHOLD = 12; // show a per-facet search box past this many values

// ---- state --------------------------------------------------------------
let DATA = null;            // {meta, sheets}
let activeTab = "home";
// The sheet-backed listing tabs. Recommend is one too (a synthetic catalogue sheet, recs.js)
// — Attract mode deliberately skips it (attractBuildPool), since those aren't games you own.
const TABS = ["games", "completed", "onOrder", "wishlist", "recs"];
// Per-tab UI state, isolated so switching tabs preserves filters.
const tabState = {};
// Filters/search/sort/page — wiped when you navigate to a tab afresh.
const freshState = () => ({ search: "", facets: {}, expanded: {}, sort: null, page: 1 });
// View/combine/pageSize are display PREFERENCES, not filters: they survive a tab switch.
// pageSize was a single global until it followed you between tabs — the same bug that
// made view per-tab above. It is still serialised per tab as ?ps=, so the global form
// meant a link to one tab silently repaged every other one.
for (const t of TABS) {
  tabState[t] = { ...freshState(), view: VIEW_DEFAULT[t], combine: COMBINE_DEFAULT[t], pageSize: PAGE_SIZE_DEFAULT };
}
const viewOf = () => tabState[activeTab].view;
const combineOn = () => tabState[activeTab].combine;
// Guarded on the tab having row state at all: the search pseudo-tab pages its own
// results (search.js) and has no tabState entry of its own.
const pageSizeOf = (tab) => {
  const st = tabState[tab || activeTab];
  return (st && st.pageSize) || PAGE_SIZE_DEFAULT;
};

/* Landing state, per tab.

   Navigating to a tab ON PURPOSE — the nav menu, the palette, the wordmark — puts it
   back the way you first found it. Back/forward does NOT: it restores exactly what the
   URL says, which is the whole point of a shared link.

   The five sheet-backed tabs above are covered by freshState(). The nine special tabs
   each keep their state in a private singleton in their own file, so each of those files
   registers its own wiper here (TAB_RESET.challenges = () => {…}, at the bottom of
   challenges.js). app.js only dispatches — nothing in the spine has to know what a
   challenge or a shelf is.

   VIEW state only. A tab's loaded data (SHELF.games, CAT) and its display preferences
   are not view state and must survive. */
const TAB_RESET = {};

// The top-bar search is GLOBAL now — it answers "do I already own or have this on order?"
// across every real sheet at once (the "search" pseudo-tab, search.js), separate from each
// listing's own inline filter (tabState[tab].search). Kept here so both the input handler and
// the renderer read the one query.
const GLOBAL_SEARCH = { q: "" };

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
  if (Array.isArray(value)) value = value.join(", ");   // multi-valued cell (e.g. Wishlisted On)
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

/* ---- title autocomplete (the guessing games' input) --------------------------
   A replacement for the native <datalist>, which had three faults worth the code:
   its popup is positioned by the browser and drifts loose of the input when the
   page reflows under it (a de-blurring clue image does exactly that); it renders
   as form-autofill chrome rather than app UI; and its matching is literal, so
   "chrono trigger" finds nothing when the title has a colon in the way.

   Matching here folds case, accents and punctuation on both sides and asks only
   that every typed word appear somewhere in the folded title — "name subtitle"
   matches "Name: Subtitle". Arrow keys walk the list, Enter takes the highlighted
   entry (and is consumed), Enter with nothing highlighted falls through to the
   caller's own submit handler. The list is absolutely positioned inside a wrapper
   around the input, so it cannot disconnect from it. */
function acFold(s) {
  return String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// input: the text box (ideally already inside a .ac-wrap); getItems: () => [{t, f}]
// with t the display title and f its acFold — computed once by the caller, not per keystroke.
function acAttach(input, getItems) {
  let wrap = input.closest(".ac-wrap");
  if (!wrap) {
    wrap = document.createElement("span");
    wrap.className = "ac-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
  }
  const list = document.createElement("div");
  list.className = "ac-list";
  list.hidden = true;
  wrap.appendChild(list);
  let rows = [], active = -1;

  const close = () => { list.hidden = true; active = -1; };
  const paint = () => {
    [...list.children].forEach((el, i) => el.classList.toggle("on", i === active));
  };
  const pick = (i) => {
    if (!rows[i]) return;
    input.value = rows[i].t;
    close();
    input.focus();
  };
  const update = () => {
    const q = acFold(input.value);
    if (q.length < 2) return close();
    const toks = q.split(" ");
    const scored = [];
    for (const it of getItems()) {
      let score;
      if (it.f.startsWith(q)) score = 0;
      else if (it.f.includes(q)) score = 1;
      else if (toks.every((t) => it.f.includes(t))) score = 2;
      else continue;
      scored.push([score, it]);
      if (scored.length > 200) break;              // plenty to sort a top-10 from
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].t.localeCompare(b[1].t));
    rows = scored.slice(0, 10).map((x) => x[1]);
    active = -1;
    if (!rows.length) return close();
    list.innerHTML = "";
    rows.forEach((it, i) => {
      const el = document.createElement("div");
      el.className = "ac-item";
      el.textContent = it.t;
      // mousedown, not click: it fires before the input's blur can close the list.
      el.addEventListener("mousedown", (ev) => { ev.preventDefault(); pick(i); });
      list.appendChild(el);
    });
    list.hidden = false;
  };

  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("blur", () => setTimeout(close, 120));
  // Registered before the caller assigns its own Enter handler, so a consumed
  // Enter (completing the highlighted row) never also submits the guess.
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, rows.length - 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, -1); paint(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); e.stopImmediatePropagation(); pick(active); }
    else if (e.key === "Escape") { e.stopImmediatePropagation(); close(); }
  });
}
