"use strict";

/* Similar games, computed at home — feature overlap over YOUR collection.

   IGDB ships a similar_games list with every title, and for years the drawer
   filtered it down to the games you own. The problem is where that list comes
   from: it orbits a handful of ubiquitous titles, so every drawer ended up
   recommending the same few games that had nothing to do with the one you
   opened. This module replaces the feed entirely. Nothing is fetched: the
   light enrichment map (ENRICH) already carries franchises, developers,
   keywords, themes, genres, modes, perspectives and engines for every matched
   game, so similarity is just weighted overlap between the opened game's
   features and every game on the sheet.

   The anti-ubiquity move is per-feature IDF: a shared token is worth
   log((N+1)/(df+0.5)) — how RARE it is in the collection — times its category
   weight. Sharing "Adventure" with a third of the sheet is worth about a
   point; sharing an eight-entry franchise is worth about eighteen. A lone
   common genre can never seat a result; a franchise sibling almost always
   will.

   Loaded after relations.js; leans on relNorm, cachedGameId and the canon*
   spellings from data.js. */

// Category weights, keyed by token prefix:
//   f franchise · d developer · k keyword · t theme · g genre
//   p perspective · m game mode · e engine · pub publisher
// Engine sits with the weak signals deliberately: engines are rare tokens, so
// at keyword weight "made in Godot" out-scored everything and one drawer
// became a Godot showcase. Sharing an engine seasons a match; it isn't one.
const SIM_W = { f: 3.0, d: 2.0, k: 2.0, t: 1.0, g: 1.0, p: 0.5, m: 0.5, e: 0.5, pub: 0.5 };
const SIM_YEAR_W = 1.5;       // era proximity: max bonus at Δ0, fading linearly…
const SIM_YEAR_SPAN = 12;     // …to zero at this many years apart
const SIM_QUERY_KW_CAP = 15;  // query keywords kept (by idf) — tag-stuffed games don't get extra reach
const SIM_MIN_SCORE = 5.0;    // below this a match is noise, not a recommendation
const SIM_MIN_SHARED = 2;     // need at least two shared features…
const SIM_STRONG = 5.0;       // …unless one alone is this informative (franchise, rare keyword)
const SIM_TOP_N = 12;
// Franchise siblings are the most ACCURATE matches and the least USEFUL ones —
// you already know the other Zelda games exist, and the franchise facet is one
// click away. They get a few slots as a courtesy; the rest of the row is
// reserved for discovery, which means games that earned their way in without
// the family name.
const SIM_FRANCHISE_CAP = 3;

// One game's feature set: Map("f:zelda" -> {w, label}). Tokens are namespaced
// by category and normalised through the same canon* spellings the facets use,
// so IGDB's "Nintendo EPD" and the sheet's "Nintendo" agree before comparing.
// The sheet row's scalar columns are merged in as a floor: a game IGDB never
// matched still plays via its sheet genre/franchise/developer/publisher.
function simTokensOf(e, row) {
  const t = new Map();
  const add = (cat, label) => {
    label = String(label == null ? "" : label).trim();
    const key = label && relNorm(label);
    if (key && !t.has(cat + ":" + key)) t.set(cat + ":" + key, { w: SIM_W[cat], label });
  };
  e = e || {};
  for (const x of e.franchises || []) add("f", canonFran(x));
  for (const x of e.developers || []) add("d", canonDev(x));
  for (const x of e.keywords || []) add("k", x);
  for (const x of e.engines || []) add("e", x);
  for (const x of e.themes || []) add("t", x);
  for (const x of e.genres || []) add("g", canonGenre(x));
  for (const x of e.perspectives || []) add("p", x);
  for (const x of e.gameModes || []) add("m", x);
  for (const x of e.publishers || []) add("pub", canonPub(x));
  if (row) {
    if (row.franchise) add("f", canonFran(row.franchise));
    if (row.developer) add("d", canonDev(row.developer));
    if (row.genre) add("g", canonGenre(row.genre));
    if (row.publisher) add("pub", canonPub(row.publisher));
  }
  // Self-published games list the same company as developer AND publisher, and
  // crediting it twice made "Nintendo · Nintendo" a stronger claim than a
  // shared keyword. One company, one token — the developer slot wins.
  for (const k of [...t.keys()]) {
    if (k.startsWith("pub:") && t.has("d:" + k.slice(4))) t.delete(k);
  }
  return t;
}

// The scoring index over the games sheet: one candidate per GAME (platform
// copies collapse through cachedGameId, name as the unenriched fallback), df
// counted per game so duplicates don't dilute idf, plus an inverted postings
// map so scoring only touches candidates that share something. Built once and
// memoised the way _groupTotal is: against the rows array's identity and the
// enrichment epoch, so a sheet refresh or the light map landing rebuilds it.
let _simIdx = { rows: null, epoch: -1, idx: null };
function simIndex() {
  const rows = ((DATA.sheets.games || {}).rows) || [];
  if (_simIdx.rows === rows && _simIdx.epoch === _enrichEpoch) return _simIdx.idx;
  const groups = new Map();
  for (const r of rows) {
    const gid = cachedGameId(r) || "n:" + relNorm((ENRICH[r._k] || {}).name || r.title);
    if (gid === "n:") continue;
    if (!groups.has(gid)) groups.set(gid, []);
    groups.get(gid).push(r);
  }
  const cands = [], df = new Map();
  for (const [gid, rs] of groups) {
    const row = rs.find((r) => r.completed) || rs.find((r) => r.owned) || rs[0];
    const e = ENRICH[row._k] || {};
    const tokens = simTokensOf(e, row);
    cands.push({
      gid, row, e, tokens,
      year: Number(e.year || row.releaseYear) || null,
      nameKey: relNorm(e.name || row.title),
    });
    for (const k of tokens.keys()) df.set(k, (df.get(k) || 0) + 1);
  }
  const N = cands.length, idf = new Map(), postings = new Map();
  for (const [k, n] of df) idf.set(k, Math.log((N + 1) / (n + 0.5)));
  cands.forEach((c, i) => {
    for (const k of c.tokens.keys()) {
      if (!postings.has(k)) postings.set(k, []);
      postings.get(k).push(i);
    }
  });
  _simIdx = { rows, epoch: _enrichEpoch, idx: { idf, cands, postings } };
  return _simIdx.idx;
}

// The drawer's question: given the opened game's full detail record (and its
// sheet row, when it has one), which games on the sheet are actually like it?
// Returns [{name, cover, row, why}] — the shape detailHtml renders.
function similarByFeatures(detail, row) {
  if (!detail || !ENRICH_ENABLED) return [];
  const { idf, cands, postings } = simIndex();
  const sheetRow = row && !row._wlOnly ? row : null;
  const q = simTokensOf(detail, sheetRow);
  // Keywords are IGDB's long tail — some games carry fifty. Keep the query's
  // most informative few so a tag-stuffed game doesn't out-reach everyone.
  const kws = [...q.keys()].filter((k) => k.startsWith("k:"));
  if (kws.length > SIM_QUERY_KW_CAP) {
    kws.sort((a, b) => (idf.get(b) || 0) - (idf.get(a) || 0));
    for (const k of kws.slice(SIM_QUERY_KW_CAP)) q.delete(k);
  }
  if (q.size < 2) return [];   // nothing to compare on; the block just hides

  const hits = new Map();      // cand index -> running {score, shared, max, kin}
  const isCompany = (k) => k.startsWith("d:") || k.startsWith("pub:");
  for (const [k, qt] of q) {
    const list = postings.get(k);
    if (!list) continue;
    const contrib = qt.w * idf.get(k);
    for (const i of list) {
      let h = hits.get(i);
      if (!h) hits.set(i, (h = { score: 0, shared: 0, max: 0, kin: false }));
      h.score += contrib; h.shared++; if (contrib > h.max) h.max = contrib;
      if (!isCompany(k)) h.kin = true;
    }
  }

  // Self-exclusion has to catch every disguise the opened game wears: its own
  // canonical id (any platform copy), its IGDB id (wishlist/recs rows that are
  // secretly owned), and its normalised name (unenriched copies).
  const qgid = sheetRow || (row && row._k) ? cachedGameId(row) : null;
  const qname = relNorm(detail.name || (row && row.title));
  const qyear = Number(detail.year || (sheetRow && sheetRow.releaseYear)) || null;
  const scored = [];
  for (const [i, h] of hits) {
    const c = cands[i];
    if (c.row === row || (qgid && c.gid === qgid) || (qname && c.nameKey === qname)) continue;
    if (detail.igdbId && (c.e.igdbId === detail.igdbId || c.gid === detail.igdbId)) continue;
    let score = h.score;
    if (qyear && c.year) {
      const dy = Math.abs(qyear - c.year);
      if (dy < SIM_YEAR_SPAN) score += SIM_YEAR_W * (1 - dy / SIM_YEAR_SPAN);
    }
    if (score < SIM_MIN_SCORE) continue;
    if (h.shared < SIM_MIN_SHARED && h.max < SIM_STRONG) continue;
    // Sharing only a company is a catalog, not a kinship — every publisher
    // spans genres. Something about the GAMES must overlap (franchise,
    // keyword, theme, genre, mode…) before a studio-mate can take a seat.
    if (!h.kin) continue;
    scored.push({ c, score });
  }
  scored.sort((a, b) => (b.score - a.score) || ((b.c.e.rating || 0) - (a.c.e.rating || 0)));

  // Seat the list: same-franchise candidates outscore everything (that's the
  // weights working), so without the cap they'd fill every slot. Walk the
  // ranking, let SIM_FRANCHISE_CAP of them through, and give the remaining
  // seats to the best cross-franchise matches. No backfill past the cap — a
  // short honest list beats one padded with sequels.
  const qFran = [...q.keys()].filter((k) => k.startsWith("f:"));
  const seated = [];
  let fran = 0;
  for (const s of scored) {
    if (seated.length >= SIM_TOP_N) break;
    if (qFran.some((k) => s.c.tokens.has(k)) && ++fran > SIM_FRANCHISE_CAP) continue;
    seated.push(s);
  }

  // "Why" — the top shared features by contribution, for the card tooltip.
  // Only computed for the dozen finalists; the intersection is tiny by then.
  return seated.map(({ c }) => {
    const shared = [];
    for (const [k, qt] of q) {
      if (c.tokens.has(k)) shared.push({ label: qt.label, v: qt.w * (idf.get(k) || 0) });
    }
    shared.sort((a, b) => b.v - a.v);
    return {
      name: c.e.name || c.row.title,
      cover: c.e.cover || null,
      row: c.row,
      why: shared.slice(0, 3).map((s) => s.label).join(" · "),
    };
  });
}
