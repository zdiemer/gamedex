"use strict";

function gameyeHtml(key) {
  const ge = GEC[key];
  if (!ge) return "";
  // Manual and Box were scraped and stored from the start and never shown — which is odd,
  // because for a collector they are the interesting half: they are what the difference
  // between a loose cart and a complete-in-box copy is actually MADE of.
  const rows = [["Loose", ge.priceLoose], ["CIB", ge.priceCib], ["New", ge.priceNew],
                ["Manual only", ge.priceManual], ["Box only", ge.priceBox]]
    .filter(([, v]) => v != null);
  if (!rows.length) return "";
  const cond = (drawerRow && drawerRow.condition) || "";
  const key2 = { complete: "priceCib", cib: "priceCib", loose: "priceLoose", new: "priceNew" }[cond.toLowerCase()] || "priceLoose";
  // notes.py already parsed the copy count out of "Gray and gold copies"; quantityFromNotes
  // catches the other phrasing ("Two copies owned"). Prefer the parsed field, fall back to
  // the text — between them they cover both ways the sheet says it.
  const qty = (drawerRow && drawerRow.copiesOwned) || quantityFromNotes(drawerRow && drawerRow.notes);
  let mine = "";
  if (ge[key2] != null) {
    const total = ge[key2] * qty;
    mine = `<div class="hltb-row mine"><span>Your copy${qty > 1 ? ` ×${qty}` : ""}${cond ? ` (${escapeHtml(cond)})` : ""}</span><b>$${total.toFixed(2)}</b></div>`;
  }
  return sourcePanelHtml(`${icon("i-trend", 15)} Value (GameEye)`,
    rows.map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>$${v.toFixed(2)}</b></div>`).join("") + mine +
    (ge.url ? `<a class="hltb-link" href="${escapeHtml(ge.url)}" target="_blank" rel="noopener">View on GameEye ↗</a>` : ""));
}
