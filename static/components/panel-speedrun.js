"use strict";

// The world record, next to HowLongToBeat: a nice sense of scale.
function speedrunHtml(key) {
  const r = SRC[key];
  if (!r || !r.wrTime) return "";
  const rows = (r.categories || []).slice(0, 3).map((c) =>
    `<div class="hltb-row"><span>${escapeHtml(c.category)}</span><b>${escapeHtml(c.time)}</b></div>`).join("");
  // We store wrUrl — the link to the record RUN — and only ever linked the leaderboard.
  // The run is the thing worth watching; the leaderboard is a table of times.
  const wr = r.wrUrl
    ? `<a class="hltb-link" href="${escapeHtml(r.wrUrl)}" target="_blank" rel="noopener">` +
      `Watch the world record${r.wrCategory ? ` · ${escapeHtml(r.wrCategory)}` : ""}${r.wrTime ? ` (${escapeHtml(r.wrTime)})` : ""} ↗</a>` : "";
  return sourcePanelHtml(`${icon("i-trophy", 15)} World records`, `${rows}${wr}` +
    (r.url ? `<a class="hltb-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Leaderboards on speedrun.com ↗</a>` : ""));
}
