"use strict";

/* Global search — "do I already own this, or is it on the way?"

   The top-bar search used to filter whatever page you were on (defaulting to All Games), which
   was a little misleading: it looked global but was really the current list's filter. Now it
   answers the question that actually stops a double-purchase: across your whole collection AND
   your open orders, is this game already yours? Results are one deduped grid of cards, each
   chipped with where it lives — Owned / Completed / On order.

   The per-page free-text filter didn't disappear; it moved inline onto each listing (chrome.js
   wires #tabsearch). This file owns only the cross-sheet landing (the "search" pseudo-tab).

   Loaded after table.js / preview.js; shares their card, cover and preview helpers. */

// Rows of ONE sheet matching the folded search terms, using that sheet's own searchable
// columns (+ the shared genre haystack). Independent of activeTab, unlike filters.js's
// searchedRows(), because the global search reads several sheets at once.
function searchSheetRows(sheetKey, terms) {
  const sh = DATA && DATA.sheets && DATA.sheets[sheetKey];
  if (!sh || !sh.rows) return [];
  const cols = sh.columns.filter((c) => c.search).map((c) => c.key);
  return sh.rows.filter((row) => matchesSearch(row, terms, cols));
}

// The entry the app calls (renderAll on tab-switch / deep-link / back-forward, AND the top-bar
// input handler). It shows the page shell at once but DEBOUNCES the heavy result build, so rapid
// typing — the first keystrokes included — renders once, when you pause, instead of building (and
// hover-wiring) a huge, immediately-stale set on every letter. That was the lag + flash.
let _searchTimer = null;
let _searchPage = 1;        // current page of results
let _searchPageQ = "";

// Landing state (core.js): back to page 1. NOT GLOBAL_SEARCH.q — on this tab the query
// IS the page, and switchTab already drops it when you leave for anywhere else.
TAB_RESET.search = () => { _searchPage = 1; _searchPageQ = ""; };
