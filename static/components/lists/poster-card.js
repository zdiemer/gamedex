"use strict";

// A little VR-headset badge for the top-right of a poster card. `row.vr` is the
// sheet's VR bool (parse.py), already on every row. Returns "" for flat games so
// the badge only ever appears where it means something. pointer-events:none in
// CSS keeps it from stealing the card's hover/click.
/**
 * @component Render the decorative VR badge for a game poster.
 * @param {Object|null} row - Row with a truthy vr flag; absent or non-VR rows produce no badge.
 * @returns {string} VR badge HTML or an empty string.
 * @requires icon; i-vr sprite symbol and .vr-badge styles.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Only fixed application labels and icon identifiers are emitted; row text is not interpolated.
 * @example
 * vrBadgeHtml({ vr: true });
 */
const vrBadgeHtml = (row) =>
  row && row.vr
    ? `<span class="vr-badge" title="Playable in VR" aria-label="Playable in VR">${icon("i-vr", 15)}</span>`
    : "";

// Shared poster structure for listing, search, Home and challenge cards.
// bodyHtml is trusted renderer output; callers own events and row registration.
/**
 * @component Render a poster cover, VR badge, and caller-supplied card body.
 * @param {Object} row - Game row; _k selects the default enrichment record and vr controls the badge.
 * @param {string} bodyHtml - Trusted content for .card-body.
 * @param {Object} [options={}] - Cover options.
 * @param {boolean} [options.pending=false] - Show a skeleton when no cover exists.
 * @param {Object} [options.enrichment=ENRICH[row._k]] - Caller-resolved cover record for grouped/fallback data.
 * @param {boolean} [options.eager=false] - Skip lazy loading and asynchronous decoding for picker/randomizer covers.
 * @returns {string} Card inner HTML; does not include an outer card element.
 * @requires ENRICH when enrichment is omitted; coverSrc, coverIsPixelArt, escapeHtml, icon, vrBadgeHtml; .card-* styles.
 * @events Caller owns card clicks, row registration and preview wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Cover URLs are escaped but must be validated by the cover resolver. bodyHtml is trusted renderer output.
 * @example
 * card.innerHTML = posterContentHtml(row, posterSummaryHtml(row), { pending: true });
 */
function posterContentHtml(row, bodyHtml, { pending = false, enrichment = ENRICH[row._k], eager = false } = {}) {
  const cs = coverSrc(enrichment, "cover_big");
  const pixel = coverIsPixelArt(enrichment, cs) ? " pixel" : "";
  const cover = cs
    ? `<img class="card-cover${pixel}" ${eager ? "" : 'loading="lazy" decoding="async" '}src="${escapeHtml(cs)}" alt="">`
    : `<div class="card-cover ph${pending ? " skel" : ""}">${pending ? "" : icon("i-library", 26)}</div>`;
  return `${cover}${vrBadgeHtml(row)}<div class="card-body">${bodyHtml}</div>`;
}

/**
 * @component Render poster title, platform/year metadata and optional extra content.
 * @param {Object} row - Uses title or game (fallback Untitled), platform and releaseYear.
 * @param {Object} [options={}] - Additional content.
 * @param {string} [options.note=""] - Trusted note fragment; empty omits the note.
 * @param {string} [options.afterHtml=""] - Trusted fragment appended after metadata/note.
 * @returns {string} Poster body HTML.
 * @requires escapeHtml and .card-title/.card-sub/.card-note styles.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Title, platform and year are escaped. note and afterHtml are trusted HTML.
 * @example
 * posterSummaryHtml(row, { note: "Recommended" });
 */
function posterSummaryHtml(row, { note = "", afterHtml = "" } = {}) {
  const title = escapeHtml(String(row.title || row.game || "Untitled"));
  const sub = [row.platform, row.releaseYear].filter((x) => x != null && x !== "")
    .map((x) => escapeHtml(String(x))).join(" · ");
  return `<div class="card-title" title="${title}">${title}</div>
    <div class="card-sub">${sub}</div>
    ${note ? `<div class="card-note">${note}</div>` : ""}${afterHtml}`;
}

// Home and Challenges need HTML buttons; the grid and search create elements so
// they can attach row maps and hover previews. All use the same poster structure.
// note and attrs retain the existing trusted-HTML contract.
/**
 * @component Compose an HTML button poster for Home and challenge surfaces.
 * @param {Object} row - Game row passed to the content and summary renderers.
 * @param {Object} [options={}] - Card options.
 * @param {string} [options.cls=""] - Extra card classes; no completion class is inferred.
 * @param {string} [options.note=""] - Trusted summary note.
 * @param {string} [options.attrs=""] - Trusted raw attribute fragment for caller hooks.
 * @returns {string} A type="button" card.
 * @requires posterContentHtml and posterSummaryHtml, including their cover dependencies.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping cls and row metadata are escaped; note and attrs are trusted markup. Escape every external attribute value.
 * @example
 * posterCardHtml(row, { attrs: `data-game="${escapeHtml(String(row._k))}"` });
 */
function posterCardHtml(row, { cls = "", note = "", attrs = "" } = {}) {
  return `<button type="button" class="card${cls ? " " + escapeHtml(cls) : ""}" ${attrs}>${
    posterContentHtml(row, posterSummaryHtml(row, { note }))}</button>`;
}

// Partial collections take precedence over a completed copy in every grid-style card.
/**
 * @component Choose grid-style card classes with partial collections taking precedence.
 * @param {Object} row - Game row understood by collectionStatus and rowCompleted.
 * @returns {string} card, card partial, or card done.
 * @requires collectionStatus and rowCompleted from the collection/data controllers.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Only fixed class strings are returned.
 * @example
 * card.className = posterClassName(row);
 */
function posterClassName(row) {
  const status = collectionStatus(row);
  return "card" + (status === "partial" ? " partial"
    : (status === "complete" || rowCompleted(row)) ? " done" : "");
}
