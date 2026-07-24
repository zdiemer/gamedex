"use strict";

/* Hi-Lo — the daily higher-or-lower, run on the library's own numbers.

   One deck a day, dimension rotating with the calendar: Metacritic score, hours to
   beat, release year, copies sold, Steam owners. The current game shows its number;
   the challenger doesn't. Call higher or lower — right extends the run, wrong ends
   it, ties are always right. The values live on the server and arrive one verdict at
   a time, so the deck can't be read ahead.

   The day's run is kept in localStorage (a reload resumes mid-run); the record (best
   run, days played) lives in prefs like the other dailies. Practice decks are seeded
   client-side and touch neither. */

const HL = {
  date: null, dim: null, total: 0,
  cur: null,            // {key,title,platform,year,cover,value} — the open card
  next: null,           // the challenger, value withheld (year too, on year days)
  score: 0, over: false, cleared: false,
  reveal: null,         // {correct, value} while the verdict flash is up
  loaded: false, failed: false,
  practice: null,       // {seed, dim} while a practice deck is up
  busy: false,          // a guess is in flight / the flash is on screen
};
let hlPracticeDim = "any";

const HL_DIMS = {
  metascore: { label: "Metacritic score", icon: "i-stats",
               blurb: "Which one did the critics rate higher?", fmt: (v) => String(v) },
  hltb:      { label: "Hours to beat", icon: "i-clock",
               blurb: "Which one takes longer to finish?", fmt: (v) => `${v} h` },
  year:      { label: "Release year", icon: "i-calendar",
               blurb: "Which one came out later?", fmt: (v) => String(v) },
  units:     { label: "Copies sold", icon: "i-package",
               blurb: "Which one sold more?", fmt: (v) => `${hlBig(v)} sold` },
  owners:    { label: "Steam owners", icon: "i-user",
               blurb: "Which one do more Steam players own?", fmt: (v) => `~${hlBig(v)} owners` },
};
function hlBig(v) {
  if (v >= 1e6) return `${+(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(0)}k`;
  return String(v);
}
const hlFmt = (v) => (HL_DIMS[HL.dim] || { fmt: String }).fmt(v);

// ---- per-day progress (localStorage) ---------------------------------------
const hlKey = () => `hilo:${HL.date}`;
const hlSave = () => {
  if (HL.practice) return;
  try {
    localStorage.setItem(hlKey(), JSON.stringify({
      cur: HL.cur, next: HL.next, score: HL.score, over: HL.over, cleared: HL.cleared,
    }));
  } catch (_) { /* private mode: the run just won't survive a reload */ }
};
const hlLoad = () => {
  if (HL.practice) return false;
  try {
    const s = JSON.parse(localStorage.getItem(hlKey()) || "null");
    if (!s || !s.cur) return false;
    HL.cur = s.cur; HL.next = s.next || null; HL.score = s.score || 0;
    HL.over = !!s.over; HL.cleared = !!s.cleared;
    return true;
  } catch (_) { return false; }
};

/* ---- the record (prefs, like the other dailies' streaks) ------------------- */
let hlPrefs = null;
const HL_LOCAL = "gamedex.hilo";
function hlRecord() {
  if (hlPrefs) return hlPrefs;
  try { hlPrefs = JSON.parse(localStorage.getItem(HL_LOCAL) || "null"); } catch (_) {}
  return (hlPrefs = hlPrefs || { best: 0, played: 0, last: null, lastScore: 0 });
}
async function hlLoadPrefs() {
  try {
    const j = await (await fetch("api/prefs")).json();
    const s = (j.prefs || {}).hilo;
    if (s && typeof s === "object") {
      hlPrefs = s;
      try { localStorage.setItem(HL_LOCAL, JSON.stringify(s)); } catch (_) {}
    }
  } catch (_) { /* offline: the local mirror stands in */ }
}
async function hlBumpRecord(score) {
  const s = { ...hlRecord() };
  if (s.last === HL.date) return s;             // already recorded today
  s.best = Math.max(s.best || 0, score);
  s.played = (s.played || 0) + 1;
  s.last = HL.date; s.lastScore = score;
  hlPrefs = s;
  try { localStorage.setItem(HL_LOCAL, JSON.stringify(s)); } catch (_) {}
  if (typeof IS_ADMIN === "undefined" || IS_ADMIN) {
    try {
      await fetch("api/prefs/hilo", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
      });
    } catch (_) { /* the record is a nicety, never a blocker */ }
  }
  return s;
}
function hlPracticeTally() {
  try { return JSON.parse(localStorage.getItem("gamedex.hilo.practice") || "null") || { played: 0, best: 0 }; }
  catch (_) { return { played: 0, best: 0 }; }
}
function hlBumpPracticeTally(score) {
  const t = hlPracticeTally();
  t.played += 1; t.best = Math.max(t.best, score);
  try { localStorage.setItem("gamedex.hilo.practice", JSON.stringify(t)); } catch (_) {}
}

// ---- render ----------------------------------------------------------------
function renderHilo() {
  const host = $("#hilo");
  if (!host) return;
  if (!HL.loaded && !HL.failed) {
    host.innerHTML = `<div class="px-wrap"><p class="muted">Shuffling today's deck…</p></div>`;
    loadHilo();
    return;
  }
  if (HL.failed || !HL.dim) {
    host.innerHTML = `<div class="px-wrap">${emptyState("No deck today",
      "Couldn't deal a run from the library. It'll try again tomorrow.")}</div>`;
    return;
  }

  const d = HL_DIMS[HL.dim] || { label: HL.dim, icon: "i-trend", blurb: "" };
  const rec = hlRecord();
  const tally = hlPracticeTally();
  host.innerHTML = `<div class="px-wrap hl-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-trend", 13)} Daily Hi-Lo · ${HL.practice ? "endless practice" : escapeHtml(HL.date)}</span>
        <h1>Higher or lower?</h1>
        <p class="muted"><b class="dx-mode">${icon(d.icon, 13)} ${escapeHtml(d.label)}</b>
          — ${escapeHtml(d.blurb)} Ties are on the house.</p>
      </div>
      ${HL.practice ? `<div class="px-streak">
        <b>${tally.best}</b><span>practice best</span>
        <em>${tally.played} deck${tally.played === 1 ? "" : "s"} this device</em>
      </div>` : `<div class="px-streak">
        <b>${rec.best || 0}</b><span>best run</span>
        <em>${rec.played || 0} day${(rec.played || 0) === 1 ? "" : "s"} played</em>
      </div>`}
    </div>

    <div class="hl-score">Run: <b>${HL.score}</b> · deck of ${HL.total}</div>
    <div class="hl-board">
      ${hlCardHtml(HL.cur, true)}
      <div class="hl-vs">vs</div>
      ${HL.next ? hlCardHtml(HL.next, false) : ""}
    </div>
    ${HL.over ? hlEndHtml() : ""}
    ${hlPracticeHtml()}
  </div>`;

  wireHilo(host);
}

function hlCardHtml(g, open) {
  if (!g) return "";
  const cover = g.cover ? IMG(g.cover, "cover_big") : "";
  // On year days the challenger's meta line must not say the answer.
  const meta = [g.platform, g.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  const r = HL.reveal;
  let foot;
  if (open) {
    foot = `<div class="hl-val">${escapeHtml(hlFmt(g.value))}</div>`;
  } else if (r) {
    foot = `<div class="hl-val ${r.correct ? "good" : "bad"}">${escapeHtml(hlFmt(r.value))}</div>`;
  } else if (HL.over) {
    // The run is done; the challenger that ended (or cleared) it keeps its number.
    foot = g.value != null ? `<div class="hl-val ${HL.cleared ? "good" : "bad"}">${escapeHtml(hlFmt(g.value))}</div>` : "";
  } else {
    foot = `<div class="hl-btns">
      <button class="btn" id="hlHigher">▲ Higher</button>
      <button class="btn" id="hlLower">▼ Lower</button>
    </div>`;
  }
  return `<div class="hl-card${open ? " open" : ""}">
    ${cover ? `<img src="${escapeHtml(cover)}" alt="" draggable="false">` : ""}
    <div class="hl-card-b">
      <b>${escapeHtml(String(g.title || ""))}</b>
      <span class="muted">${meta}</span>
      ${foot}
    </div>
  </div>`;
}

function hlEndHtml() {
  const d = HL_DIMS[HL.dim] || { label: HL.dim };
  const rec = hlRecord();
  const best = HL.practice ? hlPracticeTally().best : (rec.best || 0);
  return `<div class="px-win hl-end">
    <div class="px-win-b">
      <span class="h-eyebrow">${HL.cleared ? "Cleared the deck!" : "Run over"}</span>
      <h2>${HL.score} in a row</h2>
      <p class="muted">${HL.cleared
        ? `Every ${escapeHtml(d.label.toLowerCase())} call, correct. There is nothing left to deal.`
        : (HL.practice ? "Another deck is a click away." : "The deck reshuffles at midnight UTC.")}</p>
      ${best ? `<p class="px-bonus">★ Best run: ${best}.</p>` : ""}
    </div>
  </div>`;
}

/* ---- practice ----------------------------------------------------------- */
function hlPracticeHtml() {
  const chips = ["any", ...Object.keys(HL_DIMS)].map((k) => {
    const label = k === "any" ? "Any stat" : HL_DIMS[k].label;
    return `<button class="dx-chip${hlPracticeDim === k ? " on" : ""}" data-hldim="${k}">${escapeHtml(label)}</button>`;
  }).join("");
  if (HL.practice) {
    return `<div class="dx-practice">
      <div class="dx-practice-h"><b>Endless practice</b>
        <span class="muted">Fresh decks, any stat, nothing recorded but your bragging rights.</span></div>
      <div class="dx-chips">${chips}</div>
      <div class="px-guess">
        <button class="btn" id="hlNextDeck">New deck</button>
        <button class="btn ghost" id="hlBackToday">← Back to today's</button>
      </div>
    </div>`;
  }
  return `<div class="dx-practice">
    <div class="dx-practice-h"><b>Endless practice</b>
      <span class="muted">${HL.over ? "Deck's done — deal another." : "Or drill a stat of your choosing."}</span></div>
    <div class="dx-chips">${chips}</div>
    <div class="px-guess"><button class="btn" id="hlPracticeGo">Deal a deck</button></div>
  </div>`;
}

function hlStartPractice() {
  const seed = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const dim = hlPracticeDim;
  fetch(`api/hilo/round?seed=${encodeURIComponent(seed)}&dim=${encodeURIComponent(dim)}`)
    .then((r) => r.json())
    .then((j) => {
      if (!j.ok) return;
      HL.practice = { seed, dim };
      hlAdopt(j);
      renderHilo();
    })
    .catch(() => {});
}
function hlExitPractice() {
  HL.practice = null;
  HL.loaded = false; HL.failed = false;
  renderHilo();                  // repaints as loading and refetches today's deck
}
// Leaving the tab mid-practice: fall back to today's deck (mirrors dexleTeardown).
function hiloTeardown() {
  if (HL.practice) hlExitPractice();
}

function hlAdopt(j) {
  HL.date = j.date; HL.dim = j.dim; HL.total = j.total;
  HL.cur = j.first; HL.next = j.next;
  HL.score = 0; HL.over = false; HL.cleared = false; HL.reveal = null; HL.busy = false;
  HL.loaded = true; HL.failed = false;
}

// ---- gameplay --------------------------------------------------------------
function wireHilo(host) {
  const hi = host.querySelector("#hlHigher");
  if (hi) hi.onclick = () => hlGuess("higher");
  const lo = host.querySelector("#hlLower");
  if (lo) lo.onclick = () => hlGuess("lower");
  host.querySelectorAll("[data-hldim]").forEach((el) => {
    el.onclick = () => { hlPracticeDim = el.dataset.hldim; renderHilo(); };
  });
  const start = host.querySelector("#hlPracticeGo");
  if (start) start.onclick = hlStartPractice;
  const next = host.querySelector("#hlNextDeck");
  if (next) next.onclick = hlStartPractice;
  const back = host.querySelector("#hlBackToday");
  if (back) back.onclick = hlExitPractice;
}

async function hlGuess(dir) {
  if (HL.over || HL.busy || !HL.next) return;
  HL.busy = true;
  try {
    const body = { n: HL.score, dir };
    if (HL.practice) { body.seed = HL.practice.seed; body.dim = HL.practice.dim; }
    const r = await fetch("api/hilo/guess", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { HL.busy = false; return; }

    // Flash the challenger's number first; the board moves after a beat.
    HL.reveal = { correct: j.correct, value: j.value };
    renderHilo();
    setTimeout(async () => {
      HL.reveal = null;
      if (j.correct && !j.cleared) {
        const promoted = { ...HL.next, value: j.value };
        if (HL.dim === "year") promoted.year = j.value;
        HL.cur = promoted; HL.next = j.next || null;
        HL.score = j.score;
      } else {
        // Run over — the challenger that ended (or cleared) it keeps its number showing.
        const landed = { ...HL.next, value: j.value };
        if (HL.dim === "year") landed.year = j.value;
        HL.next = landed;
        HL.over = true; HL.cleared = !!j.cleared; HL.score = j.score;
        if (HL.practice) hlBumpPracticeTally(j.score);
        else await hlBumpRecord(j.score);
        if (j.cleared) hlCelebrate();
      }
      HL.busy = false;
      hlSave();
      renderHilo();
      if (activeTab === "daily") renderDaily();
    }, j.correct ? 700 : 1200);
    hlSave();
  } catch (_) { HL.busy = false; }
}

function hlCelebrate() {
  const host = $("#hilo");
  if (!host || !WANTS_MOTION) return;
  const box = document.createElement("div");
  box.className = "px-confetti";
  box.innerHTML = Array.from({ length: 40 }, () =>
    `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg"></i>`).join("");
  host.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}

// ---- loading ---------------------------------------------------------------
async function loadHilo() {
  await hlLoadPrefs();
  try {
    const r = await fetch("api/hilo/daily");
    const j = await r.json();
    if (!j.ok) { HL.failed = true; HL.loaded = true; renderHilo(); return; }
    hlAdopt(j);
    hlLoad();                    // a half-run day resumes where it stood
    renderHilo();
    if (activeTab === "daily") renderDaily();
    if (activeTab === "home") renderHome();
  } catch (_) {
    HL.failed = true; HL.loaded = true; renderHilo();
  }
}

let hlMetaLoaded = false;
async function hiloMetaInit() {
  if (hlMetaLoaded) return;
  hlMetaLoaded = true;
  await hlLoadPrefs();
  try {
    const j = await (await fetch("api/hilo/daily")).json();
    if (!j.ok) { HL.failed = true; HL.loaded = true; return; }
    hlAdopt(j);
    hlLoad();
    if (activeTab === "home") renderHome();
    if (activeTab === "daily") renderDaily();
  } catch (_) { /* the card just shows a placeholder */ }
}

/* Landing state (core.js) — deliberately empty, like the other dailies: HL is today's
   RUN, persisted per day. Clicking in twice must not reshuffle a live run. */
TAB_RESET.hilo = () => {};
