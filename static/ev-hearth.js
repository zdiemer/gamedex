"use strict";

/* Hearth — the cozy season, and the one event that refuses to have a deadline.

   Spooktober gives the backlog a deadline on purpose: 31 nights, one game each, a date on
   every one of them. Cozy is the season where that would be the wrong idea. So this is a
   SHELF OF SIX with no dates on it, nothing that expires, and no dice button. December 20
   takes the banner away; it does not take the shelf away.

   Six is the number because it is a season's worth of evenings rather than a month's worth
   of obligations, and because a shelf you can see all of is a shelf you might actually
   finish. */

const HEARTH_N = 6;

/* The pool, and the honest note about it: inverting Spooktober's horror test is harder than
   it looks. The obvious version — Simulation, Visual Novel, Puzzle and Adventure under 25
   hours — returns about a fifth of the whole collection, because those four genres are
   enormous. So rung 1 is IGDB keywords that name the thing itself, rung 2 is the narrow
   genre list, and everything the horror pool claims is subtracted from both: the sheet has
   a game called The Boba Teashop filed under Survival Horror. */
const HEARTH_KW = new Set([
  "wholesome", "cozy", "relaxing", "farming", "life simulation", "slice of life",
  "farming sim", "gardening", "fishing", "cooking", "decorating", "cottagecore",
]);
const HEARTH_GENRES = new Set(["Simulation", "Visual Novel"]);

function hearthIsCozy(row) {
  // Never anything the horror pool wants. A cozy shelf with Silent Hill on it is a joke
  // the second time and a bug the first.
  if (typeof spookIsHorror === "function" && spookIsHorror(row)) return false;
  if (/horror/i.test(String(row.genre || ""))) return false;
  const e = evEnrich(row);
  const kw = e && e.igdbId ? (e.keywords || []).map((k) => String(k).toLowerCase()) : [];
  if (kw.some((k) => HEARTH_KW.has(k))) return true;
  const hrs = row.estimatedTime == null ? 99 : +row.estimatedTime;
  return HEARTH_GENRES.has(String(row.genre || "")) && hrs <= 30;
}
const hearthPool = () => evPool("hearth", (r) => evOwnedUnfinished(r) && hearthIsCozy(r));

/* ---- state ---------------------------------------------------------------- */
const hearthState = () => {
  const st = evState("hearth");
  if (!Array.isArray(st.shelf)) st.shelf = new Array(HEARTH_N).fill(null);
  while (st.shelf.length < HEARTH_N) st.shelf.push(null);
  if (!Array.isArray(st.lit)) st.lit = [];
  return st;
};
const hearthLit = () => hearthState().shelf.filter((k) => k && hearthState().lit.includes(k)).length;
const hearthFilled = () => hearthState().shelf.filter(Boolean).length;

function hearthSet(slot, key) {
  const st = hearthState();
  // A game can only hold one place on a shelf of six. Assigning one that is already up
  // there moves it, and the slot it came from takes whatever was in the new one.
  const at = st.shelf.indexOf(key);
  if (at >= 0 && at !== slot) st.shelf[at] = st.shelf[slot];
  st.shelf[slot] = key;
  evSave();
}
function hearthClear(slot) {
  const st = hearthState();
  const key = st.shelf[slot];
  st.shelf[slot] = null;
  st.lit = st.lit.filter((k) => k !== key);
  evSave();
}
function hearthToggleLit(key) {
  const st = hearthState();
  const i = st.lit.indexOf(key);
  if (i >= 0) st.lit.splice(i, 1); else st.lit.push(key);
  evSave();
}

evRegister({
  id: "hearth",
  name: "Hearth",
  icon: "i-flame",
  structure: "Shelf",
  priority: 70,
  window: { from: [11, 8], to: [12, 20] },
  core: { from: [11, 8], to: [12, 20] },
  cta: "Set the mantel",
  blurb: "six cozy games, no dates on any of them",
  skin: "--ev-disp:'Caveat',var(--display);--ev-size:64px;--ev-dw:700;--ev-ls:0;" +
        "--ev-deco:#e2a05c;--ev-fg:#f4e8da;--ev-fg-2:#cfbba4;--ev-edge:rgba(226,160,92,.32);" +
        "--ev-edge-hi:rgba(240,184,120,.62);--ev-glow:rgba(226,140,60,.3);--ev-t1:#fff4e6;" +
        "--ev-t2:#f0b878;--ev-t3:#d98a4a;--ev-on-cta:#2a1704;--ev-k:#f0b878;" +
        "--ev-art:radial-gradient(110% 150% at 80% 120%,rgba(226,140,60,.28),transparent 58%)," +
        "radial-gradient(80% 120% at 6% -15%,rgba(120,140,80,.20),transparent 60%)," +
        "linear-gradient(150deg,#140f0c,#1e150f 70%,#241a13)",
  deco: [
    { i: "i-flame", x: 86, y: 68, s: 46, lift: 12 },
    { i: "i-mug", x: 70, y: 80, s: 28, r: -7, lift: 9, d: 90 },
    { i: "i-leaf", x: 24, y: 20, s: 26, r: -18, lift: 14, d: 40 },
    { i: "i-leaf", x: 47, y: 86, s: 20, r: 24, lift: 8, d: 200 },
    { i: "i-book", x: 88, y: 22, s: 26, r: 8, lift: 11, d: 140 },
    { i: "i-moon", x: 60, y: 14, s: 20, lift: 13, d: 220, o: .75 },
  ],
  blank: () => ({ shelf: new Array(HEARTH_N).fill(null), lit: [] }),
  merge: (mine, theirs) => {
    let changed = false;
    (theirs.shelf || []).forEach((k, i) => {
      // Fill gaps, never overwrite: a slot you filled here is a decision, and the other
      // device's copy of that slot is at best the same decision.
      if (k && !mine.shelf[i] && !mine.shelf.includes(k)) { mine.shelf[i] = k; changed = true; }
    });
    for (const k of theirs.lit || []) if (!mine.lit.includes(k)) { mine.lit.push(k); changed = true; }
    return changed;
  },
  eyebrow: () => "Seasonal event · after the ghosts",
  pitch: () => {
    const filled = hearthFilled(), lit = hearthLit();
    if (!filled) return "Six games on the mantel, no dates on any of them. The shelf is empty.";
    if (lit === HEARTH_N) return "Six for six. The whole mantel is lit.";
    if (!lit) return `${evPlural(filled, "game", "games")} on the mantel. Nothing lit yet, and nothing is asking you to hurry.`;
    return `${lit} of ${filled} lit. No dates, no deadline.`;
  },
  meter: () => {
    const filled = hearthFilled();
    if (!filled) return { pct: null, text: "an empty mantel, and no hurry" };
    return { pct: Math.round((hearthLit() / HEARTH_N) * 100), text: `${hearthLit()} of ${HEARTH_N} lit` };
  },
  render: hearthRender,
  reset: () => { EVP.slot = null; EVP.q = ""; EVP.all = false; },
});
