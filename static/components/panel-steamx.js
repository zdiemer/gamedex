"use strict";

function steamxHtml(key) {
  const x = SXC[key];
  if (!x) return "";
  const deck = x.deck
    ? `<div class="hltb-row"><span>Steam Deck</span><b class="deck deck-${escapeHtml(String(x.deck).toLowerCase())}">${escapeHtml(x.deck)}</b></div>` : "";
  const proton = x.protonTier
    ? `<div class="hltb-row"><span>ProtonDB</span><b class="proton proton-${escapeHtml(String(x.protonTier))}">${escapeHtml(x.protonTier)}${x.protonScore != null ? ` <span class="muted">${Math.round(x.protonScore * 100)}%</span>` : ""}${x.protonReports ? ` <span class="muted">(${x.protonReports} reports)</span>` : ""}</b></div>` : "";
  const rev = x.reviewScore != null
    ? `<div class="hltb-row"><span>Steam reviews</span><b class="${ratingClass(x.reviewScore)}">${Math.round(x.reviewScore * 100)}% positive <span class="muted">of ${(x.positive + x.negative).toLocaleString()}</span></b></div>` : "";
  const own = x.owners
    ? `<div class="hltb-row"><span>Owners (est.)</span><b>${escapeHtml(x.owners)}</b></div>` : "";
  const ccu = x.concurrent
    ? `<div class="hltb-row"><span>Playing now</span><b>${x.concurrent.toLocaleString()}</b></div>` : "";
  const a = x.achievements;
  // We store the rarest achievement's NAME and only ever printed its percentage — so the
  // drawer said "rarest 0.4%" without saying rarest WHAT.
  const ach = a
    ? `<div class="hltb-row"><span>Achievements</span><b>${a.count} <span class="muted">· median ${a.medianPercent}%</span></b></div>` +
      (a.rarest
        ? `<div class="hltb-row"><span>Rarest</span><b>${escapeHtml(String(a.rarest))} <span class="muted">· ${a.rarestPercent}% of players</span></b></div>`
        : `<div class="hltb-row"><span>Rarest</span><b>${a.rarestPercent}% of players</b></div>`) : "";
  if (!(deck || proton || rev || own || ccu || ach)) return "";
  return sourcePanelHtml(`${icon("i-play", 15)} Steam`, `${deck}${proton}${rev}${own}${ccu}${ach}` +
    (x.protonUrl ? `<a class="hltb-link" href="${escapeHtml(x.protonUrl)}" target="_blank" rel="noopener">View on ProtonDB ↗</a>` : ""));
}
