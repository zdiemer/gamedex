"use strict";

/* 24 Doors — the December advent calendar.

   The inverse of Spooktober's contract. That calendar is a PLAN with no answer: you fill
   it, you change your mind, nothing is hidden. This one is AN ANSWER YOU CANNOT SEE. The
   month is drawn once, saved immediately, and no door renders its game before its date.

   There is no picker, on purpose. What there is instead is two swap tokens for the whole
   month, because a door you genuinely cannot face on a Tuesday is worse than a small
   escape hatch — and two is few enough that spending one is a decision.

   Why the drawn keys are SAVED rather than regenerated from a seed: the pool moves. Games
   get added, enrichment lands, a title stops matching. A seed would quietly rewrite door 4
   into a different game a week after you played it, and the record of what you played is
   the only thing this calendar leaves behind. */

const DOORS_N = 24;
const DOORS_SWAPS = 2;

/* The pool. Here — and only here — matching on a NOUN is the right call: the thing that
   makes a game a December game is that it is about winter, and IGDB's keywords carry that
   directly. The regex is over titles because the sheet has no seasonal column, and it is
   deliberately made of things that are the SUBJECT of a game rather than scenery: "ice"
   catches Ice Climber and also Iceborne, which is the trade this pool is happy to make at
   37 candidates for 24 doors. */
/* Prefix matches, so "Frostpunk" and "Iceborne" count. NOT "advent", which was in the
   first draft and matched Adventure, Adventures and Adventurer — 90 of the 124 games it
   put in the pool. An advent-titled game is caught by the keyword rung instead. */
const DOORS_RE = /\b(snow|ice|winter|christmas|santa|frost|holiday|elf|reindeer|jingle|yeti|penguin|blizzard|arctic|polar|sled|krampus|solstice)/i;
/* Keywords that name the OCCASION, never the weather. The first draft had "snow", "ice",
   "winter" and "holiday" in here and put Lacuna: A Sci-Fi Noir Adventure behind door 9,
   because IGDB tags snow on anything with snow in it. Same lesson as the horror pool, one
   season later: a season is what a game is ABOUT, not what falls in it. */
const DOORS_KW = new Set([
  "christmas", "santa claus", "christmas tree", "advent calendar", "winter holiday",
]);

function doorsIsWinter(row) {
  if (DOORS_RE.test(String(row.title || ""))) return true;
  const e = evEnrich(row);
  if (!e || !e.igdbId) return false;
  return (e.keywords || []).some((k) => DOORS_KW.has(String(k).toLowerCase()));
}
const doorsPool = () => evPool("doors", (r) => evOwnedUnfinished(r) && doorsIsWinter(r));

// Door 25 is not drawn from the pool at all: it is the best thing you own and haven't
// finished, which is the only present this app is in a position to give you.
function doorsGift() {
  const rate = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : (r.metacriticRating || 0));
  return evPool("doors-gift", evOwnedUnfinished).slice().sort((a, b) => rate(b) - rate(a))[0] || null;
}

/* ---- state ---------------------------------------------------------------- */
const doorsYearState = () => {
  const st = evState("doors");
  const y = String(evYear(EV.byId.doors));
  if (!st.years[y]) st.years[y] = { doors: {}, opened: [], swaps: DOORS_SWAPS };
  return st.years[y];
};
const doorsDrawn = () => Object.keys(doorsYearState().doors).length > 0;
const doorsIsOpen = (n) => doorsYearState().opened.includes(+n);

// Which doors the date allows. In December it is "up to today"; before December, none;
// after, all of them — the calendar becomes a record the moment the month is over.
function doorsUnlocked(n) {
  const st = evPhase(EV.byId.doors);
  if (st.phase === "before") return false;
  if (st.phase === "after") return true;
  return +n <= st.day;
}

/* The draw. Shortest games first, then the longest ones moved onto the weekends of that
   actual December, because a 12-hour game behind a Wednesday door is a door you skip. */
function doorsDraw() {
  const st = doorsYearState();
  const pool = doorsPool();
  const gift = doorsGift();
  const picks = evDraw(pool, DOORS_N, gift ? [evKey(gift)] : []);
  if (!picks.length) return 0;
  const hours = (r) => (r.estimatedTime == null ? 6 : +r.estimatedTime);
  picks.sort((a, b) => hours(a) - hours(b));
  const year = evYear(EV.byId.doors);
  const days = [];
  for (let d = 1; d <= DOORS_N; d++) days.push(d);
  const weekend = days.filter((d) => [0, 6].includes(new Date(year, 11, d).getDay()));
  const weekday = days.filter((d) => !weekend.includes(d));
  const order = weekday.concat(weekend);          // short games on weeknights, long on weekends
  st.doors = {};
  order.forEach((day, i) => { if (picks[i]) st.doors[String(day)] = evKey(picks[i]); });
  if (gift) st.doors["25"] = evKey(gift);
  st.opened = [];
  st.swaps = DOORS_SWAPS;
  evSave();
  return picks.length;
}

function doorsOpen(n) {
  const st = doorsYearState();
  if (!st.opened.includes(+n)) { st.opened.push(+n); evSave(); }
}

function doorsSwap(n) {
  const st = doorsYearState();
  if (st.swaps <= 0 || st.opened.includes(+n)) return false;
  const taken = Object.values(st.doors);
  const pick = evDraw(doorsPool(), 1, taken)[0];
  if (!pick) return false;
  st.doors[String(n)] = evKey(pick);
  st.swaps--;
  evSave();
  return true;
}

/* ---- the page ------------------------------------------------------------- */
function doorsHtml(n) {
  const st = doorsYearState();
  const key = st.doors[String(n)];
  const row = key ? evRow(key) : null;
  const open = doorsIsOpen(n) && row;
  const unlocked = doorsUnlocked(n);
  const gift = n === 25;
  const today = evPhase(EV.byId.doors).day === n;
  const cls = ["ev-door", open ? "open" : "shut", unlocked ? "unlocked" : "locked",
               today ? "today" : "", gift ? "gift" : ""].filter(Boolean).join(" ");
  const num = `<span class="ev-door-n">${n}${today ? "<em>today</em>" : ""}</span>`;
  if (!key) {
    return `<div class="${cls}">${num}<span class="ev-door-empty">${icon("i-gift", 22)}</span></div>`;
  }
  if (!open) {
    return `<div class="${cls}">${num}
      <button class="ev-door-face" ${unlocked ? `data-doorsopen="${n}"` : "disabled"}
        title="${unlocked ? `Open door ${n}` : `Door ${n} opens on December ${n}`}">
        ${icon(gift ? "i-gift" : "i-door", gift ? 34 : 30)}
        <span>${unlocked ? "Open" : `Dec ${n}`}</span>
      </button>
      ${unlocked || st.swaps <= 0 ? "" :
        `<button class="ev-door-swap" data-doorsswap="${n}" title="Swap this door for another game (${st.swaps} left)">${icon("i-refresh", 12)}</button>`}
    </div>`;
  }
  return `<div class="${cls}">${num}
    ${evTileHtml(row, { sub: `${row.platform || ""}${row.estimatedTime ? " · " + evHours(row.estimatedTime) : ""}` })}
  </div>`;
}

function doorsRender(host) {
  const ev = EV.byId.doors;
  const st = doorsYearState();
  const drawn = doorsDrawn();
  const opened = st.opened.length;
  const acts = drawn
    ? `<button class="btn ghost" id="doorsRedraw">${icon("i-dice", 15)} Draw a new month</button>
       <span class="ev-tokens">${icon("i-refresh", 13)} ${evPlural(st.swaps, "swap", "swaps")} left</span>`
    : `<button class="btn" id="doorsDraw">${icon("i-dice", 15)} Draw the month</button>`;
  const pool = doorsPool().length;

  host.innerHTML = evHeroHtml(ev, {
    acts,
    note: drawn ? "" : `${pool} winter games on your shelf, ${DOORS_N} doors, drawn once. Nothing is shown before its date.`,
    beforeNote: drawn ? "Drawn and sealed. The first door opens on December 1." : "",
  }) + `<div class="ev-wrap">
      <div class="ev-doors">${Array.from({ length: 25 }, (_, i) => doorsHtml(i + 1)).join("")}</div>
      ${drawn ? "" : `<p class="ev-none">The calendar is empty until you draw it. ${pool < DOORS_N
        ? `Only ${pool} winter games are on the shelf right now, so some doors will stay shut.` : ""}</p>`}
    </div>`;

  host.querySelectorAll("[data-doorsopen]").forEach((el) => {
    el.onclick = () => { doorsOpen(+el.dataset.doorsopen); doorsRender(host); evWireTiles(host); };
  });
  host.querySelectorAll("[data-doorsswap]").forEach((el) => {
    el.onclick = () => {
      if (doorsSwap(+el.dataset.doorsswap)) showToast(`Swapped. ${evPlural(doorsYearState().swaps, "swap", "swaps")} left`);
      else showToast("No swaps left");
      doorsRender(host); evWireTiles(host);
    };
  });
  const draw = document.getElementById("doorsDraw") || document.getElementById("doorsRedraw");
  if (draw) draw.onclick = () => {
    if (drawn && !confirm("Draw a new month? Everything behind the doors changes, including the ones you have already opened.")) return;
    const n = doorsDraw();
    showToast(n ? `${n} doors drawn` : "No winter games found on the shelf");
    doorsRender(host); evWireTiles(host);
  };
  if (typeof maybeEnrich === "function") {
    maybeEnrich(Object.values(st.doors).map(evRow).filter(Boolean).concat(doorsPool().slice(0, 30)));
  }
}

evRegister({
  id: "doors",
  name: "24 Doors",
  icon: "i-door",
  structure: "Reveal",
  priority: 95,
  window: { from: [11, 24], to: [1, 6] },
  core: { from: [12, 1], to: [12, 25] },
  cta: "Open today’s door",
  blurb: "a December calendar you cannot read ahead",
  skin: "--ev-disp:'Mountains of Christmas',var(--display);--ev-size:58px;--ev-dw:700;--ev-ls:0;" +
        "--ev-deco:#d9b460;--ev-fg:#f3ece0;--ev-fg-2:#d3c9b6;--ev-edge:rgba(217,180,96,.34);" +
        "--ev-edge-hi:rgba(232,200,119,.7);--ev-glow:rgba(217,180,96,.32);--ev-t1:#fffaf0;" +
        "--ev-t2:#e8c877;--ev-t3:#c9a24a;--ev-on-cta:#211705;--ev-k:#e8c877;" +
        "--ev-art:radial-gradient(120% 150% at 84% 120%,rgba(198,42,42,.26),transparent 56%)," +
        "radial-gradient(90% 130% at 6% -20%,rgba(56,122,86,.30),transparent 60%)," +
        "linear-gradient(140deg,#06110e,#0c1c15 70%,#132018)",
  deco: [
    { i: "i-door", x: 87, y: 66, s: 46, r: -4, lift: 12 },
    { i: "i-snow", x: 22, y: 18, s: 24, lift: 14, d: 30, o: .7 },
    { i: "i-snow", x: 52, y: 12, s: 16, lift: 16, d: 150, o: .55 },
    { i: "i-snow", x: 38, y: 78, s: 18, lift: 10, d: 240, o: .6 },
    { i: "i-tree", x: 68, y: 80, s: 30, lift: 9, d: 90 },
    { i: "i-bauble", x: 72, y: 20, s: 26, r: 6, lift: 13, d: 180 },
    { i: "i-gift", x: 95, y: 28, s: 24, r: -8, lift: 11, d: 120 },
    { i: "i-star", x: 60, y: 62, s: 18, lift: 8, d: 260, o: .7 },
  ],
  blank: () => ({ years: {} }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [y, t] of Object.entries(theirs.years || {})) {
      const m = mine.years[y];
      if (!m) { mine.years[y] = t; changed = true; continue; }
      // Doors are written once. If this browser has none for that year, take theirs whole —
      // half a drawn month from each device would be two different Decembers spliced together.
      if (!Object.keys(m.doors || {}).length && Object.keys(t.doors || {}).length) { m.doors = t.doors; changed = true; }
      for (const n of t.opened || []) if (!m.opened.includes(n)) { m.opened.push(n); changed = true; }
      // A swap spent anywhere is spent. Taking the lower count is the only answer that
      // cannot hand you a third token by opening the app on a second device.
      if (typeof t.swaps === "number" && t.swaps < m.swaps) { m.swaps = t.swaps; changed = true; }
    }
    return changed;
  },
  eyebrow: () => "Seasonal event · December",
  pitch: () => {
    const st = evPhase(EV.byId.doors);
    const s = doorsYearState();
    if (!doorsDrawn()) return st.phase === "before"
      ? `December is ${evPlural(st.days, "day", "days")} away. Draw ${DOORS_N} doors and don't look.`
      : "The calendar hasn't been drawn yet. Draw it, then open today's door.";
    if (st.phase === "before") return `Sealed and waiting. The first door opens in ${evPlural(st.days, "day", "days")}.`;
    if (st.phase === "after") return `${evPlural(s.opened.length, "door", "doors")} opened. The whole month is unlocked now.`;
    const today = s.doors[String(st.day)];
    const row = today ? evRow(today) : null;
    if (row && doorsIsOpen(st.day)) return `Door ${st.day}: ${String(row.title || "")}.`;
    return `Door ${st.day} is closed. ${evPlural(s.opened.length, "door", "doors")} opened so far.`;
  },
  meter: () => {
    const s = doorsYearState();
    if (!doorsDrawn()) return null;
    return { pct: Math.round((s.opened.length / 25) * 100),
             text: `${s.opened.length} of 25 opened · ${evPlural(s.swaps, "swap", "swaps")} left` };
  },
  render: doorsRender,
  reset: () => {},
});
