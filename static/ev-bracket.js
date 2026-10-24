"use strict";

/* The Backlog Bracket — the only event with a RESULT.

   Sixteen seeds out of the games you told the sheet you would play, seeded by rating so
   the fixtures are not arbitrary, one match a day, four rounds, one winner. April's job is
   to play it.

   The interaction is a single binary choice, and that is exactly why it works: nobody can
   rank 939 games, and everybody can answer "this one or that one" fifteen times.

   The state is a TREE, not a map, which changes how it reconciles. A vote is immutable
   once cast — you are not allowed to relitigate round one after seeing the final — and
   later rounds are DERIVED rather than stored, so there is never a saved bracket that
   disagrees with its own votes. */

const BR_SEEDS = 16;
// Standard bracket seeding: the 1 seed meets the 16, and the two best cannot meet before
// the final. Written out rather than computed, because the computed version is four lines
// of modular arithmetic that nobody can read at a glance.
const BR_ORDER = [[0, 15], [7, 8], [4, 11], [3, 12], [5, 10], [2, 13], [6, 9], [1, 14]];
const BR_ROUNDS = ["Round of 16", "Quarter-finals", "Semi-finals", "The final"];

const brYearState = () => {
  const st = evState("bracket");
  const y = String(evYear(EV.byId.bracket));
  if (!st.years[y]) st.years[y] = { seeds: [], votes: {} };
  return st.years[y];
};
const brSeeded = () => brYearState().seeds.length === BR_SEEDS;

const brRate = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : (+r.metacriticRating || 0));
const brCandidates = () => evPool("bracket",
  (r) => evOwnedUnfinished(r) && ["Will Play", "Must Play"].includes(String(r.priority || "")));

function brSeed() {
  const st = brYearState();
  const pool = brCandidates().slice().sort((a, b) => brRate(b) - brRate(a)).slice(0, BR_SEEDS);
  st.seeds = pool.map(evKey);
  st.votes = {};
  evSave();
  return st.seeds.length;
}

/* The tree, derived from the votes every time. matches[r][i] is a pair of keys, either of
   which may be null while the round before it is still being played. */
function brTree() {
  const st = brYearState();
  const rounds = [];
  rounds.push(BR_ORDER.map(([a, b]) => [st.seeds[a] || null, st.seeds[b] || null]));
  for (let r = 1; r < 4; r++) {
    const prev = rounds[r - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push([st.votes[`r${r}m${i + 1}`] || null, st.votes[`r${r}m${i + 2}`] || null]);
    }
    rounds.push(next);
  }
  return rounds;
}
const brVote = (round, match) => brYearState().votes[`r${round}m${match}`] || null;

// Matches decided so far, and how many the calendar has opened. One a day from the start
// of March, so the bracket paces itself rather than being a single afternoon of clicking.
const brDecided = () => Object.keys(brYearState().votes).length;
function brOpen() {
  const st = evPhase(EV.byId.bracket);
  if (st.phase === "before") return 0;
  if (st.phase === "after") return 15;
  return Math.min(15, st.day);
}

function brCast(round, match, key) {
  const st = brYearState();
  const id = `r${round}m${match}`;
  if (st.votes[id]) return false;         // immutable, deliberately
  st.votes[id] = key;
  evSave();
  return true;
}
function brChampion() {
  const st = brYearState();
  return st.votes.r4m1 ? evRow(st.votes.r4m1) : null;
}

evRegister({
  id: "bracket",
  name: "The Backlog Bracket",
  icon: "i-bracket",
  structure: "Elimination",
  priority: 80,
  window: { from: [3, 1], to: [4, 7] },
  core: { from: [3, 1], to: [3, 31] },
  cta: "Vote today’s match",
  blurb: "sixteen games, fifteen matches, one thing to play in April",
  skin: "--ev-disp:'Graduate',var(--display);--ev-size:40px;--ev-dw:400;--ev-ls:.02em;" +
        "--ev-deco:#f0b43c;--ev-fg:#f6efdf;--ev-fg-2:#c8bfa8;--ev-edge:rgba(240,180,60,.34);" +
        "--ev-edge-hi:rgba(243,198,92,.7);--ev-glow:rgba(240,180,60,.3);--ev-t1:#fff8e8;" +
        "--ev-t2:#f3c65c;--ev-t3:#d99a26;--ev-on-cta:#20160a;--ev-k:#f3c65c;" +
        "--ev-art:radial-gradient(120% 150% at 84% 120%,rgba(240,180,60,.22),transparent 58%)," +
        "radial-gradient(90% 130% at 6% -20%,rgba(52,211,153,.16),transparent 60%)," +
        "linear-gradient(140deg,#0a1220,#101a2c 70%,#16213a)",
  deco: [
    { i: "i-trophy", x: 87, y: 66, s: 44, lift: 12 },
    { i: "i-bracket", x: 70, y: 22, s: 30, lift: 11, d: 90, o: .55 },
    { i: "i-pennant", x: 24, y: 18, s: 24, r: -12, lift: 14, d: 30 },
    { i: "i-pennant", x: 46, y: 84, s: 20, r: 10, lift: 8, d: 210, o: .7 },
    { i: "i-star", x: 58, y: 12, s: 16, lift: 16, d: 160, o: .55 },
    { i: "i-trophy", x: 71, y: 80, s: 24, r: 7, lift: 9, d: 140, o: .6 },
  ],
  blank: () => ({ years: {} }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [y, t] of Object.entries(theirs.years || {})) {
      const m = mine.years[y];
      if (!m) { mine.years[y] = t; changed = true; continue; }
      if (!m.seeds.length && (t.seeds || []).length) { m.seeds = t.seeds; changed = true; }
      // Votes are immutable, so a merge can only ADD one. Where both devices somehow voted
      // in the same match, the one already here stands: it was cast first from this
      // browser's point of view, and nothing downstream is stored.
      for (const [id, key] of Object.entries(t.votes || {})) {
        if (!(id in m.votes)) { m.votes[id] = key; changed = true; }
      }
    }
    return changed;
  },
  eyebrow: () => "Seasonal event · March",
  pitch: () => {
    if (!brSeeded()) return `Sixteen of your Will Play games, one match a day, one winner. Nothing is seeded yet.`;
    const champ = brChampion();
    if (champ) return `${String(champ.title)} won the bracket. April's job is to play it.`;
    const rounds = brTree();
    const n = brDecided();
    // The next match that is open, has both sides, and has not been decided.
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < rounds[r].length; i++) {
        const id = `r${r + 1}m${i + 1}`;
        const pair = rounds[r][i];
        if (brYearState().votes[id] || !pair[0] || !pair[1]) continue;
        const a = evRow(pair[0]), b = evRow(pair[1]);
        if (a && b) return `${BR_ROUNDS[r]}: ${String(a.title)} or ${String(b.title)}. Pick one.`;
      }
    }
    return `${n} of 15 matches decided.`;
  },
  meter: () => brSeeded()
    ? { pct: Math.round((brDecided() / 15) * 100), text: `${brDecided()} of 15 matches decided` }
    : { pct: null, text: "not seeded yet" },
  render: brRender,
  reset: () => {},
});
