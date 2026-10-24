"use strict";

// UI components for search.js. Feature state and orchestration remain in that module.

// the query that page belongs to — a new query resets to page 1
function renderSearch() {
  const host = $("#searchpage");
  $("#search").value = GLOBAL_SEARCH.q;         // keep the box in sync on deep-link / back-forward
  const q = (GLOBAL_SEARCH.q || "").trim();
  clearTimeout(_searchTimer);
  if (!q) {
    host.innerHTML = emptyState("Search your collection",
      "Type a title above to search your games.", null);
    return;
  }
  // Don't blank an existing list while you keep typing — rebuild it after the pause. A short
  // placeholder only when there's nothing on screen yet (first entry).
  if (!host.querySelector(".search-head")) host.innerHTML = `<div class="search-head"><h2>Searching…</h2></div>`;
  _searchTimer = setTimeout(() => renderSearchResults(q), 170);
}

function renderSearchResults(q) {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("renderSearchResults", activeTab) : () => {};
  try { return _renderSearchResults(q); } finally { end(); }
}

function _renderSearchResults(q) {
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
        <p class="muted">Nothing in your collection matches.</p></div>`;
    return;
  }

  // Paginate rather than capping — every match is reachable now. A new query resets to page 1;
  // paging (or an enrichment re-render) keeps the page you were on.
  if (q !== _searchPageQ) { _searchPage = 1; _searchPageQ = q; }
  const per = PAGE_SIZE_DEFAULT;   // the search page has no tabState of its own
  const pages = Math.max(1, Math.ceil(results.length / per));
  if (_searchPage > pages) _searchPage = pages;
  const start = (_searchPage - 1) * per;
  const shown = results.slice(start, start + per);
  host.innerHTML =
    `<div class="search-head">
       <h2>${results.length.toLocaleString()} ${results.length === 1 ? "match" : "matches"} for “${escapeHtml(q)}”</h2>
       <p class="muted">Across your games and open orders.</p>
     </div>`;
  const grid = document.createElement("div");
  grid.className = "grid search-grid";
  host.appendChild(grid);

  stopPreview();                                // any card the tour was on is gone
  shown.forEach((h, i) => {
    const row = h.row;
    const chips = [];
    if (h.owned) chips.push(`<span class="s-chip owned">Owned</span>`);
    else if (h.tracked) chips.push(`<span class="s-chip tracked">Tracked</span>`);
    if (h.completed) chips.push(`<span class="s-chip done">Completed</span>`);
    if (h.onorder) chips.push(`<span class="s-chip order">On order</span>`);
    const card = document.createElement("div");
    card.className = "card" + (h.completed ? " done" : "");
    card.style.setProperty("--i", Math.min(i, 24) * 22 + "ms");
    if (row._k) card.dataset.k = row._k;
    card.innerHTML = posterContentHtml(row, posterSummaryHtml(row, {
      afterHtml: `<div class="s-chips">${chips.join("")}</div>`,
    }));
    card.onclick = () => openDrawer(row, h.sheet);
    CARD_ROW.set(card, row);
    wirePreview(card);                          // hover previews, but don't arm the idle tour here
    grid.appendChild(card);
  });
  // Deliberately NO applyGridColumns: its column re-balancing only engages past one row, which is
  // exactly why a 2-result search rendered narrower cards than a full one. Plain auto-fill keeps
  // every card the same width no matter how many match.
  maybeEnrich(shown.map((h) => h.row));         // warm any cover that isn't in the map yet
  if (pages > 1) host.appendChild(searchPager(pages, q));
}

// Search owns its query/page state; the controls are shared with the listing.
function searchPager(pages, q) {
  return createPager({ page: _searchPage, pages, onChange: (page) => {
    _searchPage = page;
    renderSearchResults(q);
    $("#searchpage").scrollTop = 0;
    window.scrollTo({ top: 0, behavior: "smooth" });
  } });
}
