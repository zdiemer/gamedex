"use strict";

/* Dexle — the daily guess-the-game. Six guesses, and a different kind of clue
   depending on the day (the server rotates them): the cover zoomed in far too close,
   a screenshot behind frosted glass, the IGDB blurb with the names blacked out, my
   own review censored the same way, or a track off the soundtrack.

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
  review:  { label: "In My Own Words", icon: "i-edit",
             blurb: "My own review of it, censored. Every miss reveals another line." },
  ost:     { label: "Name That Tune",  icon: "i-music",
             blurb: "A track from its soundtrack. Every miss buys a longer listen." },
};

// Per-mode reveal ladders, indexed by how many guesses you've burned.
const DX_ZOOM = [7, 5, 3.6, 2.6, 1.9, 1.4];
const DX_BLUR = [26, 18, 12, 8, 4, 2];
const DX_CLIP = [8, 15, 25, 40, 60, Infinity];

const dxStage = () => Math.min(DX.guesses.length, DX.maxGuesses - 1);

// ---- per-day progress (localStorage) ---------------------------------------
const dxKey = () => `dexle:${DX.date}`;
const dxSave = () => {
  if (DX.practice) return;        // a practice round is disposable by design
  try {
    localStorage.setItem(dxKey(), JSON.stringify({
      guesses: DX.guesses, hints: DX.hints, done: DX.done, won: DX.won, answer: DX.answer,
    }));
  } catch (_) { /* private mode: the round just won't survive a reload */ }
};
const dxLoad = () => {
  if (DX.practice) return false;
  try {
    const s = JSON.parse(localStorage.getItem(dxKey()) || "null");
    if (!s || !Array.isArray(s.guesses)) return false;
    DX.guesses = s.guesses; DX.hints = Array.isArray(s.hints) ? s.hints : [];
    DX.done = !!s.done; DX.won = !!s.won; DX.answer = s.answer || null;
    return true;
  } catch (_) { return false; }
};

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
    const s = (j.prefs || {}).dexle;
    if (s && typeof s === "object") {
      dxPrefs = s;
      try { localStorage.setItem(DX_LOCAL, JSON.stringify(s)); } catch (_) {}
    }
  } catch (_) { /* offline: the local mirror stands in */ }
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

// ---- render ----------------------------------------------------------------
function renderDexle() {
  const host = $("#dexle");
  if (!host) return;
  if (!DX.loaded && !DX.failed) {
    host.innerHTML = `<div class="px-wrap"><p class="muted">Loading today's game…</p></div>`;
    loadDexle();
    return;
  }
  if (DX.failed || !DX.mode) {
    host.innerHTML = `<div class="px-wrap">${emptyState("No round today",
      "Couldn't cut a puzzle from the library. It'll try again tomorrow.")}</div>`;
    return;
  }

  const m = DX_MODES[DX.mode] || { label: DX.mode, icon: "i-dice", blurb: "" };
  const st = dxStreak();
  const tally = dxPracticeTally();
  host.innerHTML = `<div class="px-wrap dx-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-dice", 13)} Dexle · ${DX.practice ? "endless practice" : escapeHtml(DX.date)}</span>
        <h1>Guess the game</h1>
        <p class="muted"><b class="dx-mode">${icon(m.icon, 13)} ${escapeHtml(m.label)}</b>
          — ${escapeHtml(m.blurb)}</p>
      </div>
      ${DX.practice ? `<div class="px-streak">
        <b>${tally.won}</b><span>practice wins</span>
        <em>${tally.played} round${tally.played === 1 ? "" : "s"} this device</em>
      </div>` : `<div class="px-streak">
        <b>${dxCurrentStreak()}</b><span>day streak</span>
        <em>best ${st.best || 0} · ${st.solved || 0} solved</em>
      </div>`}
    </div>

    <div class="dx-clue" id="dxClue">${dxClueHtml()}</div>

    ${DX.done ? dxEndHtml() : `
      <div class="dx-dots">${dxDotsHtml()}</div>
      <div class="px-guess">
        <span class="ac-wrap"><input id="dxGuessIn" type="text" placeholder="Name the game…" autocomplete="off"></span>
        <button class="btn" id="dxGuessGo">Guess</button>
        <button class="btn ghost" id="dxSkip" title="Burn a guess for the next hint">Skip →</button>
        <span class="px-guess-msg" id="dxMsg"></span>
      </div>`}

    ${DX.hints.length ? `<div class="dx-hints">${DX.hints.map((h) =>
      `<span class="dx-hint"><i>${escapeHtml(h.label)}</i>${escapeHtml(h.value)}</span>`).join("")}</div>` : ""}

    ${DX.guesses.length ? `<ol class="dx-log">${DX.guesses.map((g, i) => `<li>
        <span class="dx-log-t${!g.title ? " skip" : (DX.won && i === DX.guesses.length - 1) ? " hit" : ""}">${g.title ? escapeHtml(g.title) : "Skipped"}</span>
        ${g.near ? `<span class="dx-log-near">${escapeHtml(g.near)}</span>` : ""}
      </li>`).join("")}</ol>` : ""}

    ${dxPracticeHtml()}
  </div>`;

  wireDexle(host);
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

function dxPracticeHtml() {
  const chips = ["any", ...Object.keys(DX_MODES)].map((k) => {
    const label = k === "any" ? "Any clue" : DX_MODES[k].label;
    return `<button class="dx-chip${dxPracticeMode === k ? " on" : ""}" data-dxmode="${k}">${escapeHtml(label)}</button>`;
  }).join("");
  if (DX.practice) {
    return `<div class="dx-practice">
      <div class="dx-practice-h"><b>Endless practice</b>
        <span class="muted">No streak, no stakes — a fresh game every round.</span></div>
      <div class="dx-chips">${chips}</div>
      <div class="px-guess">
        <button class="btn" id="dxNextRound">Next round</button>
        <button class="btn ghost" id="dxBackToday">← Back to today's</button>
      </div>
    </div>`;
  }
  return `<div class="dx-practice">
    <div class="dx-practice-h"><b>Endless practice</b>
      <span class="muted">${DX.done ? "Still warm? Keep going —" : "Done already, or just warming up?"}
        a fresh game every round, no streak on the line.</span></div>
    <div class="dx-chips">${chips}</div>
    <div class="px-guess"><button class="btn" id="dxPracticeGo">Start a round</button></div>
  </div>`;
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

function dxClueHtml() {
  const stage = DX.done ? DX.maxGuesses - 1 : dxStage();
  const c = DX.clue || {};
  if (DX.mode === "cover") {
    const src = IMG(c.cover, "cover_big");
    // Where the zoom looks is the date's business, not mine — same crop for everyone.
    const ox = 25 + (dxHash(DX.date) % 51), oy = 18 + (dxHash(DX.date + "y") % 48);
    const scale = DX.done ? 1 : DX_ZOOM[stage];
    return `<div class="dx-frame dx-cover${DX.done ? " done" : ""}">
      <img src="${escapeHtml(src)}" alt="" draggable="false"
        style="transform:scale(${scale});transform-origin:${ox}% ${oy}%">
    </div>`;
  }
  if (DX.mode === "shot") {
    const src = IMG(c.shot, "screenshot_big");
    const blur = DX.done ? 0 : DX_BLUR[stage];
    return `<div class="dx-frame dx-shot">
      <img src="${escapeHtml(src)}" alt="" draggable="false" style="filter:blur(${blur}px)">
    </div>`;
  }
  if (DX.mode === "summary" || DX.mode === "review") {
    const sents = c.sentences || [];
    const shown = DX.done ? sents.length : Math.min(sents.length, stage + 1);
    const held = sents.length - shown;
    return `<blockquote class="dx-prose">
      ${sents.slice(0, shown).map((s) => `<p>${dxRedact(s)}</p>`).join("")}
      ${held > 0 ? `<p class="dx-held muted">… ${held} more sentence${held === 1 ? "" : "s"} behind your next miss.</p>` : ""}
      ${DX.mode === "review" && c.rating != null
        ? `<footer class="muted">— me. I gave it ${Math.round(c.rating * 100)}%.</footer>` : ""}
    </blockquote>`;
  }
  if (DX.mode === "ost") {
    const limit = DX.done ? Infinity : DX_CLIP[stage];
    const label = limit === Infinity ? "the whole track" : `the first ${limit} seconds`;
    return `<div class="dx-tune">
      <button class="btn dx-play" id="dxPlay">${icon("i-play", 15)} <span>Play</span></button>
      <div class="dx-tune-b">
        <div class="dx-tunebar"><i id="dxTuneFill"></i></div>
        <span class="muted" id="dxTuneMsg">You've unlocked ${label}${c.track && c.track.dur ? ` of ${escapeHtml(c.track.dur)}` : ""}.</span>
      </div>
      <audio id="dxAudio" preload="none" src="api/dexle/track${DX.practice
        ? `?seed=${encodeURIComponent(DX.practice.seed)}&mode=${encodeURIComponent(DX.practice.mode)}` : ""}"></audio>
    </div>`;
  }
  return "";
}

// The server censors with ▇▇▇; wrap the blocks so they read as redaction bars, not tofu.
function dxRedact(s) {
  return escapeHtml(s).replace(/▇+/g, `<span class="dx-redact">&#9608;&#9608;&#9608;</span>`);
}

function dxDotsHtml() {
  return Array.from({ length: DX.maxGuesses }, (_, i) => {
    const g = DX.guesses[i];
    const won = DX.won && i === DX.guesses.length - 1;   // the last guess was the right one
    const cls = !g ? "" : won ? " hit" : g.title ? " miss" : " skip";
    return `<i class="dx-dot${cls}"></i>`;
  }).join("");
}

function dxEndHtml() {
  const g = DX.answer || {};
  const cs = g.cover ? IMG(g.cover, "cover_big") : "";
  const tries = DX.guesses.filter((x) => x.title).length;
  return `<div class="px-win">
    ${cs ? `<img src="${escapeHtml(cs)}" alt="">` : ""}
    <div class="px-win-b">
      <span class="h-eyebrow">${DX.won ? (tries <= 1 ? "First try!" : "Got it") : "Out of guesses"}</span>
      <h2>${escapeHtml(String(g.title || ""))}</h2>
      <p class="muted">${[g.platform, g.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")}</p>
      ${DX.won ? `<p class="px-bonus">★ Named it in ${DX.guesses.length} guess${DX.guesses.length === 1 ? "" : "es"}.</p>`
                : `<p class="muted">${DX.practice ? "The next round costs nothing." : "Tomorrow's another clue."}</p>`}
      <button class="btn" id="dxOpen">Open in library</button>
    </div>
  </div>`;
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

/* The listen limit is enforced here: the <audio> src is the indirect /api/dexle/track (no
   album name anywhere), and playback snaps back to the start when it hits the stage's cap. */
function wireDexleTune(host, audio) {
  const play = host.querySelector("#dxPlay");
  const fill = host.querySelector("#dxTuneFill");
  const limit = () => (DX.done ? Infinity : DX_CLIP[dxStage()]);
  play.onclick = () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); };
  const setBtn = () => {
    play.innerHTML = `${icon(audio.paused ? "i-play" : "i-pause", 15)} <span>${audio.paused ? "Play" : "Pause"}</span>`;
  };
  audio.onplay = setBtn; audio.onpause = setBtn;
  audio.ontimeupdate = () => {
    const cap = Math.min(limit(), audio.duration || Infinity);
    if (audio.currentTime >= limit()) { audio.pause(); audio.currentTime = 0; }
    if (fill && isFinite(cap) && cap > 0) fill.style.width = `${Math.min(100, (audio.currentTime / cap) * 100)}%`;
  };
  audio.onerror = () => {
    const msg = host.querySelector("#dxTuneMsg");
    if (msg) msg.textContent = "The track wouldn't load — try again in a moment.";
  };
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
    dxSave();
    renderDexle();
    if (j.correct) dxCelebrate();
  } catch (_) { /* offline: the guess just doesn't land */ }
  finally { dxBusy = false; }
}

// Same small shower the Picross throws; same class, same CSS.
function dxCelebrate() {
  const host = $("#dexle");
  if (!host || !WANTS_MOTION) return;
  const box = document.createElement("div");
  box.className = "px-confetti";
  box.innerHTML = Array.from({ length: 40 }, () =>
    `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg"></i>`).join("");
  host.appendChild(box);
  setTimeout(() => box.remove(), 2600);
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
    dxLoad();
    if (activeTab === "home") patchHomeDaily();
    if (activeTab === "daily") renderDaily();
  } catch (_) { /* the card just shows a placeholder */ }
}

/* ---- the Daily games landing page ------------------------------------------
   One page for the whole morning ritual: the Picross and the Dexle side by side,
   each with its state and streak. Reached from Home, the palette, or ?tab=daily. */
function renderDaily() {
  const host = $("#daily");
  if (!host) return;
  if (typeof picrossHomeInit === "function") picrossHomeInit();
  dexleMetaInit();
  if (typeof hiloMetaInit === "function") hiloMetaInit();

  const pxDone = typeof PX !== "undefined" && PX.solved;
  const pxStarted = typeof PX !== "undefined" && (PX.cells || []).some((c) => c === 1);
  const pxLine = pxDone
    ? `Solved! It was <b>${escapeHtml(String((PX.game || {}).title || "…"))}</b>`
    : pxStarted ? "Half drawn. Finish it." : "A cover from your shelf, hidden in a grid.";
  const pxMini = (typeof PX !== "undefined" && PX.w)
    ? `<span class="px-mini" style="--w:${PX.w}">${PX.cells.map((c) =>
        `<i class="${c === 1 ? "on" : ""}"></i>`).join("")}</span>`
    : `<span class="px-mini px-mini-ph"></span>`;

  const m = DX.mode ? (DX_MODES[DX.mode] || { label: DX.mode, icon: "i-dice" }) : null;
  const dxLine = DX.done
    ? (DX.won ? `Got it — <b>${escapeHtml(String((DX.answer || {}).title || "…"))}</b>` : "Out of guesses. Tomorrow's another clue.")
    : DX.guesses.length ? `${DX.maxGuesses - DX.guesses.length} guess${DX.maxGuesses - DX.guesses.length === 1 ? "" : "es"} left.`
    : m ? `Today's clue: ${m.label}.` : "Six guesses, one game a day.";

  const hd = (typeof HL !== "undefined" && HL.dim && typeof HL_DIMS !== "undefined")
    ? (HL_DIMS[HL.dim] || { label: HL.dim, icon: "i-trend" }) : null;
  const hlDone = typeof HL !== "undefined" && HL.over;
  const hlLine = typeof HL === "undefined" ? "Call the numbers."
    : HL.over ? (HL.cleared ? `Cleared the deck — <b>${HL.score} in a row</b>` : `Run of <b>${HL.score}</b> today.`)
    : HL.score ? `${HL.score} in a row and counting.`
    : hd ? `Today's stat: ${hd.label}.` : "Higher or lower, one stat a day.";
  const hlRec = typeof hlRecord === "function" ? hlRecord() : { best: 0 };

  host.innerHTML = `<div class="px-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-dice", 13)} Daily games${DX.date || (typeof PX !== "undefined" && PX.date) ? ` · ${escapeHtml(DX.date || PX.date)}` : ""}</span>
        <h1>Three a day</h1>
        <p class="muted">A nonogram cut from your own shelf, a guessing game cut from
          everything the library knows, and a higher-or-lower run on its numbers.
          Fresh at midnight UTC.</p>
      </div>
    </div>
    <div class="dl-cards">
      <button class="dl-card${pxDone ? " done" : ""}" id="dlPicross">
        ${pxMini}
        <span class="dl-card-b">
          <b>${icon("i-target", 15)} Daily Picross</b>
          <span class="muted">${pxLine}</span>
        </span>
        <span class="px-home-s"><b>${typeof pxCurrentStreak === "function" ? pxCurrentStreak() : 0}</b><i>day streak</i></span>
        <span class="gr-go">→</span>
      </button>
      <button class="dl-card${DX.done ? " done" : ""}" id="dlDexle">
        <span class="dl-dexle-mini">${m ? icon(m.icon, 26) : icon("i-dice", 26)}
          <em>${m ? escapeHtml(m.label) : "…"}</em>
          <span class="dx-dots">${dxDotsHtml()}</span></span>
        <span class="dl-card-b">
          <b>${icon("i-dice", 15)} Dexle</b>
          <span class="muted">${dxLine}</span>
        </span>
        <span class="px-home-s"><b>${dxCurrentStreak()}</b><i>day streak</i></span>
        <span class="gr-go">→</span>
      </button>
      <button class="dl-card${hlDone ? " done" : ""}" id="dlHilo">
        <span class="dl-dexle-mini">${hd ? icon(hd.icon, 26) : icon("i-trend", 26)}
          <em>${hd ? escapeHtml(hd.label) : "…"}</em></span>
        <span class="dl-card-b">
          <b>${icon("i-trend", 15)} Daily Hi-Lo</b>
          <span class="muted">${hlLine}</span>
        </span>
        <span class="px-home-s"><b>${hlRec.best || 0}</b><i>best run</i></span>
        <span class="gr-go">→</span>
      </button>
    </div>
  </div>`;

  const px = host.querySelector("#dlPicross");
  if (px) px.onclick = () => goTab("picross");
  const dx = host.querySelector("#dlDexle");
  if (dx) dx.onclick = () => goTab("dexle");
  const hl = host.querySelector("#dlHilo");
  if (hl) hl.onclick = () => goTab("hilo");
}

/* ---- the way in from Home ---------------------------------------------------
   The old single Picross card, grown into the daily pair. Each half goes straight to
   its game; the section header link goes to the landing page. */
function dailyHomeCardHtml() {
  const pxDone = typeof PX !== "undefined" && PX.solved;
  const m = DX.mode ? (DX_MODES[DX.mode] || { label: DX.mode, icon: "i-dice" }) : null;
  const pxMini = (typeof PX !== "undefined" && PX.w)
    ? `<span class="px-mini" style="--w:${PX.w}">${PX.cells.map((c) =>
        `<i class="${c === 1 ? "on" : ""}"></i>`).join("")}</span>`
    : `<span class="px-mini px-mini-ph"></span>`;
  const pxLine = pxDone ? "Done for today" : "Draw the box art";
  const dxLine = DX.done ? (DX.won ? "Got it today" : "Out of guesses")
    : DX.guesses.length ? `${DX.guesses.length}/${DX.maxGuesses} guesses in`
    : m ? `Today: ${m.label}` : "Guess the game";
  const hd = (typeof HL !== "undefined" && HL.dim && typeof HL_DIMS !== "undefined")
    ? (HL_DIMS[HL.dim] || { label: HL.dim, icon: "i-trend" }) : null;
  const hlDone = typeof HL !== "undefined" && HL.over;
  const hlLine = hlDone ? `Run of ${HL.score} today`
    : (typeof HL !== "undefined" && HL.score) ? `${HL.score} in a row, live`
    : hd ? `Today: ${hd.label}` : "Higher or lower";
  const hlRec = typeof hlRecord === "function" ? hlRecord() : { best: 0 };
  return `<section class="h-sect">
    <div class="h-sect-head"><h2>${icon("i-dice", 17)} Daily games</h2>
      <div class="h-sect-act"><button class="linkbtn" id="hDailyAll">All three, one page →</button></div></div>
    <div class="dl-home">
      <button class="px-home${pxDone ? " done" : ""}" id="hPicross">
        ${pxMini}
        <span class="px-home-b">
          <b>Daily Picross</b>
          <span class="muted">${pxLine}</span>
        </span>
        <span class="px-home-s"><b>${typeof pxCurrentStreak === "function" ? pxCurrentStreak() : 0}</b><i>day streak</i></span>
        <span class="gr-go">→</span>
      </button>
      <button class="px-home${DX.done ? " done" : ""}" id="hDexle">
        <span class="dl-dexle-mini">${m ? icon(m.icon, 26) : icon("i-dice", 26)}
          <em>${m ? escapeHtml(m.label) : "…"}</em></span>
        <span class="px-home-b">
          <b>Dexle</b>
          <span class="muted">${dxLine}</span>
        </span>
        <span class="px-home-s"><b>${dxCurrentStreak()}</b><i>day streak</i></span>
        <span class="gr-go">→</span>
      </button>
      <button class="px-home${hlDone ? " done" : ""}" id="hHilo">
        <span class="dl-dexle-mini">${hd ? icon(hd.icon, 26) : icon("i-trend", 26)}
          <em>${hd ? escapeHtml(hd.label) : "…"}</em></span>
        <span class="px-home-b">
          <b>Daily Hi-Lo</b>
          <span class="muted">${hlLine}</span>
        </span>
        <span class="px-home-s"><b>${hlRec.best || 0}</b><i>best run</i></span>
        <span class="gr-go">→</span>
      </button>
    </div>
  </section>`;
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
