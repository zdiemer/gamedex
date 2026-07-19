"use strict";

/* IGDB relationships — what the spreadsheet can't express.

   A sheet row is one (game × platform × region). IGDB has one id per GAME, plus
   a real graph on top of it: parent/child, DLC, expansions, remakes, remasters,
   ports, bundles, editions. Two things fall out of that:

   1. A GROUPED VIEW. Rows sharing an IGDB id are the same game — Persona 5 Royal
      on PC, PS4 and Switch is three rows and one game. Grouped, they collapse to
      one card with the platforms listed on it.

   2. A RELATED-GAMES map on the detail card, with the crucial bit a raw IGDB
      dump wouldn't give you: which of the related games are IN YOUR COLLECTION,
      and whether you've finished them. "Resident Evil 4 has a remake — you own
      it, and you've beaten it. It has an expansion, Separate Ways — you don't
      have it."

   Loaded after app.js; shares its globals. */

// ---- who owns what -------------------------------------------------------
// igdbId -> the rows in your collection that matched it.
let _byIgdb = null, _completedSet = null, _gamesByGid = null;
const resetRelations = () => {
  _byIgdb = null; _completedSet = null; _relById = null;
  _gamesByGid = null; _gidCache = new WeakMap();
};

// The completed sheet's rows, by object identity — for telling a beaten episode apart
// from a backlog one. A row here IS finished; that's the whole point of the sheet.
function completedRowSet() {
  if (_completedSet) return _completedSet;
  return (_completedSet = new Set(((DATA.sheets.completed || {}).rows) || []));
}

// igdb_id -> the rows that match it, across BOTH sheets. Episodes (and often
// compilation members) live only in the COMPLETED sheet, so a games-sheet-only index
// counted a fully-beaten episodic game as 0-done.
function rowsByIgdbId() {
  if (_byIgdb) return _byIgdb;
  const m = new Map();
  const add = (r) => {
    const id = (ENRICH[r._k] || {}).igdbId;
    if (!id) return;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(r);
  };
  for (const r of ((DATA.sheets.games || {}).rows || [])) add(r);
  for (const r of ((DATA.sheets.completed || {}).rows || [])) add(r);
  return (_byIgdb = m);
}

// A related row's state in your collection. A completed-sheet row is beaten by
// definition; a games-sheet row goes by its own Completed / Owned flags.
function relRowState(r) {
  if (!r) return "none";
  if (r.completed || completedRowSet().has(r)) return "done";
  if (r.owned) return "owned";
  return "listed";
}

// Names compared as bare alphanumerics — accents folded, punctuation dropped.
// The join key of last resort, everywhere a record has no IGDB id to match on
// (IGN/Steam/LaunchBox matches, unenriched rows, similar.js's name grouping).
const relNorm = (s) => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]/g, "");

// ---- grouped view --------------------------------------------------------
// Rows sharing an IGDB id are the same game. So are PORTS and their parent: IGDB
// gives a port its own id, but "Chrono Trigger (DS)" is not a different game
// from "Chrono Trigger" — it's the same game on another machine, which is
// exactly what this view exists to collapse.
//
// Remakes and remasters are deliberately NOT folded in. Resident Evil 4 (2005)
// and Resident Evil 4 (2023) really are different games — you can beat one and
// not the other, and you rate them separately. They stay apart, and the
// relationship map on the detail card is where you see they're connected.
const MERGE_TYPES = new Set(["Port"]);

// Walk a port up to the game it's a port of. Bounded: a cycle in IGDB's data
// (or a port of a port of a port) must not spin forever.
function canonicalGameId(row) {
  let id = (ENRICH[row._k] || {}).igdbId;
  if (!id) return null;
  const seen = new Set();
  for (let hop = 0; hop < 4; hop++) {
    if (seen.has(id)) break;
    seen.add(id);
    const rel = relById(id);
    if (!rel || !MERGE_TYPES.has(rel.type) || !rel.parentId) break;
    id = rel.parentId;
  }
  return id;
}

// row → canonical id, memoised — the facet counter asks per column per row, which
// is 20+ sweeps of the sheet per render. Reset with the rest (resetRelations).
let _gidCache = new WeakMap();
function cachedGameId(row) {
  if (_gidCache.has(row)) return _gidCache.get(row);
  const id = canonicalGameId(row);
  _gidCache.set(row, id);
  return id;
}

// canonical id → every GAMES-sheet copy of that game, regardless of any active
// filter. This is how a plain platform-copy drawer (a Pick roll, a challenge
// card, a Home poster) finds its siblings, and how a filtered group's drawer
// still routes to the copies the filter hid.
function gamesByGid() {
  if (_gamesByGid) return _gamesByGid;
  const m = new Map();
  for (const r of ((DATA.sheets.games || {}).rows || [])) {
    const id = cachedGameId(r);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(r);
  }
  return (_gamesByGid = m);
}

// The relation summary for an IGDB id, from whichever of our rows matched it.
let _relById = null;
function relById(id) {
  if (!_relById) {
    _relById = new Map();
    for (const e of Object.values(ENRICH)) {
      if (e && e.igdbId && e.rel && !_relById.has(e.igdbId)) _relById.set(e.igdbId, e.rel);
    }
  }
  return _relById.get(id);
}

function groupByGame(rows, allRows) {
  const out = [], seen = new Map();
  for (const r of rows) {
    const id = cachedGameId(r);
    if (!id) { out.push(r); continue; }          // no IGDB match: can't claim it's the same game
    if (seen.has(id)) { seen.get(id).push(r); continue; }
    const members = [r];
    seen.set(id, members);
    out.push({ _group: id, _members: members });
  }
  /* Full sibling sets, when the caller can name the unfiltered universe (the
     listing passes its whole sheet): the CARD describes the copies that matched
     the filter, but the drawer's "Your copies" routes to every copy — a PS4
     filter shouldn't make the PC copy unreachable, just unfeatured. */
  let full = null;
  if (allRows && allRows !== rows) {
    full = new Map();
    for (const r of allRows) {
      const id = cachedGameId(r);
      if (!id) continue;
      if (!full.has(id)) full.set(id, []);
      full.get(id).push(r);
    }
  }
  // A "group" of one is just the row itself; don't wrap it in ceremony. (Its
  // hidden siblings still surface in the drawer — editionsHtml looks them up.)
  return out.map((x) => (x._group && x._members.length === 1 ? x._members[0] : x))
    .map((x) => (x._group ? groupRow(x, full && full.get(x._group)) : x));
}

// Value fields a group AVERAGES across the copies that have one — a null is
// "not filled in", not a zero, so it's excluded rather than dragging the mean.
// The lead's number alone misrepresented the group (and sorting by rating in
// combine mode sorted by whichever copy happened to lead).
const GROUP_AVG_KEYS = ["rating", "metacriticRating", "gamefaqsUserRating", "playingProgress",
  "completionTime", "estimatedTime", "purchasePrice", "playTime", "price"];

// The synthetic row standing in for a group of editions.
function groupRow(g, fullMs) {
  const ms = g._members;
  // The card should be titled after the GAME, so prefer a row that matched the
  // canonical id itself (the original) over one of its ports. Then prefer the
  // copy you've actually played, then one you own, then the newest.
  const originals = ms.filter((r) => (ENRICH[r._k] || {}).igdbId === g._group);
  const pool = originals.length ? originals : ms;
  const lead = pool.find((r) => r.completed) || pool.find((r) => r.owned) ||
    pool.slice().sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")))[0];
  const platforms = [...new Set(ms.map((r) => r.platform).filter(Boolean))];
  const avg = {};
  for (const key of GROUP_AVG_KEYS) {
    const real = ms.map((r) => r[key]).filter((v) => v != null && v !== "" && !isNaN(Number(v)));
    if (real.length) avg[key] = real.reduce((s, v) => s + Number(v), 0) / real.length;
  }
  return {
    ...lead,
    ...avg,
    _k: lead._k,
    _groupId: g._group,
    // Every copy when the caller told us the universe; the filtered ones otherwise.
    _members: fullMs && fullMs.length > ms.length ? fullMs : ms,
    // The copies the averages above were computed over — so collectionValueOf
    // and the drawer's group history aggregate over the SAME set instead of
    // _members, which under a filter is the wider universe.
    _aggMembers: ms,
    _platforms: platforms,
    completed: ms.some((r) => r.completed),
    owned: ms.some((r) => r.owned),
    // Name the platforms while they fit — "PS4 · PC · Switch" answers the question
    // "which copies?" that "3 platforms" only raises. Four or more falls back to
    // the count; the card sub-line is one ellipsized line.
    platform: platforms.length > 1
      ? (platforms.length <= 3 ? platforms.join(" · ") : `${platforms.length} platforms`)
      : lead.platform,
  };
}

// Grouped size of the WHOLE sheet, for the count line: with combine on the
// numerator counts grouped cards, so a raw-row denominator reads as a filter
// that isn't there — "1,182 of 14,768 games" with nothing filtered. Cached by
// sheet-rows identity + enrichment epoch (grouping shifts as igdbIds land).
let _groupTotal = { rows: null, epoch: -1, n: 0 };
function groupedTotalOf(rows) {
  if (_groupTotal.rows === rows && _groupTotal.epoch === _enrichEpoch) return _groupTotal.n;
  _groupTotal = { rows, epoch: _enrichEpoch, n: groupByGame(rows).length };
  return _groupTotal.n;
}

// ---- the detail card's relationship map ----------------------------------
// [key, label, single, progress] — progress sections are the ones that are a WHOLE
// made of parts you collect (episodes, a bundle's games, DLC), so they show how far
// through them you are.
const REL_SECTIONS = [
  ["parent", "Part of", true, false],
  ["versionParent", "Edition of", true, false],
  ["episodes", "Episodes", false, true],
  ["seasons", "Seasons", false, true],
  ["bundleContents", "In this bundle", false, true],
  ["expandedGames", "Expanded editions", false, false],
  ["remakes", "Remakes", false, false],
  ["remasters", "Remasters", false, false],
  ["ports", "Ports", false, false],
  ["forks", "Other versions", false, false],
  ["expansions", "Expansions", false, true],
  ["standaloneExpansions", "Standalone expansions", false, true],
  ["dlcs", "DLC", false, true],
  ["bundles", "Bundled in", false, false],
];

// How far through a set of related games you are — beaten, owned, total.
function relProgress(list) {
  let done = 0, owned = 0;
  for (const e of list) {
    const states = (rowsByIgdbId().get(e.id) || []).map(relRowState);
    if (states.includes("done")) done++;
    else if (states.includes("owned")) owned++;
  }
  return { done, owned, total: list.length };
}

// True when this game already has an IGDB grouping — so the in-house sheet Collection
// should stand aside for it (IGDB wins, the sheet is the fallback).
const IGDB_GROUPS = ["episodes", "seasons", "bundleContents", "dlcs", "expansions", "standaloneExpansions"];
function relationsHaveGrouping(detail) {
  const rel = detail && detail.relations;
  return !!rel && IGDB_GROUPS.some((k) => (rel[k] || []).length);
}

// A related game, annotated with whether it's in your collection.
function relCardHtml(entry) {
  const mine = rowsByIgdbId().get(entry.id) || [];
  const row = mine.find((r) => relRowState(r) === "done")
    || mine.find((r) => relRowState(r) === "owned") || mine[0];
  const state = relRowState(row);
  const sheet = row && completedRowSet().has(row) ? "completed" : "games";
  const cover = entry.cover ? IMG(entry.cover, "cover_small") : (row ? coverSrc(ENRICH[row._k], "cover_small") : "");
  const badge = { done: "✓ Beaten", owned: "● Owned", listed: "In your list", none: "Not in your collection" }[state];
  const art = cover
    ? `<img loading="lazy" src="${escapeHtml(cover)}" alt="">`
    : `<span class="rl-ph">${icon("i-library", 18)}</span>`;
  return `<button class="rl-card rl-${state}"${row ? ` data-rlk="${escapeHtml(String(row._k))}" data-rls="${sheet}"` : ""}
      title="${escapeHtml(entry.name)}">
    ${art}
    <span class="rl-txt">
      <b>${escapeHtml(entry.name)}</b>
      <span class="rl-badge rl-b-${state}">${badge}</span>
    </span>
  </button>`;
}

function relationsHtml(detail) {
  const rel = detail && detail.relations;
  if (!rel) return "";

  const sections = [];
  for (const [key, label, single, progress] of REL_SECTIONS) {
    const v = rel[key];
    const list = single ? (v ? [v] : []) : (v || []);
    if (!list.length) continue;
    let head = `${escapeHtml(label)}<span class="muted">${single ? "" : ` ${list.length}`}</span>`;
    if (progress && list.length) {
      const p = relProgress(list);
      const pct = Math.round((p.done / p.total) * 100);
      head += `<span class="rl-prog"><span class="rl-prog-bar"><span style="width:${pct}%"></span></span>`
        + `<span class="rl-prog-txt">${p.done} of ${p.total} beaten${p.owned ? ` · ${p.owned} more owned` : ""}</span></span>`;
    }
    sections.push(`<div class="rl-sect">
      <h4>${head}</h4>
      <div class="rl-row">${list.map(relCardHtml).join("")}</div>
    </div>`);
  }
  if (!sections.length) return "";

  const kind = rel.gameTypeLabel && rel.gameTypeLabel !== "Main game"
    ? `<span class="rl-kind">${escapeHtml(rel.gameTypeLabel)}${rel.versionTitle ? ` · ${escapeHtml(rel.versionTitle)}` : ""}</span>` : "";
  return `<div class="rl">
    <div class="rl-head"><h3>${icon("i-layers", 16)} Related games</h3>${kind}</div>
    ${sections.join("")}
  </div>`;
}

// Clicking a related game you own opens it.
function wireRelations(scope) {
  scope.querySelectorAll("[data-rlk]").forEach((el) => {
    el.onclick = () => {
      const sheet = el.dataset.rls || "games";   // episodes open in the Completed sheet
      const row = ((DATA.sheets[sheet] || {}).rows || []).find((r) => String(r._k) === el.dataset.rlk);
      if (row) openDrawerFrom(row, sheet);        // navigation: keep a way back
    };
  });
}

// The other editions of THIS game that you own — shown on the grouped card and
// in the drawer, so a group is never a black box. Each copy carries its own
// platform-account meta (Steam hours, trophy counts, store reviews): the group
// drawer deliberately doesn't show these — they are one copy's story, and this
// list is where that copy gets to tell it (click through for the full grid).
//
// A PLAIN platform-copy drawer routes here too: a Pick roll, a challenge card
// or a Home poster is deliberately one copy, but its siblings shouldn't be a
// dead end — same list, with the copy you're viewing marked. The click handler
// (drawer.js) reads DRAWER_EDITIONS because a plain row has no _members.
let DRAWER_EDITIONS = null;
function editionsHtml(row) {
  let ms = row._members;
  if ((!ms || ms.length < 2) && row._k && !row._collection && !row._wlOnly
      && (typeof drawerSheet === "undefined" || drawerSheet === "games")) {
    const sibs = gamesByGid().get(cachedGameId(row)) || [];
    if (sibs.length >= 2 && sibs.includes(row)) ms = sibs;
  }
  DRAWER_EDITIONS = ms || null;
  if (!ms || ms.length < 2) return "";
  return `<div class="rl">
    <div class="rl-head"><h3>${icon("i-combine", 16)} Your copies <span class="muted">${ms.length}</span></h3></div>
    <div class="rl-copies">${ms.map((m, i) => {
      const e = ENRICH[m._k] || {};
      const kind = e.rel && e.rel.type && e.rel.type !== "Main game" ? e.rel.type : "";
      const bits = [m.platform, m.releaseRegion, m.releaseYear].filter(Boolean)
        .map((x) => escapeHtml(String(x))).join(" · ");
      const cur = m === row;
      const mark = cur ? `<span class="rl-b-cur">Viewing</span>`
        : m.completed ? `<span class="rl-b-done">✓ Beaten</span>`
        : m.owned ? `<span class="rl-b-owned">● Owned</span>` : "";
      const mine = typeof minePillsHtml === "function" ? minePillsHtml(m._k) : "";
      return `<button class="rl-copy${cur ? " cur" : ""}" data-rlc="${i}">
        <span class="rl-copy-t">${bits}${kind ? ` <span class="rl-tag">${escapeHtml(kind)}</span>` : ""}</span>${mark}${
        mine ? `<span class="rl-copy-mine mine-pills">${mine}</span>` : ""}</button>`;
    }).join("")}</div>
  </div>`;
}
