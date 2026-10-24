"use strict";

// UI components for timeline.js. Feature state and orchestration remain in that module.

function tlEntry(r, i) {
  const cs = coverSrc(ENRICH[r._k], "cover_big");
  const cover = cs
    ? `<img class="tl-cover tl-open" loading="lazy" src="${escapeHtml(cs)}" alt="">`
    : `<div class="tl-cover ph tl-open">${icon("i-library", 20)}</div>`;
  const score = r.rating != null
    ? `<span class="tl-score ${ratingClass(r.rating)}">${Math.round(r.rating * 100)}</span>` : "";
  const bits = [r.platform, r.playTime != null ? fmtHours(r.playTime) : null]
    .filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  // The review reads inline now (the old Reviews tab folded into the timeline):
  // a snippet with "Read more" to expand the full text in place. Cover + title
  // still open the drawer.
  const full = tlFull(r.notes);
  const snippet = tlSnippet(r.notes);
  const long = full.length > snippet.length;
  const review = full
    ? `<div class="tl-review">
         <p class="tl-quote">${escapeHtml(snippet)}</p>
         ${long ? `<button class="tl-more" type="button">Read more</button>` : ""}
       </div>`
    : "";
  return `<article class="tl-entry" data-tk="${escapeHtml(String(r._k || ""))}" data-ti="${i}"
      data-td="${escapeHtml(String(r.date || "").slice(0, 10))}"
      style="--d:${Math.min(i, 12) * 45}ms">
    <div class="tl-when">
      <b>${escapeHtml(r.date ? tlDate(r.date).replace(/,? \d{4}$/, "") : "—")}</b>
    </div>
    <div class="tl-dot"></div>
    <div class="tl-card">
      ${cover}
      <div class="tl-body">
        <header><h3><button type="button" class="tl-open tl-title">${escapeHtml(String(r.game))}</button></h3>${score}</header>
        <div class="tl-meta">${bits}</div>
        ${review}
      </div>
    </div>
  </article>`;
}

// Enrichment lands after the first paint. Swap the placeholders for real covers
// in place — re-rendering 1,700 entries would flash the whole page (and it polls
// every 45s while a backfill is running).
function patchTimelineCovers() {
  const host = $("#timeline");
  if (!host || host.hidden) return;
  host.querySelectorAll(".tl-entry").forEach((el) => {
    const ph = el.querySelector(".tl-cover.ph");
    if (!ph) return;
    const cs = coverSrc(ENRICH[el.dataset.tk], "cover_big");
    if (!cs) return;
    const img = document.createElement("img");
    // Keep .tl-open — this img REPLACES a placeholder, and without the class the delegated
    // click handler wouldn't open the drawer, so a cover that filled in after first paint
    // silently stopped being clickable. (That's the "sometimes not clickable" bug.)
    img.className = "tl-cover tl-open"; img.loading = "lazy"; img.alt = ""; img.src = cs;
    ph.replaceWith(img);
  });
}

// rows: already filtered by the Completed tab's search + facets.
function renderTimeline(rows) {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("renderTimeline", activeTab) : () => {};
  try { return _renderTimeline(rows); } finally { end(); }
}

function _renderTimeline(rows) {
  disposeTimeline();
  const run = _tlRun;
  const host = $("#timeline");
  host.onclick = null;
  // Sort by the active sort (the grid dropdown drives it now), PURELY by the spec — no search
  // relevance reorder — so rows sharing a bucket stay contiguous. The buckets then fall out in
  // the sort's own order (dates newest-first, titles A→Z, ratings high→low …).
  const specs = (typeof effectiveSort === "function" && effectiveSort()) || [{ key: "date", dir: "desc", type: "date" }];
  const sorted = [...rows].sort((a, b) => { for (const s of specs) { const c = cmpBy(a, b, s); if (c) return c; } return 0; });
  if (!sorted.length) {
    host.innerHTML = emptyState("Nothing to show", "No completed games match the current filters.", null);
    return;
  }

  // Bucket consecutive rows by the sort field. A year is what people remember for a date sort;
  // for any other sort it's the value / band you sorted by.
  const buckets = [];
  for (const r of sorted) {
    const label = tlBucketLabel(r, specs[0]);
    const last = buckets[buckets.length - 1];
    if (last && last.label === label) last.games.push(r);
    else buckets.push({ label, games: [r] });
  }

  const batches = [];
  const flat = [];             // index -> row, for the click handler
  const sections = buckets.map((bk, bi) => {
    const games = bk.games;
    const hours = games.reduce((a, g) => a + (g.playTime || 0), 0);
    const rated = games.filter((g) => g.rating != null);
    const avg = rated.length ? rated.reduce((a, g) => a + g.rating, 0) / rated.length : null;
    const chunks = [];
    for (let offset = 0; offset < games.length; offset += TL_BATCH) {
      const start = flat.length, batch = games.slice(offset, offset + TL_BATCH);
      flat.push(...batch);
      const id = batches.length;
      batches.push({ start, rows: batch, loaded: false });
      chunks.push(`<div class="tl-batch" data-tbatch="${id}" style="--tl-count:${batch.length}"><button class="tl-load" type="button">Load ${batch.length} entries</button></div>`);
    }
    const entries = chunks.join("");
    return `<section class="tl-year" id="tlb-${bi}">
      <div class="tl-year-head">
        <h2>${escapeHtml(String(bk.label))}</h2>
        <span class="muted">${games.length} game${games.length !== 1 ? "s" : ""}${
          hours ? ` · ${Math.round(hours).toLocaleString()}h` : ""}${
          avg != null ? ` · avg ${Math.round(avg * 100)}%` : ""}</span>
      </div>
      ${entries}
    </section>`;
  }).join("");

  // Jump-nav: a FLOATING vertical rail pinned to the right of the viewport, so it's always
  // there — you can bounce between buckets from anywhere in a 1,700-item scroll, not just from
  // the top. Only when there's more than one bucket to jump between.
  const rail = buckets.length > 1
    ? `<nav class="tl-rail" aria-label="Jump to a section">${buckets.map((bk, bi) =>
        `<button class="tl-rail-chip" type="button" data-tlb="${bi}" title="${escapeHtml(String(bk.label))} · ${bk.games.length}">${escapeHtml(String(bk.label))}</button>`).join("")}</nav>`
    : "";

  host.innerHTML = rail + `<div class="tl">${sections}</div>`;

  const current = () => run === _tlRun && !host.hidden && activeTab === "completed";
  const loadBatch = id => {
    const batch = batches[id];
    if (!current() || !batch || batch.loaded) return;
    const slot = host.querySelector(`[data-tbatch="${id}"]`);
    if (!slot) return;
    const focused = slot.contains(document.activeElement);
    const end = typeof gamedexPerf !== "undefined" ? gamedexPerf.start("timelineBatch", activeTab) : () => {};
    try {
      batch.loaded = true;
      _tlLoad?.unobserve(slot);
      slot.innerHTML = batch.rows.map((r, i) => tlEntry(r, batch.start + i)).join("");
      slot.classList.add("loaded");
      slot.querySelectorAll(".tl-entry").forEach(el => el.classList.add("in"));
      // The load button also gives keyboard/screen-reader users a way forward.
      if (focused) slot.querySelector(".tl-title")?.focus({ preventScroll: true });
    } finally { end(); }
  };
  loadBatch(0);
  // Queue one batch per task, including when a large scroll reveals several.
  // A newer filter/render invalidates every queued callback before it can write.
  const queued = new Set();
  let scheduled = false;
  const schedule = () => {
    if (scheduled || !queued.size) return;
    scheduled = true;
    const step = () => {
      scheduled = false;
      if (!current()) return;
      const id = queued.values().next().value;
      queued.delete(id);
      loadBatch(id);
      schedule();
    };
    if (typeof scheduler !== "undefined" && scheduler.postTask) scheduler.postTask(step);
    else setTimeout(step, 0);
  };
  if (typeof IntersectionObserver !== "undefined") {
    _tlLoad = new IntersectionObserver(entries => {
      if (!current()) return;
      for (const entry of entries) if (entry.isIntersecting) queued.add(+entry.target.dataset.tbatch);
      schedule();
    }, { rootMargin: "600px 0px" });
    host.querySelectorAll(".tl-batch:not(.loaded)").forEach(slot => _tlLoad.observe(slot));
  }


  // Delegate clicks on the host instead of wiring each entry: covers fill in AFTER first paint
  // (patchTimelineCovers swaps placeholder→img), and a freshly-created img never had a per-node
  // handler — so those covers went dead. Delegation keys off the .tl-open class, which the
  // patched img keeps, so every cover stays clickable no matter when it arrived.
  host.onclick = (e) => {
    const load = e.target.closest(".tl-load");
    if (load) { loadBatch(+load.closest(".tl-batch").dataset.tbatch); return; }
    const openEl = e.target.closest(".tl-open");
    if (openEl) {
      const entry = openEl.closest(".tl-entry");
      const row = entry && flat[+entry.dataset.ti];
      if (row) openDrawer(row, "completed");
      return;
    }
    const moreEl = e.target.closest(".tl-more");
    if (moreEl) {
      const entry = moreEl.closest(".tl-entry");
      const row = entry && flat[+entry.dataset.ti];
      if (!row) return;
      const q = entry.querySelector(".tl-quote");
      const open = entry.classList.toggle("tl-expanded");
      q.textContent = open ? tlFull(row.notes) : tlSnippet(row.notes);
      moreEl.textContent = open ? "Show less" : "Read more";
    }
  };

  // Jump directly to the hydrated destination. Animating through estimated
  // offscreen heights would load every batch along the way.
  const jump = "auto";
  // Click a rail chip → scroll to that section (scroll-margin clears the sticky heading).
  const chips = [...host.querySelectorAll(".tl-rail-chip")];
  chips.forEach((chip) => chip.onclick = () => {
    const sec = host.querySelector(`#tlb-${chip.dataset.tlb}`);
    if (sec) {
      const slot = sec.querySelector(".tl-batch");
      if (slot) loadBatch(+slot.dataset.tbatch);
      sec.scrollIntoView({ behavior: jump, block: "start" });
    }
  });
  // A day asked for from elsewhere (the Stats heatmap) — scroll to it once the entries exist.
  // Same instant-on-mobile rule as the rail: this is the 1,700-entry list the comment above
  // is about, and a smooth glide to a date three years down is exactly what crashes Safari.
  if (_tlPendingDay) {
    const iso = _tlPendingDay;
    _tlPendingDay = null;
    const index = flat.findIndex(row => String(row.date || "").slice(0, 10) === iso);
    const batch = batches.findIndex(b => index >= b.start && index < b.start + b.rows.length);
    if (batch >= 0) loadBatch(batch);
    const hit = host.querySelector(`.tl-entry[data-td="${CSS.escape(iso)}"]`);
    if (hit) {
      // Highlight the destination after its batch has been rendered.
      hit.classList.add("in", "tl-hit");
      hit.scrollIntoView({ behavior: jump, block: "center" });
      setTimeout(() => hit.classList.remove("tl-hit"), 2200);
    }
  }
  // …and light the chip for whichever section is at the top right now, scrolling the RAIL so
  // the active one stays in view (the rail scrolls internally when there are many buckets).
  if (chips.length) {
    // The timeline scrolls INSIDE #timeline on desktop (overflow-y:auto) but the PAGE scrolls
    // on mobile (overflow:visible) — observe against whichever is actually the scroller, or the
    // ratios are wrong (that's why the active chip stuck on the first bucket).
    const root = (getComputedStyle(host).overflowY !== "visible" && host.scrollHeight > host.clientHeight + 4) ? host : null;
    const rail = host.querySelector(".tl-rail");
    const visible = new Set();
    let activeBi = -1;
    _tlSpy?.disconnect();
    const spy = _tlSpy = new IntersectionObserver((es) => {
      if (!current()) return;
      for (const e of es) {
        const bi = +e.target.id.slice(4);
        if (e.isIntersecting) visible.add(bi); else visible.delete(bi);
      }
      if (!visible.size) return;
      const bi = Math.min(...visible);              // the topmost section on screen
      if (bi === activeBi) return;
      activeBi = bi;
      chips.forEach((c) => c.classList.toggle("on", +c.dataset.tlb === bi));
      const chip = chips[bi];
      // Keep the rail scroll instant on mobile too — a fixed-element smooth scroll fired
      // repeatedly during a page scroll compounds the same jank.
      if (chip && rail) rail.scrollTo({ top: chip.offsetTop - rail.clientHeight / 2 + chip.offsetHeight / 2, behavior: jump });
    }, { root, rootMargin: "-8% 0px -80% 0px", threshold: 0 });
    host.querySelectorAll(".tl-year").forEach((s) => spy.observe(s));

    // The rail hides its scrollbar, so when there are more buckets than fit (a Release Year sort
    // can be 40+ years) the overflow was invisible — the extra buckets just ran off the bottom of
    // the screen with no hint they were there. Fade whichever edge has more beyond it.
    if (rail) {
      const updateFade = () => {
        if (!current()) return;
        const top = rail.scrollTop, height = rail.clientHeight, total = rail.scrollHeight;
        rail.classList.toggle("fade-top", top > 2);
        rail.classList.toggle("fade-bot", top + height < total - 2);
      };
      rail.addEventListener("scroll", updateFade, { passive: true });
      requestAnimationFrame(updateFade);        // after layout, so the heights are real
    }
  }

}
