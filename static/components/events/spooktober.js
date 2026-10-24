"use strict";

// UI components for spooktober.js. Feature state and orchestration remain in that module.

const spookDecoHtml = () => SPOOK_DECO.map((o) =>
  `<span class="spk-deco${o.cls ? " " + o.cls : ""}" aria-hidden="true" style="--x:${o.x}%;--y:${o.y}%;--r:${o.r}deg;--lift:${o.lift}px;--d:${o.d}ms">${icon(o.i, o.s)}</span>`
).join("");

function spookBannerHtml() {
  if (!spookInSeason()) return "";
  const filled = spookFilled();
  const pct = Math.round((filled / SPOOK_NIGHTS) * 100);
  return `<section class="spk-banner" id="spookBanner" role="button" tabindex="0"
      aria-label="Spooktober — build your October horror calendar">
    <div class="spk-banner-deco">${spookDecoHtml()}</div>
    <div class="spk-banner-inner">
      <span class="h-eyebrow spk-eyebrow">Seasonal event</span>
      <h2 class="spk-title">Spooktober</h2>
      <p class="spk-pitch">${escapeHtml(spookPitch())}</p>
      <span class="spk-cta">Build your calendar →</span>
      ${filled ? `<span class="spk-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>` : ""}
    </div>
  </section>`;
}

// Home repaints one section at a time (see patchHomeRecs); the banner's line depends on
// the calendar, so coming back from the event page has to refresh it without a full render.
function patchSpookBanner() {
  const cur = document.getElementById("spookBanner");
  if (!cur) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = spookBannerHtml();
  const next = tmp.firstElementChild;
  if (!next) { cur.remove(); return; }
  cur.replaceWith(next);
  wireSpookBanner(next.parentNode || document);
}

/* ---- the event page -------------------------------------------------------- */

/* A night's cell. `run` is the run STARTING here, or null for an empty night — the middle
   nights of a run go to spookContHtml below. */
function spookNightHtml(day, run) {
  const row = run ? run.row : null;
  const st = spookPhase();
  const isToday = st.phase === "during" && st.day === day;
  const past = (st.phase === "during" && day < st.day) || st.phase === "after";
  const done = spookRunDone(run);
  const pinned = !!row && !done && spookIsPinned(day);
  // Dealt in the order the dice touched them, capped so the last card isn't a wait.
  const deal = SPOOK.dealt ? SPOOK.dealt.indexOf(day) : -1;
  const cls = ["spk-night", row ? "filled" : "spk-empty", isToday ? "today" : "", past ? "past" : "",
    pinned ? "pinned" : "", done ? "done" : "", deal >= 0 ? "spk-dealt" : ""].filter(Boolean).join(" ");
  const delay = deal >= 0 ? ` style="--d:${Math.min(deal, 24) * 34}ms"` : "";
  const num = `<span class="spk-num">${day}${isToday ? `<em>tonight</em>` : ""}</span>`;
  if (!row) {
    return `<div class="${cls}"${delay}>${num}
      <button class="spk-add" data-day="${day}" aria-label="Choose a game for October ${day}">
        ${icon("i-pumpkin", 26)}<span>Pick</span>
      </button></div>`;
  }
  const k = escapeHtml(String(row._k || ""));
  const cs = typeof coverSrc === "function" ? coverSrc(ENRICH[row._k], "cover_big") : "";
  const cover = cs
    ? `<img class="spk-cover" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
    : `<span class="spk-cover ph">${icon("i-library", 22)}</span>`;
  /* At a pace the card has to say how much of the month this game is taking: the nights it
     books are the whole reason for setting one, and a cover with no number under it looks
     exactly like the one-a-night calendar. `warn` is a run still laid out to a pace that
     isn't the current pace — see spookRepack. */
  const hrs = spookHoursFor(row);
  const span = spookSpan(row);
  const want = spookWant(day, row);
  const nights = run.len > 1 ? `nights ${run.start}–${run.end}` : "one night";
  let pace = "";
  if (done) {
    // Checked off, and it outranks the pace line: whether it "fit" no longer matters.
    pace = `<span class="spk-span done">${icon("i-check", 10)} Finished</span>`;
  } else if (spookHpd()) {
    if (run.len !== want) {
      pace = `<span class="spk-span warn">needs ${want} night${want === 1 ? "" : "s"}</span>`;
    } else if (span > run.len) {
      // Placed by hand against the end of the month: it gets the nights that are left, and
      // the card says how many it would actually take rather than implying October covers it.
      pace = `<span class="spk-span warn">${nights} · ${span} to finish it</span>`;
    } else {
      pace = `<span class="spk-span">${nights}${hrs != null ? ` · ${fmtHours(hrs)}` : " · untimed"}</span>`;
    }
  }
  const range = run.len > 1 ? `October ${run.start}–${run.end}` : `October ${day}`;
  /* A finished game has nothing to pin — the dice already leave it alone — so the pin's
     corner becomes the check instead of a toggle that would claim to be doing something. */
  const corner = done
    ? `<span class="spk-pin spk-check" title="Finished — the dice will leave ${range} alone">${icon("i-check", 13)}</span>`
    : `<button class="spk-pin" data-pin="${day}" aria-pressed="${pinned}"
      title="${pinned ? `${range} is pinned — the dice will leave it alone` : `Pin ${range} so a re-roll keeps it`}">${icon("i-pin", 13)}</button>`;
  return `<div class="${cls}"${delay}>${num}
    ${corner}
    <button class="spk-slot" data-open="${k}" title="Open ${escapeHtml(String(row.title))}">
      ${cover}
      <span class="spk-slot-t">${escapeHtml(String(row.title))}</span>
      <span class="spk-slot-s">${escapeHtml(String(row.platform || ""))}</span>
      ${pace}
    </button>
    <span class="spk-night-acts">
      <button class="spk-swap" data-day="${day}" data-mode="swap" aria-label="Change the game on ${range}">Change</button>
      <button class="spk-x" data-clear="${day}" aria-label="Clear ${range}">${icon("i-close", 13)}</button>
    </span>
  </div>`;
}

/* The nights in the MIDDLE of a run. The grid is seven columns wide and a run can be ten
   nights long, so a run cannot be one wide cell without October losing its shape — every
   night it covers keeps its own cell instead, and these are the quiet ones: no cover, no
   buttons of their own, the title once more so a block reads without counting back to its
   head. Tapping one is tapping the run, so it opens the picker on the run's first night. */
function spookContHtml(day, run) {
  const st = spookPhase();
  const isToday = st.phase === "during" && st.day === day;
  const past = (st.phase === "during" && day < st.day) || st.phase === "after";
  const deal = SPOOK.dealt ? SPOOK.dealt.indexOf(day) : -1;
  const done = spookRunDone(run);
  const cls = ["spk-night", "spk-cont", isToday ? "today" : "", past ? "past" : "",
    done ? "done" : spookIsPinned(run.start) ? "pinned" : "", deal >= 0 ? "spk-dealt" : ""].filter(Boolean).join(" ");
  const delay = deal >= 0 ? ` style="--d:${Math.min(deal, 24) * 34}ms"` : "";
  const title = String((run.row && run.row.title) || "");
  return `<div class="${cls}"${delay}>
    <span class="spk-num">${day}${isToday ? `<em>tonight</em>` : ""}</span>
    <button class="spk-cont-in" data-day="${run.start}" data-mode="swap"
      title="Change the game on October ${run.start}–${run.end}">
      <span class="spk-cont-t">${escapeHtml(title)}</span>
      <span class="spk-cont-n">night ${day - run.start + 1} of ${run.len}</span>
    </button>
  </div>`;
}

// October, cell by cell: a run's first night is a card, the rest are continuations.
function spookGridHtml() {
  const byDay = new Map();
  for (const r of spookRuns()) for (let d = r.start; d <= r.end; d++) byDay.set(d, r);
  const out = [];
  for (let d = 1; d <= SPOOK_NIGHTS; d++) {
    const run = byDay.get(d);
    // A run whose game is no longer on the sheet resolves to nothing, and an empty cell is
    // the honest rendering of it — Fill treats those nights as empty too.
    if (!run || !run.row) out.push(spookNightHtml(d, null));
    else if (run.start === d) out.push(spookNightHtml(d, run));
    else out.push(spookContHtml(d, run));
  }
  return out.join("");
}

// The picker: the eligible pool, filtered by the search box, capped at what a person will
// actually look at. Split out of renderSpooktober so a keystroke repaints THIS list and
// nothing else — a full render would take the focus out of the box you're typing in.
function spookResultsHtml() {
  const used = new Map(spookRuns().map((r) => [r.key, r]));
  const q = SPOOK.q.trim().toLowerCase();
  const src = SPOOK.all ? spookAllGames() : spookPool();
  const pool = src.filter((r) => !q || String(r.title || "").toLowerCase().includes(q));
  if (!pool.length) {
    const none = SPOOK.all
      ? "Nothing on the sheet by that name."
      : (q ? "No horror game here by that name — tick “any game” to search the whole collection."
           : "No horror games found in the collection yet — enrichment may still be loading.");
    return `<p class="spk-none">${none}</p>`;
  }
  // Best-rated first when you haven't typed anything: the top of a 1,400-game list should be
  // a recommendation, not whatever the sheet happens to start with.
  const rank = (r) => (typeof combinedRating === "function" ? (combinedRating(r) ?? 0) : 0);
  const sorted = q ? pool : pool.slice().sort((a, b) => rank(b) - rank(a));
  const shown = sorted.slice(0, 60);
  const cards = shown.map((r) => {
    const on = used.get(String(r._k || ""));
    // "any game" is the only list a finished game can appear in, so it's the only list that
    // has to say so — otherwise the absence from the horror pool looks like a missing game.
    const where = on
      ? `<span class="spk-taken">${on.len > 1 ? `Nights ${on.start}–${on.end}` : `On night ${on.start}`}</span>`
      : (SPOOK.all && spookIsDone(r) ? `<span class="spk-fin">Finished</span>` : "");
    /* What choosing this one COSTS, in nights, before you choose it — picking a fifty-hour
       game for the 28th at two hours a night is a thing you should be able to see coming
       rather than discover from the grid afterwards (it gets clipped at the 31st). */
    const span = spookSpan(r);
    const over = SPOOK.picking != null && SPOOK.picking + span - 1 > SPOOK_NIGHTS;
    const cost = !spookHpd() ? ""
      : `<span class="spk-cost${over ? " warn" : ""}">${span} night${span === 1 ? "" : "s"}` +
        `${spookHoursFor(r) == null ? " · untimed" : ""}${over ? " · runs past the 31st" : ""}</span>`;
    const note = where + cost;
    return posterCardHtml(r, {
      cls: "spk-cand" + (on ? " taken" : ""),
      note,
      attrs: `data-put="${escapeHtml(String(r._k || ""))}"`,
    });
  }).join("");
  const more = sorted.length - shown.length;
  return `<div class="spk-cands grid">${cards}</div>` +
    (more > 0 ? `<p class="spk-more">${more.toLocaleString()} more — keep typing to narrow it down.</p>` : "");
}

function spookPickerHtml() {
  if (SPOOK.picking == null) return "";
  const run = spookRunAt(SPOOK.picking);
  const on = run && run.row ? String(run.row.title || "") : "";
  // The heading names the nights you are choosing FOR, which on a paced calendar is the run
  // you are about to replace rather than the single night you clicked.
  const head = run && run.row && run.len > 1
    ? `October ${run.start}–${run.end}` : `October ${SPOOK.picking}`;
  return `<div class="spk-picker${SPOOK.opening ? " spk-in" : ""}" id="spookPicker">
    <div class="spk-picker-head">
      <b>${head}</b>
      ${on ? `<span class="spk-on">now: ${escapeHtml(on)}</span>` : ""}
      ${searchField("spookQ", SPOOK.all ? "Search the whole collection…" : "Search horror games…",
                    SPOOK.q, "spk-field")}
      <label class="spk-any" title="Ignore the horror filter and pick from everything on the sheet">
        <input type="checkbox" id="spookAny"${SPOOK.all ? " checked" : ""}> any game
      </label>
      <button class="btn ghost" id="spookCancel">Done</button>
    </div>
    <div id="spookResults">${spookResultsHtml()}</div>
  </div>`;
}

function renderSpooktober() {
  const host = $("#spooktober");
  if (!host || !DATA) return;
  spookLoadPrefs();
  const filled = spookFilled();
  const pct = Math.round((filled / SPOOK_NIGHTS) * 100);
  const nights = spookNights();
  const st = spookPhase();
  const runs = spookRuns().filter((r) => r.row);
  const finished = runs.filter(spookRunDone).length;
  const pinned = runs.filter((r) => spookIsPinned(r.start) && !spookRunDone(r)).length;
  // Games, not nights: at one game per night they are the same number, and at a pace the
  // dice deal in games. "Re-roll 23 unpinned" on a six-game month would be a lie.
  const rerollable = runs.length - pinned - finished;
  const misfit = spookMisfits().length;
  const hpd = spookHpd();
  const paceSel = SPOOK_PACES.map((p) =>
    `<option value="${p}"${p === hpd ? " selected" : ""}>${SPOOK_PACE_LABELS[p]}</option>`).join("");
  // Off-season the page still opens (a link has to work), it just says so instead of
  // pretending the event is running.
  const offSeason = !spookInSeason()
    ? `<p class="spk-off">Spooktober runs September 9 through the first week of November. You're early — or late — but the calendar is yours to keep.</p>` : "";

  host.innerHTML = `
    <section class="spk-hero">
      <div class="spk-banner-deco">${spookDecoHtml()}</div>
      <div class="spk-hero-inner">
        <span class="h-eyebrow spk-eyebrow">Seasonal event · ${spookYear()}</span>
        <h1 class="spk-title big">Spooktober</h1>
        <p class="spk-pitch">${escapeHtml(spookPitch())}</p>
        ${offSeason}
        <div class="spk-meter">
          <span class="spk-bar"><span style="width:${pct}%"></span></span>
          <span class="spk-meter-t">${escapeHtml(spookPlanText())}</span>
        </div>
        <div class="spk-acts">
          ${filled < SPOOK_NIGHTS ? `<button class="btn" id="spookFill">${icon("i-dice", 15)} Fill the empty nights</button>` : ""}
          ${rerollable ? `<button class="btn${filled < SPOOK_NIGHTS ? " ghost" : ""}" id="spookReroll">${icon("i-refresh", 15)} Re-roll ${rerollable} unpinned</button>` : ""}
          ${misfit ? `<button class="btn ghost" id="spookRepack">${icon("i-refresh", 15)} Re-pack the month</button>` : ""}
          ${filled ? `<button class="btn ghost" id="spookReset">Clear the calendar</button>` : ""}
        </div>
        <div class="spk-pace">
          <label for="spookHpd">How long is a night?</label>
          <select id="spookHpd" class="spk-pace-sel">${paceSel}</select>
          <span class="spk-pace-note">${hpd
            ? `A game books as many nights as it needs — ${SPOOK_NIGHTS} nights is ${fmtHours(hpd * SPOOK_NIGHTS)} of horror.`
            : "A game takes one night, however long it is."}</span>
        </div>
        ${misfit ? `<p class="spk-pinnote">${icon("i-clock", 12)} ${misfit} game${misfit === 1 ? "" : "s"} still laid out to a different pace — re-pack to spread ${misfit === 1 ? "it" : "them"} out.</p>` : ""}
        ${pinned || finished ? `<p class="spk-pinnote">${icon("i-pin", 12)} ${[
          pinned ? `${pinned} pinned` : "", finished ? `${finished} finished` : ""].filter(Boolean).join(", ")} — a re-roll leaves ${pinned + finished === 1 ? "it" : "them"} alone.</p>` : ""}
      </div>
    </section>
    <div class="spk-wrap">
      <div class="spk-grid">${spookGridHtml()}</div>
    </div>
    ${spookPickerHtml()}`;

  // Both animation flags are spent by the render that read them.
  SPOOK.opening = false;
  SPOOK.dealt = null;
  wireSpook(host);
  // Only the games on screen: the calendar's own 31, plus whatever the picker is showing.
  const seen = nights.map(([, r]) => r).filter(Boolean);
  const cands = SPOOK.picking == null ? [] : (SPOOK.all ? spookAllGames() : spookPool()).slice(0, 60);
  if (typeof maybeEnrich === "function") maybeEnrich([...seen, ...cands]);
}

function wireSpook(host) {
  // Both routes into the picker. An empty night is "fill" — you are working down the month,
  // so it walks on. A filled night is "swap" — you came here about THAT night, so it stays.
  host.querySelectorAll("[data-day]").forEach((el) => {
    el.onclick = () => {
      // Already open on another night: it slides once, then moves between nights in place.
      SPOOK.opening = SPOOK.picking == null;
      SPOOK.picking = +el.dataset.day;
      SPOOK.mode = el.dataset.mode === "swap" ? "swap" : "fill";
      spookRepaint();
      // The picker is sticky to the bottom of the scrollport, which normally means opening
      // it IS showing it. Belt and braces for the case where it isn't — a tap that opens a
      // panel 2,000px below the fold is indistinguishable from a tap that did nothing.
      const p = document.getElementById("spookPicker");
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (p && p.getBoundingClientRect().top >= vh) p.scrollIntoView({ block: "end" });
    };
  });
  host.querySelectorAll("[data-clear]").forEach((el) => {
    el.onclick = () => { spookClearDay(+el.dataset.clear); spookRepaint(); };
  });
  host.querySelectorAll("[data-pin]").forEach((el) => {
    el.onclick = () => { spookTogglePin(+el.dataset.pin); spookRepaint(); };
  });
  host.querySelectorAll("[data-open]").forEach((el) => {
    el.onclick = () => { const r = spookRowFor(el.dataset.open); if (r) openDrawer(r, "games"); };
  });
  host.querySelectorAll("[data-put]").forEach((el) => {
    el.onclick = () => {
      if (SPOOK.picking == null) return;
      spookSet(SPOOK.picking, el.dataset.put);
      /* Filling a calendar is 31 of the same decision, so a pick walks on to the next empty
         night rather than making you re-open the picker for each one. Changing ONE night is
         a different job: it stays where it is, so you can see what you just did and try
         something else. Advancing there is what made Swap look broken — on a full calendar
         there is no next empty night, so the panel closed the instant you chose. */
      if (SPOOK.mode === "fill") {
        const next = spookNights().find(([d, r]) => d > SPOOK.picking && !r);
        SPOOK.picking = next ? next[0] : null;
      }
      // "The next empty night" already steps over the run that was just placed, so filling a
      // paced month walks game to game without the picker having to know about spans.
      spookRepaint();
    };
  });
  const close = () => { SPOOK.picking = null; SPOOK.q = ""; renderSpooktober(); };
  const cancel = document.getElementById("spookCancel");
  if (cancel) cancel.onclick = close;

  const any = document.getElementById("spookAny");
  if (any) any.onchange = () => { SPOOK.all = any.checked; spookRepaint(); };

  const q = document.getElementById("spookQ");
  if (q) {
    q.oninput = () => {
      SPOOK.q = q.value;
      const res = document.getElementById("spookResults");
      if (!res) return;
      res.innerHTML = spookResultsHtml();
      wireSpook(res);                       // the cards are new; the input is not
      if (typeof maybeEnrich === "function") maybeEnrich(spookPool().slice(0, 60));
    };
    q.onkeydown = (e) => { if (e.key === "Escape") close(); };
  }

  const roll = (days, done) => {
    const res = spookRoll(days);
    SPOOK.picking = null;
    SPOOK.dealt = days.slice().sort((a, b) => a - b);
    renderSpooktober();
    if (typeof showToast === "function") showToast(done(res));
  };

  // At one game per night the two numbers are the same and saying both is noise.
  const rollText = (verb, res) => (spookHpd()
    ? `${verb} ${res.games} game${res.games === 1 ? "" : "s"} across ${res.nights} night${res.nights === 1 ? "" : "s"}`
    : `${verb} ${res.nights} night${res.nights === 1 ? "" : "s"}`);

  const fill = document.getElementById("spookFill");
  if (fill) fill.onclick = () => {
    const empty = spookNights().filter(([, r]) => !r).map(([d]) => d);
    if (!empty.length) { if (typeof showToast === "function") showToast("Every night is spoken for"); return; }
    roll(empty, (res) => (res.games
      ? rollText("Filled", res)
      : "Nothing on the shelf is short enough for the nights that are left"));
  };

  // Re-roll leaves the pinned runs exactly where they are — that is what a pin is for.
  const reroll = document.getElementById("spookReroll");
  if (reroll) reroll.onclick = () => {
    const loose = spookRuns().filter((r) => r.row && !spookIsHeld(r));
    if (!loose.length) { if (typeof showToast === "function") showToast("Every game is pinned or finished"); return; }
    const days = [];
    for (const r of loose) for (let d = r.start; d <= r.end; d++) days.push(d);
    const held = spookGames() - loose.length;
    roll(days, (res) => `${rollText("Re-rolled", res)}${held ? ` · ${held} kept` : ""}`);
  };

  /* The pace. Changing it does not touch the calendar — see spookRepack — so the grid you get
     back is the one you had, now measured against the new number and saying where it doesn't
     fit. The re-pack button appears in the same repaint. */
  const hpd = document.getElementById("spookHpd");
  if (hpd) hpd.onchange = () => {
    spookSetHpd(hpd.value);
    SPOOK.picking = null;
    renderSpooktober();
    if (typeof patchSpookBanner === "function") patchSpookBanner();
  };

  const repack = document.getElementById("spookRepack");
  if (repack) repack.onclick = () => {
    const before = spookRuns().filter((r) => r.row).map((r) => r.start);
    const res = spookRepack();
    SPOOK.picking = null;
    SPOOK.dealt = spookRuns().filter((r) => r.row && !before.includes(r.start)).map((r) => r.start);
    renderSpooktober();
    if (typeof showToast === "function") {
      showToast(`Re-packed into ${res.games} game${res.games === 1 ? "" : "s"}` +
        (res.dropped ? ` · ${res.dropped} no longer fit${res.dropped === 1 ? "s" : ""}` : ""));
    }
  };

  const reset = document.getElementById("spookReset");
  if (reset) reset.onclick = () => {
    spookClearAll();
    SPOOK.picking = null;
    renderSpooktober();
  };
}
