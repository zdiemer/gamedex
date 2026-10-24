"use strict";

// UI components for hilo.js. Feature state and orchestration remain in that module.

// ---- render ----------------------------------------------------------------
function renderHilo() {
  const host = $("#hilo");
  if (!host) return;
  if (!HL.loaded && !HL.failed) {
    host.innerHTML = `<div class="px-wrap"><p class="muted">Shuffling today's deck…</p></div>`;
    loadHilo();
    return;
  }
  if (HL.failed || !HL.dim) {
    host.innerHTML = `<div class="px-wrap">${emptyState("No deck today",
      "Couldn't deal a run from the library. It'll try again tomorrow.")}</div>`;
    return;
  }

  const d = HL_DIMS[HL.dim] || { label: HL.dim, icon: "i-trend", blurb: "" };
  const rec = hlRecord();
  const tally = hlPracticeTally();
  host.innerHTML = `<div class="px-wrap hl-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-trend", 13)} Daily Hi-Lo · ${HL.practice ? "endless practice" : escapeHtml(HL.date)}</span>
        <h1>Higher or lower?</h1>
        <p class="muted"><b class="dx-mode">${icon(d.icon, 13)} ${escapeHtml(d.label)}</b>
          — ${escapeHtml(d.blurb)} Ties are on the house.</p>
      </div>
      ${HL.practice ? `<div class="px-streak">
        <b>${tally.best}</b><span>practice best</span>
        <em>${tally.played} deck${tally.played === 1 ? "" : "s"} this device</em>
      </div>` : `<div class="px-streak">
        <b>${rec.best || 0}</b><span>best run</span>
        <em>${rec.played || 0} day${(rec.played || 0) === 1 ? "" : "s"} played</em>
      </div>`}
    </div>

    <div class="hl-score">Run: <b>${HL.score}</b> · deck of ${HL.total}</div>
    <div class="hl-board">
      ${hlCardHtml(HL.cur, true)}
      <div class="hl-vs">vs</div>
      ${HL.next ? hlCardHtml(HL.next, false) : ""}
    </div>
    ${!HL.practice && !HL.over
      ? `<div class="hl-run-actions"><button class="btn" id="hlShare"${HL.score > 0 ? "" : " disabled"}>${HL.score > 0 ? "Share run" : "Share after first call"}</button></div>` : ""}
    ${HL.over ? hlEndHtml() : ""}
    ${hlPracticeHtml()}
  </div>`;

  wireHilo(host);
}

function hlCardHtml(g, open) {
  if (!g) return "";
  const cover = g.cover ? IMG(g.cover, "cover_big") : "";
  // On year days the challenger's meta line must not say the answer.
  const meta = [g.platform, g.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  const r = HL.reveal;
  let foot;
  if (open) {
    foot = `<div class="hl-val">${escapeHtml(hlFmt(g.value))}</div>`;
  } else if (r) {
    foot = `<div class="hl-val ${r.correct ? "good" : "bad"}">${escapeHtml(hlFmt(r.value))}</div>`;
  } else if (HL.over) {
    // The run is done; the challenger that ended (or cleared) it keeps its number.
    foot = g.value != null ? `<div class="hl-val ${HL.cleared ? "good" : "bad"}">${escapeHtml(hlFmt(g.value))}</div>` : "";
  } else {
    foot = `<div class="hl-btns">
      <button class="btn" id="hlHigher">▲ Higher</button>
      <button class="btn" id="hlLower">▼ Lower</button>
    </div>`;
  }
  return `<div class="hl-card${open ? " open" : ""}">
    ${cover ? `<img src="${escapeHtml(cover)}" alt="" draggable="false">` : ""}
    <div class="hl-card-b">
      <b>${escapeHtml(String(g.title || ""))}</b>
      <span class="muted">${meta}</span>
      ${foot}
    </div>
  </div>`;
}

function hlEndHtml() {
  const d = HL_DIMS[HL.dim] || { label: HL.dim };
  const rec = hlRecord();
  const best = HL.practice ? hlPracticeTally().best : (rec.best || 0);
  return `<div class="px-win hl-end">
    <div class="px-win-b">
      <span class="h-eyebrow">${HL.cleared ? "Cleared the deck!" : "Run over"}</span>
      <h2>${HL.score} in a row</h2>
      <p class="muted">${HL.cleared
        ? `Every ${escapeHtml(d.label.toLowerCase())} call, correct. There is nothing left to deal.`
        : (HL.practice ? "Another deck is a click away." : "The deck reshuffles at midnight UTC.")}</p>
      ${best ? `<p class="px-bonus">★ Best run: ${best}.</p>` : ""}
      ${HL.practice ? "" : `<div class="px-win-actions"><button class="btn" id="hlShare">Share result</button></div>`}
    </div>
  </div>`;
}

/* ---- practice ----------------------------------------------------------- */
function hlPracticeHtml() {
  const chips = ["any", ...Object.keys(HL_DIMS)].map((k) => {
    const label = k === "any" ? "Any stat" : HL_DIMS[k].label;
    return `<button class="dx-chip${hlPracticeDim === k ? " on" : ""}" data-hldim="${k}">${escapeHtml(label)}</button>`;
  }).join("");
  if (HL.practice) {
    return `<div class="dx-practice">
      <div class="dx-practice-h"><b>Endless practice</b>
        <span class="muted">Fresh decks, any stat, nothing recorded but your bragging rights.</span></div>
      <div class="dx-chips">${chips}</div>
      <div class="px-guess">
        <button class="btn" id="hlNextDeck">New deck</button>
        <button class="btn ghost" id="hlBackToday">← Back to today's</button>
      </div>
    </div>`;
  }
  return `<div class="dx-practice">
    <div class="dx-practice-h"><b>Endless practice</b>
      <span class="muted">${HL.over ? "Deck's done — deal another." : "Or drill a stat of your choosing."}</span></div>
    <div class="dx-chips">${chips}</div>
    <div class="px-guess"><button class="btn" id="hlPracticeGo">Deal a deck</button></div>
  </div>`;
}

function hlCelebrate() {
  const host = $("#hilo");
  if (!host || !WANTS_MOTION) return;
  const box = document.createElement("div");
  box.className = "px-confetti";
  box.innerHTML = Array.from({ length: 40 }, () =>
    `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg"></i>`).join("");
  host.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}
