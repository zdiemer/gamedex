"use strict";

/* Reading the spreadsheet: columns, sort metadata, and the unified vocabulary.

   The sheet and IGDB disagree about names -- "Nintendo EAD" vs "Nintendo EAD
   Tokyo", "Platform" vs "Platformer" -- so a facet built from raw values would
   split one studio across four rows. unifyVocab() canonicalises developers,
   publishers, franchises and genres once per dataset; canonDev/canonPub/canonFran
   are how the rest of the app asks for the answer.

   Also the derived reads every tab wants: playtimeOf, criticOf, userRatingOf. */

// ---- data access --------------------------------------------------------
const sheet = () => DATA.sheets[activeTab];
const columns = () => sheet().columns;
const searchCols = () => columns().filter((c) => c.search).map((c) => c.key);
const colByKey = (key) => columns().find((c) => c.key === key);

// The 13 platforms Co-Optimus covers (see src/cooptimus.py).
const COOP_PLATFORMS = new Set(["Nintendo Switch", "Nintendo Wii U", "PC", "PlayStation 2",
  "PlayStation 3", "PlayStation 4", "PlayStation 5", "Nintendo Wii", "WiiWare", "Xbox",
  "Xbox 360", "Xbox One", "Xbox Series X|S"]);

const titleCase = (s) => String(s).replace(/\b[a-z]/g, (c) => c.toUpperCase());

/* Priority is a LABEL now, not a number — so sorting or listing it alphabetically
   would put "Might Play" above "Must Play" above "Want to Play", which is
   meaningless. Rank it by intent, which is what the number meant. */
const PRIORITY_RANK = {
  "Must Play": 5, "Will Play": 4, "Want to Play": 3, "Might Play": 2, "Will Not Play": 1,
};
const priorityRank = (v) => PRIORITY_RANK[v] ?? 0;

/* One search field. There were three — the top bar, Groupings and Reviews — each
   styled separately and drifting apart. Same markup everywhere now, so the icon,
   the height, the radius and the focus ring can't disagree. */
function searchField(id, placeholder, value = "", cls = "") {
  return `<span class="field ${cls}">
    <svg class="ico" width="15" height="15" aria-hidden="true"><use href="#i-search"/></svg>
    <input id="${id}" type="search" placeholder="${escapeHtml(placeholder)}"
      value="${escapeHtml(String(value))}" autocomplete="off" spellcheck="false">
  </span>`;
}

/* Sort keys that aren't sheet columns. The estimated rating is computed in the
   browser (ridge regression over your own ratings), so there is no cell to sort
   on — cmpBy has to be told how to get the value instead of reading a[key]. */
// The tabs a computed sort is offered on. Wishlist rides the same table/grid
// pipeline as All Games and, since 1.58.7, its unowned rows carry the IGDB
// record these accessors read (predicted score, critic and user ratings all
// resolve off it), and since 1.58.9 a completion time too — IGDB's time-to-beat
// or an HLTB title match — so the whole "what it's worth / how long" cluster is
// worth offering there.
const _worthSortOn = () => activeTab === "games" || activeTab === "wishlist";
const VIRTUAL_SORTS = [
  { key: "__predicted", label: "Estimated Rating", type: "number", kind: "predicted",
    get: (row) => (typeof predictedOf === "function" ? predictedOf(row) : null),
    on: _worthSortOn },
  // These three have fallback chains, which is exactly why they can't be plain
  // columns: the best answer lives in a different source per game. The facets
  // already resolve them, so sorting reuses the same accessors rather than
  // inventing a second, divergent answer.
  { key: "__critic", label: "Critic Rating", type: "number", kind: "critic",
    get: (row) => metacriticOf(row),        // Metacritic scrape → sheet's column
    on: _worthSortOn },
  { key: "__user", label: "User Rating", type: "number", kind: "user",
    get: (row) => userRatingOf(row),        // IGDB → VNDB → GameFAQs
    on: _worthSortOn },
  { key: "__esttime", label: "Estimated Time", type: "number", kind: "esttime",
    get: (row) => playtimeOf(row),          // HLTB → VNDB → the sheet's estimate
    on: _worthSortOn },
];
const sortMeta = (key) => VIRTUAL_SORTS.find((v) => v.key === key) || colByKey(key);

/* The sort menu on All Games. Every sortable column used to be offered — thirty-odd
   options, most of which nobody would ever sort by (File Size, MAME Romset, English).
   A curated list of the ones that answer a real question, in the order you'd reach
   for them: what it is, what it's worth, what it cost, when you played it. */
const GAMES_SORT_MENU = [
  "title", "platform", "releaseDate",
  "rating", "__critic", "__user", "__predicted",
  "priority",
  "datePurchased", "dateAdded", "purchasePrice",
  "dateStarted", "dateCompleted", "completionTime", "__esttime",
];
// The sheet's own headers read as filing-cabinet labels ("Date Purchased"); in a
// sort menu you want the thing first.
const SORT_LABEL = {
  rating: "Rating (yours)",
  datePurchased: "Purchased Date",
  dateAdded: "Added Date",
  dateStarted: "Started Date",
  dateCompleted: "Completed Date",
};
const sortLabel = (c) => SORT_LABEL[c.key] || c.label;

// Virtual facets sourced from IGDB enrichment (array-valued, joined via row._k).
// Genre is NOT here — it's unified with the sheet's Genre facet (see unifiedFacetCol).
const IGDB_FACET_DEFS = [
  { key: "__igdb_theme", label: "Theme", source: "themes" },
  { key: "__igdb_mode", label: "Game Mode", source: "gameModes" },
  // Perspective is NOT a genre, however often it gets filed as one — "First-Person" says
  // where the camera is, not what kind of game it is. IGDB has always told us (Third person,
  // Bird view / Isometric, Side view, First person, Text, VR); we were fetching it, storing
  // it, and never sending it to the browser.
  { key: "__igdb_persp", label: "Perspective", source: "perspectives" },
  // Keywords are the finest vocabulary IGDB has — metroidvania, soulslike, bullet hell,
  // cozy, story rich, multiple endings — once the storefront plumbing is filtered out
  // server-side (see _KEYWORD_JUNK).
  { key: "__igdb_kw", label: "Keyword", source: "keywords" },
  { key: "__igdb_engine", label: "Engine", source: "engines" },
];

/* ---- unifying sheet + IGDB for developer / publisher / franchise / genre ----
 * The sheet holds ONE value per field; IGDB holds many. We join them into one
 * multi-valued facet so a game is filed under every developer/publisher/franchise/
 * genre either source knows — and a value that only IGDB knows (a co-developer not
 * in your sheet) is a real, clickable facet value that filters all the same.
 *
 * External names are mapped onto your sheet's spelling wherever they match; genres,
 * where the sheet is finer-grained than IGDB, roll up into shared umbrellas. */

// Company names: fold to a comparable key (case, punctuation, Inc/Ltd/Co, "the").
// Memoised — called once per row per facet-count pass, but only a few thousand
// distinct strings exist across the whole library.
const _ncCache = new Map();
function normCompany(s) {
  s = String(s || "");
  let v = _ncCache.get(s);
  if (v !== undefined) return v;
  v = s.toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’]/g, "")
    .replace(/\b(inc|incorporated|ltd|limited|llc|co|corp|corporation|company|gmbh|kk|sa|srl|pty|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  _ncCache.set(s, v);
  return v;
}
// Franchise/series titles: lighter touch — drop punctuation, "the", trailing "series".
const _nfCache = new Map();
function normFranchise(s) {
  s = String(s || "");
  let v = _nfCache.get(s);
  if (v !== undefined) return v;
  v = s.toLowerCase()
    .replace(/[.,:'’!?]/g, "")
    .replace(/\bthe\b/g, " ").replace(/\bseries\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  _nfCache.set(s, v);
  return v;
}

// IGDB genre label -> your sheet's spelling, where one clean value exists. Where the
// sheet is only granular (no plain "Platformer"/"RPG"), the alias IS the umbrella that
// the granular sheet genres roll up into (see genreUmbrellas).
const GENRE_ALIAS = {
  "role-playing (rpg)": "RPG", "rpg": "RPG",
  "platform": "Platformer",
  "shooter": "Shooter", "strategy": "Strategy", "adventure": "Adventure",
  "real time strategy (rts)": "Real-Time Strategy",
  "turn-based strategy (tbs)": "Turn-Based Strategy",
  "hack and slash/beat 'em up": "Beat 'em Up",
  "simulator": "Simulation", "sport": "Sports", "music": "Rhythm",
  "quiz/trivia": "Trivia", "card & board game": "Board Game",
  "point-and-click": "Point-and-Click",
  "puzzle": "Puzzle", "fighting": "Fighting", "racing": "Racing",
  "visual novel": "Visual Novel", "arcade": "Arcade", "pinball": "Pinball",
  "indie": "Indie", "moba": "MOBA", "tactical": "Tactical",
  "action": "Action", "compilation": "Compilation",
};
// Normalise for comparison: case, curly vs straight apostrophes, whitespace. Collapses
// "Beat 'Em Up"/"Beat 'em Up" and matches the (lowercase) alias keys.
const _ngCache = new Map();
function normGenre(s) {
  s = String(s || "");
  let v = _ngCache.get(s);
  if (v !== undefined) return v;
  v = s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
  _ngCache.set(s, v);
  return v;
}
// raw -> canonical label: alias to the umbrella/sheet term, then collapse to your
// sheet's exact spelling for that genre (the sheet is internally consistent, so it is
// the single source of truth for casing).
function canonGenre(raw) {
  const key = normGenre(raw);
  const base = GENRE_ALIAS[key] || String(raw);
  return unifyVocab().gen[normGenre(base)] || base;
}
// Broad umbrellas a genre belongs to, so IGDB "Platform" and sheet "3D Platformer"
// both file under "Platformer". Only the four families you flagged.
function genreUmbrellas(v) {
  const s = String(v).toLowerCase(), out = [];
  if (/platform/.test(s)) out.push("Platformer");
  if (/\brpg\b|role-playing|mmorpg/.test(s)) out.push("RPG");
  if (/shooter/.test(s)) out.push("Shooter");
  if (/\bstrateg/.test(s)) out.push("Strategy");
  return out;
}

// Sheet spelling wins as the canonical label. Built once per dataset from BOTH sheets.
let _vocab = null, _vocabFor = null;
function unifyVocab() {
  if (_vocabFor === DATA && _vocab) return _vocab;
  const dev = {}, pub = {}, fran = {}, gen = {};
  const put = (map, val, norm) => { const k = norm(val); if (k && !(k in map)) map[k] = String(val); };
  for (const key of ["games", "completed"]) {
    for (const r of ((DATA.sheets[key] || {}).rows || [])) {
      if (r.developer) put(dev, r.developer, normCompany);
      if (r.publisher) put(pub, r.publisher, normCompany);
      if (r.franchise) put(fran, r.franchise, normFranchise);
      if (r.genre) put(gen, r.genre, normGenre);
    }
  }
  _vocab = { dev, pub, fran, gen }; _vocabFor = DATA;
  return _vocab;
}

/* ---- Curated genres -------------------------------------------------------
 * Some things I care about are not a genre anyone else keeps. Nonograms are the case in
 * point: nobody sells them as a category, and the two sources that DO know about them each
 * get it wrong in a different direction —
 *
 *   IGDB's keywords are precise but incomplete. "nonogram" / "picross" tag Pictopix, Piczle
 *   Cross, Murder by Numbers, Nono Pixie — 20 games no title rule would ever find. But IGDB
 *   has never tagged a single Nintendo Picross: not Mario's Picross, not Picross 3D, not
 *   Picross S8. (Its "logic puzzle" keyword is NOT this — it's general puzzle, and would
 *   drag in Baba Is You and Creaks. It is deliberately not listed.)
 *
 *   The title is complete where IGDB is blind — anything called "Picross" IS one — but it's
 *   blind where IGDB sees: Pictopix and Voxelgram give nothing away.
 *
 * So take the union, and keep a hand-written list for the ones neither catches. Each tag
 * becomes a real genre value, which means it filters, groups, feeds challenges, and is
 * searchable everywhere a genre is, for free.
 *
 * Add a tag by adding a row. That's the whole extension mechanism. */
const CURATED_GENRES = [
  {
    name: "Nonogram",
    // IGDB keywords, exactly. NOT "logic puzzle" — see above.
    kw: ["nonogram", "nonograms", "picross"],
    // Anything named for the form. Matched against the sheet title AND the IGDB name.
    re: /\bpicross\b|\bnonogram|illust\s*logic|oekaki\s*logic|logic\s*paint|picture\s*cross|paint it back|\bcrossme\b|\bzacross\b|griddler|\bpixross\b|\bvoxelgram\b/i,
    // Neither the keyword nor the name gives these away. Match keys, so they're exact.
    keys: [],
  },
];

function curatedGenres(row) {
  const e = ENRICH[row._k] || {};
  const kws = (e.keywords || []).map((k) => String(k).toLowerCase());
  const name = `${row.title || row.game || ""} ${e.name || ""}`;
  const out = [];
  for (const t of CURATED_GENRES) {
    const hit = (t.kw && kws.some((k) => t.kw.includes(k)))
      || (t.re && t.re.test(name))
      || (t.keys && t.keys.includes(row._k));
    if (hit) out.push(t.name);
  }
  return out;
}

function unifiedGenreVals(row) {
  const out = new Set();
  const add = (raw) => {
    if (raw == null || raw === "") return;
    const c = canonGenre(raw);
    out.add(String(c));
    genreUmbrellas(c).forEach((u) => out.add(u));
    genreUmbrellas(raw).forEach((u) => out.add(u));
  };
  if (row.genre) add(row.genre);
  const e = ENRICH[row._k];
  // Only IGDB's clean genre vocabulary. A fallback match (IGN/Steam/LaunchBox) fills
  // `genres` with free text — perspectives ("First-Person"), format tags ("Remaster"),
  // inconsistent casing ("Beat 'Em Up") — that pollutes the facet and only ever tags the
  // few games IGDB couldn't match. The sheet genre still covers those.
  if (e && e.igdbId && e.genres) for (const g of e.genres) add(g);
  // Curated on top: a genre I keep that nobody else does.
  for (const g of curatedGenres(row)) out.add(g);
  return [...out];
}
function unifiedCompanyVals(sheetVal, igdbArr, map) {
  const out = new Set();
  const add = (n) => { if (n) out.add(map[normCompany(n)] || String(n)); };
  add(sheetVal);
  (igdbArr || []).forEach(add);
  return [...out];
}
function unifiedDevVals(row) {
  return unifiedCompanyVals(row.developer, (ENRICH[row._k] || {}).developers, unifyVocab().dev);
}
function unifiedPubVals(row) {
  return unifiedCompanyVals(row.publisher, (ENRICH[row._k] || {}).publishers, unifyVocab().pub);
}
function unifiedFranchiseVals(row) {
  const out = new Set(), map = unifyVocab().fran;
  const add = (n) => { if (n) out.add(map[normFranchise(n)] || String(n)); };
  add(row.franchise);
  const e = ENRICH[row._k];
  if (e && e.franchises) for (const f of e.franchises) add(f);
  return [...out];
}
const UNIFIED_GETVALS = {
  genre: unifiedGenreVals, developer: unifiedDevVals,
  publisher: unifiedPubVals, franchise: unifiedFranchiseVals,
};
// The canonical (sheet-spelling) form of an external value — so a drawer link filters
// the value that's actually IN the facet, not the raw IGDB string.
const canonDev = (n) => unifyVocab().dev[normCompany(n)] || String(n);
const canonPub = (n) => unifyVocab().pub[normCompany(n)] || String(n);
const canonFran = (n) => unifyVocab().fran[normFranchise(n)] || String(n);
// Turn a scalar sheet facet column into the joined multi-valued one, keeping its key
// and label (so drawer facet-links and URL state keep working unchanged).
const unifiedFacetCol = (c) =>
  (ENRICH_ENABLED && UNIFIED_GETVALS[c.key]) ? { ...c, kind: "fn", getVals: UNIFIED_GETVALS[c.key] } : c;
const PLAYTIME_BUCKETS = [
  { label: "< 2h", test: (h) => h < 2 },
  { label: "2–5h", test: (h) => h >= 2 && h < 5 },
  { label: "5–10h", test: (h) => h >= 5 && h < 10 },
  { label: "10–20h", test: (h) => h >= 10 && h < 20 },
  { label: "20–40h", test: (h) => h >= 20 && h < 40 },
  { label: "40–80h", test: (h) => h >= 40 && h < 80 },
  { label: "80h+", test: (h) => h >= 80 },
];
const SALES_BUCKETS = [
  { label: "10m+", test: (v) => v >= 10e6 },
  { label: "5–10m", test: (v) => v >= 5e6 && v < 10e6 },
  { label: "1–5m", test: (v) => v >= 1e6 && v < 5e6 },
  { label: "500k–1m", test: (v) => v >= 5e5 && v < 1e6 },
  { label: "< 500k", test: (v) => v < 5e5 },
];
const METACRITIC_BUCKETS = [
  { label: "90–100", test: (v) => v >= 0.9 },
  { label: "80–89", test: (v) => v >= 0.8 && v < 0.9 },
  { label: "70–79", test: (v) => v >= 0.7 && v < 0.8 },
  { label: "60–69", test: (v) => v >= 0.6 && v < 0.7 },
  { label: "< 60", test: (v) => v < 0.6 },
];
// Best playtime for a row: HLTB (main→best) where enriched, else sheet estimate.
const playtimeOf = (row) => {
  const e = ENRICH[row._k];
  if (e && e.hltbBest != null) return e.hltbBest;
  if (e && e.vnHours != null) return e.vnHours;   // HLTB barely covers VNs
  return row.estimatedTime;
};
// Metacritic (0–1): scraped score where enriched, else the sheet's Metacritic Rating.
/* The critic score, best source first. Everything that shows or filters on "what the
   critics thought" — the facet, stats, the prediction model, challenges, the drawer —
   reads this ONE function, so a new fallback lights up the whole app at once.
     1. Metacritic scrape        — what we look up live.
     2. your sheet's column      — for older games this IS GameRankings data, imported.
     3. IGDB's aggregated_rating — its external critic aggregate (we already fetched it).
     4. GameRankings archive     — frozen since 2019, and the only critic score a lot of
                                   90s/2000s games ever got. */
function criticOf(row) {
  const e = ENRICH[row._k] || {};
  if (e.metascore != null) return e.metascore / 100;
  if (row.metacriticRating != null) return row.metacriticRating;
  if (e.criticRating != null) return e.criticRating;
  const g = GR[row._k];
  if (g && g.score != null) return g.score / 100;
  return undefined;
}
// Which of those actually answered, so a score can say where it came from.
function criticSourceOf(row) {
  const e = ENRICH[row._k] || {};
  if (e.metascore != null) return { label: "Metacritic", url: e.metaUrl || null };
  if (row.metacriticRating != null) return { label: "Metacritic", url: null, sheet: true };
  if (e.criticRating != null) return { label: "IGDB critics", url: e.url || null, n: e.criticCount };
  const g = GR[row._k];
  if (g) return { label: "GameRankings", url: g.url, n: g.n };
  return null;
}
const metacriticOf = criticOf;      // the old name, still used all over
// User rating (0–1): IGDB community rating where enriched, else VNDB's (visual
// novels are the one place VNDB's vote count dwarfs everyone's), else GameFAQs.
const userRatingOf = (row) => {
  const e = ENRICH[row._k];
  if (e && e.userRating != null) return e.userRating;
  if (e && e.vnRating != null) return e.vnRating;
  return row.gamefaqsUserRating;
};
