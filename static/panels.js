"use strict";

/* Drawer enrichment orchestration. Presentation lives in components/;
   this file owns fetching, cache updates, and composition into the drawer. */

async function submitOverride(key, url, source = "igdb", remove = false) {
  try {
    const res = await fetch("api/enrichment/override", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, url, source, remove }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    // Clear caches so the refetch shows the new mapping.
    delete DETAIL[key]; delete HLTBC[key]; delete MCC[key]; delete GEC[key];
    if (["igdb", "steam", "ign", "gamespot"].includes(source)) {   // primary slot
      const r = remove ? null : j.record;
      if (r) ENRICH[key] = Object.assign(ENRICH[key] || {}, {
        cover: r.cover, coverUrl: r.coverUrl, source: r.source, igdbId: r.igdbId,
        genres: r.genres, themes: r.themes, gameModes: r.gameModes, userRating: r.userRating,
      });
      else delete ENRICH[key];
    }
    renderTable(currentFiltered);   // refresh cover/facets on the grid
    return true;
  } catch (_) { return false; }
}

async function loadDetail(key, el, attempt = 0, row = null, igdbId = null) {
  if (row) drawerRow = row;
  if (DETAIL[key]) { renderIgdbSection(key, el, "matched", DETAIL[key]); return; }
  if (attempt === 0) renderIgdbSection(key, el, "loading", null);
  try {
    const res = await fetch("api/enrichment/detail?key=" + encodeURIComponent(key)
      + (igdbId ? "&igdb=" + encodeURIComponent(igdbId) : ""));
    const j = await res.json();
    if ("hltb" in j) HLTBC[key] = j.hltb;
    if ("metacritic" in j) MCC[key] = j.metacritic;
    if ("gameye" in j) GEC[key] = j.gameye;
    if ("arcadedb" in j) ADBC[key] = j.arcadedb;
    if ("vndb" in j) VNC[key] = j.vndb;
    if ("vgchartz" in j) VGC[key] = j.vgchartz;
    if ("thumby" in j) THC[key] = j.thumby;
    if ("steamx" in j) SXC[key] = j.steamx;
    if ("speedrun" in j) SRC[key] = j.speedrun;
    if ("guides" in j) GDC[key] = j.guides;
    if ("cooptimus" in j) COOPC[key] = j.cooptimus;
    if ("manuals" in j) MANC[key] = j.manuals;
    if ("gametdb" in j) GTDBC[key] = j.gametdb;
    if ("pcgw" in j) PCGWC[key] = j.pcgw;
    if ("wikidata" in j) WDC[key] = j.wikidata;
    if ("khinsider" in j) KHC[key] = j.khinsider;
    if (j.status === "matched" && j.detail) { DETAIL[key] = j.detail; renderIgdbSection(key, el, "matched", j.detail); }
    else if (j.status === "no_match") { renderIgdbSection(key, el, "no_match", null); }
    else if (j.status === "pending") {
      if (attempt >= 15) renderIgdbSection(key, el, "pending-final", null);
      else setTimeout(() => loadDetail(key, el, attempt + 1, null, igdbId), 2500);
    } else renderIgdbSection(key, el, "error", null);
  } catch (_) { renderIgdbSection(key, el, "error", null); }
}

// Bulk-load the light cover/facet map for every already-matched game (powers
// covers + IGDB facets across the whole list). Re-polls while backfill runs.
let allTimer = null;
async function loadAllEnrichment() {
  if (!ENRICH_ENABLED) return;
  try {
    // Low priority on purpose: this is the whole-library map (facets + the rest of the
    // covers), a few MB, and the page's own visible covers come from the fast page-scoped
    // maybeEnrich POST. Let the browser hand the ~6 connection slots to the images first and
    // fetch this behind them, so a landing page paints its covers instead of waiting on it.
    const pre = window.__boot && window.__boot.enrichment;
    if (window.__boot) window.__boot.enrichment = null;
    const res = (pre && await pre) || await fetch("api/enrichment/all", { priority: "low", cache: "no-cache" });
    const j = await res.json();
    if (j.enabled === false) { ENRICH_ENABLED = false; return; }
    let changed = false;
    for (const [k, v] of Object.entries(j.items || {})) {
      ENRICH[k] = Object.assign(ENRICH[k] || {}, v);
      delete ENRICH[k]._cov;                              // the cover-only seed is superseded
      changed = true;
    }
    // The rows we looked up and found nothing for. They will never get a cover, so
    // they must stop pretending one is on the way.
    if (j.noMatch) {
      const before = NO_MATCH.size;
      NO_MATCH = new Set(j.noMatch);
      if (NO_MATCH.size !== before) changed = true;
    }
    if (j.stats) updateEnrichStatus(j.stats);
    // The map now holds everything the server has matched so far, which is as good an
    // answer as a filter is going to get. Set before the re-renders below, not after, or
    // the render this releases would look at the flag and hold out all over again.
    ENRICH_READY = true;
    if (changed) {
      /* Everything downstream of the map just went stale. One call rather than the list
         that used to be here, because the same list also lives at boot and behind the ✱
         Refresh button, and hand-copying it into three files is how two of them ended up
         missing entries (see resetDerived, app.js).

         Why it matters, concretely — several health checks read the map and cache their
         results, so "no metadata" reads as "all 14,747 games" without this. Groupings and
         Challenges group on UNIFIED (sheet + IGDB) values, so their membership shifts as
         enrichment lands. And the prediction model was fitted from THIS MAP and cached
         before it existed: landing on Home paints the "You'd probably love" shelf at once,
         that calls tasteModel(), and the model it keeps for the rest of the session has
         learned exactly zero IGDB tags. Measured on the live site before this existed:
         land on Home and the model knows 0 tags; land on Stats (whose panel happens to ask
         late) and it knows 3,722. It hid for so long because the sheet's own columns cover
         for missing tags on a backlog game — 8.93 against 8.88, which is nothing. It is
         not nothing for a game that ISN'T on the sheet: the catalogue model has no columns
         to fall back to, so tagless it scores every game at your global mean and the
         Recommendations tab becomes 25,000 rows of 64%.

         The catalogue likewise answers "do I already own this?" out of the map that just
         changed — without dropping it, Pick shows a game you own TWICE, once as a sheet
         row and once as a catalogue row. */
      _enrichEpoch++;
      resetDerived();
      // Patch in place rather than re-rendering (which would flicker every image).
      if (activeTab === "stats") renderStats();
      else if (activeTab === "home") patchHomeCovers();   // in place: a full re-render flickers
      else if (activeTab === "challenges") renderChallenges();
      else if (activeTab === "health") renderHealth();
      else if (activeTab === "groups") renderGroups();     // membership shifts, not just covers
      // Swipe must rebuild against the newly arrived ownership ids. Its first render waits
      // for this map, and later backfill polls can also claim a catalogue game mid-session.
      else if (activeTab === "swipe") renderSwipe();
      /* Recommendations is the most enrichment-dependent thing here and the least able to
         say so. Opened by direct link it paints before this map arrives, and with no map
         there are no tags to predict from and no igdbIds to join on — so it shows the
         whole catalogue, unfiltered, every game scored at your global mean because the
         model has nothing to go on, sorted by nothing. It looks like data. Re-render. */
      // Recs covers are catalogue art (stable), so an enrichment poll doesn't change what's on
      // screen — patch in place rather than a full renderAll (which flickered the grid and
      // restarted the tour). Newly-owned games drop out on the next visit to the tab, when the
      // gate rebuilds the sheet.
      else if (activeTab === "recs") {
        if (!DATA.sheets.recs || _recsJob) renderAll();
        else patchEnrichedCells();
      }
      // The global search groups copies and derives its owned/tracked chips FROM this map, so the
      // first render before it lands can't dedupe (Hollow Knight shows once per platform). Re-run
      // when the map arrives (and as a backfill refines it); renderSearch debounces the rebuild.
      else if (activeTab === "search") renderSearch();
      /* Pick was excluded from every branch here, so the picker never heard that the map
         had landed. It matters now: RNG's slots are decided by publishers, genres and
         IGDB's rating count, none of which exist before this, so the tab paints a
         skeleton until it arrives (rngLoading) and this is what releases it. */
      else if (activeTab === "pick") pickEnrichLanded(false);
      else {
        /* If a filter or a sort on screen reads this map, the row list itself may be wrong —
           not just the covers in it. It was computed against whatever the map held at the
           time, which on a shared link is nothing at all. But a full renderAll rebuilds every
           tile (flicker, and it restarts the hover/tour), so only pay that when the list
           ACTUALLY changed: a backfill that just filled in a cover for a game already on
           screen leaves the filtered set — and the sort order, unless you're sorting on the
           map — identical, and those covers patch in place like any other poll. */
        if (stateNeedsEnrichment() && enrichListChanged()) renderAll();
        else {
          patchEnrichedCells();
          patchTimelineCovers();          // the Completed tab's third view
          renderFacets();
          // Grouping keys off the IGDB id, which lives in the enrichment map — and
          // the grid paints before that map arrives, so the first render has
          // nothing to group by. Re-render, but only when the grouping actually
          // changes, or we'd flash the grid on every poll.
          if (!SPECIAL_TABS.includes(activeTab) && combineOn()) {
            resetRelations();
            const n = groupByGame(currentFiltered).length;
            if (n !== lastGroupedCount) { lastGroupedCount = n; renderTable(currentFiltered); }
          }
        }
      }
    }
    if (j.stats && !j.stats.complete) {             // a backfill is still running
      clearTimeout(allTimer);
      allTimer = setTimeout(loadAllEnrichment, 45000);
    }
  } catch (_) { /* transient */ }
  finally {
    /* Every way out of this function, including the ones above that never reach the
       renders — a 500, a dropped connection, enrichment switched off server-side — has to
       release a render that is holding for the map. Filtering against a map that never
       came is wrong; a page that shimmers forever is worse, because it doesn't even look
       like a failure. On the ordinary path this is a no-op: the render already happened,
       and it cleared the flag on its way through. */
    ENRICH_READY = true;
    if (ENRICH_WAITING) renderAll();
  }
}
