"use strict";

// UI components for pick.js. Feature state and orchestration remain in that module.

function pickRollTile(row, win) {
  const rec = igdbRecOf(row);
  const cs = coverSrc(rec, "cover_small");
  const pixel = coverIsPixelArt(rec, cs) ? " pixel" : "";
  const inner = cs
    ? `<img src="${escapeHtml(cs)}" alt=""${pixel ? ` class="pixel"` : ""}>`
    : `<span class="roll-ph">${icon("i-library", 22)}</span>`;
  // A coverless tile is born settled (imgok) — its glyph has no bytes to wait for, and a
  // shimmer that never ends would read as art that never came.
  return `<div class="roll-tile${win ? " win" : ""}${cs ? "" : " imgok"}">${inner}</div>`;
}

/* Six pip faces plus a recessed core cube. The faces' rounded corners open see-through
   notches at every cube corner — mid-tumble the page showed through them, and the landed
   face read as a flat rounded square. The core sits a few px inside each face; the
   notches now show its shaded surface instead of the background, which is exactly what a
   beveled corner looks like. */
function pickDieHtml() {
  return [1, 2, 3, 4, 5, 6].map((f) => {
    const on = new Set(PICK_PIPS[f]);
    const pips = Array.from({ length: 9 }, (_, i) => `<i${on.has(i) ? "" : ' class="off"'}></i>`).join("");
    return `<div class="roll-face rf${f}">${pips}</div><div class="roll-core rc${f}"></div>`;
  }).join("");
}

/* Covers hold their box until the bytes arrive: a still-loading tile wears a shimmer
   pane and its art fades in over it, so a cold cache shimmers instead of popping covers
   in one tile at a time mid-spin. Art the session already decoded — usually all of it,
   from the grid — appears instantly; pixels you were just looking at shouldn't
   reintroduce themselves on a re-roll.

   Its own function because RNG mode's three reels are the same tiles wanting the same
   behaviour (rng.js), and a second copy would be a second answer to when a cover fades. */
function pickWireRollTiles(host) {
  host.querySelectorAll(".roll-tile img").forEach((img) => {
    const tile = img.parentElement;
    const ok = () => { img.classList.add("ok"); tile.classList.add("imgok"); };
    if (img.complete && img.naturalWidth) {
      img.style.transitionDuration = "0s";
      ok();
      requestAnimationFrame(() => requestAnimationFrame(() => { img.style.transitionDuration = ""; }));
    } else {
      img.onload = ok;
      // A 404 settles to the same glyph a coverless game gets, not a broken-image icon.
      img.onerror = () => {
        const ph = document.createElement("span");
        ph.className = "roll-ph";
        ph.innerHTML = icon("i-library", 22);
        img.replaceWith(ph);
        tile.classList.add("imgok");
      };
    }
  });
}

function playPickRoll(picked, pool) {
  const host = $("#pickResult");
  if (!host) { renderPicker(); return; }
  const my = ++_pickRollN;
  const dur = 2100;

  // A strip that lands the winner near (not at) the end, so it scrolls IN rather than
  // starting under the frame. Everything else is drawn from the pool for real covers.
  const N = 44, LAND = 38;
  const others = pool.filter((r) => r !== picked);
  const draw = () => others.length ? others[Math.floor(Math.random() * others.length)] : picked;
  const seq = Array.from({ length: N }, (_, i) => (i === LAND ? picked : draw()));

  host.innerHTML = `<div class="pick-roll">
    <div class="roll-reel-mask">
      <div class="roll-reel" id="pickRollReel">${seq.map((r, i) => pickRollTile(r, i === LAND)).join("")}</div>
      <div class="roll-reel-hi" id="pickRollHi"></div>
    </div>
    <div class="roll-die-scene"><div class="roll-die" id="pickRollDie">${pickDieHtml()}</div></div>
    <div class="roll-word" id="pickRollWord">Rolling…</div>
  </div>`;

  pickWireRollTiles(host);

  const reel = $("#pickRollReel");
  const winTile = reel.children[LAND];
  // offsetLeft folds in the gaps, so this centres the winner without hard-coding a tile width.
  const target = winTile.offsetLeft - reel.parentElement.clientWidth / 2 + winTile.offsetWidth / 2;
  reel.animate([
    { transform: "translateX(0)", filter: "blur(0)" },
    { transform: `translateX(${-target * 0.34}px)`, filter: "blur(7px)", offset: .4 },
    { transform: `translateX(${-target}px)`, filter: "blur(0)" },
  ], { duration: dur, easing: "cubic-bezier(.16,.8,.18,1)", fill: "forwards" });

  const [ex, ey] = PICK_FACE_ROT[1 + Math.floor(Math.random() * 6)];
  const spins = 4;
  $("#pickRollDie").animate([
    { transform: "translateZ(-31px) rotateX(0) rotateY(0)" },
    { transform: `translateZ(-31px) rotateX(${ex + 360 * spins}deg) rotateY(${ey + 360 * spins + 180}deg)` },
  ], { duration: dur, easing: "cubic-bezier(.15,.72,.2,1)", fill: "forwards" });

  // Light the frame just before the stop, then swap in the real card.
  setTimeout(() => {
    if (_pickRollN !== my) return;
    const hi = $("#pickRollHi"); if (hi) hi.classList.add("lit");
    const w = $("#pickRollWord"); if (w) w.textContent = "Locked in";
  }, dur * 0.82);
  setTimeout(() => {
    if (_pickRollN !== my || activeTab !== "pick") return;
    renderPicker();                          // rebuilds #picker wholesale, so the card is a fresh
    const card = $("#pickResult .pick-card");  // node — reach for it, not the detached host.
    if (card) card.classList.add("rolled-in");
  }, dur + 160);
}

function pickCard(row) {
  // The REAL grid card, not a bespoke one — so the trailer plays on hover here exactly as
  // it does in the listings (renderPicker hands it to wirePreviewFor).
  const rec = igdbRecOf(row);
  const game = `<div class="${posterClassName(row)}" id="pickGameCard">${
    posterContentHtml(row, cardBodyHtml(row), { enrichment: rec, pending: coverPending(row), eager: true })}</div>`;

  const chips = [row.platform, row.releaseYear, row.genre, row.franchise]
    .filter((x) => x != null && x !== "")
    .map((x) => chipHtml(x)).join("");
  // launchHtml, not rommHtml: it composes BOTH — "Play now" via RomM and the storefront the
  // copy you own actually came from. The pick is a game you're deciding whether to play right
  // now, so the way to start playing it belongs on the card, not one click away in the drawer.
  const play = typeof launchHtml === "function" ? launchHtml(row) : "";

  // Only promise a trailer when there is one.
  const hint = rec.video ? `<span class="pick-hint">Hover for the trailer</span>` : "";
  const eyebrow = `${icon("i-dice", 13)} Your pick`;
  const details = `<button class="pick-open" id="pickOpen">Full details</button>`;
  /* The split-title flair: a subtitled game reads as its series name over the subtitle —
     the over-line small, letterspaced and in the second accent (a different voice from the
     violet eyebrow above it), the subtitle at full display weight. Split on ": " or a
     spaced dash only, so "Half-Life" stays whole; the over-line is capped so a colon deep
     in a long title doesn't demote most of it to an eyebrow. */
  const tm = /^(.{2,32}?)(?::\s+|\s+[–—-]\s+)(.{3,})$/.exec(String(row.title));
  const titleHtml = tm
    ? `<h2><span class="pick-t-pre">${escapeHtml(tm[1])}</span>${escapeHtml(tm[2])}</h2>`
    : `<h2>${escapeHtml(String(row.title))}</h2>`;
  return `<div class="pick-card">
    <div class="pick-art">${game}${hint}</div>
    <div class="pick-info">
      <div class="pick-eyebrow">${eyebrow}</div>
      ${titleHtml}
      <div class="pick-chips">${chips}</div>
      ${heroStatsHtml(row)}
      ${predictWhyHtml(row)}
      <div class="pick-actions">
        <button class="pick-reroll" id="pickReroll">${icon("i-dice", 15)} Re-roll</button>
        ${details}
        ${play}
      </div>
    </div>
  </div>`;
}

function pickValueRowsHtml(node, field) {
  const all = _pkVals || (_pkVals = pickFieldValues(field, node));
  const q = pickPop.q.toLowerCase();
  const vals = q ? all.filter((v) => v.label.toLowerCase().includes(q)) : all;
  if (!vals.length) return `<p class="pk-pop-empty">Nothing here matches the rest of your filter.</p>`;
  const shown = pickPop.all ? vals : vals.slice(0, PICK_POP_CAP);
  const on = new Set(node.vals || []);
  return shown.map((v) => `<label class="facet-opt${on.has(v.key) ? " checked" : ""}">
      <input type="checkbox" data-v="${escapeHtml(v.key)}"${on.has(v.key) ? " checked" : ""}>
      <span class="lbl">${escapeHtml(v.label)}</span><span class="cnt">${v.n.toLocaleString()}</span>
    </label>`).join("") +
    (vals.length > shown.length
      ? `<button class="facet-more" id="pkPopMore">Show ${(vals.length - shown.length).toLocaleString()} more…</button>`
      : "");
}

function pickPopHtml(path) {
  const node = pickNodeAt(path);
  const field = pickFieldByKey(node.key);
  if (pickPop.mode === "field") {
    const q = pickPop.q.toLowerCase();
    const hits = pickFields().filter((f) => !q || f.label.toLowerCase().includes(q));
    /* Groups keep their hand-written order (PICK_GROUP_ORDER is a rough "how likely are
       you to reach for this"), but WITHIN a group the fields were in catalogue order —
       whatever sequence the sheet's columns, then IGDB's, then the computed ones happened
       to arrive in. That's insertion order pretending to be a ranking. Alphabetical: the
       list is for finding a field you already have in mind. Counts order the VALUES, where
       "how many games" is real information; a field name has no such thing. */
    const groups = PICK_GROUP_ORDER
      .map((g) => [g, hits.filter((f) => f.group === g)
        .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }))])
      .filter(([, fs]) => fs.length);
    return `<div class="pk-pop" tabindex="-1" data-path="${path.join(".")}">
      ${searchField("pkPopSearch", "Find a field…", pickPop.q, "field-facet")}
      <div class="pk-pop-list" id="pkPopList">${groups.map(([g, fs]) =>
        `<div class="pk-pop-grp">${escapeHtml(g)}</div>` +
        fs.map((f) => `<button class="pk-pop-field${f.key === node.key ? " on" : ""}" data-f="${escapeHtml(f.key)}">${escapeHtml(f.label)}</button>`).join("")
      ).join("") || `<p class="pk-pop-empty">No field by that name.</p>`}</div>
    </div>`;
  }
  if (!field) return "";
  // The birthday isn't in the sheet and there's nowhere to put it, so the one
  // field that needs a setting carries it.
  const bday = field.key === "__pk_bday"
    ? `<label class="pk-pop-set">My birthday
         <input id="pkBday" type="date" value="${birthday() ? `2000-${birthday()}` : ""}" title="Only the month and day are used">
       </label>` : "";
  const many = (field.buckets || []).length === 0;
  return `<div class="pk-pop" tabindex="-1" data-path="${path.join(".")}">
    <div class="pk-pop-head">
      <button class="pk-pop-refield" data-act="refield" data-path="${path.join(".")}">${escapeHtml(field.label)} <span class="chev">▾</span></button>
      <button class="pk-pop-clear" data-act="clear" data-path="${path.join(".")}">Clear</button>
    </div>
    ${bday}
    ${many ? searchField("pkPopSearch", "Filter values…", pickPop.q, "field-facet") : ""}
    <div class="pk-pop-list" id="pkPopList">${pickValueRowsHtml(node, field)}</div>
  </div>`;
}

function pickCondHtml(node, path) {
  const p = path.join(".");
  const field = pickFieldByKey(node.key);
  const vals = node.vals || [];
  const shown = vals.slice(0, 2).map((v) => (field && field.type === "bool") ? (v === "true" ? "Yes" : "No") : v);
  // A field can genuinely vanish — an old ?fb= link, or an auto-bucketed one whose
  // ladder came back empty (no priced games, nothing to bucket). compilePick treats
  // that as a no-op, so the chip must not sit there in a filter's clothing claiming
  // to narrow anything: name it, blame it, and let it be removed.
  const text = !field ? "field unavailable"
    : vals.length ? shown.join(", ") + (vals.length > 2 ? ` +${vals.length - 2}` : "")
    : "choose…";
  return `<div class="pk-chip${node.not ? " neg" : ""}${field ? "" : " broken"}${vals.length && field ? "" : " todo"}${pickPop.path === p ? " open" : ""}"
    ${field ? "" : `title="Nothing in this collection answers “${escapeHtml(String(node.key))}”, so this criterion is ignored."`}>
    <b class="pk-chip-f">${escapeHtml(field ? field.label : "Unknown field")}</b>
    <button class="pk-chip-not" data-act="not" data-path="${p}"
      title="${node.not ? "Currently excluding these" : "Currently including these"}">${node.not ? "is not" : "is"}</button>
    <button class="pk-chip-v" data-act="${field ? "edit" : "refield"}" data-path="${p}">${escapeHtml(text)}</button>
    <button class="pk-chip-x" data-act="del" data-path="${p}" title="Remove" aria-label="Remove">✕</button>
    ${pickPop.path === p ? pickPopHtml(path) : ""}
  </div>`;
}

function pickGroupHtml(node, path) {
  const p = path.join(".");
  const nested = path.length > 0;
  const kids = node.kids.map((k, i) =>
    (isPickGroup(k) ? pickGroupHtml : pickCondHtml)(k, [...path, i])).join("");
  // "Match all of" one thing is a question nobody asked — the and/or only starts
  // meaning something at two. A nested group keeps its bar regardless: that's where
  // its remove button lives.
  const showOp = node.kids.length > 1;
  const mode = groupMode(node);
  // "Don't match all of" is unreachable from this select (De Morgan says it's
  // "any of (not…, not…)", which reads better) — but a hand-edited ?fb= link can
  // still say it, and a select that can't show the state it's in would lie.
  const modes = GROUP_MODES.filter((m) => m.v !== "notall" || mode.v === "notall");
  const bar = (nested || showOp)
    ? `<div class="pkg-bar">
        ${showOp ? `<select class="pkg-op" data-act="op" data-path="${p}" title="How these criteria combine">
          ${modes.map((m) => `<option value="${m.v}"${m.v === mode.v ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
        </select>` : ""}
        ${nested ? `<button class="pkg-x" data-act="gdel" data-path="${p}" title="Remove this group" aria-label="Remove group">✕</button>` : ""}
      </div>`
    : "";
  return `<div class="pkg${nested ? " nested" : ""}${node.not ? " neg" : ""}">
    ${bar}
    ${!node.kids.length && !nested ? `<p class="pkg-empty">No criteria yet. ${pkb.emptyHint || "every game in the backlog is in play"}.</p>` : ""}
    <div class="pkg-kids">
      ${kids}
      <button class="pk-add" data-act="add" data-path="${p}" title="Add a criterion">${icon("i-plus", 12)} Criterion</button>
      <button class="pk-add ghost" data-act="gadd" data-path="${p}" title="Add a nested group">${icon("i-plus", 12)} Group</button>
    </div>
  </div>`;
}

function renderPicker() {
  pkbUse(PICK_TAB_BUILDER);   // the challenge editor borrows the builder; take it back
  const host = $("#picker");
  _pkVals = null;                  // the pool may have moved; recount on demand
  if (!pickState.filter) applyPreset(pickState.preset || "backlog");
  // A popover is pinned to a path, and the tree underneath it can move (a preset
  // replaces it wholesale, a chip two along gets removed). Re-check the path still
  // lands on a criterion rather than painting against a node that isn't there.
  if (pickPop.path !== null) {
    let n = null;
    try { n = pickNodeAt(pickPath(pickPop.path)); } catch (_) { /* path went stale */ }
    if (!n || isPickGroup(n)) closePickPop();
  }
  const pool = pickPool();

  /* RNG mode rolls three at once, so the counts and the button copy come from the slots
     rather than from the pool (see `shown` below) — except while the enrichment map is
     still arriving, when the slots have no answer yet and asking for one would only get
     three zeroes. rngLoading holds the whole thing back: no pooling, no pruning, and the
     controls say nothing they'd have to take back. */
  const rng = pickModeRng();
  const loading = rng && rngLoading();
  if (rng && !loading) rngPrune();
  // The free slots' pools, not all three: a pinned slot is holding a game you're playing
  // and doesn't roll, so neither the count nor the button speaks for it (see rng.js).
  const rngN = (rng && !loading) ? rngPoolCount() : 0;
  const rollable = loading ? 0 : (rng ? rngN : pool.length);
  const hasResult = loading ? false
    : rng ? rngHasPicks() : (pickState.picked && pool.includes(pickState.picked));
  const rollLabel = rng ? rngRollLabel() : "Pick for me";

  const modes = `<div class="pick-modes" role="group" aria-label="How many games to pick">
    ${[["one", "One game", "i-dice"], ["rng", "RNG", "i-layers"]].map(([m, lbl, ic]) =>
      `<button type="button" class="pick-mode${pickState.mode === m ? " on" : ""}" data-mode="${m}"
         aria-pressed="${pickState.mode === m}">${icon(ic, 14)} ${lbl}</button>`).join("")}
    ${rng ? `<span class="pick-modenote">One modern AAA, one modern indie, one retro. Pin what you're playing and the roll fills the rest.</span>` : ""}
  </div>`;

  /* The count every control quotes. In RNG mode it's the slots' totals, not the pool: the
     slots apply their own rules on top (owned, no DLC, priority, language, series order)
     and a pinned slot rolls nothing at all, so "12,736 games" over a roll that can only
     reach 5,438 of them is a number that reads as a promise and isn't one. */
  const shown = rng ? rngN : pool.length;
  // A shimmer, not "0 games in pool": the pool isn't empty, it isn't counted yet.
  const games = loading ? "" : `${shown.toLocaleString()} game${shown === 1 ? "" : "s"}`;
  // New games since the last paint, or the same ones redrawn? (see pickResultKey)
  const rk = pickResultKey();
  const fresh = rk !== _pickDrawnFor ? " fresh" : "";
  _pickDrawnFor = rk;

  /* RNG mode renders none of the pool chrome: no preset, no time budget, no builder,
     no saved pickers, and none of the phone sheet that houses them (see rngPools —
     it rolls the backlog whole). Two separate templates rather than one riddled with
     conditionals, because what they have in common is three controls and a result.

     It returns before the single pick's own setup below, which is the point: none of
     the preset optgroups, the saved-picker list or the criteria count is work RNG mode
     has any use for. */
  if (rng) {
    host.innerHTML = `
      ${modes}
      <div class="pick-controls rng-controls">
        <button id="pickBtn" class="pick-btn"${rollable ? "" : " disabled"}>${icon("i-dice", 16)} ${rollLabel}</button>
        <span class="pick-count${loading ? " skel" : ""}">${loading ? "" : `${games} in pool`}</span>
        <label class="pick-anim pick-togo" title="Steam Deck verified or playable, handhelds, and anything a Deck can emulate. No VR, no point-and-click.">
          <input type="checkbox" id="rngToGo"${rngState.toGo ? " checked" : ""}${loading ? " disabled" : ""}> Playable on the go
        </label>
        <label class="pick-anim" title="Play a slot-machine animation when rolling">
          <input type="checkbox" id="pickAnim"${pickAnimOn() ? " checked" : ""}> Roll animation
        </label>
      </div>
      <div class="pick-result rng${fresh}" id="pickResult">${rngResultHtml()}</div>
      <div class="pick-bar"><button class="pick-btn" id="pickBtnM" type="button"${rollable ? "" : " disabled"}>
        ${icon("i-dice", 16)} ${rollLabel}
      </button></div>`;
    settleCachedCovers(host);
    const rollAll = () => { rngRollAll(true); nav(); };
    $("#pickBtn").onclick = rollAll;
    $("#pickBtnM").onclick = rollAll;
    $("#rngToGo").onchange = (e) => { rngSetToGo(e.target.checked); nav(); };
    wirePickModes(host);
    wirePickAnim();
    wireRngResult();
    return;
  }

  const mins = pickBudgetMinutes();
  const groups = {};
  PRESETS.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
  const opts = Object.entries(groups).map(([g, ss]) =>
    `<optgroup label="${escapeHtml(g)}">${ss.map((s) =>
      `<option value="${s.id}"${s.id === pickState.preset ? " selected" : ""}>${escapeHtml(s.label)}</option>`).join("")}</optgroup>`).join("");
  const saved = savedPickers();
  const isDef = pickIsDefault();
  /* A preset already has a name, and it's a better one than you'd type — so there's
     nothing to save until you've said something the preset doesn't. That moment has a
     name already too: pickEdited() empties pickState.preset as soon as you change
     anything it said, which is exactly when the dropdown starts reading "Custom filter". */
  const saveable = !pickState.preset;
  const sumLabel = pickState.preset
    ? (presetById(pickState.preset) || PRESETS[0]).label : "Custom filter";
  const critN = pickCritCount(pickState.filter);

  host.innerHTML = `
    ${modes}
    <div class="pick-mtop">
      <span class="pick-msum">${escapeHtml(sumLabel)} · ${games}</span>
      <button class="pick-crit" id="pickCrit" type="button"
        aria-expanded="${pickSheetOpen}" aria-controls="pickSheet">
        ${icon("i-filter", 14)} Criteria${critN ? ` <span class="pick-filters-n">${critN}</span>` : ""}
      </button>
    </div>
    <div class="pick-shwrap${pickSheetOpen ? " open" : ""}" id="pickSheet">
      <div class="pick-shhead"><b>Build the pool</b>
        <span class="pick-shcount">${games}</span>
        <button class="pick-shclose" id="pickShClose" aria-label="Close">✕</button>
      </div>
      <div class="pick-shbody">
        <div class="pick-controls">
          <label>Start from <select id="pickPreset">
            ${pickState.preset ? "" : `<option value="" selected>Custom filter</option>`}${opts}
          </select></label>
          <label class="pick-time">I have
            <select id="pickTime">
              <option value="0"${mins ? "" : " selected"}>Any length</option>
              ${TIME_BUDGETS.map((b) =>
                `<option value="${b.m}"${b.m === mins ? " selected" : ""}>${escapeHtml(b.label)}</option>`).join("")}
            </select>
          </label>
          <button id="pickBtn" class="pick-btn"${rollable ? "" : " disabled"}>${icon("i-dice", 16)} ${rollLabel}</button>
          <span class="pick-count">${games} in pool</span>
          ${isDef ? "" : `<button id="pickReset" class="pick-reset" title="Back to the default filter">Reset</button>`}
          <label class="pick-anim" title="Play a dice-roll animation when picking a game">
            <input type="checkbox" id="pickAnim"${pickAnimOn() ? " checked" : ""}> Roll animation
          </label>
        </div>
        ${saved.length || saveable ? `<div class="pick-saved">
          ${saved.map((p, i) => `<button class="view-chip" data-pi="${i}" title="${escapeHtml(p.desc || "")}">
              ${escapeHtml(p.name)}<span class="view-x" data-px="${i}" title="Forget this picker">✕</span>
            </button>`).join("")}
          ${saveable ? `<button class="view-save" id="pickSave">＋ Save this picker</button>` : ""}
        </div>` : ""}
        <div class="pick-builder" id="pickBuilder">${pickGroupHtml(pickState.filter, [])}</div>
      </div>
      <button class="pick-shgo" id="pickShGo" type="button"${rollable ? "" : " disabled"}>
        ${icon("i-dice", 16)} ${!rollable
          ? (rng ? "Nothing fits these slots" : "Nothing matches these criteria")
          : rng
            ? `Roll three from these ${rngN.toLocaleString()} games`
            : `Roll from ${pool.length === 1 ? "this 1 game" : `these ${pool.length.toLocaleString()} games`}`}
      </button>
    </div>
    <div class="pick-shback" id="pickShBack"${pickSheetOpen ? "" : " hidden"}></div>
    <div class="pick-result${fresh}" id="pickResult">${hasResult
      ? pickCard(pickState.picked)
      : `<div class="pick-empty">${pool.length ? "Hit “Pick for me” to roll a game." : "Nothing matches this filter."}</div>`}</div>
    <div class="pick-bar"><button class="pick-btn" id="pickBtnM" type="button"${rollable ? "" : " disabled"}>
      ${icon("i-dice", 16)} ${hasResult ? "Re-roll" : "Pick for me"}
    </button></div>`;

  settleCachedCovers(host);
  // The pick card composes launchHtml, which reads `stores` — a field the whole-library map
  // no longer ships (see _BULK_DROP in enrich.py), because three surfaces showing one game
  // each are not worth 1.9 MB on every page load. Ask for this one game's; postEnrich
  // re-renders the picker when it lands, and the button appears.
  if (!rng && pickState.picked && typeof maybeEnrich === "function") maybeEnrich([pickState.picked]);

  // "Custom filter" is a readout of where you've ended up, not a thing you can
  // choose — selecting it should leave the tree you built alone.
  $("#pickPreset").onchange = (e) => {
    if (!e.target.value) return;
    closePickPop(); applyPreset(e.target.value); renderPicker(); nav();
  };
  // Writes a criterion rather than a second kind of state — so it shows up as a chip you
  // can negate, widen, or drag into an OR, and the dropdown says "Custom filter" because
  // by then that is exactly what it is.
  $("#pickTime").onchange = (e) => { closePickPop(); pickSetBudget(+e.target.value); renderPicker(); nav(); };
  const roll = () => { pickGame(true); nav(); };
  $("#pickBtn").onclick = roll;
  wirePickModes(host);
  wirePickAnim();
  const reset = $("#pickReset");
  if (reset) reset.onclick = () => { closePickPop(); applyPreset(PICK_DEFAULT_PRESET); renderPicker(); nav(); };
  wirePickSaved();
  wirePickBuilder();
  // The mobile chrome. All of it renders at every width and none of it shows on desktop
  // (see the Option-B block in style.css), so there's no width test to keep in step.
  $("#pickCrit").onclick = () => pickSheetSet(!pickSheetOpen);
  $("#pickShClose").onclick = () => pickSheetSet(false);
  $("#pickShBack").onclick = () => pickSheetSet(false);
  // The sheet's CTA IS the roll — building criteria flows straight into a pick rather
  // than ending on a Done button and a hunt for the dice.
  $("#pickShGo").onclick = () => { pickSheetSet(false); roll(); };
  $("#pickBtnM").onclick = roll;
  pickSheetA11y();          // the sheet was just rebuilt bare; dress it for the width
  positionPickPop();

  const game = host.querySelector("#pickGameCard");
  if (game) {
    // Same card component as the listings, so it gets the same hover trailer.
    wirePreviewFor(game, pickState.picked);
    game.onclick = () => openDrawer(pickState.picked, "games");
    $("#pickReroll").onclick = (e) => { e.stopPropagation(); pickGame(true); nav(); };
    const open = $("#pickOpen");
    if (open && open.tagName === "BUTTON") open.onclick = () => openDrawer(pickState.picked, "games");
  }
}

// Repaint just the popover's option rows. Rebuilding the picker on every keystroke
// would destroy the input the keystrokes are going into — the same trap the facet
// sidebar documents at renderFacets. Focus is the caller's business: what should hold it
// afterwards depends on what caused the repaint, and only the caller knows that.
function pickPopRepaint() {
  const list = $("#pkPopList");
  if (!list || !pickPop.path) return;
  const path = pickPath(pickPop.path);
  const node = pickNodeAt(path);
  if (pickPop.mode === "field") {
    const wrap = list.closest(".pk-pop");
    wrap.outerHTML = pickPopHtml(path);
  } else {
    list.innerHTML = pickValueRowsHtml(node, pickFieldByKey(node.key));
  }
  wirePickBuilder();
  positionPickPop();          // "show all" just changed how tall this is
}
