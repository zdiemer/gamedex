"use strict";

// UI components for home.js. Feature state and orchestration remain in that module.

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

async function fillChallengeSpotlight(slot, run) {
  if (typeof CHALLENGES === "undefined") return;
  const epoch = _enrichEpoch, data = DATA, day = chToday();
  const results = [];
  for (const challenge of CHALLENGES) {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (run !== _homeChallengeRun || !slot.isConnected || activeTab !== "home") return;
    if (epoch !== _enrichEpoch || data !== DATA || day !== chToday()) {
      scheduleHomeChallenges(); return;
    }
    results.push(computeChallenge(challenge));
  }
  slot.innerHTML = challengeSpotlight(results);
  slot.removeAttribute("aria-busy");
  const all = slot.querySelector("#hChalAll");
  if (all) all.onclick = (e) => { e.stopPropagation(); goTab("challenges"); };
  slot.querySelectorAll(".h-chal[data-chal]").forEach((el) => {
    el.onclick = () => goTab("challenges", () => { chState.open = el.dataset.chal; });
  });
}

function challengeSpotlight(results) {
  if (typeof CHALLENGES === "undefined") return "";
  const live = results.filter((r) => r.total && r.remaining.size);
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
    const playing = homePlaying();
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

function recShelfHtml(recRows) {
  return shelf("hRecs", `${icon("i-star", 16)} Because you liked…`, recRows.map(({ row, rec }) =>
    homeCard(row, "games", `<span class="h-why">Like ${escapeHtml(rec.because.slice(0, 2).join(" & "))}</span>`)));
}

/* The four fetches that land AFTER Home's first paint — /api/recommendations and the three
   daily puzzles' state — each used to call renderHome(), which rewrites host.innerHTML and
   so destroys and recreates every <img> on the page. That was invisible while covers didn't
   arrive until t=8.3s: the rebuilds all happened before there was anything to destroy. Now
   that the first paint has real box art on it (see applyCoverMap, app.js), those same four
   rebuilds are four visible wipe-and-reload flashes on a cold load. Each of them changes one
   section, so each of them now repaints one section. */
function patchHomeRecs() {
  const slot = document.getElementById("hRecsSlot");
  if (!slot || activeTab !== "home") return;
  const recRows = recShelfRows();
  slot.innerHTML = recShelfHtml(recRows);
  // The click registry is keyed sheet + match key (see renderHome); these are new cards.
  if (homeState.cardRows) for (const { row } of recRows) homeState.cardRows.set("games:" + String(row._k || ""), row);
  wireHomeCards(slot);
  // These rows were not on screen at first paint, so nothing has asked for their covers.
  if (typeof maybeEnrich === "function") maybeEnrich(recRows.map((x) => x.row));
}

function patchHomeDaily() {
  const slot = document.getElementById("hDailySlot");
  if (!slot || activeTab !== "home") return;
  slot.innerHTML = typeof dailyHomeCardHtml === "function" ? dailyHomeCardHtml() : "";
  if (typeof wireDailyHome === "function") wireDailyHome();
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
  const playing = homePlaying();
  const upNext = grp(byStatus("Up Next"));
  const onHold = grp(byStatus("On Hold"));
  const added = grp(hRows().filter((r) => r.dateAdded && !r.completed)).sort(byDateDesc("dateAdded")).slice(0, 18);
  const recent = hCompleted().slice().sort(byDateDesc("date")).slice(0, 18);
  // Every order is estimatedRelease "N/A" / status "Pending" — neither says
  // anything. What's actually informative is when you ordered it and from whom.
  const orders = grp(hOrders().slice()).sort(byDateDesc("orderedDate")).slice(0, 18);

  const recRows = recShelfRows();

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
    // Above the hero, and only while a season is on: it's the one thing on this page that
    // isn't here every day, so it has to be the first thing you see or it may as well not
    // exist. There is room for exactly one, and when windows overlap the registry decides
    // which (events.js). With nothing in season this returns "" and Home is what it was.
    (typeof evHomeBannerHtml === "function" ? evHomeBannerHtml()
      : (typeof spookBannerHtml === "function" ? spookBannerHtml() : "")) +
    heroSection(playing) +
    (loved.length ? `<section class="h-sect">
      <div class="h-sect-head"><h2>${icon("i-trend", 17)} You'd probably love</h2>
        <div class="h-sect-act"><button class="linkbtn" id="hPickMore">Roll one instead →</button></div></div>
      <div class="h-picks">${loved.map(({ r, p }) =>
        homeCard(r, "games", `<span class="h-why">~${Math.round(p.score * 100)}% predicted</span>`)).join("")}</div>
    </section>` : "") +
    `<div id="hRecsSlot">${recShelfHtml(recRows)}</div>` +
    shelf("hPlaying", `${icon("i-play", 16)} Now playing`, playing.map((r) => homeCard(r, "games",
      r.playingProgress != null ? `${Math.round(+r.playingProgress * 100)}% through` : ""))) +
    shelf("hNext", `${icon("i-play", 16)} Up next`, upNext.map((r) => homeCard(r, "games"))) +
    shelf("hHold", `${icon("i-clock", 16)} On hold`, onHold.map((r) => homeCard(r, "games",
      r.dateStarted ? `Started ${escapeHtml(fmtDate(r.dateStarted))}` : ""))) +
    `<div id="hDailySlot">${typeof dailyHomeCardHtml === "function" ? dailyHomeCardHtml() : ""}</div>` +
    onThisDay() +
    shelf("hRecent", `${icon("i-trophy", 16)} Recently completed`, recent.map((r) => homeCard(r, "completed",
      r.rating != null ? `You gave it ${Math.round(r.rating * 100)}%` : (r.date ? escapeHtml(fmtDate(r.date)) : "")))) +
    shelf("hAdded", `${icon("i-plus", 16)} Recently added`, added.map((r) => homeCard(r, "games",
      r.dateAdded ? `Added ${escapeHtml(fmtDate(r.dateAdded))}` : ""))) +
    shelf("hOrder", `${icon("i-package", 16)} On order`, orders.map((r) => homeCard(r, "onOrder",
      [r.orderedDate ? `Ordered ${escapeHtml(fmtDate(r.orderedDate))}` : "", r.vendor ? escapeHtml(String(r.vendor)) : ""]
        .filter(Boolean).join(" · ")))) +
    CHAL_SLOT;

  wireHome(host, playing);
  scheduleHomeChallenges();
  if (typeof wireDailyHome === "function") wireDailyHome();
  if (typeof dailyHomeInit === "function") dailyHomeInit();

  /* Ask for THESE games' covers now, instead of waiting for the whole-library map.
     maybeEnrich was wired into the grid (table.js) and search, but never here — so the
     landing page, the one page everybody sees first, was the only listing with no
     page-scoped fetch at all. Measured: every cover on Home appeared at once at t=8.3s,
     when /api/enrichment/all finally landed behind a dozen other calls; the batch POST
     answers ~150 keys in 39ms. cardRows already holds exactly what's on screen — the
     shelves, the poster grid AND the hero — so there is nothing to re-derive. */
  maybeEnrich([...homeState.cardRows.values()]);
}
