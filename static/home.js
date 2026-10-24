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
function homePlaying() {
  const rows = byStatus("Playing");
  return (typeof groupByGame === "function" ? groupByGame(rows) : rows).sort(byDateDesc("dateStarted"));
}
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

// The three challenges you're closest to finishing.
/* Below-fold summaries should not block the hero. Observe the slot, then compute
   one challenge per task; a tab change, rerender or enrichment update cancels it. */
const CHAL_SLOT = `<div id="hChalSlot" aria-busy="true"></div>`;
let _homeChallengeObserver = null, _homeChallengeRun = 0;
function cancelHomeChallenges() {
  _homeChallengeRun++;
  if (_homeChallengeObserver) _homeChallengeObserver.disconnect();
  _homeChallengeObserver = null;
}
function scheduleHomeChallenges() {
  cancelHomeChallenges();
  const slot = document.getElementById("hChalSlot");
  if (!slot || activeTab !== "home") return;
  const run = _homeChallengeRun;
  const start = () => {
    if (run !== _homeChallengeRun || activeTab !== "home" || !slot.isConnected) return;
    if (_homeChallengeObserver) _homeChallengeObserver.disconnect();
    _homeChallengeObserver = null;
    fillChallengeSpotlight(slot, run);
  };
  if (!("IntersectionObserver" in window)) { start(); return; }
  _homeChallengeObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) start();
  }, { root: window.matchMedia("(max-width: 760px)").matches ? null : document.getElementById("home"), rootMargin: "400px 0px" });
  _homeChallengeObserver.observe(slot);
}

/* Recommendations come from the server (IGDB's similar-games, crossed with your backlog);
   predictions are computed here from your own ratings. Both rotate daily from their full
   pool rather than always showing the same top 18.

   Split out of renderHome so RECS landing in its own fetch can rebuild THIS SHELF instead
   of the whole page — see patchHomeRecs. */
function recShelfRows() {
  const byKey = new Map();
  for (const row of hRows()) {
    const key = String(row._k || "");
    if (!byKey.has(key)) byKey.set(key, row); // same first-match rule as find()
  }
  return dailyStable((RECS || []).map((rec) => {
    const row = byKey.get(rec.key);
    return row ? { row, rec } : null;
  }).filter(Boolean), 18, "recs", (x) => x.rec.key);
}

/* One retry for a cover that failed to load, wired once at boot.

   Home paints ~140 covers in a single burst, and a browser under pressure drops some of
   them (measured in the pod's headless Chromium: 42 of 142 came back ERR_INSUFFICIENT_
   RESOURCES, all below the fold). That used to heal by accident — the late renderHome()
   rebuilt every <img>, which is a fresh load attempt for the ones that had failed. Now that
   nothing rebuilds the page, a dropped image would stay a dropped image for the session, so
   the retry has to be asked for rather than fallen into.

   Capture phase: `error` from an <img> does not bubble. Once per element, a second later —
   a burst that exhausted the browser's sockets is over by then, and one retry cannot turn a
   genuinely dead URL into a loop. */
let _coverRetryWired = false;
function wireCoverRetry() {
  if (_coverRetryWired) return;
  _coverRetryWired = true;
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.src) return;
    if (!img.classList.contains("card-cover") && !img.classList.contains("h-hero-cover")) return;
    if (img.dataset.retried) return;
    img.dataset.retried = "1";
    const src = img.src;
    setTimeout(() => { if (img.isConnected) img.src = src; }, 1000);
  }, true);
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
const _homeHeroRequests = new Map();
function loadHeroShot(playing) {
  if (!playing.length || !ENRICH_ENABLED) return;
  const row = playing[homeState.heroIdx % playing.length];
  if (!row._k || DETAIL[row._k] || _homeHeroRequests.has(row._k)) return;
  const request = fetch("api/enrichment/detail?key=" + encodeURIComponent(row._k))
    .then((r) => r.ok ? r.json() : null)
    .then((j) => {
      if (!j || j.status !== "matched" || !j.detail) return;
      DETAIL[row._k] = j.detail;
      const shot = (j.detail.screenshots || [])[0];
      if (!shot) return;
      const src = IMG(shot, "screenshot_big");
      const image = new Image();
      image.fetchPriority = "high";
      image.src = src; // start the hero image even if boot is still awaiting covers
      if (activeTab !== "home") return;
      const current = homePlaying();
      if (!current.length || current[homeState.heroIdx % current.length]._k !== row._k) return;
      const hero = document.querySelector(".h-hero");
      if (hero) {
        // Only the backdrop uses DETAIL. Preserve focused controls and the carousel timer.
        hero.style.setProperty("--shot", `url('${src}')`);
        const bg = hero.querySelector(".h-hero-bg");
        if (bg) bg.classList.add("on");
      }
    })
    .catch(() => {})
    .finally(() => _homeHeroRequests.delete(row._k));
  _homeHeroRequests.set(row._k, request);
  return request;
}

/* Card clicks + shelf arrows for a SCOPE — the whole page from wireHome, or one repainted
   section from patchHomeRecs. Both need exactly this and nothing else. */
function wireHomeCards(scope) {
  const sources = { games: hRows(), completed: hCompleted(), onOrder: hOrders() };
  // Any card / hero button opens the game.
  scope.querySelectorAll("[data-hk]").forEach((el) => {
    const k = el.dataset.hk, sheetKey = el.dataset.hs;
    const src = sources[sheetKey] || sources.games;
    // Prefer the row the shelf actually rendered (possibly a group row) over a
    // raw-sheet lookup by key — see the registry note in renderHome.
    const row = (homeState.cardRows && homeState.cardRows.get(sheetKey + ":" + k))
      || src.find((r) => String(r._k || "") === k);
    el.onclick = () => { if (row) openDrawer(row, sheetKey); };
    // Hover-to-play trailers, same as the grid. Home is the tab you land on, so
    // leaving it out meant the feature looked broken to anyone who never left it.
    if (row && el.classList.contains("card")) wirePreviewFor(el, row);
  });
  scope.querySelectorAll(".h-arrow").forEach((el) => {
    el.onclick = () => {
      const shelfEl = document.getElementById(el.dataset.scroll);
      if (shelfEl) shelfEl.scrollBy({ left: +el.dataset.dir * shelfEl.clientWidth * 0.8, behavior: "smooth" });
    };
  });
}

function wireHome(host, playing) {
  wireCoverRetry();
  wireHomeCards(host);
  // One banner, whichever event won the slot. evWireBanner covers Spooktober's too.
  if (typeof evWireBanner === "function") evWireBanner(host);
  else if (typeof wireSpookBanner === "function") wireSpookBanner(host);
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
