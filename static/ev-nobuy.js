"use strict";

/* No-Buy November — the only event you can lose, and the only one the SHEET drives.

   Every other event here waits for you to click something. This one watches a column:
   datePurchased. A row that turns up in November carrying a November purchase date ends
   the streak, and the banner names the game that did it, because the receipt is the point.

   Two design rules it lives by. It is opt-in — a counter that starts shaming you on
   November 1st without being asked is not a game, it is a nag. And when the streak breaks
   the calendar keeps counting: the back half of the month still means something, and the
   copy stays flat. A receipt, never a scolding. */

const nobuyYear = () => evYear(EV.byId.nobuy);
const nobuyDays = () => new Date(nobuyYear(), 11, 0).getDate();       // November, always 30

const nobuyState = () => {
  const st = evState("nobuy");
  const y = String(nobuyYear());
  if (!st.years[y]) st.years[y] = { joined: false };
  return st.years[y];
};

// Every purchase in a given November, oldest first. The sheet stores dates as YYYY-MM-DD,
// so the month is a string prefix and there is no Date to get wrong.
function nobuyBuys(year = nobuyYear()) {
  const p = `${year}-11`;
  return evRows()
    .filter((r) => String(r.datePurchased || "").startsWith(p))
    .sort((a, b) => String(a.datePurchased).localeCompare(String(b.datePurchased)));
}
const nobuySpend = (rows) => rows.reduce((n, r) => n + (+r.purchasePrice || 0), 0);

// Day 1..30 of this November, or 30 once it is over: how far the counter has run.
function nobuyToday() {
  const st = evPhase(EV.byId.nobuy);
  if (st.phase === "before") return 0;
  if (st.phase === "after") return nobuyDays();
  return Math.min(st.day, nobuyDays());
}

/* The streak, in days, and what ended it. Days are counted from the 1st, so a break on the
   14th leaves a 13-day streak and a 16-day tail, and both are on screen. */
function nobuyStreak() {
  const buys = nobuyBuys();
  const today = nobuyToday();
  if (!buys.length) return { clean: true, days: today, broke: null, after: 0 };
  const day = +String(buys[0].datePurchased).slice(8, 10);
  return { clean: false, days: day - 1, broke: buys[0], brokeDay: day, after: Math.max(0, today - day) };
}

const nobuyVault = () => evPool("nobuy-vault", (r) => !!r.wishlisted);
const nobuyVaultOpen = () => evPhase(EV.byId.nobuy).phase === "after";

/* ---- the page ------------------------------------------------------------- */
function nobuyRender(host) {
  const ev = EV.byId.nobuy;
  const st = nobuyState();
  const year = nobuyYear();
  const buys = nobuyBuys();
  const streak = nobuyStreak();
  const today = nobuyToday();
  const vault = nobuyVault();
  const last = nobuyBuys(year - 1);
  const spendYear = evRows().filter((r) => String(r.datePurchased || "").startsWith(String(year)));

  const grid = Array.from({ length: nobuyDays() }, (_, i) => {
    const day = i + 1;
    const on = buys.filter((r) => +String(r.datePurchased).slice(8, 10) === day);
    const cls = on.length ? "broke" : day <= today ? "clean" : "ahead";
    const title = on.length ? on.map((r) => String(r.title)).join(", ") : `November ${day}`;
    return `<span class="ev-day ${cls}${day === today ? " today" : ""}" title="${escapeHtml(title)}">
      <b>${day}</b>${on.length ? `<i>${on.length}</i>` : ""}</span>`;
  }).join("");

  const acts = st.joined
    ? `<button class="btn ghost" id="nobuyLeave">Leave the dare</button>`
    : `<button class="btn" id="nobuyJoin">${icon("i-lock", 15)} I'm in</button>`;

  host.innerHTML = evHeroHtml(ev, {
    acts,
    note: st.joined ? "" : "Opt in and the counter starts. Nothing on the sheet changes either way.",
  }) + `<div class="ev-wrap">
    <div class="ev-cal-strip">${grid}</div>
    <div class="ev-cols">
      <section class="ev-panel">
        <h3>${streak.clean ? "The streak" : "What ended it"}</h3>
        ${streak.clean
          ? `<p class="ev-big">${evPlural(streak.days, "day", "days")} clean</p>
             <p class="ev-p">Nothing bought since October 31. ${today < nobuyDays()
               ? `${evPlural(nobuyDays() - today, "day", "days")} to go.` : "The whole month."}</p>`
          : `<p class="ev-big broke">Broken on November ${streak.brokeDay}</p>
             <div class="ev-list">${buys.slice(0, 8).map((r) => `
               <div class="ev-line">
                 <button class="linkbtn" data-evopen="${escapeHtml(evKey(r))}">${escapeHtml(String(r.title))}</button>
                 <span class="m">${escapeHtml(String(r.datePurchased))}${r.purchasePrice ? ` · $${(+r.purchasePrice).toFixed(2)}` : ""}</span>
               </div>`).join("")}</div>
             ${buys.length > 8 ? `<p class="m">and ${buys.length - 8} more</p>` : ""}
             <p class="ev-p">${evPlural(streak.days, "day", "days")} clean before it, ${evPlural(streak.after, "day", "days")} since.
               The counter keeps running.</p>`}
      </section>
      <section class="ev-panel">
        <h3>The dare, in your own numbers</h3>
        <dl class="ev-dl">
          <div><dt>This November</dt><dd>${evPlural(buys.length, "purchase", "purchases")}${
            buys.length ? ` · $${nobuySpend(buys).toFixed(2)}` : ""}</dd></div>
          <div><dt>November ${year - 1}</dt><dd>${last.length
            ? `${evPlural(last.length, "purchase", "purchases")} · $${nobuySpend(last).toFixed(2)}`
            : "nothing on the sheet"}</dd></div>
          <div><dt>${year} so far</dt><dd>${evPlural(spendYear.length, "purchase", "purchases")} · $${nobuySpend(spendYear).toFixed(2)}</dd></div>
        </dl>
      </section>
      <section class="ev-panel">
        <h3>${nobuyVaultOpen() ? "The vault is open" : "In the vault"}</h3>
        <p class="ev-p">${vault.length.toLocaleString()} wishlisted games,
          ${nobuyVaultOpen() ? "unlocked since December 1." : "locked until December 1."}</p>
        <div class="ev-vault${nobuyVaultOpen() ? " open" : ""}">
          ${vault.slice(0, 8).map((r) => evTileHtml(r, { cls: "sm" })).join("")}
          ${nobuyVaultOpen() ? "" : `<span class="ev-vault-lock" aria-hidden="true">${icon("i-lock", 26)}</span>`}
        </div>
      </section>
    </div>
  </div>`;

  const join = document.getElementById("nobuyJoin");
  if (join) join.onclick = () => { st.joined = true; evSave(); nobuyRender(host); evWireTiles(host); };
  const leave = document.getElementById("nobuyLeave");
  if (leave) leave.onclick = () => { st.joined = false; evSave(); nobuyRender(host); evWireTiles(host); };
  if (typeof maybeEnrich === "function") maybeEnrich(vault.slice(0, 8));
}

evRegister({
  id: "nobuy",
  name: "No-Buy November",
  icon: "i-receipt",
  structure: "Streak",
  priority: 90,
  window: { from: [11, 1], to: [11, 30] },
  core: { from: [11, 1], to: [11, 30] },
  cta: "Check the streak",
  blurb: "thirty days, one column, one thing that can end it",
  skin: "--ev-disp:'Special Elite',var(--display);--ev-size:44px;--ev-dw:400;--ev-ls:0;" +
        "--ev-deco:rgba(28,26,23,.42);--ev-fg:#1c1a17;--ev-fg-2:#5c554b;--ev-edge:rgba(28,26,23,.3);" +
        "--ev-edge-hi:rgba(192,50,33,.55);--ev-glow:rgba(192,50,33,.22);--ev-t1:#3d372e;" +
        "--ev-t2:#23201b;--ev-t3:#1c1a17;--ev-on-cta:#fdf5f0;--ev-k:#c03221;" +
        "--ev-cta:linear-gradient(180deg,#c03221,#8f2317);" +
        "--ev-art:repeating-linear-gradient(0deg,rgba(28,26,23,.045) 0 1px,transparent 1px 26px)," +
        "radial-gradient(90% 120% at 88% 120%,rgba(192,50,33,.16),transparent 60%)," +
        "linear-gradient(160deg,#f6f1e6,#ece5d6 70%,#e2dac8)",
  deco: [
    { i: "i-receipt", x: 84, y: 34, s: 56, r: 7, lift: 12, o: .5 },
    { i: "i-lock", x: 70, y: 72, s: 30, r: -6, lift: 9, d: 80, o: .45 },
    { i: "i-coin", x: 92, y: 76, s: 24, r: 4, lift: 7, d: 160, o: .4 },
    { i: "i-cart", x: 55, y: 84, s: 26, r: -8, lift: 8, d: 220, o: .35 },
    { i: "i-ban", x: 40, y: 16, s: 22, lift: 11, d: 40, o: .3 },
    { i: "i-tag", x: 63, y: 12, s: 20, r: 12, lift: 13, d: 120, o: .35 },
  ],
  blank: () => ({ years: {} }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [y, t] of Object.entries(theirs.years || {})) {
      if (!mine.years[y]) { mine.years[y] = t; changed = true; }
      else if (t.joined && !mine.years[y].joined) { mine.years[y].joined = true; changed = true; }
    }
    return changed;
  },
  eyebrow: () => "Seasonal event · November",
  pitch: () => {
    const st = nobuyState();
    const s = nobuyStreak();
    const vault = nobuyVault().length;
    if (!st.joined) {
      return `Thirty days, nothing new. ${vault.toLocaleString()} wishlisted games go in the vault until December 1.`;
    }
    if (s.clean) return `${evPlural(s.days, "day", "days")} clean. ${vault.toLocaleString()} games waiting in the vault.`;
    return `Broken on November ${s.brokeDay} by ${String(s.broke.title || "")}. ${evPlural(s.after, "day", "days")} since.`;
  },
  meter: () => {
    const s = nobuyStreak();
    const days = nobuyDays();
    if (!nobuyState().joined) return { pct: null, text: "opt in and the counter starts" };
    return { pct: Math.round((nobuyToday() / days) * 100),
             text: s.clean ? `${nobuyToday()} of ${days} days · nothing bought`
                           : `broken on the ${s.brokeDay}th · ${evPlural(nobuyBuys().length, "purchase", "purchases")}` };
  },
  render: nobuyRender,
  reset: () => {},
});
