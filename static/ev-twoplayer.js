"use strict";

/* Two-Player February — the only event whose state contains a person.

   Every other event on this board asks what you will play. This one asks WHO WITH, and a
   night is not finished until it has a name on it. That is the whole structure: a row is a
   game plus a person plus a date, and two thirds of a row is not a plan.

   Eight nights, not twenty-eight. A co-op night needs somebody else's calendar, so a full
   month of them is a fantasy and eight is a thing that might actually happen. */

const TWOP_N = 8;

/* The pool is real data rather than a genre guess: IGDB's game_modes, which the enricher
   already stores for every matched game. Co-operative and Split screen only — Multiplayer
   on its own is every online shooter ever made, and this event is about a sofa. */
const twopPool = () => evPool("twoplayer",
  (r) => !!r.owned && evHasMode(r, "co-operative", "split screen"));

const twopYearState = () => {
  const st = evState("twoplayer");
  const y = String(evYear(EV.byId.twoplayer));
  if (!st.years[y]) st.years[y] = { nights: [] };
  const s = st.years[y];
  while (s.nights.length < TWOP_N) s.nights.push({ key: null, who: "", when: "" });
  return s;
};
const twopPlanned = () => twopYearState().nights.filter((n) => n.key && n.who.trim()).length;
const twopStarted = () => twopYearState().nights.filter((n) => n.key || n.who.trim()).length;

function twopSet(i, patch) {
  const s = twopYearState();
  Object.assign(s.nights[i], patch);
  evSave();
}
function twopClear(i) {
  const s = twopYearState();
  s.nights[i] = { key: null, who: "", when: "" };
  evSave();
}

// The invitation. The event fails if it stays inside the app, so a planned night has to
// leave as one line of text you can paste into a message.
function twopInvite(n) {
  const row = n.key ? evRow(n.key) : null;
  if (!row) return "";
  const when = n.when ? ` on ${n.when}` : "";
  return `${n.who || "you"} + me${when}: ${row.title}${row.platform ? ` (${row.platform})` : ""}`;
}

function twopNightHtml(i) {
  const n = twopYearState().nights[i];
  const row = n.key ? evRow(n.key) : null;
  const ready = row && n.who.trim();
  return `<div class="ev-night${ready ? " ready" : ""}">
    <span class="ev-night-n">${i + 1}</span>
    <div class="ev-night-game">
      ${row ? evTileHtml(row, { sub: row.platform || "" })
        : `<button class="ev-slot-add" data-twoppick="${i}">${icon("i-pad", 22)}<span>Pick a game</span></button>`}
    </div>
    <div class="ev-night-who">
      <label>Who
        <input type="text" data-twopwho="${i}" value="${escapeHtml(n.who || "")}" placeholder="a name" autocomplete="off">
      </label>
      <label>When
        <input type="date" data-twopwhen="${i}" value="${escapeHtml(n.when || "")}">
      </label>
    </div>
    <div class="ev-night-acts">
      ${ready ? `<button class="linkbtn" data-twopcopy="${i}">Copy the invitation</button>` : ""}
      ${row ? `<button class="ev-swap" data-twoppick="${i}">Change</button>` : ""}
      ${(row || n.who) ? `<button class="ev-x" data-twopclear="${i}" aria-label="Clear night ${i + 1}">${icon("i-close", 13)}</button>` : ""}
    </div>
  </div>`;
}

function twopRender(host) {
  const ev = EV.byId.twoplayer;
  const s = twopYearState();
  const pool = twopPool();
  const used = new Map(s.nights.filter((n) => n.key).map((n, i) => [n.key, "Already booked"]));
  const repaint = () => { twopRender(host); evWireTiles(host); };

  host.innerHTML = evHeroHtml(ev, {
    note: pool.length
      ? `${pool.length.toLocaleString()} games on your shelf list local co-op or split screen.`
      : `No co-op games matched yet. That rung reads IGDB's game modes, so it fills in as enrichment lands, and the picker's “any game” tick works meanwhile.`,
  }) + `<div class="ev-wrap">
    <div class="ev-nights">${Array.from({ length: TWOP_N }, (_, i) => twopNightHtml(i)).join("")}</div>
    ${evPickerHtml(used)}
  </div>`;

  host.querySelectorAll("[data-twoppick]").forEach((el) => {
    el.onclick = () => {
      const i = +el.dataset.twoppick;
      evPickerOpen({
        slot: i, pool, title: `Night ${i + 1}`, repaint,
        onPick: (key) => { twopSet(i, { key }); evPickerClose(); repaint(); },
      });
    };
  });
  // Typed input saves on blur rather than on every keystroke: a PUT per character is a
  // sync storm, and a name is a thing you finish typing.
  host.querySelectorAll("[data-twopwho]").forEach((el) => {
    el.onchange = () => twopSet(+el.dataset.twopwho, { who: el.value });
    el.onblur = () => { twopSet(+el.dataset.twopwho, { who: el.value }); repaint(); };
  });
  host.querySelectorAll("[data-twopwhen]").forEach((el) => {
    el.onchange = () => { twopSet(+el.dataset.twopwhen, { when: el.value }); repaint(); };
  });
  host.querySelectorAll("[data-twopclear]").forEach((el) => {
    el.onclick = () => { twopClear(+el.dataset.twopclear); repaint(); };
  });
  host.querySelectorAll("[data-twopcopy]").forEach((el) => {
    el.onclick = async () => {
      const text = twopInvite(s.nights[+el.dataset.twopcopy]);
      try { await navigator.clipboard.writeText(text); showToast("Invitation copied"); }
      catch (_) { showToast(text); }
    };
  });
  evWirePicker(host, repaint, used);
  if (typeof maybeEnrich === "function") {
    maybeEnrich(s.nights.map((n) => n.key && evRow(n.key)).filter(Boolean).concat(pool.slice(0, 40)));
  }
}

evRegister({
  id: "twoplayer",
  name: "Two-Player February",
  icon: "i-heart",
  structure: "Pairs",
  priority: 80,
  window: { from: [2, 1], to: [2, 28] },
  core: { from: [2, 1], to: [2, 28] },
  cta: "Plan a night",
  blurb: "eight nights, each with somebody else's name on it",
  skin: "--ev-disp:'Pacifico',var(--display);--ev-size:44px;--ev-dw:400;--ev-ls:0;" +
        "--ev-deco:#ff6fa5;--ev-fg:#ffeaf2;--ev-fg-2:#dcb6c8;--ev-edge:rgba(255,79,140,.36);" +
        "--ev-edge-hi:rgba(255,143,184,.72);--ev-glow:rgba(255,79,140,.4);--ev-t1:#fff2f7;" +
        "--ev-t2:#ff8fb8;--ev-t3:#ff4f8c;--ev-on-cta:#2b0413;--ev-k:#ff8fb8;" +
        "--ev-art:radial-gradient(120% 150% at 82% 120%,rgba(255,79,140,.32),transparent 58%)," +
        "radial-gradient(90% 130% at 8% -20%,rgba(124,92,255,.26),transparent 60%)," +
        "linear-gradient(140deg,#130610,#22081a 72%,#2b0a16)",
  deco: [
    { i: "i-pad", x: 85, y: 66, s: 46, r: -6, lift: 12 },
    { i: "i-pad", x: 71, y: 80, s: 30, r: 9, lift: 9, d: 100 },
    { i: "i-heart", x: 24, y: 18, s: 22, r: -10, lift: 14, d: 30 },
    { i: "i-heart", x: 54, y: 12, s: 16, r: 8, lift: 16, d: 160, o: .6 },
    { i: "i-heart", x: 44, y: 84, s: 18, r: -6, lift: 8, d: 240, o: .7 },
    { i: "i-sparkle", x: 93, y: 26, s: 22, lift: 11, d: 130, o: .6 },
  ],
  blank: () => ({ years: {} }),
  merge: (mine, theirs) => {
    let changed = false;
    for (const [y, t] of Object.entries(theirs.years || {})) {
      const m = mine.years[y];
      if (!m) { mine.years[y] = t; changed = true; continue; }
      (t.nights || []).forEach((n, i) => {
        if (!m.nights[i]) { m.nights[i] = n; changed = true; return; }
        // A night with a name on it beats an empty one, either way round. Nothing here
        // overwrites a filled night, because that is a plan with a person in it.
        const mineFilled = m.nights[i].key || (m.nights[i].who || "").trim();
        const theirsFilled = n.key || (n.who || "").trim();
        if (!mineFilled && theirsFilled) { m.nights[i] = n; changed = true; }
      });
    }
    return changed;
  },
  eyebrow: () => "Seasonal event · February",
  pitch: () => {
    const planned = twopPlanned(), started = twopStarted();
    const s = twopYearState();
    const next = s.nights.find((n) => n.key && n.who.trim());
    if (!started) return `Eight nights, two controllers. None of them has a name on it yet.`;
    if (next) {
      const row = evRow(next.key);
      return `${evPlural(planned, "night", "nights")} planned. ${row ? String(row.title) : "A game"} with ${next.who}${next.when ? ` on ${next.when}` : ""}.`;
    }
    return `${evPlural(started, "night", "nights")} started. A night needs a name before it counts.`;
  },
  meter: () => ({ pct: Math.round((twopPlanned() / TWOP_N) * 100),
                  text: `${twopPlanned()} of ${TWOP_N} nights have a name on them` }),
  render: twopRender,
  reset: () => { EVP.slot = null; EVP.q = ""; EVP.all = false; },
});
