"use strict";

/* Lazy IGDB enrichment, and the caches every other file reads.

   The sheet has titles; everything else -- covers, summaries, scores, prices --
   is enrichment, fetched per visible page rather than for 14.7k rows up front.
   The per-source caches (ENRICH, DETAIL, HLTBC, MCC, ...) live here and are read
   all over the app; a row is keyed by its matchKey (row._k).

   The distinction that matters: a cover is "pending" only while we are still
   LOOKING for it. NO_MATCH is what stops a game we found nothing for from
   shimmering forever. */

// ---- IGDB enrichment (lazy, per visible page) ---------------------------
// Route every third-party image through our PVC-backed cache (/api/img) so the
// second time anyone loads a cover it comes off local disk, not the source CDN —
// which is what shortens the skeleton shimmer. YouTube thumbnails are left
// hotlinked (already fast and Google-cached); anything that isn't an absolute
// http(s) URL (a local /api/... upload, a data: URI) passes through untouched.
const cImg = (u) =>
  (u && /^https?:\/\//.test(u) && !/(^|\.)ytimg\.com$/.test((u.split("/")[2] || "")))
    ? `/api/img?u=${encodeURIComponent(u)}`
    : (u || "");
// Same idea for the Internet Archive PDF manuals: proxy them through the PVC so a
// booklet you've opened before comes off local disk, not the Archive.
const cManual = (u) => (u && /^https?:\/\//.test(u) ? `/api/manual?u=${encodeURIComponent(u)}` : (u || ""));
const IMG = (id, size) => (id ? cImg(`https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`) : "");

/* Fade each poster cover in as it finishes loading, so a page's worth of images doesn't flash
   in all at once when the proxy catches up (they load lazily and at wildly different speeds).
   ONE delegated listener in the capture phase — load/error don't bubble, so a per-<img> handler
   would mean wiring every render path; this catches them all, present and future, for the cost
   of one listener. Error marks it loaded too, so a dead cover doesn't sit invisible. */
function markCoverLoaded(e) {
  const img = e.target;
  if (img && img.tagName === "IMG" && img.classList.contains("card-cover")) img.classList.add("loaded");
}
document.addEventListener("load", markCoverLoaded, true);
document.addEventListener("error", markCoverLoaded, true);
// Cover URL: fallback sources give a full coverUrl; IGDB gives an image id.
// Cover: IGDB image id, else a fallback source's full URL, else the art the
// gated sources bring — an arcade cabinet scan or a VN cover beats a blank box.
// gtdbCover is a real, region-correct box front from GameTDB's CDN, and vgcCover a box
// scan from VGChartz. Both were being fetched and stored already; neither was ever shown.
// They sit at the end of the chain — after IGDB and after the art a gated source brings —
// so they only ever fill a box that would otherwise have been blank.
const coverSrc = (e, size) => (
  !e ? "" :
  e.uploadCover ? e.uploadCover :          // your hand-uploaded art wins everywhere (local, same-origin)
  e.coverUrl ? cImg(e.coverUrl) :
  e.cover ? IMG(e.cover, size) :
  cImg(e.vnCover || e.adbCover || e.thumbyCover || e.gtdbCover || e.vgcCover || ""));
// Thumby art is a 64x64 icon — scale it up with hard edges, not a blur.
const coverIsPixelArt = (e, src) => !!(e && e.thumbyCover && src === e.thumbyCover);
let IS_ADMIN = false;              // set from /api/me on boot; gates every write + sensitive read
let ME = null;                     // {authenticated, username}
let ENRICH_ENABLED = false;
let ENRICH_COMPLETE = false;       // all sources backfilled → stop shimmering covers
/* READY is not COMPLETE, and the difference is the whole reason a filter can be
   answered at all. COMPLETE means every source has finished backfilling, which on a
   cold instance is minutes away and on a busy one may not happen this session — a
   filter that waited for it would wait behind a progress bar. READY means the bulk
   map (api/enrichment/all) has answered once, so ENRICH now holds everything the
   server has matched SO FAR. That is the honest moment to filter: it's the best
   answer available, and each later poll refines it (see loadAllEnrichment). */
let ENRICH_READY = false;          // the bulk map has landed once — or failed to
let ENRICH_WAITING = false;        // ...and a render is holding out for it (see renderAll)
let ENRICH_SOURCES = [];           // enabled secondary sources (hltb, metacritic, gameye)
const ENRICH = {};                 // matchKey -> light enrichment

/* The IGDB record behind a row, whichever kind of row it is.

   A sheet row joins to it by match key. A game from the IGDB catalogue (catalogue.js)
   carries its record inline on `_igdb` instead, because there IS no match key for a game
   that isn't on the sheet: `_k` is normalize(title)|platform|year, and a catalogue entry
   has no platform — IGDB keeps one entry per game where the sheet keeps one row per
   platform copy.

   Carrying it on the row rather than in a second global map keeps ENRICH exactly what it
   says it is: pick.js caches its entire field list against ENRICH_COMPLETE and several
   health checks count this map's contents, so quietly growing it by 25k entries would be
   a very confusing bug.

   It lives HERE, next to the map it falls back to, rather than with its first caller —
   everything downstream of enrich.js may need it, and the <script> order in index.html is
   load-bearing (see the README). */
const igdbRecOf = (row) => (row && row._igdb) || ENRICH[(row || {})._k] || {};
const DETAIL = {};                 // matchKey -> full IGDB detail (drawer cache)
const HLTBC = {};                  // matchKey -> HLTB playtimes (drawer cache)
const MCC = {};                    // matchKey -> Metacritic score (drawer cache)
const GEC = {};                    // matchKey -> GameEye prices (drawer cache)
const ADBC = {};                   // matchKey -> Arcade Database record
const VNC = {};                    // matchKey -> VNDB record
const VGC = {};                    // matchKey -> VGChartz record
const THC = {};                    // matchKey -> Thumby record
const SXC = {};                    // matchKey -> Steam extras (Deck/Proton/SteamSpy)
const SRC = {};                    // matchKey -> speedrun record
const GDC = {};                    // matchKey -> StrategyWiki guide
const COOPC = {};                  // matchKey -> Co-Optimus co-op details
const MANC = {};                   // matchKey -> Internet Archive manual (pages, PDF)
const GTDBC = {};                  // matchKey -> GameTDB disc face + box wrap
const PCGWC = {};                  // matchKey -> PCGamingWiki PC tech (exact, by appid)
const WDC = {};                    // matchKey -> Wikidata bridge (composer, Wikipedia, Moby)
const ENRICH_REQUESTED = new Set();
const UPLOADS = {};                // matchKey -> {url, v} : hand-uploaded box art
const GR = {};                     // matchKey -> {score, n, url} : GameRankings archive
let enrichTimer = null;
let drawerRow = null;              // row currently shown in the drawer (for sheet fallback)

// Games we looked up and found NOTHING for. They are absent from ENRICH exactly
// like a game we haven't got to yet, which is why they used to shimmer forever:
// "still looking" and "looked, found nothing" were indistinguishable.
let NO_MATCH = new Set();

// A cover is "pending" only while enrichment is still LOOKING for this row. Once
// it has resolved — with a cover or without one — it is not pending any more.
const coverPending = (row) =>
  ENRICH_ENABLED && !ENRICH_COMPLETE && !(row._k in ENRICH) && !NO_MATCH.has(row._k);
function coverCell(row) {
  const src = coverSrc(ENRICH[row._k], "cover_small");
  if (src) return `<img class="cover-thumb" loading="lazy" src="${src}" alt="">`;
  return `<span class="cover-ph${coverPending(row) ? " skel" : ""}"></span>`;
}

// Queue enrichment for any on-screen rows we haven't asked about yet.
function maybeEnrich(rows) {
  if (!ENRICH_ENABLED) return;
  const need = [...new Set(rows.map((r) => r._k).filter(Boolean))]
    .filter((k) => !(k in ENRICH) && !ENRICH_REQUESTED.has(k));
  if (need.length) postEnrich(need);
}

async function postEnrich(keys) {
  keys.forEach((k) => ENRICH_REQUESTED.add(k));
  try {
    const res = await fetch("api/enrichment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) return;
    const j = await res.json();
    if (j.enabled === false) { ENRICH_ENABLED = false; return; }
    let changed = false;
    for (const [k, v] of Object.entries(j.items || {})) { ENRICH[k] = v; changed = true; }
    updateEnrichStatus(j.stats);
    if (changed) { _enrichEpoch++; resetSearchCache(); patchEnrichedCells(); }   // in-place: no flicker
    if (j.pending && j.pending.length) {                    // still resolving — poll
      clearTimeout(enrichTimer);
      enrichTimer = setTimeout(() => postEnrich(j.pending), 2500);
    }
  } catch (_) { /* transient */ }
}

function updateEnrichStatus(stats) {
  const el = $("#enrichstatus");
  if (!el || !stats) return;
  const src = stats.sources || {};
  const parts = [`IGDB ${(stats.matched || 0).toLocaleString()}`];
  if (src.hltb) parts.push(`HLTB ${(src.hltb.matched || 0).toLocaleString()}`);
  if (src.metacritic) parts.push(`MC ${(src.metacritic.matched || 0).toLocaleString()}`);
  let queued = stats.queued || 0;
  for (const s of Object.values(src)) queued += s.queued || 0;
  el.textContent = parts.join(" · ") + (queued ? ` · ${queued.toLocaleString()} queued` : "");
  el.hidden = false;

  // Enrichment progress bar (all sources combined).
  ENRICH_COMPLETE = !!stats.complete;
  const wrap = $("#progress"), bar = $("#progressBar");
  if (wrap && bar && stats.total) {
    const srcs = Object.values(src);
    const done = (stats.resolved || 0) + srcs.reduce((a, s) => a + (s.resolved || 0), 0);
    const total = stats.total * (1 + srcs.length);
    bar.style.width = Math.min(100, Math.round((100 * done) / total)) + "%";
    wrap.hidden = ENRICH_COMPLETE;
  }
}

// Shimmering placeholder cards while the spreadsheet loads.
// Per-page loading skeletons. On boot the target tab isn't applied yet (applyStateFromURL
// runs after the data lands), so peek at the URL — landing on Home and seeing a grid of
// listing-card skeletons was the giveaway that the shell was generic. Home gets a hero +
// shelves skeleton; the listing tabs (and the enrich-wait hold) get the card grid.
function showSkeletons(n = 30) {
  const tab = (activeTab && activeTab !== "home") ? activeTab
    : (new URLSearchParams(location.search).get("tab") || "home");
  if (tab === "home") return showHomeSkeleton();
  if (typeof setSpecialMode === "function") setSpecialMode(null);
  $("#gridwrap").hidden = false;
  $("#grid").innerHTML = Array.from({ length: n }, () =>
    `<div class="card"><div class="card-cover ph skel"></div><div class="card-body">
      <div class="skel skel-line"></div><div class="skel skel-line short"></div></div></div>`).join("");
}

// A skeleton the shape of Home: the hero, then a couple of horizontal shelves.
function showHomeSkeleton() {
  if (typeof setSpecialMode === "function") setSpecialMode("home");
  const host = $("#home");
  if (!host) return;
  const shelfRow = Array.from({ length: 9 }, () =>
    `<div class="card sk-shelf-card"><div class="card-cover ph skel"></div></div>`).join("");
  const sect = () => `<section class="h-sect">
    <div class="h-sect-head"><div class="skel skel-line sk-head"></div></div>
    <div class="h-shelf">${shelfRow}</div></section>`;
  host.innerHTML = `
    <div class="h-hero"><div class="h-hero-inner">
      <div class="h-hero-cover ph skel"></div>
      <div class="h-hero-txt">
        <div class="skel skel-line sk-eyebrow"></div>
        <div class="skel skel-line sk-title"></div>
        <div class="skel skel-line"></div>
        <div class="skel skel-line short"></div>
      </div></div></div>
    ${sect()}${sect()}`;
}

const chips = (arr, fk) => (arr && arr.length
  ? `<div class="chips">${arr.map((x) => fk
      ? `<span class="chip facet-link" data-fk="${fk}" data-fv="${escapeHtml(String(x))}">${escapeHtml(String(x))}</span>`
      : `<span class="chip">${escapeHtml(String(x))}</span>`).join("")}</div>` : "");
