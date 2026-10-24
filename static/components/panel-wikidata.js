"use strict";

/* Wikidata: the bridge. Joined on the IGDB slug, so also exact.

   Not a metadata source — it's how we reach the things IGDB has never carried. The composer
   is the headline: nothing else in the app knows who scored a game. */
function wikidataHtml(key) {
  const w = WDC[key];
  if (!w) return "";
  const people = [["Composer", w.composers], ["Director", w.directors]]
    .filter(([, v]) => v && v.length)
    .map(([l, v]) => `<div class="hltb-row"><span>${v.length > 1 ? l + "s" : l}</span><b>${escapeHtml(v.join(", "))}</b></div>`)
    .join("");
  const links = [
    w.wikipedia ? `<a class="hltb-link" href="${escapeHtml(w.wikipedia)}" target="_blank" rel="noopener">Read about it on Wikipedia ↗</a>` : "",
    w.mobyUrl ? `<a class="hltb-link" href="${escapeHtml(w.mobyUrl)}" target="_blank" rel="noopener">View on MobyGames ↗</a>` : "",
  ].filter(Boolean).join("");
  if (!(people || links)) return "";
  return sourcePanelHtml(`${icon("i-library", 15)} Also known (Wikidata)`,
    people + links + ``);
}
