"use strict";

/* Playing a game, and knowing whether you can.

   IGDB's external_games gives us storefront ids; the sheet's Notes column says
   which store you actually bought it from. Between them, launchTarget() decides
   what the Play button does.

   Also the three "do we have the bytes?" loaders -- RomM (playable in-browser),
   NAS (in the ROM library), uploads (hand-added box art) -- plus what the
   collection is worth. */

// ---- launching a game ----------------------------------------------------
// IGDB's external_games gives us storefront ids; the sheet's Notes column says
// WHICH storefront the copy you own came from. So Notes picks the target and
// IGDB supplies the id — a game on Steam, GOG and Epic launches on the one you
// actually bought it on.
//
// Only a few storefronts expose a real launch URI. The rest get an "open" link,
// which on the right device does the next best thing: the App Store link opens
// the App Store app (with its own Open button), the Microsoft Store link opens
// the Store app, and so on. Pretending we can launch those would just look
// broken, so we don't claim to.
const STORE_LAUNCH = {
  steam: { label: "Play on Steam", uri: (id) => `steam://rungameid/${id}` },
  gog: { label: "Play on GOG", uri: (id) => `goggalaxy://openGameView/${id}` },
  // Best-effort: the Amazon Games launcher registers amazon-games:// and the
  // IGDB uid is the same amzn1.adg.product.* id it uses.
  amazon: { label: "Play on Amazon", uri: (id) => `amazon-games://play/${id}` },
};
const STORE_OPEN = {
  epic: "Epic Games Store", itch: "itch.io", appstore: "App Store",
  googleplay: "Google Play", xbox: "Microsoft Store", microsoft: "Microsoft Store",
  playstation: "PlayStation Store", steam: "Steam", gog: "GOG", amazon: "Amazon",
};

// The sheet's Notes vocabulary → an IGDB storefront. Only the ones IGDB can
// actually give us an id for: Origin/EA, Ubisoft Connect and Battle.net have no
// IGDB source at all, so there's no id to launch with and we say nothing rather
// than offering a button that can't work.
const NOTES_STORE = {
  "Steam": "steam", "GOG": "gog", "Epic Games Store": "epic", "itch.io": "itch",
  "Amazon": "amazon", "Xbox Game Pass": "xbox", "Microsoft Store": "microsoft",
};
// Failing that, the platform implies a storefront.
const PLATFORM_STORE = {
  "iOS": "appstore", "32-bit iOS": "appstore", "Android": "googleplay",
  "Xbox One": "xbox", "Xbox Series X|S": "xbox", "Xbox 360": "xbox",
  "PlayStation 4": "playstation", "PlayStation 5": "playstation",
  "PlayStation 3": "playstation", "PC": "steam",
};

const storeEntry = (e, key) => {
  const st = (e && e.stores && e.stores[key]) || null;
  if (!st) return null;
  return typeof st === "string" ? { id: st, url: null } : st;   // tolerate the old shape
};

function launchTarget(row) {
  const e = ENRICH[row._k];
  // The appid from MY linked Steam library. It corrects two things at once:
  // IGDB's external_games sometimes names an appid I don't own (Fallout: New
  // Vegas), and a game IGDB never matched can still be launchable if the
  // library says I have it. PC-family rows only: the matcher ties the app to
  // every copy of the game, and the Switch copy was offering "Play on Steam"
  // with the PC sibling's appid.
  const ownedSteam = typeof mineSteamAppId === "function" && mineOnHomePlatform(row._k, "steam")
    ? mineSteamAppId(row._k) : null;
  if ((!e || !e.stores) && !ownedSteam) return null;
  const notes = String(row.notes || "");
  const want = NOTES_STORE[notes] || PLATFORM_STORE[row.platform] || null;

  // The storefront the sheet says you own it on — else whatever we know about.
  const key = (ownedSteam && (want === "steam" || !want)) ? "steam"
    : (want && storeEntry(e, want)) ? want
    : Object.keys(STORE_OPEN).find((k) => storeEntry(e, k));
  if (!key) return null;
  const st = (key === "steam" && ownedSteam)
    ? { id: ownedSteam, url: null }
    : storeEntry(e, key);
  if (!st) return null;
  const store = STORE_OPEN[key] || key;

  // A launch only makes sense when this is the copy you own — the sheet says
  // so, or the linked library outright contains it.
  const ownThisOne = ((row.owned && want === key) || (key === "steam" && !!ownedSteam))
    && !!STORE_LAUNCH[key];
  if (ownThisOne) {
    return { kind: "launch", label: "▶ " + STORE_LAUNCH[key].label,
             href: STORE_LAUNCH[key].uri(st.id), store };
  }
  const url = st.url || storeUrl(key, st.id);
  if (!url) return null;
  return { kind: "store", label: `${row.owned && want === key ? "Open in" : "View on"} ${store}`,
           href: url, store };
}

// A few sources give an id but no url, and a couple of schemes open the native
// store app rather than a web page, which is closer to "launch" than a link.
function storeUrl(key, id) {
  switch (key) {
    case "steam": return `https://store.steampowered.com/app/${id}/`;
    case "appstore": return `https://apps.apple.com/app/id${id}`;
    case "googleplay": return `https://play.google.com/store/apps/details?id=${id}`;
    case "xbox": case "microsoft": return `ms-windows-store://pdp/?ProductId=${id}`;
    case "playstation": return `https://store.playstation.com/concept/${id}`;
    default: return null;
  }
}

/* ---- RomM: play it in the browser --------------------------------------
   Joined on (IGDB game id, platform) — an id join on both axes, not a title
   match. The catch is that the two systems name the same machine differently:
   the sheet says "PlayStation", the NAS folder is "PSX". 27 of the 45 playable
   platforms are spelled identically; these are the rest.

   "PC" -> "MS-DOS" is the interesting one. A PC row only lights up if the SAME
   IGDB game also exists in the DOS folder — so Doom gets a Play button and a
   modern Steam game simply doesn't match. The id join makes that safe. */
const ROMM_PLATFORM = {
  "PlayStation": "PSX",
  "PlayStation Portable": "PSP",
  "Sega Genesis": "Genesis",
  "Sega Saturn": "Saturn",
  "Sega Master System": "Master System",
  "Sega Game Gear": "Game Gear",
  "Commodore Amiga": "Amiga",
  "Commodore Amiga CD32": "Amiga CD32",
  "Commodore VIC-20": "VIC-20",
  "Commodore Plus/4": "Commodore Plus-4",
  "Philips CD-i": "CD-i",
  "Atari Jaguar": "Jaguar",
  "Atari Lynx": "Lynx",
  "Neo-Geo Pocket": "Neo Geo Pocket",
  "Neo-Geo Pocket Color": "Neo Geo Pocket Color",
  "Arcade": "MAME",
  "PC": "MS-DOS",
};

let ROMM = { enabled: false, baseUrl: "", roms: {} };
async function loadRomm() {
  try {
    const r = await fetch("/api/romm");
    if (!r.ok) return;
    ROMM = await r.json();
    if (ROMM.enabled) patchPlayButtons();
  } catch (_) { /* RomM being down must never break gamedex */ }
}

/* ---- Is it in the ROM library? ------------------------------------------

   Built on the workstation from romnas's download receipts (tools/nas_index.py) — the library is
   80TiB on a NAS the cluster can't even see, so nothing here scans anything; it reads a map.

   THREE states, and the third is why this is trustworthy. Some systems' receipts don't NAME their
   games — the Wii U records title-ids, the 360's dump is DLC only — and title-matching those
   produces a confident wrong answer. Those platforms say "not indexed" instead of lying. */
let NAS = { generatedAt: 0, unindexed: [], games: {} };
async function loadNas() {
  try {
    const r = await fetch("/api/nas");
    if (!r.ok) return;
    NAS = await r.json();
    if (!NAS.generatedAt) return;
    // The index lands AFTER the first render, so the ROM library facet would sit there with three
    // empty buckets until you touched something else. Same as the GameRankings archive does.
    if (!SPECIAL_TABS.includes(activeTab)) renderFacets();
  } catch (_) { /* no index yet is not an error — the facet and the drawer line just don't render */ }
}

/* The facet value, and it is the SAME three states the drawer shows — deliberately. A filter that
   quietly folded "we can't answer for this platform" into "not on the NAS" would hand you a list of
   games to go download, with the Wii U library sitting in it. */
function nasFacetVals(row) {
  if (!IS_ADMIN || !NAS.generatedAt) return [];   // admin-only facet; empty read for anon anyway
  if (NAS.games[row._k]) return ["On the NAS"];
  if ((NAS.unindexed || []).includes(row.platform)) return ["Not indexed"];
  return ["Not on the NAS"];
}

const nasBytes = (n) => {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, f = n;
  while (f >= 1024 && i < u.length - 1) { f /= 1024; i++; }
  return `${f < 10 && i > 1 ? f.toFixed(1) : Math.round(f)} ${u[i]}`;
};

function nasSectionHtml(row) {
  if (!NAS.generatedAt) return "";                       // no index posted yet
  const hit = NAS.games[row._k];
  if (hit) {
    const size = nasBytes(hit.size);
    return `<div class="nas-line on">
      ${icon("i-check", 14)}
      <div><b>In the ROM library</b>
        <span>${escapeHtml(hit.file || "")}${size ? ` · ${size}` : ""} · ${escapeHtml(hit.system)}</span>
      </div></div>`;
  }
  if ((NAS.unindexed || []).includes(row.platform)) {
    return `<div class="nas-line unknown">
      ${icon("i-alert", 14)}
      <div><b>Not indexed</b>
        <span>${escapeHtml(row.platform)} receipts don't name their games, so we can't say</span>
      </div></div>`;
  }
  return `<div class="nas-line off">
    ${icon("i-close", 14)}
    <div><b>Not in the ROM library</b><span>Nothing on the NAS for this one</span></div>
  </div>`;
}

// The GameRankings archive — a frozen fallback critic score, joined server-side on
// (title, platform). Feeds criticOf(), so it lights up the facet, stats, predictions and
// challenges as soon as it lands.
async function loadGameRankings() {
  try {
    const r = await fetch("api/gamerankings");
    if (!r.ok) return;
    const m = await r.json();
    const n = Object.keys(m).length;
    if (!n) return;
    Object.assign(GR, m);
    resetHealth();                       // "no critic score" checks just changed
    if (!SPECIAL_TABS.includes(activeTab)) renderFacets();
    else if (activeTab === "stats") renderStats();
  } catch (_) { /* a missing archive must never break the app */ }
}

// Hand-uploaded box art, merged onto the enrichment map as `uploadCover` so it becomes
// the game's cover EVERYWHERE (grid, drawer, similar-games) — not just on the shelf —
// including games IGDB never matched, which otherwise have no cover at all.
async function loadUploads() {
  try {
    const r = await fetch("api/uploads");
    if (!r.ok) return;
    const m = await r.json();
    let changed = false;
    for (const [mk, u] of Object.entries(m)) {
      UPLOADS[mk] = u;
      const url = u.url;                     // already carries &v= for cache-busting
      const e = ENRICH[mk];
      if (!e || e.uploadCover !== url) {
        ENRICH[mk] = Object.assign(e || {}, { uploadCover: url });   // stub is fine for a no-match game
        changed = true;
      }
    }
    // A cover removed (Remove art) — drop the override so the auto cover returns.
    for (const mk of Object.keys(UPLOADS)) {
      if (!(mk in m) && ENRICH[mk]) { delete ENRICH[mk].uploadCover; delete UPLOADS[mk]; changed = true; }
    }
    if (changed) {
      _enrichEpoch++;
      if (typeof patchEnrichedCells === "function") patchEnrichedCells();
      // patchEnrichedCells only touches the listing grid/table — the site search draws its own
      // cards (with status chips), so refresh it in place too when its cover just changed.
      if (activeTab === "search" && typeof renderSearch === "function") renderSearch();
      refreshDrawerCover();
    }
  } catch (_) { /* uploads are a nicety; never break the app */ }
}
// After an upload/remove, refresh the open drawer's hero cover in place.
function refreshDrawerCover() {
  if ($("#overlay").hidden || !drawerRow) return;
  const cs = coverSrc(ENRICH[drawerRow._k], "cover_big");
  const el = $("#heroCover");
  if (!cs || !el) return;
  if (el.tagName === "IMG") { el.src = cs; return; }
  const img = document.createElement("img");
  img.className = "cover-big"; img.id = "heroCover"; img.alt = ""; img.src = cs;
  el.replaceWith(img);
}

// The rom id for this row, or null. Requires BOTH the game and the platform to
// agree — a PSX Doom must not offer to play the 3DO one.
function rommRomId(row) {
  if (!IS_ADMIN || !ROMM.enabled || !row) return null;   // Play is admin-only (read is empty for anon)
  const e = ENRICH[row._k];
  if (!e || !e.igdbId) return null;
  const folder = ROMM_PLATFORM[row.platform] || row.platform;
  const id = ROMM.roms[`${e.igdbId}|${folder}`];
  return id != null ? id : null;
}

// The ROM's EmulatorJS player (/rom/<id>/ejs) on every device — one URL, no UA
// sniff. History, since both dead ends are easy to re-derive: desktop used
// Console Mode (/console/rom/<id>/play), whose controller-style shell
// white-screens on iOS Safari (the core never boots); mobile fell back to the
// ROM's detail page because the /ejs deep-link was unreliable on phones. That
// mobile caveat no longer holds, so /ejs serves both.
const rommPlayUrl = (id) => `${ROMM.baseUrl}/rom/${id}/ejs`;

function rommHtml(row) {
  const id = rommRomId(row);
  if (!id) return "";
  return `<a class="btn play" href="${escapeHtml(rommPlayUrl(id))}" target="_blank" rel="noopener"
     title="Play in the browser via RomM">${icon("i-play", 15)} Play now</a>`;
}

// The map arrives after the drawer (or the pick) may already be on screen; fill the buttons
// in rather than re-render (the same trap the enrichment map set five times over).
function patchPlayButtons() {
  const body = $("#drawerBody");
  if (body && drawerRow && !body.querySelector(".btn.play")) {
    const html = rommHtml(drawerRow);
    if (html) {
      const host = body.querySelector(".hero-actions");
      if (host) host.insertAdjacentHTML("afterbegin", html);
      else {
        // A game with no storefront at all has no actions row yet — give it one.
        const hero = body.querySelector(".hero") || body.firstElementChild;
        if (hero) hero.insertAdjacentHTML("beforeend", `<div class="hero-actions">${html}</div>`);
      }
    }
  }
  // The Pick card is drawn before /api/romm has answered, so without this the pick you're
  // staring at is the one game that never gets a Play button.
  const picked = typeof pickState !== "undefined" && pickState ? pickState.picked : null;
  const acts = document.querySelector(".pick-actions");     // lives in #picker, not #pick
  if (picked && acts && !acts.querySelector(".btn.play")) {
    const html = rommHtml(picked);
    if (html) acts.insertAdjacentHTML("beforeend", html);
  }
}

function launchHtml(row) {
  // A wishlist-only row's store links live in its own deal block (View on Steam +
  // Buy on the best-deal vendor), so the hero doesn't add a duplicate here.
  if (row._wlOnly) return "";
  const t = launchTarget(row);
  if (!t) return rommHtml(row);
  const external = /^https?:/.test(t.href);
  const store = t.kind === "launch"
    ? `<a class="btn launch" href="${escapeHtml(t.href)}">${escapeHtml(t.label)}</a>`
    : `<a class="btn ghost" href="${escapeHtml(t.href)}"${external ? ' target="_blank" rel="noopener"' : ""}>${escapeHtml(t.label)}${external ? " ↗" : ""}</a>`;
  return rommHtml(row) + store;      // playing it beats buying it
}

// Units sold/shipped (VGChartz estimate). Only major releases have a figure.
const salesOf = (row) => { const e = ENRICH[row._k]; return e && e.units != null ? e.units : null; };
const fmtUnits = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "m"
  : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));

// Quantity of copies owned, parsed from the notes ("Two copies owned" → 2).
const _NUMWORD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
function quantityFromNotes(notes) {
  if (!notes) return 1;
  const s = String(notes);
  let m = s.match(/(\d+)\s+cop(?:y|ies)/i);
  if (m) return parseInt(m[1], 10);
  m = s.match(/\b(one|two|three|four|five|six|seven|eight)\s+cop(?:y|ies)/i);
  return m ? _NUMWORD[m[1].toLowerCase()] || 1 : 1;
}
// Map the sheet's Condition to a GameEye price key.
const _COND_KEY = { complete: "geCib", cib: "geCib", loose: "geLoose", new: "geNew" };
// Collection value for an owned row: GameEye price for its condition × quantity.
const r0 = (v) => typeof v === "number" && v > 0;   // a real price, not free/blank

function collectionValueOf(row) {
  // A group card averages its copies' values, nulls excluded — same aggregation
  // AND same copies as the group row's other value fields (_aggMembers,
  // relations.js): under a filter _members is the full universe, and averaging
  // over it made "Value" count copies the rating didn't.
  if (row._members && row._members.length > 1) {
    const vs = (row._aggMembers || row._members).map(collectionValueOf).filter((v) => v != null);
    return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
  }
  const e = ENRICH[row._k];
  if (!e) return null;
  const price = e[_COND_KEY[(row.condition || "").toLowerCase()] || "geLoose"];
  return price != null ? price * quantityFromNotes(row.notes) : null;
}
function bucketLabel(v, buckets) { for (const b of buckets) if (b.test(v)) return b.label; return null; }

// Steam-appid-joined facts (Deck rating, Proton tier, ultrawide) are about the
// PC copy; the enricher attaches them to every copy of the game, so those
// facets skip rows from other platform families. A blank platform keeps them —
// the same benefit of the doubt mineOnHomePlatform gives.
const pcFacetRow = (r) => {
  const p = String(r.platform || "").toLowerCase();
  return !p || MINE_PLAT_FAMILY.steam.includes(p);
};

// What each source found for a row (used by the metadata facets).
const metaOf = (row) => {
  const e = ENRICH[row._k] || null;
  return {
    igdb: !!(e && e.igdbId),                        // IGDB proper
    fallback: e && e.source ? e.source : null,      // IGN / Steam / LaunchBox
    hltb: !!(e && e.hltbBest != null),
    mc: !!(e && e.metascore != null),
    // Ask coverSrc rather than re-listing the cover fields: the two drifted apart, and
    // "No cover / art" was flagging games that visibly HAVE art — hand-uploaded box art
    // and Thumby icons, both of which coverSrc renders but this list never learned about.
    art: !!coverSrc(e),
  };
};
// Which of the extra sources have data for this row (multi-valued).
function extraSourcesOf(row) {
  const e = ENRICH[row._k];
  if (!e) return [];
  const out = [];
  if (e.adbUrl) out.push("Arcade Database");
  if (e.vnUrl) out.push("VNDB");
  if (e.units != null) out.push("VGChartz sales");
  if (e.thumbyUrl) out.push("Thumby");
  if (e.deck || e.protonTier) out.push("Steam extras");
  if (e.wrTime) out.push("speedrun.com");
  if (e.guideUrl) out.push("StrategyWiki");
  if (e.hltbUrl) out.push("HowLongToBeat");
  if (e.metaUrl) out.push("Metacritic");
  if (e.geUrl) out.push("GameEye");
  return out;
}

// Which source supplied the game's primary metadata.
function metaSourceOf(row) {
  const m = metaOf(row);
  return m.igdb ? "IGDB" : m.fallback || "None";
}
// Tags for what a row is MISSING — multi-valued, so one game can carry several.
function missingOf(row) {
  const m = metaOf(row);
  const out = [];
  if (!m.igdb) out.push("No IGDB");
  if (!m.art) out.push("No cover / art");
  if (!m.hltb) out.push("No HLTB");
  if (!m.mc) out.push("No Metacritic");
  if (!m.igdb && !m.fallback && !m.art && !m.hltb && !m.mc) out.push("Nothing at all");
  return out;
}

const igdbFacetCols = () =>
  ENRICH_ENABLED
    ? [
        ...IGDB_FACET_DEFS.map((d) => ({ ...d, type: "text", facet: true, virtual: true })),
        // Scalar, not a list, so it takes the fn form the arcade facets use.
        { key: "__igdb_age", label: "Age rating", type: "text", facet: true, virtual: true, kind: "fn",
          getVals: (r) => { const e = ENRICH[r._k]; return e && e.ageRating ? [e.ageRating] : []; } },
        { key: "__meta_src", label: "Metadata source", type: "text", facet: true, virtual: true, kind: "fn", getVals: (r) => [metaSourceOf(r)] },
        { key: "__extra_src", label: "Enriched by", type: "text", facet: true, virtual: true, kind: "fn", getVals: extraSourcesOf },
        { key: "__missing", label: "Missing data", type: "text", facet: true, virtual: true, kind: "fn", getVals: missingOf },
      ]
    : [];
// Bucketed facets available on the Games tab (playtime + Metacritic).
function extraFacetCols(tab = activeTab) {
  if (tab !== "games") return [];
  return [
    { key: "__playtime", label: "Playtime", type: "text", facet: true, virtual: true, kind: "bucket", buckets: PLAYTIME_BUCKETS, getVal: playtimeOf },
    { key: "__metacritic", label: "Critic score", type: "text", facet: true, virtual: true, kind: "bucket", buckets: METACRITIC_BUCKETS, getVal: metacriticOf },
    { key: "__userrating", label: "User Rating", type: "text", facet: true, virtual: true, kind: "bucket", buckets: METACRITIC_BUCKETS, getVal: userRatingOf },
    { key: "__sales", label: "Sales (VGChartz)", type: "text", facet: true, virtual: true, kind: "bucket", buckets: SALES_BUCKETS, getVal: salesOf },
    // Is it in the ROM library? Independent of enrichment — this comes from romnas's download
    // receipts (see loadNas), so it lives here and not among the IGDB facets. `enriched: false`
    // says so out loud: it is the one virtual facet that does NOT read the enrichment map, and
    // holding a render for a map it never consults would be waiting on the wrong thing.
    { key: "__nas", label: "ROM library", type: "text", facet: true, virtual: true, kind: "fn",
      enriched: false, getVals: nasFacetVals },
    // Arcade-only, from the MAME romset lookup — blank for everything else.
    { key: "__adbplayers", label: "Arcade players", type: "text", facet: true, virtual: true, kind: "fn",
      getVals: (r) => { const e = ENRICH[r._k]; return e && e.adbPlayers ? [e.adbPlayers] : []; } },
    { key: "__adborient", label: "Arcade screen", type: "text", facet: true, virtual: true, kind: "fn",
      getVals: (r) => { const e = ENRICH[r._k]; return e && e.adbOrientation ? [e.adbOrientation] : []; } },
    // You track Steam Deck completions in the sheet — now you can filter the
    // backlog down to what Valve says actually runs on it.
    { key: "__deck", label: "Steam Deck", type: "text", facet: true, virtual: true, kind: "fn",
      getVals: (r) => { const e = ENRICH[r._k]; return e && e.deck && pcFacetRow(r) ? [e.deck] : []; } },
    { key: "__proton", label: "ProtonDB", type: "text", facet: true, virtual: true, kind: "fn",
      // The API returns "platinum"; it's a tier, not a word in a sentence.
      getVals: (r) => { const e = ENRICH[r._k]; return e && e.protonTier && pcFacetRow(r) ? [titleCase(e.protonTier)] : []; } },
    { key: "__steamrev", label: "Steam reviews", type: "text", facet: true, virtual: true, kind: "bucket",
      buckets: METACRITIC_BUCKETS, getVal: (r) => { const e = ENRICH[r._k]; return e && e.steamReview; } },
    // What we think you'd score it — a filter for "things I'd probably love".
    { key: "__predicted", label: "Predicted for you", type: "text", facet: true, virtual: true, kind: "bucket",
      buckets: METACRITIC_BUCKETS, getVal: predictedOf },
    // PCGamingWiki, joined on the Steam appid. "true"/"false"/"hackable"/"limited" is the
    // wiki's own vocabulary — keep its words, they mean something ("hackable" is not "yes").
    { key: "__ultrawide", label: "Ultrawide", type: "text", facet: true, virtual: true, kind: "fn",
      getVals: (r) => { const e = ENRICH[r._k]; return e && e.pcgwUltrawide && pcFacetRow(r) ? [titleCase(e.pcgwUltrawide)] : []; } },
    // Who scored it. Wikidata is the only source in the app that knows, and filtering a
    // collection by composer is a thing you simply could not do before.
    { key: "__composer", label: "Composer", type: "text", facet: true, virtual: true, kind: "fn",
      getVals: (r) => { const e = ENRICH[r._k]; return (e && e.composers) || []; } },
  ];
}
const facetCols = () => [...columns().filter((c) => c.facet).map(unifiedFacetCol), ...igdbFacetCols(), ...extraFacetCols()];

const facetColByKey = (key) => facetCols().find((c) => c.key === key);
/* Does this facet read the enrichment map — i.e. can it be answered at boot, or only
   once that map lands? Every virtual facet reads it except the ROM library, which says
   so at its own definition. The four unified facets (genre, developer, publisher,
   franchise) read it too: the sheet's value for a row is here from the first paint, but
   the values only IGDB knows — a co-developer, a genre your sheet doesn't keep — are
   not, and they are real, clickable, linkable facet values. Everything else (Platform,
   Priority, Rating…) is sheet-only and answerable immediately. */
const facetIsEnriched = (col) =>
  !!(ENRICH_ENABLED && col && ((col.virtual && col.enriched !== false) || UNIFIED_GETVALS[col.key]));
// The Games tab's facets, asked for by name. facetCols() reads whatever tab is
// active, which throws on a tab with no sheet of its own — and the two places that
// build filters out of facets (Pick, Challenges) are both such tabs.
const gamesFacetCols = () => {
  const sh = DATA.sheets.games;
  return sh ? [...sh.columns.filter((c) => c.facet).map(unifiedFacetCol), ...igdbFacetCols(), ...extraFacetCols("games")] : [];
};

// Bool facets where a MISSING value means "No", not "unknown". The sheet only stores these
// flags when they're set (parse.py drops blank cells), so without this a non-VR / non-DLC /
// un-wishlisted row produces no facet item at all and the facet only ever offers "Yes". For
// these three, absence genuinely means the negative — a game with no VR flag is not-VR — so
// every row resolves to exactly Yes or No, giving the sidebar a real "No" option to click.
const BOOL_NEGATABLE = new Set(["vr", "dlc", "wishlisted"]);

// A row's facet values as [{key, raw}] — scalar → one, arrays → many, bucket → one label.
function rowFacetItems(row, col) {
  if (col.kind === "fn") {                    // computed, possibly multi-valued
    return (col.getVals(row) || []).map((x) => ({ key: String(x), raw: x }));
  }
  if (col.type === "bool" && BOOL_NEGATABLE.has(col.key)) {
    return [row[col.key] ? { key: "true", raw: true } : { key: "false", raw: false }];
  }
  if (col.kind === "bucket") {
    const v = col.getVal(row);
    if (v === undefined || v === null || v === "") return [];
    const lbl = bucketLabel(Number(v), col.buckets);
    return lbl ? [{ key: lbl, raw: lbl }] : [];
  }
  let v;
  // igdbRecOf, not ENRICH[_k]: a catalogue row carries its record inline and has no match
  // key, so every IGDB facet (genre, theme, mode, keyword…) would be blank for it here —
  // which is to say the Pick builder's whole IGDB vocabulary would silently stop applying
  // the moment the pool grew past the sheet.
  if (col.virtual) { v = igdbRecOf(row)[col.source]; }
  else v = row[col.key];
  if (v === undefined || v === null || v === "") return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((x) => x !== undefined && x !== null && x !== "").map((x) => ({ key: String(x), raw: x }));
}

function facetLabel(col, value) {
  if (col.type === "bool") return value ? "Yes" : "No";
  return String(value);
}
