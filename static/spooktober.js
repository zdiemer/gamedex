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
  cal: null,          // the whole saved file (see spookFile) — every year you've ever planned
  picking: null,      // the night the picker is choosing for, or null
  mode: "fill",       // "fill" — walk on to the next empty night; "swap" — stay on this one
  q: "",              // the picker's search box
  all: false,         // picker is showing the whole collection, not just the horror pool
  loaded: false,      // the server's copy has landed (or failed) at least once
  // Two one-shot animation flags. Both are read by the NEXT render and cleared by it, so a
  // repaint that wasn't an open or a roll — picking a game, typing, toggling "any game" —
  // doesn't replay the movement.
  opening: false,     // the picker was just opened: slide it up
  dealt: null,        // the nights a roll just touched: deal them in
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
const SPOOK_V = 2;

const spookBlank = () => ({ v: SPOOK_V, cal: {}, pins: {} });

/* v1 was the bare calendar — { "<year>": { "<day>": matchKey } } — with nowhere to record
   which nights are pinned. The tempting fix is to keep pins inside the year object under a
   key that isn't a day, but then every loop over a year's entries has to know that one of
   its "days" is a lie, and there are five of those loops. v2 wraps the calendar instead and
   keeps pins beside it. Old files migrate on read; nothing writes v1 any more. */
function spookMigrate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return spookBlank();
  if (raw.v === SPOOK_V) {
    return { v: SPOOK_V, cal: raw.cal && typeof raw.cal === "object" ? raw.cal : {},
             pins: raw.pins && typeof raw.pins === "object" ? raw.pins : {} };
  }
  const cal = {};
  for (const [y, nights] of Object.entries(raw)) {
    if (/^\d{4}$/.test(y) && nights && typeof nights === "object") cal[y] = nights;
  }
  return { v: SPOOK_V, cal, pins: {} };
}

function spookFile() {
  if (SPOOK.cal) return SPOOK.cal;
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SPOOK_LOCAL) || "null"); } catch (_) {}
  return (SPOOK.cal = spookMigrate(raw));
}

const spookCalAll = () => spookFile().cal;

// This year's nights, as { day: matchKey }. Created lazily: an empty year should not be
// written to the server just because someone opened the page.
const spookCal = () => spookCalAll()[String(spookYear())] || {};

function spookPrune(file) {
  const years = Object.keys(file.cal).sort();
  for (const y of years.slice(0, Math.max(0, years.length - SPOOK_KEEP_YEARS))) {
    delete file.cal[y];
    delete file.pins[y];
  }
  return file;
}

async function spookSave() {
  const all = spookPrune(spookFile());
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
  let raw = null;
  try {
    const j = await (await fetch("api/prefs")).json();
    raw = (j.prefs || {}).spooktober;
  } catch (_) { return; }        // offline: the local mirror stands in
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const remote = spookMigrate(raw);      // the server may still be holding a v1 file
  const file = spookFile();
  let changed = false;
  for (const [year, nights] of Object.entries(remote.cal)) {
    if (!nights || typeof nights !== "object") continue;
    const mine = file.cal[year] || (file.cal[year] = {});
    for (const [day, key] of Object.entries(nights)) {
      if (!(day in mine)) { mine[day] = key; changed = true; }
    }
  }
  // Pins union rather than replace, for the same reason the nights merge one at a time: a
  // pin is you saying "keep this one", and the safe way to reconcile two devices that each
  // said it about different nights is to honour both. Unpinning on one device and not the
  // other loses that argument — but re-rolling a night you meant to keep is the worse half.
  for (const [year, days] of Object.entries(remote.pins)) {
    if (!Array.isArray(days)) continue;
    const mine = file.pins[year] || (file.pins[year] = []);
    for (const d of days) if (!mine.includes(+d)) { mine.push(+d); changed = true; }
  }
  try { localStorage.setItem(SPOOK_LOCAL, JSON.stringify(file)); } catch (_) {}
  if (changed && activeTab === "spooktober") renderSpooktober();
  else if (changed && activeTab === "home" && typeof patchSpookBanner === "function") patchSpookBanner();
}

// This year's nights, created on demand — an empty year should not be written to the
// server just because someone opened the page.
function spookNightsObj() {
  const all = spookCalAll();
  const y = String(spookYear());
  return all[y] || (all[y] = {});
}

function spookSet(day, key) {
  const nights = spookNightsObj();
  const prev = nights[String(day)];
  /* A game can only hold one night: 31 nights of the same game is never what you meant, and
     the picker marks the ones already spoken for. So assigning a game that is already on the
     calendar moves it — and if the night you are moving it TO had a game of its own, that
     game takes the vacated night. An exchange, not an eviction: choosing a replacement for
     the 5th should never quietly empty the 12th behind the picker. */
  for (const [d, k] of Object.entries(nights)) {
    if (k !== key || d === String(day)) continue;
    if (prev) nights[d] = prev; else delete nights[d];
  }
  nights[String(day)] = key;
  spookSave();
}

function spookClearDay(day) {
  const nights = spookCalAll()[String(spookYear())];
  if (nights) delete nights[String(day)];
  spookPin(day, false);        // a pin on an empty night holds nothing; it also saves
}

function spookClearAll() {
  spookCalAll()[String(spookYear())] = {};
  spookFile().pins[String(spookYear())] = [];
  spookSave();
}

/* ---- pins ------------------------------------------------------------------
   A pinned night is one you have decided about, and the dice must not touch it. That is the
   whole contract: pins do nothing else, and nothing else reads them. */
const spookPins = () => spookFile().pins[String(spookYear())] || [];
const spookIsPinned = (day) => spookPins().includes(+day);

function spookPin(day, on) {
  const file = spookFile();
  const y = String(spookYear());
  const list = file.pins[y] || (file.pins[y] = []);
  const i = list.indexOf(+day);
  if (on && i < 0) list.push(+day);
  else if (!on && i >= 0) list.splice(i, 1);
  spookSave();
}

const spookTogglePin = (day) => spookPin(day, !spookIsPinned(day));

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
/* Finished, by the same test the drawer uses: the All Games flag OR a row on the Completed
   sheet. Either one alone misses games recorded only the other way, and the whole point of
   the check is that the calendar stops offering you a game you've already beaten. */
function spookIsDone(r) {
  if (r.completed) return true;
  const done = typeof rowsByK === "function" ? rowsByK().completed : null;
  if (!done) return false;
  const keys = r._members ? r._members.map((m) => m._k) : [r._k];
  return keys.some((k) => k && done.has(k));
}

let _spookPool = null, _spookPoolAt = -1;
function spookPool() {
  if (_spookPool && _spookPoolAt === _enrichEpoch) return _spookPool;
  const rows = ((DATA.sheets.games || {}).rows || []).filter((r) => r.title && spookIsHorror(r));
  const grouped = typeof groupByGame === "function" ? groupByGame(rows) : rows;
  _spookPoolAt = _enrichEpoch;
  /* Done games come out AFTER grouping, because finishing it on any one copy finishes the
     game (groupRow merges the flag), and a PC copy you never touched shouldn't put a game
     you beat on PS4 back in the dice. The escape hatch is the picker's "any game" toggle,
     which searches the whole sheet — replaying a favourite in October is the tradition, it
     just shouldn't be what the dice hand you. */
  return (_spookPool = grouped.filter((r) => !spookIsDone(r)));
}

/* Everything on the sheet, for the picker's "any game" mode. The horror pool is a
   suggestion, not a fence: if you want Katamari on the 31st because that is the tradition in
   your house, the calendar is yours. Grouped the same way, so a game you pick here is the
   same card you'd get anywhere else in the app. */
let _spookAll = null;
function spookAllGames() {
  if (_spookAll) return _spookAll;
  const rows = ((DATA.sheets.games || {}).rows || []).filter((r) => r.title);
  return (_spookAll = typeof groupByGame === "function" ? groupByGame(rows) : rows);
}

/* Resolving a saved night has to look at the RAW rows, not at either grouped list. A night
   holds the key of whichever card you picked, and grouping the horror rows and grouping all
   the rows can choose different representatives for the same title — so a game picked in
   "any game" mode would come back unresolved, and the night would render as empty. */
let _spookIdx = null;
function spookRowIndex() {
  if (_spookIdx) return _spookIdx;
  _spookIdx = new Map();
  for (const r of (DATA.sheets.games || {}).rows || []) {
    const k = String(r._k || "");
    if (k && !_spookIdx.has(k)) _spookIdx.set(k, r);
  }
  return _spookIdx;
}

const spookRowFor = (key) => spookRowIndex().get(String(key)) || null;

// The nights, in order, as [day, row|null].
function spookNights() {
  const nights = spookCal();
  const out = [];
  for (let d = 1; d <= SPOOK_NIGHTS; d++) {
    const k = nights[String(d)];
    out.push([d, k ? spookRowFor(k) : null]);
  }
  return out;
}

const spookFilled = () => spookNights().filter(([, r]) => r).length;

/* One shuffled draw for a set of nights. Used by both buttons: "fill the empty nights" hands
   it the empty ones, "re-roll" hands it the filled-but-unpinned ones. The nights being
   redrawn don't count as taken — otherwise a re-roll could only ever draw from what the
   calendar had left over, which on a full month is nothing. */
function spookRoll(days) {
  if (!days.length) return 0;
  const redrawing = new Set(days.map(String));
  const cal = spookCal();
  const taken = new Set(
    Object.entries(cal).filter(([d]) => !redrawing.has(d)).map(([, k]) => String(k)));
  /* Prefer what you haven't finished: the point of the calendar is to give the backlog a
     deadline, and a month of games you've already completed doesn't do that. Falls back to
     the whole pool if the unplayed shelf runs dry before the 31st. */
  const pool = spookPool().filter((r) => !taken.has(String(r._k || "")));
  const fresh = pool.filter((r) => !r.completed);
  const pick = (fresh.length >= days.length ? fresh : pool).slice();
  for (let i = pick.length - 1; i > 0; i--) {          // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [pick[i], pick[j]] = [pick[j], pick[i]];
  }
  const nights = spookNightsObj();
  let n = 0;
  days.forEach((d, i) => { if (pick[i]) { nights[String(d)] = String(pick[i]._k || ""); n++; } });
  spookSave();
  return n;
}

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
  const pinned = !!row && spookIsPinned(day);
  // Dealt in the order the dice touched them, capped so the last card isn't a wait.
  const deal = SPOOK.dealt ? SPOOK.dealt.indexOf(day) : -1;
  const cls = ["spk-night", row ? "filled" : "empty", isToday ? "today" : "", past ? "past" : "",
    pinned ? "pinned" : "", deal >= 0 ? "spk-dealt" : ""].filter(Boolean).join(" ");
  const delay = deal >= 0 ? ` style="--d:${Math.min(deal, 24) * 34}ms"` : "";
  const num = `<span class="spk-num">${day}${isToday ? `<em>tonight</em>` : ""}</span>`;
  if (!row) {
    return `<div class="${cls}"${delay}>${num}
      <button class="spk-add" data-day="${day}" aria-label="Choose a game for October ${day}">
        ${icon("i-pumpkin", 26)}<span>Pick</span>
      </button></div>`;
  }
  const k = escapeHtml(String(row._k || ""));
  const cs = typeof coverSrc === "function" ? coverSrc(ENRICH[row._k], "cover_big") : "";
  const cover = cs
    ? `<img class="spk-cover" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
    : `<span class="spk-cover ph">${icon("i-library", 22)}</span>`;
  return `<div class="${cls}"${delay}>${num}
    <button class="spk-pin" data-pin="${day}" aria-pressed="${pinned}"
      title="${pinned ? `October ${day} is pinned — the dice will leave it alone` : `Pin October ${day} so a re-roll keeps it`}">${icon("i-pin", 13)}</button>
    <button class="spk-slot" data-open="${k}" title="Open ${escapeHtml(String(row.title))}">
      ${cover}
      <span class="spk-slot-t">${escapeHtml(String(row.title))}</span>
      <span class="spk-slot-s">${escapeHtml(String(row.platform || ""))}</span>
    </button>
    <span class="spk-night-acts">
      <button class="spk-swap" data-day="${day}" aria-label="Change the game on October ${day}">Change</button>
      <button class="spk-x" data-clear="${day}" aria-label="Clear October ${day}">${icon("i-close", 13)}</button>
    </span>
  </div>`;
}

// The picker: the eligible pool, filtered by the search box, capped at what a person will
// actually look at. Split out of renderSpooktober so a keystroke repaints THIS list and
// nothing else — a full render would take the focus out of the box you're typing in.
function spookResultsHtml() {
  const used = new Map(Object.entries(spookCal()).map(([d, k]) => [String(k), +d]));
  const q = SPOOK.q.trim().toLowerCase();
  const src = SPOOK.all ? spookAllGames() : spookPool();
  const pool = src.filter((r) => !q || String(r.title || "").toLowerCase().includes(q));
  if (!pool.length) {
    const none = SPOOK.all
      ? "Nothing on the sheet by that name."
      : (q ? "No horror game here by that name — tick “any game” to search the whole collection."
           : "No horror games found in the collection yet — enrichment may still be loading.");
    return `<p class="spk-none">${none}</p>`;
  }
  // Best-rated first when you haven't typed anything: the top of a 1,400-game list should be
  // a recommendation, not whatever the sheet happens to start with.
  const rank = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : 0);
  const sorted = q ? pool : pool.slice().sort((a, b) => rank(b) - rank(a));
  const shown = sorted.slice(0, 60);
  const cards = shown.map((r) => {
    const on = used.get(String(r._k || ""));
    // "any game" is the only list a finished game can appear in, so it's the only list that
    // has to say so — otherwise the absence from the horror pool looks like a missing game.
    const note = on ? `<span class="spk-taken">On night ${on}</span>`
      : (SPOOK.all && spookIsDone(r) ? `<span class="spk-fin">Finished</span>` : "");
    return posterCardHtml(r, {
      cls: "spk-cand" + (on ? " taken" : ""),
      note,
      attrs: `data-put="${escapeHtml(String(r._k || ""))}"`,
    });
  }).join("");
  const more = sorted.length - shown.length;
  return `<div class="spk-cands grid">${cards}</div>` +
    (more > 0 ? `<p class="spk-more">${more.toLocaleString()} more — keep typing to narrow it down.</p>` : "");
}

function spookPickerHtml() {
  if (SPOOK.picking == null) return "";
  const cur = spookNights()[SPOOK.picking - 1];
  const on = cur && cur[1] ? String(cur[1].title || "") : "";
  return `<div class="spk-picker${SPOOK.opening ? " spk-in" : ""}" id="spookPicker">
    <div class="spk-picker-head">
      <b>October ${SPOOK.picking}</b>
      ${on ? `<span class="spk-on">now: ${escapeHtml(on)}</span>` : ""}
      ${searchField("spookQ", SPOOK.all ? "Search the whole collection…" : "Search horror games…",
                    SPOOK.q, "spk-field")}
      <label class="spk-any" title="Ignore the horror filter and pick from everything on the sheet">
        <input type="checkbox" id="spookAny"${SPOOK.all ? " checked" : ""}> any game
      </label>
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
  const pinned = nights.filter(([d, r]) => r && spookIsPinned(d)).length;
  const rerollable = filled - pinned;
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
          ${filled < SPOOK_NIGHTS ? `<button class="btn" id="spookFill">${icon("i-dice", 15)} Fill the empty nights</button>` : ""}
          ${rerollable ? `<button class="btn${filled < SPOOK_NIGHTS ? " ghost" : ""}" id="spookReroll">${icon("i-refresh", 15)} Re-roll ${rerollable} unpinned</button>` : ""}
          ${filled ? `<button class="btn ghost" id="spookReset">Clear the calendar</button>` : ""}
        </div>
        ${pinned ? `<p class="spk-pinnote">${icon("i-pin", 12)} ${pinned} pinned — a re-roll leaves ${pinned === 1 ? "it" : "them"} alone.</p>` : ""}
      </div>
    </section>
    <div class="spk-wrap">
      <div class="spk-grid">${nights.map(([d, r]) => spookNightHtml(d, r)).join("")}</div>
    </div>
    ${spookPickerHtml()}`;

  // Both animation flags are spent by the render that read them.
  SPOOK.opening = false;
  SPOOK.dealt = null;
  wireSpook(host);
  // Only the games on screen: the calendar's own 31, plus whatever the picker is showing.
  const seen = nights.map(([, r]) => r).filter(Boolean);
  const cands = SPOOK.picking == null ? [] : (SPOOK.all ? spookAllGames() : spookPool()).slice(0, 60);
  if (typeof maybeEnrich === "function") maybeEnrich([...seen, ...cands]);
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
  // Both routes into the picker. An empty night is "fill" — you are working down the month,
  // so it walks on. A filled night is "swap" — you came here about THAT night, so it stays.
  host.querySelectorAll("[data-day]").forEach((el) => {
    el.onclick = () => {
      // Already open on another night: it slides once, then moves between nights in place.
      SPOOK.opening = SPOOK.picking == null;
      SPOOK.picking = +el.dataset.day;
      SPOOK.mode = el.classList.contains("spk-swap") ? "swap" : "fill";
      spookRepaint();
      // The picker is sticky to the bottom of the scrollport, which normally means opening
      // it IS showing it. Belt and braces for the case where it isn't — a tap that opens a
      // panel 2,000px below the fold is indistinguishable from a tap that did nothing.
      const p = document.getElementById("spookPicker");
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (p && p.getBoundingClientRect().top >= vh) p.scrollIntoView({ block: "end" });
    };
  });
  host.querySelectorAll("[data-clear]").forEach((el) => {
    el.onclick = () => { spookClearDay(+el.dataset.clear); spookRepaint(); };
  });
  host.querySelectorAll("[data-pin]").forEach((el) => {
    el.onclick = () => { spookTogglePin(+el.dataset.pin); spookRepaint(); };
  });
  host.querySelectorAll("[data-open]").forEach((el) => {
    el.onclick = () => { const r = spookRowFor(el.dataset.open); if (r) openDrawer(r, "games"); };
  });
  host.querySelectorAll("[data-put]").forEach((el) => {
    el.onclick = () => {
      if (SPOOK.picking == null) return;
      spookSet(SPOOK.picking, el.dataset.put);
      /* Filling a calendar is 31 of the same decision, so a pick walks on to the next empty
         night rather than making you re-open the picker for each one. Changing ONE night is
         a different job: it stays where it is, so you can see what you just did and try
         something else. Advancing there is what made Swap look broken — on a full calendar
         there is no next empty night, so the panel closed the instant you chose. */
      if (SPOOK.mode === "fill") {
        const next = spookNights().find(([d, r]) => d > SPOOK.picking && !r);
        SPOOK.picking = next ? next[0] : null;
      }
      spookRepaint();
    };
  });
  const close = () => { SPOOK.picking = null; SPOOK.q = ""; renderSpooktober(); };
  const cancel = document.getElementById("spookCancel");
  if (cancel) cancel.onclick = close;

  const any = document.getElementById("spookAny");
  if (any) any.onchange = () => { SPOOK.all = any.checked; spookRepaint(); };

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
    q.onkeydown = (e) => { if (e.key === "Escape") close(); };
  }

  const roll = (days, done) => {
    const n = spookRoll(days);
    SPOOK.picking = null;
    SPOOK.dealt = days.slice().sort((a, b) => a - b);
    renderSpooktober();
    if (typeof showToast === "function") showToast(done(n));
  };

  const fill = document.getElementById("spookFill");
  if (fill) fill.onclick = () => {
    const empty = spookNights().filter(([, r]) => !r).map(([d]) => d);
    if (!empty.length) { if (typeof showToast === "function") showToast("Every night is spoken for"); return; }
    roll(empty, (n) => `Filled ${n} night${n === 1 ? "" : "s"}`);
  };

  // Re-roll leaves the pinned nights exactly where they are — that is what a pin is for.
  const reroll = document.getElementById("spookReroll");
  if (reroll) reroll.onclick = () => {
    const loose = spookNights().filter(([d, r]) => r && !spookIsPinned(d)).map(([d]) => d);
    if (!loose.length) { if (typeof showToast === "function") showToast("Every night is pinned"); return; }
    const held = spookFilled() - loose.length;
    roll(loose, (n) => `Re-rolled ${n} night${n === 1 ? "" : "s"}${held ? ` · ${held} pinned` : ""}`);
  };

  const reset = document.getElementById("spookReset");
  if (reset) reset.onclick = () => {
    spookClearAll();
    SPOOK.picking = null;
    renderSpooktober();
  };
}

// Leaving the page and coming back should not drop you into a half-open picker.
TAB_RESET.spooktober = () => { SPOOK.picking = null; SPOOK.q = ""; SPOOK.all = false; };
