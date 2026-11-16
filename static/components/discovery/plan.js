"use strict";

// UI components for plan.js. Feature state, persistence and orchestration remain in that
// module; everything here is a builder plus the one render/wire pass the tab needs.

/* ---- the signal row -----------------------------------------------------
   The three things the page is for, said in one line of chips, and the same line on a
   queued game and on a candidate — so the thing you compared candidates by is still
   visible after you've queued one.

   Order is by how much each one should move a decision: a bucket nothing else can clear
   first, then buckets in general, then a theme slate, then what the sheet already says
   about the game, then how long it takes. A chip is absent rather than empty when nothing
   knows: a blank "0 buckets" reads as a measurement, and it isn't one. */
/**
 * @component Render the chip row that says why one game is worth queueing over another.
 * @param {Object} sig - A planSignals() record for one game.
 * @param {Object} sig.row - The sheet row, read for its time to beat.
 * @param {boolean} sig.done - Finished on the sheet; replaces the status chip.
 * @param {boolean} sig.started - A start date with no status; shown only when status is empty.
 * @param {string} sig.status - The sheet's Status cell ("Playing"/"Up Next"/"On Hold"), empty for none.
 * @param {Array<string>} sig.themes - Names of the theme slates this game is already on.
 * @param {Object|null} sig.clears - planClears() record, or null when it was not computed.
 * @param {Object} [options={}] - Presentation options.
 * @param {boolean} [options.compact=false] - Counts instead of words, for the narrow candidate cards.
 * @returns {string} A .plan-sigs row, or an empty string when nothing is known.
 * @requires escapeHtml, icon, fmtHours and playtimeOf; .plan-sig styles and the i-target/i-theme/i-play/i-pause/i-check/i-clock sprite symbols.
 * @events None. The caller owns state and event wiring.
 * @cleanup No resources or listeners are allocated; the caller owns any inserted DOM.
 * @escaping Labels, theme names, bucket keys and tooltips are escaped; no markup is accepted.
 * @example
 * host.innerHTML = planSignalChipsHtml(planSignals(row), { compact: true });
 */
function planSignalChipsHtml(sig, { compact = false } = {}) {
  const out = [];
  const c = sig.clears;
  if (c && c.buckets) {
    const label = compact
      ? `${c.buckets}`
      : `${c.buckets} bucket${c.buckets === 1 ? "" : "s"}`;
    const tip = `Beating this clears ${c.buckets} bucket${c.buckets === 1 ? "" : "s"}`
      + ` across ${c.challenges} challenge${c.challenges === 1 ? "" : "s"}`
      + (c.top ? ` — ${c.top.name}: "${c.top.key}"` : "")
      + (c.only ? ", and nothing else in your library can clear it" : "");
    out.push(`<span class="plan-sig clears${c.only ? " only" : ""}" title="${escapeHtml(tip)}">
      ${icon("i-target", 11)} ${escapeHtml(label)}${c.only ? ` <b>only</b>` : ""}</span>`);
  }
  if (sig.themes.length) {
    const tip = `On ${sig.themes.length === 1 ? "the" : ""} theme slate${sig.themes.length === 1 ? "" : "s"}: ${sig.themes.join(", ")}`;
    out.push(`<span class="plan-sig slate" title="${escapeHtml(tip)}">${icon("i-theme", 11)} ${
      escapeHtml(compact || sig.themes.length > 1 ? `${sig.themes.length} slate${sig.themes.length === 1 ? "" : "s"}` : sig.themes[0])}</span>`);
  }
  if (sig.done) {
    out.push(`<span class="plan-sig done" title="The sheet says this is finished">${icon("i-check", 11)} Finished</span>`);
  } else if (sig.status) {
    // The sheet's own Status cell, in its own words. Playing is the loud one because it
    // means this lane is already occupied by something.
    const cls = sig.status === "Playing" ? " playing" : "";
    out.push(`<span class="plan-sig status${cls}" title="The sheet's Status column">${
      icon(sig.status === "On Hold" ? "i-pause" : "i-play", 11)} ${escapeHtml(sig.status)}</span>`);
  } else if (sig.started) {
    out.push(`<span class="plan-sig status" title="The sheet records a start date">${icon("i-play", 11)} Started</span>`);
  }
  const hrs = playtimeOf(sig.row);
  if (hrs != null) {
    out.push(`<span class="plan-sig time" title="How long to beat">${icon("i-clock", 11)} ${escapeHtml(fmtHours(hrs))}</span>`);
  }
  return out.length ? `<div class="plan-sigs">${out.join("")}</div>` : "";
}

/* The scarcest bucket, spelled out under a queued game. The chip row can only fit a
   count; this is the sentence that makes the count worth something, and it is the one
   thing neither the Challenges tab nor the drawer tells you while you are ordering a
   queue. Left off a finished game: there is nothing left for it to clear. */
function planClearLineHtml(sig) {
  const c = sig.clears;
  if (sig.done || !c || !c.top) return "";
  const { name, key, rivals } = c.top;
  const tail = rivals
    ? `${rivals} other unplayed game${rivals === 1 ? "" : "s"} could clear it too`
    : `nothing else in your library can clear it`;
  return `<p class="plan-clear">${icon("i-target", 11)}
    <b>${escapeHtml(String(key))}</b> in ${escapeHtml(typeof chTagName === "function" ? chTagName(name) : name)} — ${escapeHtml(tail)}</p>`;
}

/* ---- a queued game ------------------------------------------------------
   A numbered row rather than a poster grid: a queue is an ORDER, and a grid is the one
   layout that cannot show one. The cover stays, small, because a shelf is recognised by
   its spines — but the number, the title and the signals are the row, and the controls
   sit at the end where they can't be hit while reading.

   data-pk carries the match key on every control, so the wiring is one delegated pass
   rather than a closure per button. */
function planQueueRowHtml(entry, i, lane) {
  const { row, key } = entry;
  const sig = planSignals(row);
  const rec = igdbRecOf(row);
  const cs = coverSrc(rec, "cover_big");
  const art = cs
    ? `<img class="plan-art${coverIsPixelArt(rec, cs) ? " pixel" : ""}" loading="lazy" decoding="async" src="${escapeHtml(cs)}" alt="">`
    : `<span class="plan-art ph">${icon("i-library", 16)}</span>`;
  const next = !sig.done && lane.next === key;
  return `<li class="plan-row${sig.done ? " is-done" : ""}${next ? " is-next" : ""}" data-pk="${escapeHtml(String(key))}">
    <span class="plan-num" aria-hidden="true">${i + 1}</span>
    <button type="button" class="plan-open" data-plan-open="${escapeHtml(String(key))}"
      title="${escapeHtml(`Open ${row.title}`)}">
      ${art}
      <span class="plan-meta">
        <b class="plan-title">${escapeHtml(String(row.title))}</b>
        <span class="plan-sub">${escapeHtml([row.platform, rngYear(row) || null, row.genre]
          .filter((x) => x != null && x !== "").join(" · "))}</span>
        ${planSignalChipsHtml(sig)}
        ${planClearLineHtml(sig)}
      </span>
    </button>
    <span class="plan-ctl">
      ${next ? `<span class="plan-nextbadge">${icon("i-pennant", 11)} Next up</span>` : ""}
      <button type="button" class="plan-ibtn" data-plan-up="${escapeHtml(String(key))}"
        aria-label="Move up"${i === 0 ? " disabled" : ""} title="Move up">${icon("i-skip-back", 13)}</button>
      <button type="button" class="plan-ibtn" data-plan-down="${escapeHtml(String(key))}"
        aria-label="Move down"${i === lane.entries.length - 1 ? " disabled" : ""} title="Move down">${icon("i-skip-fwd", 13)}</button>
      ${planLaneMoveHtml(entry)}
      <button type="button" class="plan-ibtn danger" data-plan-drop="${escapeHtml(String(key))}"
        aria-label="Remove from the plan" title="Remove from the plan">${icon("i-trash", 13)}</button>
    </span>
  </li>`;
}

/* Move a game to another lane. Offered on every queued game because the classifier is
   inference (rngSlotOf) and inference is wrong sometimes — a native select, so the phone
   gets its own picker for free, the same choice rng.js's pin menu makes. Hidden when
   there is only one other lane's worth of nothing to choose. */
function planLaneMoveHtml(entry) {
  const others = planTracks().filter((t) => t.id !== entry.track);
  if (!others.length) return "";
  return `<span class="plan-lanesel">
    <select data-plan-lane="${escapeHtml(String(entry.key))}" aria-label="Move to another track">
      <option value="">Move to…</option>
      ${others.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join("")}
    </select>
  </span>`;
}

/* ---- a lane -------------------------------------------------------------
   The same box, eyebrow and --slot tint as an RNG column, because it is the same lane:
   two tabs describing one shelf should look like they agree. The eyebrow counts what is
   left to play rather than what is in the lane — a queue of eight with seven finished is
   a queue of one. */
function planLaneHtml(trackId) {
  const t = planTrack(trackId);
  const entries = planQueue(trackId);
  const nextEntry = planNext(trackId);
  const lane = { entries, next: nextEntry ? nextEntry.key : null };
  const left = entries.filter((e) => !planDone(e.row)).length;
  const done = entries.length - left;
  const open = planState.track === trackId;

  const body = entries.length
    ? `<ol class="plan-list">${entries.map((e, i) => planQueueRowHtml(e, i, lane)).join("")}</ol>`
    : `<div class="plan-lane-empty">
        <span class="plan-lane-ico">${icon("i-list", 22)}</span>
        <p>Nothing queued in this track yet.</p>
        <span class="plan-hint">${escapeHtml(t.hint)}</span>
      </div>`;

  return `<section class="plan-lane${open ? " is-open" : ""}" data-track="${escapeHtml(trackId)}" style="--slot: ${t.tint}">
    <div class="plan-lane-head">
      <span class="plan-eye">${icon(t.icon, 12)} ${escapeHtml(t.label)}</span>
      <span class="plan-lane-n" title="Games still to play in this track">${
        left.toLocaleString()} to play${done ? ` · ${done.toLocaleString()} done` : ""}</span>
      <span class="plan-lane-acts">
        ${done ? `<button type="button" class="plan-ghost" data-plan-clear="${escapeHtml(trackId)}"
          title="Drop the finished games out of this track">${icon("i-broom", 12)} Clear finished</button>` : ""}
        <button type="button" class="plan-add${open ? " is-open" : ""}" data-plan-toggle="${escapeHtml(trackId)}"
          aria-expanded="${open ? "true" : "false"}">${icon(open ? "i-close" : "i-plus", 12)} ${
          open ? "Done choosing" : "Add games"}</button>
      </span>
    </div>
    ${body}
    ${open ? planChooserHtml(trackId) : ""}
  </section>`;
}

/* ---- the chooser --------------------------------------------------------
   One lane's candidates, with the signals on every card, which is the whole point: the
   decision is "which of these is worth a slot", and the answer is in the chips.

   The filter and sort rows are plain chips rather than selects because there are five and
   five of each and they are the page's main verb. The two that have to run every challenge
   over every candidate say so in their own tooltip, and the count line says how long the
   list is after they have run — a filter that silently costs a second is a filter that
   reads as a hang. */
// A page of candidates. Twelve, because the signals make each card tall and a page you
// have to scroll twice is a page you stop reading.
const PLAN_PAGE = 12;

function planChooserHtml(trackId) {
  const t = planTrack(trackId);
  const chip = (list, cur, attr) => list.map((o) => `<button type="button"
      class="plan-chip${o.id === cur ? " on" : ""}" data-${attr}="${escapeHtml(o.id)}"${
      o.hint ? ` title="${escapeHtml(o.hint)}"` : ""}>${escapeHtml(o.label)}</button>`).join("");

  return `<div class="plan-chooser">
    <div class="plan-chooser-head">
      <h3>Add to ${escapeHtml(t.label)}</h3>
      <p class="plan-hint">${escapeHtml(t.hint)}. Unfinished, playable, not already in the plan,
        and not ranked Will Not Play.</p>
    </div>
    <div class="plan-tools">
      ${searchField("planQ", "Search this track…", planState.q, "plan-field")}
      <div class="plan-chips" role="group" aria-label="Filter candidates">${chip(PLAN_FILTERS, planState.filter, "plan-filter")}</div>
      <div class="plan-chips" role="group" aria-label="Sort candidates">
        <span class="plan-chips-lbl">${icon("i-sort", 11)} Sort</span>
        ${chip(PLAN_SORTS, planState.sort, "plan-sort")}
      </div>
    </div>
    <div class="plan-results">${planResultsHtml(trackId)}</div>
  </div>`;
}

/* The part of the chooser a keystroke changes: the count, one page of candidates and the
   pager. Its own builder so the search box can repaint just this — the box itself, the
   chips and the three queues above stay exactly where they are. Repainting the whole tab
   per keystroke rebuilt every cover in every queue and had to fight to keep the caret. */
function planResultsHtml(trackId) {
  const rows = planCandidates(trackId);
  const pages = Math.max(1, Math.ceil(rows.length / PLAN_PAGE));
  const page = Math.min(planState.page, pages);
  const shown = rows.slice((page - 1) * PLAN_PAGE, page * PLAN_PAGE);
  return `<p class="plan-count">${rows.length.toLocaleString()} candidate${rows.length === 1 ? "" : "s"}${
      planIsHeavy() ? ` <span class="muted">· ranked against every challenge bucket</span>` : ""}</p>
    ${shown.length
      ? `<div class="plan-cands">${shown.map((r) => planCandidateHtml(r, trackId)).join("")}</div>`
      : `<div class="plan-lane-empty"><span class="plan-lane-ico">${icon("i-search", 22)}</span>
          <p>Nothing in this track matches.</p></div>`}
    <div class="plan-pager" data-pages="${pages}" data-page="${page}"></div>`;
}

/* Repaint the open chooser's results in place. A no-op when no chooser is open, or when the
   one on screen belongs to a different lane than the state says (a render is on its way). */
function renderPlanResults() {
  const el = planState.track
    && document.querySelector(`#plan .plan-lane[data-track="${planState.track}"] .plan-results`);
  if (!el) return;
  el.innerHTML = planResultsHtml(planState.track);
  wirePlanResults(el);
}

/* One candidate. A poster card so it is recognisable from the listings, the signal chips
   under it so the comparison is on the card, and one button, because there is exactly one
   thing to do with a candidate. */
function planCandidateHtml(row, trackId) {
  const sig = planSignals(row);
  const rec = igdbRecOf(row);
  return `<div class="plan-cand${sig.clears && sig.clears.only ? " is-only" : ""}" data-pk="${escapeHtml(String(row._k))}">
    <button type="button" class="${posterClassName(row)} plan-cand-card" data-plan-open="${escapeHtml(String(row._k))}">
      ${posterContentHtml(row, cardBodyHtml(row), { enrichment: rec, pending: coverPending(row) })}
    </button>
    <div class="plan-cand-body">
      <b class="plan-title" title="${escapeHtml(String(row.title))}">${escapeHtml(String(row.title))}</b>
      <span class="plan-sub">${escapeHtml([row.platform, rngYear(row) || null]
        .filter((x) => x != null && x !== "").join(" · "))}</span>
      ${planSignalChipsHtml(sig, { compact: true })}
      <button type="button" class="plan-queue" data-plan-add="${escapeHtml(String(row._k))}"
        data-plan-track="${escapeHtml(trackId)}">${icon("i-plus", 12)} Queue it</button>
    </div>
  </div>`;
}

/* ---- the hero and the coverage note -------------------------------------
   The page says what it is, and then it says whether its own three lanes hold the whole
   sheet — because "these three are exhaustive" is a claim, and a claim with no arithmetic
   beside it is a thing you have to take on trust. The numbers add up on screen or they
   visibly don't.

   When something is unplaced the note turns into a warning and NAMES the games: a lane is
   assignable by hand, so an unclassifiable game is still a game you can queue, and
   hiding it would be the one failure this page cannot afford. */
function planCoverageHtml() {
  const cov = planCoverage();
  const parts = planTracks().map((t) =>
    `<span><b>${cov.by[t.id].toLocaleString()}</b> ${escapeHtml(t.label.toLowerCase())}</span>`);
  if (!cov.unplaced.length) {
    return `<div class="plan-cover">
      <span class="plan-cover-ok">${icon("i-check", 12)} All ${cov.total.toLocaleString()} games on the sheet land in one of the three tracks</span>
      <span class="plan-cover-sum">${parts.join("")}</span>
    </div>`;
  }
  const names = cov.unplaced.slice(0, 12);
  return `<div class="plan-cover is-warn">
    <span class="plan-cover-ok">${icon("i-alert", 12)} ${cov.unplaced.length.toLocaleString()} of ${
      cov.total.toLocaleString()} games are on hardware with no generation and have no known release year, so the modern/retro line can't place them</span>
    <span class="plan-cover-sum">${parts.join("")}</span>
    <ul class="plan-unplaced">${names.map((r) => `<li><button type="button" class="plan-unplaced-go"
        data-plan-open="${escapeHtml(String(r._k))}">${escapeHtml(String(r.title))}${
        r.platform ? ` <span class="muted">${escapeHtml(String(r.platform))}</span>` : ""}</button></li>`).join("")}
      ${cov.unplaced.length > names.length
        ? `<li class="muted">+${(cov.unplaced.length - names.length).toLocaleString()} more</li>` : ""}</ul>
    <p class="plan-hint">Give one a release year on the sheet and it falls into a track on the next
      load; until then, queue it by hand from whichever track fits.</p>
  </div>`;
}

function planHeroHtml() {
  const entries = planEntries();
  const left = entries.filter((e) => !planDone(e.row)).length;
  const done = entries.length - left;
  const hrs = entries.filter((e) => !planDone(e.row))
    .map((e) => playtimeOf(e.row)).filter((h) => h != null);
  const total = hrs.reduce((a, b) => a + b, 0);
  return `<div class="plan-hero">
    <h1>Plan</h1>
    <p>Three queues, one per track, in the order you mean to play them. Pick answers
      tonight and the roller answers at random; this is the list after that. Every
      candidate shows what beating it would clear, which theme slates it's already on and
      what the sheet's Status column already says — and completion is read off the sheet,
      so nothing here is ticked twice.</p>
    <div class="plan-hero-stats">
      <span><b>${left.toLocaleString()}</b> queued</span>
      ${done ? `<span><b>${done.toLocaleString()}</b> finished</span>` : ""}
      ${hrs.length ? `<span><b>${escapeHtml(fmtHours(total))}</b> of play queued${
        hrs.length < left ? ` <span class="muted">(${hrs.length} of ${left} timed)</span>` : ""}</span>` : ""}
    </div>
    ${planCoverageHtml()}
  </div>`;
}

// Mid-load. The lanes keep their boxes and their eyebrows — which three they are was
// never in doubt — and shimmer where the queue will be.
function planSkeletonHtml() {
  return `<div class="plan-lanes">${planTracks().map((t) => `<section class="plan-lane loading" style="--slot: ${t.tint}">
      <div class="plan-lane-head">
        <span class="plan-eye">${icon(t.icon, 12)} ${escapeHtml(t.label)}</span>
        <span class="plan-lane-n skel"></span>
      </div>
      <div class="plan-list"><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>
    </section>`).join("")}</div>`;
}

/* ---- render -------------------------------------------------------------
   One pass: paint, then wire. Every control carries its own match key or lane id in a
   data attribute, so the wiring is a handful of delegated loops rather than a closure per
   row — which also means a re-render after an edit can't leave a stale closure behind. */
function renderPlan() {
  const host = $("#plan");
  if (!host || typeof DATA === "undefined" || !DATA) return;
  if (planLoading()) { host.innerHTML = planHeroHtml() + planSkeletonHtml(); return; }

  host.innerHTML = planHeroHtml()
    + `<div class="plan-lanes">${planTrackIds().map(planLaneHtml).join("")}</div>`;
  wirePlan(host);
}

function wirePlan(host) {
  for (const el of host.querySelectorAll("[data-plan-open]")) {
    const row = rngRowByKey(el.dataset.planOpen);
    if (row) el.onclick = () => openDrawer(row, "games");
  }
  for (const el of host.querySelectorAll("[data-plan-up]")) {
    el.onclick = () => planMove(el.dataset.planUp, -1);
  }
  for (const el of host.querySelectorAll("[data-plan-down]")) {
    el.onclick = () => planMove(el.dataset.planDown, 1);
  }
  for (const el of host.querySelectorAll("[data-plan-drop]")) {
    el.onclick = () => planRemove(el.dataset.planDrop);
  }
  for (const el of host.querySelectorAll("[data-plan-lane]")) {
    el.onchange = () => { if (el.value) planSetTrack(el.dataset.planLane, el.value); };
  }
  for (const el of host.querySelectorAll("[data-plan-clear]")) {
    el.onclick = () => planClearDone(el.dataset.planClear);
  }
  for (const el of host.querySelectorAll("[data-plan-toggle]")) {
    el.onclick = () => planOpen(el.dataset.planToggle);
  }
  for (const el of host.querySelectorAll("[data-plan-filter]")) {
    el.onclick = () => planSetFilter(el.dataset.planFilter);
  }
  for (const el of host.querySelectorAll("[data-plan-sort]")) {
    el.onclick = () => planSetSort(el.dataset.planSort);
  }
  /* The search box is never replaced while you type: planSetQuery repaints the results
     region only (renderPlanResults), so the input keeps its focus and caret on its own.
     A short debounce still batches a fast typist's keystrokes into one repaint. */
  const q = host.querySelector("#planQ");
  if (q) {
    let timer = null;
    q.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => planSetQuery(q.value), PLAN_QUERY_DEBOUNCE);
    };
  }
  const results = host.querySelector(".plan-results");
  if (results) wirePlanResults(results);
  // Covers and playtimes for the queued games arrive per-game; postEnrich re-renders.
  planWarm(host.querySelectorAll(".plan-row[data-pk]"));
}
const PLAN_QUERY_DEBOUNCE = 120;

// Handlers inside the results region, wired on every repaint of it. Delegated by data
// attribute like the rest, so a repaint can't leave a stale closure behind.
function wirePlanResults(el) {
  for (const b of el.querySelectorAll("[data-plan-open]")) {
    const row = rngRowByKey(b.dataset.planOpen);
    if (row) b.onclick = () => openDrawer(row, "games");
  }
  for (const b of el.querySelectorAll("[data-plan-add]")) {
    b.onclick = (e) => { e.stopPropagation(); planAdd(b.dataset.planAdd, b.dataset.planTrack); };
  }
  // Pagination through the shared control; the chooser owns the page number.
  const pager = el.querySelector(".plan-pager");
  if (pager) {
    createPager({
      host: pager,
      page: +pager.dataset.page || 1,
      pages: +pager.dataset.pages || 1,
      onChange: (page) => { planState.page = page; renderPlanResults(); },
    });
  }
  planWarm(el.querySelectorAll(".plan-cand[data-pk]"));
}

// Ask for the per-game record (cover, time to beat) of what is on screen.
function planWarm(nodes) {
  const rows = [...nodes].map((n) => rngRowByKey(n.dataset.pk)).filter(Boolean);
  if (rows.length && typeof maybeEnrich === "function") maybeEnrich(rows);
}
