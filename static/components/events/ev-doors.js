"use strict";

// UI components for ev-doors.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function doorsHtml(n) {
  const st = doorsYearState();
  const key = st.doors[String(n)];
  const row = key ? evRow(key) : null;
  const open = doorsIsOpen(n) && row;
  const unlocked = doorsUnlocked(n);
  const gift = n === 25;
  const today = evPhase(EV.byId.doors).day === n;
  const cls = ["ev-door", open ? "open" : "shut", unlocked ? "unlocked" : "locked",
               today ? "today" : "", gift ? "gift" : ""].filter(Boolean).join(" ");
  const num = `<span class="ev-door-n">${n}${today ? "<em>today</em>" : ""}</span>`;
  if (!key) {
    return `<div class="${cls}">${num}<span class="ev-door-empty">${icon("i-gift", 22)}</span></div>`;
  }
  if (!open) {
    return `<div class="${cls}">${num}
      <button class="ev-door-face" ${unlocked ? `data-doorsopen="${n}"` : "disabled"}
        title="${unlocked ? `Open door ${n}` : `Door ${n} opens on December ${n}`}">
        ${icon(gift ? "i-gift" : "i-door", gift ? 34 : 30)}
        <span>${unlocked ? "Open" : `Dec ${n}`}</span>
      </button>
      ${unlocked || st.swaps <= 0 ? "" :
        `<button class="ev-door-swap" data-doorsswap="${n}" title="Swap this door for another game (${st.swaps} left)">${icon("i-refresh", 12)}</button>`}
    </div>`;
  }
  return `<div class="${cls}">${num}
    ${evTileHtml(row, { sub: `${row.platform || ""}${row.estimatedTime ? " · " + evHours(row.estimatedTime) : ""}` })}
  </div>`;
}

function doorsRender(host) {
  const ev = EV.byId.doors;
  const st = doorsYearState();
  const drawn = doorsDrawn();
  const opened = st.opened.length;
  const acts = drawn
    ? `<button class="btn ghost" id="doorsRedraw">${icon("i-dice", 15)} Draw a new month</button>
       <span class="ev-tokens">${icon("i-refresh", 13)} ${evPlural(st.swaps, "swap", "swaps")} left</span>`
    : `<button class="btn" id="doorsDraw">${icon("i-dice", 15)} Draw the month</button>`;
  const pool = doorsPool().length;

  host.innerHTML = evHeroHtml(ev, {
    acts,
    note: drawn ? "" : `${pool} winter games on your shelf, ${DOORS_N} doors, drawn once. Nothing is shown before its date.`,
    beforeNote: drawn ? "Drawn and sealed. The first door opens on December 1." : "",
  }) + `<div class="ev-wrap">
      <div class="ev-doors">${Array.from({ length: 25 }, (_, i) => doorsHtml(i + 1)).join("")}</div>
      ${drawn ? "" : `<p class="ev-none">The calendar is empty until you draw it. ${pool < DOORS_N
        ? `Only ${pool} winter games are on the shelf right now, so some doors will stay shut.` : ""}</p>`}
    </div>`;

  host.querySelectorAll("[data-doorsopen]").forEach((el) => {
    el.onclick = () => { doorsOpen(+el.dataset.doorsopen); doorsRender(host); evWireTiles(host); };
  });
  host.querySelectorAll("[data-doorsswap]").forEach((el) => {
    el.onclick = () => {
      if (doorsSwap(+el.dataset.doorsswap)) showToast(`Swapped. ${evPlural(doorsYearState().swaps, "swap", "swaps")} left`);
      else showToast("No swaps left");
      doorsRender(host); evWireTiles(host);
    };
  });
  const draw = document.getElementById("doorsDraw") || document.getElementById("doorsRedraw");
  if (draw) draw.onclick = () => {
    if (drawn && !confirm("Draw a new month? Everything behind the doors changes, including the ones you have already opened.")) return;
    const n = doorsDraw();
    showToast(n ? `${n} doors drawn` : "No winter games found on the shelf");
    doorsRender(host); evWireTiles(host);
  };
  if (typeof maybeEnrich === "function") {
    maybeEnrich(Object.values(st.doors).map(evRow).filter(Boolean).concat(doorsPool().slice(0, 30)));
  }
}
