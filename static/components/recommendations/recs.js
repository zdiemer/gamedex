"use strict";

// UI components for recs.js. Feature state and orchestration remain in that module.

const recsMsg = (html) =>
  `<div class="rec-empty"><h2>${icon("i-sparkle", 20)} Recommendations</h2><p>${html}</p></div>`;

/* The gate: is the tab renderable as a sheet yet? Paints its own loading / empty message
   into #recs and returns false when not; builds the sheet and returns true when ready.
   renderAll (app.js) shows #recs when this is false and the shared listing when it's true. */
function recsReady() {
  const host = $("#recs");
  if (typeof catEnabled === "function" && !catEnabled()) {
    host.innerHTML = recsMsg(`The IGDB catalog isn't enabled, so there's nothing to recommend from.
      Set <code>igdb.catalogue: true</code> and give the crawl a few minutes.`);
    return false;
  }
  if (typeof CAT === "undefined" || !CAT) {
    host.innerHTML = recsMsg(`${icon("i-sparkle", 16)} Fetching the IGDB catalog…`);
    if (!_recsBusy && typeof ensureCatalogue === "function") {
      _recsBusy = true;
      ensureCatalogue().then(() => { _recsBusy = false; if (activeTab === "recs") renderAll(); });
    }
    return false;
  }
  if ((typeof CAT_ERROR !== "undefined" && CAT_ERROR) || !CAT.length) {
    host.innerHTML = recsMsg(CAT_ERROR ? "Couldn't fetch the catalog." : "The catalog is still being built. Check back shortly.");
    return false;
  }
  // Wait for the ownership/tag map before spending time fitting a model that
  // would immediately be invalidated (and briefly recommending tracked games).
  if (typeof ENRICH_ENABLED !== "undefined" && ENRICH_ENABLED && !ENRICH_READY) {
    ENRICH_WAITING = true;
    if (typeof ENRICH_BATCH_DONE === "function") ENRICH_BATCH_DONE();
    host.innerHTML = recsMsg("Loading your library’s game data…");
    return false;
  }
  const n = ((DATA.sheets.completed || {}).rows || []).filter(r => r.rating != null).length;
  if (n < MIN_HISTORY) {
    host.innerHTML = recsMsg(`Not enough rated games yet to predict anything (${n} of ${MIN_HISTORY}).`);
    return false;
  }
  if (!buildRecsSheet(false)) {
    host.innerHTML = recsMsg("Finding your recommendations…");
    return false;
  }
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
  return `<span class="card-meta ${ratingClass(row.predicted)}" title="Predicted rating: how you'd probably score it">${Math.round(row.predicted * 100)}</span>`;
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
