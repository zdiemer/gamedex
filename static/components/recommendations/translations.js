"use strict";

// UI components for translations.js. Feature state and orchestration remain in that module.

const twMsg = (html) =>
  `<div class="rec-empty"><h2>${icon("i-globe", 20)} Translation Watch</h2><p>${html}</p></div>`;

/* The alert strip: games you already own that just became playable. Pinned above the
   grid because the whole point is that they must not scroll away. */
function twAlertsHtml() {
  const alerts = (TRANSLATIONS && TRANSLATIONS.alerts) || [];
  if (!alerts.length) return "";
  // Owned first: "the copy on my shelf is now readable" outranks "a game I catalogued
  // years ago is now readable", even though both are worth telling you about.
  const RANK = { alert: 0, wishlist: 1, tracked: 2 };
  const TIER_LABEL = { alert: "owned", wishlist: "on your wishlist", tracked: "on your sheet" };
  const sorted = [...alerts].sort(
    (a, b) => (RANK[(a.mine || {}).tier] ?? 9) - (RANK[(b.mine || {}).tier] ?? 9));
  const cards = sorted.map((a) => {
    const tier = (a.mine || {}).tier;
    const was = a.mine && a.mine.english === "Partial" ? "was partially translated" : "had no translation";
    const who = (a.authors || []).join(", ");
    const machine = a.machine ? ` <span class="tw-chip tw-chip-machine">machine translated</span>` : "";
    const owned = tier === "alert" ? ` <span class="tw-chip tw-chip-owned">owned</span>` : "";
    const link = a.sources[0] ? a.sources[0].url : "#";
    return `<li class="tw-alert">
      <a href="${link}" target="_blank" rel="noopener">
        <strong>${escapeHtml(a.title)}</strong></a>${owned}
      <span class="tw-alert-meta">${escapeHtml(a.platform || "")} — ${escapeHtml(TIER_LABEL[tier] || "on your sheet")}, ${was}${
        who ? `, translated by ${escapeHtml(who)}` : ""}</span>${machine}
    </li>`;
  }).join("");
  const n = alerts.length;
  const nOwned = alerts.filter((a) => (a.mine || {}).tier === "alert").length;
  // Lead with the owned count when there is one — it is the strongest version of the
  // claim — and fall back to the collection-wide phrasing otherwise.
  const head = nOwned
    ? `${nOwned} game${nOwned === 1 ? "" : "s"} you own just became playable in English${
        n > nOwned ? ` (+${n - nOwned} more on your sheet)` : ""}`
    : `${n} game${n === 1 ? "" : "s"} on your sheet just became playable in English`;
  return `<div class="tw-alerts">
    <h3>${icon("i-sparkle", 16)} ${escapeHtml(head)}</h3>
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

function twDrawerHtml(row) {
  if (!row || !row._twOnly || !row._tw) return "";
  const t = row._tw;
  const rows = [];
  // The patch's own name, but only when it says something the game title doesn't.
  // Compared loosely: Romhack Plaza files entries under the plain game title, so this
  // usually repeats the heading, and IGDB's casing rarely agrees with the site's
  // ("Eve Burst Error" vs "EVE burst error") — a row that only re-punctuates the
  // title is noise.
  const loose = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (t.patchTitle && loose(t.patchTitle) !== loose(t.title)) {
    rows.push(["Patch", escapeHtml(t.patchTitle)]);
  }
  if ((t.authors || []).length) rows.push(["Translator", escapeHtml(t.authors.join(", "))]);
  if (t.status) rows.push(["Status", escapeHtml(t.status)]);
  if (t.version) rows.push(["Version", escapeHtml(t.version)]);
  if (t.released) {
    rows.push(["Released", new Date(t.released * 1000).toLocaleDateString(undefined,
      { year: "numeric", month: "short", day: "numeric" })]);
  }
  if (t.downloads) rows.push(["Downloads", t.downloads.toLocaleString()]);

  const chips = (t.sources || []).map((s) =>
    `<a class="btn ghost" href="${escapeHtml(s.url)}" target="_blank" rel="noopener"
      >${escapeHtml(TW_SOURCE_LABEL[s.name] || s.name)} ↗</a>`).join(" ");

  // Machine translations are labelled here too, not just in the facet — by the time
  // you are looking at a download link, "who wrote this text" is the thing you want to
  // know, and the Quality facet is three screens away.
  const machine = t.machine
    ? `<div class="tw-drawer-note">${icon("i-alert", 13)} Machine translated — expect rough edges.</div>`
    : "";
  // Any row that joined to the sheet says so, not just the ones that alerted — "this
  // is already in your collection" is worth knowing even when the patch is an addendum
  // or the game was readable to begin with.
  const mine = t.mine
    ? `<div class="tw-drawer-note tw-drawer-mine">${icon("i-sparkle", 13)} ${
        t.mine.owned ? "You own this" : t.mine.wishlisted ? "On your wishlist" : "In your collection"}${
        t.mine.english === "Partial" ? ", and had only a partial translation" :
        t.mine.english === "None" ? ", and had no translation" : ""}.</div>`
    : "";

  return `<div class="hltb tw-drawer">
    <div class="hltb-head">${icon("i-globe", 14)} Fan translation</div>
    ${rows.map(([k, v]) => `<div class="hltb-row"><span>${k}</span><b>${v}</b></div>`).join("")}
    ${mine}${machine}
    <div class="tw-drawer-links">${chips}</div>
  </div>`;
}
