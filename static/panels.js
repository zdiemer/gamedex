"use strict";

/* The drawer's body: the media carousel, the lightbox, and one panel per source.

   Each *Html(key) builder here reads its own cache from enrich.js and returns ""
   when that source has nothing to say, so a drawer only shows the sources that
   actually matched. loadDetail() fetches the full IGDB record on open;
   loadAllEnrichment() polls the global cache during a backfill. */

// ---- media carousel + lightbox ------------------------------------------
// Slides are trailers and stills. A trailer autoplays (muted) as soon as it's
// the visible slide — it's the first thing you see when you open a game.
let media = [], shotIds = [], shotIdx = 0, lbIdx = 0;
function wireCarousel(el, items) {
  const wrap = el.querySelector(".shots");
  media = items || [];
  // Lightbox = stills only. Entries are {igdb} image ids here; personal
  // screenshots hand in {url} entries via openShotSet — one lightbox for both.
  // The carousel keeps ITS OWN set and re-points the lightbox at it on every
  // click, so opening the personal gallery in between can't hijack these stills.
  const stills = media.filter((m) => m.kind === "image").map((m) => ({ igdb: m.id }));
  shotIds = stills;
  if (!wrap || !media.length) return;
  const view = wrap.querySelector(".shot-view");
  const count = wrap.querySelector(".shot-count");
  const cap = wrap.querySelector(".shot-cap");

  const show = (i) => {
    shotIdx = (i + media.length) % media.length;
    const m = media[shotIdx];
    view.innerHTML = "";
    if (m.kind === "video") {
      if (YT_BLOCKED) { view.appendChild(ytFallback(m)); }
      else {
        const frame = document.createElement("iframe");
        frame.className = "shot-video";
        // muted: a browser will refuse to autoplay with sound, and it would be
        // rude anyway. Controls are on, so it can be unmuted.
        frame.src = ytSrc(m.id, { autoplay: "1", mute: "1" });
        frame.allow = "accelerometer; autoplay; encrypted-media; picture-in-picture";
        frame.allowFullscreen = true;
        frame.title = m.name;
        view.appendChild(frame);
        // If it never plays (YouTube's bot wall, or embedding disabled), swap in
        // a thumbnail that opens the video on YouTube — where the user can
        // actually sign in, or just watch it.
        ytWatch(frame, () => {
          if (frame.isConnected) frame.replaceWith(ytFallback(m));
        });
      }
    } else {
      const img = document.createElement("img");
      img.className = "shot-img";
      img.loading = "lazy";
      img.alt = "";
      img.src = IMG(m.id, m.art ? "1080p" : "screenshot_med");
      img.onclick = () => openShotSet(stills, stills.findIndex((s) => s.igdb === m.id));
      view.appendChild(img);
    }
    count.textContent = `${shotIdx + 1} / ${media.length}`;
    // A video always carries a link out to YouTube — the embed can be walled by
    // YouTube's per-device bot check (not something we can talk our way past), and a
    // walled iframe with no way to click through is worse than no video.
    if (m.kind === "video")
      cap.innerHTML = `${escapeHtml(m.name)} · <a href="https://www.youtube.com/watch?v=${escapeHtml(m.id)}" target="_blank" rel="noopener">Watch on YouTube ↗</a>`;
    else cap.textContent = m.art ? "Artwork" : "";
  };

  const prev = wrap.querySelector(".prev"), next = wrap.querySelector(".next");
  if (prev) prev.onclick = (e) => { e.stopPropagation(); show(shotIdx - 1); };
  if (next) next.onclick = (e) => { e.stopPropagation(); show(shotIdx + 1); };
  show(0);
}
// A clickable poster that opens the trailer on YouTube in a new tab.
function ytFallback(m) {
  const a = document.createElement("a");
  a.className = "shot-fallback";
  a.href = `https://www.youtube.com/watch?v=${m.id}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.innerHTML =
    `<img src="https://i.ytimg.com/vi/${escapeHtml(m.id)}/hqdefault.jpg" alt="">
     <span class="shot-fallback-play">▶</span>
     <span class="shot-fallback-note">YouTube won't play this here. Watch it on YouTube ↗</span>`;
  return a;
}

function lbShow(delta) {
  if (!shotIds.length) return;
  lbIdx = (lbIdx + delta + shotIds.length) % shotIds.length;
  const s = shotIds[lbIdx];
  $("#lbImg").src = s.url || IMG(s.igdb, "screenshot_huge");
  $("#lbCount").textContent = `${lbIdx + 1} / ${shotIds.length}`;
  const multi = shotIds.length > 1;
  $("#lbPrev").hidden = !multi;
  $("#lbNext").hidden = !multi;
}
function openLightbox(i) { lbIdx = i; $("#lightbox").hidden = false; lbShow(0); syncScrollLock(); }
// Point the lightbox at a caller-supplied set of stills ({url} or {igdb} each)
// — how mine.js opens personal screenshots without a second lightbox.
function openShotSet(entries, i) { shotIds = entries || []; openLightbox(i || 0); }
function closeLightbox() { $("#lightbox").hidden = true; syncScrollLock(); }
const lightboxOpen = () => !$("#lightbox").hidden;

function metacriticHtml(key) {
  // The critic score, whichever source answered — Metacritic, your sheet, IGDB's critic
  // aggregate, or the GameRankings archive. Always say which, so a number is never
  // mistaken for a Metacritic one it isn't.
  if (!drawerRow) return "";
  const v = criticOf(drawerRow);
  if (v == null) return "";
  const s = criticSourceOf(drawerRow) || { label: "Critics" };
  const score = Math.round(v * 100);
  const name = s.url
    ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.label)} ↗</a>`
    : escapeHtml(s.label);
  const extra = s.sheet ? " · from sheet" : (s.n ? ` · ${s.n} reviews` : "");
  return `<div class="hltb"><div class="hltb-row"><span>Critics</span>` +
    `<b class="${ratingClass(v)}">${score} <small class="muted">· ${name}${extra}</small></b></div></div>`;
}

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
  return `<div class="hltb"><div class="hltb-head">${icon("i-trend", 15)} Value (GameEye)</div>` +
    rows.map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>$${v.toFixed(2)}</b></div>`).join("") + mine +
    (ge.url ? `<a class="hltb-link" href="${escapeHtml(ge.url)}" target="_blank" rel="noopener">View on GameEye ↗</a>` : "") +
    `</div>`;
}

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
  return `<div class="hltb"><div class="hltb-head">${icon("i-dice", 15)} Arcade cabinet${a.romset ? ` <span class="muted">${escapeHtml(a.romset)}</span>` : ""}</div>` +
    (shots ? `<div class="adb-arts">${shots}</div>` : "") + vid + spec + extra +
    (a.history ? `<details class="adb-history"><summary>MAME history</summary><p>${escapeHtml(a.history)}</p></details>` : "") +
    (a.url ? `<a class="hltb-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">View on Arcade Database ↗</a>` : "") +
    `</div>`;
}

function vndbHtml(key) {
  const v = VNC[key];
  if (!v) return "";
  const rows = [
    ["Rating", v.rating != null ? `${Math.round(v.rating * 100)}%${v.votes ? ` (${v.votes.toLocaleString()} votes)` : ""}` : null],
    ["Median length", v.hours != null ? fmtHours(v.hours) : null],
    ["Released", v.released || null],
  ].filter(([, x]) => x)
    .map(([l, x]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(String(x))}</b></div>`).join("");
  // VNDB writes a real synopsis, and we store it. For a visual novel IGDB never matched it
  // is the ONLY description the game has — so it must not depend on `rows` being non-empty.
  const desc = v.description
    ? `<p class="vndb-desc">${escapeHtml(v.description)}</p>` : "";
  if (!rows && !desc) return "";
  return `<div class="hltb"><div class="hltb-head">${icon("i-review", 15)} Visual novel (VNDB)</div>${desc}${rows}` +
    (v.url ? `<a class="hltb-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">View on VNDB ↗</a>` : "") +
    `</div>`;
}

function salesHtml(key) {
  const v = VGC[key];
  if (!v || v.units == null) return "";
  const rows = [["Shipped", v.shipped], ["Sold", v.sold]].filter(([, x]) => x != null)
    .map(([l, x]) => `<div class="hltb-row"><span>${l}</span><b>${x.toLocaleString()}</b></div>`).join("");
  return `<div class="hltb"><div class="hltb-head">${icon("i-trend", 15)} Sales (VGChartz)</div>${rows}` +
    `<div class="hltb-note muted">VGChartz estimate${v.console ? ` · ${escapeHtml(v.console)}` : ""}</div>` +
    (v.url ? `<a class="hltb-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">View on VGChartz ↗</a>` : "") +
    `</div>`;
}

// Thumby/Thumby Color: TinyCircuits' list is the only place these exist.
function thumbyHtml(key) {
  const t = THC[key];
  if (!t) return "";
  const art = [["Title", t.titleImage], ["Icon", t.icon]].filter(([, u]) => u)
    .map(([l, u]) => `<figure class="adb-art"><img class="pixel" loading="lazy" src="${escapeHtml(cImg(u))}" alt="${l}"><figcaption>${l}</figcaption></figure>`)
    .join("");
  // Tinymine and Thoom ship no still image at all — only an animated title
  // card. Show it, so they aren't blank.
  const vid = t.video
    ? `<video class="thumby-vid" src="${escapeHtml(t.video)}" autoplay muted loop playsinline></video>` : "";
  return `<div class="hltb"><div class="hltb-head">${icon("i-target", 15)} ${escapeHtml(t.platform || "Thumby")}</div>` +
    (art ? `<div class="adb-arts">${art}</div>` : "") + vid +
    (t.description ? `<p class="thumby-desc">${escapeHtml(t.description)}</p>` : "") +
    (t.url ? `<a class="hltb-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">View on GitHub ↗</a>` : "") +
    `</div>`;
}

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
    .map((f) => `<span class="chip">${escapeHtml(String(f))}</span>`).join("");
  const prose = c.coopExperience
    ? `<p class="coop-desc">${escapeHtml(c.coopExperience)}</p>` : "";
  if (!rows.length && !prose && !feats) return "";
  const link = c.url
    ? `<a class="hltb-link" href="${escapeHtml(c.url)}" target="_blank" rel="noopener">View on Co-Optimus ↗</a>` : "";
  return `<div class="hltb"><div class="hltb-head">${icon("i-star", 15)} Co-op (Co-Optimus)</div>` +
    `${rows.join("")}${feats ? `<div class="chips">${feats}</div>` : ""}${prose}${link}</div>`;
}

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
  return `<div class="hltb"><div class="hltb-head">${icon("i-play", 15)} Steam</div>${deck}${proton}${rev}${own}${ccu}${ach}` +
    (x.protonUrl ? `<a class="hltb-link" href="${escapeHtml(x.protonUrl)}" target="_blank" rel="noopener">View on ProtonDB ↗</a>` : "") +
    `</div>`;
}

// The world record, next to HowLongToBeat: a nice sense of scale.
function speedrunHtml(key) {
  const r = SRC[key];
  if (!r || !r.wrTime) return "";
  const rows = (r.categories || []).slice(0, 3).map((c) =>
    `<div class="hltb-row"><span>${escapeHtml(c.category)}</span><b>${escapeHtml(c.time)}</b></div>`).join("");
  // We store wrUrl — the link to the record RUN — and only ever linked the leaderboard.
  // The run is the thing worth watching; the leaderboard is a table of times.
  const wr = r.wrUrl
    ? `<a class="hltb-link" href="${escapeHtml(r.wrUrl)}" target="_blank" rel="noopener">` +
      `Watch the world record${r.wrCategory ? ` · ${escapeHtml(r.wrCategory)}` : ""}${r.wrTime ? ` (${escapeHtml(r.wrTime)})` : ""} ↗</a>` : "";
  return `<div class="hltb"><div class="hltb-head">${icon("i-trophy", 15)} World records</div>${rows}${wr}` +
    (r.url ? `<a class="hltb-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Leaderboards on speedrun.com ↗</a>` : "") +
    `</div>`;
}

function guidesHtml(key) {
  const g = GDC[key];
  if (!g) return "";
  const secs = (g.sections || []).slice(0, 6)
    .map((x) => `<span class="chip">${escapeHtml(x)}</span>`).join("");
  return `<div class="hltb"><div class="hltb-head">${icon("i-review", 15)} Guide (StrategyWiki)</div>` +
    (secs ? `<div class="chips">${secs}</div>` : "") +
    `<a class="hltb-link" href="${escapeHtml(g.url)}" target="_blank" rel="noopener">${g.hasWalkthrough ? "Read the walkthrough" : "Open the guide"} ↗</a></div>`;
}

/* PCGamingWiki: will it actually run properly? Joined on the Steam appid, so unlike every
   fuzzy-title source in here it CANNOT be the wrong game.

   The wiki's vocabulary is kept as it is. "hackable" and "limited" are not "yes", and
   flattening them to a tick would be lying about what it says. */
const _PCGW_TONE = { true: "good", false: "bad", hackable: "warn", limited: "warn" };
const pcgwCell = (v) =>
  `<b class="${_PCGW_TONE[String(v).toLowerCase()] || ""}">${escapeHtml(titleCase(String(v)))}</b>`;

function pcgwHtml(key) {
  const p = PCGWC[key];
  if (!p) return "";
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
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(titleCase(String(v)))}</b></div>`).join("");
  if (!(display || tech || p.url)) return "";
  // A page can exist with none of its infobox filled in (15 of the first 238 matched). The
  // link is still the point of the section — that page is where the fixes and tweaks live —
  // so surface it rather than hiding the whole thing over a set of empty fields.
  const blank = !display && !tech
    ? `<div class="hltb-note muted">No compatibility details filled in yet.</div>` : "";
  return `<div class="hltb"><div class="hltb-head">${icon("i-play", 15)} On PC (PCGamingWiki)</div>` +
    display + tech + blank +
    (p.url ? `<a class="hltb-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Fixes and details on PCGamingWiki ↗</a>` : "") +
    `</div>`;
}

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
  return `<div class="hltb"><div class="hltb-head">${icon("i-library", 15)} Also known (Wikidata)</div>` +
    people + links + `</div>`;
}

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
  return `<div class="hltb"><div class="hltb-head">${icon("i-package", 15)} In the box</div>` +
    (art ? `<div class="adb-arts">${art}</div>` : "") + body + dmg + links.join("") +
    `</div>`;
}

// Compose the drawer's enrichment section: IGDB + HLTB + Metacritic + GameEye + map.
// Push the full detail up into the hero: a screenshot becomes the backdrop, the
// cover sharpens, the IGDB score and chips appear.
function fillHero(detail) {
  const bg = $("#heroBg"), coverEl = $("#heroCover"), chipsEl = $("#heroChips");
  if (!detail) return;
  // Artwork first: it's cinematic key art, made to be looked at. A screenshot is
  // a fallback — it's a picture of a HUD. Ask for the big version: this is a
  // full-bleed banner now, not a blurred wash, so a low-res source would show.
  const art = (detail.artworks || [])[0] || (detail.screenshots || [])[0];
  if (bg && art) {
    const img = new Image();          // fade it in only once it's actually there
    img.onload = () => {
      bg.style.backgroundImage = `url("${IMG(art, "1080p")}")`;
      bg.classList.add("on");
    };
    img.src = IMG(art, "1080p");
  }
  const cs = coverSrc(detail, "cover_big");
  if (coverEl && cs && coverEl.tagName !== "IMG") {
    const img = document.createElement("img");
    img.className = "cover-big"; img.id = "heroCover"; img.alt = ""; img.src = cs;
    coverEl.replaceWith(img);
  }
  // Chips moved out of the hero: they crowded the cover and title, and the IGDB
  // score chip repeated the "Players" figure already in the stat strip. They live
  // under the summary now, which is where you're reading about the game anyway.
  if (chipsEl) chipsEl.innerHTML = "";
}

function renderIgdbSection(key, el, status, detail) {
  // The relationship map is about YOUR collection, not IGDB's copy of the game,
  // so it's painted into its own host rather than the enrichment block.
  const relHost = $("#relations");
  if (relHost && status === "matched" && detail) {
    relHost.innerHTML = relationsHtml(detail);
    wireRelations(relHost);
    // IGDB wins, the sheet Collection is the fallback: once IGDB confirms a grouping
    // (episodes, a bundle's games, DLC…), fold away the in-house collection section so
    // the same set isn't shown twice. It rendered synchronously; IGDB detail is async.
    if (typeof relationsHaveGrouping === "function" && relationsHaveGrouping(detail)) {
      const colSec = document.querySelector("#drawerBody .col-section");
      if (colSec) colSec.hidden = true;
    }
  }
  let content;
  if (status === "matched" && detail) { content = detailHtml(detail); fillHero(detail); }
  else if (status === "no_match") content = `<div class="igdb-loading muted">No IGDB match for this title.</div>`;
  else {
    // Loading / pending / error. The hero already carries the cover and title,
    // so this is only the prose area — shimmer lines, never a bare "Loading".
    const msg = status === "pending-final" ? "Metadata still resolving. Reopen shortly."
      : status === "error" ? "Couldn’t load extra details." : "";
    content = msg
      ? `<div class="igdb-loading muted">${msg}</div>`
      : `<div class="skel skel-line" style="height:18px;width:40%"></div>
         <div class="skel skel-line"></div><div class="skel skel-line"></div>
         <div class="skel skel-line short"></div>`;
  }
  el.innerHTML = content + hltbHtml(HLTBC[key]) + speedrunHtml(key) + metacriticHtml(key)
    + coopHtml(key) + steamxHtml(key) + arcadeHtml(key) + vndbHtml(key) + thumbyHtml(key) + guidesHtml(key)
    + soundtrackHtml(key) + pcgwHtml(key) + salesHtml(key) + physicalHtml(key) + wikidataHtml(key)
    + gameyeHtml(key) + (IS_ADMIN ? mapControlHtml(key) : "");   // "Fix mapping" is a write — admin only

  wireSoundtrack(key, el);   // collapse/expand the tracklist, drive the docked player

  // The Shelf's manual reader, reached from the drawer too — you shouldn't have to go and
  // find the box on the shelf to read the booklet that came in it.
  const readBtn = el.querySelector("[data-read-manual]");
  if (readBtn) {
    readBtn.onclick = (ev) => {
      ev.preventDefault();
      openManual({ mk: key, t: (drawerRow && (drawerRow.title || drawerRow.game)) || "" });
    };
  }

  el.querySelectorAll(".map-src").forEach((rowEl) => {
    const src = rowEl.dataset.src;
    const go = rowEl.querySelector("[data-map-go]");
    const input = rowEl.querySelector("[data-map-input]");
    const reset = rowEl.querySelector("[data-map-reset]");
    const remove = rowEl.querySelector("[data-map-remove]");
    const submit = async () => {
      const url = input.value.trim();
      if (!url) return;
      go.disabled = true; go.textContent = "…"; input.classList.remove("err");
      const ok = await submitOverride(key, url, src);
      go.disabled = false; go.textContent = "Map";
      if (ok) loadDetail(key, el); else input.classList.add("err");
    };
    go.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    reset.onclick = async () => { await submitOverride(key, "", src); loadDetail(key, el); };
    remove.onclick = async () => {
      await submitOverride(key, "", src, true);   // pin as no match
      input.value = "";
      loadDetail(key, el);
    };
  });

  wireCarousel(el, detail ? mediaOf(detail) : []);
  el.querySelectorAll("[data-simk]").forEach((btn) => {
    btn.onclick = () => {
      const row = ((DATA.sheets.games || {}).rows || []).find((r) => String(r._k) === btn.dataset.simk);
      if (row) openDrawerFrom(row, "games");        // navigation: keep a way back
    };
  });
}

async function submitOverride(key, url, source = "igdb", remove = false) {
  try {
    const res = await fetch("api/enrichment/override", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, url, source, remove }),
    });
    if (!res.ok) return false;
    const j = await res.json();
    // Clear caches so the refetch shows the new mapping.
    delete DETAIL[key]; delete HLTBC[key]; delete MCC[key]; delete GEC[key];
    if (["igdb", "steam", "ign", "gamespot"].includes(source)) {   // primary slot
      const r = remove ? null : j.record;
      if (r) ENRICH[key] = Object.assign(ENRICH[key] || {}, {
        cover: r.cover, coverUrl: r.coverUrl, source: r.source, igdbId: r.igdbId,
        genres: r.genres, themes: r.themes, gameModes: r.gameModes, userRating: r.userRating,
      });
      else delete ENRICH[key];
    }
    renderTable(currentFiltered);   // refresh cover/facets on the grid
    return true;
  } catch (_) { return false; }
}

async function loadDetail(key, el, attempt = 0, row = null, igdbId = null) {
  if (row) drawerRow = row;
  if (DETAIL[key]) { renderIgdbSection(key, el, "matched", DETAIL[key]); return; }
  if (attempt === 0) renderIgdbSection(key, el, "loading", null);
  try {
    const res = await fetch("api/enrichment/detail?key=" + encodeURIComponent(key)
      + (igdbId ? "&igdb=" + encodeURIComponent(igdbId) : ""));
    const j = await res.json();
    if ("hltb" in j) HLTBC[key] = j.hltb;
    if ("metacritic" in j) MCC[key] = j.metacritic;
    if ("gameye" in j) GEC[key] = j.gameye;
    if ("arcadedb" in j) ADBC[key] = j.arcadedb;
    if ("vndb" in j) VNC[key] = j.vndb;
    if ("vgchartz" in j) VGC[key] = j.vgchartz;
    if ("thumby" in j) THC[key] = j.thumby;
    if ("steamx" in j) SXC[key] = j.steamx;
    if ("speedrun" in j) SRC[key] = j.speedrun;
    if ("guides" in j) GDC[key] = j.guides;
    if ("cooptimus" in j) COOPC[key] = j.cooptimus;
    if ("manuals" in j) MANC[key] = j.manuals;
    if ("gametdb" in j) GTDBC[key] = j.gametdb;
    if ("pcgw" in j) PCGWC[key] = j.pcgw;
    if ("wikidata" in j) WDC[key] = j.wikidata;
    if ("khinsider" in j) KHC[key] = j.khinsider;
    if (j.status === "matched" && j.detail) { DETAIL[key] = j.detail; renderIgdbSection(key, el, "matched", j.detail); }
    else if (j.status === "no_match") { renderIgdbSection(key, el, "no_match", null); }
    else if (j.status === "pending") {
      if (attempt >= 15) renderIgdbSection(key, el, "pending-final", null);
      else setTimeout(() => loadDetail(key, el, attempt + 1, null, igdbId), 2500);
    } else renderIgdbSection(key, el, "error", null);
  } catch (_) { renderIgdbSection(key, el, "error", null); }
}

// Bulk-load the light cover/facet map for every already-matched game (powers
// covers + IGDB facets across the whole list). Re-polls while backfill runs.
let allTimer = null;
async function loadAllEnrichment() {
  if (!ENRICH_ENABLED) return;
  try {
    // Low priority on purpose: this is the whole-library map (facets + the rest of the
    // covers), a few MB, and the page's own visible covers come from the fast page-scoped
    // maybeEnrich POST. Let the browser hand the ~6 connection slots to the images first and
    // fetch this behind them, so a landing page paints its covers instead of waiting on it.
    const res = await fetch("api/enrichment/all", { priority: "low" });
    const j = await res.json();
    if (j.enabled === false) { ENRICH_ENABLED = false; return; }
    let changed = false;
    for (const [k, v] of Object.entries(j.items || {})) {
      ENRICH[k] = Object.assign(ENRICH[k] || {}, v);
      changed = true;
    }
    // The rows we looked up and found nothing for. They will never get a cover, so
    // they must stop pretending one is on the way.
    if (j.noMatch) {
      const before = NO_MATCH.size;
      NO_MATCH = new Set(j.noMatch);
      if (NO_MATCH.size !== before) changed = true;
    }
    if (j.stats) updateEnrichStatus(j.stats);
    // The map now holds everything the server has matched so far, which is as good an
    // answer as a filter is going to get. Set before the re-renders below, not after, or
    // the render this releases would look at the flag and hold out all over again.
    ENRICH_READY = true;
    if (changed) {
      /* Everything downstream of the map just went stale. One call rather than the list
         that used to be here, because the same list also lives at boot and behind the ✱
         Refresh button, and hand-copying it into three files is how two of them ended up
         missing entries (see resetDerived, app.js).

         Why it matters, concretely — several health checks read the map and cache their
         results, so "no metadata" reads as "all 14,747 games" without this. Groupings and
         Challenges group on UNIFIED (sheet + IGDB) values, so their membership shifts as
         enrichment lands. And the prediction model was fitted from THIS MAP and cached
         before it existed: landing on Home paints the "You'd probably love" shelf at once,
         that calls tasteModel(), and the model it keeps for the rest of the session has
         learned exactly zero IGDB tags. Measured on the live site before this existed:
         land on Home and the model knows 0 tags; land on Stats (whose panel happens to ask
         late) and it knows 3,722. It hid for so long because the sheet's own columns cover
         for missing tags on a backlog game — 8.93 against 8.88, which is nothing. It is
         not nothing for a game that ISN'T on the sheet: the catalogue model has no columns
         to fall back to, so tagless it scores every game at your global mean and the
         Recommendations tab becomes 25,000 rows of 64%.

         The catalogue likewise answers "do I already own this?" out of the map that just
         changed — without dropping it, Pick shows a game you own TWICE, once as a sheet
         row and once as a catalogue row. */
      _enrichEpoch++;
      resetDerived();
      // Patch in place rather than re-rendering (which would flicker every image).
      if (activeTab === "stats") renderStats();
      else if (activeTab === "home") patchHomeCovers();   // in place: a full re-render flickers
      else if (activeTab === "challenges") renderChallenges();
      else if (activeTab === "health") renderHealth();
      else if (activeTab === "groups") renderGroups();     // membership shifts, not just covers
      /* Recommendations is the most enrichment-dependent thing here and the least able to
         say so. Opened by direct link it paints before this map arrives, and with no map
         there are no tags to predict from and no igdbIds to join on — so it shows the
         whole catalogue, unfiltered, every game scored at your global mean because the
         model has nothing to go on, sorted by nothing. It looks like data. Re-render. */
      // Recs covers are catalogue art (stable), so an enrichment poll doesn't change what's on
      // screen — patch in place rather than a full renderAll (which flickered the grid and
      // restarted the tour). Newly-owned games drop out on the next visit to the tab, when the
      // gate rebuilds the sheet.
      else if (activeTab === "recs") patchEnrichedCells();
      // The global search groups copies and derives its owned/tracked chips FROM this map, so the
      // first render before it lands can't dedupe (Hollow Knight shows once per platform). Re-run
      // when the map arrives (and as a backfill refines it); renderSearch debounces the rebuild.
      else if (activeTab === "search") renderSearch();
      else if (activeTab !== "pick") {
        /* If a filter or a sort on screen reads this map, the row list itself may be wrong —
           not just the covers in it. It was computed against whatever the map held at the
           time, which on a shared link is nothing at all. But a full renderAll rebuilds every
           tile (flicker, and it restarts the hover/tour), so only pay that when the list
           ACTUALLY changed: a backfill that just filled in a cover for a game already on
           screen leaves the filtered set — and the sort order, unless you're sorting on the
           map — identical, and those covers patch in place like any other poll. */
        if (stateNeedsEnrichment() && enrichListChanged()) renderAll();
        else {
          patchEnrichedCells();
          patchTimelineCovers();          // the Completed tab's third view
          renderFacets();
          // Grouping keys off the IGDB id, which lives in the enrichment map — and
          // the grid paints before that map arrives, so the first render has
          // nothing to group by. Re-render, but only when the grouping actually
          // changes, or we'd flash the grid on every poll.
          if (!SPECIAL_TABS.includes(activeTab) && combineOn()) {
            resetRelations();
            const n = groupByGame(currentFiltered).length;
            if (n !== lastGroupedCount) { lastGroupedCount = n; renderTable(currentFiltered); }
          }
        }
      }
    }
    if (j.stats && !j.stats.complete) {             // a backfill is still running
      clearTimeout(allTimer);
      allTimer = setTimeout(loadAllEnrichment, 45000);
    }
  } catch (_) { /* transient */ }
  finally {
    /* Every way out of this function, including the ones above that never reach the
       renders — a 500, a dropped connection, enrichment switched off server-side — has to
       release a render that is holding for the map. Filtering against a map that never
       came is wrong; a page that shimmers forever is worse, because it doesn't even look
       like a failure. On the ordinary path this is a no-op: the render already happened,
       and it cleared the flag on its way through. */
    ENRICH_READY = true;
    if (ENRICH_WAITING) renderAll();
  }
}
