"use strict";

// UI components for ev-twoplayer.js. Feature state and orchestration remain in that module.

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
