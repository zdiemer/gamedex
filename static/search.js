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

// The IGDB game a row IS, so the same title on two platforms — or a game you own AND have on
// order — collapses to a single result. Falls back to the match key, then the folded title, so
// an unmatched row still dedupes against itself.
function searchDedupeKey(row) {
  const e = ENRICH[row._k];
  if (e && e.igdbId != null) return "g" + e.igdbId;
  if (row._k) return "k" + row._k;
  return "t" + foldText(String(row.title || row.game || ""));
}

function renderSearch() {
  const host = $("#searchpage");
  $("#search").value = GLOBAL_SEARCH.q;         // keep the box in sync on deep-link / back-forward
  const q = (GLOBAL_SEARCH.q || "").trim();
  if (!q) {
    host.innerHTML = emptyState("Search your collection",
      "Type a title above to check whether you already own it or have it on order.", null);
    return;
  }
  const terms = foldText(q).split(/\s+/).filter(Boolean);

  // Two real sources: your games (owned; some flagged completed) and your open orders. "My
  // Games" already subsumes Completed — a finished game you own is a Games row with
  // completed=true — so Completed isn't a separate source here, it's a chip on the owned card.
  const hits = new Map();                       // dedupeKey -> {row, sheet, owned, completed, onorder}
  const add = (row, sheet) => {
    const k = searchDedupeKey(row);
    let h = hits.get(k);
    if (!h) { h = { row, sheet, owned: false, completed: false, onorder: false }; hits.set(k, h); }
    if (sheet === "games") {
      h.owned = true;
      if (row.completed) h.completed = true;
      h.row = row; h.sheet = "games";           // an owned row is the richest thing to open
    } else if (sheet === "onOrder") {
      h.onorder = true;
      if (!h.owned) { h.row = row; h.sheet = "onOrder"; }
    }
  };
  for (const r of searchSheetRows("games", terms)) add(r, "games");
  for (const r of searchSheetRows("onOrder", terms)) add(r, "onOrder");

  const results = [...hits.values()];
  // Owned before on-order, completed before not, then alphabetical — a title you own is usually
  // the answer you came for.
  results.sort((a, b) =>
    (b.owned - a.owned) || (b.completed - a.completed) ||
    String(a.row.title || a.row.game || "").localeCompare(String(b.row.title || b.row.game || "")));

  if (!results.length) {
    host.innerHTML =
      `<div class="search-head"><h2>No matches for “${escapeHtml(q)}”</h2>
        <p class="muted">Nothing in your collection or on order — looks safe to buy. 🛒</p></div>`;
    return;
  }

  host.innerHTML =
    `<div class="search-head">
       <h2>${results.length.toLocaleString()} ${results.length === 1 ? "match" : "matches"} for “${escapeHtml(q)}”</h2>
       <p class="muted">Across your games and open orders.</p>
     </div>`;
  const grid = document.createElement("div");
  grid.className = "grid search-grid";
  host.appendChild(grid);

  stopPreview();                                // any card the tour was on is gone
  results.forEach((h, i) => {
    const row = h.row;
    const cs = coverSrc(ENRICH[row._k], "cover_big");
    const pixel = coverIsPixelArt(ENRICH[row._k], cs) ? " pixel" : "";
    const cover = cs
      ? `<img class="card-cover${pixel}" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
      : `<div class="card-cover ph">${icon("i-library", 26)}</div>`;
    const chips = [];
    if (h.owned) chips.push(`<span class="s-chip owned">Owned</span>`);
    if (h.completed) chips.push(`<span class="s-chip done">Completed</span>`);
    if (h.onorder) chips.push(`<span class="s-chip order">On order</span>`);
    const title = escapeHtml(String(row.title || row.game || "Untitled"));
    const sub = [row.platform, row.releaseYear].filter((x) => x != null && x !== "")
      .map((x) => escapeHtml(String(x))).join(" · ");
    const card = document.createElement("div");
    card.className = "card" + (h.completed ? " done" : "");
    card.style.setProperty("--i", Math.min(i, 24) * 22 + "ms");
    if (row._k) card.dataset.k = row._k;
    card.innerHTML = `${cover}${vrBadgeHtml(row)}<div class="card-body">
        <div class="card-title" title="${title}">${title}</div>
        <div class="card-sub">${sub}</div>
        <div class="s-chips">${chips.join("")}</div>
      </div>`;
    // Open the drawer against the sheet the card came from, so a Completed/On-order row shows
    // its own fields (deep-linkable via ?gs=<sheet>).
    card.onclick = () => openDrawer(row, h.sheet);
    CARD_ROW.set(card, row);
    wirePreview(card);                          // hover previews, but don't arm the idle tour here
    grid.appendChild(card);
  });
  applyGridColumns(grid);
  maybeEnrich(results.map((h) => h.row));       // warm any cover that isn't in the map yet
}
