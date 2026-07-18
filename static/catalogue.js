"use strict";

/* The IGDB catalogue, in the browser — every game IGDB knows that we could rank, and the
   join that decides which of them you already own.

   THE SERVER DOESN'T DO THE JOIN, ON PURPOSE. /api/catalogue is sheet-unaware (see
   catalogue.py): a pure function of the nightly crawl, byte-identical for every visitor,
   so ?g=<generation> makes it immutable and the service worker keeps it for a day instead
   of refetching 2.2MB every session. The cost is ~30% more rows than a filtered payload.
   What it buys, beyond the cache, is correctness in two directions:

     - The enrichment map is the only copy that is never stale. It lands asynchronously for
       minutes after boot and keeps landing (loadAllEnrichment re-polls every 45s during a
       backfill), and a manual override can move a sheet row from one IGDB id to another
       without changing any count the server could have cached against. A game becomes
       yours WHILE YOU ARE LOOKING AT THE LIST.
     - Filtering server-side would be one-way. A game the server excluded could never come
       back into the pool here, because it was never sent.

   THE JOIN IS ON igdbId, NOT ON A TITLE. Every matched sheet row's enrichment record
   carries the id of the IGDB entry it matched, so "do I own this?" is an integer
   comparison that cannot mismatch — the same rule that makes PCGamingWiki and Wikidata
   trustworthy (see the README). The id join has exactly one blind spot: a sheet row the
   matcher never resolved has no igdbId at all, so its game would be offered back to you as
   a discovery. NO_MATCH names precisely those rows, and `_k` is
   normalize(title)|platform|year — so its normalized title is already sitting in the key,
   computed by the same Python normalizer that made the catalogue's `norm`. No JS port, no
   drift, and the net is scoped to the games that actually need it: a blanket title filter
   would suppress the 2019 Resident Evil 2 because you own the 1998 one.

   Both sets are memoised against _enrichEpoch and dropped by resetCatalogue(), which
   panels.js calls from the same block that already re-does health, groups and challenges
   when enrichment lands. That block is the mechanism; this is just another subscriber. */

let CAT = null;                 // null = not fetched yet; [] = disabled, or nothing to rank
let CAT_ERROR = false;
let _catPromise = null;
let _catRows = null, _catRowsEpoch = -1;
let _sheetIds = null, _sheetIdsEpoch = -1;
let _unmatchedNames = null, _unmatchedEpoch = -1;

const catMeta = () => (DATA && DATA.meta && DATA.meta.catalogue) || {};
const catEnabled = () => !!(catMeta().enabled && catMeta().generation);

/* Fetch once per generation, and never on boot. 2.2MB is not a thing to spend on someone
   who came to look at their shelf. Every caller goes through here; the promise is the lock,
   so two tabs asking at once still make one request. */
function ensureCatalogue() {
  if (_catPromise) return _catPromise;
  if (!catEnabled()) { CAT = []; return (_catPromise = Promise.resolve([])); }
  return (_catPromise = fetchCatalogue());
}

async function fetchCatalogue() {
  try {
    // ?g= is a cache key, not a selector — the server ignores it and always answers with
    // the current generation, which is why the body says which one it actually is. A stale
    // g costs a wasted cache entry, never wrong data.
    const res = await fetch(`api/catalogue?g=${encodeURIComponent(catMeta().generation)}`);
    const j = await res.json();
    if (!j || j.enabled === false || j.ready === false || !j.games) { CAT = []; return CAT; }
    CAT = hydrateCatalogue(j);
  } catch (_) {
    CAT_ERROR = true;
    CAT = [];
  }
  resetCatalogue();
  return CAT;
}

/* The wire format is arrays-of-arrays against a vocabulary, because at 34k games the key
   names ARE the payload. Rebuild rows that the rest of the app can treat like sheet rows:
   `_igdb` is what igdbRecOf() hands back, and its keys deliberately match an enrichment
   record's, so the model and the facets read one vocabulary rather than two. */
function hydrateCatalogue(j) {
  const F = {};
  j.fields.forEach((name, i) => { F[name] = i; });
  const V = j.vocab || {};
  const pull = (g, ns) => (g[F[ns]] || []).map((i) => V[ns][i]).filter(Boolean);
  const out = [];
  for (const g of j.games) {
    const rec = {
      igdbId: g[F.id], name: g[F.name], cover: g[F.cover], year: g[F.year],
      rating: g[F.rating], ratingCount: g[F.ratingCount],
      userRating: g[F.userRating], userRatingCount: g[F.userRatingCount],
      criticRating: g[F.criticRating], criticCount: g[F.criticCount],
      genres: pull(g, "genres"), themes: pull(g, "themes"), gameModes: pull(g, "modes"),
      perspectives: pull(g, "persp"), developers: pull(g, "devs"),
      publishers: pull(g, "pubs"), franchises: pull(g, "frans"),
      keywords: pull(g, "keywords"), engines: pull(g, "engines"),
      url: g[F.slug] ? `https://www.igdb.com/games/${g[F.slug]}` : null,
      source: "igdb",
    };
    out.push({
      _cat: true,                    // "not a row on the sheet" — what the facet reads
      _igdb: rec,                    // what igdbRecOf() finds (predict.js, rowFacetItems)
      igdbId: rec.igdbId,
      _norm: g[F.norm],              // for the NO_MATCH net; null when the name won't normalize
      _parent: g[F.parentId],        // the game this is an edition/port/remaster OF…
      _vparent: g[F.versionParentId], // …IGDB uses either field, unpredictably
      title: rec.name,
      releaseYear: rec.year,
      gameType: g[F.type],
    });
  }
  return out;
}

// ---- the join ------------------------------------------------------------
/* Every IGDB id the sheet has claimed — DIRECTLY, or as an edition of.
   Rebuilt whenever enrichment moves, which it does for minutes after boot: this set grows
   under you, and a game leaving the list because you just matched it is the feature.

   The parents matter as much as the ids. You own "Divinity: Original Sin II - Definitive
   Edition"; IGDB files that as its own entry whose parent_game is plain "Divinity:
   Original Sin II" — a Main Game, well reviewed, not on your sheet, and therefore a
   perfect recommendation for a game you have already played. Claiming a row's parents
   alongside the row itself is what stops that.

   BOTH parent fields, because IGDB chooses between them with no discernible rule: the
   Definitive Edition hangs off `parent_game`, the Divine Edition off `version_parent`.
   Reading one catches half the cases, which is worse than reading none — it looks fixed. */
function sheetIgdbIds() {
  if (_sheetIds && _sheetIdsEpoch === _enrichEpoch) return _sheetIds;
  const s = new Set();
  for (const k in ENRICH) {
    // Synthetic catalogue-backed rows seed ENRICH under private keys (`wl:` for a
    // wishlist-only game, `rec:` for a recommendation) so their card/drawer find a cover by
    // igdb id — but they are NOT games you own. Counting them here marks every wishlisted /
    // recommended game as "on the sheet", which empties the Recommend and Pick pools the
    // instant those tabs seed them. Only real sheet rows (key = normalize|platform|year)
    // and their relations count as owned.
    if (k.startsWith("wl:") || k.startsWith("rec:")) continue;
    const e = ENRICH[k];
    if (e.igdbId != null) s.add(e.igdbId);
    const r = e.rel;
    if (!r) continue;
    if (r.parentId != null) s.add(r.parentId);
    if (r.versionParentId != null) s.add(r.versionParentId);
  }
  _sheetIdsEpoch = _enrichEpoch;
  return (_sheetIds = s);
}

/* The normalized titles of games we looked up and definitively found nothing for. Scoped
   to NO_MATCH rather than the whole sheet on purpose: normalize() drops subtitles and
   punctuation, so "resident evil 2" is one key for both the 1998 game and the 2019 remake,
   and a blanket title filter would hide the remake because you own the original. Applied
   only to rows with no igdbId, that collision cost is bounded to the games that have no
   other way of being recognised. */
function unmatchedNames() {
  // Its OWN epoch, not _sheetIdsEpoch. That one is written by sheetIgdbIds(), which
  // catInSheet() always calls first — so by the time this guard ran the epoch had already
  // been refreshed and the stale set sailed through it for the rest of the session. Every
  // backfill silently poisoned "do I already own this?", which is what Recommend and Pick
  // are built on.
  if (_unmatchedNames && _unmatchedEpoch === _enrichEpoch) return _unmatchedNames;
  _unmatchedEpoch = _enrichEpoch;
  const s = new Set();
  for (const k of NO_MATCH) {
    const norm = String(k).split("|")[0];
    if (norm) s.add(norm);
  }
  return (_unmatchedNames = s);
}

/* Is this catalogue game already on the sheet — or near enough to it that offering it
   would be offering you a game you have played?

   Four ways in, and the last three all say "same game, different box":
     - its id is one the sheet claims (or the parent of one — see sheetIgdbIds);
     - it is an edition/port/remaster OF something you own (its parent is claimed);
     - it SHARES a parent with something you own, which is how two editions of one game
       find each other when you own neither the base game nor this particular box;
     - IGDB never matched your row at all, so no id can see it, and only the name can. */
function catInSheet(row) {
  const ids = sheetIgdbIds();
  if (ids.has(row.igdbId)) return true;
  if (row._parent != null && ids.has(row._parent)) return true;
  if (row._vparent != null && ids.has(row._vparent)) return true;
  return !!(row._norm && unmatchedNames().has(row._norm));
}

/* Games you cannot finish alone. Apex Legends is a fine game and a nonsense
   recommendation for a collection built out of things you play to the end: IGDB says its
   modes are Multiplayer, Co-operative and Battle Royale, and no Single player.

   Only when the modes are KNOWN. An empty gameModes means IGDB didn't say, not that the
   game is multiplayer-only, and throwing those away would silently drop every obscure
   game with thin metadata — which is most of the catalogue. */
const catMultiplayerOnly = (row) => {
  const m = row._igdb.gameModes || [];
  return m.length > 0 && !m.includes("Single player");
};

/* The catalogue games you do NOT own — the pool a recommendation can come from.
   Multiplayer-only games are out here rather than in the tab, because Pick wants the same
   answer: neither "what do I play tonight" nor "what should I buy" is asking about a game
   with no ending. */
function catFresh() {
  if (!CAT) return [];
  if (_catRows && _catRowsEpoch === _enrichEpoch) return _catRows;
  _catRowsEpoch = _enrichEpoch;
  const live = CAT.filter((r) => !catInSheet(r) && !catMultiplayerOnly(r));
  /* And collapse the editions of games that survived, which is the same "same game,
     different box" problem pointed the other way. You own neither Grand Theft Auto V nor
     its Special Edition, so both are honestly Not On The Sheet and both were being offered
     — one at 87% and one at 82%, four rows apart, the same game twice. Keep the entry the
     others hang off: the base game is the one with the reviews and the votes, and an
     edition is a box around it. */
  const surviving = new Set(live.map((r) => r.igdbId));
  _catRowsEpoch = _enrichEpoch;
  return (_catRows = live.filter((r) =>
    !(r._parent != null && surviving.has(r._parent)) &&
    !(r._vparent != null && surviving.has(r._vparent))));
}

function resetCatalogue() {
  _catRows = null; _catRowsEpoch = -1;
  _sheetIds = null; _sheetIdsEpoch = -1;
  _unmatchedNames = null; _unmatchedEpoch = -1;
  if (typeof resetRecs === "function") resetRecs();
}
