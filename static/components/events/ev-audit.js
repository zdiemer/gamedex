"use strict";

// UI components for ev-audit.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function auditCardHtml(row) {
  const key = evKey(row);
  const bought = String(row.datePurchased || "");
  const years = Math.floor(auditDaysSince(bought) / 365);
  return `<div class="ev-audit-card">
    ${evTileHtml(row, { sub: `${row.platform || ""}${row.estimatedTime ? " · " + evHours(row.estimatedTime) : ""}` })}
    <span class="ev-audit-age">bought ${escapeHtml(bought)}${years ? ` · ${evPlural(years, "year", "years")} ago` : ""}</span>
    <div class="ev-audit-acts">
      ${Object.entries(AUDIT_VERDICTS).map(([v, o]) =>
        `<button class="ev-verdict ${o.cls}" data-auditkey="${escapeHtml(key)}" data-auditv="${v}"
           title="${escapeHtml(o.note)}">${icon(o.icon, 13)} ${o.label}</button>`).join("")}
    </div>
  </div>`;
}

function auditRender(host) {
  const ev = EV.byId.audit;
  const queue = auditQueue();
  const pending = auditPending();
  const deal = auditDeal();
  const t = auditTotals();
  const st = auditState();
  const played = Object.entries(st.verdicts).filter(([, v]) => v.v === "play")
    .map(([k]) => evRow(k)).filter(Boolean).slice(0, 12);

  host.innerHTML = evHeroHtml(ev, {
    acts: `${st.last ? `<button class="btn ghost" id="auditUndo">${icon("i-refresh", 15)} Undo the last one</button>` : ""}`,
    note: `The sheet is read only here, so a verdict is a stamp in this event, not an edit to your spreadsheet.`,
  }) + `<div class="ev-wrap">
    <div class="ev-audit-bar">
      <span><b>${auditDoneToday()}</b> of ${AUDIT_DEAL} today</span>
      <span><b>${t.all.toLocaleString()}</b> audited</span>
      <span><b>${pending.length.toLocaleString()}</b> still on the shelf</span>
      <span class="m">${t.play} to play · ${t.keep} kept · ${t.drop} let go</span>
    </div>
    ${deal.length ? `<div class="ev-audit-deal">${deal.map(auditCardHtml).join("")}</div>`
      : `<p class="ev-none">Nothing left in the queue. ${queue.length
        ? "Every owned game with a purchase date has a verdict on it, which is either an achievement or a bug."
        : "No owned, unfinished games carry a purchase date, so there is nothing to put in order."}</p>`}
    ${played.length ? `<section class="ev-panel wide">
      <h3>Said you would play it</h3>
      <div class="ev-row-tiles">${played.map((r) => evTileHtml(r, { cls: "sm" })).join("")}</div>
    </section>` : ""}
  </div>`;

  /* Two attributes rather than one packed string: a match key is "title|platform|year",
     so anything that packs a key next to another value and splits on a delimiter has to
     pick one the key cannot contain, and the safest such delimiter is none at all. */
  host.querySelectorAll("[data-auditkey]").forEach((el) => {
    el.onclick = () => {
      auditSet(el.dataset.auditkey, el.dataset.auditv);
      auditRender(host); evWireTiles(host);
    };
  });
  const undo = document.getElementById("auditUndo");
  if (undo) undo.onclick = () => { auditUndo(); auditRender(host); evWireTiles(host); };
  if (typeof maybeEnrich === "function") maybeEnrich(deal.concat(played));
}
