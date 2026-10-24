"use strict";

/* The physical object: the booklet, the printed disc, the box wrap — and the facts about
   YOUR copy that the Notes column already told us and nobody ever read back.

   Every field here was being scraped or parsed and then dropped: the manuals and gametdb
   tables were never even returned by /api/enrichment/detail, and notes.py's copiesOwned /
   physicalMedia / requiredAccessory / multiDiscCollection / damaged were attached to every
   row in the payload with not one reader in the UI. */
function physicalHtml(key) {
  const m = MANC[key], g = GTDBC[key], row = drawerRow || {};
  const art = [["Disc face", g && g.disc], ["Box wrap", g && g.coverFull]]
    .filter(([, u]) => u)
    .map(([l, u]) => `<figure class="adb-art"><img loading="lazy" src="${escapeHtml(cImg(u))}" alt="${l}"><figcaption>${l}</figcaption></figure>`)
    .join("");

  const rows = [];
  if (m && m.pages) rows.push(["Manual", `${m.pages} pages`]);
  if (g && g.gameId) rows.push(["Disc ID", g.gameId + (g.region ? ` · ${g.region}` : "")]);
  // Your copy, per the sheet's Notes.
  if (row.copiesOwned > 1) rows.push(["Copies owned", String(row.copiesOwned)]);
  if (row.edition) rows.push(["Edition", row.edition]);
  if (row.physicalMedia) rows.push(["Media", row.physicalMedia]);
  if (row.requiredAccessory) rows.push(["Requires", row.requiredAccessory]);
  if (row.multiDiscCollection) rows.push(["Collection", row.multiDiscCollection]);
  const body = rows
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(String(v))}</b></div>`).join("");
  const dmg = row.damaged
    ? `<div class="hltb-row"><span>Condition</span><b class="bad">Damaged</b></div>` : "";

  const links = [];
  if (m && m.embed) {
    links.push(`<a class="hltb-link" href="#" data-read-manual>Read the manual${m.pages ? ` (${m.pages} pages)` : ""}</a>`);
  }
  if (m && m.pdf) links.push(`<a class="hltb-link" href="${escapeHtml(cManual(m.pdf))}" target="_blank" rel="noopener">Open the PDF ↗</a>`);
  if (g && g.url) links.push(`<a class="hltb-link" href="${escapeHtml(g.url)}" target="_blank" rel="noopener">View on GameTDB ↗</a>`);

  if (!(art || body || dmg || links.length)) return "";
  return sourcePanelHtml(`${icon("i-package", 15)} In the box`,
    (art ? `<div class="adb-arts">${art}</div>` : "") + body + dmg + links.join(""));
}
