"use strict";

/* Under Three — a clock, not a calendar.

   The unit here is HOURS. Finishing KAMUI at 39 minutes moves the bar less than
   Soulcalibur II at three, so the summer carries a number rather than a grid, nothing is
   scheduled, nothing expires, and you can join in the second week of August without owing
   the first seven.

   The second screen is the reason this event is worth building: every clear records the
   sheet's ESTIMATE against what it actually took you. That comparison exists nowhere else
   in the app, and after one summer the splits are the most interesting page in it. */

const U3_MAX = 3;              // hours; the whole premise
const U3_DEFAULT_TARGET = 40;

const u3YearState = () => {
  const st = evState("underthree");
  const y = String(evYear(EV.byId.underthree));
  if (!st.years[y]) st.years[y] = { target: U3_DEFAULT_TARGET, cleared: [] };
  return st.years[y];
};

const u3Pool = () => evPool("underthree",
  (r) => evOwnedUnfinished(r) && r.estimatedTime != null && +r.estimatedTime <= U3_MAX);

const u3Cleared = () => u3YearState().cleared;
const u3Hours = () => u3Cleared().reduce((n, c) => n + (+c.actual || 0), 0);
const u3Est = () => u3Cleared().reduce((n, c) => n + (+c.est || 0), 0);
const u3Has = (key) => u3Cleared().some((c) => c.key === key);

function u3Clear(row) {
  const s = u3YearState();
  const key = evKey(row);
  if (u3Has(key)) return;
  const est = +row.estimatedTime || 0;
  // The sheet's own completion time if it has one — you may have finished this weeks ago
  // and told the spreadsheet before you told the event.
  const actual = +row.completionTime || est;
  s.cleared.push({ key, est, actual, at: evISO() });
  evSave();
}
function u3Unclear(key) {
  const s = u3YearState();
  s.cleared = s.cleared.filter((c) => c.key !== key);
  evSave();
}
function u3SetActual(key, hours) {
  const c = u3Cleared().find((x) => x.key === key);
  if (!c) return;
  c.actual = Math.max(0, Math.round((+hours || 0) * 100) / 100);
  evSave();
}
function u3SetTarget(h) {
  const s = u3YearState();
  s.target = Math.max(1, Math.min(999, Math.round(+h || U3_DEFAULT_TARGET)));
  evSave();
}

evRegister({
  id: "underthree",
  name: "Under Three",
  icon: "i-watch",
  structure: "Clock",
  priority: 70,
  window: { from: [6, 21], to: [9, 1] },
  core: { from: [6, 21], to: [9, 1] },
  cta: "Start the clock",
  blurb: "a summer measured in hours, not days",
  skin: "--ev-disp:'Orbitron',var(--display);--ev-size:38px;--ev-dw:900;--ev-ls:.04em;" +
        "--ev-deco:#22d3ee;--ev-fg:#e6feff;--ev-fg-2:#9ec6cf;--ev-edge:rgba(34,211,238,.34);" +
        "--ev-edge-hi:rgba(34,211,238,.75);--ev-glow:rgba(34,211,238,.36);--ev-t1:#f0ffff;" +
        "--ev-t2:#6ee7f9;--ev-t3:#22d3ee;--ev-on-cta:#04222a;--ev-k:#6ee7f9;" +
        "--ev-art:radial-gradient(120% 150% at 84% 120%,rgba(34,211,238,.26),transparent 56%)," +
        "radial-gradient(90% 130% at 6% -20%,rgba(163,230,53,.18),transparent 60%)," +
        "linear-gradient(140deg,#04070a,#06101a 70%,#04131a)",
  deco: [
    { i: "i-watch", x: 86, y: 66, s: 46, lift: 12 },
    { i: "i-bolt", x: 70, y: 24, s: 28, r: 8, lift: 11, d: 80 },
    { i: "i-flag", x: 24, y: 18, s: 24, r: -8, lift: 14, d: 30 },
    { i: "i-bolt", x: 46, y: 84, s: 18, r: -10, lift: 8, d: 200, o: .6 },
    { i: "i-watch", x: 71, y: 82, s: 22, lift: 9, d: 150, o: .6 },
    { i: "i-flag", x: 57, y: 12, s: 16, r: 6, lift: 16, d: 240, o: .5 },
  ],
  blank: () => ({ years: {} }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [y, t] of Object.entries(theirs.years || {})) {
      const m = mine.years[y];
      if (!m) { mine.years[y] = t; changed = true; continue; }
      for (const c of t.cleared || []) {
        if (!m.cleared.some((x) => x.key === c.key)) { m.cleared.push(c); changed = true; }
      }
      // The bigger target wins. Two devices disagreeing about the goal is a person who
      // raised it, and lowering somebody's summer target behind their back is rude.
      if (typeof t.target === "number" && t.target > m.target) { m.target = t.target; changed = true; }
    }
    return changed;
  },
  eyebrow: () => "Seasonal event · summer",
  pitch: () => {
    const s = u3YearState();
    const hours = Math.round(u3Hours() * 10) / 10;
    const n = s.cleared.length;
    if (!n) return `${u3Pool().length.toLocaleString()} games under three hours. Set a target and start the clock.`;
    if (hours >= s.target) return `${hours} hours cleared, past a target of ${s.target}. ${evPlural(n, "game", "games")}, none longer than an evening.`;
    return `${hours} hours cleared of ${s.target}. ${evPlural(n, "game", "games")}, none longer than an evening.`;
  },
  meter: () => {
    const s = u3YearState();
    const hours = u3Hours();
    return { pct: Math.round((hours / s.target) * 100),
             text: `${Math.round(hours * 10) / 10} of ${s.target} hours · ${evPlural(s.cleared.length, "game", "games")}` };
  },
  render: u3Render,
  reset: () => {},
});
