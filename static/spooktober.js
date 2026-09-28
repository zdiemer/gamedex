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
   planned (and what you actually got through) after the 31st.

   Pace: one game per night is the default and the way it shipped, but "one game per night"
   quietly assumes every horror game is a one-sitting game, and the shelf says otherwise —
   Bloodborne and Gone Home are not the same evening. Set an hours-a-night figure and the
   calendar becomes a schedule: a game books ceil(playtime / pace) consecutive nights, so
   October at two hours a night is six or seven games rather than 31. The knob lives in the
   calendar file, so the pace follows you between devices along with the plan it built. */

// Month indexes, because Date's are 0-based and a bare 8 in a comparison is a trap.
const SPOOK_START = { m: 8, d: 9 };    // Sep 9
const SPOOK_END = { m: 10, d: 7 };     // Nov 7
const SPOOK_NIGHTS = 31;               // October

/* Hours a night. 0 means "one game per night, however long it is" — the original calendar,
   and still the default, because it is the only pace that stays honest with no playtime data
   behind it. The rest are the sittings people actually describe having. */
const SPOOK_PACES = [0, 1, 1.5, 2, 3, 4];
const SPOOK_PACE_LABELS = { 0: "One game per night", 1: "1 hour", 1.5: "1½ hours", 2: "2 hours", 3: "3 hours", 4: "4 hours" };

const SPOOK = {
  cal: null,          // the whole saved file (see spookFile) — every year you've ever planned
  picking: null,      // the night the picker is choosing for, or null
  mode: "fill",       // "fill" — walk on to the next empty night; "swap" — stay on this one
  q: "",              // the picker's search box
  all: false,         // picker is showing the whole collection, not just the horror pool
  loaded: false,      // the server's copy is loading or has landed successfully
  // Two one-shot animation flags. Both are read by the NEXT render and cleared by it, so a
  // repaint that wasn't an open or a roll — picking a game, typing, toggling "any game" —
  // doesn't replay the movement.
  opening: false,     // the picker was just opened: slide it up
  dealt: null,        // the nights a roll just touched: deal them in
};

/* ---- the season ----------------------------------------------------------- */

/* The one clock. evNow() is `new Date()` unless the preview board (?tab=events) has been
   moved to another day, which is the only way to see what this banner does on October 31st
   without waiting for October 31st. */
const spookToday = () => (typeof evNow === "function" ? evNow() : new Date());

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
const SPOOK_V = 3;

const spookBlank = () => ({ v: SPOOK_V, cal: {}, pins: {}, hpd: 0 });

/* A pace off the list, or 0. Anything else — a hand-edited file, a value from a version that
   offers more of them — reads as "one game per night" rather than as a division by something
   surprising, and every read goes through here so there is one place that decides. */
const spookPace = (v) => (SPOOK_PACES.includes(+v) ? +v : 0);

/* v1 was the bare calendar — { "<year>": { "<day>": matchKey } } — with nowhere to record
   which nights are pinned. The tempting fix is to keep pins inside the year object under a
   key that isn't a day, but then every loop over a year's entries has to know that one of
   its "days" is a lie, and there are five of those loops. v2 wraps the calendar instead and
   keeps pins beside it. v3 adds `hpd`, the hours-a-night pace, beside them both: it belongs
   to the plan rather than to a year, and a v2 file is simply one that never set a pace. Old
   files migrate on read; nothing writes v1 or v2 any more. */
function spookMigrate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return spookBlank();
  const obj = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
  if (raw.v === 2 || raw.v === SPOOK_V) {
    return { v: SPOOK_V, cal: obj(raw.cal), pins: obj(raw.pins), hpd: spookPace(raw.hpd) };
  }
  const cal = {};
  for (const [y, nights] of Object.entries(raw)) {
    if (/^\d{4}$/.test(y) && nights && typeof nights === "object") cal[y] = nights;
  }
  return { v: SPOOK_V, cal, pins: {}, hpd: 0 };
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

/* The pace, in hours a night — 0 for one game per night. Not per year: it describes how you
   play, and nobody wants to re-answer it every September. */
const spookHpd = () => spookPace(spookFile().hpd);

function spookSetHpd(h) {
  spookFile().hpd = spookPace(h);
  spookSave();
}

function spookPrune(file) {
  const years = Object.keys(file.cal).sort();
  for (const y of years.slice(0, Math.max(0, years.length - SPOOK_KEEP_YEARS))) {
    delete file.cal[y];
    delete file.pins[y];
  }
  return file;
}

async function spookSave() {
  const all = spookPrune(spookTidyPins(spookFile()));
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
  // Signed out there is nothing up there to merge — /api/prefs answers {} to the public on
  // purpose — and boot already spends one request on it (loadPrefs, extras.js). Don't spend
  // a second one to be told the same thing.
  if (typeof IS_ADMIN !== "undefined" && !IS_ADMIN) return;
  SPOOK.loaded = true;          // also deduplicates requests while the first is in flight
  let raw = null;
  try {
    const r = await fetch("api/prefs");
    if (!r.ok) throw new Error(`api/prefs returned ${r.status}`);
    const j = await r.json();
    raw = (j.prefs || {}).spooktober;
  } catch (_) {
    SPOOK.loaded = false;       // keep the local mirror; retry on the next visit/render
    return;
  }
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
  // The pace is one number, not a set of nights, so there is nothing to merge night by night:
  // take the server's if this browser has never set one, and otherwise leave the local answer
  // alone — whoever last touched the dropdown on THIS device meant it.
  if (!spookPace(file.hpd) && spookPace(remote.hpd)) { file.hpd = spookPace(remote.hpd); changed = true; }
  try { localStorage.setItem(SPOOK_LOCAL, JSON.stringify(file)); } catch (_) {}
  // A phone can hold the only copy after an offline/failed save. Reading the server
  // alone never repairs that: upload the merged file when local nights or pins are
  // missing remotely, so a fresh browser can finally see them too.
  const unsynced = Object.entries(file.cal).some(([year, nights]) =>
    Object.keys(nights).some((day) => !(day in (remote.cal[year] || {}))))
    || Object.entries(file.pins).some(([year, days]) =>
      days.some((day) => !(remote.pins[year] || []).includes(+day)));
  if (unsynced) await spookSave();
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

/* Place a game at `day`, over however many nights it books, and return the nights it took.

   A game holds ONE run: 31 nights of the same game is never what you meant, and the picker
   marks what is already spoken for — so assigning a game that is already on the calendar
   MOVES it. What the old one-night version did next was an exchange: the game you displaced
   took the night you vacated, so choosing a replacement for the 5th never quietly emptied the
   12th. That trade doesn't survive runs of different lengths (a ten-night game has nowhere to
   go in the two nights it displaced), so a run you land on is evicted instead — and evicted
   WHOLE, because clearing four nights of a five-night game leaves a plan that claims you'll
   play most of something and then stop. */
function spookSet(day, key) {
  const nights = spookNightsObj();
  const row = spookRowFor(key);
  for (const [d, k] of Object.entries(nights)) if (String(k) === String(key)) delete nights[d];
  const end = Math.min(SPOOK_NIGHTS, day + spookSpan(row) - 1);
  const hit = new Set();
  for (let d = day; d <= end; d++) { const k = nights[String(d)]; if (k) hit.add(String(k)); }
  if (hit.size) for (const [d, k] of Object.entries(nights)) if (hit.has(String(k))) delete nights[d];
  for (let d = day; d <= end; d++) nights[String(d)] = String(key);
  spookSave();                 // and spookTidyPins drops the pins the evicted runs left behind
  return end - day + 1;
}

// Clearing any night of a run clears the run: see spookSet on why half a run isn't a plan.
function spookClearDay(day) {
  const nights = spookCalAll()[String(spookYear())];
  if (!nights) return;
  const run = spookRunAt(day);
  if (run) for (let d = run.start; d <= run.end; d++) delete nights[String(d)];
  else delete nights[String(day)];
  spookSave();                 // the run's pin goes with it, via spookTidyPins
}

function spookClearAll() {
  spookCalAll()[String(spookYear())] = {};
  spookFile().pins[String(spookYear())] = [];
  spookSave();
}

/* ---- pins ------------------------------------------------------------------
   A pinned night is one you have decided about, and the dice must not touch it. That is the
   whole contract: pins do nothing else, and nothing else reads them.

   A pin names the night a game STARTS on, which is the only night of a run that is stable
   under a change of pace — the end moves when the arithmetic does. */
const spookPins = () => spookFile().pins[String(spookYear())] || [];
const spookIsPinned = (day) => spookPins().includes(+day);

/* Strays get dropped once, on the way to disk, so that every mutator can move runs around
   without each of them remembering to tidy up behind the pins. It also prunes what the
   cross-device union above can invent: the other device pinned night 5, this one has a game
   running 3→7, and a pin in the middle of a run holds nothing — the same thing the original
   already said about a pin on an empty night. */
function spookTidyPins(file) {
  const y = String(spookYear());
  const list = file.pins[y];
  if (!Array.isArray(list) || !list.length) return file;
  /* A run starts on a night whose key differs from the night before, which is a fact about
     the keys alone — spookRuns would answer the same question but has to resolve every key
     against the sheet, and this runs on the way to disk, where a save can happen before the
     sheet has landed (spookLoadPrefs uploads a merged file during boot). */
  const nights = file.cal[y] || {};
  const starts = new Set();
  for (let d = 1; d <= SPOOK_NIGHTS; d++) {
    const k = nights[String(d)];
    if (k && k !== nights[String(d - 1)]) starts.add(d);
  }
  file.pins[y] = list.filter((d) => starts.has(+d));
  return file;
}

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

/* ---- spans and runs --------------------------------------------------------
   How many nights a game books at the current pace. Playtime comes from the one function the
   whole app asks (playtimeOf, data.js: HLTB main→best, then VNDB, then the sheet's own
   estimate), so a night count improves as enrichment lands instead of having its own idea.

   A game nobody has ever timed books ONE night and the card says "untimed". Inventing a
   length for it — the pool median, a flat six hours — would put a made-up number in the
   middle of a schedule where it is indistinguishable from a real one, and the whole value of
   the pace is that the plan is arithmetic you can check. */
function spookHoursFor(row) {
  const h = row && typeof playtimeOf === "function" ? +playtimeOf(row) : NaN;
  return Number.isFinite(h) && h > 0 ? h : null;
}

/* Deliberately NOT capped at 31: a 90-hour game at an hour a night is 90 nights, and saying
   so is what keeps the dice honest — they only draw what fits in the month that's left, so
   the monster never lands on the 1st claiming to be October. You can still put one there by
   hand; spookSet clips it at the 31st and the picker says it will. */
function spookSpan(row) {
  const hpd = spookHpd();
  if (!hpd || !row) return 1;
  const h = spookHoursFor(row);
  if (h == null) return 1;
  return Math.max(1, Math.ceil(h / hpd));
}

/* On disk the calendar is still one key per night; a run is the same key on consecutive
   nights. Keeping the storage flat is what lets the per-night cross-device merge stand
   exactly as it was, and what lets a calendar built at one pace survive a change of pace —
   the file never has to agree with the current setting, it just gets re-read against it.
     [{ start, end, len, key, row }], in calendar order. */
function spookRuns() {
  const nights = spookCal();
  const runs = [];
  for (let d = 1; d <= SPOOK_NIGHTS; d++) {
    const k = nights[String(d)];
    if (!k) continue;
    const last = runs[runs.length - 1];
    if (last && last.key === String(k) && last.end === d - 1) { last.end = d; last.len++; continue; }
    runs.push({ start: d, end: d, len: 1, key: String(k), row: spookRowFor(k) });
  }
  return runs;
}

const spookRunAt = (day) => spookRuns().find((r) => day >= r.start && day <= r.end) || null;
const spookGames = () => spookRuns().filter((r) => r.row).length;

/* Runs laid out to a pace that is no longer the pace. Changing the number does NOT re-roll
   the month behind you — see spookRepack — so these are the cards that admit it. */
function spookMisfits() {
  if (!spookHpd()) return [];
  return spookRuns().filter((r) => r.row && r.len !== spookWant(r.start, r.row));
}

// The nights a game would book starting on `day`, clipped at the 31st.
const spookWant = (day, row) => Math.min(spookSpan(row), SPOOK_NIGHTS - day + 1);

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

/* One shuffled draw into a set of nights, as { games, nights }. Used by both buttons: "fill
   the empty nights" hands it the empty ones, "re-roll" hands it every night held by an
   unpinned run. The nights being redrawn don't count as taken — otherwise a re-roll could
   only ever draw from what the calendar had left over, which on a full month is nothing.

   With a pace set this is a packer rather than a dealer: it walks the month, measures each
   stretch of nights it is allowed to use, and takes the first shuffled game that FITS. A game
   longer than the stretch is skipped rather than clipped, because a fifteen-hour game crammed
   into two nights is a plan that was never true. At one game per night every span is 1, every
   game fits, and this is the old behaviour exactly. */
function spookRoll(days) {
  if (!days.length) return { games: 0, nights: 0 };
  const redrawing = new Set(days.map(String));
  const nights = spookNightsObj();
  for (const d of redrawing) delete nights[d];
  /* The pool is already the unfinished shelf — spookPool drops anything you've beaten — so
     the only thing left to hold back here is what the OTHER nights are already holding.
     There is deliberately no fallback to finished games when the shelf runs dry before the
     31st: a night left empty says "you're out of unplayed horror", which is true and useful,
     where a game you finished in 2019 quietly filling the gap is neither. A stretch that
     nothing SHORT enough fits stays empty for the same reason. */
  const taken = new Set(Object.values(nights).map(String));
  const pool = spookPool().filter((r) => !taken.has(String(r._k || "")));
  for (let i = pool.length - 1; i > 0; i--) {          // Fisher–Yates
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const free = (d) => redrawing.has(String(d)) && !nights[String(d)];
  let games = 0, covered = 0;
  for (let d = 1; d <= SPOOK_NIGHTS; d++) {
    if (!free(d)) continue;
    let gap = 0;
    while (free(d + gap)) gap++;
    const at = pool.findIndex((r) => spookSpan(r) <= gap);
    if (at < 0) continue;
    const [row] = pool.splice(at, 1);
    const span = spookSpan(row);
    for (let x = d; x < d + span; x++) nights[String(x)] = String(row._k || "");
    games++;
    covered += span;
    d += span - 1;
  }
  spookSave();
  return { games, nights: covered };
}

// Would a game of `span` nights fit at `from`, inside the month and clear of what's placed?
function spookFits(nights, from, span) {
  if (from + span - 1 > SPOOK_NIGHTS) return false;
  for (let d = from; d < from + span; d++) if (nights[String(d)]) return false;
  return true;
}

/* Change the pace under a calendar and the games on it are still laid out to the old one: 31
   one-night games do not become six because a dropdown moved. Re-rolling somebody's month
   behind them would be the wrong answer to a question they only asked about pace, so the
   change is inert, the mismatch is visible on the cards, and this is the button that acts on
   it — keeping the games, their order, and every pinned run's start night, and re-laying each
   one at the length it now needs. Games that no longer fit anywhere fall off the end and
   nothing is drawn to replace them; drawing is what Fill is for. */
function spookRepack() {
  const runs = spookRuns().filter((r) => r.row);
  const pinned = runs.filter((r) => spookIsPinned(r.start));
  const loose = runs.filter((r) => !spookIsPinned(r.start));
  const nights = spookNightsObj();
  for (const d of Object.keys(nights)) delete nights[d];
  // Pins keep their start night, in date order. A pinned run that now overruns the next
  // pinned start gets clipped by it: the later pin is a promise too, and it names a night.
  for (const r of pinned) {
    const end = Math.min(SPOOK_NIGHTS, r.start + spookSpan(r.row) - 1);
    for (let d = r.start; d <= end; d++) nights[String(d)] = r.key;
  }
  let dropped = 0;
  for (const r of loose) {
    const span = spookSpan(r.row);
    let at = 0;
    for (let d = 1; d + span - 1 <= SPOOK_NIGHTS; d++) if (spookFits(nights, d, span)) { at = d; break; }
    if (!at) { dropped++; continue; }
    for (let d = at; d < at + span; d++) nights[String(d)] = r.key;
  }
  spookSave();
  return { games: runs.length - dropped, dropped };
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
/* "19 of 31 nights planned", plus the game count once a game can hold more than one night. At
   a pace those two numbers are different and the interesting one is the games — 28 nights is
   the same month whether it took you five games or twenty-eight. */
function spookPlanText() {
  const filled = spookFilled();
  const base = `${filled} of ${SPOOK_NIGHTS} nights planned`;
  const games = spookGames();
  return spookHpd() && games ? `${base} · ${games} game${games === 1 ? "" : "s"}` : base;
}

function spookPitch() {
  const st = spookPhase();
  const filled = spookFilled();
  if (st.phase === "before") {
    const away = st.days === 1 ? "one night" : `${st.days} nights`;
    return filled
      ? `${spookPlanText()} · October is ${away} away`
      : `October is ${away} away. Line up 31 nights of horror.`;
  }
  if (st.phase === "during") {
    // Which night OF the game, not just of the month: on a paced calendar "tonight" is
    // usually the middle of something, and that is the fact you came to the page for.
    const run = spookRunAt(st.day);
    if (run && run.row) {
      const which = run.len > 1 ? ` · night ${st.day - run.start + 1} of ${run.len}` : "";
      return `Tonight, night ${st.day}: ${String(run.row.title || "")}${which}`;
    }
    return `Night ${st.day} has nothing on it yet · ${filled} of ${SPOOK_NIGHTS} planned`;
  }
  return filled
    ? `That's a wrap on October — ${spookPlanText()}. Take one more look.`
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

/* A night's cell. `run` is the run STARTING here, or null for an empty night — the middle
   nights of a run go to spookContHtml below. */
function spookNightHtml(day, run) {
  const row = run ? run.row : null;
  const st = spookPhase();
  const isToday = st.phase === "during" && st.day === day;
  const past = (st.phase === "during" && day < st.day) || st.phase === "after";
  const pinned = !!row && spookIsPinned(day);
  // Dealt in the order the dice touched them, capped so the last card isn't a wait.
  const deal = SPOOK.dealt ? SPOOK.dealt.indexOf(day) : -1;
  const cls = ["spk-night", row ? "filled" : "spk-empty", isToday ? "today" : "", past ? "past" : "",
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
  /* At a pace the card has to say how much of the month this game is taking: the nights it
     books are the whole reason for setting one, and a cover with no number under it looks
     exactly like the one-a-night calendar. `warn` is a run still laid out to a pace that
     isn't the current pace — see spookRepack. */
  const hrs = spookHoursFor(row);
  const span = spookSpan(row);
  const want = spookWant(day, row);
  const nights = run.len > 1 ? `nights ${run.start}–${run.end}` : "one night";
  let pace = "";
  if (spookHpd()) {
    if (run.len !== want) {
      pace = `<span class="spk-span warn">needs ${want} night${want === 1 ? "" : "s"}</span>`;
    } else if (span > run.len) {
      // Placed by hand against the end of the month: it gets the nights that are left, and
      // the card says how many it would actually take rather than implying October covers it.
      pace = `<span class="spk-span warn">${nights} · ${span} to finish it</span>`;
    } else {
      pace = `<span class="spk-span">${nights}${hrs != null ? ` · ${fmtHours(hrs)}` : " · untimed"}</span>`;
    }
  }
  const range = run.len > 1 ? `October ${run.start}–${run.end}` : `October ${day}`;
  return `<div class="${cls}"${delay}>${num}
    <button class="spk-pin" data-pin="${day}" aria-pressed="${pinned}"
      title="${pinned ? `${range} is pinned — the dice will leave it alone` : `Pin ${range} so a re-roll keeps it`}">${icon("i-pin", 13)}</button>
    <button class="spk-slot" data-open="${k}" title="Open ${escapeHtml(String(row.title))}">
      ${cover}
      <span class="spk-slot-t">${escapeHtml(String(row.title))}</span>
      <span class="spk-slot-s">${escapeHtml(String(row.platform || ""))}</span>
      ${pace}
    </button>
    <span class="spk-night-acts">
      <button class="spk-swap" data-day="${day}" data-mode="swap" aria-label="Change the game on ${range}">Change</button>
      <button class="spk-x" data-clear="${day}" aria-label="Clear ${range}">${icon("i-close", 13)}</button>
    </span>
  </div>`;
}

/* The nights in the MIDDLE of a run. The grid is seven columns wide and a run can be ten
   nights long, so a run cannot be one wide cell without October losing its shape — every
   night it covers keeps its own cell instead, and these are the quiet ones: no cover, no
   buttons of their own, the title once more so a block reads without counting back to its
   head. Tapping one is tapping the run, so it opens the picker on the run's first night. */
function spookContHtml(day, run) {
  const st = spookPhase();
  const isToday = st.phase === "during" && st.day === day;
  const past = (st.phase === "during" && day < st.day) || st.phase === "after";
  const deal = SPOOK.dealt ? SPOOK.dealt.indexOf(day) : -1;
  const cls = ["spk-night", "spk-cont", isToday ? "today" : "", past ? "past" : "",
    spookIsPinned(run.start) ? "pinned" : "", deal >= 0 ? "spk-dealt" : ""].filter(Boolean).join(" ");
  const delay = deal >= 0 ? ` style="--d:${Math.min(deal, 24) * 34}ms"` : "";
  const title = String((run.row && run.row.title) || "");
  return `<div class="${cls}"${delay}>
    <span class="spk-num">${day}${isToday ? `<em>tonight</em>` : ""}</span>
    <button class="spk-cont-in" data-day="${run.start}" data-mode="swap"
      title="Change the game on October ${run.start}–${run.end}">
      <span class="spk-cont-t">${escapeHtml(title)}</span>
      <span class="spk-cont-n">night ${day - run.start + 1} of ${run.len}</span>
    </button>
  </div>`;
}

// October, cell by cell: a run's first night is a card, the rest are continuations.
function spookGridHtml() {
  const byDay = new Map();
  for (const r of spookRuns()) for (let d = r.start; d <= r.end; d++) byDay.set(d, r);
  const out = [];
  for (let d = 1; d <= SPOOK_NIGHTS; d++) {
    const run = byDay.get(d);
    // A run whose game is no longer on the sheet resolves to nothing, and an empty cell is
    // the honest rendering of it — Fill treats those nights as empty too.
    if (!run || !run.row) out.push(spookNightHtml(d, null));
    else if (run.start === d) out.push(spookNightHtml(d, run));
    else out.push(spookContHtml(d, run));
  }
  return out.join("");
}

// The picker: the eligible pool, filtered by the search box, capped at what a person will
// actually look at. Split out of renderSpooktober so a keystroke repaints THIS list and
// nothing else — a full render would take the focus out of the box you're typing in.
function spookResultsHtml() {
  const used = new Map(spookRuns().map((r) => [r.key, r]));
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
    const where = on
      ? `<span class="spk-taken">${on.len > 1 ? `Nights ${on.start}–${on.end}` : `On night ${on.start}`}</span>`
      : (SPOOK.all && spookIsDone(r) ? `<span class="spk-fin">Finished</span>` : "");
    /* What choosing this one COSTS, in nights, before you choose it — picking a fifty-hour
       game for the 28th at two hours a night is a thing you should be able to see coming
       rather than discover from the grid afterwards (it gets clipped at the 31st). */
    const span = spookSpan(r);
    const over = SPOOK.picking != null && SPOOK.picking + span - 1 > SPOOK_NIGHTS;
    const cost = !spookHpd() ? ""
      : `<span class="spk-cost${over ? " warn" : ""}">${span} night${span === 1 ? "" : "s"}` +
        `${spookHoursFor(r) == null ? " · untimed" : ""}${over ? " · runs past the 31st" : ""}</span>`;
    const note = where + cost;
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
  const run = spookRunAt(SPOOK.picking);
  const on = run && run.row ? String(run.row.title || "") : "";
  // The heading names the nights you are choosing FOR, which on a paced calendar is the run
  // you are about to replace rather than the single night you clicked.
  const head = run && run.row && run.len > 1
    ? `October ${run.start}–${run.end}` : `October ${SPOOK.picking}`;
  return `<div class="spk-picker${SPOOK.opening ? " spk-in" : ""}" id="spookPicker">
    <div class="spk-picker-head">
      <b>${head}</b>
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
  const runs = spookRuns().filter((r) => r.row);
  const pinned = runs.filter((r) => spookIsPinned(r.start)).length;
  // Games, not nights: at one game per night they are the same number, and at a pace the
  // dice deal in games. "Re-roll 23 unpinned" on a six-game month would be a lie.
  const rerollable = runs.length - pinned;
  const misfit = spookMisfits().length;
  const hpd = spookHpd();
  const paceSel = SPOOK_PACES.map((p) =>
    `<option value="${p}"${p === hpd ? " selected" : ""}>${SPOOK_PACE_LABELS[p]}</option>`).join("");
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
          <span class="spk-meter-t">${escapeHtml(spookPlanText())}</span>
        </div>
        <div class="spk-acts">
          ${filled < SPOOK_NIGHTS ? `<button class="btn" id="spookFill">${icon("i-dice", 15)} Fill the empty nights</button>` : ""}
          ${rerollable ? `<button class="btn${filled < SPOOK_NIGHTS ? " ghost" : ""}" id="spookReroll">${icon("i-refresh", 15)} Re-roll ${rerollable} unpinned</button>` : ""}
          ${misfit ? `<button class="btn ghost" id="spookRepack">${icon("i-refresh", 15)} Re-pack the month</button>` : ""}
          ${filled ? `<button class="btn ghost" id="spookReset">Clear the calendar</button>` : ""}
        </div>
        <div class="spk-pace">
          <label for="spookHpd">How long is a night?</label>
          <select id="spookHpd" class="spk-pace-sel">${paceSel}</select>
          <span class="spk-pace-note">${hpd
            ? `A game books as many nights as it needs — ${SPOOK_NIGHTS} nights is ${fmtHours(hpd * SPOOK_NIGHTS)} of horror.`
            : "A game takes one night, however long it is."}</span>
        </div>
        ${misfit ? `<p class="spk-pinnote">${icon("i-clock", 12)} ${misfit} game${misfit === 1 ? "" : "s"} still laid out to a different pace — re-pack to spread ${misfit === 1 ? "it" : "them"} out.</p>` : ""}
        ${pinned ? `<p class="spk-pinnote">${icon("i-pin", 12)} ${pinned} pinned — a re-roll leaves ${pinned === 1 ? "it" : "them"} alone.</p>` : ""}
      </div>
    </section>
    <div class="spk-wrap">
      <div class="spk-grid">${spookGridHtml()}</div>
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
      SPOOK.mode = el.dataset.mode === "swap" ? "swap" : "fill";
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
      // "The next empty night" already steps over the run that was just placed, so filling a
      // paced month walks game to game without the picker having to know about spans.
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
    const res = spookRoll(days);
    SPOOK.picking = null;
    SPOOK.dealt = days.slice().sort((a, b) => a - b);
    renderSpooktober();
    if (typeof showToast === "function") showToast(done(res));
  };

  // At one game per night the two numbers are the same and saying both is noise.
  const rollText = (verb, res) => (spookHpd()
    ? `${verb} ${res.games} game${res.games === 1 ? "" : "s"} across ${res.nights} night${res.nights === 1 ? "" : "s"}`
    : `${verb} ${res.nights} night${res.nights === 1 ? "" : "s"}`);

  const fill = document.getElementById("spookFill");
  if (fill) fill.onclick = () => {
    const empty = spookNights().filter(([, r]) => !r).map(([d]) => d);
    if (!empty.length) { if (typeof showToast === "function") showToast("Every night is spoken for"); return; }
    roll(empty, (res) => (res.games
      ? rollText("Filled", res)
      : "Nothing on the shelf is short enough for the nights that are left"));
  };

  // Re-roll leaves the pinned runs exactly where they are — that is what a pin is for.
  const reroll = document.getElementById("spookReroll");
  if (reroll) reroll.onclick = () => {
    const loose = spookRuns().filter((r) => r.row && !spookIsPinned(r.start));
    if (!loose.length) { if (typeof showToast === "function") showToast("Every night is pinned"); return; }
    const days = [];
    for (const r of loose) for (let d = r.start; d <= r.end; d++) days.push(d);
    const held = spookGames() - loose.length;
    roll(days, (res) => `${rollText("Re-rolled", res)}${held ? ` · ${held} pinned` : ""}`);
  };

  /* The pace. Changing it does not touch the calendar — see spookRepack — so the grid you get
     back is the one you had, now measured against the new number and saying where it doesn't
     fit. The re-pack button appears in the same repaint. */
  const hpd = document.getElementById("spookHpd");
  if (hpd) hpd.onchange = () => {
    spookSetHpd(hpd.value);
    SPOOK.picking = null;
    renderSpooktober();
    if (typeof patchSpookBanner === "function") patchSpookBanner();
  };

  const repack = document.getElementById("spookRepack");
  if (repack) repack.onclick = () => {
    const before = spookRuns().filter((r) => r.row).map((r) => r.start);
    const res = spookRepack();
    SPOOK.picking = null;
    SPOOK.dealt = spookRuns().filter((r) => r.row && !before.includes(r.start)).map((r) => r.start);
    renderSpooktober();
    if (typeof showToast === "function") {
      showToast(`Re-packed into ${res.games} game${res.games === 1 ? "" : "s"}` +
        (res.dropped ? ` · ${res.dropped} no longer fit${res.dropped === 1 ? "s" : ""}` : ""));
    }
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

/* ---- registration ----------------------------------------------------------
   events.js (1.63.0) took over the four pieces every event shares: the window test, the
   Home banner slot, the prefs merge and the preview board. Spooktober keeps its own tab,
   its own host and its own render path — it shipped that way and there is nothing to gain
   by moving it — so it registers as `external` and hands the registry the two things the
   registry decides: when its banner is allowed on Home, and what beats it when two seasons
   overlap. Its calendar stays in its own prefs key ("spooktober"), untouched. */
if (typeof evRegister === "function") {
  evRegister({
    id: "spooktober",
    external: true,
    name: "Spooktober",
    icon: "i-pumpkin",
    structure: "Calendar",
    priority: 100,
    window: { from: [SPOOK_START.m + 1, SPOOK_START.d], to: [SPOOK_END.m + 1, SPOOK_END.d] },
    core: { from: [10, 1], to: [10, 31] },
    cta: "Build your calendar",
    blurb: "31 nights of horror, paced how you play",
    bannerHtml: () => spookBannerHtml(),
    pitch: () => spookPitch(),
    meter: () => {
      const filled = spookFilled();
      return { pct: Math.round((filled / SPOOK_NIGHTS) * 100), text: spookPlanText() };
    },
    render: () => renderSpooktober(),
  });
}
