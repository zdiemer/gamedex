"use strict";

/* The unified wishlist — a real tab, not a special page.

   Wishlist rides the SAME pipeline as All Games / Completed / On Order: the
   facet sidebar, search, table/grid views, sort, pager. It can, because it is
   just another sheet — a synthetic one, built client-side by merging:

     1. Sheet rows flagged Wishlisted — the actual games-sheet row objects,
        shared by reference, so covers, enrichment, facets and the drawer all
        behave exactly as they do on All Games.
     2. Platform wishlist entries the server matched to a sheet row — same
        shared row, wearing an extra source badge.
     3. Platform entries matching nothing owned — synthetic rows. Where the
        server identified them against the IGDB catalogue they carry a cover
        (seeded into ENRICH under a private `wl:` key that the enrichment
        loaders never touch) and a store link; otherwise just the store's name.

   Every row carries `wishlistedOn` — ["Sheet"] / ["Steam"] / both — as a
   faceted, multi-valued column, so the source is always visible and filterable.

   Dedup order mirrors the server's identity ladder: match key, then IGDB id,
   then normalized name — one card per game however many places want it. */

let WL = null;                     // /api/wishlist items; null before first load
const WL_META = {};                // igdbId -> {cover, video, year, release, platforms, genres}
let _wlMetaBusy = false;

// Pull the light IGDB metadata (video for hover-autoplay, release date,
// platforms, genres) for every matched wishlist game we don't have yet, then
// rebuild so the cards pick it up. Batched; only the ids we're missing.
async function loadWishlistMeta() {
  const need = [...new Set((WL || [])
    .map((w) => w.igdbId).filter((id) => id && !(id in WL_META)))];
  if (!need.length || _wlMetaBusy) return;
  _wlMetaBusy = true;
  try {
    for (let i = 0; i < need.length; i += 200) {
      const batch = need.slice(i, i + 200);
      const r = await fetch("api/wishlist/meta?ids=" + batch.join(","));
      if (!r.ok) continue;
      const items = (await r.json()).items || {};
      for (const id of batch) WL_META[id] = items[id] || null;   // negative-cache
    }
    buildWishlistSheet();
    if (activeTab === "wishlist") renderAll();
  } finally { _wlMetaBusy = false; }
}

const WL_SOURCE = { sheet: "Sheet", steam: "Steam", psn: "PlayStation", xbox: "Xbox", nintendo: "Nintendo" };

// Admin: map (or remap) a wishlist-only row to an IGDB game by pasting its URL.
// Shows for EVERY wl-only row — the whole point is the ones that didn't match,
// which otherwise have no IGDB section at all to hang a fix on.
function wishlistMapHtml(row) {
  if (!IS_ADMIN || !row._wlOnly || !row._wlAppIds) return "";
  const cur = row._igdbId ? `https://www.igdb.com/games/` : "";
  return `<div class="hltb wl-map" data-wl-appids='${escapeHtml(JSON.stringify(row._wlAppIds))}'>
    <div class="hltb-head">${icon("i-edit", 14)} ${row._igdbId ? "Fix IGDB mapping" : "Map to an IGDB game"}</div>
    <div class="map-src"><label>IGDB game URL</label>
      <div class="map-row">
        <input type="url" placeholder="igdb.com/games/&lt;slug&gt;" value="${escapeHtml(cur)}" data-wl-map-input>
        <button class="btn" data-wl-map-go>Map</button>
        ${row._igdbId ? `<button class="linkbtn danger" data-wl-map-clear title="Unmap">Clear</button>` : ""}
      </div>
      <p class="auth-err" data-wl-map-err hidden></p>
    </div>
  </div>`;
}

function wireWishlistMap(host, row) {
  const box = host.querySelector(".wl-map");
  if (!box) return;
  const appIds = JSON.parse(box.dataset.wlAppids || "{}");
  const provider = Object.keys(appIds)[0];
  const appId = appIds[provider];
  const err = box.querySelector("[data-wl-map-err]");
  const post = async (bodyExtra) => {
    err.hidden = true;
    try {
      const r = await fetch("api/wishlist/match", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, appId, ...bodyExtra }),
      });
      if (r.ok) {
        showToast("Wishlist mapping updated ✓");
        WL = null; loadWishlist();           // re-pull + re-render with the new match
        closeDrawer();
        return;
      }
      const j = await r.json().catch(() => ({}));
      err.textContent = j.detail || "Couldn't map that."; err.hidden = false;
    } catch (_) { err.textContent = "Couldn't reach the server."; err.hidden = false; }
  };
  const go = box.querySelector("[data-wl-map-go]");
  const input = box.querySelector("[data-wl-map-input]");
  go.onclick = () => { const url = input.value.trim(); if (url) post({ url }); };
  input.onkeydown = (e) => { if (e.key === "Enter") go.onclick(); };
  const clear = box.querySelector("[data-wl-map-clear]");
  if (clear) clear.onclick = () => post({ remove: true });
}

const WL_COLUMNS = [
  { key: "title", label: "Title", type: "text", facet: false, search: true, sort: true, primary: true },
  { key: "platform", label: "Platform", type: "text", facet: true, search: false, sort: true, primary: true },
  { key: "wishlistedOn", label: "Wishlisted On", type: "text", facet: true, search: false, sort: true, primary: true },
  { key: "genre", label: "Genre", type: "text", facet: true, search: true, sort: true, primary: true },
  // ITAD price columns (Steam wishlist). `price` sorts cheapest-first; `discount`
  // sorts biggest-cut-first; `deal` facets on sale / at-all-time-low / full price.
  { key: "price", label: "Price", type: "money", facet: false, search: false, sort: true, primary: true },
  { key: "discount", label: "Discount", type: "text", facet: false, search: false, sort: true, primary: false },
  { key: "deal", label: "Deal", type: "text", facet: true, search: false, sort: true, primary: false },
  { key: "releaseYear", label: "Release Year", type: "year", facet: true, search: false, sort: true, primary: false },
  { key: "dateAdded", label: "Date Added", type: "date", facet: false, search: false, sort: true, primary: true },
];

async function loadWishlist() {
  try {
    const r = await fetch("api/wishlist");
    WL = r.ok ? ((await r.json()).items || []) : [];
  } catch (_) { WL = []; }
  buildWishlistSheet();
  if (activeTab === "wishlist") renderAll();
  loadWishlistMeta();               // fill in video / release date / platforms
}

const _wlNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const _money = (v, cur) => {
  if (v == null) return "";
  if (v === 0) return "Free";
  const sym = { USD: "$", EUR: "€", GBP: "£", CAD: "$", AUD: "$" }[cur] || "$";
  return sym + Number(v).toFixed(2);
};

// The price chip on a card / in the drawer: current price, the regular slashed
// through when it's cut, the discount %, and an all-time-low star. "" for a row
// with no price (non-Steam wishlist, or ITAD had nothing).
function wishlistPriceHtml(row) {
  const p = row._wlPrice;
  if (!p || p.current == null) return "";
  const cur = _money(p.current, p.currency);
  const onSale = p.cut > 0 && p.regular != null;
  const reg = onSale ? `<s>${escapeHtml(_money(p.regular, p.currency))}</s>` : "";
  const cut = onSale ? `<b class="wl-cut">−${p.cut}%</b>` : "";
  const low = p.atLow ? `<span class="wl-low" title="At its lowest price ever">★ low</span>` : "";
  return ` · <span class="wl-price${p.atLow ? " atlow" : ""}">${reg}<b>${escapeHtml(cur)}</b>${cut}${low}</span>`;
}

/* Merge the three sources into row objects and install DATA.sheets.wishlist.
   Cheap (hundreds of rows), so it just re-runs whenever either input changes:
   after /api/data lands or reloads, and after /api/wishlist answers. */
function buildWishlistSheet() {
  if (!DATA || !DATA.sheets) return;
  const rowsByK = new Map();
  for (const r of (DATA.sheets.games || {}).rows || []) if (r._k) rowsByK.set(r._k, r);

  const entries = [];
  const byIdent = new Map();          // "k:<_k>" | "g:<igdbId>" | "n:<norm>" -> entry
  const entryFor = (idents, seed) => {
    for (const id of idents) if (byIdent.has(id)) {
      const e = byIdent.get(id);
      for (const id2 of idents) byIdent.set(id2, e);
      return e;
    }
    const e = { sources: [], appIds: {}, ...seed };
    entries.push(e);
    for (const id of idents) byIdent.set(id, e);
    return e;
  };

  for (const r of rowsByK.values()) {
    if (!r.wishlisted) continue;
    // Sheet rows NEVER merge with each other — the sheet keeps one row per
    // platform copy on purpose (wishing for a game on PS3 and on Xbox is two
    // wishes). The name index below is only so PLATFORM entries can find a
    // sheet row to join; first row with the name takes that role.
    const e = { sources: ["sheet"], appIds: {}, name: r.title, row: r,
                addedAt: r.dateAdded || null };
    entries.push(e);
    byIdent.set(`k:${r._k}`, e);
    const n = `n:${_wlNorm(r.title)}`;
    if (!byIdent.has(n)) byIdent.set(n, e);
  }
  for (const w of WL || []) {
    const idents = [];
    if (w.matchKey) idents.push(`k:${w.matchKey}`);
    if (w.igdbId) idents.push(`g:${w.igdbId}`);
    if (w.name) idents.push(`n:${_wlNorm(w.name)}`);
    if (!idents.length) idents.push(`a:${w.provider}:${w.appId}`);
    const e = entryFor(idents, { name: w.name || `App ${w.appId}`, addedAt: w.addedAt || null });
    if (!e.row && w.matchKey && rowsByK.has(w.matchKey)) e.row = rowsByK.get(w.matchKey);
    if (!e.igdbId && w.igdbId) { e.igdbId = w.igdbId; e.cover = w.cover; }
    if (!e.sources.includes(w.provider)) e.sources.push(w.provider);
    e.appIds[w.provider] = w.appId;
    if (w.addedAt && (!e.addedAt || w.addedAt > e.addedAt)) e.addedAt = w.addedAt;
    if (!e.name || /^App \d+$/.test(e.name)) e.name = w.name || e.name;
    // ITAD price rides along on the Steam entry (the console networks have none).
    if (w.price && (w.price.current != null || w.price.low != null)) e.price = w.price;
  }

  // Stamp the price/discount/deal columns (and _wlPrice for the card) from an
  // entry's ITAD data. Sortable + faceted through the normal pipeline.
  const stampPrice = (row, e) => {
    const p = e.price;
    row._wlPrice = p || null;
    row.price = p && p.current != null ? p.current : null;
    row.discount = p && p.cut ? `-${p.cut}%` : null;
    const deal = [];
    if (p) {
      if (p.atLow) deal.push("At all-time low");
      if (p.cut > 0) deal.push("On sale");
      else if (p.current != null) deal.push("Full price");
      if (p.current === 0) deal.push("Free");
    }
    row.deal = deal;
    return row;
  };

  const rows = entries.map((e) => {
    const on = e.sources.map((s) => WL_SOURCE[s] || s);
    if (e.row) {
      // The shared sheet row IS the wishlist row — stamp the source column on
      // it (harmless on other tabs: their column lists never name it).
      e.row.wishlistedOn = on;
      return stampPrice(e.row, e);
    }
    // A game I don't own anywhere: a synthetic row under a private `wl:` key.
    // Seeding ENRICH under that key does two jobs — the grid/hero find the
    // catalogue cover (and a store id for the View-on-Steam button), and
    // maybeEnrich sees the key as already answered so it never asks the
    // server about a row the server has no idea exists.
    const k = `wl:${Object.entries(e.appIds).map(([p, a]) => `${p}:${a}`).join("+") || _wlNorm(e.name)}`;
    const rec = ENRICH[k] || (ENRICH[k] = {});
    if (e.cover && !rec.cover) rec.cover = e.cover;
    if (e.appIds.steam && !rec.stores) rec.stores = { steam: { id: String(e.appIds.steam) } };
    if (e.igdbId && !rec.igdbId) rec.igdbId = e.igdbId;
    // The IGDB light meta (video, release date, platforms, genres) is filled in
    // asynchronously by loadWishlistMeta once the tab renders; the fields it
    // sets on ENRICH[k] and on the row are read by the card + hover-preview.
    const m = e.igdbId ? (WL_META[e.igdbId] || null) : null;
    if (m) {
      if (m.video && !rec.video) rec.video = m.video;
      if (m.cover && !rec.cover) rec.cover = m.cover;
    }
    // Platform on a wishlist card is the storefront's platform (a Steam wish is
    // a PC game); the release date and genre come from IGDB.
    const plat = e.appIds.steam ? "PC" : (m && m.platforms && m.platforms[0]) || null;
    return stampPrice({
      title: e.name, wishlistedOn: on, _k: k, _wlOnly: true, _igdbId: e.igdbId || null,
      _wlAppIds: e.appIds,     // {provider: appId} — lets the drawer remap this item
      platform: plat,
      releaseYear: m ? m.year : null,
      release: m ? m.release : null,     // full ISO date; card + hero prefer it
      genre: m && m.genres ? m.genres[0] : null,
      dateAdded: e.addedAt ? String(e.addedAt).slice(0, 10) : null,
    }, e);
  });

  // Newest wish first by default; undated sheet stragglers last, A→Z.
  rows.sort((a, b) =>
    String(b.dateAdded || "").localeCompare(String(a.dateAdded || ""))
    || String(a.title).localeCompare(String(b.title)));

  DATA.sheets.wishlist = { columns: WL_COLUMNS, rows };
  // The rows array just changed identity — the search memo caches the OLD one
  // per (tab, query) and would keep answering from it (see filters.js).
  resetSearchCache();
}
