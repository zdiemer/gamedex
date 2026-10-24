"use strict";

function metacriticHtml(key) {
  // The critic score, whichever source answered — Metacritic, your sheet, IGDB's critic
  // aggregate, or the GameRankings archive. Always say which, so a number is never
  // mistaken for a Metacritic one it isn't.
  if (!drawerRow) return "";
  const v = criticOf(drawerRow);
  if (v == null) return "";
  const s = criticSourceOf(drawerRow) || { label: "Critics" };
  const score = Math.round(v * 100);
  const name = s.url
    ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)} ↗</a>`
    : escapeHtml(s.label);
  const extra = s.sheet ? " · from sheet" : (s.n ? ` · ${s.n} reviews` : "");
  return `<div class="hltb"><div class="hltb-row"><span>Critics</span>` +
    `<b class="${ratingClass(v)}">${score} <small class="muted">· ${name}${extra}</small></b></div></div>`;
}
