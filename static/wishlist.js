"use strict";

/* The unified wishlist: one tab for everything I've said I want, wherever I
   said it.

   Three sources, merged and deduped:
     1. Sheet rows flagged Wishlisted — full rows, they open the normal drawer.
     2. Platform wishlist entries the server matched to a sheet row (match key)
        — same card as 1, plus a provider badge.
     3. Platform entries matching nothing I own — identified against the IGDB
        catalogue where possible (cover + name), else the store's own name.

   Dedup order: match key, then IGDB id, then the normalized name — the same
   ladder the server used to identify them, so the same game wished for on two
   storefronts and flagged on the sheet is ONE card wearing three badges. */

let WL = null;                     // /api/wishlist items, or null before first load
let _wlBusy = false;

async function loadWishlist() {
  try {
    const r = await fetch("api/wishlist");
    WL = r.ok ? ((await r.json()).items || []) : [];
  } catch (_) { WL = []; }
}

const _wlNorm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Merge into [{name, row?, igdbId?, cover?, providers:[], addedAt?, appIds:{}}] */
function wlMerged() {
  const rowsByK = new Map();
  // DATA is null until the sheet's first load succeeds — the platform half of
  // the wishlist can still render, it just has no sheet rows to join yet.
  for (const r of ((DATA || {}).sheets || {}).games?.rows || []) if (r._k) rowsByK.set(r._k, r);

  const out = [];
  const byIdent = new Map();          // "k:<_k>" | "g:<igdbId>" | "n:<norm>" -> entry
  const entryFor = (idents, seed) => {
    for (const id of idents) if (byIdent.has(id)) {
      const e = byIdent.get(id);
      for (const id2 of idents) byIdent.set(id2, e);
      return e;
    }
    const e = { providers: [], appIds: {}, ...seed };
    out.push(e);
    for (const id of idents) byIdent.set(id, e);
    return e;
  };

  for (const r of rowsByK.values()) {
    if (!r.wishlisted) continue;
    entryFor([`k:${r._k}`, `n:${_wlNorm(r.title)}`],
             { name: r.title, row: r, addedAt: r.dateAdded || null }).providers.push("sheet");
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
    if (!e.providers.includes(w.provider)) e.providers.push(w.provider);
    e.appIds[w.provider] = w.appId;
    if (w.addedAt && (!e.addedAt || w.addedAt > e.addedAt)) e.addedAt = w.addedAt;
    if (!e.name || /^App \d+$/.test(e.name)) e.name = w.name || e.name;
  }
  // Newest wish first; the undated sheet stragglers sort last, alphabetically.
  return out.sort((a, b) =>
    String(b.addedAt || "").localeCompare(String(a.addedAt || ""))
    || String(a.name).localeCompare(String(b.name)));
}

const WL_BADGE = { sheet: "Sheet", steam: "Steam", psn: "PlayStation", xbox: "Xbox", nintendo: "Nintendo" };

function wlCard(e, i) {
  const rec = e.row ? ENRICH[e.row._k] : null;
  const cs = rec ? coverSrc(rec, "cover_big") : (e.cover ? IMG(e.cover, "cover_big") : "");
  const cover = cs
    ? `<img class="card-cover" src="${escapeHtml(cs)}" alt="" loading="lazy">`
    : `<div class="card-cover ph">${icon("i-library", 26)}</div>`;
  const badges = e.providers.map((p) =>
    `<span class="wl-badge wl-${p}">${escapeHtml(WL_BADGE[p] || p)}</span>`).join("");
  const meta = [e.row ? e.row.platform : null,
                e.addedAt ? `added ${fmtDate(String(e.addedAt).slice(0, 10))}` : null]
    .filter(Boolean).join(" · ");
  const store = e.appIds.steam
    ? `<a class="wl-store" href="${escapeHtml(storeUrl("steam", e.appIds.steam))}"
         target="_blank" rel="noopener" title="On the Steam store">Steam ↗</a>` : "";
  return `<div class="rec wl${e.row ? " owned-row" : ""}" data-wl="${i}">
    <div class="rec-art">${cover}</div>
    <div class="rec-body">
      <h3>${escapeHtml(String(e.name))}</h3>
      ${meta ? `<div class="rec-meta">${escapeHtml(meta)}</div>` : ""}
      <div class="rec-foot"><span class="wl-badges">${badges}</span>${store}</div>
    </div>
  </div>`;
}

function renderWishlist() {
  const host = $("#wishlist");
  if (WL === null) {
    host.innerHTML = `<div class="rec-empty"><h2>Wishlist</h2><p class="rec-load">Loading…</p></div>`;
    if (!_wlBusy) {
      _wlBusy = true;
      loadWishlist().then(() => { _wlBusy = false; if (activeTab === "wishlist") renderWishlist(); });
    }
    return;
  }
  const list = wlMerged();
  if (!list.length) {
    host.innerHTML = `<div class="rec-empty"><h2>Wishlist</h2>
      <p>Nothing wished for yet — flag a game as Wishlisted on the sheet, or link a
      platform account (admin menu → Linked platforms) to pull its wishlist in.</p></div>`;
    return;
  }
  const fromPlatforms = list.filter((e) => e.providers.some((p) => p !== "sheet")).length;
  host.innerHTML = `
    <div class="rec-head">
      <h2>${icon("i-star", 20)} Wishlist</h2>
      <p class="rec-sub">${list.length.toLocaleString()} games — ${fromPlatforms.toLocaleString()}
        from linked platform wishlists, the rest flagged on the sheet.</p>
    </div>
    <div class="rec-grid wl-grid">${list.map(wlCard).join("")}</div>`;
  host.querySelectorAll("[data-wl]").forEach((card) => {
    const e = list[+card.dataset.wl];
    if (e && e.row) {
      card.classList.add("clickable");
      card.onclick = (ev) => {
        if (ev.target.closest("a")) return;      // the store link is its own click
        openDrawer(e.row, "games");
      };
    }
  });
}
