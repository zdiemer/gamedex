"use strict";

function vndbHtml(key) {
  const v = VNC[key];
  if (!v) return "";
  const rows = [
    ["Rating", v.rating != null ? `${Math.round(v.rating * 100)}%${v.votes ? ` (${v.votes.toLocaleString()} votes)` : ""}` : null],
    ["Median length", v.hours != null ? fmtHours(v.hours) : null],
    ["Released", v.released || null],
  ].filter(([, x]) => x)
    .map(([l, x]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(String(x))}</b></div>`).join("");
  // VNDB writes a real synopsis, and we store it. For a visual novel IGDB never matched it
  // is the ONLY description the game has — so it must not depend on `rows` being non-empty.
  const desc = v.description
    ? `<p class="vndb-desc">${escapeHtml(v.description)}</p>` : "";
  if (!rows && !desc) return "";
  return sourcePanelHtml(`${icon("i-review", 15)} Visual novel (VNDB)`, `${desc}${rows}` +
    (v.url ? `<a class="hltb-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">View on VNDB ↗</a>` : ""));
}
