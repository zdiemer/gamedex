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
};

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
  try {
    localStorage.setItem(dxKey(), JSON.stringify({
      guesses: DX.guesses, hints: DX.hints, done: DX.done, won: DX.won, answer: DX.answer,
    }));
  } catch (_) { /* private mode: the round just won't survive a reload */ }
};
const dxLoad = () => {
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
  host.innerHTML = `<div class="px-wrap dx-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-dice", 13)} Dexle · ${escapeHtml(DX.date)}</span>
        <h1>Guess the game</h1>
        <p class="muted"><b class="dx-mode">${icon(m.icon, 13)} ${escapeHtml(m.label)}</b>
          — ${escapeHtml(m.blurb)}</p>
      </div>
      <div class="px-streak">
        <b>${dxCurrentStreak()}</b><span>day streak</span>
        <em>best ${st.best || 0} · ${st.solved || 0} solved</em>
      </div>
    </div>

    <div class="dx-clue" id="dxClue">${dxClueHtml()}</div>

    ${DX.done ? dxEndHtml() : `
      <div class="dx-dots">${dxDotsHtml()}</div>
      <div class="px-guess">
        <input id="dxGuessIn" type="text" list="pxTitles" placeholder="Name the game…" autocomplete="off">
        <button class="btn" id="dxGuessGo">Guess</button>
        <button class="btn ghost" id="dxSkip" title="Burn a guess for the next hint">Skip →</button>
        <span class="px-guess-msg" id="dxMsg"></span>
      </div>`}

    ${DX.hints.length ? `<div class="dx-hints">${DX.hints.map((h) =>
      `<span class="dx-hint"><i>${escapeHtml(h.label)}</i>${escapeHtml(h.value)}</span>`).join("")}</div>` : ""}

    ${DX.guesses.length ? `<ol class="dx-log">${DX.guesses.map((g) => `<li>
        <span class="dx-log-t${g.title ? "" : " skip"}">${g.title ? escapeHtml(g.title) : "Skipped"}</span>
        ${g.near ? `<span class="dx-log-near">${escapeHtml(g.near)}</span>` : ""}
      </li>`).join("")}</ol>` : ""}
  </div>`;

  wireDexle(host);
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
      <audio id="dxAudio" preload="none" src="api/dexle/track"></audio>
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
                : `<p class="muted">Tomorrow's another clue.</p>`}
      <button class="btn" id="dxOpen">Open in library</button>
    </div>
  </div>`;
}

function wireDexle(host) {
  const go = host.querySelector("#dxGuessGo");
  if (go) go.onclick = dxSubmit;
  const gi = host.querySelector("#dxGuessIn");
  if (gi) gi.onkeydown = (e) => { if (e.key === "Enter") dxSubmit(); };
  const skip = host.querySelector("#dxSkip");
  if (skip) skip.onclick = () => dxGuess(null);
  const open = host.querySelector("#dxOpen");
  if (open) open.onclick = () => {
    const row = (DATA.sheets.games.rows || []).find((r) => r._k === (DX.answer || {}).key);
    if (row) openDrawer(row, "games");
  };
  if (typeof pxFillTitles === "function") pxFillTitles();   // shares the Picross datalist

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
  if (!v) return;
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (DX.guesses.some((g) => g.title && norm(g.title) === norm(v))) {
    msg.textContent = "Already tried that one.";
    msg.className = "px-guess-msg bad";
    input.select();
    return;
  }
  dxGuess(v);
}

async function dxGuess(title) {
  if (DX.done) return;
  try {
    const r = await fetch("api/dexle/guess", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || null, n: DX.guesses.length }),
    });
    const j = await r.json();
    if (!j.ok) return;
    DX.guesses.push({ title: title || null, near: j.near || null });
    if (j.hint) DX.hints.push(j.hint);
    if (j.correct) {
      DX.done = true; DX.won = true; DX.answer = j.answer;
      await dxBumpStreak();
    } else if (j.done) {
      DX.done = true; DX.won = false; DX.answer = j.answer || null;
    }
    dxSave();
    renderDexle();
    if (j.correct) dxCelebrate();
  } catch (_) { /* offline: the guess just doesn't land */ }
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
    if (activeTab === "home") renderHome();
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
    if (activeTab === "home") renderHome();
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

  host.innerHTML = `<div class="px-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-dice", 13)} Daily games${DX.date || (typeof PX !== "undefined" && PX.date) ? ` · ${escapeHtml(DX.date || PX.date)}` : ""}</span>
        <h1>Two a day</h1>
        <p class="muted">A nonogram cut from your own shelf, and a guessing game cut from
          everything the library knows. Fresh at midnight UTC.</p>
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
    </div>
  </div>`;

  const px = host.querySelector("#dlPicross");
  if (px) px.onclick = () => goTab("picross");
  const dx = host.querySelector("#dlDexle");
  if (dx) dx.onclick = () => goTab("dexle");
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
  return `<section class="h-sect">
    <div class="h-sect-head"><h2>${icon("i-dice", 17)} Daily games</h2>
      <div class="h-sect-act"><button class="linkbtn" id="hDailyAll">Both, one page →</button></div></div>
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
}

function dailyHomeInit() {
  if (typeof picrossHomeInit === "function") picrossHomeInit();
  dexleMetaInit();
}

/* Landing state (core.js) — deliberately empty, like Picross's: DX is today's round
   PROGRESS, persisted per day. Clicking into Dexle twice must not eat a guess. */
TAB_RESET.dexle = () => {};
TAB_RESET.daily = () => {};
