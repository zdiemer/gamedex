"use strict";

// Source adapters provide panel content; panelHtml owns the shared presentation.

const _PCGW_TONE = { true: "good", false: "bad", hackable: "warn", limited: "warn" };
const pcgwCell = (v) =>
  `<b class="${_PCGW_TONE[String(v).toLowerCase()] || ""}">${escapeHtml(titleCase(String(v)))}</b>`;

const SOURCE_PANEL_DATA = {
  arcade(key) {
  const a = ADBC[key];
  if (!a) return null;
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
    .map(([l, v]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${escapeHtml(String(v))}` })).join("");
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
    .map(([l, v]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${escapeHtml(String(v))}` })).join("");
  return { headingHtml: `${icon("i-dice", 15)} Arcade cabinet${a.romset ? ` <span class="muted">${escapeHtml(a.romset)}</span>` : ""}`, bodyHtml: (shots ? `<div class="adb-arts">${shots}</div>` : "") + vid + spec + extra +
    (a.history ? `<details class="adb-history"><summary>MAME history</summary><p>${escapeHtml(a.history)}</p></details>` : "") +
    (a.url ? `<a class="hltb-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">View on Arcade Database ↗</a>` : "") };
},
  coop(key) {
  const c = COOPC[key];
  if (!c) return null;
  const rows = [];
  if (c.localPlayers > 1) {
    rows.push(panelRowHtml({ labelHtml: `On one screen`, valueHtml: `${c.localPlayers} players${c.splitscreen ? " · splitscreen" : ""}`, valueClass: `good` }));
  }
  if (c.onlinePlayers > 1) rows.push(panelRowHtml({ labelHtml: `Online`, valueHtml: `${c.onlinePlayers} players` }));
  if (c.lanPlayers > 1) rows.push(panelRowHtml({ labelHtml: `LAN`, valueHtml: `${c.lanPlayers} players` }));
  if (c.campaignCoop) rows.push(panelRowHtml({ labelHtml: `Campaign`, valueHtml: `Playable co-op`, valueClass: `good` }));
  if (c.dropIn) rows.push(panelRowHtml({ labelHtml: `Drop-in`, valueHtml: `Join mid-game` }));
  // The numbers say co-op is possible; coopExperience says what it's actually LIKE — which
  // is the bit you want before committing someone else's evening. Stored, never shown.
  const feats = (c.features || []).slice(0, 8)
    .map((f) => chipHtml(f)).join("");
  const prose = c.coopExperience
    ? `<p class="coop-desc">${escapeHtml(c.coopExperience)}</p>` : "";
  if (!rows.length && !prose && !feats) return null;
  const link = c.url
    ? `<a class="hltb-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">View on Co-Optimus ↗</a>` : "";
  return { headingHtml: `${icon("i-star", 15)} Co-op (Co-Optimus)`, bodyHtml: `${rows.join("")}${feats ? `<div class="chips">${feats}</div>` : ""}${prose}${link}` };
},
  gameye(key) {
  const ge = GEC[key];
  if (!ge) return null;
  // Manual and Box were scraped and stored from the start and never shown — which is odd,
  // because for a collector they are the interesting half: they are what the difference
  // between a loose cart and a complete-in-box copy is actually MADE of.
  const rows = [["Loose", ge.priceLoose], ["CIB", ge.priceCib], ["New", ge.priceNew],
                ["Manual only", ge.priceManual], ["Box only", ge.priceBox]]
    .filter(([, v]) => v != null);
  if (!rows.length) return null;
  const cond = (drawerRow && drawerRow.condition) || "";
  const key2 = { complete: "priceCib", cib: "priceCib", loose: "priceLoose", new: "priceNew" }[cond.toLowerCase()] || "priceLoose";
  // notes.py already parsed the copy count out of "Gray and gold copies"; quantityFromNotes
  // catches the other phrasing ("Two copies owned"). Prefer the parsed field, fall back to
  // the text — between them they cover both ways the sheet says it.
  const qty = (drawerRow && drawerRow.copiesOwned) || quantityFromNotes(drawerRow && drawerRow.notes);
  let mine = "";
  if (ge[key2] != null) {
    const total = ge[key2] * qty;
    mine = panelRowHtml({ labelHtml: `Your copy${qty > 1 ? ` ×${qty}` : ""}${cond ? ` (${escapeHtml(cond)})` : ""}`, valueHtml: `$${total.toFixed(2)}`, className: `mine` });
  }
  return { headingHtml: `${icon("i-trend", 15)} Value (GameEye)`, bodyHtml: rows.map(([l, v]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `$${v.toFixed(2)}` })).join("") + mine +
    (ge.url ? `<a class="hltb-link" href="${escapeHtml(ge.url)}" target="_blank" rel="noopener">View on GameEye ↗</a>` : "") };
},
  guides(key) {
  const g = GDC[key];
  if (!g) return null;
  const secs = (g.sections || []).slice(0, 6)
    .map((x) => chipHtml(x)).join("");
  return { headingHtml: `${icon("i-review", 15)} Guide (StrategyWiki)`, bodyHtml: (secs ? `<div class="chips">${secs}</div>` : "") +
    `<a class="hltb-link" href="${escapeHtml(g.url)}" target="_blank" rel="noopener">${g.hasWalkthrough ? "Read the walkthrough" : "Open the guide"} ↗</a>` };
},
  hltb(h) {
  const est = drawerRow ? drawerRow.estimatedTime : null;
  if (h) {
    const rows = [["Main Story", h.main], ["Main + Extras", h.mainPlus], ["Completionist", h.hundred], ["All Styles", h.allStyles]]
      .filter(([, v]) => v != null);
    if (!rows.length && est == null) return null;
    return { headingHtml: `⏱ HowLongToBeat`, bodyHtml: rows.map(([l, v]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${fmtHours(v)}` })).join("") +
      (h.url ? `<a class="hltb-link" href="${escapeHtml(h.url)}" target="_blank" rel="noopener">View on HowLongToBeat ↗</a>` : "") };
  }
  if (est != null)
    return { headingHtml: `⏱ Playtime`, bodyHtml: panelRowHtml({ labelHtml: `Estimated (from sheet)`, valueHtml: `${fmtHours(est)}` }) };
  return null;
},
  metacritic(key) {
  // The critic score, whichever source answered — Metacritic, your sheet, IGDB's critic
  // aggregate, or the GameRankings archive. Always say which, so a number is never
  // mistaken for a Metacritic one it isn't.
  if (!drawerRow) return null;
  const v = criticOf(drawerRow);
  if (v == null) return null;
  const s = criticSourceOf(drawerRow) || { label: "Critics" };
  const score = Math.round(v * 100);
  const name = s.url
    ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)} ↗</a>`
    : escapeHtml(s.label);
  const extra = s.sheet ? " · from sheet" : (s.n ? ` · ${s.n} reviews` : "");
  return { bodyHtml: `<div class="hltb-row"><span>Critics</span>` +
    `<b class="${ratingClass(v)}">${score} <small class="muted">· ${name}${extra}</small></b></div>` };
},
  pcgw(key) {
  const p = PCGWC[key];
  if (!p) return null;
  const display = [
    ["Widescreen", p.widescreen], ["Ultrawide", p.ultrawide],
    ["4K", p.uhd4k], ["HDR", p.hdr], ["Ray tracing", p.rayTracing],
    ["Controller", p.controller], ["Surround", p.surround],
  ].filter(([, v]) => v)
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span>${pcgwCell(v)}</div>`).join("");
  // The APIs it renders with, and whether it's a 64-bit binary — the things that decide
  // whether a 2007 PC game is going to behave on a modern machine.
  const tech = [
    ["Direct3D", p.d3d], ["OpenGL", p.opengl], ["Vulkan", p.vulkan],
    ["64-bit", p.win64],
  ].filter(([, v]) => v)
    .map(([l, v]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${escapeHtml(titleCase(String(v)))}` })).join("");
  if (!(display || tech || p.url)) return null;
  // A page can exist with none of its infobox filled in (15 of the first 238 matched). The
  // link is still the point of the section — that page is where the fixes and tweaks live —
  // so surface it rather than hiding the whole thing over a set of empty fields.
  const blank = !display && !tech
    ? `<div class="hltb-note muted">No compatibility details filled in yet.</div>` : "";
  return { headingHtml: `${icon("i-play", 15)} On PC (PCGamingWiki)`, bodyHtml: display + tech + blank +
    (p.url ? `<a class="hltb-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Fixes and details on PCGamingWiki ↗</a>` : "") };
},
  physical(key) {
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
    .map(([l, v]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${escapeHtml(String(v))}` })).join("");
  const dmg = row.damaged
    ? panelRowHtml({ labelHtml: `Condition`, valueHtml: `Damaged`, valueClass: `bad` }) : "";

  const links = [];
  if (m && m.embed) {
    links.push(`<a class="hltb-link" href="#" data-read-manual>Read the manual${m.pages ? ` (${m.pages} pages)` : ""}</a>`);
  }
  if (m && m.pdf) links.push(`<a class="hltb-link" href="${escapeHtml(cManual(m.pdf))}" target="_blank" rel="noopener">Open the PDF ↗</a>`);
  if (g && g.url) links.push(`<a class="hltb-link" href="${escapeHtml(g.url)}" target="_blank" rel="noopener">View on GameTDB ↗</a>`);

  if (!(art || body || dmg || links.length)) return null;
  return { headingHtml: `${icon("i-package", 15)} In the box`, bodyHtml: (art ? `<div class="adb-arts">${art}</div>` : "") + body + dmg + links.join("") };
},
  sales(key) {
  const v = VGC[key];
  if (!v || v.units == null) return null;
  const rows = [["Shipped", v.shipped], ["Sold", v.sold]].filter(([, x]) => x != null)
    .map(([l, x]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${x.toLocaleString()}` })).join("");
  return { headingHtml: `${icon("i-trend", 15)} Sales (VGChartz)`, bodyHtml: `${rows}` +
    `<div class="hltb-note muted">VGChartz estimate${v.console ? ` · ${escapeHtml(v.console)}` : ""}</div>` +
    (v.url ? `<a class="hltb-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">View on VGChartz ↗</a>` : "") };
},
  speedrun(key) {
  const r = SRC[key];
  if (!r || !r.wrTime) return null;
  const rows = (r.categories || []).slice(0, 3).map((c) =>
    panelRowHtml({ labelHtml: `${escapeHtml(c.category)}`, valueHtml: `${escapeHtml(c.time)}` })).join("");
  // We store wrUrl — the link to the record RUN — and only ever linked the leaderboard.
  // The run is the thing worth watching; the leaderboard is a table of times.
  const wr = r.wrUrl
    ? `<a class="hltb-link" href="${escapeHtml(r.wrUrl)}" target="_blank" rel="noopener">` +
      `Watch the world record${r.wrCategory ? ` · ${escapeHtml(r.wrCategory)}` : ""}${r.wrTime ? ` (${escapeHtml(r.wrTime)})` : ""} ↗</a>` : "";
  return { headingHtml: `${icon("i-trophy", 15)} World records`, bodyHtml: `${rows}${wr}` +
    (r.url ? `<a class="hltb-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Leaderboards on speedrun.com ↗</a>` : "") };
},
  steamx(key) {
  const x = SXC[key];
  if (!x) return null;
  const deck = x.deck
    ? panelRowHtml({ labelHtml: `Steam Deck`, valueHtml: `${escapeHtml(x.deck)}`, valueClass: `deck deck-${escapeHtml(String(x.deck).toLowerCase())}` }) : "";
  const proton = x.protonTier
    ? panelRowHtml({ labelHtml: `ProtonDB`, valueHtml: `${escapeHtml(x.protonTier)}${x.protonScore != null ? ` <span class="muted">${Math.round(x.protonScore * 100)}%</span>` : ""}${x.protonReports ? ` <span class="muted">(${x.protonReports} reports)</span>` : ""}`, valueClass: `proton proton-${escapeHtml(String(x.protonTier))}` }) : "";
  const rev = x.reviewScore != null
    ? panelRowHtml({ labelHtml: `Steam reviews`, valueHtml: `${Math.round(x.reviewScore * 100)}% positive <span class="muted">of ${(x.positive + x.negative).toLocaleString()}</span>`, valueClass: `${ratingClass(x.reviewScore)}` }) : "";
  const own = x.owners
    ? panelRowHtml({ labelHtml: `Owners (est.)`, valueHtml: `${escapeHtml(x.owners)}` }) : "";
  const ccu = x.concurrent
    ? panelRowHtml({ labelHtml: `Playing now`, valueHtml: `${x.concurrent.toLocaleString()}` }) : "";
  const a = x.achievements;
  // We store the rarest achievement's NAME and only ever printed its percentage — so the
  // drawer said "rarest 0.4%" without saying rarest WHAT.
  const ach = a
    ? panelRowHtml({ labelHtml: `Achievements`, valueHtml: `${a.count} <span class="muted">· median ${a.medianPercent}%</span>` }) +
      (a.rarest
        ? panelRowHtml({ labelHtml: `Rarest`, valueHtml: `${escapeHtml(String(a.rarest))} <span class="muted">· ${a.rarestPercent}% of players</span>` })
        : panelRowHtml({ labelHtml: `Rarest`, valueHtml: `${a.rarestPercent}% of players` })) : "";
  if (!(deck || proton || rev || own || ccu || ach)) return null;
  return { headingHtml: `${icon("i-play", 15)} Steam`, bodyHtml: `${deck}${proton}${rev}${own}${ccu}${ach}` +
    (x.protonUrl ? `<a class="hltb-link" href="${escapeHtml(x.protonUrl)}" target="_blank" rel="noopener">View on ProtonDB ↗</a>` : "") };
},
  thumby(key) {
  const t = THC[key];
  if (!t) return null;
  const art = [["Title", t.titleImage], ["Icon", t.icon]].filter(([, u]) => u)
    .map(([l, u]) => `<figure class="adb-art"><img class="pixel" loading="lazy" src="${escapeHtml(cImg(u))}" alt="${l}"><figcaption>${l}</figcaption></figure>`)
    .join("");
  // Tinymine and Thoom ship no still image at all — only an animated title
  // card. Show it, so they aren't blank.
  const vid = t.video
    ? `<video class="thumby-vid" src="${escapeHtml(t.video)}" autoplay muted loop playsinline></video>` : "";
  return { headingHtml: `${icon("i-target", 15)} ${escapeHtml(t.platform || "Thumby")}`, bodyHtml: (art ? `<div class="adb-arts">${art}</div>` : "") + vid +
    (t.description ? `<p class="thumby-desc">${escapeHtml(t.description)}</p>` : "") +
    (t.url ? `<a class="hltb-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">View on GitHub ↗</a>` : "") };
},
  vndb(key) {
  const v = VNC[key];
  if (!v) return null;
  const rows = [
    ["Rating", v.rating != null ? `${Math.round(v.rating * 100)}%${v.votes ? ` (${v.votes.toLocaleString()} votes)` : ""}` : null],
    ["Median length", v.hours != null ? fmtHours(v.hours) : null],
    ["Released", v.released || null],
  ].filter(([, x]) => x)
    .map(([l, x]) => panelRowHtml({ labelHtml: `${l}`, valueHtml: `${escapeHtml(String(x))}` })).join("");
  // VNDB writes a real synopsis, and we store it. For a visual novel IGDB never matched it
  // is the ONLY description the game has — so it must not depend on `rows` being non-empty.
  const desc = v.description
    ? `<p class="vndb-desc">${escapeHtml(v.description)}</p>` : "";
  if (!rows && !desc) return null;
  return { headingHtml: `${icon("i-review", 15)} Visual novel (VNDB)`, bodyHtml: `${desc}${rows}` +
    (v.url ? `<a class="hltb-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">View on VNDB ↗</a>` : "") };
},
  wikidata(key) {
  const w = WDC[key];
  if (!w) return null;
  const people = [["Composer", w.composers], ["Director", w.directors]]
    .filter(([, v]) => v && v.length)
    .map(([l, v]) => panelRowHtml({ labelHtml: `${v.length > 1 ? l + "s" : l}`, valueHtml: `${escapeHtml(v.join(", "))}` }))
    .join("");
  const links = [
    w.wikipedia ? `<a class="hltb-link" href="${escapeHtml(w.wikipedia)}" target="_blank" rel="noopener">Read about it on Wikipedia ↗</a>` : "",
    w.mobyUrl ? `<a class="hltb-link" href="${escapeHtml(w.mobyUrl)}" target="_blank" rel="noopener">View on MobyGames ↗</a>` : "",
  ].filter(Boolean).join("");
  if (!(people || links)) return null;
  return { headingHtml: `${icon("i-library", 15)} Also known (Wikidata)`, bodyHtml: people + links + `` };
}
};
