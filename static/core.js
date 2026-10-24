"use strict";

/* Shared configuration, application state, and nonvisual helpers.
   Foundational UI declarations live in components/foundations/core.js.
   Initialize this state before feature controllers; index.html owns load order. */

// ---- config -------------------------------------------------------------
const PAGE_SIZE_DEFAULT = 50;
// How each tab presents its rows. This is PER TAB: one shared global meant the
// Completed tab's timeline followed you onto other tabs and rendered there.
//   view    — "table" | "grid" | "timeline" (Completed only)
//   combine — fold rows that are the same IGDB game into one entry. No longer a
//             user toggle: it's the default everywhere EXCEPT Completed, where
//             every finished game (each episode of a series included) stands on
//             its own. Orthogonal to the view: a list combines just as a grid does.
const VIEW_DEFAULT = { games: "grid", completed: "timeline", onOrder: "grid", wishlist: "grid", recs: "grid", translations: "grid" };
const COMBINE_DEFAULT = { games: true, completed: false, onOrder: true, wishlist: false, recs: false, translations: false };
const FACET_CAP = 12;              // values shown before "show more"
const FACET_FILTER_THRESHOLD = 12; // show a per-facet search box past this many values

// ---- state --------------------------------------------------------------
let DATA = null;            // {meta, sheets}
let activeTab = "home";
// The sheet-backed listing tabs. Recommend is one too (a synthetic catalogue sheet, recs.js)
// — Attract mode deliberately skips it (attractBuildPool), since those aren't games you own.
const TABS = ["games", "completed", "onOrder", "wishlist", "recs", "translations"];
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

// Hyphens make YYYY-MM-DD look like a calendar event to phone data detectors. Centered
// dots keep the day readable while ensuring the receipt's game URL is its only link.
function dailyShareDate(date) {
  return String(date || "").replaceAll("-", "·");
}

// Daily-game receipts always link to the game itself, never to a transient drawer or
// another tab carried in the current query string.
function dailyShareUrl(tab) {
  const url = new URL(location.href);
  url.search = `?tab=${tab}`;
  url.hash = "";
  return String(url);
}

async function shareDailyResult(name, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: `${name} result`, text });
      showToast(`${name} result shared`, "i-check");
      return;
    } catch (err) {
      if (err && err.name === "AbortError") return;
      // Some browsers advertise Web Share and still reject text-only payloads.
    }
  }
  try {
    await copyResultText(text);
    showToast(`${name} result copied`, "i-check");
  } catch (_) {
    showToast(`Couldn't share the ${name} result`);
  }
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
