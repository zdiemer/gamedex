"use strict";

// A little VR-headset badge for the top-right of a poster card. `row.vr` is the
// sheet's VR bool (parse.py), already on every row. Returns "" for flat games so
// the badge only ever appears where it means something. pointer-events:none in
// CSS keeps it from stealing the card's hover/click.
const vrBadgeHtml = (row) =>
  row && row.vr
    ? `<span class="vr-badge" title="Playable in VR" aria-label="Playable in VR">${icon("i-vr", 15)}</span>`
    : "";

// Shared poster structure for listing, search, Home and challenge cards.
// bodyHtml is trusted renderer output; callers own events and row registration.
function posterContentHtml(row, bodyHtml, { pending = false } = {}) {
  const enrichment = ENRICH[row._k];
  const cs = coverSrc(enrichment, "cover_big");
  const pixel = coverIsPixelArt(enrichment, cs) ? " pixel" : "";
  const cover = cs
    ? `<img class="card-cover${pixel}" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
    : `<div class="card-cover ph${pending ? " skel" : ""}">${pending ? "" : icon("i-library", 26)}</div>`;
  return `${cover}${vrBadgeHtml(row)}<div class="card-body">${bodyHtml}</div>`;
}

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
function posterCardHtml(row, { cls = "", note = "", attrs = "" } = {}) {
  return `<button type="button" class="card${cls ? " " + escapeHtml(cls) : ""}" ${attrs}>${
    posterContentHtml(row, posterSummaryHtml(row, { note }))}</button>`;
}
