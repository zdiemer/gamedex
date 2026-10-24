"use strict";

// UI components for themes.js. Feature state and orchestration remain in that module.

/* ---- the page ------------------------------------------------------------- */
function thmSlotHtml(t, run, slot) {
  const key = run.slate[slot];
  const row = key ? evRow(key) : null;
  if (!row) {
    return `<div class="ev-slot empty">
      <button class="ev-slot-add" data-thmpick="${slot}" aria-label="Choose a game for slot ${slot + 1}">
        ${icon(t.icon, 24)}<span>Pick one</span>
      </button></div>`;
  }
  const done = thmIsDone(run, key);
  const pinned = thmPinned(run, key);
  return `<div class="ev-slot thm-slot${done ? " done" : ""}${pinned ? " pinned" : ""}">
    ${evTileHtml(row, { sub: `${row.platform || ""}${
      row.estimatedTime ? " · " + evHours(row.estimatedTime) : ""}` })}
    ${t.reason ? `<p class="thm-note">${escapeHtml(t.reason(row))}</p>` : ""}
    ${done ? `<span class="thm-done-tag">${icon("i-check", 12)} Finished</span>` : ""}
    <!-- Four actions under a tile that is 166px wide at its narrowest, so they are all
         icon-only and the row is a four-column grid rather than a flex line: an equal
         fraction each, no intrinsic width to overflow, identical on a phone and a desktop.
         None of them is a completion tick — that is the sheet's to say, not this page's. -->
    <span class="ev-slot-acts thm-acts">
      <button class="ev-pin" data-thmpin="${escapeHtml(key)}" aria-pressed="${pinned}"
        aria-label="${pinned ? "Pinned" : "Pin it"}"
        title="${pinned ? "Pinned — a roll leaves it alone" : "Pin it so a roll leaves it alone"}"
        >${icon("i-pin", 13)}</button>
      <button class="ev-swap" data-thmreroll="${slot}" aria-label="Roll this slot again"
        title="Roll just this one again">${icon("i-dice", 13)}</button>
      <button class="ev-swap" data-thmpick="${slot}" aria-label="Choose this one by hand"
        title="Pick this slot by hand">${icon("i-search", 13)}</button>
      <button class="ev-x" data-thmdrop="${slot}" aria-label="Clear the slot"
        title="Empty the slot">${icon("i-close", 13)}</button>
    </span>
  </div>`;
}

/* Themes are a catalog, not a dial. The page keeps one compact current-theme
   control in the flow and opens the full, searchable catalog only when asked. Each card
   wears its own poster palette, so browsing is recognition rather than reading a pill rail. */
function thmBrowserHtml(t) {
  const switcher = `<button class="thm-switcher" id="thmBrowseOpen" type="button"
      aria-haspopup="dialog" aria-label="Browse all ${THEMES.length} themes">
    <span class="thm-switch-icon">${icon(t.icon, 21)}</span>
    <span class="thm-switch-copy"><small>Current theme</small><b>${escapeHtml(t.name)}</b>
      <i>${escapeHtml(t.blurb)}</i></span>
    <span class="thm-switch-action">${icon("i-grid", 15)} Browse ${THEMES.length}</span>
  </button>`;
  if (!THM_BROWSER.open) return switcher;
  const cards = THEMES.map((x) => `<button class="thm-choice${x.id === t.id ? " on" : ""}"
      type="button" data-thmgo="${x.id}"
      data-thmhay="${escapeHtml((x.name + " " + x.blurb).toLowerCase())}" style="${x.skin}">
    <span class="thm-choice-art">${icon(x.icon, 25)}${x.id === t.id
      ? '<em>Current</em>' : ""}</span>
    <span class="thm-choice-copy"><b>${escapeHtml(x.name)}</b>
      <i>${escapeHtml(x.blurb)}</i><small>${thmChoiceMeta(x)}</small></span>
  </button>`).join("");
  return switcher + `<div class="thm-browser-scrim" id="thmBrowserScrim">
    <section class="thm-browser" role="dialog" aria-modal="true" aria-labelledby="thmBrowserTitle">
      <header class="thm-browser-head">
        <span><small>Theme library</small><b id="thmBrowserTitle">Find a slate</b></span>
        <button class="icon-btn" id="thmBrowseClose" type="button" aria-label="Close theme browser">
          ${icon("i-close", 18)}</button>
      </header>
      <label class="thm-browser-search">${icon("i-search", 16)}
        <input id="thmBrowseSearch" type="search" autocomplete="off" placeholder="Search themes"
          aria-label="Search themes" value="${escapeHtml(THM_BROWSER.q)}">
        <small id="thmBrowserCount">${THEMES.length} themes</small>
      </label>
      <div class="thm-browser-grid">${cards}</div>
      <p class="thm-browser-empty" id="thmBrowserEmpty" hidden>No themes match that search.</p>
    </section>
  </div>`;
}

function thmRender(host) {
  const focused = THM_BROWSER.dialog?.host.contains(document.activeElement) ? document.activeElement.id : null;
  const browserDialog = THM_BROWSER.dialog;
  const ev = EV.byId.themes;
  const t = thmTheme();
  const run = thmRun(t);
  const pool = thmPool(t);
  const breadth = thmBreadth(t);
  const done = thmDoneCount(run);
  const cap = thmCap(t);
  const gap = run.n - thmFilled(run);
  const repaint = () => { thmRender(host); evWireTiles(host); };

  /* The registry entry wears the active theme (see the header). Both of these have to be
     set before evHeroHtml reads them, and the HOST style has to be set here rather than
     left to evRenderPage — that one ran before the theme was known. */
  ev.skin = t.skin;
  ev.deco = t.deco;
  host.setAttribute("style", t.skin);

  const used = new Map(run.slate.filter(Boolean).map((k) => [k, "On the slate"]));

  host.innerHTML = evHeroHtml(ev, {
    acts: `<button class="btn" id="thmRoll">${icon("i-dice", 15)} ${
      thmComplete(run) ? `Roll a new ${run.n}`
        : thmActive(run) ? "Roll the open slots" : `Roll ${run.n}`}</button>
      <span class="ev-target thm-size" title="Anywhere from ${THM_MIN} to ${cap}${
        cap < THM_MAX ? ` — ${t.name} only has ${pool.length} left to roll from` : ""}">Slate of
        <button class="thm-step" data-thmn="${run.n - 1}" aria-label="One game fewer"
          ${run.n <= THM_MIN ? "disabled" : ""}>−</button>
        <b>${run.n}</b>
        <button class="thm-step" data-thmn="${run.n + 1}" aria-label="One game more"
          ${run.n >= cap ? "disabled" : ""}>+</button>
        ${run.n === 1 ? "game" : "games"}</span>
      ${run.pinned.length ? `<button class="btn ghost" id="thmUnpin"
        title="Unpin every slot, so the next roll can turn them over">${icon("i-pin", 14)} Unpin all ${
        run.pinned.length}</button>` : ""}`,
    // Two numbers, not four: what's left to play over what the theme matches at all. The
    // owned/unowned split read as bookkeeping under a hero, and whether a given roll is on
    // the shelf is a question about one game, which the tile is the place to answer.
    note: `${pool.length.toLocaleString()}/${breadth.length.toLocaleString()} to complete`,
  }) + `<div class="ev-wrap">
    ${thmBrowserHtml(t)}
    <section class="ev-panel wide">
      <!-- One sentence of counting, in the order you'd ask it: how big is the slate, how
           much of it is behind you, how much of it isn't filled yet. The last part only
           appears when there IS a gap, which is the number that used to go missing — a
           slate of 8 with 3 games on it read as "0 of 8 done" and looked broken. -->
      <h3>The slate · ${evPlural(run.n, "game", "games")}${
        thmActive(run) ? ` · ${done} finished` : ""}${gap ? ` · ${gap} still empty` : ""}</h3>
      <p class="ev-p">${thmActive(run)
        ? `Pin what you mean to keep and roll again — a roll only touches the open slots.
           ${thmComplete(run) ? `That is the whole slate finished — a roll starts the next ${run.n}.`
             : "Nothing to tick off: a game marks itself finished here when the sheet says it is."}`
        : `Roll ${run.n} out of the pool, or fill a slot by hand. Nothing here expires and
           nothing is scheduled — that is the difference between a theme and a season.`}</p>
      <div class="ev-mantel thm-mantel">${
        Array.from({ length: run.n }, (_, i) => thmSlotHtml(t, run, i)).join("")}</div>
      ${run.rolls ? `<p class="thm-meta">${evPlural(run.rolls, "roll", "rolls")} since ${
        escapeHtml(run.started || "—")}.</p>` : ""}
    </section>
    <p class="thm-note">${escapeHtml(t.note)}</p>
    ${evPickerHtml(used)}
  </div>`;

  const openBrowser = document.getElementById("thmBrowseOpen");
  if (openBrowser) openBrowser.onclick = () => {
    THM_BROWSER.open = true;
    repaint();
    // A programmatic focus opens the software keyboard on iOS and covers half the catalog.
    // Desktop pointer users still land in search immediately; touch users opt into it.
    const finePointer = !window.matchMedia ||
      window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const search = document.getElementById("thmBrowseSearch");
    if (finePointer && search) search.focus({ preventScroll: true });
  };
  const scrim = document.getElementById("thmBrowserScrim");
  if (scrim) {
    // Keep the open browser and its controls through background refreshes. This
    // preserves focus, search and its stack position beneath any nested dialog.
    if (browserDialog) scrim.replaceWith(browserDialog.host);
    else THM_BROWSER.dialog = mountUiDialog(scrim, {
      returnFocus: () => document.getElementById("thmBrowseOpen"),
      onClose: () => {
        THM_BROWSER.dialog = null;
        THM_BROWSER.open = false;
        THM_BROWSER.q = "";
      },
    });
    document.getElementById("thmBrowseClose").onclick = () => THM_BROWSER.dialog.close();
  }
  const search = document.getElementById("thmBrowseSearch");
  if (search) search.oninput = () => {
    THM_BROWSER.q = search.value.trim().toLowerCase();
    let shown = 0;
    host.querySelectorAll("[data-thmhay]").forEach((el) => {
      el.hidden = !!THM_BROWSER.q && !el.dataset.thmhay.includes(THM_BROWSER.q);
      if (!el.hidden) shown++;
    });
    const count = document.getElementById("thmBrowserCount");
    if (count) count.textContent = `${shown} ${shown === 1 ? "theme" : "themes"}`;
    const empty = document.getElementById("thmBrowserEmpty");
    if (empty) empty.hidden = shown !== 0;
  };
  if (search) search.oninput(); // reapply the current filter after a background repaint
  if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  host.querySelectorAll("[data-thmgo]").forEach((el) => {
    el.onclick = () => {
      THM_BROWSER.dialog.close();
      thmOpen(el.dataset.thmgo);
      evPickerClose();
      repaint();
    };
  });
  const roll = document.getElementById("thmRoll");
  if (roll) roll.onclick = () => { thmRoll(t); repaint(); };
  const unpin = document.getElementById("thmUnpin");
  if (unpin) unpin.onclick = () => {
    const n = thmClearPins(t);
    if (n) showToast(`${evPlural(n, "pin", "pins")} cleared — a roll turns them over now`);
    repaint();
  };
  host.querySelectorAll("[data-thmreroll]").forEach((el) => {
    el.onclick = () => { thmRoll(t, +el.dataset.thmreroll); repaint(); };
  });
  host.querySelectorAll("[data-thmpin]").forEach((el) => {
    el.onclick = () => { thmTogglePin(t, el.dataset.thmpin); repaint(); };
  });
  host.querySelectorAll("[data-thmdrop]").forEach((el) => {
    el.onclick = () => { thmDrop(t, +el.dataset.thmdrop); repaint(); };
  });
  host.querySelectorAll("[data-thmpick]").forEach((el) => {
    el.onclick = () => {
      const slot = +el.dataset.thmpick;
      evPickerOpen({
        slot, pool, title: `${t.name}, slot ${slot + 1}`, repaint,
        onPick: (key) => { thmSet(t, slot, key); evPickerClose(); repaint(); },
      });
    };
  });
  host.querySelectorAll("[data-thmn]").forEach((el) => {
    el.onclick = () => { thmResize(t, el.dataset.thmn); repaint(); };
  });
  evWirePicker(host, repaint, used);
  if (typeof maybeEnrich === "function") {
    maybeEnrich(run.slate.filter(Boolean).map(evRow).filter(Boolean).concat(pool.slice(0, 40)));
  }
  thmScheduleSync();
}

/* ---- the banner ------------------------------------------------------------
   Its own, rather than evBannerHtml's, for one reason: the banner has to wear the ACTIVE
   theme's skin, and evBannerHtml reads ev.skin off the registry entry — which is only
   correct after a page render has set it. A banner that depended on the page having been
   opened first would be right most of the time and wrong on a cold load, which is worse. */
function thmBannerHtml() {
  const ev = EV.byId.themes;
  const t = thmTheme();
  const run = thmRun(t);
  const m = ev.meter();
  return `<section class="ev-banner" data-ev="themes" style="${t.skin}" role="button" tabindex="0"
      aria-label="${escapeHtml(t.name)}: ${escapeHtml(t.blurb)}">
    <div class="ev-deco-wrap">${evDecoHtml(t.deco)}</div>
    <div class="ev-banner-in">
      <span class="h-eyebrow ev-eyebrow">Theme · no season, no deadline</span>
      <h2 class="ev-title">${escapeHtml(t.name)}</h2>
      <p class="ev-pitch">${escapeHtml(ev.pitch())}</p>
      <span class="ev-cta">${escapeHtml(thmComplete(run) ? "Roll a new slate" : "Back to the slate")} →</span>
      ${evMeterHtml(m)}
    </div>
  </section>`;
}
