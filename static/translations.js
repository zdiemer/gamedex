"use strict";

/* Translation Watch — games that just became playable in English.
 *
 * The sheet's `english` column (None / Partial / Full, blank = natively English) says
 * WHETHER a game is playable. It cannot say WHEN that changed. This tab is the other
 * half: the two active ROM-translation sites, filtered to English, resolved to IGDB, and
 * joined back to the collection — so a Japan-only game you own, marked english: None for
 * years, announces itself the week somebody finishes translating it.
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
  const rows = (TRANSLATIONS.items || []).map(twRow);
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
}

const twMsg = (html) =>
  `<div class="rec-empty"><h2>${icon("i-globe", 20)} Translation Watch</h2><p>${html}</p></div>`;

/* The alert strip: games you already own that just became playable. Pinned above the
   grid because the whole point is that they must not scroll away. */
function twAlertsHtml() {
  const alerts = (TRANSLATIONS && TRANSLATIONS.alerts) || [];
  if (!alerts.length) return "";
  const cards = alerts.map((a) => {
    const was = a.mine && a.mine.english === "Partial" ? "was partially translated" : "had no translation";
    const who = (a.authors || []).join(", ");
    const machine = a.machine ? ` <span class="tw-chip tw-chip-machine">machine translated</span>` : "";
    const link = a.sources[0] ? a.sources[0].url : "#";
    return `<li class="tw-alert">
      <a href="${link}" target="_blank" rel="noopener">
        <strong>${escapeHtml(a.title)}</strong></a>
      <span class="tw-alert-meta">${escapeHtml(a.platform || "")} — ${was}${
        who ? `, translated by ${escapeHtml(who)}` : ""}</span>${machine}
    </li>`;
  }).join("");
  const n = alerts.length;
  return `<div class="tw-alerts">
    <h3>${icon("i-sparkle", 16)} ${n} game${n === 1 ? "" : "s"} you own just became playable in English</h3>
    <ul>${cards}</ul>
  </div>`;
}

/* The gate: renderable as a sheet yet? Paints its own message into #translations and
   returns false when not; builds the sheet and returns true when ready. Mirrors
   recsReady() in recs.js. */
function translationsReady() {
  const host = $("#translations");
  if (!twEnabled()) {
    host.innerHTML = twMsg(`Translation Watch isn't enabled, so there's nothing to watch yet.
      Set <code>translations.enabled: true</code> and give the first crawl a few passes.`);
    return false;
  }
  if (!_twFetched) {
    loadTranslations();
    host.innerHTML = twMsg("Checking what's been translated…");
    return false;
  }
  if (!TRANSLATIONS || (!TRANSLATIONS.items || []).length) {
    // "ready: false" means the first crawl is still walking the archive — an empty page
    // then is a work-in-progress, not an answer, and saying so avoids looking broken.
    host.innerHTML = TRANSLATIONS && !TRANSLATIONS.ready
      ? twMsg(`Still reading through the back catalogue — around seven thousand patches,
          fetched politely. New translations will appear here as they land.`)
      : twMsg("No English translations found yet.");
    return false;
  }
  buildTranslationsSheet();
  // The alert strip lives above the shared listing chrome, so it is painted into the
  // host and the host stays visible even on the ordinary listing path.
  host.innerHTML = twAlertsHtml();
  host.hidden = !host.innerHTML;
  return true;
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
