"use strict";

// Steam extras — all keyed on the appid, so if they're here they're right.
/* Co-op. IGDB says "co-operative" and stops; this says whether that's two people
   on one sofa or eight strangers online — the only part that decides what you
   actually play tonight. */
function coopHtml(key) {
  const c = COOPC[key];
  if (!c) return "";
  const rows = [];
  if (c.localPlayers > 1) {
    rows.push(`<div class="hltb-row"><span>On one screen</span><b class="good">${c.localPlayers} players${c.splitscreen ? " · splitscreen" : ""}</b></div>`);
  }
  if (c.onlinePlayers > 1) rows.push(`<div class="hltb-row"><span>Online</span><b>${c.onlinePlayers} players</b></div>`);
  if (c.lanPlayers > 1) rows.push(`<div class="hltb-row"><span>LAN</span><b>${c.lanPlayers} players</b></div>`);
  if (c.campaignCoop) rows.push(`<div class="hltb-row"><span>Campaign</span><b class="good">Playable co-op</b></div>`);
  if (c.dropIn) rows.push(`<div class="hltb-row"><span>Drop-in</span><b>Join mid-game</b></div>`);
  // The numbers say co-op is possible; coopExperience says what it's actually LIKE — which
  // is the bit you want before committing someone else's evening. Stored, never shown.
  const feats = (c.features || []).slice(0, 8)
    .map((f) => chipHtml(f)).join("");
  const prose = c.coopExperience
    ? `<p class="coop-desc">${escapeHtml(c.coopExperience)}</p>` : "";
  if (!rows.length && !prose && !feats) return "";
  const link = c.url
    ? `<a class="hltb-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">View on Co-Optimus ↗</a>` : "";
  return sourcePanelHtml(`${icon("i-star", 15)} Co-op (Co-Optimus)`,
    `${rows.join("")}${feats ? `<div class="chips">${feats}</div>` : ""}${prose}${link}`);
}
