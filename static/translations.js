"use strict";

/* Translation Watch — games that just became playable in English.
 *
 * The sheet's `english` column (None / Partial / Full, blank = natively English) says
 * WHETHER a game is playable. It cannot say WHEN that changed. This tab is the other
 * half: the two active ROM-translation sites, filtered to English, resolved to IGDB, and
 * joined back to the collection — so a Japan-only game on your sheet, marked english:
 * None for years, announces itself the week somebody finishes translating it.
 *
 * IT IS A REAL LISTING TAB, not a special page — the same trick recs.js plays. Rows go
 * into a synthetic `DATA.sheets.translations`, so the facet sidebar, search, grid/table,
 * sort, pager and drawers all work unchanged. A translated game usually isn't on the
 * sheet at all, so its row is shaped like a wishlist-only row (`_wlOnly` + `_igdbId`) and
 * opens its drawer by IGDB id.
 *
 * TWO THINGS THIS TAB DOES THAT RECOMMEND DOESN'T:
 *
 *   Alerts.  A release matched to a game you OWN whose english is None/Partial is not
 *            just a row — it's the reason the tab exists. Those are pinned above the
 *            grid and excluded from the listing so they can't scroll away.
 *
 *   Quality. A real share of new releases are tagged "Machine Translation" or "Vibe
 *            Coded". They are not hidden — somebody's MTL patch may be the only way to
 *            read a game — but the Quality facet defaults to Human, because an
 *            unfiltered feed reads as slop. One click away, not gone.
 *
 * Server side is src/translations.py; this file only renders what /api/translations
 * already decided. */

let TRANSLATIONS = null;           // the last payload
let _twBusy = false;
let _twFetched = false;
let _twSheetBuilt = false;

// The synthetic sheet's schema. Released is the default sort — this is a feed, and the
// question is always "what's new". Platform IS a facet here (unlike recs.js, where it
// arrives late per-row): the server knows it for every release up front, so the facet is
// never half-populated.
const TRANSLATION_COLUMNS = [
  { key: "title",       label: "Title",       type: "text", facet: false, search: true,  sort: true,  primary: true },
  { key: "platform",    label: "Platform",    type: "text", facet: true,  search: true,  sort: true,  primary: true },
  { key: "status",      label: "Status",      type: "text", facet: true,  search: false, sort: true,  primary: true },
  { key: "quality",     label: "Quality",     type: "text", facet: true,  search: false, sort: true,  primary: true },
  { key: "genre",       label: "Genre",       type: "text", facet: true,  search: true,  sort: true,  primary: true },
  { key: "mine",        label: "In Collection", type: "text", facet: true, search: false, sort: true, primary: false },
  { key: "source",      label: "Source",      type: "text", facet: true,  search: false, sort: true,  primary: false },
  { key: "translator",  label: "Translator",  type: "text", facet: false, search: true,  sort: true,  primary: false },
  { key: "releaseYear", label: "Release Year", type: "year", facet: true, search: false, sort: true,  primary: false },
  { key: "version",     label: "Version",     type: "text", facet: false, search: false, sort: false, primary: false },
  { key: "released",    label: "Released",    type: "date", facet: false, search: false, sort: true,  primary: true },
];

const twEnabled = () => !!(DATA && DATA.meta && DATA.meta.translations
                           && DATA.meta.translations.enabled !== false);

/* One synthetic row. Mirrors recs.js's recRow: `_wlOnly` + `_igdbId` make the shared
   drawer load detail by id, and ENRICH[_k] is seeded so the card finds its cover and
   maybeEnrich never asks the server about a key that isn't on the sheet. */
function twRow(item) {
  const g = item.game || null;
  const id = g && g.igdbId;
  const k = `tw:${item.id}`;
  const e = ENRICH[k] || (ENRICH[k] = {});
  if (g) {
    if (g.cover && !e.cover) e.cover = g.cover;
    if (!e.igdbId && id) e.igdbId = id;
    if (g.genres && !e.genres) e.genres = g.genres;
    if (g.summary && !e.summary) e.summary = g.summary;
  }
  // Unmatched releases still have art: Romhack Plaza's own .webp, which is durable
  // (romhack.ing's thumbnails expire in 300s and never leave the server). coverSrc
  // already prefers e.cover — the IGDB id — and falls back to e.coverUrl through
  // /api/img, so a game IGDB never matched still gets a picture instead of a
  // placeholder that reads as "broken".
  if (item.coverUrl && !e.cover && !e.coverUrl) e.coverUrl = item.coverUrl;
  const mine = item.mine;
  return {
    title: item.title,
    _k: k,
    _wlOnly: true,
    _twOnly: true,
    _igdbId: id || null,
    _igdb: g,
    _tw: item,
    platform: item.platform || null,
    status: item.status || "Unknown",
    // The facet the default filter leans on. Two values, deliberately — a spectrum here
    // would just be a slower way to answer the same question.
    quality: item.machine ? "Machine" : "Human",
    genre: (g && g.genres && g.genres[0]) || null,
    mine: mine ? (mine.owned ? "Owned" : mine.wishlisted ? "Wishlist" : "Matched") : null,
    source: item.sources.map((s) => (s.name === "rhdi" ? "romhack.ing" : "Romhack Plaza")).join(", "),
    translator: (item.authors || []).join(", ") || null,
    releaseYear: (g && g.year) || null,
    version: item.version || null,
    released: item.released ? new Date(item.released * 1000).toISOString().slice(0, 10) : null,
  };
}

function buildTranslationsSheet(force) {
  if (!DATA || !DATA.sheets || !TRANSLATIONS) return;
  if (!force && _twSheetBuilt) return;
  // Alerts are pinned in their own strip, but they belong in the list as well: the
  // strip is a callout, not the record. Leaving them out meant the entries you most
  // want to look at were the only ones with no card and no drawer.
  const rows = [...(TRANSLATIONS.alerts || []), ...(TRANSLATIONS.items || [])].map(twRow);
  DATA.sheets.translations = { columns: TRANSLATION_COLUMNS, rows };
  _twSheetBuilt = true;
  resetSearchCache();               // the rows array changed identity (filters.js memo)
  if (typeof applyDrawerFromURL === "function") applyDrawerFromURL();
}

async function loadTranslations(force) {
  if (_twBusy || (_twFetched && !force)) return;
  _twBusy = true;
  try {
    const r = await fetch("api/translations");
    if (r.ok) {
      TRANSLATIONS = await r.json();
      _twFetched = true;
      _twSheetBuilt = false;
      buildTranslationsSheet(true);
    }
  } catch (_) {
    /* leave TRANSLATIONS null; the gate paints the offline message */
  } finally {
    _twBusy = false;
  }
  // The gate fires this and returns false, painting "Checking what's been translated…".
  // Nothing else is waiting on the promise, so without an explicit repaint here the tab
  // sits on that message forever — the feed only appeared if you navigated away and back.
  if (activeTab === "translations") renderAll();
}

/* The Quality facet lands on Human rather than empty.
 *
 * resetTab() wipes facets to {} and then calls TAB_RESET[tab], which is exactly the hook
 * for "this tab has a non-empty landing state". Facet selections are Sets, not arrays —
 * filters.js reads `.size` on them.
 *
 * Machine translations stay one click away rather than being dropped: an MTL patch is
 * sometimes the only way to read a game, but it should be a choice, not the default. */
const twDefaultFacets = () => ({ quality: new Set(["Human"]) });
TAB_RESET.translations = () => {
  if (tabState.translations) tabState.translations.facets = twDefaultFacets();
};
if (typeof tabState !== "undefined" && tabState.translations) {
  tabState.translations.facets = twDefaultFacets();
}

/* The translation block inside a translated game's drawer.
 *
 * Everywhere else the drawer is about the GAME; this is the one part that is about the
 * PATCH — who made it, which version, how complete, and above all WHERE TO GET IT. The
 * feed is only useful if it can hand you off to the people who did the work, so every
 * source that carries this translation gets its own link out.
 *
 * "" for every row that isn't one of ours, exactly like recsDrawerHtml. */
const TW_SOURCE_LABEL = { rhdi: "romhack.ing", plaza: "Romhack Plaza" };
