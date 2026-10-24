"use strict";

// Arcade Database: cabinet/marquee scans plus the cabinet's own specs. Matched
// on the MAME romset, so if it's here at all it's the right machine.
function arcadeHtml(key) {
  const a = ADBC[key];
  if (!a) return "";
  const shots = [["Cabinet", a.cabinet], ["Marquee", a.marquee], ["Flyer", a.flyer],
                 ["Title", a.titleScreen], ["In game", a.ingame]]
    .filter(([, u]) => u)
    .map(([l, u]) => `<figure class="adb-art"><img loading="lazy" src="${escapeHtml(cImg(u))}" alt="${l}"><figcaption>${l}</figcaption></figure>`)
    .join("");
  const spec = [
    ["Players", a.playersDetail || (a.players != null ? String(a.players) : null)],
    ["Controls", a.controls], ["Buttons", a.buttons != null ? String(a.buttons) : null],
    ["Screen", [a.orientation, a.resolution].filter(Boolean).join(" · ") || null],
    ["Manufacturer", a.manufacturer], ["Year", a.year],
  ].filter(([, v]) => v)
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(String(v))}</b></div>`).join("");
  // ArcadeDB ships a shortplay video of the real cabinet running, for every machine — and
  // we have been storing the URL and never playing it. Not autoplayed: a drawer that starts
  // making noise at you is a drawer you close. Click it.
  const vid = a.video
    ? `<video class="adb-vid" src="${escapeHtml(a.video)}" controls preload="none"
              ${a.titleScreen ? `poster="${escapeHtml(a.titleScreen)}"` : ""}></video>
       <div class="hltb-note muted">Shortplay footage of the cabinet</div>` : "";
  const extra = [
    ["Genre", a.genre], ["Series", a.series],
    ["MAME rating", a.rating != null ? `${a.rating}/100` : null],
  ].filter(([, v]) => v)
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(String(v))}</b></div>`).join("");
  return sourcePanelHtml(`${icon("i-dice", 15)} Arcade cabinet${a.romset ? ` <span class="muted">${escapeHtml(a.romset)}</span>` : ""}`,
    (shots ? `<div class="adb-arts">${shots}</div>` : "") + vid + spec + extra +
    (a.history ? `<details class="adb-history"><summary>MAME history</summary><p>${escapeHtml(a.history)}</p></details>` : "") +
    (a.url ? `<a class="hltb-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">View on Arcade Database ↗</a>` : ""));
}
