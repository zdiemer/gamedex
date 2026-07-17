"use strict";

/* Timeline — your gaming life, in order.

   1,707 completions with covers, scores and reviews, and until now the only way
   to see them was a paginated table. This is the emotional version: scroll
   through the whole thing, year by year, and watch your taste change.

   It's a VIEW MODE on the Completed tab rather than another tab — it's the same
   rows, sorted by date, and it respects whatever filters and search are active.

   Loaded after app.js; shares its globals (DATA, ENRICH, openDrawer, …). */

const TL_SNIPPET = 190;          // characters of review shown inline

function tlYearOf(r) {
  const y = String(r.date || "").slice(0, 4);
  return /^\d{4}$/.test(y) ? +y : null;
}

// The timeline buckets by whatever the sort is (date → years, Title → A–Z, Platform → each
// platform, Rating → bands …), so the label a row falls under depends on the active sort's
// primary key/type. Same shape as the grid's facet buckets, tuned for section headings.
function tlRatingBand(v) {
  if (v == null) return "Unrated";
  const pct = v * 100;
  return pct >= 90 ? "90–100%" : pct >= 80 ? "80–89%" : pct >= 70 ? "70–79%"
    : pct >= 60 ? "60–69%" : "Below 60%";
}
function tlBucketLabel(r, spec) {
  const key = spec.key;
  const type = spec.type || (typeof colByKey === "function" ? (colByKey(key) || {}).type : null);
  if (key === "game" || key === "title") {
    // Strip diacritics first, so "Ōkami" buckets under O (and sits contiguously with the other
    // O's — cmpBy sorts titles accent-insensitively, so the label has to agree or you get a
    // stray "#" wedged mid-alphabet).
    const c = String(r.game || r.title || "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  const v = r[key];
  if (type === "date") { const y = String(v || "").slice(0, 4); return /^\d{4}$/.test(y) ? y : "Undated"; }
  if (type === "rating") return tlRatingBand(v);
  if (type === "hours") return v != null ? (bucketLabel(+v, PLAYTIME_BUCKETS) || "—") : "Unknown";
  if (type === "bool") return v ? "Yes" : "No";
  if (type === "year" || type === "int") return (v != null && v !== "") ? String(v) : "—";
  return (v != null && v !== "") ? String(v) : "—";
}

function tlSnippet(notes) {
  if (!notes) return "";
  const s = String(notes).replace(/\s+/g, " ").trim();
  if (s.length <= TL_SNIPPET) return s;
  // Cut on a word boundary, not mid-word.
  return s.slice(0, s.lastIndexOf(" ", TL_SNIPPET)) + "…";
}

function tlFull(notes) {
  // Keep the review's line breaks — the paragraphs are how it was written. Collapse
  // only runs of blank lines and trailing spaces; the CSS renders it with pre-line.
  return notes
    ? String(notes).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : "";
}

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
      style="--d:${Math.min(i, 12) * 45}ms">
    <div class="tl-when">
      <b>${escapeHtml(r.date ? fmtDate(r.date).replace(/,? \d{4}$/, "") : "—")}</b>
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
    img.className = "tl-cover"; img.loading = "lazy"; img.alt = ""; img.src = cs;
    ph.replaceWith(img);
  });
}

// rows: already filtered by the Completed tab's search + facets.
function renderTimeline(rows) {
  const host = $("#timeline");
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

  let i = 0;
  const flat = [];             // index -> row, for the click handler
  const sections = buckets.map((bk, bi) => {
    const games = bk.games;
    const hours = games.reduce((a, g) => a + (g.playTime || 0), 0);
    const rated = games.filter((g) => g.rating != null);
    const avg = rated.length ? rated.reduce((a, g) => a + g.rating, 0) / rated.length : null;
    const entries = games.map((r) => { flat.push(r); return tlEntry(r, i++); }).join("");
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

  // Jump-nav: a sticky, horizontally-scrollable strip of the bucket labels — a 1,700-item
  // scroll is a long way to drag, and now that the buckets change with the sort it's the only
  // quick way around. Only when there's more than one bucket to jump between.
  const nav = buckets.length > 1
    ? `<nav class="tl-nav" aria-label="Jump to a section">${buckets.map((bk, bi) =>
        `<button class="tl-nav-chip" type="button" data-tlb="${bi}">${escapeHtml(String(bk.label))}</button>`).join("")}</nav>`
    : "";

  host.innerHTML = nav + `<div class="tl">${sections}</div>`;

  host.querySelectorAll(".tl-entry").forEach((el) => {
    const row = flat[+el.dataset.ti];
    // Cover and title open the drawer; the review expands in place.
    el.querySelectorAll(".tl-open").forEach((o) => o.onclick = () => { if (row) openDrawer(row, "completed"); });
    const more = el.querySelector(".tl-more");
    if (more) more.onclick = () => {
      const q = el.querySelector(".tl-quote");
      const open = el.classList.toggle("tl-expanded");
      q.textContent = open ? tlFull(row.notes) : tlSnippet(row.notes);
      more.textContent = open ? "Show less" : "Read more";
    };
  });

  // Click a chip → scroll its section under the sticky nav (scroll-margin handles the offset).
  const chips = [...host.querySelectorAll(".tl-nav-chip")];
  chips.forEach((chip) => chip.onclick = () => {
    const sec = host.querySelector(`#tlb-${chip.dataset.tlb}`);
    if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  // …and light the chip for whichever section is currently under the nav, keeping it in view.
  if (chips.length) {
    // The timeline scrolls INSIDE #timeline on desktop (overflow-y:auto) but the PAGE scrolls
    // on mobile (overflow:visible) — observe against whichever is actually the scroller, or the
    // ratios are wrong (that's why the active chip stuck on the first bucket).
    const root = (getComputedStyle(host).overflowY !== "visible" && host.scrollHeight > host.clientHeight + 4) ? host : null;
    const nav = host.querySelector(".tl-nav");
    const visible = new Set();
    let activeBi = -1;
    const spy = new IntersectionObserver((es) => {
      for (const e of es) {
        const bi = +e.target.id.slice(4);
        if (e.isIntersecting) visible.add(bi); else visible.delete(bi);
      }
      if (!visible.size) return;
      const bi = Math.min(...visible);              // the topmost section under the nav
      if (bi === activeBi) return;
      activeBi = bi;
      chips.forEach((c) => c.classList.toggle("on", +c.dataset.tlb === bi));
      const chip = chips[bi];
      if (chip && nav) nav.scrollTo({ left: chip.offsetLeft - nav.clientWidth / 2 + chip.offsetWidth / 2, behavior: "smooth" });
    }, { root, rootMargin: "-88px 0px -72% 0px", threshold: 0 });   // band below the nav + sticky heading
    host.querySelectorAll(".tl-year").forEach((s) => spy.observe(s));
  }

  // Entries fade in as they arrive, so a 1,700-item scroll doesn't just appear.
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        e.target.classList.add("in");
      }
    }, { threshold: 0.08 });
    host.querySelectorAll(".tl-entry").forEach((el) => io.observe(el));
  } else {
    host.querySelectorAll(".tl-entry").forEach((el) => el.classList.add("in"));
  }
}
