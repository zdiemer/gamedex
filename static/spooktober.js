"use strict";

/* Spooktober — the first seasonal event.

   Two pieces that share one state file:
     - a banner on Home, black and orange, that only exists while the season is on;
     - an event page (?tab=spooktober) where you build a 31-night horror calendar —
       one game per night of October, chosen from the horror games in the collection.

   The calendar is a PLAN, not a puzzle: there is no answer, no streak and nothing to
   lose by changing your mind in the middle of October. So it saves the way prefs save
   (picross.js set the precedent): localStorage always, the server too when you're the
   account owner. A signed-out visitor gets a calendar that lives in their browser and
   works offline; signed in, it follows you between devices.

   Season: September 9 → November 7, inclusive, every year. The calendar it builds is
   October only — the tail into November is there so you can still look at what you
   planned (and what you actually got through) after the 31st. */

// Month indexes, because Date's are 0-based and a bare 8 in a comparison is a trap.
const SPOOK_START = { m: 8, d: 9 };    // Sep 9
const SPOOK_END = { m: 10, d: 7 };     // Nov 7
const SPOOK_NIGHTS = 31;               // October

const SPOOK = {
  cal: null,          // { "<year>": { "<day>": matchKey } } — every year you've ever planned
  picking: null,      // the night the picker is choosing for, or null
  q: "",              // the picker's search box
  loaded: false,      // the server's copy has landed (or failed) at least once
};

/* ---- the season ----------------------------------------------------------- */

const spookToday = () => new Date();

// Inside the window, for any year. Compared as (month, day) pairs rather than by
// building two Dates, so the same test works in every year without constructing one.
function spookInSeason(d = spookToday()) {
  const m = d.getMonth(), day = d.getDate();
  if (m < SPOOK_START.m || m > SPOOK_END.m) return false;
  if (m === SPOOK_START.m) return day >= SPOOK_START.d;
  if (m === SPOOK_END.m) return day <= SPOOK_END.d;
  return true;
}

/* The year whose October this calendar belongs to. The season never straddles New Year
   (Sep → Nov), so it is simply the current year — but going through a function means the
   whole file asks the question one way, and a season that ever moves has one place to fix. */
const spookYear = (d = spookToday()) => d.getFullYear();

/* Where in the season we are. The banner and the page both lead with this, and it is the
   only reason either of them says anything different on October 12th than on September 20th.
     before — the calendar is a plan you're still writing
     during — night N is tonight
     after  — October is over; what's left is the record of what you planned */
function spookPhase(d = spookToday()) {
  const m = d.getMonth();
  if (m < 9) {
    const oct1 = new Date(d.getFullYear(), 9, 1);
    // Midnight-to-midnight, so "13 nights to go" doesn't tick down mid-afternoon.
    const days = Math.round((oct1 - new Date(d.getFullYear(), m, d.getDate())) / 86400000);
    return { phase: "before", days };
  }
  if (m === 9) return { phase: "during", day: d.getDate() };
  return { phase: "after", days: d.getDate() };
}

/* ---- storage --------------------------------------------------------------
   Object-shaped, so it does its own small load rather than bending prefsSave/prefsLocal
   (extras.js), which are array-shaped and migrate arrays on boot. Same arrangement the
   picross streak uses, and the same reason. */
const SPOOK_LOCAL = "gamedex.spooktober";
const SPOOK_KEEP_YEARS = 5;      // past Octobers are worth keeping; ten of them are not

function spookCalAll() {
  if (SPOOK.cal) return SPOOK.cal;
  try { SPOOK.cal = JSON.parse(localStorage.getItem(SPOOK_LOCAL) || "null"); } catch (_) {}
  if (!SPOOK.cal || typeof SPOOK.cal !== "object" || Array.isArray(SPOOK.cal)) SPOOK.cal = {};
  return SPOOK.cal;
}

// This year's nights, as { day: matchKey }. Created lazily: an empty year should not be
// written to the server just because someone opened the page.
const spookCal = () => spookCalAll()[String(spookYear())] || {};

function spookPrune(all) {
  const years = Object.keys(all).sort();
  for (const y of years.slice(0, Math.max(0, years.length - SPOOK_KEEP_YEARS))) delete all[y];
  return all;
}

async function spookSave() {
  const all = spookPrune(spookCalAll());
  try { localStorage.setItem(SPOOK_LOCAL, JSON.stringify(all)); } catch (_) { /* private mode */ }
  // Signed out, the server refuses the write (prefs are admin-only, by design). Their
  // calendar is real, it just lives in this browser — don't attempt a write to apologise for.
  if (typeof IS_ADMIN !== "undefined" && !IS_ADMIN) return;
  try {
    const r = await fetch("api/prefs/spooktober", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(all),
    });
    if (!r.ok) throw new Error(await r.text());
  } catch (_) {
    if (typeof showToast === "function") showToast("Saved on this device, couldn't reach the server");
  }
}

/* On boot (and on first visit to the page): the server's copy wins per NIGHT, not per
   calendar. Merging night-by-night means a calendar half-built on the phone and half on
   the desktop ends up whole, instead of whichever device saved last winning outright. */
async function spookLoadPrefs() {
  if (SPOOK.loaded) return;
  SPOOK.loaded = true;
  // Signed out there is nothing up there to merge — /api/prefs answers {} to the public on
  // purpose — and boot already spends one request on it (loadPrefs, extras.js). Don't spend
  // a second one to be told the same thing.
  if (typeof IS_ADMIN !== "undefined" && !IS_ADMIN) return;
  let remote = null;
  try {
    const j = await (await fetch("api/prefs")).json();
    remote = (j.prefs || {}).spooktober;
  } catch (_) { return; }        // offline: the local mirror stands in
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) return;
  const all = spookCalAll();
  let changed = false;
  for (const [year, nights] of Object.entries(remote)) {
    if (!nights || typeof nights !== "object") continue;
    const mine = all[year] || (all[year] = {});
    for (const [day, key] of Object.entries(nights)) {
      if (!(day in mine)) { mine[day] = key; changed = true; }
    }
  }
  try { localStorage.setItem(SPOOK_LOCAL, JSON.stringify(all)); } catch (_) {}
  if (changed && activeTab === "spooktober") renderSpooktober();
  else if (changed && activeTab === "home" && typeof patchSpookBanner === "function") patchSpookBanner();
}

function spookSet(day, key) {
  const all = spookCalAll();
  const y = String(spookYear());
  const nights = all[y] || (all[y] = {});
  // A game can only hold one night. Assigning it again moves it rather than cloning it —
  // 31 nights of the same game is never what you meant, and the picker marks it as taken.
  for (const [d, k] of Object.entries(nights)) if (k === key) delete nights[d];
  nights[String(day)] = key;
  spookSave();
}

function spookClearDay(day) {
  const nights = spookCalAll()[String(spookYear())];
  if (nights) delete nights[String(day)];
  spookSave();
}

function spookClearAll() {
  spookCalAll()[String(spookYear())] = {};
  spookSave();
}

/* ---- what counts as a horror game -----------------------------------------
   Three rungs, cheapest first:
     1. the sheet's own genre — "Survival Horror" is a column I actually keep, and it is
        the most reliable signal in the collection (442 rows);
     2. IGDB's Horror THEME, which is the tag that catches everything the sheet files under
        its mechanics: Bloodborne is an Action RPG, Luigi's Mansion is a puzzle game, and
        both are horror-themed (1,426 rows);
     3. a keyword list of NAMED HORROR SUBGENRES, for the handful IGDB tagged by subject
        but never themed — ECHO, OneShot, SKALD: Against the Black Priory.
   Rung 2 needs an IGDB match to be trustworthy: a fallback match fills `themes` with free
   text from whatever site answered, same reason unifiedGenreVals ignores it (data.js).

   Rung 3 is a list of SUBGENRES, never of spooky nouns, and that distinction is the whole
   lesson of this function. Measured against the live collection, the obvious noun list put
   Mario Kart DS and Animal Crossing: City Folk on the calendar: IGDB tags "ghosts" on
   anything with a ghost in it (+226 games), "gore" catches Super Meat Boy, "demon" catches
   Divinity, "zombies" catches Call of Duty, and "halloween" catches every game that has
   ever run an October event. A creature or a season says what is IN a game; a subgenre says
   what the game IS, and only the second is safe to trust with no theme behind it. The six
   below add ~19 games and every one of them belongs. */
const SPOOK_KEYWORDS = new Set([
  "survival horror", "psychological horror", "cosmic horror", "body horror",
  "lovecraftian", "slasher",
]);

function spookIsHorror(row) {
  if (/horror/i.test(String(row.genre || ""))) return true;
  const e = (typeof ENRICH !== "undefined" && ENRICH[row._k]) || null;
  if (!e || !e.igdbId) return false;
  if ((e.themes || []).some((t) => /horror/i.test(String(t)))) return true;
  return (e.keywords || []).some((k) => SPOOK_KEYWORDS.has(String(k).toLowerCase()));
}

/* Eligible games, grouped the way every other listing groups them (one card per game, not
   one per platform you own it on). Cached against the enrichment epoch: rung 2 and 3 read
   ENRICH, so the pool genuinely changes as enrichment lands, but re-walking 14.9k rows on
   every keystroke in the picker is not the way to notice. */
let _spookPool = null, _spookPoolAt = -1;
function spookPool() {
  if (_spookPool && _spookPoolAt === _enrichEpoch) return _spookPool;
  const rows = ((DATA.sheets.games || {}).rows || []).filter((r) => r.title && spookIsHorror(r));
  _spookPoolAt = _enrichEpoch;
  return (_spookPool = typeof groupByGame === "function" ? groupByGame(rows) : rows);
}

const spookRowFor = (key) => spookPool().find((r) => String(r._k || "") === String(key)) || null;

// The nights, in order, as [day, row|null]. One pass over the pool rather than 31 lookups.
function spookNights() {
  const nights = spookCal();
  const want = new Set(Object.values(nights).map(String));
  const by = new Map();
  if (want.size) for (const r of spookPool()) { const k = String(r._k || ""); if (want.has(k)) by.set(k, r); }
  const out = [];
  for (let d = 1; d <= SPOOK_NIGHTS; d++) out.push([d, by.get(String(nights[String(d)] ?? "")) || null]);
  return out;
}

const spookFilled = () => spookNights().filter(([, r]) => r).length;

/* ---- the banner (Home) -----------------------------------------------------
   The decoration is real markup rather than a background image: the brief is that the
   icons LIFT on hover, and you cannot lift part of a background. Each one carries its own
   --x/--y/--r/--lift/--d so the CSS holds one rule and the placement lives here, where
   you can see the whole arrangement at once. */
const SPOOK_DECO = [
  { i: "i-web", x: 0, y: 0, s: 74, r: 0, lift: 4, d: 0, cls: "spk-web tl" },
  { i: "i-web", x: 100, y: 0, s: 62, r: 0, lift: 4, d: 40, cls: "spk-web tr" },
  { i: "i-bat", x: 21, y: 16, s: 26, r: -12, lift: 14, d: 0 },
  { i: "i-bat", x: 33, y: 62, s: 18, r: 9, lift: 18, d: 90 },
  { i: "i-bat", x: 62, y: 22, s: 22, r: 7, lift: 16, d: 45 },
  { i: "i-spider", x: 78, y: 12, s: 30, r: 0, lift: 10, d: 130, cls: "spk-spider" },
  { i: "i-pumpkin", x: 88, y: 70, s: 46, r: -6, lift: 12, d: 60 },
  { i: "i-pumpkin", x: 70, y: 78, s: 30, r: 8, lift: 9, d: 180 },
  { i: "i-pumpkin", x: 47, y: 84, s: 22, r: -4, lift: 7, d: 240 },
];

const spookDecoHtml = () => SPOOK_DECO.map((o) =>
  `<span class="spk-deco${o.cls ? " " + o.cls : ""}" aria-hidden="true" style="--x:${o.x}%;--y:${o.y}%;--r:${o.r}deg;--lift:${o.lift}px;--d:${o.d}ms">${icon(o.i, o.s)}</span>`
).join("");

// The one line under the title. It changes with the phase, because "31 nights of horror"
// is a lie on October 20th and useless on November 3rd.
function spookPitch() {
  const st = spookPhase();
  const filled = spookFilled();
  if (st.phase === "before") {
    const away = st.days === 1 ? "one night" : `${st.days} nights`;
    return filled
      ? `${filled} of ${SPOOK_NIGHTS} nights planned · October is ${away} away`
      : `October is ${away} away. Line up 31 nights of horror.`;
  }
  if (st.phase === "during") {
    const tonight = spookNights()[st.day - 1];
    if (tonight && tonight[1]) return `Tonight, night ${st.day}: ${String(tonight[1].title || "")}`;
    return `Night ${st.day} has nothing on it yet · ${filled} of ${SPOOK_NIGHTS} planned`;
  }
  return filled
    ? `That's a wrap on October — ${filled} nights planned. Take one more look.`
    : "October is over, but the calendar is still here.";
}

function spookBannerHtml() {
  if (!spookInSeason()) return "";
  const filled = spookFilled();
  const pct = Math.round((filled / SPOOK_NIGHTS) * 100);
  return `<section class="spk-banner" id="spookBanner" role="button" tabindex="0"
      aria-label="Spooktober — build your October horror calendar">
    <div class="spk-banner-deco">${spookDecoHtml()}</div>
    <div class="spk-banner-inner">
      <span class="h-eyebrow spk-eyebrow">Seasonal event</span>
      <h2 class="spk-title">Spooktober</h2>
      <p class="spk-pitch">${escapeHtml(spookPitch())}</p>
      <span class="spk-cta">Build your calendar →</span>
      ${filled ? `<span class="spk-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ""}
    </div>
  </section>`;
}

// Home repaints one section at a time (see patchHomeRecs); the banner's line depends on
// the calendar, so coming back from the event page has to refresh it without a full render.
function patchSpookBanner() {
  const cur = document.getElementById("spookBanner");
  if (!cur) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = spookBannerHtml();
  const next = tmp.firstElementChild;
  if (!next) { cur.remove(); return; }
  cur.replaceWith(next);
  wireSpookBanner(next.parentNode || document);
}

function wireSpookBanner(scope) {
  const el = (scope || document).querySelector("#spookBanner");
  if (!el) return;
  const go = () => goTab("spooktober");
  el.onclick = go;
  // role=button without a key handler is a button only for people using a mouse.
  el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
}

/* ---- the event page -------------------------------------------------------- */

function spookNightHtml(day, row) {
  const st = spookPhase();
  const isToday = st.phase === "during" && st.day === day;
  const past = (st.phase === "during" && day < st.day) || st.phase === "after";
  const cls = ["spk-night", row ? "filled" : "empty", isToday ? "today" : "", past ? "past" : ""]
    .filter(Boolean).join(" ");
  const num = `<span class="spk-num">${day}${isToday ? `<em>tonight</em>` : ""}</span>`;
  if (!row) {
    return `<div class="${cls}">${num}
      <button class="spk-add" data-day="${day}" aria-label="Choose a game for October ${day}">
        ${icon("i-pumpkin", 26)}<span>Pick</span>
      </button></div>`;
  }
  const k = escapeHtml(String(row._k || ""));
  const cs = typeof coverSrc === "function" ? coverSrc(ENRICH[row._k], "cover_big") : "";
  const cover = cs
    ? `<img class="spk-cover" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
    : `<span class="spk-cover ph">${icon("i-library", 22)}</span>`;
  return `<div class="${cls}">${num}
    <button class="spk-slot" data-open="${k}" title="Open ${escapeHtml(String(row.title))}">
      ${cover}
      <span class="spk-slot-t">${escapeHtml(String(row.title))}</span>
      <span class="spk-slot-s">${escapeHtml(String(row.platform || ""))}</span>
    </button>
    <button class="spk-x" data-clear="${day}" aria-label="Clear October ${day}">${icon("i-close", 13)}</button>
    <button class="spk-swap" data-day="${day}">Swap</button>
  </div>`;
}

// The picker: the eligible pool, filtered by the search box, capped at what a person will
// actually look at. Split out of renderSpooktober so a keystroke repaints THIS list and
// nothing else — a full render would take the focus out of the box you're typing in.
function spookResultsHtml() {
  const used = new Map(Object.entries(spookCal()).map(([d, k]) => [String(k), +d]));
  const q = SPOOK.q.trim().toLowerCase();
  const pool = spookPool().filter((r) => !q || String(r.title || "").toLowerCase().includes(q));
  if (!pool.length) {
    return `<p class="spk-none">${q ? "No horror game here by that name." : "No horror games found in the collection yet — enrichment may still be loading."}</p>`;
  }
  // Best-rated first when you haven't typed anything: the top of a 1,400-game list should be
  // a recommendation, not whatever the sheet happens to start with.
  const rank = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : 0);
  const sorted = q ? pool : pool.slice().sort((a, b) => rank(b) - rank(a));
  const shown = sorted.slice(0, 60);
  const cards = shown.map((r) => {
    const on = used.get(String(r._k || ""));
    return posterCardHtml(r, {
      cls: "spk-cand" + (on ? " taken" : ""),
      note: on ? `<span class="spk-taken">On night ${on}</span>` : "",
      attrs: `data-put="${escapeHtml(String(r._k || ""))}"`,
    });
  }).join("");
  const more = sorted.length - shown.length;
  return `<div class="spk-cands">${cards}</div>` +
    (more > 0 ? `<p class="spk-more">${more.toLocaleString()} more — keep typing to narrow it down.</p>` : "");
}

function spookPickerHtml() {
  if (SPOOK.picking == null) return "";
  return `<div class="spk-picker" id="spookPicker">
    <div class="spk-picker-head">
      <b>October ${SPOOK.picking}</b>
      <input id="spookQ" class="spk-q" type="search" placeholder="Search horror games…"
             value="${escapeHtml(SPOOK.q)}" autocomplete="off">
      <button class="btn ghost" id="spookCancel">Done</button>
    </div>
    <div id="spookResults">${spookResultsHtml()}</div>
  </div>`;
}

function renderSpooktober() {
  const host = $("#spooktober");
  if (!host || !DATA) return;
  spookLoadPrefs();
  const filled = spookFilled();
  const pct = Math.round((filled / SPOOK_NIGHTS) * 100);
  const nights = spookNights();
  const st = spookPhase();
  // Off-season the page still opens (a link has to work), it just says so instead of
  // pretending the event is running.
  const offSeason = !spookInSeason()
    ? `<p class="spk-off">Spooktober runs September 9 through the first week of November. You're early — or late — but the calendar is yours to keep.</p>` : "";

  host.innerHTML = `
    <section class="spk-hero">
      <div class="spk-banner-deco">${spookDecoHtml()}</div>
      <div class="spk-hero-inner">
        <span class="h-eyebrow spk-eyebrow">Seasonal event · ${spookYear()}</span>
        <h1 class="spk-title big">Spooktober</h1>
        <p class="spk-pitch">${escapeHtml(spookPitch())}</p>
        ${offSeason}
        <div class="spk-meter">
          <span class="spk-bar"><span style="width:${pct}%"></span></span>
          <span class="spk-meter-t">${filled} of ${SPOOK_NIGHTS} nights planned</span>
        </div>
        <div class="spk-acts">
          <button class="btn" id="spookFill">${icon("i-dice", 15)} Fill the empty nights</button>
          ${filled ? `<button class="btn ghost" id="spookReset">Clear the calendar</button>` : ""}
        </div>
      </div>
    </section>
    <div class="spk-wrap">
      <div class="spk-grid">${nights.map(([d, r]) => spookNightHtml(d, r)).join("")}</div>
    </div>
    ${spookPickerHtml()}`;

  wireSpook(host);
  // Only the games on screen: the calendar's own 31, plus whatever the picker is showing.
  const seen = nights.map(([, r]) => r).filter(Boolean);
  if (typeof maybeEnrich === "function") maybeEnrich([...seen, ...spookPool().slice(0, 60)]);
}

/* A repaint that keeps the caret where it was — but only if it was in the search box to
   begin with. Focusing it unconditionally would re-open the on-screen keyboard every time
   you tapped a game on a phone, which is exactly the wrong thing to do to somebody who is
   tapping their way down a list of covers. */
function spookRepaint() {
  const q0 = document.getElementById("spookQ");
  const typing = !!q0 && document.activeElement === q0;
  renderSpooktober();
  if (!typing) return;
  const q = document.getElementById("spookQ");
  if (q) { q.focus(); q.selectionStart = q.selectionEnd = q.value.length; }
}

function wireSpook(host) {
  host.querySelectorAll("[data-day]").forEach((el) => {
    el.onclick = () => { SPOOK.picking = +el.dataset.day; spookRepaint(); };
  });
  host.querySelectorAll("[data-clear]").forEach((el) => {
    el.onclick = () => { spookClearDay(+el.dataset.clear); spookRepaint(); };
  });
  host.querySelectorAll("[data-open]").forEach((el) => {
    el.onclick = () => { const r = spookRowFor(el.dataset.open); if (r) openDrawer(r, "games"); };
  });
  host.querySelectorAll("[data-put]").forEach((el) => {
    el.onclick = () => {
      if (SPOOK.picking == null) return;
      spookSet(SPOOK.picking, el.dataset.put);
      // Step to the next EMPTY night rather than closing: filling a calendar is 31 of the
      // same decision, and making you re-open the picker for each one is 31 extra clicks.
      const next = spookNights().find(([d, r]) => d > SPOOK.picking && !r);
      SPOOK.picking = next ? next[0] : null;
      spookRepaint();
    };
  });
  const cancel = document.getElementById("spookCancel");
  if (cancel) cancel.onclick = () => { SPOOK.picking = null; SPOOK.q = ""; renderSpooktober(); };

  const q = document.getElementById("spookQ");
  if (q) {
    q.oninput = () => {
      SPOOK.q = q.value;
      const res = document.getElementById("spookResults");
      if (!res) return;
      res.innerHTML = spookResultsHtml();
      wireSpook(res);                       // the cards are new; the input is not
      if (typeof maybeEnrich === "function") maybeEnrich(spookPool().slice(0, 60));
    };
    q.onkeydown = (e) => { if (e.key === "Escape") { SPOOK.picking = null; SPOOK.q = ""; renderSpooktober(); } };
  }

  const fill = document.getElementById("spookFill");
  if (fill) fill.onclick = () => {
    const nights = spookNights();
    const empty = nights.filter(([, r]) => !r).map(([d]) => d);
    if (!empty.length) { if (typeof showToast === "function") showToast("Every night is spoken for"); return; }
    const taken = new Set(Object.values(spookCal()).map(String));
    /* Prefer what you haven't finished: the point of the calendar is to give the backlog a
       deadline, and a month of games you've already completed doesn't do that. Falls back to
       the whole pool if the unplayed shelf runs dry before the 31st. */
    const pool = spookPool().filter((r) => !taken.has(String(r._k || "")));
    const fresh = pool.filter((r) => !r.completed);
    const pick = (fresh.length >= empty.length ? fresh : pool).slice();
    for (let i = pick.length - 1; i > 0; i--) {          // Fisher–Yates
      const j = Math.floor(Math.random() * (i + 1));
      [pick[i], pick[j]] = [pick[j], pick[i]];
    }
    const all = spookCalAll();
    const y = String(spookYear());
    const cal = all[y] || (all[y] = {});
    empty.forEach((d, i) => { if (pick[i]) cal[String(d)] = String(pick[i]._k || ""); });
    spookSave();
    SPOOK.picking = null;
    renderSpooktober();
    if (typeof showToast === "function") showToast(`Filled ${Math.min(empty.length, pick.length)} nights`);
  };

  const reset = document.getElementById("spookReset");
  if (reset) reset.onclick = () => {
    spookClearAll();
    SPOOK.picking = null;
    renderSpooktober();
  };
}

// Leaving the page and coming back should not drop you into a half-open picker.
TAB_RESET.spooktober = () => { SPOOK.picking = null; SPOOK.q = ""; };
