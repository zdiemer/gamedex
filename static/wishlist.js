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

const WL_SOURCE = { sheet: "Sheet", steam: "Steam", psn: "PlayStation", xbox: "Xbox", nintendo: "Nintendo" };

const WL_COLUMNS = [
  { key: "title", label: "Title", type: "text", facet: false, search: true, sort: true, primary: true },
  { key: "platform", label: "Platform", type: "text", facet: true, search: false, sort: true, primary: true },
  { key: "wishlistedOn", label: "Wishlisted On", type: "text", facet: true, search: false, sort: true, primary: true },
  { key: "genre", label: "Genre", type: "text", facet: true, search: true, sort: true, primary: true },
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
}

const _wlNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
  }

  const rows = entries.map((e) => {
    const on = e.sources.map((s) => WL_SOURCE[s] || s);
    if (e.row) {
      // The shared sheet row IS the wishlist row — stamp the source column on
      // it (harmless on other tabs: their column lists never name it).
      e.row.wishlistedOn = on;
      return e.row;
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
    return {
      title: e.name, wishlistedOn: on, _k: k, _wlOnly: true,
      _igdbId: e.igdbId || null,   // lets the drawer fetch full IGDB detail by id
      dateAdded: e.addedAt ? String(e.addedAt).slice(0, 10) : null,
    };
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
