"use strict";

// UI components for ev-wrapped.js. Feature state and orchestration remain in that module.

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
