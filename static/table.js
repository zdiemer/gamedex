"use strict";

/* Sorting, and the two grid/table views the sorted rows land in.

   Sorting is multi-key: shift-click appends. Blanks always sink regardless of
   direction -- a missing rating is not a zero, and sorting by it should not
   bring 3,000 blanks to the top. */

// ---- rendering: table ---------------------------------------------------
// ---- multi-key sorting --------------------------------------------------
const NUMERIC_TYPES = ["rating", "hours", "number", "money", "int", "year"];

// Per-tab default sort. A spec is {key, dir, type?, kind?}; `kind` selects a
// custom comparator. The games default: Playing-status group on top
// (Playing→On Hold→Up Next→none), then uncompleted before completed, then
// newest release year, with newest release date (Early Access = newest) as the
// final tiebreaker.
const DEFAULT_SORT = {
  games: [{ key: "releaseDate", kind: "releaseDateDesc", dir: "desc" }],
  completed: [{ key: "date", dir: "desc", type: "date" }],
  onOrder: [{ key: "orderedDate", dir: "desc", type: "date" }],
};

const PLAYING_RANK = { "Playing": 0, "On Hold": 1, "Up Next": 2 };
const isBlank = (v) => v === undefined || v === null || v === "";

function playingRank(v) {
  if (isBlank(v)) return 3;
  if (v in PLAYING_RANK) return PLAYING_RANK[v];
  const n = Number(v);                 // tolerate raw codes 1/0/-1 too
  return n === 1 ? 0 : n === 0 ? 1 : n === -1 ? 2 : 3;
}
function releaseDateScore(v) {
  if (isBlank(v)) return -Infinity;                        // no date → oldest
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T00:00:00").getTime();
  return Infinity;                                          // Early Access/TBD → newest
}
function cmpBy(a, b, spec) {
  const v = spec.kind && VIRTUAL_SORTS.find((s) => s.kind === spec.kind);
  const x = v ? v.get(a) : a[spec.key];
  const y = v ? v.get(b) : b[spec.key];
  if (spec.kind === "playingRank") return playingRank(x) - playingRank(y);
  if (spec.key === "priority") {
    // Alphabetically, "Might Play" beats "Must Play" beats "Want to Play". Rank it.
    const d = priorityRank(x) - priorityRank(y);
    return spec.dir === "desc" ? -d : d;
  }
  if (spec.kind === "releaseDateDesc") return releaseDateScore(y) - releaseDateScore(x);
  const xm = isBlank(x), ym = isBlank(y);
  if (xm && ym) return 0;
  if (xm) return 1;   // blanks always sink, regardless of direction
  if (ym) return -1;
  const dir = spec.dir === "desc" ? -1 : 1;
  const type = spec.type || (colByKey(spec.key) || {}).type;
  if (NUMERIC_TYPES.includes(type)) {
    const nx = Number(x), ny = Number(y);          // "Early Access" (NaN) = newest
    return ((isNaN(nx) ? Infinity : nx) - (isNaN(ny) ? Infinity : ny)) * dir;
  }
  if (type === "bool") return ((x ? 1 : 0) - (y ? 1 : 0)) * dir;
  return String(x).localeCompare(String(y), undefined, { sensitivity: "base" }) * dir;
}
function effectiveSort() {
  const st = tabState[activeTab];
  if (st.sort && st.sort.length) return st.sort;
  return DEFAULT_SORT[activeTab] ||
    [{ key: (columns().find((c) => c.primary) || columns()[0]).key, dir: "asc" }];
}
// Naive search relevance: a query that hits the TITLE outranks one that only hit
// another field (genre, publisher…). So searching "Adventure" surfaces the game
// *named* Adventure above everything merely tagged with the Adventure genre.
function searchRank(row, terms) {
  const title = foldText(row.title ?? row.game ?? "");
  let score = 0;
  for (const t of terms) {
    if (title === t) score += 100;
    else if (title.startsWith(t)) score += 40;
    else if (title.includes(t)) score += 20;
    // matched only via another field (it passed the filter) — no title bonus
  }
  return score;
}

function sortRows(rows) {
  const spec = effectiveSort();
  const q = foldText(tabState[activeTab].search || "").trim();
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  return [...rows].sort((a, b) => {
    if (terms.length) {
      const r = searchRank(b, terms) - searchRank(a, terms);
      if (r) return r;                    // title relevance first when searching
    }
    for (const s of spec) { const c = cmpBy(a, b, s); if (c) return c; }
    return 0;
  });
}

// Click a header to sort by it (toggles dir); Shift-click to add/toggle it as
// an additional sort level (or remove it on a third shift-click).
function onHeaderClick(col, shift) {
  const st = tabState[activeTab];
  const cur = st.sort && st.sort.length ? st.sort.slice() : [];
  const idx = cur.findIndex((s) => s.key === col.key);
  const defDir = col.type === "text" ? "asc" : "desc";
  if (shift) {
    if (idx === -1) cur.push({ key: col.key, dir: defDir, type: col.type });
    else if (cur[idx].dir === defDir) cur[idx] = { key: col.key, dir: defDir === "asc" ? "desc" : "asc", type: col.type };
    else cur.splice(idx, 1);                       // third shift-click drops this level
  } else {
    if (cur.length === 1 && cur[0].key === col.key)
      cur.splice(0, 1, { key: col.key, dir: cur[0].dir === "asc" ? "desc" : "asc", type: col.type });
    else { cur.length = 0; cur.push({ key: col.key, dir: defDir, type: col.type }); }
  }
  st.sort = cur.length ? cur : null;
  st.page = 1;
  renderAll();
  nav();
}

// Dispatcher: sort → paginate → render as table or grid.
function renderTable(rows) {
  const st = tabState[activeTab];
  // Combining: rows sharing an IGDB id ARE the same game, so collapse them before
  // sorting and paging — otherwise the counts and page numbers would lie.
  const base = st.combine ? groupByGame(rows) : rows;
  const sorted = sortRows(base);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (st.page > pages) st.page = pages;
  const start = (st.page - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(start, start + PAGE_SIZE);

  // The timeline is a view of the Completed rows — same filters, same search.
  const canTimeline = activeTab === "completed";
  $("#viewTimeline").hidden = !canTimeline;
  if (st.view === "timeline" && !canTimeline) st.view = "grid";
  const view = st.view;
  $("#tablewrap").hidden = view !== "table";
  $("#gridwrap").hidden = view !== "grid";
  $("#timeline").hidden = view !== "timeline";
  $("#pager").style.display = view === "timeline" ? "none" : "";
  for (const [id, m] of [["viewTable", "table"], ["viewGrid", "grid"], ["viewTimeline", "timeline"]]) {
    $("#" + id).classList.toggle("active", view === m);
  }
  if (view === "timeline") {
    renderTimeline(rows);
    $("#count").textContent = `${rows.length.toLocaleString()} of ${sheet().rows.length.toLocaleString()} games`;
    renderViews();
    return;
  }
  $("#gridsortwrap").hidden = false;    // sort control in both views (reaches
  populateGridSort();                   // non-primary columns like Date Added)
  if (!sorted.length) {
    const filtered = st.search || Object.keys(st.facets).length;
    const host = view === "grid" ? $("#grid") : $("#tbody");
    host.innerHTML = view === "grid"
      ? emptyState("No games match", filtered ? "Try loosening a filter or clearing the search." : "Nothing here yet.", filtered ? "Clear filters" : null)
      : `<tr><td colspan="99">${emptyState("No games match", "Try loosening a filter.", null)}</td></tr>`;
    if (view === "grid") $("#thead").innerHTML = "";
    const act = $("#emptyAction");
    if (act) act.onclick = () => { st.search = ""; st.facets = {}; st.page = 1; $("#search").value = ""; renderAll(); nav(); };
  } else if (view === "grid") renderGrid(pageRows);
  else renderTableView(pageRows);

  maybeEnrich(pageRows);
  kbReset();
  renderViews();
  $("#count").textContent = `${sorted.length.toLocaleString()} of ${sheet().rows.length.toLocaleString()} games`;
  $("#clear").hidden = !(st.search || Object.keys(st.facets).length);
  $("#resetsort").hidden = !(st.sort && st.sort.length);
  renderPager(pages);
}

function renderTableView(pageRows) {
  const cols = columns().filter((c) => c.primary);
  const spec = effectiveSort();
  // Surface sorted-by columns that aren't shown (e.g. Date Added) as extra columns.
  for (const s of spec) {
    const c = colByKey(s.key);
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
    tr.innerHTML = cover + cols.map((c) => `<td>${fmtCell(row[c.key], c.type)}</td>`).join("");
    tr.onclick = () => openDrawer(row);
    tbody.appendChild(tr);
  }
}

// Completed games get a green-bordered card. The Completed tab is all finished;
// on the Games tab it's the per-row Completed flag.
function rowCompleted(row) {
  if (activeTab === "completed") return true;
  if (activeTab === "games") return !!row.completed;
  return false;
}

const CARD_ROW = new WeakMap();   // card element -> row (for in-place patching)

// When an explicit sort is active, surface the sorted field's value on the card
// so you can see what you're sorting by without opening the game.
function sortValueHtml(row) {
  const st = tabState[activeTab];
  if (!st || !st.sort || !st.sort.length) return "";     // default sort → nothing extra
  return st.sort.slice(0, 2).map((s) => {
    const c = colByKey(s.key);
    if (!c) return "";
    const v = row[s.key];
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
    ? `<span class="card-rating ${ratingClass(row.rating)}" title="My rating">${Math.round(row.rating * 100)}</span>` : "";
  const mc = metacriticOf(row);
  const meta = mc != null
    ? `<span class="card-meta ${ratingClass(mc)}" title="Metacritic">${Math.round(mc * 100)}</span>` : "";
  // Title + platform/year always visible on the scrim; the rest (playtime,
  // value, sales, sorted-by field, collection badge) unfurls on hover.
  const head = [row.platform, relDisp].filter((x) => x != null && x !== "").map((x) => escapeHtml(String(x)));
  const extra = parts.slice(head.length);
  return `${meta}${rating}<div class="card-title" title="${title}">${title}</div>` +
    `<div class="card-sub">${head.join(" · ")}</div>` +
    `<div class="card-extra"><div>` +
      (extra.length ? `<div class="card-sub">${extra.join(" · ")}</div>` : "") +
      collectionBadgeHtml(row) + sortValueHtml(row) +
    `</div></div>`;
}

// A little VR-headset badge for the top-right of a poster card. `row.vr` is the
// sheet's VR bool (parse.py), already on every row. Returns "" for flat games so
// the badge only ever appears where it means something. pointer-events:none in
// CSS keeps it from stealing the card's hover/click.
const vrBadgeHtml = (row) =>
  row && row.vr
    ? `<span class="vr-badge" title="Playable in VR" aria-label="Playable in VR">${icon("i-vr", 15)}</span>`
    : "";

/* The listing card, in ONE place.

   The grid builds its cards imperatively — it needs the row map, the hover-preview wiring
   and the fan-in stagger — but everywhere else just wants a string of the same thing. Home's
   shelves, the Challenges timeline and the grid all render the identical poster: cover,
   title, platform · year, and an optional note line. When they each had their own copy of
   this markup they drifted, and a game looked like a different kind of object depending on
   which tab you found it on.

   `note` is free HTML because the callers mean different things by it — Home says why it
   picked the game, the timeline says which bucket it cleared and when. */
function posterCardHtml(row, { cls = "", note = "", attrs = "" } = {}) {
  const cs = coverSrc(ENRICH[row._k], "cover_big");
  const pixel = coverIsPixelArt(ENRICH[row._k], cs) ? " pixel" : "";
  const title = escapeHtml(String(row.title || row.game || "Untitled"));
  const cover = cs
    ? `<img class="card-cover${pixel}" loading="lazy" src="${escapeHtml(cs)}" alt="">`
    : `<div class="card-cover ph">${icon("i-library", 26)}</div>`;
  const sub = [row.platform, row.releaseYear].filter((x) => x != null && x !== "")
    .map((x) => escapeHtml(String(x))).join(" · ");
  return `<button class="card${cls ? " " + cls : ""}" ${attrs}>
    ${cover}${vrBadgeHtml(row)}
    <div class="card-body">
      <div class="card-title">${title}</div>
      <div class="card-sub">${sub}</div>
      ${note ? `<div class="card-note">${note}</div>` : ""}
    </div></button>`;
}

function renderGrid(pageRows) {
  const grid = $("#grid");
  stopPreview();                 // the card it was attached to is about to vanish
  grid.innerHTML = "";
  pageRows.forEach((row, i) => {
    const cs = coverSrc(ENRICH[row._k], "cover_big");
    const pend = coverPending(row);
    const pixel = coverIsPixelArt(ENRICH[row._k], cs) ? " pixel" : "";
    const cover = cs
      ? `<img class="card-cover${pixel}" loading="lazy" src="${cs}" alt="">`
      : `<div class="card-cover ph${pend ? " skel" : ""}">${pend ? "" : icon("i-library", 26)}</div>`;
    const card = document.createElement("div");
    card.style.setProperty("--i", Math.min(i, 24) * 22 + "ms");   // fan-in stagger
    // A part-finished collection is yellow, and that beats the green "done"
    // ring — the compilation itself isn't finished even on the Completed tab.
    const cstat = collectionStatus(row);
    card.className = "card" + (cstat === "partial" ? " partial"
      : (cstat === "complete" || rowCompleted(row)) ? " done" : "");
    if (row._k) card.dataset.k = row._k;
    CARD_ROW.set(card, row);
    card.innerHTML = `${cover}${vrBadgeHtml(row)}<div class="card-body">${cardBodyHtml(row)}</div>`;
    card.onclick = () => openDrawer(row);
    wirePreview(card);
    grid.appendChild(card);
  });
  // A fresh set of cards: forget who went last and start the idle clock over.
  tourLast = null;
  tourKick();
}
