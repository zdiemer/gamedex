"use strict";

// UI components for ev-nobuy.js. Feature state and orchestration remain in that module.

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
                 <span class="m">${escapeHtml(String(r.datePurchased))}${r.purchasePrice ? ` · ${(+r.purchasePrice).toFixed(2)}` : ""}</span>
               </div>`).join("")}</div>
             ${buys.length > 8 ? `<p class="m">and ${buys.length - 8} more</p>` : ""}
             <p class="ev-p">${evPlural(streak.days, "day", "days")} clean before it, ${evPlural(streak.after, "day", "days")} since.
               The counter keeps running.</p>`}
      </section>
      <section class="ev-panel">
        <h3>The dare, in your own numbers</h3>
        <dl class="ev-dl">
          <div><dt>This November</dt><dd>${evPlural(buys.length, "purchase", "purchases")}${
            buys.length ? ` · ${nobuySpend(buys).toFixed(2)}` : ""}</dd></div>
          <div><dt>November ${year - 1}</dt><dd>${last.length
            ? `${evPlural(last.length, "purchase", "purchases")} · ${nobuySpend(last).toFixed(2)}`
            : "nothing on the sheet"}</dd></div>
          <div><dt>${year} so far</dt><dd>${evPlural(spendYear.length, "purchase", "purchases")} · ${nobuySpend(spendYear).toFixed(2)}</dd></div>
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
