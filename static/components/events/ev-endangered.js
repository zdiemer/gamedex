"use strict";

// UI components for ev-endangered.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function endRowHtml(r) {
  const key = evKey(r);
  const risk = endRisk(r);
  return `<div class="ev-risk r${risk}">
    <span class="ev-risk-dot" aria-hidden="true"></span>
    ${evTileHtml(r, { sub: `${r.platform || ""}${r.estimatedTime ? " · " + evHours(r.estimatedTime) : ""}` })}
    <span class="ev-risk-why">${escapeHtml(END_WHY[risk] || "")}${
      endSub(r) ? ` · ${escapeHtml(String(r.subscription))}` : ""}</span>
    <button class="ev-x" data-endsnooze="${escapeHtml(key)}" title="Snooze: accept the risk and stop showing it">${icon("i-check", 13)}</button>
  </div>`;
}

function endRender(host) {
  const ev = EV.byId.endangered;
  const st = endState();
  const queue = endQueue();
  const fresh = endNew().length;
  const gone = endGone();
  const snoozed = Object.keys(st.snoozed).map(evRow).filter(Boolean);
  const subs = queue.filter(endSub).length;
  const online = queue.filter(endOnline).length;

  host.innerHTML = evHeroHtml(ev, {
    note: `${subs} on a subscription · ${online} always online · ${queue.length} in the queue`,
  }) + `<div class="ev-wrap">
    <p class="ev-p wide">This queue reads two rungs: the sheet's subscription column, and IGDB's game
      modes. The third rung, whether a game is <b>offline or delisted</b>, is one IGDB field the
      enricher does not fetch yet, so nothing here can tell you that a server has already
      been turned off. It ranks what is exposed, not what is dead.</p>
    ${queue.length ? `<div class="ev-risks">${queue.slice(0, 40).map(endRowHtml).join("")}</div>`
      : `<p class="ev-none">Nothing on the shelf is at risk by these two rungs, which either means
         the collection is all offline single-player games or that enrichment has not caught up.</p>`}
    ${queue.length > 40 ? `<p class="ev-more">${queue.length - 40} more below the fold.</p>` : ""}
    ${snoozed.length ? `<section class="ev-panel wide">
      <h3>Accepted</h3>
      <p class="ev-p">${evPlural(snoozed.length, "game", "games")} you have decided not to worry about.</p>
      <div class="ev-row-tiles">${snoozed.slice(0, 16).map((r) => `<div class="ev-u3">
        ${evTileHtml(r, { cls: "sm" })}
        <button class="btn sm ghost" data-endwake="${escapeHtml(evKey(r))}">Put it back</button>
      </div>`).join("")}</div>
    </section>` : ""}
    ${gone.length ? `<section class="ev-panel wide">
      <h3>Gone before you got there</h3>
      <p class="ev-p">The sheet flags ${evPlural(gone.length, "row", "rows")} as delisted, and not one of
        them is owned. That is a record of what got away rather than what is at risk, which is why it
        sits down here instead of in the queue.</p>
      <div class="ev-row-tiles">${gone.slice(0, 12).map((r) => evTileHtml(r, { cls: "sm" })).join("")}</div>
    </section>` : ""}
  </div>`;

  host.querySelectorAll("[data-endsnooze]").forEach((el) => {
    el.onclick = () => { endSnooze(el.dataset.endsnooze); endRender(host); evWireTiles(host); };
  });
  host.querySelectorAll("[data-endwake]").forEach((el) => {
    el.onclick = () => { endUnsnooze(el.dataset.endwake); endRender(host); evWireTiles(host); };
  });
  // Looking at the queue is what makes it quiet again. Done after the render so the page
  // you are looking at still shows how many were new when you arrived.
  if (fresh) setTimeout(endMarkSeen, 0);
  if (typeof maybeEnrich === "function") maybeEnrich(queue.slice(0, 40).concat(gone.slice(0, 12)));
}
