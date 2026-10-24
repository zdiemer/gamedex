"use strict";

/* The Shelf Audit — the only meter on the board that goes DOWN.

   Ten cards a day, oldest purchase first, three verdicts and no fourth. The queue opens on
   the oldest thing you ever bought and did not finish, which for this collection is
   September 2008, and it does not flatter anybody.

   One thing this cannot do, and says so on screen: it does not write to the spreadsheet.
   The sheet is read-only to this app (there is no write endpoint, by design — the Excel
   file is the source of truth and it lives elsewhere), so a verdict is recorded here, in
   the event's own state, and shown as a stamp over the row. That is a smaller promise than
   "Let it go rewrites your priority column", and it is the true one.

   A KEEP expires. Deciding to keep something in April 2026 is not a decision about April
   2027, so a keep drops out of the queue for a year and then comes back round. */

const AUDIT_DEAL = 10;
const AUDIT_KEEP_DAYS = 365;
const AUDIT_VERDICTS = {
  play: { label: "Play it", note: "into the short list", cls: "play", icon: "i-play" },
  keep: { label: "Keep it", note: "back in a year", cls: "keep", icon: "i-check" },
  drop: { label: "Let it go", note: "not for you", cls: "drop", icon: "i-close" },
};

const auditState = () => {
  const st = evState("audit");
  if (!st.verdicts) st.verdicts = {};
  return st;
};

const auditDaysSince = (iso) => {
  if (!iso) return 1e9;
  const [y, m, d] = String(iso).split("-").map(Number);
  return Math.round((evNow() - new Date(y, (m || 1) - 1, d || 1)) / 86400000);
};

// A verdict still standing today. Play and drop are permanent; keep lapses after a year,
// which is what makes this an audit rather than a one-off cull.
function auditVerdict(key) {
  const v = auditState().verdicts[key];
  if (!v) return null;
  if (v.v === "keep" && auditDaysSince(v.at) > AUDIT_KEEP_DAYS) return null;
  return v;
}

/* The queue: owned, unfinished, and carrying a purchase date, oldest first. The date is
   what makes the order meaningful — "how long has this been sitting there" is the only
   question the audit is asking. */
const auditQueue = () => evPool("audit",
  (r) => evOwnedUnfinished(r) && !!r.datePurchased, { group: false })
  .slice()
  .sort((a, b) => String(a.datePurchased).localeCompare(String(b.datePurchased)));

const auditPending = () => auditQueue().filter((r) => !auditVerdict(evKey(r)));
const auditDeal = () => auditPending().slice(0, AUDIT_DEAL);
const auditDoneToday = () => Object.values(auditState().verdicts)
  .filter((v) => v.at === evISO()).length;
const auditTotals = () => {
  const v = Object.values(auditState().verdicts);
  return {
    all: v.length,
    play: v.filter((x) => x.v === "play").length,
    keep: v.filter((x) => x.v === "keep").length,
    drop: v.filter((x) => x.v === "drop").length,
  };
};

function auditSet(key, verdict) {
  const st = auditState();
  st.verdicts[key] = { v: verdict, at: evISO() };
  st.last = key;
  evSave();
}
function auditUndo() {
  const st = auditState();
  if (!st.last) return false;
  delete st.verdicts[st.last];
  st.last = null;
  evSave();
  return true;
}

evRegister({
  id: "audit",
  name: "The Shelf Audit",
  icon: "i-broom",
  structure: "Triage",
  priority: 75,
  window: { from: [3, 20], to: [4, 30] },
  core: { from: [3, 20], to: [4, 30] },
  cta: "Deal today’s ten",
  blurb: "ten cards a day, oldest purchase first",
  offSeason: "The audit runs from March 20 to April 30. The queue is here all year, it just stops asking.",
  skin: "--ev-disp:'Saira Stencil One',var(--display);--ev-size:40px;--ev-dw:400;--ev-ls:.01em;" +
        "--ev-deco:#7ee0b0;--ev-fg:#e8f6ee;--ev-fg-2:#b0c6b9;--ev-edge:rgba(126,224,176,.3);" +
        "--ev-edge-hi:rgba(126,224,176,.62);--ev-glow:rgba(126,224,176,.28);--ev-t1:#f2fff8;" +
        "--ev-t2:#9df0c6;--ev-t3:#4fbf8f;--ev-on-cta:#05231a;--ev-k:#9df0c6;" +
        "--ev-art:radial-gradient(120% 150% at 84% 120%,rgba(126,224,176,.20),transparent 58%)," +
        "radial-gradient(90% 130% at 6% -20%,rgba(200,162,115,.20),transparent 60%)," +
        "linear-gradient(140deg,#0d1311,#141d19 70%,#1a251f)",
  deco: [
    { i: "i-box", x: 86, y: 68, s: 44, r: -5, lift: 12 },
    { i: "i-broom", x: 70, y: 24, s: 30, r: 10, lift: 11, d: 90 },
    { i: "i-tag", x: 24, y: 18, s: 22, r: -14, lift: 14, d: 30 },
    { i: "i-box", x: 70, y: 82, s: 24, r: 6, lift: 9, d: 150, o: .65 },
    { i: "i-sparkle", x: 52, y: 14, s: 18, lift: 15, d: 200, o: .5 },
    { i: "i-sparkle", x: 44, y: 84, s: 16, lift: 8, d: 260, o: .45 },
  ],
  blank: () => ({ verdicts: {}, last: null }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [k, v] of Object.entries(theirs.verdicts || {})) {
      const m = mine.verdicts[k];
      // The newer decision stands. Unlike a bracket vote, a verdict is a thing you are
      // allowed to change your mind about — that is what the keep expiry is for.
      if (!m || String(v.at || "") > String(m.at || "")) { mine.verdicts[k] = v; changed = true; }
    }
    return changed;
  },
  eyebrow: () => "Seasonal event · spring",
  pitch: () => {
    const pending = auditPending();
    const t = auditTotals();
    if (!pending.length) return "The shelf is audited. Every owned game with a purchase date has a verdict.";
    const oldest = pending[0];
    if (!t.all) return `${pending.length.toLocaleString()} unfinished games with a receipt. The oldest is from ${String(oldest.datePurchased).slice(0, 4)}.`;
    return `${auditDoneToday()} of ${AUDIT_DEAL} done today. The shelf is down to ${pending.length.toLocaleString()}.`;
  },
  meter: () => {
    const queue = auditQueue().length;
    const pending = auditPending().length;
    if (!queue) return null;
    return { pct: Math.round(((queue - pending) / queue) * 100),
             text: `${(queue - pending).toLocaleString()} audited · ${pending.toLocaleString()} to go` };
  },
  render: auditRender,
  reset: () => {},
});
