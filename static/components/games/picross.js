"use strict";

// UI components for picross.js. Feature state and orchestration remain in that module.

// ---- render ----------------------------------------------------------------
function renderPicross() {
  const host = $("#picross");
  if (!host) return;
  if (!PX.date) {
    host.innerHTML = `<div class="px-wrap"><p class="muted">Loading today's puzzle…</p></div>`;
    loadPicross();
    return;
  }
  if (PX.w === 0) {
    host.innerHTML = `<div class="px-wrap">${emptyState("No puzzle today",
      "Couldn't cut a solvable grid out of the library. It'll try again tomorrow.")}</div>`;
    return;
  }

  const st = pxStreak();
  const maxRow = Math.max(...PX.rows.map((r) => r.length));
  const maxCol = Math.max(...PX.cols.map((c) => c.length));

  const clueHtml = (nums, settled, pad) =>
    Array(pad).fill(`<i class="pad"></i>`).concat(
      nums.map((n, i) => `<i class="${settled[i] ? "ok" : ""}">${n ? n : 0}</i>`)).join("");

  const colClues = PX.cols.map((c, x) => {
    const settled = pxSettled(pxCol(x), c);
    return `<div class="px-cc${pxColDone(x) ? " done" : ""}" data-cx="${x}">${
      clueHtml(c, settled, maxCol - c.length)}</div>`;
  }).join("");

  const grid = [];
  for (let y = 0; y < PX.h; y++) {
    if (!PX.solved) {
      const r = PX.rows[y];
      const settled = pxSettled(pxLine(y), r);
      grid.push(`<div class="px-rc${pxRowDone(y) ? " done" : ""}" data-cy="${y}">${
        clueHtml(r, settled, maxRow - r.length)}</div>`);
    }
    for (let x = 0; x < PX.w; x++) {
      grid.push(`<button class="${pxCellClass(x, y)}" data-x="${x}" data-y="${y}"
        aria-label="${x + 1},${y + 1}"></button>`);
    }
  }

  host.innerHTML = `<div class="px-wrap">
    <div class="px-head">
      <div>
        <span class="h-eyebrow">${icon("i-star", 13)} Daily Picross · ${escapeHtml(PX.date)}</span>
        <h1>Draw the box art</h1>
        <p class="muted">The picture is a cover from your own shelf. Solve it to find out which,
          or name it early for the bonus.</p>
      </div>
      <div class="px-streak">
        <b>${pxCurrentStreak()}</b><span>day streak</span>
        <em>best ${st.best || 0} · ${st.solved || 0} solved</em>
      </div>
    </div>

    ${PX.solved ? pxWinHtml() : `<div class="px-guess">
      <span class="ac-wrap"><input id="pxGuess" type="text" placeholder="Know it already? Name the game…" autocomplete="off"></span>
      <button class="btn" id="pxGuessGo">Guess</button>
      <span class="px-guess-msg" id="pxMsg"></span>
    </div>`}

    <!-- ONE grid: the corner, the column clues, then a row-clue gutter and its cells per row.
         The clue strips were separate grids and drifted out of alignment with the cells they
         label — the column numbers sat over the row-clue gutter. Same grid, same track sizes,
         alignment can't drift.
         Once it's solved the clues aren't rendered AT ALL: it isn't a puzzle any more, it's a
         picture, and leaving the numbers behind meant hovering the finished cover still lit up
         a row and a column of a grid that no longer exists. -->
    <div class="px-board${PX.solved ? " solved" : ""}" style="--w:${PX.w};--h:${PX.h}">
      ${PX.solved ? "" : `<div class="px-corner"></div>${colClues}`}
      ${grid.join("")}
    </div>

    <div class="px-tools">
      ${PX.solved ? "" : `
        <div class="px-tool-row">
          <button class="px-tool${pxTool === 1 ? " on" : ""}" data-tool="1">■ Fill</button>
          <button class="px-tool${pxTool === 2 ? " on" : ""}" data-tool="2">✕ Empty</button>
          <button class="px-tool${pxTool === 3 ? " on" : ""}" data-tool="3">• Maybe</button>
          <button class="px-tool ghost" id="pxClear">Clear</button>
        </div>
        <!-- Under the buttons, not beside them: a sentence of instructions wedged into the end
             of a row of controls reads as a fourth, very wide, broken button. -->
        <p class="px-hint">Drag to paint. The stroke locks to the row or column you set off in.
          Right-click for ✕, middle-click for •.</p>`}
      <div class="px-tool-row">
        <button class="px-tool ghost" id="pxReset">↺ Reset puzzle</button>
      </div>
    </div>
  </div>`;

  wirePicross(host);
  if (PX.solved) pxReveal(host);
}

function pxWinHtml() {
  const g = PX.game || {};
  const cs = g.cover ? IMG(g.cover, "cover_big") : "";
  return `<div class="px-win">
    ${cs ? `<img src="${escapeHtml(cs)}" alt="">` : ""}
    <div class="px-win-b">
      <span class="h-eyebrow">${PX.guessedEarly ? "Called it" : "Solved"}</span>
      <h2>${escapeHtml(String(g.title || ""))}</h2>
      <p class="muted">${[g.platform, g.year].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ")}</p>
      ${PX.guessedEarly ? `<p class="px-bonus">★ Named it before you finished the grid.</p>` : ""}
      <div class="px-win-actions">
        <button class="btn" id="pxShare">Share result</button>
        <button class="btn ghost" id="pxOpen">Open in library</button>
      </div>
    </div>
  </div>`;
}

// A small shower of the cover's own colour. Cheap, and it makes finishing feel like finishing.
function pxCelebrate() {
  const host = $("#picross");
  if (!host || !WANTS_MOTION) return;
  const box = document.createElement("div");
  box.className = "px-confetti";
  box.innerHTML = Array.from({ length: 40 }, (_, i) =>
    `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 0.6).toFixed(2)}s;--r:${Math.round(Math.random() * 360)}deg"></i>`).join("");
  host.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}
