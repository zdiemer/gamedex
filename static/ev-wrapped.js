"use strict";

/* Wrapped — the year, read back to you.

   The only event that is OUTPUT. Nothing to fill in, nothing to lose, no picker: the sheet
   already knows all of this, and the event is the reading of it. Which is also why it has
   no state — there is nothing here a second device could disagree about.

   Every figure below is computed from columns that already exist. No new column, no
   enrichment, nothing to backfill: if the sheet has a dateCompleted and a completionTime,
   it has a year in review. */

const wrapYear = () => evYear(EV.byId.wrapped);
const wrapIn = (v, y) => String(v || "").startsWith(String(y));

const wrapFinished = (y) => evRows().filter((r) => wrapIn(r.dateCompleted, y));
const wrapBought = (y) => evRows().filter((r) => wrapIn(r.datePurchased, y));

function wrapTop(rows, key) {
  const c = new Map();
  for (const r of rows) {
    const v = r[key];
    if (v == null || v === "") continue;
    c.set(v, (c.get(v) || 0) + 1);
  }
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0] || null;
}

const WRAP_MONTHS = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

/* The twelve cards. Each is { fig, label, row? } — one figure, one line, optionally the
   game it is about. Built as data rather than markup so the page can say "nothing here
   yet" for a year with no finishes without twelve separate guards. */
function wrapCards(y) {
  const done = wrapFinished(y);
  const bought = wrapBought(y);
  const hours = done.reduce((n, r) => n + (+r.completionTime || 0), 0);
  const spend = bought.reduce((n, r) => n + (+r.purchasePrice || 0), 0);
  const byMonth = new Map();
  for (const r of done) {
    const m = +String(r.dateCompleted).slice(5, 7) - 1;
    byMonth.set(m, (byMonth.get(m) || 0) + 1);
  }
  const bestMonth = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const longest = done.slice().sort((a, b) => (+b.completionTime || 0) - (+a.completionTime || 0))[0];
  const loved = done.filter((r) => r.rating != null).sort((a, b) => (+b.rating || 0) - (+a.rating || 0))[0];
  const oldest = done.filter((r) => r.releaseYear).sort((a, b) => a.releaseYear - b.releaseYear)[0];
  const platform = wrapTop(done, "platform");
  const genre = wrapTop(done, "genre");
  const untouched = bought.filter((r) => !r.completed && !r.dateStarted);
  const firstBuy = bought.slice().sort((a, b) =>
    String(a.datePurchased).localeCompare(String(b.datePurchased)))[0];

  return [
    { fig: done.length.toLocaleString(), label: `games finished in ${y}` },
    { fig: Math.round(hours).toLocaleString() + "h", label: "in the chair, by the sheet's own clock" },
    bestMonth ? { fig: WRAP_MONTHS[bestMonth[0]], label: `your best month · ${evPlural(bestMonth[1], "game", "games")}` }
              : { fig: "—", label: "no month stands out yet" },
    longest ? { fig: evHours(+longest.completionTime), label: "the longest single sit", row: longest } : null,
    platform ? { fig: platform[0], label: `carried the year · ${evPlural(platform[1], "game", "games")}` } : null,
    genre ? { fig: genre[0], label: `what you actually played · ${evPlural(genre[1], "game", "games")}` } : null,
    loved ? { fig: Math.round((+loved.rating || 0) * 100) + "%", label: "your highest rating this year", row: loved } : null,
    oldest ? { fig: String(oldest.releaseYear), label: "the oldest game you finished", row: oldest } : null,
    { fig: bought.length.toLocaleString(), label: "games bought" },
    { fig: "$" + Math.round(spend).toLocaleString(), label: "spent, at what the sheet says you paid" },
    { fig: untouched.length.toLocaleString(), label: "bought this year and never started" },
    firstBuy ? { fig: String(firstBuy.datePurchased), label: "the first thing you bought this year", row: firstBuy } : null,
  ].filter(Boolean);
}

// The last card is a handover: five games for January, best first. It is also where the
// bracket gets its idea in March, which is the only thread between two events here.
function wrapShortlist() {
  const rate = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : (r.metacriticRating || 0));
  return evPool("wrapped-next", (r) => evOwnedUnfinished(r) && ["Will Play", "Must Play"].includes(String(r.priority || "")))
    .slice().sort((a, b) => rate(b) - rate(a)).slice(0, 5);
}

function wrapRender(host) {
  const ev = EV.byId.wrapped;
  const y = wrapYear();
  const cards = wrapCards(y);
  const done = wrapFinished(y);
  const next = wrapShortlist();

  host.innerHTML = evHeroHtml(ev, {
    note: "Nothing to fill in. Every figure below is a column the sheet already keeps.",
  }) + `<div class="ev-wrap">
    ${done.length ? "" : `<p class="ev-none">Nothing on the sheet is marked finished in ${y} yet. The cards fill themselves in as the year does.</p>`}
    <div class="ev-cards">
      ${cards.map((c, i) => `<div class="ev-card">
        <span class="ev-card-n">${String(i + 1).padStart(2, "0")}</span>
        <span class="ev-card-fig">${escapeHtml(String(c.fig))}</span>
        <span class="ev-card-l">${escapeHtml(c.label)}</span>
        ${c.row ? evTileHtml(c.row, { cls: "sm" }) : ""}
      </div>`).join("")}
    </div>
    ${next.length ? `<section class="ev-panel wide">
      <h3>And for January</h3>
      <p class="ev-p">Five you own, haven't finished, and told the sheet you would play. In March,
        sixteen of these get seeded into the bracket.</p>
      <div class="ev-row-tiles">${next.map((r) => evTileHtml(r)).join("")}</div>
    </section>` : ""}
  </div>`;

  if (typeof maybeEnrich === "function") {
    maybeEnrich(cards.map((c) => c.row).filter(Boolean).concat(next));
  }
}

evRegister({
  id: "wrapped",
  name: "Wrapped",
  icon: "i-ribbon",
  structure: "Recap",
  priority: 85,
  window: { from: [12, 26], to: [1, 15] },
  core: { from: [12, 26], to: [1, 15] },
  cta: "Read your year",
  blurb: "the year, generated from the sheet",
  skin: "--ev-disp:'Anton',var(--display);--ev-size:58px;--ev-dw:400;--ev-ls:-.01em;" +
        "--ev-deco:#b7a4ff;--ev-fg:#efeaff;--ev-fg-2:#bcb2dd;--ev-edge:rgba(124,92,255,.4);" +
        "--ev-edge-hi:rgba(124,92,255,.85);--ev-glow:rgba(124,92,255,.45);--ev-t1:#ffffff;" +
        "--ev-t2:#b7a4ff;--ev-t3:#22d3ee;--ev-on-cta:#0b0713;--ev-k:#b7a4ff;" +
        "--ev-art:radial-gradient(120% 150% at 80% 120%,rgba(34,211,238,.24),transparent 58%)," +
        "radial-gradient(90% 130% at 10% -20%,rgba(124,92,255,.42),transparent 62%)," +
        "linear-gradient(140deg,#0b0713,#140a24 70%,#0a1524)",
  deco: [
    { i: "i-stats", x: 86, y: 66, s: 44, lift: 12 },
    { i: "i-ribbon", x: 70, y: 78, s: 26, r: -6, lift: 9, d: 90 },
    { i: "i-star", x: 26, y: 18, s: 20, lift: 14, d: 40, o: .7 },
    { i: "i-star", x: 55, y: 12, s: 14, lift: 16, d: 170, o: .5 },
    { i: "i-watch", x: 91, y: 24, s: 26, r: 8, lift: 11, d: 130 },
    { i: "i-sparkle", x: 62, y: 84, s: 22, lift: 8, d: 220, o: .6 },
  ],
  blank: () => ({}),
  eyebrow: () => "Seasonal event · year in review",
  pitch: () => {
    const y = wrapYear();
    const done = wrapFinished(y);
    const hours = done.reduce((n, r) => n + (+r.completionTime || 0), 0);
    const bought = wrapBought(y).length;
    if (!done.length) return `${y} is on the sheet. Nothing marked finished yet, but the rest of it is ready.`;
    return `${done.length} finished. ${Math.round(hours).toLocaleString()} hours. ${bought.toLocaleString()} bought. Ready when you are.`;
  },
  meter: () => ({ pct: null, text: `generated from ${evRows().length.toLocaleString()} rows` }),
  render: wrapRender,
  reset: () => {},
});
