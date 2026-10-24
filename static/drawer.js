"use strict";

/* Opening, stacking and closing the detail drawer.

   The drawer has history: a game links to its collection, which links to a
   member, and Esc unwinds that one step at a time before it closes. The body it
   shows is built by hero.js + panels.js; this file owns when.

   Also "your history with this game" -- the rows in the completed sheet that are
   the same game, which is the one section the sheet knows and IGDB never will. */

// ---- detail drawer ------------------------------------------------------
let drawerSheet = "games";

// Opening a game FROM inside the drawer — a copy in a group, a related game, a
// collection member — is navigation, and navigation needs a way back. Anything
// that opens a drawer on top of an open drawer goes through here.
let drawerStack = [];
let drawerReturn = null;

function openDrawerFrom(row, sheetKey) {
  if (drawerRow) drawerStack.push({ row: drawerRow, sheet: drawerSheet });
  openDrawer(row, sheetKey, true);
}
const drawerCanBack = () => drawerStack.length > 0 || !!drawerReturn;
function drawerBack() {
  const prev = drawerStack.pop();
  if (prev) {
    openDrawer(prev.row, prev.sheet, true);
    return;
  }
  const destination = drawerReturn;
  if (!destination) return;
  closeDrawer(true);
  if (!restoringDrawer && typeof syncURL === "function") syncURL(false);
  destination.open();
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
  // A group's history is the union of its copies' — earliest dates, latest
  // finish, any copy's ownership, hours and dollars added up — not the lead's
  // row wearing the group's name: that put the lead's rating next to the hero's
  // averaged one, two "Your rating" tiles disagreeing in the same drawer. The
  // lead goes first so single-copy facts (status, review, format) still prefer
  // the copy the card is titled after; _aggMembers keeps the basis the same set
  // the hero's averages were computed over.
  const ms = row._members && row._members.length > 1
    ? (row._aggMembers || row._members) : null;
  if (ms && ms.length > 1) {
    const hs = [...ms].sort((a, b) => (b._k === row._k) - (a._k === row._k)).map(historyOf);
    const has = (v) => v !== undefined && v !== null && v !== "";
    const pick = (f) => { const h = hs.find((x) => has(x[f])); return h ? h[f] : null; };
    const day = (f, last) => {
      const ds = hs.map((x) => x[f]).filter(has).sort((a, b) => String(a).localeCompare(String(b)));
      return ds.length ? ds[last ? ds.length - 1 : 0] : null;
    };
    const sum = (f) => {
      const vs = hs.map((x) => x[f]).filter((v) => has(v) && !isNaN(Number(v)));
      return vs.length ? vs.reduce((s, v) => s + Number(v), 0) : null;
    };
    return {
      rating: has(row.rating) ? row.rating : pick("rating"),   // the hero's average, not the lead's
      playTime: sum("playTime"), price: sum("price"),
      started: day("started"), finished: day("finished", true),
      added: day("added"), purchased: day("purchased"),
      condition: pick("condition"), format: pick("format"),
      status: pick("status"), progress: pick("progress"), priority: pick("priority"),
      owned: hs.some((x) => x.owned), beaten: hs.some((x) => x.beaten),
      emulated: hs.some((x) => x.emulated), steamDeck: hs.some((x) => x.steamDeck),
      review: pick("review"), note: pick("note"),
    };
  }
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
  $("#overlay").hidden = true; drawerStack = []; drawerReturn = null;
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
    || (typeof uiDialogStack !== "undefined" && uiDialogStack.length > 0)
    || !!document.querySelector(".ce-scrim")                        // cover editor
    || !!document.querySelector(".np-scrim")                        // name-a-view/picker prompt
    // Pick's criteria sheet. clientHeight guards the desktop, where the "sheet" is
    // display:contents — no box, nothing over the page, nothing to lock for.
    || !!document.querySelector(".pick-shwrap.open")?.clientHeight
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
