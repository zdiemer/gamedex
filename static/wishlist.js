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
// Ids whose HLTB completion-time lookup the server deferred (its per-request
// budget) — re-requested each round until they resolve. Kept out of WL_META's
// "already have it" test so a still-pending id keeps its card meta (no flicker)
// while we poll for its time.
let _wlPending = new Set();
async function loadWishlistMeta(round = 0) {
  const need = [...new Set([
    ...(WL || []).map((w) => w.igdbId).filter((id) => id && !(id in WL_META)),
    ..._wlPending,
  ])];
  if (!need.length || _wlMetaBusy) return;
  _wlMetaBusy = true;
  const pending = new Set();
  try {
    for (let i = 0; i < need.length; i += 200) {
      const batch = need.slice(i, i + 200);
      const r = await fetch("api/wishlist/meta?ids=" + batch.join(","));
      if (!r.ok) continue;
      const j = await r.json();
      const items = j.items || {};
      for (const id of batch) WL_META[id] = items[id] || null;   // negative-cache
      for (const id of j.pending || []) pending.add(+id);
    }
    buildWishlistSheet();
    if (activeTab === "wishlist") renderAll();
  } finally { _wlMetaBusy = false; }
  // Poll again for the deferred HLTB lookups — bounded, and self-terminating the
  // moment the server resolves each one (a hit or a definite miss both clear it).
  _wlPending = pending;
  if (pending.size && round < 12) {
    setTimeout(() => loadWishlistMeta(round + 1), 1500);
  }
}

const WL_SOURCE = { sheet: "Sheet", steam: "Steam", gog: "GOG", epic: "Epic Games",
                    itch: "itch.io", psn: "PlayStation", xbox: "Xbox", nintendo: "Nintendo" };

// The deal block for a wishlist drawer: the price line, a "View on Steam" chip
// (always, when we know the appid), and a "Buy on <vendor>" chip for the lowest
// current deal (which may be a third-party seller, and may carry a coupon).
function wishlistDealHtml(row) {
  const steamId = row._wlAppIds && row._wlAppIds.steam;
  const p = row._wlPrice;
  if (!steamId && !p) return "";
  const chips = [];
  if (steamId) {
    chips.push(`<a class="btn ghost" href="${escapeHtml(storeUrl("steam", steamId))}"
      target="_blank" rel="noopener">View on Steam ↗</a>`);
  }
  // Buy on the best-deal vendor — only when it's a real, different link (not just
  // the same Steam store we already linked, unless it's discounted there).
  if (p && p.url && p.current != null && (p.shop !== "Steam" || p.cut > 0)) {
    const label = p.shop ? `Buy on ${p.shop}` : "Buy";
    const price = _money(p.current, p.currency);
    chips.push(`<a class="btn buy" href="${escapeHtml(p.url)}" target="_blank" rel="noopener"
      title="${escapeHtml(p.voucher ? "Coupon: " + p.voucher : "")}">${escapeHtml(label)} · ${escapeHtml(price)}${p.cut > 0 ? ` (−${p.cut}%)` : ""} ↗</a>`);
  }
  // In a current bundle — a chip linking straight to it.
  const bnd = row._wlBundle;
  if (bnd && bnd.url) {
    chips.push(`<a class="btn ghost wl-bundle-chip" href="${escapeHtml(bnd.url)}"
      target="_blank" rel="noopener" title="${escapeHtml(bnd.title || "")}">🎁 In a bundle ↗</a>`);
  }
  const line = wishlistPriceLine(row);
  if (!chips.length && !line) return "";
  return `<div class="hltb wl-deal">
    <div class="hltb-head">${icon("i-star", 14)} Deal</div>
    ${line}
    ${bnd && bnd.title ? `<div class="wl-bundle-line">In a bundle: <b>${escapeHtml(bnd.title)}</b></div>` : ""}
    ${chips.length ? `<div class="wl-deal-chips">${chips.join("")}</div>` : ""}
  </div>`;
}

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

// The price BADGE on a card cover: current price, the cut %, and an all-time-low
// star. Positioned (CSS) over the bottom of the cover so it reads at a glance.
// "" for a row with no price (non-Steam wishlist, or ITAD had nothing).
function wishlistPriceBadge(row) {
  const p = row._wlPrice;
  if (!p || p.current == null) return "";
  const cur = _money(p.current, p.currency);
  const cut = p.cut > 0 ? `<i class="wl-cut">−${p.cut}%</i>` : "";
  const star = p.atLow ? ` ★` : "";
  const cls = p.atLow ? " atlow" : (p.cut > 0 ? " sale" : "");
  const tip = [p.regular != null && p.cut > 0 ? `was ${_money(p.regular, p.currency)}` : null,
               p.shop ? `on ${p.shop}` : null,
               p.low != null ? `all-time low ${_money(p.low, p.currency)}` : null,
               p.voucher ? `coupon ${p.voucher}` : null].filter(Boolean).join(" · ");
  return `<span class="card-price${cls}" title="${escapeHtml(tip)}">${cut}${escapeHtml(cur)}${star}</span>`;
}

// The fuller price line for the drawer: regular slashed, current, cut, store,
// coupon, all-time low.
function wishlistPriceLine(row) {
  const p = row._wlPrice;
  if (!p || p.current == null) return "";
  const onSale = p.cut > 0 && p.regular != null;
  const reg = onSale ? `<s>${escapeHtml(_money(p.regular, p.currency))}</s> ` : "";
  const cut = onSale ? ` <b class="wl-cut">−${p.cut}%</b>` : "";
  const shop = p.shop ? ` <span class="muted">on ${escapeHtml(p.shop)}</span>` : "";
  const low = p.atLow ? ` <span class="wl-low">★ all-time low</span>`
    : (p.low != null ? ` <span class="muted">· low ${escapeHtml(_money(p.low, p.currency))}</span>` : "");
  const coupon = p.voucher ? ` <span class="wl-coupon" title="Apply at checkout">🎟 ${escapeHtml(p.voucher)}</span>` : "";
  return `<div class="wl-price-line">${reg}<b>${escapeHtml(_money(p.current, p.currency))}</b>${cut}${shop}${low}${coupon}</div>`;
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
    if (w.bundle && w.bundle.title) e.bundle = w.bundle;
  }

  // Stamp the price/discount/deal columns (and _wlPrice for the card) from an
  // entry's ITAD data. Sortable + faceted through the normal pipeline.
  const stampPrice = (row, e) => {
    const p = e.price;
    row._wlPrice = p || null;
    row._wlBundle = e.bundle || null;
    row.price = p && p.current != null ? p.current : null;
    row.discount = p && p.cut ? `-${p.cut}%` : null;
    const deal = [];
    if (p) {
      if (p.atLow) deal.push("At all-time low");
      if (p.cut > 0) deal.push("On sale");
      else if (p.current != null) deal.push("Full price");
      if (p.current === 0) deal.push("Free");
    }
    if (e.bundle) deal.push("In a bundle");    // faceted value → "In a Bundle" filter
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
      // The taste model's catalogue scope (predict.js SCOPES.igdb) regresses on
      // exactly these IGDB fields. Merging them onto the record — the same one
      // igdbRecOf(row) returns — gives a wishlist card the features a
      // Recommendations card has, so the Predicted score varies by game instead
      // of resting on "platform = PC" alone. Fields the model reads off the
      // record: the tag arrays, the companies/franchises, and the two outside
      // opinions with their vote counts.
      for (const f of ["genres", "themes", "gameModes", "perspectives",
                       "developers", "publishers", "franchises", "keywords",
                       "engines", "criticRating", "criticCount",
                       "userRating", "userRatingCount",
                       // Completion time (IGDB time-to-beat, or an HLTB title-match
                       // fallback) — what playtimeOf reads for the Estimated Time sort.
                       "hltbMain", "hltbBest", "hltbUrl"]) {
        if (m[f] != null && rec[f] == null) rec[f] = m[f];
      }
    }
    // Platform on a wishlist card is the storefront's platform (a Steam wish is
    // a PC game); the release date and genre come from IGDB.
    const plat = e.appIds.steam ? "PC" : (m && m.platforms && m.platforms[0]) || null;
    return stampPrice({
      title: e.name, wishlistedOn: on, _k: k, _wlOnly: true, _igdbId: e.igdbId || null,
      // A wishlisted game isn't on the sheet — it's a catalogue game, so it
      // predicts through the catalogue scope. `_igdb` both flips predict.js's
      // scopeFor to SCOPES.igdb and is the record igdbRecOf reads its tags and
      // opinions from; `rec` is a superset (card cover/stores + predict fields),
      // and the model ignores the fields it doesn't want. Empty until the async
      // meta merge above fills it, at which point loadWishlistMeta rebuilds this
      // sheet and the prediction recomputes off real features.
      _igdb: rec,
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
