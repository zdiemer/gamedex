"use strict";

// UI components for ev-underthree.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function u3SplitHtml(c) {
  const row = evRow(c.key);
  if (!row) return "";
  const delta = (+c.actual || 0) - (+c.est || 0);
  const sign = delta > 0 ? "over" : delta < 0 ? "under" : "even";
  return `<tr>
    <td><button class="linkbtn" data-evopen="${escapeHtml(c.key)}">${escapeHtml(String(row.title))}</button></td>
    <td class="m">${evHours(c.est)}</td>
    <td class="m"><input class="ev-num" type="number" step="0.25" min="0" value="${+c.actual || 0}"
      data-u3actual="${escapeHtml(c.key)}" aria-label="Actual hours for ${escapeHtml(String(row.title))}"></td>
    <td class="m ${sign}">${delta === 0 ? "on the nose" : `${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}h`}</td>
    <td class="m">${escapeHtml(c.at || "")}</td>
    <td><button class="ev-x" data-u3undo="${escapeHtml(c.key)}" aria-label="Un-clear">${icon("i-close", 12)}</button></td>
  </tr>`;
}

function u3Render(host) {
  const ev = EV.byId.underthree;
  const s = u3YearState();
  const pool = u3Pool();
  const rate = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : (+r.metacriticRating || 0));
  const shortlist = pool.filter((r) => !u3Has(evKey(r))).sort((a, b) => rate(b) - rate(a)).slice(0, 24);
  const hours = u3Hours();
  const left = Math.max(0, s.target - hours);

  host.innerHTML = evHeroHtml(ev, {
    acts: `<label class="ev-target">Target
      <input type="number" id="u3Target" min="1" max="999" value="${s.target}"> hours</label>`,
    note: `${pool.length.toLocaleString()} games on your shelf come in under ${U3_MAX} hours.`,
  }) + `<div class="ev-wrap">
    <div class="ev-clock">
      <span class="ev-clock-big">${Math.round(hours * 10) / 10}<i>h</i></span>
      <span class="ev-clock-of">of ${s.target} · ${left ? `${Math.round(left * 10) / 10}h to go` : "target cleared"}</span>
    </div>
    ${s.cleared.length ? `<section class="ev-panel wide">
      <h3>Splits</h3>
      <p class="ev-p">What the sheet said against what it took. ${u3Est() ? `Estimated
        ${evHours(u3Est())} in total, actually ${evHours(hours)}.` : ""}</p>
      <div class="ev-table-wrap"><table class="ev-splits">
        <thead><tr><th>Game</th><th>Estimate</th><th>Actual</th><th>Difference</th><th>Cleared</th><th></th></tr></thead>
        <tbody>${s.cleared.map(u3SplitHtml).join("")}</tbody>
      </table></div>
    </section>` : ""}
    <section class="ev-panel wide">
      <h3>On the clock</h3>
      <p class="ev-p">Best rated first. Nothing here is longer than an evening.</p>
      <div class="ev-row-tiles">${shortlist.map((r) => `<div class="ev-u3">
        ${evTileHtml(r, { sub: `${r.platform || ""} · ${evHours(+r.estimatedTime)}` })}
        <button class="btn sm" data-u3clear="${escapeHtml(evKey(r))}">Clear it</button>
      </div>`).join("")}</div>
    </section>
  </div>`;

  host.querySelectorAll("[data-u3clear]").forEach((el) => {
    el.onclick = () => {
      const row = evRow(el.dataset.u3clear);
      if (row) { u3Clear(row); showToast(`${String(row.title)} cleared`); }
      u3Render(host); evWireTiles(host);
    };
  });
  host.querySelectorAll("[data-u3undo]").forEach((el) => {
    el.onclick = () => { u3Unclear(el.dataset.u3undo); u3Render(host); evWireTiles(host); };
  });
  host.querySelectorAll("[data-u3actual]").forEach((el) => {
    el.onchange = () => { u3SetActual(el.dataset.u3actual, el.value); u3Render(host); evWireTiles(host); };
  });
  const target = document.getElementById("u3Target");
  if (target) target.onchange = () => { u3SetTarget(target.value); u3Render(host); evWireTiles(host); };
  if (typeof maybeEnrich === "function") maybeEnrich(shortlist.concat(s.cleared.map((c) => evRow(c.key)).filter(Boolean)));
}
