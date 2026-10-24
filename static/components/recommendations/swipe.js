"use strict";

// UI components for swipe.js. Feature state and orchestration remain in that module.

function swipePlatformHtml(id, meta) {
  if (!meta) {
    return `<label class="sw-platform waiting"><span>Platform</span>
      <select disabled><option>Loading platforms…</option></select></label>`;
  }
  const mapped = [...new Set(meta.sheetPlatforms || [])];
  const all = swipeSheetPlatforms();
  const other = all.filter((p) => !mapped.includes(p));
  let selected = _swipePlatforms.get(id);
  if (selected && !all.includes(selected)) selected = null;
  if (!selected && mapped.length) {
    selected = mapped[0];
    _swipePlatforms.set(id, selected);
  }
  const options = (values) => values.map((p) =>
    `<option value="${escapeHtml(p)}"${p === selected ? " selected" : ""}>${escapeHtml(p)}</option>`).join("");
  return `<label class="sw-platform"><span>Wishlist it for</span>
    <select data-sw-platform aria-label="Platform for this game">
      <option value="">Choose a platform…</option>
      ${mapped.length ? `<optgroup label="Released on">${options(mapped)}</optgroup>` : ""}
      ${other.length ? `<optgroup label="Other collection platforms">${options(other)}</optgroup>` : ""}
    </select></label>`;
}

function swipeMessage(title, copy, action = "") {
  return `<div class="sw-empty"><div class="sw-empty-mark">${icon("i-heart", 28)}</div>
    <h2>${escapeHtml(title)}</h2><p>${copy}</p>${action}</div>`;
}

function openSwipeSettings() {
  document.querySelectorAll(".ce-scrim.sw-settings-scrim").forEach((node) => node.remove());
  const settings = swipeSettings();
  const historyCount = swipeSeen().size;
  const host = document.createElement("div");
  host.className = "ce-scrim sw-settings-scrim";
  host.innerHTML = `<div class="ce sw-settings" role="dialog" aria-modal="true" aria-labelledby="swSettingsTitle">
    <button class="ce-x" type="button" aria-label="Close">✕</button>
    <h3 id="swSettingsTitle">Deck settings</h3>
    <div class="ce-sub">Choose what can appear when you swipe</div>
    <form id="swSettingsForm">
      <div class="sw-setting-row">
        <label><span>Released from</span><input name="minYear" type="number" inputmode="numeric" min="1900" max="2100"
          placeholder="Any year" value="${settings.minYear == null ? "" : settings.minYear}"></label>
        <label><span>Through</span><input name="maxYear" type="number" inputmode="numeric" min="1900" max="2100"
          placeholder="Any year" value="${settings.maxYear == null ? "" : settings.maxYear}"></label>
      </div>
      <div class="sw-setting-row">
        <label><span>Minimum predicted score</span><div class="sw-score-input">
          <input name="minScore" type="range" min="0" max="95" step="5" value="${settings.minScore}">
          <output id="swScoreValue">${settings.minScore ? settings.minScore + "%" : "Any"}</output></div></label>
        <label><span>Model confidence</span><select name="confidence">
          <option value="any"${settings.confidence === "any" ? " selected" : ""}>Any confidence</option>
          <option value="fair"${settings.confidence === "fair" ? " selected" : ""}>Fair or high</option>
          <option value="high"${settings.confidence === "high" ? " selected" : ""}>High only</option>
        </select></label>
      </div>
      <fieldset><legend>Genres</legend><p>Games matching any selected genre are included.</p>
        <div class="sw-checks">${swipeChecks("genre", swipeFacetValues("genres"), settings.genres)}</div></fieldset>
      <fieldset><legend>Platforms</legend><p>Games released on any selected platform are included.</p>
        <div class="sw-checks sw-platform-checks">${swipeChecks("platform", swipeFacetValues("platforms"), settings.platforms)}</div></fieldset>
      <div class="sw-history-row"><div><b>${historyCount.toLocaleString()} games remembered</b>
        <span>Passed and wanted games stay out of future decks.</span></div>
        <button class="linkbtn" type="button" data-sw-clear-history${historyCount ? "" : " disabled"}>Show them again</button></div>
      <div class="ce-acts sw-settings-actions"><button class="sh-btn" type="button" data-sw-defaults>Reset filters</button>
        <div class="ce-right"><button class="sh-btn" type="button" data-sw-cancel>Cancel</button>
          <button class="sh-btn primary" type="submit">Save deck</button></div></div>
    </form></div>`;
  const close = () => {
    host.remove();
    document.removeEventListener("keydown", onKey, true);
    if (typeof syncScrollLock === "function") syncScrollLock();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  };
  document.addEventListener("keydown", onKey, true);
  host.querySelector(".ce-x").onclick = close;
  host.querySelector("[data-sw-cancel]").onclick = close;
  host.addEventListener("mousedown", (e) => { if (e.target === host) close(); });
  const form = host.querySelector("#swSettingsForm");
  const range = form.elements.minScore;
  const scoreOut = host.querySelector("#swScoreValue");
  range.oninput = () => { scoreOut.textContent = +range.value ? range.value + "%" : "Any"; };
  host.querySelector("[data-sw-defaults]").onclick = () => {
    form.elements.minYear.value = ""; form.elements.maxYear.value = "";
    form.elements.minScore.value = SWIPE_DEFAULTS.minScore;
    form.elements.confidence.value = SWIPE_DEFAULTS.confidence;
    form.querySelectorAll('input[type="checkbox"]').forEach((el) => { el.checked = false; });
    range.oninput();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    let minYear = Number.parseInt(form.elements.minYear.value, 10) || null;
    let maxYear = Number.parseInt(form.elements.maxYear.value, 10) || null;
    if (minYear != null && maxYear != null && minYear > maxYear) [minYear, maxYear] = [maxYear, minYear];
    const next = {
      minYear, maxYear, minScore: Number(range.value) || 0,
      confidence: form.elements.confidence.value,
      genres: [...form.querySelectorAll('input[name="genre"]:checked')].map((el) => el.value),
      platforms: [...form.querySelectorAll('input[name="platform"]:checked')].map((el) => el.value),
    };
    prefsSave("swipeSettings", [next]);
    close(); renderSwipe(); showToast("Deck settings saved", "i-check");
  };
  host.querySelector("[data-sw-clear-history]").onclick = async () => {
    const ok = await uiConfirm({ title: "Show swiped games again?",
      body: "This clears every remembered pass and want. It does not remove games already staged in Pending edits.",
      ok: "Clear history", danger: true });
    if (!ok) return;
    prefsSave("swiped", []); recsUndismissAll(); _swipeHandled.clear(); _swipeLast = null;
    close(); renderSwipe(); showToast("Swipe history cleared");
  };
  document.body.appendChild(host);
  if (typeof syncScrollLock === "function") syncScrollLock();
  requestAnimationFrame(() => host.querySelector(".ce-x").focus());
}

function swipeCardHtml(x) {
  const row = recRow(x);
  const id = row._igdbId;
  const rec = x.row._igdb || {};
  const metaKnown = Object.prototype.hasOwnProperty.call(RECS_META, id);
  const meta = RECS_META[id] || null;
  const cover = rec.cover ? IMG(rec.cover, "cover_big") : "";
  const pct = Math.round((row.predicted || 0) * 100);
  const why = x.because && x.because.because && x.because.because.length
    ? `Because you liked <b>${x.because.because.slice(0, 2).map(escapeHtml).join("</b> and <b>")}</b>`
    : "";
  const genres = (rec.genres || []).slice(0, 3);
  const summary = meta && meta.summary
    ? escapeHtml(meta.summary.length > 360 ? meta.summary.slice(0, 357).trimEnd() + "…" : meta.summary)
    : (metaKnown ? "No description is available from IGDB."
                 : "Loading IGDB’s description and release details…");
  const next = swipeDeck().filter((q) => q.row.igdbId !== id).slice(0, 2);
  swipeLoadMeta([x, ...next]);

  return `<div class="sw-stage">
    <div class="sw-shadow-card sw-shadow-two"></div><div class="sw-shadow-card sw-shadow-one"></div>
    <article class="sw-card" data-sw-card data-id="${id}" tabindex="0"
      aria-label="${escapeHtml(row.title)}, predicted ${pct} percent">
      <div class="sw-art" data-sw-art title="View details"${cover ? ` style="--sw-bg:url('${escapeHtml(cover)}')"` : ""}>
        ${cover ? `<img src="${escapeHtml(cover)}" alt="" draggable="false">`
                : `<div class="sw-no-cover">${icon("i-library", 42)}</div>`}
        <div class="sw-stamp sw-stamp-no" aria-hidden="true">PASS</div>
        <div class="sw-stamp sw-stamp-yes" aria-hidden="true">WANT</div>
        <span class="sw-score ${ratingClass(row.predicted || 0)}"><b>${pct}</b><small>predicted</small></span>
      </div>
      <div class="sw-info">
        <div class="sw-kicker"><span>IGDB MATCH</span><span>${escapeHtml(row.confidence || "")} confidence</span></div>
        <h1>${escapeHtml(row.title || "Untitled")}</h1>
        <div class="sw-meta">${[(meta && meta.release) || rec.year,
          ...(meta && meta.platforms || rec.platforms || []).slice(0, 3)]
          .filter(Boolean).map((v) => `<span>${escapeHtml(String(v))}</span>`).join("")}</div>
        ${why ? `<p class="sw-why">${why}</p>` : ""}
        ${genres.length ? `<div class="sw-tags">${genres.map((g) => `<span>${escapeHtml(g)}</span>`).join("")}</div>` : ""}
        <p class="sw-summary">${summary}</p>
        <div class="sw-card-foot">${swipePlatformHtml(id, metaKnown ? (meta || {}) : null)}
          <button class="linkbtn sw-details" data-sw-details>Full details</button></div>
        <p class="sw-error" data-sw-error role="alert" hidden></p>
      </div>
    </article>
  </div>
  <div class="sw-actions" aria-label="Recommendation actions">
    <button class="sw-action pass" data-sw-pass aria-label="Pass on ${escapeHtml(row.title)}">
      ${icon("i-close", 22)}<span>Pass</span><kbd>←</kbd></button>
    <button class="sw-undo" data-sw-undo${_swipeLast ? "" : " disabled"} aria-label="Undo last swipe">
      <span aria-hidden="true">↶</span> Undo</button>
    <button class="sw-action want" data-sw-want${metaKnown ? "" : " disabled"} aria-label="Add ${escapeHtml(row.title)} to wishlist">
      ${icon("i-heart", 21)}<span>Want</span><kbd>→</kbd></button>
  </div><div class="sw-live" id="swipeStatus" aria-live="polite"></div>`;
}

function renderSwipe() {
  const host = $("#swipe");
  if (!host) return;
  if (!IS_ADMIN) {
    host.innerHTML = swipeMessage("Sign in to swipe", "Accepted games are staged as edits, so this view is available to the collection owner.");
    return;
  }
  if (typeof ENRICH_ENABLED !== "undefined" && ENRICH_ENABLED && !ENRICH_READY) {
    ENRICH_WAITING = true;
    host.innerHTML = swipeMessage("Checking your library", "Matching your collection before building the deck…",
      `<div class="sw-loader" aria-label="Loading"></div>`);
    return;
  }
  ENRICH_WAITING = false;
  if (!catEnabled()) {
    host.innerHTML = swipeMessage("Recommendations aren’t enabled", "Turn on the IGDB catalogue to build a swipe deck.");
    return;
  }
  if (!CAT) {
    host.innerHTML = swipeMessage("Building your deck", "Fetching the IGDB catalogue and comparing it with your ratings…",
      `<div class="sw-loader" aria-label="Loading"></div>`);
    ensureCatalogue().then(() => { if (activeTab === "swipe") renderSwipe(); });
    return;
  }
  const model = tasteModel();
  if (!model.ok) {
    host.innerHTML = swipeMessage("Rate a few more games", `Gamedex needs at least ${MIN_HISTORY} ratings before it can make personal recommendations.`);
    return;
  }
  const x = swipeCurrent();
  const settings = swipeSettings();
  const filterCount = swipeSettingsCount(settings);
  if (!x) {
    const dismissed = recsDismissed().size;
    const seen = swipeSeen().size;
    host.innerHTML = swipeMessage("You’re caught up",
      filterCount ? "No unseen games match your deck settings." :
        (seen ? "You’ve swiped every matching recommendation." : "There are no new IGDB recommendations right now."),
      `<div class="sw-empty-actions">
        ${_swipeLast ? `<button class="sh-btn" data-sw-undo>Undo last swipe</button>` : ""}
        <button class="btn" data-sw-settings>${icon("i-filter", 14)} Deck settings${filterCount ? ` (${filterCount})` : ""}</button>
        ${dismissed ? `<button class="sh-btn" data-sw-reset>Restore passed games</button>` : ""}
      </div>`);
    swipeWire(host, null);
    return;
  }
  const remaining = swipeDeck().length;
  host.innerHTML = `<div class="sw-shell"><header class="sw-head">
      <div><span class="sw-eyebrow">${icon("i-sparkle", 13)} FOR YOU</span>
        <h2>Find your next game</h2><p>Left to pass. Right to add it to Wishlist and Pending edits.</p></div>
      <div class="sw-head-tools"><div class="sw-progress"><b>${remaining.toLocaleString()}</b><span>matches left</span>
        <small>${_swipeAccepted} wanted · ${_swipePassed} passed this session</small></div>
        <button class="sw-settings-btn" type="button" data-sw-settings aria-label="Deck settings">
          ${icon("i-filter", 14)}<span>Settings</span>${filterCount ? `<b>${filterCount}</b>` : ""}</button></div>
    </header>${swipeCardHtml(x)}</div>`;
  swipeWire(host, x);
}
