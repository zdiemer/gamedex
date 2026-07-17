"use strict";

/* Recommendations — games you don't own, ranked by what you'd probably score them.
 *
 * Everything else in this app recommends out of the backlog, which can only re-rank what
 * you already bought. This is the other half: ~25k games from the IGDB catalogue that the
 * sheet has never heard of, scored by the model in predict.js and argued for by
 * recommend.py's similar-games vote.
 *
 * IT IS A REAL LISTING TAB, not a special page. Recommend rides the SAME pipeline as All
 * Games / Wishlist: a synthetic `DATA.sheets.recs` whose rows are catalogue games, so the
 * facet sidebar, search, grid/table, sort, pager, in-app drawers and hover/autoplay
 * previews all work unchanged. A catalogue game has no owned record, so — exactly like a
 * wishlist-only row — it opens its drawer by IGDB id (`_wlOnly` + `_igdbId`) and pulls its
 * trailer / HowLongToBeat from /api/wishlist/meta on demand (that endpoint is keyed on the
 * igdb id, not on anything wishlist-specific).
 *
 * TWO VOICES behind the ranking, unchanged from before:
 *   the model    "what would you score this?" — your ratings generalised through IGDB's
 *                tags and the two outside opinions. Honest error ~9.1 points (predict.js).
 *   similar_games "IGDB says this is like something you loved" — recommend.py's IDF vote,
 *                which can say WHY. A game both agree on is the default sort ("recScore").
 *
 * Loaded after predict.js and catalogue.js; shares their globals. */

const recsState = { page: 1 };          // legacy holder; the real row state is tabState.recs
let _recsBusy = false;                   // catalogue fetch in flight
let _recsSheetEpoch = -1;                // the enrichment epoch DATA.sheets.recs was built for
const RECS_META = {};                    // igdbId -> per-game meta (video/hltb/platforms) from /api/wishlist/meta
const _recsMetaFetched = new Set();      // igdbIds we've already requested meta for
let _recsMetaBusy = false;

// The synthetic sheet's schema. Genre / Year / Confidence face the sidebar (all known from
// the catalogue at once); Platform and the completion time fill in per game as meta lands,
// so Platform is a card field but NOT a facet — a half-loaded facet would read as wrong.
const REC_COLUMNS = [
  { key: "title",       label: "Title",             type: "text",   facet: false, search: true,  sort: true,  primary: true },
  { key: "platform",    label: "Platform",          type: "text",   facet: false, search: false, sort: true,  primary: true },
  { key: "genre",       label: "Genre",             type: "text",   facet: true,  search: true,  sort: true,  primary: true },
  { key: "predicted",   label: "Predicted",         type: "rating", facet: false, search: false, sort: true,  primary: true },
  { key: "confidence",  label: "Confidence",        type: "text",   facet: true,  search: false, sort: true,  primary: false },
  { key: "releaseYear", label: "Release Year",      type: "year",   facet: true,  search: false, sort: true,  primary: false },
  { key: "voters",      label: "Voters",            type: "int",    facet: false, search: false, sort: true,  primary: false },
  { key: "because",     label: "Because you liked", type: "text",   facet: false, search: false, sort: false, primary: false },
];

const recsDismissed = () => new Set(prefsLocal("dismissed"));

function recsDismiss(id) {
  const cur = prefsLocal("dismissed");
  if (!cur.includes(id)) prefsSave("dismissed", [...cur, id]);
  buildRecsSheet(true);
  if (activeTab === "recs") renderAll();
}
function recsUndismissAll() {
  prefsSave("dismissed", []);
  buildRecsSheet(true);
  if (activeTab === "recs") renderAll();
}

/* The similar-games vote, indexed by igdbId so it joins to a catalogue row exactly.
   recommend.py's `catalogue` arm is its backlog recommender pointed at games you don't own. */
function recsBecause() {
  const out = new Map();
  for (const r of (RECS && RECS.catalogue) || []) if (r.igdbId != null) out.set(r.igdbId, r);
  return out;
}

/* Score every catalogue game we don't own. ~25k rows through a 22-feature ridge — about a
   second, so it's done ONCE per enrichment epoch and cached. The epoch is the right key: the
   pool shrinks as enrichment matches more of the sheet (a game you own drops out). */
let _recsRanked = null, _recsEpoch = -1;
function recsRanked() {
  if (_recsRanked && _recsEpoch === _enrichEpoch) return _recsRanked;
  const because = recsBecause();
  const out = [];
  for (const row of catFresh()) {
    const p = predictedCached(row);
    if (!p) continue;
    out.push({ row, p, because: because.get(row.igdbId) || null });
  }
  _recsEpoch = _enrichEpoch;
  return (_recsRanked = out);
}

// "Best of both": the model's score, lifted a little by how hard the similar-games vote
// argues for it — multiplicative on a small bonus so a game nothing vouches for isn't pushed
// DOWN (most of the catalogue has no vote; that's silence, not a negative). Default sort.
const recsBoth = (x) => x.p.score * (1 + Math.min(0.15, (x.because ? x.because.score : 0) * 0.05));

// One synthetic row for a ranked catalogue game. Mirrors a wishlist-only row: `_wlOnly` +
// `_igdbId` make the shared drawer load its detail by id and suppress the launch/box-art
// controls; `_recOnly` flags it for the predicted badge + dismiss. ENRICH[`rec:<id>`] is
// seeded so the card/preview find the cover and maybeEnrich treats the synthetic key as
// answered (it never asks the server about a game that isn't on the sheet).
function recRow(x) {
  const { row, p, because } = x;
  const rec = row._igdb;
  const id = row.igdbId;
  const k = `rec:${id}`;
  const e = ENRICH[k] || (ENRICH[k] = {});
  if (rec.cover && !e.cover) e.cover = rec.cover;
  if (!e.igdbId) e.igdbId = id;
  // Seed the genre list so the Genre facet sees every genre, not just row.genre's first one
  // (unifiedGenreVals reads ENRICH[_k].genres when igdbId is set).
  if (rec.genres && !e.genres) e.genres = rec.genres;
  const m = RECS_META[id] || null;
  if (m) {
    if (m.video && !e.video) e.video = m.video;
    if (m.shots && !e.shots) e.shots = m.shots;   // trailer-less: screenshots for the hover fade
    for (const f of ["hltbMain", "hltbBest", "hltbUrl"]) if (m[f] != null && e[f] == null) e[f] = m[f];
  }
  const conf = p.confidence >= 0.75 ? "High" : p.confidence >= 0.5 ? "Fair" : "Low";
  return {
    title: row.title, _k: k, _wlOnly: true, _recOnly: true, _igdbId: id, _igdb: rec,
    platform: (m && m.platforms && m.platforms[0]) || null,
    genre: (rec.genres && rec.genres[0]) || null,
    releaseYear: rec.year || null,
    release: (m && m.release) || null,
    predicted: p.score,
    confidence: conf,
    voters: rec.userRatingCount != null ? rec.userRatingCount : null,
    because: because ? because.because.slice(0, 3).join(", ") : null,
    recScore: recsBoth(x),
    _recConf: p.confidence,
    _recWhy: because ? `Like ${because.because.slice(0, 2).join(" & ")}` : null,
  };
}

// (Re)build DATA.sheets.recs from the ranked catalogue, minus your dismissals. Cheap enough
// to redo on any epoch change; `force` rebuilds regardless (a dismiss, a meta merge).
function buildRecsSheet(force) {
  if (!DATA || !DATA.sheets) return;
  if (!force && DATA.sheets.recs && _recsSheetEpoch === _enrichEpoch) return;
  const dismissed = recsDismissed();
  const rows = [];
  for (const x of recsRanked()) {
    const id = x.row.igdbId;
    if (id == null || dismissed.has(id)) continue;
    rows.push(recRow(x));
  }
  DATA.sheets.recs = { columns: REC_COLUMNS, rows };
  _recsSheetEpoch = _enrichEpoch;
  resetSearchCache();               // the rows array changed identity (see filters.js memo)
}

// Merge freshly-fetched meta into the EXISTING rows + ENRICH in place — the trailer id (for
// the hover/tour preview), the completion time (Estimated Time), the storefront platform and
// full release date — so a repaint picks them up without a full sheet rebuild.
function mergeRecsMeta() {
  const sh = DATA.sheets.recs;
  if (!sh) return;
  for (const row of sh.rows) {
    const m = RECS_META[row._igdbId];
    if (!m) continue;
    const e = ENRICH[row._k] || (ENRICH[row._k] = {});
    if (m.video && !e.video) e.video = m.video;
    if (m.shots && !e.shots) e.shots = m.shots;   // trailer-less: screenshots for the hover fade
    for (const f of ["hltbMain", "hltbBest", "hltbUrl"]) if (m[f] != null && e[f] == null) e[f] = m[f];
    if (!row.platform && m.platforms && m.platforms[0]) row.platform = m.platforms[0];
    if (!row.release && m.release) row.release = m.release;
  }
}

// Fetch per-game meta for the rows on screen (called from renderTable after paint). The
// catalogue payload has covers + tags but no trailer / HLTB / platform — those come from the
// same /api/wishlist/meta the Wishlist tab uses, one page's worth at a time (25k games can't
// all be fetched). One repaint per page's first meta load, then it's cached.
async function loadRecsMeta(pageRows) {
  const need = pageRows.map((r) => r && r._igdbId).filter((id) => id && !_recsMetaFetched.has(id));
  if (!need.length || _recsMetaBusy) return;
  _recsMetaBusy = true;
  need.forEach((id) => _recsMetaFetched.add(id));
  try {
    for (let i = 0; i < need.length; i += 200) {
      const batch = need.slice(i, i + 200);
      let j = null;
      try { const r = await fetch("api/wishlist/meta?ids=" + batch.join(",")); if (r.ok) j = await r.json(); } catch (_) {}
      if (!j) continue;
      const items = j.items || {};
      for (const id of batch) RECS_META[id] = items[id] || null;
    }
    mergeRecsMeta();
    // Patch in place, don't renderAll: the covers are already there (catalogue art), and the
    // hover preview reads video/shots off ENRICH live, so a full redraw would only flicker the
    // grid and restart the tour. patchEnrichedCells refreshes the card bodies (platform, est
    // time) and the previews light up on the next hover.
    if (activeTab === "recs" && typeof patchEnrichedCells === "function") patchEnrichedCells();
  } finally { _recsMetaBusy = false; }
}

const recsMsg = (html) =>
  `<div class="rec-empty"><h2>${icon("i-sparkle", 20)} Recommendations</h2><p>${html}</p></div>`;

/* The gate: is the tab renderable as a sheet yet? Paints its own loading / empty message
   into #recs and returns false when not; builds the sheet and returns true when ready.
   renderAll (app.js) shows #recs when this is false and the shared listing when it's true. */
function recsReady() {
  const host = $("#recs");
  if (typeof catEnabled === "function" && !catEnabled()) {
    host.innerHTML = recsMsg(`The IGDB catalogue isn't enabled, so there's nothing to recommend from.
      Set <code>igdb.catalogue: true</code> and give the crawl a few minutes.`);
    return false;
  }
  if (typeof CAT === "undefined" || !CAT) {
    host.innerHTML = recsMsg(`${icon("i-sparkle", 16)} Fetching the IGDB catalogue…`);
    if (!_recsBusy && typeof ensureCatalogue === "function") {
      _recsBusy = true;
      ensureCatalogue().then(() => { _recsBusy = false; if (activeTab === "recs") renderAll(); });
    }
    return false;
  }
  if ((typeof CAT_ERROR !== "undefined" && CAT_ERROR) || !CAT.length) {
    host.innerHTML = recsMsg(CAT_ERROR ? "Couldn't fetch the catalogue." : "The catalogue is still being built — check back shortly.");
    return false;
  }
  const m = tasteModel();
  if (!m.ok) {
    host.innerHTML = recsMsg(`Not enough rated games yet to predict anything (${m.n} of ${MIN_HISTORY}).`);
    return false;
  }
  buildRecsSheet(false);
  if (!DATA.sheets.recs.rows.length && recsDismissed().size) {
    host.innerHTML = recsMsg(`Everything's been dismissed. <button class="linkbtn" id="recUndo">Undo all</button>`);
    const u = host.querySelector("#recUndo");
    if (u) u.onclick = recsUndismissAll;
    return false;
  }
  return true;
}

// A small predicted-rating badge for the top-right of a rec card (cardBodyHtml calls this
// through a typeof guard). Only rec rows carry `predicted`, so it's "" everywhere else.
function recsPredictBadge(row) {
  if (!row || row.predicted == null) return "";
  return `<span class="card-meta ${ratingClass(row.predicted)}" title="Predicted rating — how you'd probably score it">${Math.round(row.predicted * 100)}</span>`;
}

// The recommendation block inside a rec game's drawer: the predicted score, the confidence,
// the "because you liked…" reason, and a Not-interested dismiss (openDrawer appends this
// through a typeof guard; the click is delegated in chrome.js).
function recsDrawerHtml(row) {
  if (!row || !row._recOnly) return "";
  const pct = Math.round((row.predicted || 0) * 100);
  const why = row._recWhy ? `<div class="rec-drawer-why">${escapeHtml(row._recWhy)}</div>` : "";
  return `<div class="hltb rec-drawer">
    <div class="hltb-head">${icon("i-sparkle", 14)} Recommended for you</div>
    <div class="rec-drawer-line">
      <b class="rec-drawer-score ${ratingClass(row.predicted || 0)}">~${pct}%</b>
      <span class="muted">predicted · ${escapeHtml(row.confidence || "")} confidence${row.voters != null ? ` · ${row.voters.toLocaleString()} voted` : ""}</span>
    </div>
    ${why}
    <button class="sh-btn rec-dismiss" data-rec-no="${row._igdbId}">Not interested</button>
  </div>`;
}

function resetRecs() { _recsRanked = null; _recsEpoch = -1; _recsSheetEpoch = -1; }
