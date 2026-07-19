"use strict";

/* The landing page.

   Everything here is derived from the sheet + the enrichment cache — there's no
   new data source. The point is to answer "what should I do right now?" without
   making you search 14.7k rows for it.

   Loaded after app.js/challenges.js; shares their globals (DATA, ENRICH,
   openDrawer, isCandidate, combinedRating, playtimeOf, …). */

const homeState = { heroIdx: 0 };
let _homeTimer = null;

const hRows = () => ((DATA.sheets.games || {}).rows || []).filter((r) => r.title);
const hCompleted = () => ((DATA.sheets.completed || {}).rows || []);
const hOrders = () => ((DATA.sheets.onOrder || {}).rows || []);

const byStatus = (s) => hRows().filter((r) => r.playingStatus === s);
const hToday = () => new Date();

/* Rotate the recommendation shelves daily: the same picks all day, a fresh set
   tomorrow. Seeded per (day, shelf, game) — NOT a positional shuffle of the pool.
   The pools these shelves draw from settle in pieces after the first paint (the
   enrichment map refits the prediction model, RECS arrive in their own fetch), and
   each arrival re-renders Home. A Fisher–Yates over the array meant one entrant
   moving in the pool re-dealt every slot, so the landing set visibly swapped out
   from under you a moment after it appeared. Ranking each game by its own
   day-seeded hash keeps a pick stable wherever it sits in the pool, and pinning
   what a shelf has already shown today means a later render can only fill empty
   slots or drop a game that's genuinely no longer eligible — never trade cards.
   The salt lets each shelf rotate independently so they don't move in lockstep. */
const _dayNum = () => { const d = hToday(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
function _daySeed(salt) {
  let h = 2166136261 ^ _dayNum();
  for (let i = 0; i < salt.length; i++) h = Math.imul(h ^ salt.charCodeAt(i), 16777619);
  return h >>> 0;
}
function dailyStable(pool, n, salt, keyOf) {
  const day = _dayNum();
  const pins = homeState.picks || (homeState.picks = {});
  const st = pins[salt] && pins[salt].day === day ? pins[salt] : (pins[salt] = { day, keys: [] });
  const byKey = new Map(pool.map((x) => [String(keyOf(x)), x]));
  const out = st.keys.map((k) => byKey.get(k)).filter(Boolean);   // today's already-shown picks, minus any now ineligible
  // fmix32 on top of the FNV pass: without it, keys that differ only in their last
  // character rank next to each other, and "today's six" comes out as near-neighbours.
  const rank = (x) => {
    let h = _daySeed(salt + "|" + keyOf(x));
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const pinned = new Set(st.keys);
  const rest = pool.filter((x) => !pinned.has(String(keyOf(x)))).sort((a, b) => rank(a) - rank(b));
  out.push(...rest.slice(0, Math.max(0, n - out.length)));
  st.keys = out.map((x) => String(keyOf(x)));
  return out;
}
const hMD = (d) => `-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yearsAgo = (iso) => hToday().getFullYear() - +String(iso).slice(0, 4);
const agoText = (n) => (n <= 0 ? "today" : n === 1 ? "1 year ago" : `${n} years ago`);

// Newest first by whichever date field is meaningful for the row.
const byDateDesc = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));

// ---- pieces --------------------------------------------------------------

// The shared listing card (posterCardHtml, table.js), with Home's own hooks on it. Home used
// to carry its own copy of this markup; there is only one now, so a card cannot look like a
// different kind of object here than it does in the grid.
function homeCard(row, sheet, note) {
  return posterCardHtml(row, {
    cls: "h-card",
    note,
    attrs: `data-hk="${escapeHtml(String(row._k || ""))}" data-hs="${sheet}"`,
  });
}

// A horizontally-scrolling shelf with arrows.
function shelf(id, title, cards, action) {
  if (!cards.length) return "";
  return `<section class="h-sect">
    <div class="h-sect-head">
      <h2>${title}</h2>
      <div class="h-sect-act">
        ${action || ""}
        <button class="h-arrow" data-scroll="${id}" data-dir="-1" aria-label="Scroll left">‹</button>
        <button class="h-arrow" data-scroll="${id}" data-dir="1" aria-label="Scroll right">›</button>
      </div>
    </div>
    <div class="h-shelf" id="${id}">${cards.join("")}</div>
  </section>`;
}

// The big one: whatever you're actually in the middle of.
function heroSection(playing) {
  if (!playing.length) return "";
  const row = playing[homeState.heroIdx % playing.length];
  const e = ENRICH[row._k] || {};
  const cs = coverSrc(e, "cover_big");
  const shot = (DETAIL[row._k] || {}).screenshots || [];
  const bg = shot.length ? IMG(shot[0], "screenshot_big") : "";
  const prog = row.playingProgress != null ? Math.round(+row.playingProgress * 100) : null;
  const t = playtimeOf(row);
  const left = (prog != null && t != null) ? t * (1 - prog / 100) : null;
  const bits = [row.platform, row.genre].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  const dots = playing.length > 1
    ? `<div class="h-dots">${playing.map((_, i) =>
        `<button class="h-dot${i === homeState.heroIdx % playing.length ? " on" : ""}" data-hero="${i}" aria-label="Game ${i + 1}"></button>`).join("")}</div>`
    : "";
  const pager = playing.length > 1
    ? `<button class="h-page prev" data-page="-1" aria-label="Previous game">‹</button>
       <button class="h-page next" data-page="1" aria-label="Next game">›</button>` : "";
  return `<section class="h-hero" style="${bg ? `--shot:url('${bg}')` : ""}">
    <div class="h-hero-bg${bg ? " on" : ""}"></div>
    ${pager}
    <div class="h-hero-inner">
      ${cs
        ? `<img class="h-hero-cover" src="${escapeHtml(cs)}" alt="" role="button" tabindex="0" title="Open details" data-hk="${escapeHtml(String(row._k || ""))}" data-hs="games">`
        : `<div class="h-hero-cover ph" role="button" tabindex="0" data-hk="${escapeHtml(String(row._k || ""))}" data-hs="games">${icon("i-library", 34)}</div>`}
      <div class="h-hero-txt">
        <span class="h-eyebrow">Continue playing</span>
        <h1>${escapeHtml(String(row.title))}</h1>
        <div class="h-hero-meta">${bits}${row.dateStarted ? ` · started ${escapeHtml(fmtDate(row.dateStarted))}` : ""}</div>
        ${prog != null ? `<div class="h-prog"><span style="width:${prog}%"></span></div>
          <div class="h-prog-txt">${prog}% through${left != null ? ` · about ${fmtHours(left)} left` : ""}</div>` : ""}
        <span class="h-actions">
          ${launchHtml(row)}
          <button class="btn ghost h-open" data-hk="${escapeHtml(String(row._k || ""))}" data-hs="games">Details</button>
        </span>
      </div>
      ${dots}
    </div>
  </section>`;
}

// Releases, completions, purchases and additions that share today's calendar date.
function onThisDay() {
  const md = hMD(hToday());
  const onMd = (v) => typeof v === "string" && v.slice(4) === md;

  const rel = hRows().filter((r) => onMd(r.releaseDate))
    .sort((a, b) => (combinedRating(b) ?? 0) - (combinedRating(a) ?? 0));
  const done = hCompleted().filter((r) => onMd(r.date)).sort(byDateDesc("date"));
  const bought = hRows().filter((r) => onMd(r.datePurchased)).sort(byDateDesc("datePurchased"));
  // "Added" only shows games NOT already in "Bought" today — a game bought and logged
  // the same day would otherwise appear twice. What's left is the interesting case: a
  // preorder added before it shipped, or an emulated game with no purchase at all.
  const boughtKeys = new Set(bought.map((r) => r._k || r.title));
  const added = hRows()
    .filter((r) => onMd(r.dateAdded) && !boughtKeys.has(r._k || r.title))
    .sort(byDateDesc("dateAdded"));
  if (!rel.length && !done.length && !bought.length && !added.length) return "";

  const cards = (rows, sheet, dateKey, verb) => rows.slice(0, 12).map((r) =>
    homeCard(r, sheet, `${verb} ${agoText(yearsAgo(r[dateKey]))}`));

  const today = hToday().toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const sect = (rows, id, label, sheet, dateKey, verb) =>
    rows.length ? shelf(id, `<span class="h-sub">${label}</span>`, cards(rows, sheet, dateKey, verb)) : "";
  return `<div class="h-otd-head"><h2>${icon("i-calendar", 17)} On this day <span class="muted">${escapeHtml(today)}</span></h2></div>` +
    sect(done, "otdDone", "You completed these", "completed", "date", "Completed") +
    sect(bought, "otdBought", "You bought these", "games", "datePurchased", "Bought") +
    sect(added, "otdAdded", "You added these", "games", "dateAdded", "Added") +
    sect(rel, "otdRel", "Released on this date", "games", "releaseDate", "Released");
}

// The three challenges you're closest to finishing.
function challengeSpotlight() {
  if (typeof CHALLENGES === "undefined") return "";
  const live = CHALLENGES.map(computeChallenge).filter((r) => r.total && r.remaining.size);
  if (!live.length) return "";
  live.sort((a, b) => a.remaining.size - b.remaining.size);
  const cards = live.slice(0, 3).map((r) => {
    // "Skyrim, Mario, and 6 others" beats a runaway dot-separated list that overflows.
    const names = chSortBuckets(r, r.remaining).map(([k]) => String(k));
    const shown = names.slice(0, 2).map(escapeHtml);
    const more = names.length - shown.length;
    const left = shown.length
      ? shown.join(", ") + (more > 0 ? `, and ${more} other${more > 1 ? "s" : ""}` : "")
      : "";
    return `<button class="h-chal" data-chal="${escapeHtml(r.c.id || r.c.name)}">
      <span class="h-chal-top"><span class="ch-icon">${glyph(r.c.icon, 20)}</span>
        <b>${escapeHtml(r.c.name)}</b></span>
      <span class="muted">${r.cleared.size} of ${r.total} · ${r.remaining.size} to go</span>
      <span class="ch-bar"><span style="width:${(r.pct * 100).toFixed(1)}%"></span></span>
      ${left ? `<span class="h-chal-left">Left: ${left}</span>` : ""}
    </button>`;
  }).join("");
  return `<section class="h-sect">
    <div class="h-sect-head"><h2>${icon("i-target", 17)} Closest challenges</h2>
      <div class="h-sect-act"><button class="linkbtn" id="hChalAll">See all →</button></div></div>
    <div class="h-chals">${cards}</div>
  </section>`;
}

// ---- render --------------------------------------------------------------

// Swap just the hero, leaving every other <img> on the page untouched.
function renderHero(playing) {
  const cur = document.querySelector(".h-hero");
  if (!cur) return;
  const tmp = document.createElement("div");
  tmp.innerHTML = heroSection(playing);
  const next = tmp.firstElementChild;
  if (!next) return;
  cur.replaceWith(next);
  wireHeroBits(next, playing);
}

// Enrichment arrived: fill in the covers that were placeholders, in place.
// A full renderHome() here would recreate every <img> and flash the whole page.
function patchHomeCovers() {
  const host = $("#home");
  if (!host) return;
  // The hero's cover carries data-hk but is NOT a .card, so the loop below (which looks for a
  // child .card-cover.ph) never touched it — the first game's box art only appeared once you
  // paged the carousel. Refresh it here via renderHero, which re-reads coverSrc and re-wires
  // the pager/swipe/click. Guarded on the CURRENT hero game actually having a cover now, so a
  // genuinely cover-less game doesn't re-render the hero on every enrichment poll.
  if (host.querySelector(".h-hero-cover.ph")) {
    // Same grouping as renderHome, or the hero pager and dots count differently
    // here than they did at render time.
    const grp = (rows) => (typeof groupByGame === "function" ? groupByGame(rows) : rows);
    const playing = grp(byStatus("Playing")).sort(byDateDesc("dateStarted"));
    const cur = playing.length ? playing[homeState.heroIdx % playing.length] : null;
    if (cur && coverSrc(ENRICH[cur._k], "cover_big")) renderHero(playing);
  }
  host.querySelectorAll("[data-hk]").forEach((el) => {
    const ph = el.querySelector(".card-cover.ph");
    if (!ph) return;
    const e = ENRICH[el.dataset.hk];
    const cs = coverSrc(e, "cover_big");
    if (!cs) return;
    const img = document.createElement("img");
    img.className = "card-cover" + (coverIsPixelArt(e, cs) ? " pixel" : "");
    img.loading = "lazy"; img.decoding = "async"; img.alt = ""; img.src = cs;
    ph.replaceWith(img);
  });
}

function renderHome() {
  const host = $("#home");
  if (!DATA) return;

  // Home shelves use the same grouped cards as the listings (a game bought on
  // two platforms is one card, platforms named on it) — filter first, group the
  // survivors, exactly like the grid does. "Recently finished" stays UNGROUPED
  // on purpose, like the timeline: finishing a game on two platforms is two
  // finishes, and this shelf is a record of finishes, not of games.
  const grp = (rows) => (typeof groupByGame === "function" ? groupByGame(rows) : rows);
  const playing = grp(byStatus("Playing")).sort(byDateDesc("dateStarted"));
  const upNext = grp(byStatus("Up Next"));
  const onHold = grp(byStatus("On Hold"));
  const added = grp(hRows().filter((r) => r.dateAdded && !r.completed)).sort(byDateDesc("dateAdded")).slice(0, 18);
  const recent = hCompleted().slice().sort(byDateDesc("date")).slice(0, 18);
  // Every order is estimatedRelease "N/A" / status "Pending" — neither says
  // anything. What's actually informative is when you ordered it and from whom.
  const orders = grp(hOrders().slice()).sort(byDateDesc("orderedDate")).slice(0, 18);

  // Recommendations come from the server (IGDB's similar-games, crossed with
  // your backlog); predictions are computed here from your own ratings. Both
  // rotate daily from their full pool rather than always showing the same top 18.
  const recRows = dailyStable((RECS || []).map((rec) => {
    const row = hRows().find((r) => String(r._k || "") === rec.key);
    return row ? { row, rec } : null;
  }).filter(Boolean), 18, "recs", (x) => x.rec.key);

  // The lead section: a grid of big poster cards right under the hero. Rotate six out of the
  // top ~60 predicted so it's a fresh set daily but always from the strongest picks.
  const loved = dailyStable(hRows()
    .filter((r) => !r.completed && !r.playingStatus && (typeof isCandidate !== "function" || isCandidate(r)))
    .map((r) => ({ r, p: typeof predictedCached === "function" ? predictedCached(r) : null }))
    .filter((x) => x.p && x.p.confidence >= 0.75)
    .sort((a, b) => b.p.score - a.p.score)
    .slice(0, 60), 6, "loved", (x) => String(x.r._k || ""));

  /* What each card's click should open, keyed by sheet + match key. The shelves
     above render GROUP rows whose _k is the lead's — resolving a click by _k
     against the raw sheet (as wireHome used to) would open the lone lead and
     lose the group. Raw-row shelves register first, grouped shelves after, so
     a key on both opens the grouped drawer. */
  homeState.cardRows = new Map();
  const reg = (rows, sheet) => { for (const r of rows) homeState.cardRows.set(sheet + ":" + String(r._k || ""), r); };
  reg(recRows.map((x) => x.row), "games");
  reg(loved.map((x) => x.r), "games");
  reg([...playing, ...upNext, ...onHold, ...added], "games");
  reg(orders, "onOrder");
  reg(recent, "completed");

  host.innerHTML =
    heroSection(playing) +
    (loved.length ? `<section class="h-sect">
      <div class="h-sect-head"><h2>${icon("i-trend", 17)} You'd probably love</h2>
        <div class="h-sect-act"><button class="linkbtn" id="hPickMore">Roll one instead →</button></div></div>
      <div class="h-picks">${loved.map(({ r, p }) =>
        homeCard(r, "games", `<span class="h-why">~${Math.round(p.score * 100)}% predicted</span>`)).join("")}</div>
    </section>` : "") +
    shelf("hRecs", `${icon("i-star", 16)} Because you liked…`, recRows.map(({ row, rec }) =>
      homeCard(row, "games", `<span class="h-why">Like ${escapeHtml(rec.because.slice(0, 2).join(" & "))}</span>`))) +
    shelf("hPlaying", `${icon("i-play", 16)} Now playing`, playing.map((r) => homeCard(r, "games",
      r.playingProgress != null ? `${Math.round(+r.playingProgress * 100)}% through` : ""))) +
    shelf("hNext", `${icon("i-play", 16)} Up next`, upNext.map((r) => homeCard(r, "games"))) +
    shelf("hHold", `${icon("i-clock", 16)} On hold`, onHold.map((r) => homeCard(r, "games",
      r.dateStarted ? `Started ${escapeHtml(fmtDate(r.dateStarted))}` : ""))) +
    (typeof picrossHomeCardHtml === "function" ? picrossHomeCardHtml() : "") +
    onThisDay() +
    shelf("hRecent", `${icon("i-trophy", 16)} Recently completed`, recent.map((r) => homeCard(r, "completed",
      r.rating != null ? `You gave it ${Math.round(r.rating * 100)}%` : (r.date ? escapeHtml(fmtDate(r.date)) : "")))) +
    shelf("hAdded", `${icon("i-plus", 16)} Recently added`, added.map((r) => homeCard(r, "games",
      r.dateAdded ? `Added ${escapeHtml(fmtDate(r.dateAdded))}` : ""))) +
    shelf("hOrder", `${icon("i-package", 16)} On order`, orders.map((r) => homeCard(r, "onOrder",
      [r.orderedDate ? `Ordered ${escapeHtml(fmtDate(r.orderedDate))}` : "", r.vendor ? escapeHtml(String(r.vendor)) : ""]
        .filter(Boolean).join(" · ")))) +
    challengeSpotlight();

  wireHome(host, playing);
  if (typeof wirePicrossHome === "function") wirePicrossHome();
  if (typeof picrossHomeInit === "function") picrossHomeInit();
}

// Click handlers for the hero's own buttons (cover/open/dots).
// Swipe the hero on touch devices. A 7px dot is not a tap target, and paging a
// carousel by poking dots is the wrong gesture on a phone anyway.
function wireHeroSwipe(scope, playing) {
  if (playing.length < 2) return;
  let x0 = null, y0 = null;
  scope.addEventListener("touchstart", (e) => {
    x0 = e.changedTouches[0].clientX; y0 = e.changedTouches[0].clientY;
  }, { passive: true });
  scope.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;   // a scroll, not a swipe
    const n = playing.length;
    homeState.heroIdx = (homeState.heroIdx + (dx < 0 ? 1 : -1) + n) % n;
    renderHero(playing);
    loadHeroShot(playing);
  }, { passive: true });
}

function wireHeroBits(scope, playing) {
  wireHeroSwipe(scope, playing);
  scope.querySelectorAll(".h-page").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const n = playing.length;
      homeState.heroIdx = (homeState.heroIdx + (+el.dataset.page) + n) % n;
      renderHero(playing);
      loadHeroShot(playing);
    };
  });
  scope.querySelectorAll("[data-hk]").forEach((el) => {
    el.onclick = () => {
      const row = hRows().find((r) => String(r._k || "") === el.dataset.hk);
      if (row) openDrawer(row, "games");
    };
  });
  scope.querySelectorAll(".h-dot").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      homeState.heroIdx = +el.dataset.hero;
      renderHero(playing);
      loadHeroShot(playing);
    };
  });
  scheduleHero(playing);   // (re-)arm the auto-rotate; resets it after any manual paging
}

// The hero wants a screenshot backdrop; fetch the detail for the shown game
// once, then redraw only the hero with it.
function loadHeroShot(playing) {
  if (!playing.length || !ENRICH_ENABLED) return;
  const row = playing[homeState.heroIdx % playing.length];
  if (!row._k || DETAIL[row._k]) return;
  fetch("api/enrichment/detail?key=" + encodeURIComponent(row._k))
    .then((r) => r.json())
    .then((j) => {
      if (j.status === "matched" && j.detail && (j.detail.screenshots || []).length) {
        DETAIL[row._k] = j.detail;
        if (activeTab === "home") renderHero(playing);
      }
    })
    .catch(() => {});
}

function wireHome(host, playing) {
  // Any card / hero button opens the game.
  host.querySelectorAll("[data-hk]").forEach((el) => {
    const k = el.dataset.hk, sheetKey = el.dataset.hs;
    const src = sheetKey === "completed" ? hCompleted() : sheetKey === "onOrder" ? hOrders() : hRows();
    // Prefer the row the shelf actually rendered (possibly a group row) over a
    // raw-sheet lookup by key — see the registry note in renderHome.
    const row = (homeState.cardRows && homeState.cardRows.get(sheetKey + ":" + k))
      || src.find((r) => String(r._k || "") === k);
    el.onclick = () => { if (row) openDrawer(row, sheetKey); };
    // Hover-to-play trailers, same as the grid. Home is the tab you land on, so
    // leaving it out meant the feature looked broken to anyone who never left it.
    if (row && el.classList.contains("card")) wirePreviewFor(el, row);
  });
  host.querySelectorAll(".h-arrow").forEach((el) => {
    el.onclick = () => {
      const shelfEl = document.getElementById(el.dataset.scroll);
      if (shelfEl) shelfEl.scrollBy({ left: +el.dataset.dir * shelfEl.clientWidth * 0.8, behavior: "smooth" });
    };
  });
  const pickMore = $("#hPickMore");
  // Land on an already-rolled game, not the empty builder — switchTab paints the picker (which
  // seeds the default backlog filter), then pickGame() rolls one and re-renders with the result.
  if (pickMore) pickMore.onclick = () => { resetTab("pick"); switchTab("pick"); pickGame(true); nav(); };
  const chalAll = $("#hChalAll");
  if (chalAll) chalAll.onclick = (e) => { e.stopPropagation(); goTab("challenges"); };
  host.querySelectorAll(".h-chal[data-chal]").forEach((el) => {
    el.onclick = () => goTab("challenges", () => { chState.open = el.dataset.chal; });
  });

  loadHeroShot(playing);
  // The initial hero (built inline by renderHome) needs its pager/dots/swipe wired too
  // — only renderHero did it before, so a fresh Home landed with a dead pager.
  const hero = host.querySelector(".h-hero");
  if (hero) wireHeroBits(hero, playing);
}

// Rotate the hero on a 9s timer that RESTARTS on any manual paging — otherwise a
// swipe right before the timer fired flicked past two games in a blink. setTimeout
// that reschedules itself, rather than a fixed interval, so resetting is just a
// clearTimeout. renderHero (not renderHome) — the latter rebuilds every <img>.
const HERO_MS = 9000;
function scheduleHero(playing) {
  clearTimeout(_homeTimer);
  if (!playing || playing.length <= 1 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  _homeTimer = setTimeout(() => {
    if (activeTab === "home" && $("#overlay").hidden) {
      homeState.heroIdx = (homeState.heroIdx + 1) % playing.length;
      renderHero(playing);
      loadHeroShot(playing);       // renderHero re-wires and re-arms the timer + countdown
    } else {
      scheduleHero(playing);       // paused (drawer/other tab): just try again later
    }
  }, HERO_MS);
}

// Landing state (core.js): the hero goes back to the first slide. NOT _homeTimer —
// scheduleHero self-guards on activeTab and re-arms, so clearing it kills the rotation.
TAB_RESET.home = () => { homeState.heroIdx = 0; };
