"use strict";

function guidesHtml(key) {
  const g = GDC[key];
  if (!g) return "";
  const secs = (g.sections || []).slice(0, 6)
    .map((x) => chipHtml(x)).join("");
  return sourcePanelHtml(`${icon("i-review", 15)} Guide (StrategyWiki)`,
    (secs ? `<div class="chips">${secs}</div>` : "") +
    `<a class="hltb-link" href="${escapeHtml(g.url)}" target="_blank" rel="noopener">${g.hasWalkthrough ? "Read the walkthrough" : "Open the guide"} ↗</a>`);
}
