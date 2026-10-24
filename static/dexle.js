"use strict";

/* Dexle — the daily guess-the-game. Six guesses, and a different kind of clue
   depending on the day (the server rotates them): the cover zoomed in far too close,
   a screenshot behind frosted glass, the IGDB blurb with the names blacked out, or
   a track off the soundtrack.

   The answer never reaches the browser: every guess is judged by the server, which
   pays out the next metadata hint (year, platform, genre, developer, first letter)
   and a warmer/colder nudge when the guessed game shares something with the answer.
   What DOES arrive up front is the clue material itself — an image id, censored
   sentences, a track's length — none of which names the game.

   Progress is kept per day in localStorage; the streak lives in prefs (server-side,
   admin's own) exactly like the Picross streak, mirrored locally. */

const DX = {
  date: null, mode: null, clue: null, maxGuesses: 6,
  guesses: [],          // [{title|null, near|null}] — null title is a skip
  hints: [],            // hints revealed so far
  done: false, won: false, answer: null,
  loaded: false, failed: false,
  practice: null,       // {seed, mode} while an endless round is up; null = today's
};
let dxPracticeMode = "any";   // the mode chip selection for the next practice round

const DX_MODES = {
  cover:   { label: "Zoomed In",       icon: "i-search",
             blurb: "The box art, far too close. Every miss backs the camera off." },
  shot:    { label: "Out of Focus",    icon: "i-grid",
             blurb: "A screenshot behind frosted glass. Every miss wipes it cleaner." },
  summary: { label: "Redacted",        icon: "i-review",
             blurb: "The official blurb, names blacked out. Every miss reveals another line." },
  ost:     { label: "Name That Tune",  icon: "i-music",
             blurb: "A track from its soundtrack. Every miss buys a longer listen." },
};

// Per-mode reveal ladders, indexed by how many guesses you've burned.
const DX_ZOOM = [7, 5, 3.6, 2.6, 1.9, 1.4];
const DX_BLUR = [26, 18, 12, 8, 4, 2];
const DX_CLIP = [8, 15, 25, 40, 60, Infinity];

const dxStage = () => Math.min(DX.guesses.length, DX.maxGuesses - 1);

// ---- per-day progress (device mirror + admin account sync) -----------------
// Revision 2 starts a clean local round after the 2026-10-06 popular-pool reseed.
const DX_PROGRESS_REVISION = 2;
const dxKey = () => `dexle:v${DX_PROGRESS_REVISION}:${DX.date}`;
let dxRemoteProgress = null;
function dxProgressSnapshot() {
  return { date: DX.date, revision: DX_PROGRESS_REVISION, guesses: DX.guesses,
    hints: DX.hints, done: DX.done, won: DX.won, answer: DX.answer };
}
function dxProgressValid(s) {
  return !!(s && s.date === DX.date && s.revision === DX_PROGRESS_REVISION
    && Array.isArray(s.guesses));
}
function dxProgressRank(s) {
  return (s.done ? 100 : 0) + s.guesses.length;
}
async function dxSave() {
  if (DX.practice) return;        // a practice round is disposable by design
  const s = dxProgressSnapshot();
  try { localStorage.setItem(dxKey(), JSON.stringify(s)); }
  catch (_) { /* private mode: the server copy can still keep the round */ }
  if (typeof IS_ADMIN !== "undefined" && IS_ADMIN) {
    dxRemoteProgress = s;
    try {
      await fetch("api/prefs/dexleProgress", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
      });
    } catch (_) { /* the device mirror remains usable offline */ }
  }
}
function dxLoad() {
  if (DX.practice) return false;
  let local = null;
  try { local = JSON.parse(localStorage.getItem(dxKey()) || "null"); } catch (_) {}
  const remote = dxProgressValid(dxRemoteProgress) ? dxRemoteProgress : null;
  local = dxProgressValid(local) ? local : null;
  const s = remote && (!local || dxProgressRank(remote) >= dxProgressRank(local)) ? remote : local;
  if (!s) return false;
  DX.guesses = s.guesses; DX.hints = Array.isArray(s.hints) ? s.hints : [];
  DX.done = !!s.done; DX.won = !!s.won; DX.answer = s.answer || null;
  try { localStorage.setItem(dxKey(), JSON.stringify(s)); } catch (_) {}
  return true;
}

/* ---- streak ----------------------------------------------------------------
   Identical machinery to the Picross streak (picross.js): server prefs so it follows
   me between devices, a localStorage mirror so the number paints instantly. */
let dxPrefs = null;
const DX_LOCAL = "gamedex.dexle";
function dxStreak() {
  if (dxPrefs) return dxPrefs;
  try { dxPrefs = JSON.parse(localStorage.getItem(DX_LOCAL) || "null"); } catch (_) {}
  return (dxPrefs = dxPrefs || { streak: 0, best: 0, last: null, solved: 0 });
}
async function dxLoadPrefs() {
  try {
    const j = await (await fetch("api/prefs")).json();
    const prefs = j.prefs || {};
    const s = prefs.dexle;
    dxRemoteProgress = prefs.dexleProgress || null;
    if (s && typeof s === "object") {
      dxPrefs = s;
      try { localStorage.setItem(DX_LOCAL, JSON.stringify(s)); } catch (_) {}
    }
  } catch (_) { /* offline: the local mirrors stand in */ }
}
function dxCurrentStreak() {
  const s = dxStreak();
  if (!s.last || !DX.date) return s.streak || 0;
  if (s.last === DX.date) return s.streak || 0;
  const y = new Date(DX.date + "T00:00:00Z");
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  return s.last === yesterday ? (s.streak || 0) : 0;
}
async function dxBumpStreak() {
  const s = { ...dxStreak() };
  if (s.last === DX.date) return s;
  const y = new Date(DX.date + "T00:00:00Z");
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  s.streak = s.last === yesterday ? (s.streak || 0) + 1 : 1;
  s.best = Math.max(s.best || 0, s.streak);
  s.solved = (s.solved || 0) + 1;
  s.last = DX.date;
  dxPrefs = s;
  try { localStorage.setItem(DX_LOCAL, JSON.stringify(s)); } catch (_) {}
  if (typeof IS_ADMIN === "undefined" || IS_ADMIN) {
    try {
      await fetch("api/prefs/dexle", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
      });
    } catch (_) { /* the streak is a nicety, never a blocker */ }
  }
  return s;
}

/* ---- endless practice -------------------------------------------------------
   The same engine on a client-minted seed: no streak, no calendar, a fresh game
   every round, and a mode you can drill on purpose. */
function dxPracticeTally() {
  try { return JSON.parse(localStorage.getItem("gamedex.dexle.practice") || "null") || { played: 0, won: 0 }; }
  catch (_) { return { played: 0, won: 0 }; }
}
function dxBumpPracticeTally(won) {
  const t = dxPracticeTally();
  t.played += 1; if (won) t.won += 1;
  try { localStorage.setItem("gamedex.dexle.practice", JSON.stringify(t)); } catch (_) {}
}

function dxStartPractice() {
  const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const mode = dxPracticeMode;
  fetch(`api/dexle/round?seed=${encodeURIComponent(seed)}&mode=${encodeURIComponent(mode)}`)
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) return;
      DX.practice = { seed, mode };
      DX.date = j.date; DX.mode = j.mode; DX.clue = j.clue; DX.maxGuesses = j.maxGuesses || 6;
      DX.guesses = []; DX.hints = []; DX.done = false; DX.won = false; DX.answer = null;
      DX.loaded = true; DX.failed = false;
      renderDexle();
    })
    .catch(() => {});
}

function dxExitPractice() {
  DX.practice = null;
  DX.loaded = false; DX.failed = false;
  renderDexle();                 // repaints as loading and refetches today's round
}

// Leaving the tab mid-practice: fall back to today's round so Home and the Daily
// page never read practice state as if it were the daily. (Mirrors shelfTeardown.)
function dexleTeardown() {
  if (DX.practice) dxExitPractice();
}

// A Wordle-style receipt: enough to compare the run without naming any guess or the
// answer. Related guesses are yellow, ordinary misses black, deliberate skips white,
// and the winning guess green. The URL always opens Dexle even if the current page has
// a drawer or some other transient query state in it.
function dxShareText() {
  const m = DX_MODES[DX.mode] || { label: DX.mode || "Mystery clue" };
  const score = DX.won ? `${DX.guesses.length} of ${DX.maxGuesses}` : `X of ${DX.maxGuesses}`;
  const trail = DX.guesses.map((g, i) => {
    if (DX.won && i === DX.guesses.length - 1) return "🟩";
    if (!g.title) return "⬜";
    return g.near ? "🟨" : "⬛";
  }).join("");
  return `Dexle ${dailyShareDate(DX.date)} — ${score}\n${m.label}\n${trail}\n${dailyShareUrl("dexle")}`;
}

function dxShareResult() {
  return shareDailyResult("Dexle", dxShareText());
}

function wireDexle(host) {
  const go = host.querySelector("#dxGuessGo");
  if (go) go.onclick = dxSubmit;
  const gi = host.querySelector("#dxGuessIn");
  if (gi) {
    acAttach(gi, pxTitleList);            // the same owned/completed pool as Picross's box
    gi.addEventListener("keydown", (e) => { if (e.key === "Enter") dxSubmit(); });
    // A guess re-renders the whole tab; hand the keyboard straight back so the next
    // guess needs no click. Only when one was just made — not on plain tab opens,
    // where focus would pop the keyboard on a phone.
    if (DX._refocus) { DX._refocus = false; gi.focus(); }
  }
  const skip = host.querySelector("#dxSkip");
  if (skip) skip.onclick = () => dxGuess(null);
  const share = host.querySelector("#dxShare");
  if (share) share.onclick = dxShareResult;
  const open = host.querySelector("#dxOpen");
  if (open) open.onclick = () => {
    const row = (DATA.sheets.games.rows || []).find((r) => r._k === (DX.answer || {}).key);
    if (row) openDrawer(row, "games");
  };

  host.querySelectorAll("[data-dxmode]").forEach((el) => {
    el.onclick = () => { dxPracticeMode = el.dataset.dxmode; renderDexle(); };
  });
  const start = host.querySelector("#dxPracticeGo");
  if (start) start.onclick = dxStartPractice;
  const next = host.querySelector("#dxNextRound");
  if (next) next.onclick = dxStartPractice;
  const back = host.querySelector("#dxBackToday");
  if (back) back.onclick = dxExitPractice;

  const audio = host.querySelector("#dxAudio");
  if (audio) wireDexleTune(host, audio);
}

function dxSubmit() {
  const input = $("#dxGuessIn"), msg = $("#dxMsg");
  const v = (input.value || "").trim();
  if (!v || dxBusy) return;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (DX.guesses.some((g) => g.title && norm(g.title) === norm(v))) {
    msg.textContent = "Already tried that one.";
    msg.className = "px-guess-msg bad";
    input.select();
    return;
  }
  // The verdict is a round trip away; acknowledge the keypress NOW.
  msg.textContent = "Checking…";
  msg.className = "px-guess-msg";
  DX._refocus = true;
  dxGuess(v);
}

let dxBusy = false;             // one guess in flight at a time — Enter mashing must not burn two

async function dxGuess(title) {
  if (DX.done || dxBusy) return;
  dxBusy = true;
  try {
    const body = { title: title || null, n: DX.guesses.length };
    if (DX.practice) { body.seed = DX.practice.seed; body.mode = DX.practice.mode; }
    const r = await fetch("api/dexle/guess", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) return;
    DX.guesses.push({ title: title || null, near: j.near || null });
    if (j.hint) DX.hints.push(j.hint);
    if (j.correct) {
      DX.done = true; DX.won = true; DX.answer = j.answer;
      if (DX.practice) dxBumpPracticeTally(true);
      else await dxBumpStreak();
    } else if (j.done) {
      DX.done = true; DX.won = false; DX.answer = j.answer || null;
      if (DX.practice) dxBumpPracticeTally(false);
    }
    await dxSave();
    renderDexle();
    if (j.correct) dxCelebrate();
  } catch (_) { /* offline: the guess just doesn't land */ }
  finally { dxBusy = false; }
}

// FNV-ish string hash — only used to pick where the cover zoom looks, deterministically.
function dxHash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

async function loadDexle() {
  await dxLoadPrefs();
  try {
    const r = await fetch("api/dexle/daily");
    const j = await r.json();
    if (!j.ok) { DX.failed = true; DX.loaded = true; renderDexle(); return; }
    DX.date = j.date; DX.mode = j.mode; DX.clue = j.clue; DX.maxGuesses = j.maxGuesses || 6;
    DX.loaded = true; DX.failed = false;
    if (!dxLoad()) { DX.guesses = []; DX.hints = []; DX.done = false; DX.won = false; DX.answer = null; }
    else await dxSave();                 // backfill a pre-sync device round to the account
    renderDexle();
    if (activeTab === "daily") renderDaily();
    if (activeTab === "home") patchHomeDaily();
  } catch (_) {
    DX.failed = true; DX.loaded = true; renderDexle();
  }
}

// Home and the landing page need today's state before they can draw a card.
let dxMetaLoaded = false;
async function dexleMetaInit() {
  if (dxMetaLoaded) return;
  dxMetaLoaded = true;
  await dxLoadPrefs();
  try {
    const j = await (await fetch("api/dexle/daily")).json();
    if (!j.ok) { DX.failed = true; DX.loaded = true; return; }
    DX.date = j.date; DX.mode = j.mode; DX.clue = j.clue; DX.maxGuesses = j.maxGuesses || 6;
    DX.loaded = true;
    if (dxLoad()) await dxSave();        // backfill from whichever device is furthest along
    if (activeTab === "home") patchHomeDaily();
    if (activeTab === "daily") renderDaily();
  } catch (_) { /* the card just shows a placeholder */ }
}

function wireDailyHome() {
  const all = document.getElementById("hDailyAll");
  if (all) all.onclick = () => goTab("daily");
  const px = document.getElementById("hPicross");
  if (px) px.onclick = () => goTab("picross");
  const dx = document.getElementById("hDexle");
  if (dx) dx.onclick = () => goTab("dexle");
  const hl = document.getElementById("hHilo");
  if (hl) hl.onclick = () => goTab("hilo");
}

function dailyHomeInit() {
  if (typeof picrossHomeInit === "function") picrossHomeInit();
  dexleMetaInit();
  if (typeof hiloMetaInit === "function") hiloMetaInit();
}

/* Landing state (core.js) — deliberately empty, like Picross's: DX is today's round
   PROGRESS, persisted per day. Clicking into Dexle twice must not eat a guess. */
TAB_RESET.dexle = () => {};
TAB_RESET.daily = () => {};
