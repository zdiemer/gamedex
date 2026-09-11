"use strict";

/* Endangered — the anti-event.

   Always on, no window, no completion state, because this queue never empties. It ranks
   what could stop working before you get to it, which is the only real urgency a backlog
   has and the one thing the rest of the app cannot see.

   It earns a place on Home by never taking a date: the banner appears when the queue
   CHANGES — a game you own turns up at risk that has not been in the list before — and
   goes quiet again once you have looked. That is why an always-on event can share a year
   with nine seasons without ever fighting one for the single banner slot.

   Three rungs of risk, two of which are already free:

     1. SUBSCRIPTION — a column the sheet already keeps. Yours only while the subscription
        is, which is a different kind of owning and the sheet is honest about it.
     2. ALWAYS ONLINE — IGDB's game_modes, which the enricher already stores. Massively
        Multiplayer Online and Battle Royale are the games that end when a server does.
        Note what this rung does NOT do: match on titles. A regex for "destiny" drags in
        Tales of Destiny and Destiny Connect: Tick-Tock Travelers, which is the Spooktober
        noun problem wearing a new coat. A game mode is what a game IS.
     3. OFFLINE / DELISTED — IGDB carries a game status with both as first-class values,
        and igdb.py fetches neither. That is one field in two field lists plus an
        EXTRAS_VERSION bump, and it is the rung that would tell you something you do not
        already know. Until then the app cannot tell you that a game on your shelf has
        already had its servers turned off, and it says so rather than implying otherwise.

   One inversion worth keeping straight: the sheet's own `delisted` flag marks rows you do
   NOT own. It is a record of what got away, not of what is at risk, so it sits in its own
   panel at the bottom and never in the queue. */

const endState = () => {
  const st = evState("endangered");
  if (!st.snoozed) st.snoozed = {};
  if (!Array.isArray(st.seen)) st.seen = [];
  return st;
};

const endOnline = (r) => evHasMode(r, "massively multiplayer online", "battle royale");
const endSub = (r) => !!String(r.subscription || "").trim();

// Risk, highest first. A game that is both rented and always online is the one to play now.
function endRisk(r) {
  const online = endOnline(r), sub = endSub(r);
  if (online && sub) return 3;
  if (online) return 2;
  if (sub) return 1;
  return 0;
}

const endQueue = () => {
  const st = endState();
  return evPool("endangered", (r) => !!r.owned && !r.completed && endRisk(r) > 0, { group: false })
    .slice()
    .filter((r) => !st.snoozed[evKey(r)])
    // Risk first, then the shortest, because the point is what you could actually finish
    // in the time you might have left rather than what you would most enjoy.
    .sort((a, b) => endRisk(b) - endRisk(a) ||
      (+a.estimatedTime || 999) - (+b.estimatedTime || 999));
};
const endGone = () => evPool("endangered-gone", (r) => !!r.delisted, { group: false });
const endNew = () => {
  const seen = new Set(endState().seen);
  return endQueue().filter((r) => !seen.has(evKey(r)));
};

function endMarkSeen() {
  const st = endState();
  const keys = endQueue().map(evKey);
  const seen = new Set(st.seen);
  let changed = false;
  for (const k of keys) if (!seen.has(k)) { st.seen.push(k); changed = true; }
  // The list only grows with the collection; it is keys, not rows, and 200 of them is a
  // couple of KB. Trimming it would just make the banner shout about the same games again.
  if (changed) evSave();
}
function endSnooze(key) {
  endState().snoozed[key] = evISO();
  evSave();
}
function endUnsnooze(key) {
  delete endState().snoozed[key];
  evSave();
}

const END_WHY = {
  3: "rented, and always online",
  2: "always online",
  1: "on a subscription",
};

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

evRegister({
  id: "endangered",
  name: "Endangered",
  icon: "i-server",
  structure: "Queue",
  priority: 40,
  window: null,                       // the one event with no season
  core: null,
  cta: "See what is at risk",
  blurb: "what could stop working before you get to it",
  // Always on means always ELIGIBLE, not always shouting: the banner turns up when the
  // queue has something in it you have not seen.
  live: () => endNew().length > 0,
  skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:54px;--ev-dw:800;--ev-ls:.01em;" +
        "--ev-deco:#fbbf24;--ev-fg:#f7ecdc;--ev-fg-2:#c4b39c;--ev-edge:rgba(251,191,36,.3);" +
        "--ev-edge-hi:rgba(248,113,113,.6);--ev-glow:rgba(248,113,113,.3);--ev-t1:#fff3e2;" +
        "--ev-t2:#fbbf24;--ev-t3:#f87171;--ev-on-cta:#2a1206;--ev-k:#fbbf24;" +
        "--ev-art:repeating-linear-gradient(135deg,rgba(251,191,36,.05) 0 12px,transparent 12px 26px)," +
        "radial-gradient(110% 150% at 84% 120%,rgba(248,113,113,.26),transparent 58%)," +
        "radial-gradient(90% 130% at 6% -20%,rgba(251,191,36,.18),transparent 60%)," +
        "linear-gradient(140deg,#100e0a,#1a1410 70%,#211711)",
  deco: [
    { i: "i-server", x: 86, y: 66, s: 44, lift: 12 },
    { i: "i-nosignal", x: 70, y: 22, s: 28, lift: 11, d: 80 },
    { i: "i-plug", x: 46, y: 20, s: 24, r: -10, lift: 14, d: 30 },
    { i: "i-disc", x: 71, y: 82, s: 22, lift: 9, d: 150, o: .55 },
    { i: "i-ban", x: 47, y: 84, s: 18, lift: 8, d: 220, o: .5 },
    { i: "i-watch", x: 57, y: 12, s: 16, lift: 16, d: 190, o: .45 },
  ],
  blank: () => ({ snoozed: {}, seen: [] }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [k, at] of Object.entries(theirs.snoozed || {})) {
      if (!(k in mine.snoozed)) { mine.snoozed[k] = at; changed = true; }
    }
    // Seen is a union: a game either device has shown you is not new any more.
    const seen = new Set(mine.seen);
    for (const k of theirs.seen || []) if (!seen.has(k)) { mine.seen.push(k); changed = true; }
    return changed;
  },
  eyebrow: () => "Always on · no season",
  pitch: () => {
    const q = endQueue();
    const fresh = endNew().length;
    if (!q.length) return "Nothing on the shelf is at risk right now. This queue never empties for long.";
    if (fresh) return `${evPlural(fresh, "new game", "new games")} at risk. ${q.length} in the queue, and nothing here has a finish line.`;
    return `${q.length} games on your shelf need somebody else to keep a server running.`;
  },
  meter: () => {
    const q = endQueue();
    return { pct: null, text: q.length ? `${q.length} at risk · ordered by risk, never by taste` : "the queue is empty" };
  },
  render: endRender,
  reset: () => {},
});
