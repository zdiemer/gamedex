"use strict";

/* Turning search text + ticked facets into a row list, and painting the sidebar.

   Search folds diacritics and caches its haystack per row, because filtering
   14.7k rows runs on every keystroke. The facet counts are computed against the
   rows that pass every OTHER facet, so a count never reads as zero for something
   you can plainly still click. */

// ---- filtering ----------------------------------------------------------
// Fold text for search so the query and the haystack always meet in the same
// alphabet. Applied to BOTH. Four steps:
//   • lowercase
//   • strip diacritics — "pokemon" matches "Pokémon", "naive" matches "naïve".
//     NFD splits an accented letter into base + combining mark; we drop the marks.
//   • "&" → " and " — "ratchet and clank" matches "Ratchet & Clank".
//   • drop punctuation — "dont" matches "Don't", "qube" matches "Q.U.B.E",
//     "spiderman" matches "Spider-Man". We DELETE punctuation rather than splitting
//     on it, so the letters close up ("Q.U.B.E" → "qube"). A single letter still
//     matches — "qube" starts with "q" — so "q" → "Q.U.B.E" keeps working.
// \p{P} is Unicode *punctuation* only, so letters of every script (incl. CJK) and
// symbols like "+" ("N++") survive. The "&" pass runs first, before it becomes a
// casualty of the punctuation strip.
const foldText = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ").replace(/\p{P}/gu, "");

// ---- numeral equivalence (VII ↔ 7) --------------------------------------
// Games number their sequels in both alphabets — "Final Fantasy VII" vs a typed
// "final fantasy 7", "GTA V" vs "gta 5". So a term gets ONE alternate spelling of
// the same number, tried in addition to the literal. Applied to the query side
// only (the index stays untouched); because it's additive, the literal spelling
// always still matches too.
function arabicToRoman(n) {
  if (!(n >= 1 && n <= 3999)) return null;
  const T = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
             [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let r = "", x = n;
  for (const [val, sym] of T) while (x >= val) { r += sym; x -= val; }
  return r;
}
function romanToArabic(s) {
  const M = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let n = 0, prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const v = M[s[i]];
    if (!v) return null;
    if (v < prev) n -= v; else { n += v; prev = v; }
  }
  return arabicToRoman(n) === s ? n : null;      // strict: only canonical spellings ("iiii" is out)
}
// The numeral twin of a folded term, or null. Numbers keep their multi-letter roman
// twin plus V and X — but NOT single-letter I/L/C/D/M, whose roman form ("1"→"i") would
// collide with ordinary words. Roman terms must be ≥2 letters for the same reason:
// a lone "x" is the Game Boy game, not 10. Cached — the term vocabulary is tiny.
const _numAlt = new Map();
function numeralAlt(t) {
  if (_numAlt.has(t)) return _numAlt.get(t);
  let alt = null;
  if (/^[0-9]{1,4}$/.test(t)) {
    const n = parseInt(t, 10), r = arabicToRoman(n);
    if (r && (r.length >= 2 || n === 5 || n === 10)) alt = r;
  } else if (/^[ivxlcdm]{2,}$/.test(t)) {
    const n = romanToArabic(t);
    if (n != null) alt = String(n);
  }
  _numAlt.set(t, alt);
  return alt;
}

// ---- typo tolerance (edit distance) -------------------------------------
// A last-resort match for real fat-finger typos ("assassn" → assassin). Deliberately
// narrow: only terms ≥4 chars (short ones collide with everything), against whole
// haystack WORDS, distance 1 (or 2 past 7 chars). Ranked below every literal hit so a
// real match is never displaced — this only rescues a query that would otherwise miss.
function fuzzyDist(term) { return term.length < 4 ? 0 : term.length >= 7 ? 2 : 1; }
// Is edit distance(a, b) ≤ max? Bounded DP: a length gate skips most words for free, and
// a row that blows the budget bails before finishing.
function withinEdits(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[lb] <= max;
}
// One query term against a prepared haystack (folded string + its word list): literal
// substring, then numeral twin (VII↔7), then a typo within edit distance of some word.
function termInHay(t, s, words) {
  if (s.includes(t)) return true;
  const alt = numeralAlt(t);
  if (alt && s.includes(alt)) return true;
  const max = fuzzyDist(t);
  if (max) for (const w of words) if (withinEdits(t, w, max)) return true;
  return false;
}

// Row matches free-text search.
// The searchable text of a row, built once and kept. A WeakMap keyed on the row
// object means a fresh spreadsheet invalidates it for free.
// Cached as { s, words }: the folded blob for substring/numeral tests, and its word
// list (split once) for the typo pass, so edit distance never re-splits per keystroke.
const HAYSTACK = new WeakMap();
function rowHaystack(row, cols) {
  let hay = HAYSTACK.get(row);
  if (hay === undefined) {
    const s = foldText(cols.map((k) => row[k]).filter((v) => v != null).join(" "));
    hay = { s, words: s.split(/[^a-z0-9]+/).filter(Boolean) };
    HAYSTACK.set(row, hay);
  }
  return hay;
}
// IGDB genres are searchable too — so "Platformer" finds games IGDB tagged Platform,
// not only the ones your sheet spells that way. Kept separate from rowHaystack (which is
// sheet-only and immutable) and re-derived when enrichment lands, since ENRICH fills in
// after the first paint. Cheap: unmatched rows return "" without touching the vocab.
let _enrichEpoch = 0;
const _genreHay = new WeakMap();
const EMPTY_HAY = { s: "", words: [] };
function searchGenreHay(row) {
  if (!ENRICH_ENABLED || !ENRICH[row._k]) return EMPTY_HAY;
  const c = _genreHay.get(row);
  if (c && c.e === _enrichEpoch) return c.h;
  const s = foldText(unifiedGenreVals(row).join(" "));
  const h = { s, words: s.split(/[^a-z0-9]+/).filter(Boolean) };
  _genreHay.set(row, { e: _enrichEpoch, h });
  return h;
}
function matchesSearch(row, terms, cols) {
  if (!terms.length) return true;
  const hay = rowHaystack(row, cols);
  const genre = searchGenreHay(row);      // same for every term — resolve each once
  return terms.every((t) =>
    termInHay(t, hay.s, hay.words) || termInHay(t, genre.s, genre.words));
}

// ---- relevance scoring (the site search ranks by this) -------------------
// A hit in the TITLE means far more than one in a genre tag, with developer / publisher /
// franchise in between — so "Haze" (the game) outranks games merely MADE by "Hazelight", and the
// Game Boy game literally called "X" tops a search for "x". Notes are deliberately absent: they're
// long, they still count toward WHETHER a row matches, but a note hit shouldn't outrank a real
// title, and folding every review to score it would be the slow part.
const SEARCH_FIELD_WEIGHTS = [
  ["title", 12], ["game", 12], ["franchise", 5],
  ["developer", 3], ["publisher", 3], ["genre", 2.5], ["vendor", 1.5],
];
// How well one field VALUE matches one term, best tier first — multiplied by the field's weight.
// A numeral twin (VII↔7) scores as the literal it stands for; a typo is the last resort, below
// every literal so an exact match is never displaced by a fat-fingered one.
function literalTier(folded, words, term) {
  if (folded === term) return 6;                                  // the field IS the term
  if (words.includes(term)) return 4;                             // a whole word matches
  if (folded.startsWith(term)) return 3.5;                        // the field starts with it
  for (const w of words) if (w.startsWith(term)) return 2.2;      // a word starts with it
  return folded.includes(term) ? 1 : 0;                           // buried substring, else no hit
}
function fieldMatchTier(folded, term) {
  const words = folded.split(/[^a-z0-9]+/);
  let tier = literalTier(folded, words, term);
  if (tier === 6) return tier;                                    // nothing beats an exact hit
  const alt = numeralAlt(term);
  if (alt) tier = Math.max(tier, literalTier(folded, words, alt));
  if (tier >= 1) return tier;
  const max = fuzzyDist(term);                                    // typo tolerance, ranked last
  if (max) for (const w of words) if (withinEdits(term, w, max)) return 0.5;
  return 0;
}
// Total relevance of a row for the query terms: each term scores its single best-weighted field,
// and the terms sum. Higher is more relevant.
function searchScore(row, terms) {
  let total = 0;
  for (const t of terms) {
    let best = 0;
    for (const [key, w] of SEARCH_FIELD_WEIGHTS) {
      const v = row[key];
      if (v == null || v === "") continue;
      const tier = fieldMatchTier(foldText(v), t);
      if (tier) { const s = w * tier; if (s > best) best = s; }
    }
    total += best;
  }
  return total;
}
// Row matches a facet selection (Set of value keys). OR within a facet; for
// IGDB array facets a row matches if ANY of its values is selected.
function matchesFacet(row, col, selected) {
  if (!selected || selected.size === 0) return true;
  return rowFacetItems(row, col).some((it) => selected.has(it.key));
}

// The search half of the filter, memoised. renderFacets() calls filterRows once
// per facet column (20+ times) and the search term is the same for every one of
// them, so scanning the sheet each time was pure waste.
let _searchBase = { tab: null, q: null, rows: null };
function searchedRows() {
  const st = tabState[activeTab];
  if (_searchBase.tab === activeTab && _searchBase.q === st.search) return _searchBase.rows;
  const terms = foldText(st.search).split(/\s+/).filter(Boolean);
  const sCols = searchCols();
  const rows = terms.length
    ? sheet().rows.filter((row) => matchesSearch(row, terms, sCols))
    : sheet().rows;
  _searchBase = { tab: activeTab, q: st.search, rows };
  return rows;
}
const resetSearchCache = () => { _searchBase = { tab: null, q: null, rows: null }; };

// Rows matching search + every facet EXCEPT `skipKey` (for facet counts) or all.
// Callers never mutate the result (sortRows copies), so the no-facet case can
// hand back the memoised array as-is.
function filterRows(skipKey) {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("filterRows", activeTab) : () => {};
  try { return _filterRows(skipKey); } finally { end(); }
}

function _filterRows(skipKey) {
  const st = tabState[activeTab];
  const active = Object.keys(st.facets)
    .map((k) => [facetColByKey(k), st.facets[k]])
    .filter(([c]) => c && c.key !== skipKey && st.facets[c.key] && st.facets[c.key].size);
  const base = searchedRows();
  if (!active.length) return base;
  return base.filter((row) => {
    for (const [col, sel] of active) {
      if (!matchesFacet(row, col, sel)) return false;
    }
    return true;
  });
}

// ---- rendering: facets --------------------------------------------------
function setFacets(open) {
  $("#facets").classList.toggle("open", open);
  $("#facetBackdrop").hidden = !open;
  syncScrollLock();
  if (open) renderFacets();
  else if (matchMedia("(max-width: 760px)").matches) cancelFacetWork();
}

let _facetRun = 0;
let _facetTimer = null;
let _facetResult = null;
function cancelFacetWork() {
  ++_facetRun;
  clearTimeout(_facetTimer);
  _facetTimer = null;
  $("#facets").removeAttribute("aria-busy");
}
function facetsVisible() {
  const host = $("#facets");
  return !!tabState[activeTab] && host.style.display !== "none"
    && (!matchMedia("(max-width: 760px)").matches || host.classList.contains("open"));
}
function facetStateKey() {
  const st = tabState[activeTab];
  return JSON.stringify([activeTab, st.search, combineOn(), _enrichEpoch,
    Object.entries(st.facets).map(([key, values]) => [key, [...values].sort()])]);
}

// Test each selected facet once per row. A row contributes to every column if it
// passes all selections, or only to its failed column if it fails exactly one.
// This preserves "all OTHER facets" counts without rescanning for every column.
function* countFacetRows(rows, cols, selections, grouping) {
  const result = new Map(cols.map(col => [col.key, new Map()]));
  const seen = new Map(cols.map(col => [col.key, new Map()]));
  let deadline = performance.now() + 8;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let failed = null, failures = 0;
    for (const [col, selected] of selections) {
      if (!matchesFacet(row, col, selected)) { failed = col.key; if (++failures > 1) break; }
    }
    if (failures < 2) {
      // Row identity keeps unmatched copies distinct from numeric IGDB IDs.
      const gid = grouping ? (cachedGameId(row) || row) : null;
      for (const col of cols) {
        if (failures && col.key !== failed) continue;
        const counts = result.get(col.key), groups = seen.get(col.key);
        for (const it of rowFacetItems(row, col)) {
          if (grouping) {
            let ids = groups.get(it.key);
            if (!ids) groups.set(it.key, ids = new Set());
            if (ids.has(gid)) continue;
            ids.add(gid);
          }
          counts.set(it.key, (counts.get(it.key) || 0) + 1);
        }
      }
    }
    if (i % 8 === 0 && performance.now() >= deadline) {
      yield;
      deadline = performance.now() + 8;
    }
  }
  return result;
}

// A closed mobile panel may become a visible desktop sidebar without a render.
matchMedia("(max-width: 760px)").addEventListener("change", () => renderFacets());
