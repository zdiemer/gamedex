"use strict";

/* events.js — the seasonal-event framework.

   Spooktober (spooktober.js, 1.62.0) was the first one, and it hard-wired every piece of
   itself: its own season test, its own banner, its own prefs object, its own pool. That was
   right for n=1. At n=12 the four pieces that were never about horror live here, and each
   event file declares only the part that is genuinely its own — its structure.

   What an event is, in this app:

     a WINDOW   two month/day pairs, compared without building a Date, so the same test
                works in every year. May wrap the new year (24 Doors runs Nov 24 → Jan 6).
                An event may also have no window at all (Endangered), in which case it
                decides for itself whether it has anything to say.
     a BANNER   on Home, above everything, only while it is on. One banner, ever: when
                windows overlap — and they do, seven times a year — the highest priority
                wins, and an event that is past its own core period drops 50 priority so a
                live event always beats one that is only showing you its afterglow.
     a TAB      ?tab=<id>, rendered into the single #event host, with a TAB_RESET entry.
     a STATE    an object under one prefs key ("events"), localStorage always and the
                server when you're the owner, merged PER EVENT on load so two devices that
                each touched a different event both keep their work.

   Everything else — the calendar, the doors, the bracket, the ledger — is the event's own
   business, which is the entire point of the exercise. */

/* ---- the clock -------------------------------------------------------------
   Nothing in an event calls new Date(). They all ask evNow(), because the preview page
   (?tab=events) has to be able to move the whole board to Christmas Eve in September and
   see exactly what Home, the banner and the page will do — and a preview that renders a
   special-cased "as if" version of the page is a preview of nothing. The override lives in
   sessionStorage: it is a debugging lens, so it must not survive a browser restart, and it
   must not follow you onto another device the way a pref would. */
const EV_FAKE_KEY = "gamedex.events.previewDate";
let EV_FAKE = null;
try { EV_FAKE = sessionStorage.getItem(EV_FAKE_KEY) || null; } catch (_) {}

function evNow() {
  if (!EV_FAKE) return new Date();
  // Parsed as local midnight, not UTC: "2026-12-24" through the Date constructor is UTC,
  // which is December 23rd for anyone west of Greenwich — and this whole file compares days.
  const [y, m, d] = EV_FAKE.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}
const evPreviewing = () => !!EV_FAKE;
function evSetPreview(iso) {
  EV_FAKE = iso || null;
  try {
    if (EV_FAKE) sessionStorage.setItem(EV_FAKE_KEY, EV_FAKE);
    else sessionStorage.removeItem(EV_FAKE_KEY);
  } catch (_) {}
  evPreviewChrome();
  if (typeof renderAll === "function") renderAll();
}
const evISO = (d = evNow()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---- windows ---------------------------------------------------------------
   A window is { from: [month, day], to: [month, day] }, months 1-based because a bare 8
   meaning September is the trap spooktober.js already warned about. Compared as (m, d)
   pairs rather than by building two Dates, so one definition covers every year. */
const evMD = (d) => d.getMonth() * 100 + d.getDate();          // 1204 = Dec 4
const evPairMD = ([m, d]) => (m - 1) * 100 + d;

function evInWindow(win, d = evNow()) {
  if (!win) return false;
  const now = evMD(d), a = evPairMD(win.from), b = evPairMD(win.to);
  return a <= b ? (now >= a && now <= b) : (now >= a || now <= b);   // wraps the new year
}

/* Which year's edition you are looking at. Only interesting for a window that wraps: on
   January 3rd the doors you want are last December's, so the edition is the year the
   window OPENED in, not the calendar year. */
function evYear(ev, d = evNow()) {
  const win = ev.core || ev.window;
  if (!win) return d.getFullYear();
  const a = evPairMD(win.from), b = evPairMD(win.to);
  if (a <= b) return d.getFullYear();
  return evMD(d) <= b ? d.getFullYear() - 1 : d.getFullYear();
}

/* February has two events and only one banner slot. Make the choice once from the year,
   rather than on every page load, so every device and the preview board agree. The integer
   mix is a deterministic coin flip; it does not alternate predictably year by year. */
function evFebruaryPick(d = evNow()) {
  let x = Math.imul(d.getFullYear(), 0x9e3779b1) >>> 0;
  x ^= x >>> 16;
  return (x & 1) ? "blackhistory" : "twoplayer";
}
const evFebruaryActive = (id, d = evNow()) => evFebruaryPick(d) === id;

/* Where in its own life the event is. Measured against `core` (the thing the event is
   actually about: the 24 doors, the 31 nights, the 30 days) rather than against the banner
   window, which is deliberately wider at both ends.
     before — it hasn't started; days = how many until it does
     during — day N of it
     after  — it's over; what's left is the record */
function evPhase(ev, d = evNow()) {
  const core = ev.core || ev.window;
  if (!core) return { phase: "during", day: d.getDate() };
  const y = evYear(ev, d);
  const start = new Date(y, core.from[0] - 1, core.from[1]);
  const endM = evPairMD(core.to) < evPairMD(core.from) ? y + 1 : y;
  const end = new Date(endM, core.to[0] - 1, core.to[1]);
  const today = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const DAY = 86400000;
  // Midnight to midnight, so "13 days to go" doesn't tick over mid-afternoon.
  if (today < start) return { phase: "before", days: Math.round((start - today) / DAY) };
  if (today > end) return { phase: "after", days: Math.round((today - end) / DAY) };
  return { phase: "during", day: Math.round((today - start) / DAY) + 1,
           left: Math.round((end - today) / DAY) };
}

// How long the core period runs, in days. The doors and the nights both want this and
// neither should count it by hand.
function evCoreDays(ev) {
  const core = ev.core || ev.window;
  if (!core) return 0;
  const y = 2001;                                   // any non-leap year; no February window
  const a = new Date(y, core.from[0] - 1, core.from[1]);
  const b = new Date(evPairMD(core.to) < evPairMD(core.from) ? y + 1 : y, core.to[0] - 1, core.to[1]);
  return Math.round((b - a) / 86400000) + 1;
}

/* ---- the registry ---------------------------------------------------------- */
const EV = { list: [], byId: {} };
const EVENT_TABS = [];        // read by app.js at parse time — events.js loads first

function evRegister(def) {
  const ev = Object.assign({
    priority: 50, structure: "", icon: "i-calendar", cta: "Open",
    blank: () => ({}), merge: null, live: null, active: null, deco: [], skin: "",
  }, def);
  // Most events want the standard banner; one (Spooktober) brought its own, and one day
  // something may want none at all.
  if (!ev.bannerHtml && ev.banner !== false) ev.bannerHtml = () => evBannerHtml(ev);
  EV.list.push(ev);
  EV.byId[ev.id] = ev;
  // Spooktober shipped before this file existed and owns its own tab, host and render path
  // in app.js. It registers here for the things the registry is actually for — the banner
  // ordering and the preview board — and keeps its plumbing.
  if (!ev.external) {
    EVENT_TABS.push(ev.id);
    // app.js parsed before this ran, so its list has to be extended rather than rebuilt:
    // setSpecialMode and applyStateFromURL both test membership by tab id.
    if (typeof SPECIAL_TABS !== "undefined") SPECIAL_TABS.push(ev.id);
  }
  if (ev.reset) TAB_RESET[ev.id] = ev.reset;
  return ev;
}
const evById = (id) => EV.byId[id] || null;
const evIsTab = (id) => !!EV.byId[id];

/* Is this event's banner allowed on Home right now? A windowed event says yes inside its
   window. A windowless one (Endangered) answers for itself — always-on means always
   ELIGIBLE, not always shouting. */
function evBannerOn(ev, d = evNow()) {
  if (typeof ev.active === "function" && !ev.active(d)) return false;
  if (ev.window) return evInWindow(ev.window, d);
  return typeof ev.live === "function" ? !!ev.live() : false;
}

// One banner on Home. Live beats afterglow: an event past its core drops 50, so
// No-Buy November on the 1st outranks Spooktober's "that's a wrap on October".
function evTopBanner(d = evNow()) {
  const on = EV.list.filter((ev) => ev.bannerHtml && evBannerOn(ev, d));
  if (!on.length) return null;
  const rank = (ev) => ev.priority - (evPhase(ev, d).phase === "after" ? 50 : 0);
  return on.sort((a, b) => rank(b) - rank(a))[0];
}

function evWireBanner(scope) {
  (scope || document).querySelectorAll(".ev-banner[data-ev]").forEach((el) => {
    const go = () => goTab(el.dataset.ev);
    el.onclick = go;
    // role=button with no key handler is a button only for people holding a mouse.
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  if (typeof wireSpookBanner === "function") wireSpookBanner(scope);
}

/* ---- state ----------------------------------------------------------------
   One prefs key for all of them ("events"), because a pref key is an allowlist entry on
   the server and twelve of those to store twelve small objects is a schema, not a feature.
   The client holds the whole file and each event owns one branch of it. */
const EV_LOCAL = "gamedex.events";
const EV_V = 1;
let EV_FILE = null;
let EV_LOADED = false;
let EV_LOAD_TASK = null;
let EV_SAVE_TASK = null;
let EV_SAVE_AGAIN = false;

function evFile() {
  if (EV_FILE) return EV_FILE;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(EV_LOCAL) || "null"); } catch (_) {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.ev) raw = { v: EV_V, ev: {} };
  return (EV_FILE = raw);
}

// An event's own branch, created on demand. Never write to the returned object without
// calling evSave — nothing here watches for changes.
function evState(id) {
  const f = evFile();
  const ev = evById(id);
  if (!f.ev[id]) f.ev[id] = (ev && ev.blank) ? ev.blank() : {};
  return f.ev[id];
}

function evSave() {
  const f = evFile();
  try { localStorage.setItem(EV_LOCAL, JSON.stringify(f)); } catch (_) { /* private mode */ }
  // Signed out the server refuses the write by design (prefs are the owner's). Their events
  // are real, they just live in this browser — don't fire a request to be told so.
  if (typeof IS_ADMIN !== "undefined" && !IS_ADMIN) return Promise.resolve();

  /* Roll, then pin is two taps and therefore two saves. Independent PUTs can finish in the
     opposite order and leave the server with the earlier, unpinned slate. Keep one writer
     and, if state changes while it is in flight, follow it with the newest whole file. */
  EV_SAVE_AGAIN = true;
  if (EV_SAVE_TASK) return EV_SAVE_TASK;
  const flush = async () => {
    do {
      EV_SAVE_AGAIN = false;
      const body = JSON.stringify(evFile());
      try {
        const r = await fetch("api/prefs/events", {
          method: "PUT", headers: { "Content-Type": "application/json" }, body,
        });
        if (!r.ok) throw new Error(await r.text());
      } catch (_) {
        if (typeof showToast === "function") showToast("Saved on this device, couldn't reach the server");
      }
    } while (EV_SAVE_AGAIN);
  };
  EV_SAVE_TASK = flush().finally(() => {
    EV_SAVE_TASK = null;
    // A save can land after the loop's last condition but before finally runs.
    if (EV_SAVE_AGAIN) evSave();
  });
  return EV_SAVE_TASK;
}

/* On boot and on an explicit refresh: merge the server's copy in, per event, using whatever rule that event gave.
   Without a rule the server's branch wins only where this browser has nothing, which is the
   conservative answer — it can never delete work you did here. */
function evLoadPrefs(force = false) {
  if (typeof IS_ADMIN !== "undefined" && !IS_ADMIN) return Promise.resolve();
  if (!force && EV_LOADED) return Promise.resolve();
  if (EV_LOAD_TASK) return EV_LOAD_TASK;

  EV_LOAD_TASK = (async () => {
    let remote = null;
    try {
      const r = await fetch("api/prefs");
      if (!r.ok) throw new Error(`api/prefs returned ${r.status}`);
      const j = await r.json();
      remote = (j.prefs || {}).events;
      EV_LOADED = true;
    } catch (_) {
      return;                         // offline: the local mirror stands in
    }
    if (!remote || typeof remote !== "object" || !remote.ev) return;
    const f = evFile();
    let changed = false;
    for (const [id, theirs] of Object.entries(remote.ev)) {
      if (!theirs || typeof theirs !== "object") continue;
      const ev = evById(id);
      const mine = f.ev[id];
      if (!mine) { f.ev[id] = theirs; changed = true; continue; }
      if (ev && typeof ev.merge === "function") {
        if (ev.merge(mine, theirs)) changed = true;
      } else {
        for (const [k, v] of Object.entries(theirs)) if (!(k in mine)) { mine[k] = v; changed = true; }
      }
    }
    if (!changed) return;
    try { localStorage.setItem(EV_LOCAL, JSON.stringify(f)); } catch (_) {}
    if (evIsTab(activeTab)) evRenderPage(activeTab);
    else if (activeTab === "home") evPatchBanner();
  })().finally(() => { EV_LOAD_TASK = null; });
  return EV_LOAD_TASK;
}

/* ---- pools -----------------------------------------------------------------
   Spooktober's three-rung horror test is the model every pool here follows, and its lesson
   is the important part: match on what a game IS (a genre, a subgenre, a game mode), never
   on a noun that merely appears in it. "ghosts" put Animal Crossing on the horror calendar;
   a regex for "destiny" puts Tales of Destiny on the always-online queue.

   Cached against the enrichment epoch, because rungs that read ENRICH genuinely change as
   enrichment lands and re-walking 14.9k rows on every keystroke is not how to notice. */
// Defensive about DATA because two callers run early: the Home banner's own line (which is
// built out of the collection) and the boot-time decision about whether to fetch prefs.
const evRows = () => (((typeof DATA !== "undefined" && DATA && DATA.sheets && DATA.sheets.games) || {}).rows || []);
const evEnrich = (r) => (typeof ENRICH !== "undefined" && ENRICH[r._k]) || null;

const _evPools = new Map();
function evPool(name, pred, opts) {
  const hit = _evPools.get(name);
  if (hit && hit.epoch === _enrichEpoch) return hit.rows;
  let rows = evRows().filter((r) => r.title && pred(r));
  if (!opts || opts.group !== false) rows = typeof groupByGame === "function" ? groupByGame(rows) : rows;
  _evPools.set(name, { epoch: _enrichEpoch, rows });
  return rows;
}
const evOwnedUnfinished = (r) => !!r.owned && !r.completed;

// IGDB's game_modes, which the enricher already stores for every matched game (enrich.py).
// Only trustworthy behind an igdbId: a fallback match fills these arrays with free text
// from whatever site answered, the same reason unifiedGenreVals ignores it (data.js).
function evModes(r) {
  const e = evEnrich(r);
  return e && e.igdbId ? (e.gameModes || []).map((m) => String(m).toLowerCase()) : [];
}
const evHasMode = (r, ...want) => { const m = evModes(r); return want.some((w) => m.includes(w)); };

/* Resolving a saved key has to look at the RAW rows. Grouping happens per pool, and two
   pools can pick different representatives for the same title, so a key saved from one
   grouped list would not be found in another. */
let _evIdx = null, _evIdxRows = null;
function evRow(key) {
  const rows = evRows();
  if (!_evIdx || _evIdxRows !== rows) {
    _evIdxRows = rows;
    _evIdx = new Map();
    for (const r of rows) { const k = String(r._k || ""); if (k && !_evIdx.has(k)) _evIdx.set(k, r); }
  }
  return _evIdx.get(String(key)) || null;
}
const evKey = (r) => String((r && r._k) || "");

// Fisher-Yates over a copy, then take n. Shared because four events roll something.
function evDraw(pool, n, taken) {
  const skip = new Set((taken || []).map(String));
  const pick = pool.filter((r) => !skip.has(evKey(r)));
  for (let i = pick.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pick[i], pick[j]] = [pick[j], pick[i]];
  }
  return pick.slice(0, n);
}

/* Most events are called the same thing every year. One is not: the anniversary dial is
   the Class of '01 this year and the Class of '02 next, and under a preview date it has to
   say whichever year the preview is in. The tab keeps ev.name; the poster asks. */
const evName = (ev) => (typeof ev.title === "function" ? ev.title() : ev.name);

const EV_MONTHS = ["January", "February", "March", "April", "May", "June", "July",
                   "August", "September", "October", "November", "December"];
const evDateText = ([m, d]) => `${EV_MONTHS[m - 1]} ${d}`;
const evWindowText = (ev) => ev.window ? `${evDateText(ev.window.from)} to ${evDateText(ev.window.to)}` : "all year";

/* ---- a game card, and a picker ---------------------------------------------
   Three events (Hearth, Two-Player February, the bracket's manual seeding) need the same
   thing: search a pool, tap a game, put it in a slot. It lived inside spooktober.js as
   thirty lines of markup and a keystroke handler that repaints only the results, and that
   part is genuinely general, so it is here. The behaviour it preserves: typing repaints the
   LIST, never the input, and the caret only comes back if it was in the box to begin with —
   focusing it unconditionally re-opens the keyboard of anyone tapping covers on a phone. */
const EVP = { host: null, slot: null, q: "", all: false, pool: null, onPick: null, title: "" };

function evPickerOpen(o) {
  Object.assign(EVP, { slot: o.slot, q: "", all: false, pool: o.pool, onPick: o.onPick, title: o.title || "" });
  o.repaint();
}
function evPickerClose(repaint) {
  EVP.slot = null; EVP.q = ""; EVP.all = false;
  if (repaint) repaint();
}
const evPickerOpenOn = (slot) => EVP.slot != null && String(EVP.slot) === String(slot);

function evAllGames() {
  return evPool("__all", (r) => !!r.title);
}

function evRepaintKeepingCaret(repaint) {
  const q0 = document.getElementById("evQ");
  const typing = !!q0 && document.activeElement === q0;
  repaint();
  if (!typing) return;
  const q = document.getElementById("evQ");
  if (q) { q.focus(); q.selectionStart = q.selectionEnd = q.value.length; }
}

function evWireTiles(host) {
  host.querySelectorAll("[data-evopen]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const r = evRow(el.dataset.evopen);
      if (r) openDrawer(r, "games");
    };
  });
}

const evHours = (h) => h == null ? "" : (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + "h";
const evPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ---- routing ---------------------------------------------------------------
   app.js owns one branch for all of this: evRenderTab(tab) claims the tab or it doesn't. */
function evRenderTab(tab) {
  if (tab === "events") { setSpecialMode("events"); evRenderAdmin(); return true; }
  if (!evIsTab(tab) || EV.byId[tab].external) return false;
  setSpecialMode("event");
  evRenderPage(tab);
  return true;
}

function evRenderPage(id) {
  const ev = evById(id);
  const host = $("#event");
  if (!ev || !host || !DATA) return;
  evLoadPrefs();
  // "evp-", not "ev-": the content classes in this section are all ev-*, and a host called
  // .ev-doors collided head-on with the doors grid (.ev-doors { display: grid }), which laid
  // the whole page out as one column of the calendar.
  host.className = "evpage evp-" + ev.id;
  /* The skin goes on the HOST as well as on the hero, because the page below the hero
     wants one thing out of it: --ev-k, the event's accent, on its buttons, its meters and
     the game it just marked. Without this every page borrowed the app's violet and eleven
     events looked like one. The rest of the properties are inert here — only .ev-banner
     and .ev-hero read --ev-art. */
  host.setAttribute("style", ev.skin || "");
  ev.render(host);
  evWireTiles(host);
  evPreviewChrome();
}

TAB_RESET.events = () => {};
