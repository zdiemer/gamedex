"use strict";

function salesHtml(key) {
  const v = VGC[key];
  if (!v || v.units == null) return "";
  const rows = [["Shipped", v.shipped], ["Sold", v.sold]].filter(([, x]) => x != null)
    .map(([l, x]) => `<div class="hltb-row"><span>${l}</span><b>${x.toLocaleString()}</b></div>`).join("");
  return sourcePanelHtml(`${icon("i-trend", 15)} Sales (VGChartz)`, `${rows}` +
    `<div class="hltb-note muted">VGChartz estimate${v.console ? ` · ${escapeHtml(v.console)}` : ""}</div>` +
    (v.url ? `<a class="hltb-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">View on VGChartz ↗</a>` : ""));
}
