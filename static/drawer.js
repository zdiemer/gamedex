"use strict";

/* Opening, stacking and closing the detail drawer.

   The drawer has history: a game links to its collection, which links to a
   member, and Esc unwinds that one step at a time before it closes. The body it
   shows is built by hero.js + panels.js; this file owns when.

   Also "your history with this game" -- the rows in the completed sheet that are
   the same game, which is the one section the sheet knows and IGDB never will. */

// ---- detail drawer ------------------------------------------------------
let drawerSheet = "games";
// Value cell, made a clickable filter link for facetable text/year columns.
function detailValue(c, v) {
  const facetable = c.facet && (c.type === "text" || c.type === "year");
  const cell = fmtCell(v, c.type);
  if (facetable) return `<a class="facet-link" data-fk="${c.key}" data-fv="${escapeHtml(String(v))}" title="Filter by ${escapeHtml(c.label)}">${cell}</a>`;
  return cell;
}

// Opening a game FROM inside the drawer — a copy in a group, a related game, a
// collection member — is navigation, and navigation needs a way back. Anything
// that opens a drawer on top of an open drawer goes through here.
let drawerStack = [];

function openDrawerFrom(row, sheetKey) {
  if (drawerRow) drawerStack.push({ row: drawerRow, sheet: drawerSheet });
  openDrawer(row, sheetKey, true);
}
function drawerBack() {
  const prev = drawerStack.pop();
  if (prev) openDrawer(prev.row, prev.sheet, true);
}
const drawerTitleOf = (row) => String(row.title || row.game || "back");

// ---- Your history with this game ----------------------------------------
// Which columns the history section speaks for, so they don't ALSO turn up as raw rows.
// Per sheet, because Completed names the same facts differently (playTime, not
// completionTime; date, not dateCompleted).
const MINE_KEYS = {
  games: ["owned", "completed", "rating", "priority", "playingStatus", "playingProgress",
          "datePurchased", "purchasePrice", "condition", "format",
          "dateStarted", "dateCompleted", "completionTime", "dateAdded", "notes"],
  completed: ["rating", "date", "started", "playTime", "steamDeck", "emulated", "notes"],
};

// Index both sheets by match key, rebuilt when the workbook changes.
let _byK = null, _byKHash = null;
function rowsByK() {
  const hash = (DATA.meta || {}).sourceHash || "";
  if (_byK && _byKHash === hash) return _byK;
  _byK = { games: new Map(), completed: new Map() };
  for (const s of ["games", "completed"]) {
    for (const r of (DATA.sheets[s] || {}).rows || []) if (r._k) _byK[s].set(r._k, r);
  }
  _byKHash = hash;
  return _byK;
}

// One game, both sheets. The Completed sheet is where the REVIEW and the play time
// actually live — All Games carries neither for most rows — so a drawer opened from All
// Games was showing a thinner history than the app already knew. Join them on the match
// key and let each fact come from wherever it exists.
function historyOf(row) {
  const idx = rowsByK();
  const g = idx.games.get(row._k) || (row.title !== undefined ? row : null);
  const c = idx.completed.get(row._k) || (row.game !== undefined ? row : null);
  const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== "") ?? null;
  const G = g || {}, C = c || {};
  return {
    rating: pick(G.rating, C.rating),
    // Completed's playTime is the real number; All Games' completionTime is usually blank.
    playTime: pick(G.completionTime, C.playTime),
    started: pick(G.dateStarted, C.started),
    finished: pick(G.dateCompleted, C.date),
    added: pick(G.dateAdded),
    purchased: pick(G.datePurchased),
    price: pick(G.purchasePrice),
    condition: pick(G.condition),
    format: pick(G.format),
    status: pick(G.playingStatus),
    progress: pick(G.playingProgress),
    priority: pick(G.priority),
    owned: !!G.owned,
    beaten: !!G.completed || !!c,
    emulated: !!C.emulated,
    steamDeck: !!C.steamDeck,
    review: pick(C.notes),                 // the long-form write-up on the Completed sheet
    note: pick(G.notes),                   // All Games' own shorter note, if it says something else
  };
}

function mineSectionHtml(row) {
  if (!row._k) return "";
  const h = historyOf(row);
  // A combined card's _k is just the LEAD member's key, so the platform pills and
  // stat cells here would show one copy's Steam hours as if they were the group's.
  // Platform-specific meta belongs on the per-platform copy cards ("Your copies" →
  // click through); the group keeps the sheet-level history, which historyOf and
  // groupRow already aggregate properly.
  const grouped = !!(row._members && row._members.length > 1);

  const pills = [];
  if (h.beaten) pills.push(`<span class="mine-pill done">✓ Beaten</span>`);
  else if (h.status) pills.push(`<span class="mine-pill live">${escapeHtml(h.status)}${
    h.progress != null ? ` · ${Math.round(h.progress * 100)}% done` : ""}</span>`);
  if (h.owned) {
    const own = ["Owned", h.format, h.condition].filter(Boolean).join(" · ");
    pills.push(`<span class="mine-pill">${escapeHtml(own)}</span>`);
  }
  if (h.priority) pills.push(`<span class="mine-pill">Priority ${escapeHtml(String(h.priority))}</span>`);
  if (h.emulated) pills.push(`<span class="mine-pill">Emulated</span>`);
  if (h.steamDeck) pills.push(`<span class="mine-pill">Steam Deck</span>`);
  // What the linked platform accounts know: real hours, achievement counts,
  // whether I reviewed it there (see mine.js).
  if (!grouped && typeof minePillsHtml === "function") {
    const pp = minePillsHtml(row._k);
    if (pp) pills.push(pp);
  }

  const stats = [];
  if (h.rating != null)
    stats.push([`${Math.round(h.rating * 100)}`, "My rating", ratingClass(h.rating)]);
  if (h.playTime != null) stats.push([fmtHours(h.playTime), "Time played", ""]);
  if (!grouped && typeof mineStatCells === "function") stats.push(...mineStatCells(row._k));
  if (h.price != null) stats.push([`$${Number(h.price).toFixed(2)}`, "Paid", ""]);

  // The shape of the play-through. Only the beats that happened, in the order they
  // actually happened — NOT the order I listed them in: a game bought years before it was
  // logged puts Bought before Added, and hardcoding the sequence drew that backwards.
  // Events landing on the same day share one point rather than stacking two dots on top
  // of each other ("Added & Bought" when you logged it the day you bought it).
  const byDay = new Map();
  for (const [label, v] of [["Added", h.added], ["Bought", h.purchased],
                            ["Started", h.started], ["Finished", h.finished]]) {
    if (!v) continue;
    const day = String(v).slice(0, 10);              // ISO day — sorts chronologically as text
    if (!byDay.has(day)) byDay.set(day, { v, labels: [] });
    byDay.get(day).labels.push(label);               // within a day, keep the natural order
  }
  const track = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, e]) => `<li><b>${escapeHtml(fmtDate(e.v))}</b><span>${e.labels.join(" & ")}</span></li>`);

  const review = h.review
    ? `<blockquote class="mine-review">${escapeHtml(String(h.review))}</blockquote>` : "";
  // Only show the All Games note when it isn't just an echo of the review.
  const note = h.note && String(h.note).trim() !== String(h.review || "").trim()
    ? `<div class="mine-note"><span class="k">Note</span>${escapeHtml(String(h.note))}</div>` : "";

  if (!pills.length && !stats.length && !track.length && !review && !note) return "";
  return `<div class="mine-sect">
    <h3>${icon("i-star", 15)} Your history with this game</h3>
    ${pills.length ? `<div class="mine-pills">${pills.join("")}</div>` : ""}
    ${stats.length ? `<div class="hero-stats mine-stats">${stats.map(([v, l, cls]) =>
      `<div class="hero-stat"><b class="${cls}">${escapeHtml(String(v))}</b><span>${escapeHtml(l)}</span></div>`).join("")}</div>` : ""}
    ${track.length ? `<ol class="mine-track">${track.join("")}</ol>` : ""}
    ${review}${note}
  </div>`;
}

function openDrawer(row, sheetKey, keepStack) {
  tourStop();                 // not just stopPreview: leave the tour armed and it would
  stopPreview();              // start a video behind the open drawer 12s later
  // A new game (or navigation within the drawer) retires the previous game's soundtrack
  // player — the dock lives on #drawer, which survives the body rebuild, so it must be
  // torn down explicitly or it would play on over the wrong game.
  if (typeof stopSoundtrack === "function") stopSoundtrack();
  tourLast = null;
  if (!keepStack) drawerStack = [];       // a fresh open starts a fresh history
  applyCoverAccent(row);
  drawerSheet = sheetKey || (SPECIAL_TABS.includes(activeTab) ? "games" : activeTab);
  const cols = (DATA.sheets[drawerSheet] || DATA.sheets.games).columns;
  const titleCol = cols[0];
  const body = $("#drawerBody");
  const titleText = escapeHtml(String(row[titleCol.key] ?? "Untitled"));
  let html = heroHtml(row, titleText);
  // Wishlist deal block (price line + View-on-Steam / Buy-on-vendor chips) sits
  // right under the hero — it IS the point of a wishlist drawer.
  if (typeof wishlistDealHtml === "function") html += wishlistDealHtml(row);
  // Recommend block (predicted score, why, dismiss) — "" for every non-rec row.
  if (typeof recsDrawerHtml === "function") html += recsDrawerHtml(row);
  // A wishlist-only row has no match-key record, but if it matched an IGDB id we
  // can still load its full detail (summary, screenshots, tags) by that id.
  const wlDetail = row._wlOnly && row._igdbId;
  if (ENRICH_ENABLED && row._k && (!row._wlOnly || wlDetail)) html += `<div id="igdbDetail" class="igdb-detail"></div>`;

  // Box art override — same manual upload as the shelf, so a game's cover can be fixed
  // (or supplied outright) from any detail card. Offered for every real sheet row, not
  // just owned physical ones: a game IGDB never matched has no cover at all, and this is
  // the only way to give it one. Grouped collection cards have no single row to attach to.
  if (IS_ADMIN && row._k && !row._collection && !row._wlOnly) html += `<button class="sh-btn drawer-art" id="drawerArt">Manage box art</button>`;

  /* Your own history with the game was buried in the "Raw data" disclosure,
     alongside File Size and MAME Romset — and it's the most personal thing on the
     card: what you paid, when you started it, whether you finished, what you
     thought. It gets its own section now; the rest stays behind the disclosure. */
  const MINE = MINE_KEYS[drawerSheet] || MINE_KEYS.games;
  const cell = (c, v) => {
    const isNotes = c.type === "text" && String(v).length > 140;
    return isNotes
      ? `<div class="detail-row notes"><div class="k">${escapeHtml(c.label)}</div><div class="v">${escapeHtml(String(v))}</div></div>`
      : `<div class="detail-row"><div class="k">${escapeHtml(c.label)}</div><div class="v">${detailValue(c, v)}</div></div>`;
  };

  let raw = "";
  for (const c of cols) {
    if (c.key === titleCol.key || c.key === "platform") continue;
    const v = row[c.key];
    if (v === undefined || v === null || v === "") continue;
    if (MINE.includes(c.key)) continue;        // the history section tells these properly
    raw += cell(c, v);
  }
  // The personal "history" (purchase price, dates) stays public; the NAS section leaks
  // file paths/sizes, so it's admin-only (the read is empty for anon anyway).
  // A combined card gets no platform detail host: the achievement grid /
  // screenshots / store review are one COPY's story (the lead's, at that), and
  // they live on the per-platform copy drawers instead.
  const groupedRow = !!(row._members && row._members.length > 1);
  if (!row._collection) html += mineSectionHtml(row)
    // The platform detail (achievement grid, personal screenshots, my Steam
    // review) lands async from /api/mine/detail — give it a host to fill.
    + (row._k && !groupedRow ? `<div id="mineExtra" class="mine-extra"></div>` : "")
    + (IS_ADMIN ? nasSectionHtml(row) : "");
  else {                                       // a grouped card's values are aggregates, not yours
    for (const c of cols) {
      const v = row[c.key];
      if (v === undefined || v === null || v === "") continue;
      if (MINE.includes(c.key)) raw = cell(c, v) + raw;
    }
  }
  // Admin escape hatch for a wishlist-only game: map (or fix) its IGDB match by
  // hand. Rendered for every wl-only row — especially the unmatched ones, which
  // have no IGDB section otherwise.
  if (typeof wishlistMapHtml === "function") html += wishlistMapHtml(row);
  html += (typeof editionsHtml === "function" ? editionsHtml(row) : "");
  html += `<div id="relations"></div>`;
  html += collectionSectionHtml(row);
  // Sheet fields collapse behind a "Raw data" disclosure — the enriched view
  // leads. A grouped collection card has no sheet row of its own; its values are
  // aggregates over the members, so don't dress them up as raw data.
  if (IS_ADMIN && raw && !row._collection) html += `<details class="raw-data"><summary>Raw data</summary>${raw}</details>`;
  body.innerHTML = html;
  const back = $("#drawerBack");
  const prev = drawerStack[drawerStack.length - 1];
  back.hidden = !prev;
  // The hero has to know, so it can keep its title out from under the button (see .has-back).
  $("#drawer").classList.toggle("has-back", !!prev);
  if (prev) {
    const t = drawerTitleOf(prev.row);
    back.textContent = `← ${t.length > 22 ? t.slice(0, 21) + "…" : t}`;
    back.title = `Back to ${t}`;
  }
  wireCollections(body);
  if (typeof wireWishlistMap === "function") wireWishlistMap(body, row);
  const artBtn = $("#drawerArt");
  if (artBtn) artBtn.onclick = () => {
    const key = `${row._k}#${String(row.releaseRegion || "").trim()}`;
    // If the shelf is already loaded, we know whether this game has an upload; if not,
    // default to "no" — the Remove button just won't show until the shelf's been opened.
    const g = (typeof SHELF !== "undefined" ? SHELF.games : []).find((x) => x.k === key);
    openCoverEditor({
      key, platform: row.platform, title: row[titleCol.key],
      hasUpload: g ? g.src === "upload" : false,
      caseDefault: g ? g.case : null, existing: g ? g.upload : null,
      onDone: () => { if (typeof SHELF !== "undefined") SHELF.loaded = false; loadUploads(); },
    });
  };
  // A grouped card's members open individually — with a way back to the group.
  body.querySelectorAll("[data-rlc]").forEach((el) => {
    el.onclick = () => {
      const m = (row._members || [])[+el.dataset.rlc];
      if (m) openDrawerFrom(m, "games");
    };
  });
  $("#overlay").hidden = false;
  // Reset scroll AFTER the overlay is shown. Set while it's still display:none it never
  // takes — and the browser then restores the PREVIOUS game's scroll when it appears,
  // which is why one game's scroll position leaked into the next.
  $("#drawer").scrollTop = 0;
  drawerRow = row;
  if (typeof setDocTitle === "function") setDocTitle();   // "<game> · Gamedex" in the address bar
  // Put the open game in the URL so it's shareable and part of browser history: a fresh open
  // pushes a new entry (Back closes it); navigating within the drawer (a related game, a
  // collection member) replaces in place, so the whole drawer stays one history entry. Skipped
  // when the open was itself DRIVEN BY the URL (popstate / deep link) — the URL is already right.
  if (!restoringDrawer && row._k && typeof syncURL === "function") syncURL(!keepStack);
  syncScrollLock();                       // the page behind the drawer must not scroll
  if (ENRICH_ENABLED && row._k && !row._wlOnly) loadDetail(row._k, $("#igdbDetail"), 0, row);
  else if (wlDetail) loadDetail(row._k, $("#igdbDetail"), 0, row, row._igdbId);
  if (row._k && !groupedRow && typeof loadMineDetail === "function") loadMineDetail(row._k, $("#mineExtra"));
}
// silent=true just tears down the DOM without touching history — for callers that immediately
// drive their own navigation (a facet-link jump), so we don't fight them for the URL.
function closeDrawer(silent) {
  // A user close (Esc / ✕ / scrim) with a drawer history entry steps Back instead, so the
  // address bar returns to the list and Forward can reopen. The popstate then runs the real
  // teardown (restoringDrawer). Deep-link opens have no drawer entry to pop — fall through and
  // strip ?game= in place.
  if (silent !== true && !restoringDrawer && !$("#overlay").hidden
      && history.state && history.state.drawer) {
    history.back();
    return;
  }
  const wasOpen = !$("#overlay").hidden;
  if (typeof stopSoundtrack === "function") stopSoundtrack();   // silence the player on close
  $("#overlay").hidden = true; drawerStack = [];
  // Nulled, not just hidden: most readers guard on !$("#overlay").hidden but several don't
  // (panels.js, hero.js), and openDrawerFrom pushes drawerRow onto the back-stack — a stale
  // one renders a "← back to <game you already closed>" button. It also pinned the last
  // row's _members/_igdb alive for the session.
  drawerRow = null; drawerSheet = null;
  if (silent !== true && !restoringDrawer && wasOpen && typeof syncURL === "function") syncURL(false);
  if (typeof setDocTitle === "function") setDocTitle();   // back to the tab's title
  // If this drawer was opened FROM attract mode, closing it hands the screen straight
  // back to the slideshow (which re-locks scroll itself) — don't also kick the tour.
  if (typeof attractResume === "function" && attractResume()) return;
  syncScrollLock();
  // The pointerdown that closed this fired while the overlay was still open, so the tour
  // refused to arm itself. Now that it's shut, start the clock.
  tourKick();
}

// Lock the page behind a full-screen overlay. Pinning the body with position:fixed (and
// restoring the scroll offset on release) is the one approach that also holds on iOS
// Safari, where `overflow:hidden` on the body alone doesn't stop touch scrolling.
// syncScrollLock() is called by every overlay on open AND close, and locks iff any
// overlay is still up — so a cover editor closing over an open drawer keeps the lock,
// and the re-entrant openDrawer (navigation within the drawer) never double-locks.
let _scrollLockY = 0;
function anyOverlayOpen() {
  return !$("#overlay").hidden
    || !$("#navdrawer").hidden                                    // the main nav menu
    || !$("#lightbox").hidden
    || !$("#attract-overlay").hidden                             // full-screen attract mode
    || (typeof cmdk !== "undefined" && cmdk.open)
    || $("#facets").classList.contains("open")
    || !!document.querySelector(".ce-scrim")                        // cover editor
    || !!document.querySelector(".np-scrim")                        // name-a-view/picker prompt
    || (typeof shCur !== "undefined" && shCur >= 0);               // shelf 3D pull
}
function syncScrollLock() {
  const on = anyOverlayOpen();
  const locked = document.documentElement.classList.contains("modal-open");
  if (on && !locked) {
    _scrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${_scrollLockY}px`;
    document.documentElement.classList.add("modal-open");
  } else if (!on && locked) {
    document.documentElement.classList.remove("modal-open");
    document.body.style.top = "";
    window.scrollTo(0, _scrollLockY);
  }
}

// Clicking a facet-link (in the drawer) filters that field on its sheet's tab.
function applyDrawerFacet(key, val) {
  const tab = drawerSheet;
  if (!tabState[tab]) return;
  closeDrawer(true);            // silent — goTab's nav() writes the (drawer-free) URL for this jump
  goTab(tab, () => { tabState[tab].facets = { [key]: new Set([String(val)]) }; });
}
