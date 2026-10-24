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
// Per-tab default sort. Every default key is a real, selectable sort column, so the sort
// menu names the actual order (no vague "Default" entry) — recs.js adds a `recScore` column
// ("Best match") so its "best of both" default has a menu entry too.
const DEFAULT_SORT = {
  games: [{ key: "releaseDate", kind: "releaseDateDesc", dir: "desc" }],
  completed: [{ key: "date", dir: "desc", type: "date" }],
  onOrder: [{ key: "orderedDate", dir: "desc", type: "date" }],
  wishlist: [{ key: "dateAdded", dir: "desc", type: "date" }],   // newest wish first, per buildWishlistSheet
  recs: [{ key: "recScore", dir: "desc", type: "number" }],      // "best of both" (recsBoth)
  // A feed answers "what is new", so it opens on the release date. Alphabetical is the
  // wrong first impression for a tab whose whole point is recency.
  translations: [{ key: "released", dir: "desc", type: "date" }],
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
// The per-list filter just FILTERS — it doesn't reorder. Results stay in the tab's chosen (or
// default) sort, so typing a few letters narrows the list in place rather than shuffling it.
// Relevance ranking is the site search's job (search.js / searchScore), not this box's.
function sortRows(rows) {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("sortRows", activeTab) : () => {};
  try { return _sortRows(rows); } finally { end(); }
}

function _sortRows(rows) {
  const spec = effectiveSort();
  return [...rows].sort((a, b) => {
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
  // `kind` rides along: a header can now be a virtual sort's (renderTableView surfaces
  // one), and without the kind cmpBy would read a[key] off the row, find nothing on every
  // row, and leave the list exactly as it came.
  const lvl = (dir) => ({ key: col.key, dir, type: col.type, kind: col.kind });
  if (shift) {
    if (idx === -1) cur.push(lvl(defDir));
    else if (cur[idx].dir === defDir) cur[idx] = lvl(defDir === "asc" ? "desc" : "asc");
    else cur.splice(idx, 1);                       // third shift-click drops this level
  } else {
    if (cur.length === 1 && cur[0].key === col.key)
      cur.splice(0, 1, lvl(cur[0].dir === "asc" ? "desc" : "asc"));
    else { cur.length = 0; cur.push(lvl(defDir)); }
  }
  st.sort = cur.length ? cur : null;
  st.page = 1;
  renderAll();
  nav();
}

// Completed games get a green-bordered card. The Completed tab is all finished;
// on the Games tab it's the per-row Completed flag.
function rowCompleted(row) {
  if (activeTab === "completed") return true;
  if (activeTab === "games") return !!row.completed;
  return false;
}

const CARD_ROW = new WeakMap();

// ---- balanced grid columns ----------------------------------------------
// A plain auto-fill grid leaves the last row ragged — 13·3 + 11 for a 50-card page. Pick a
// column count that divides the page as evenly as possible so every row holds the SAME
// number of cards. The natural (widest-fit) count is read live off the computed grid, which
// honours whatever min the CSS uses at this breakpoint; we only ever REDUCE it (fewer, wider
// columns) and never below ~1.4× the natural card width, so a card can't balloon.
function applyGridColumns(grid) {
  if (!grid) return;
  grid.style.gridTemplateColumns = "";                 // fall back to CSS auto-fill to measure
  const count = grid.querySelectorAll(".card").length;
  if (!count) return;                                  // empty state — nothing to balance
  const natural = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length;
  if (!natural || count <= natural) return;            // fits in one row — leave it left-aligned
  const minCols = Math.max(1, Math.ceil(natural / 1.4));
  let best = natural, bestScore = -Infinity;
  for (let c = minCols; c <= natural; c++) {
    const rem = count % c;
    const score = (rem === 0 ? c : rem) / c;           // fraction of the last row filled; 1 = full
    if (score > bestScore + 1e-9) { bestScore = score; best = c; }
    else if (score > bestScore - 1e-9 && c > best) best = c;   // tie → keep more columns (closer to natural)
  }
  if (best !== natural) grid.style.gridTemplateColumns = `repeat(${best}, minmax(0, 1fr))`;
}

// Re-balance on resize (the natural column count changes with the viewport / open facets).
let _gridColsTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(_gridColsTimer);
  _gridColsTimer = setTimeout(() => {
    const grid = $("#grid");
    if (grid && !$("#gridwrap").hidden) applyGridColumns(grid);
  }, 120);
});
