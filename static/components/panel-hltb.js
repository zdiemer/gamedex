"use strict";

function hltbHtml(h) {
  const est = drawerRow ? drawerRow.estimatedTime : null;
  if (h) {
    const rows = [["Main Story", h.main], ["Main + Extras", h.mainPlus], ["Completionist", h.hundred], ["All Styles", h.allStyles]]
      .filter(([, v]) => v != null);
    if (!rows.length && est == null) return "";
    return sourcePanelHtml(`⏱ HowLongToBeat`,
      rows.map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${fmtHours(v)}</b></div>`).join("") +
      (h.url ? `<a class="hltb-link" href="${escapeHtml(h.url)}" target="_blank" rel="noopener">View on HowLongToBeat ↗</a>` : ""));
  }
  if (est != null)
    return sourcePanelHtml(`⏱ Playtime`, `<div class="hltb-row"><span>Estimated (from sheet)</span><b>${fmtHours(est)}</b></div>`);
  return "";
}
