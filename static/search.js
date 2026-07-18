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
function renderSearch() {
  const host = $("#searchpage");
  $("#search").value = GLOBAL_SEARCH.q;         // keep the box in sync on deep-link / back-forward
  const q = (GLOBAL_SEARCH.q || "").trim();
  clearTimeout(_searchTimer);
  if (!q) {
    host.innerHTML = emptyState("Search your collection",
      "Type a title above to check whether you already own it or have it on order.", null);
    return;
  }
  // Don't blank an existing list while you keep typing — rebuild it after the pause. A short
  // placeholder only when there's nothing on screen yet (first entry).
  if (!host.querySelector(".search-head")) host.innerHTML = `<div class="search-head"><h2>Searching…</h2></div>`;
  _searchTimer = setTimeout(() => renderSearchResults(q), 170);
}

function renderSearchResults(q) {
  const host = $("#searchpage");
  if ((GLOBAL_SEARCH.q || "").trim() !== q) return;   // superseded by a newer keystroke
  const terms = foldText(q).split(/\s+/).filter(Boolean);
  const orderHits = searchSheetRows("onOrder", terms);
  const orderSet = new Set(orderHits);

  // Combine editions/ports exactly the way the listings do — one card per game, merged by
  // CANONICAL IGDB id (so Borderlands 2 on PC + Xbox 360 is a single "2 platforms" card that opens
  // the combined collection drawer, not two rows). On-order copies join the same game. This is the
  // same groupByGame the grid uses with combine on, so search and the listing agree.
  const grouped = groupByGame([...searchSheetRows("games", terms), ...orderHits]);

  const results = grouped.map((row) => {
    const members = row._members || [row];
    const lib = members.filter((m) => !orderSet.has(m));      // copies logged in My Games
    return {
      row, members,
      // "My Games" is NOT "owned" — it includes subscriptions, emulation, and games finished and
      // sold. Trust the sheet's own `owned` flag; everything else in My Games is merely tracked.
      owned: lib.some((m) => m.owned === true),
      tracked: lib.length > 0,
      completed: members.some((m) => m.completed),
      onorder: members.some((m) => orderSet.has(m)),
      // Open the combined drawer against games (its schema) when there's a library copy or it's a
      // merged group; a game that's ONLY on order opens against the onOrder sheet.
      sheet: (lib.length || members.length > 1) ? "games" : "onOrder",
      // Field-weighted relevance: a title hit beats a developer/genre hit, exact beats substring.
      // This is what lifts "Haze" above the "Hazelight" games and surfaces the game named "X".
      score: searchScore(row, terms),
    };
  });
  // RELEVANCE first — the whole point is that the game you actually typed rises to the top. Then
  // owned / completed / tracked as a tiebreak (an owned title is usually the answer you came for),
  // then alphabetical.
  results.sort((a, b) =>
    (b.score - a.score) ||
    (b.owned - a.owned) || (b.completed - a.completed) || (b.tracked - a.tracked) ||
    String(a.row.title || a.row.game || "").localeCompare(String(b.row.title || b.row.game || "")));

  if (!results.length) {
    host.innerHTML =
      `<div class="search-head"><h2>No matches for “${escapeHtml(q)}”</h2>
        <p class="muted">Nothing in your collection or on order — looks safe to buy. 🛒</p></div>`;
    return;
  }

  // Even after grouping, a 1–2 character query can match hundreds; render only the top slice
  // (owned-first, so the cap keeps the answers that matter) and let a longer query narrow it.
  const CAP = 120;
  const shown = results.slice(0, CAP);
  const more = results.length - shown.length;
  host.innerHTML =
    `<div class="search-head">
       <h2>${results.length.toLocaleString()} ${results.length === 1 ? "match" : "matches"} for “${escapeHtml(q)}”</h2>
       <p class="muted">Across your games and open orders.${more > 0 ? ` Showing the first ${CAP} — type more to narrow.` : ""}</p>
     </div>`;
  const grid = document.createElement("div");
  grid.className = "grid search-grid";
  host.appendChild(grid);

  stopPreview();                                // any card the tour was on is gone
  shown.forEach((h, i) => {
    const row = h.row;
    const cs = coverSrc(ENRICH[row._k], "cover_big");
    const pixel = coverIsPixelArt(ENRICH[row._k], cs) ? " pixel" : "";
    const cover = cs
      ? `<img class="card-cover${pixel}" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
      : `<div class="card-cover ph">${icon("i-library", 26)}</div>`;
    const chips = [];
    if (h.owned) chips.push(`<span class="s-chip owned">Owned</span>`);
    else if (h.tracked) chips.push(`<span class="s-chip tracked">Tracked</span>`);
    if (h.completed) chips.push(`<span class="s-chip done">Completed</span>`);
    if (h.onorder) chips.push(`<span class="s-chip order">On order</span>`);
    const title = escapeHtml(String(row.title || row.game || "Untitled"));
    // row.platform reads "2 platforms" for a merged group (groupRow), the real platform otherwise.
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
    card.onclick = () => openDrawer(row, h.sheet);
    CARD_ROW.set(card, row);
    wirePreview(card);                          // hover previews, but don't arm the idle tour here
    grid.appendChild(card);
  });
  // Deliberately NO applyGridColumns: its column re-balancing only engages past one row, which is
  // exactly why a 2-result search rendered narrower cards than a full one. Plain auto-fill keeps
  // every card the same width no matter how many match.
  maybeEnrich(shown.map((h) => h.row));         // warm any cover that isn't in the map yet
}
