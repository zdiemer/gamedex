"use strict";

// UI components for ev-hearth.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function hearthSlotHtml(slot) {
  const st = hearthState();
  const key = st.shelf[slot];
  const row = key ? evRow(key) : null;
  if (!row) {
    return `<div class="ev-slot empty">
      <button class="ev-slot-add" data-hearthpick="${slot}" aria-label="Put a game on the mantel">
        ${icon("i-flame", 24)}<span>Add one</span>
      </button></div>`;
  }
  const lit = st.lit.includes(key);
  return `<div class="ev-slot${lit ? " lit" : ""}">
    ${evTileHtml(row, { sub: `${row.platform || ""}${row.estimatedTime ? " · " + evHours(row.estimatedTime) : ""}` })}
    <span class="ev-slot-acts">
      <button class="ev-lit" data-hearthlit="${escapeHtml(key)}" aria-pressed="${lit}"
        title="${lit ? "Finished. Click to un-light it." : "Light it when you finish it"}">${icon("i-flame", 13)}</button>
      <button class="ev-swap" data-hearthpick="${slot}" aria-label="Change this one">Change</button>
      <button class="ev-x" data-hearthclear="${slot}" aria-label="Take it off the mantel">${icon("i-close", 13)}</button>
    </span>
  </div>`;
}

function hearthRender(host) {
  const ev = EV.byId.hearth;
  const st = hearthState();
  const pool = hearthPool();
  const used = new Map(st.shelf.filter(Boolean).map((k, i) => [k, "On the mantel"]));
  const repaint = () => { hearthRender(host); evWireTiles(host); };

  host.innerHTML = evHeroHtml(ev, {
    note: `No dates, no deadline, nothing expires. ${pool.length.toLocaleString()} cozy games on the shelf to choose from.`,
  }) + `<div class="ev-wrap">
      <div class="ev-mantel">${Array.from({ length: HEARTH_N }, (_, i) => hearthSlotHtml(i)).join("")}</div>
      <div class="ev-fire" aria-hidden="true">${Array.from({ length: HEARTH_N }, (_, i) =>
        `<span class="ev-flame${i < hearthLit() ? " on" : ""}">${icon("i-flame", 18)}</span>`).join("")}</div>
      <p class="ev-fire-t">${hearthLit() === 0 ? "Nothing lit yet. Light one when you finish it."
        : hearthLit() === HEARTH_N ? "Six for six. That is the whole season, done."
        : `${hearthLit()} of ${HEARTH_N} lit.`}</p>
      ${evPickerHtml(used)}
    </div>`;

  host.querySelectorAll("[data-hearthpick]").forEach((el) => {
    el.onclick = () => {
      const slot = +el.dataset.hearthpick;
      evPickerOpen({
        slot, pool, title: `Mantel, slot ${slot + 1}`, repaint,
        onPick: (key) => { hearthSet(slot, key); evPickerClose(); repaint(); },
      });
    };
  });
  host.querySelectorAll("[data-hearthclear]").forEach((el) => {
    el.onclick = () => { hearthClear(+el.dataset.hearthclear); repaint(); };
  });
  host.querySelectorAll("[data-hearthlit]").forEach((el) => {
    el.onclick = () => { hearthToggleLit(el.dataset.hearthlit); repaint(); };
  });
  evWirePicker(host, repaint, used);
  if (typeof maybeEnrich === "function") {
    maybeEnrich(st.shelf.filter(Boolean).map(evRow).filter(Boolean).concat(pool.slice(0, 40)));
  }
}
