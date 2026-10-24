"use strict";

// UI components for table.js. Feature state and orchestration remain in that module.

// Dispatcher: sort → paginate → render as table or grid.
function renderTable(rows) {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("renderTable", activeTab) : () => {};
  try { return _renderTable(rows); } finally { end(); }
}

function _renderTable(rows) {
  const st = tabState[activeTab];
  // The timeline is a view of the Completed rows — same filters, same search.
  const canTimeline = activeTab === "completed";
  $("#viewTimeline").hidden = !canTimeline;
  if (st.view === "timeline" && !canTimeline) st.view = "grid";
  const view = st.view;
  if (view !== "timeline" && typeof disposeTimeline === "function") disposeTimeline();
  $("#tablewrap").hidden = view !== "table";
  $("#gridwrap").hidden = view !== "grid";
  $("#timeline").hidden = view !== "timeline";
  $("#pager").style.display = view === "timeline" ? "none" : "";
  for (const [id, m] of [["viewTable", "table"], ["viewGrid", "grid"], ["viewTimeline", "timeline"]]) {
    $("#" + id).classList.toggle("active", view === m);
  }
  // Sort control shows in ALL views now, timeline included — it drives the timeline's buckets
  // (Date → years, Title → A–Z, Rating → bands …), which is why sorting there used to do nothing.
  $("#gridsortwrap").hidden = false;
  populateGridSort();
  /* Above the timeline's early return, not below it. These describe the tab's FILTER
     state, which every view shares — left at the bottom, the Completed timeline never
     showed "Clear filters" for any facet at all, so a filter you arrived at by link had
     no visible way out. That is worse now that a heatmap day can put you there. */
  $("#clear").hidden = !(st.search || Object.keys(st.facets).length);
  $("#resetsort").hidden = !(st.sort && st.sort.length);
  if (view === "timeline") {
    renderTimeline(rows);
    const tlTotal = sheet().rows.length;
    $("#count").textContent = rows.length === tlTotal
      ? `${tlTotal.toLocaleString()} game${tlTotal === 1 ? "" : "s"}`
      : `${rows.length.toLocaleString()} of ${tlTotal.toLocaleString()} games`;
    renderViews();
    return;
  }
  // Combining: rows sharing an IGDB id ARE the same game, so collapse them before
  // sorting and paging — otherwise the counts and page numbers would lie.
  // The sheet is the "universe" argument: the group card describes the filtered
  // copies, but its drawer routes to every copy (see groupByGame).
  const base = st.combine ? groupByGame(rows, sheet().rows) : rows;
  const sorted = sortRows(base);
  const per = pageSizeOf();
  const pages = Math.max(1, Math.ceil(sorted.length / per));
  if (st.page > pages) st.page = pages;
  const start = (st.page - 1) * per;
  const pageRows = sorted.slice(start, start + per);

  if (!sorted.length) {
    const filtered = st.search || Object.keys(st.facets).length;
    const host = view === "grid" ? $("#grid") : $("#tbody");
    host.innerHTML = view === "grid"
      ? emptyState("No games match", filtered ? "Try loosening a filter or clearing the search." : "Nothing here yet.", filtered ? "Clear filters" : null)
      : `<tr><td colspan="99">${emptyState("No games match", "Try loosening a filter.", null)}</td></tr>`;
    if (view === "grid") $("#thead").innerHTML = "";
    const act = $("#emptyAction");
    if (act) act.onclick = () => { st.search = ""; st.facets = {}; st.page = 1; $("#tabsearch").value = ""; renderAll(); nav(); };
  } else if (view === "grid") renderGrid(pageRows);
  else renderTableView(pageRows);

  maybeEnrich(pageRows);
  // Recommend rows are catalogue games — fetch the trailer / HLTB / platform the catalogue
  // payload doesn't carry for the page just painted (recs.js), so their cards get hover
  // previews and Estimated Time.
  if (activeTab === "recs" && typeof loadRecsMeta === "function") loadRecsMeta(pageRows);
  kbReset();
  renderViews();
  const total = st.combine && typeof groupedTotalOf === "function"
    ? groupedTotalOf(sheet().rows) : sheet().rows.length;
  // Unfiltered, "14,768 of 14,768 games" reads like a filter that isn't there.
  $("#count").textContent = sorted.length === total
    ? `${total.toLocaleString()} game${total === 1 ? "" : "s"}`
    : `${sorted.length.toLocaleString()} of ${total.toLocaleString()} games`;
  renderPager(pages);
}

function renderTableView(pageRows) {
  const cols = columns().filter((c) => c.primary);
  const spec = effectiveSort();
  // Surface sorted-by columns that aren't shown (e.g. Date Added) as extra columns.
  // sortMeta, not colByKey: a virtual sort has no sheet column, so sorting by Critic
  // Rating or Challenges It Would Clear surfaced no column at all and you had to take
  // the order on trust.
  for (const s of spec) {
    const c = sortMeta(s.key);
    if (c && !cols.includes(c)) cols.push(c);
  }
  const thead = $("#thead");
  thead.innerHTML = "";
  if (ENRICH_ENABLED) thead.appendChild(document.createElement("th")).className = "cover-h";
  const specByKey = new Map(spec.map((s, i) => [s.key, { dir: s.dir, ord: i }]));
  const multi = spec.length > 1;
  for (const c of cols) {
    const th = document.createElement("th");
    const s = specByKey.get(c.key);
    let ind = "";
    if (s) {
      const glyph = s.dir === "asc" ? "▲" : "▼";
      ind = `<span class="arrow">${glyph}${multi ? `<sub>${s.ord + 1}</sub>` : ""}</span>`;
    }
    th.innerHTML = `${escapeHtml(c.label)} ${ind}`;
    th.title = "Click to sort · Shift-click to add a sort level";
    th.onclick = (e) => onHeaderClick(c, e.shiftKey);
    thead.appendChild(th);
  }
  const tbody = $("#tbody");
  tbody.innerHTML = "";
  for (const row of pageRows) {
    const tr = document.createElement("tr");
    if (row._k) tr.dataset.k = row._k;
    const cstat = collectionStatus(row);
    if (cstat) tr.className = "row-col-" + cstat;
    const cover = ENRICH_ENABLED ? `<td class="cover">${coverCell(row)}</td>` : "";
    tr.innerHTML = cover + cols.map((c) => `<td>${fmtCell(sortValueOf(row, c.key), c.type)}</td>`).join("");
    tr.onclick = () => openDrawer(row);
    tbody.appendChild(tr);
  }
}

// card element -> row (for in-place patching)

// When an explicit sort is active, surface the sorted field's value on the card
// so you can see what you're sorting by without opening the game.
function sortValueHtml(row) {
  const st = tabState[activeTab];
  if (!st || !st.sort || !st.sort.length) return "";     // default sort → nothing extra
  return st.sort.slice(0, 2).map((s) => {
    const c = sortMeta(s.key);          // virtual sorts have no column; see renderTableView
    if (!c) return "";
    const v = sortValueOf(row, s.key);
    const val = (v === undefined || v === null || v === "")
      ? `<i class="muted">—</i>` : fmtCell(v, c.type);
    return `<div class="card-sortval"><span>${escapeHtml(c.label)}</span>${val}</div>`;
  }).join("");
}

// Text-only card body (no <img>), so it can be re-rendered without flicker.
function cardBodyHtml(row) {
  // A card can render on a tab with no sheet of its own (Pick, Home), where columns()
  // reads DATA.sheets[activeTab] and throws. Fall back to the games schema.
  const cols = (DATA.sheets[activeTab] || DATA.sheets.games || {}).columns || [];
  const titleKey = (cols.find((c) => c.primary) || cols[0] || { key: "title" }).key;
  const title = escapeHtml(String(row[titleKey] ?? "Untitled"));
  const rel = row.releaseDate || row.release;                 // full date, else year
  const relDisp = rel ? fmtDate(rel) : row.releaseYear;
  const pt = playtimeOf(row);
  const parts = [row.platform, relDisp].filter((x) => x != null && x !== "").map((x) => escapeHtml(String(x)));
  if (pt != null) parts.push("⏱ " + fmtHours(pt));
  const cv = collectionValueOf(row);
  if (cv != null) parts.push("$" + cv.toFixed(2));
  if (row._members && row._members.length > 1) parts.push(`⧉ ${row._members.length} copies`);
  const units = salesOf(row);
  if (units != null) parts.push("↗ " + fmtUnits(units));
  const rating = row.rating != null
    ? `<span class="card-rating ${ratingClass(row.rating)}" title="Your rating">${Math.round(row.rating * 100)}</span>` : "";
  const mc = metacriticOf(row);
  const meta = mc != null
    ? `<span class="card-meta ${ratingClass(mc)}" title="Metacritic">${Math.round(mc * 100)}</span>` : "";
  // Title + platform/year always visible on the scrim; the rest (playtime,
  // value, sales, sorted-by field, collection badge) unfurls on hover.
  const head = [row.platform, relDisp].filter((x) => x != null && x !== "").map((x) => escapeHtml(String(x)));
  const extra = parts.slice(head.length);
  // Wishlist price (ITAD): a badge on the cover — current price, the cut %, and an
  // all-time-low star. ONLY on the Wishlist tab: a wishlisted-and-owned game shares one
  // row object with All Games, so its stamped _wlPrice was leaking the price/discount onto
  // the All Games card too. Price belongs to the wishlist view, not the library.
  const priceBadge = (activeTab === "wishlist" && typeof wishlistPriceBadge === "function")
    ? wishlistPriceBadge(row) : "";
  // Recommend cards carry a predicted-rating badge instead of a real/critic score.
  const predBadge = typeof recsPredictBadge === "function" ? recsPredictBadge(row) : "";
  return `${meta}${rating}${predBadge}${priceBadge}<div class="card-title" title="${title}">${title}</div>` +
    `<div class="card-sub">${head.join(" · ")}</div>` +
    `<div class="card-extra"><div>` +
      (extra.length ? `<div class="card-sub">${extra.join(" · ")}</div>` : "") +
      collectionBadgeHtml(row) + sortValueHtml(row) +
    `</div></div>`;
}

function renderGrid(pageRows) {
  const grid = $("#grid");
  stopPreview();                 // the card it was attached to is about to vanish
  grid.innerHTML = "";
  pageRows.forEach((row, i) => {
    const card = document.createElement("div");
    card.style.setProperty("--i", Math.min(i, 24) * 22 + "ms");   // fan-in stagger
    // A part-finished collection is yellow, and that beats the green "done"
    // ring — the compilation itself isn't finished even on the Completed tab.
    card.className = posterClassName(row);
    if (row._k) card.dataset.k = row._k;
    CARD_ROW.set(card, row);
    card.innerHTML = posterContentHtml(row, cardBodyHtml(row), { pending: coverPending(row) });
    card.onclick = () => openDrawer(row);
    wirePreview(card);
    grid.appendChild(card);
  });
  // A fresh set of cards: forget who went last and start the idle clock over.
  tourLast = null;
  tourKick();
  applyGridColumns(grid);
}
