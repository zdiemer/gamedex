"use strict";

/* The drawer's headline: the cinematic hero, and the prose under it.

   A screenshot, blurred and dimmed, sits behind the cover and title; the numbers
   that matter become a stat strip. Built from the light enrichment immediately,
   then upgraded in place when the full detail lands (see fillHero in panels.js).

   Also the age-rating art, the controller map, and the HowLongToBeat block --
   everything that renders from a detail record rather than fetching one. */

// The carousel's contents: trailers first (they autoplay, muted, when their
// slide is showing), then screenshots, then key art.
function mediaOf(d) {
  return [
    ...(d.videos || []).slice(0, 6).map((v) => ({ kind: "video", id: v.id, name: v.name || "Trailer" })),
    ...(d.screenshots || []).map((id) => ({ kind: "image", id })),
    ...(d.artworks || []).map((id) => ({ kind: "image", id, art: true })),
  ];
}

// The drawer's Tags row: one combined list of chips (genres, themes, perspectives, modes,
// then IGDB's long keyword tail). Past TAG_CAP the overflow collapses behind a "+N more"
// chip — a game with fifty keywords otherwise pushes the whole drawer down. The reveal is
// wired by delegation in chrome.js; each chip is still its own facet-link.
const TAG_CAP = 12;
function tagChipsHtml(items) {
  if (!items.length) return "";
  const chip = (it) =>
    `<span class="chip facet-link" data-fk="${it.fk}" data-fv="${escapeHtml(String(it.x))}">${escapeHtml(String(it.x))}</span>`;
  if (items.length <= TAG_CAP) return `<div class="chips tag-chips">${items.map(chip).join("")}</div>`;
  const shown = items.slice(0, TAG_CAP).map(chip).join("");
  const rest = items.slice(TAG_CAP).map(chip).join("");
  return `<div class="chips tag-chips collapsed">${shown}` +
    `<span class="tag-rest">${rest}</span>` +
    `<button class="chip tag-more" type="button">+${items.length - TAG_CAP} more</button></div>`;
}

function detailHtml(d) {
  if (!d) return "";
  const cs = coverSrc(d, "cover_big");
  const cover = cs ? `<img class="cover-big" src="${cs}" alt="">` : "";
  const badge = d.manual ? `<span class="chip manual">★ Manually mapped</span>` : "";
  const rating = d.rating != null
    ? `<div class="igdb-rating ${ratingClass(d.rating)}">${Math.round(d.rating * 100)}<small>/100 IGDB</small>${d.ratingCount ? ` · ${d.ratingCount} ratings` : ""}</div>` : "";
  const linkList = (arr, fk) => arr.map((x) =>
    `<a class="facet-link" data-fk="${fk}" data-fv="${escapeHtml(String(x))}">${escapeHtml(String(x))}</a>`).join(", ");
  const meta = [];
  const uniq = (a) => [...new Set(a)];
  if (d.developers && d.developers.length) meta.push(`<div class="detail-row"><div class="k">Developer</div><div class="v">${linkList(uniq(d.developers.map(canonDev)), "developer")}</div></div>`);
  if (d.publishers && d.publishers.length) meta.push(`<div class="detail-row"><div class="k">Publisher</div><div class="v">${linkList(uniq(d.publishers.map(canonPub)), "publisher")}</div></div>`);
  if (d.franchises && d.franchises.length) meta.push(`<div class="detail-row"><div class="k">Franchise</div><div class="v">${linkList(uniq(d.franchises.map(canonFran)), "franchise")}</div></div>`);
  if (d.engines && d.engines.length) meta.push(`<div class="detail-row"><div class="k">Engine</div><div class="v">${linkList(uniq(d.engines), "__igdb_engine")}</div></div>`);
  if (d.ageRating) meta.push(`<div class="detail-row"><div class="k">Rated</div><div class="v age-v">${ageBadgeHtml(d.ageRating)}<a class="facet-link" data-fk="__igdb_age" data-fv="${escapeHtml(d.ageRating)}">${escapeHtml(d.ageRating)}</a></div></div>`);
  const nShots = mediaOf(d).length;
  const shots = nShots
    ? `<div class="shots"><div class="shot-view"></div>` +
      (nShots > 1 ? `<button class="shot-nav prev" aria-label="Previous">‹</button><button class="shot-nav next" aria-label="Next">›</button>` : "") +
      `<div class="shot-count"></div><div class="shot-cap"></div></div>` : "";
  // Computed at home, not fetched: feature overlap (franchise, developer,
  // keywords, era…) between this game and every game on the sheet, weighted by
  // how rare each shared feature is in the collection (similar.js). IGDB's own
  // similar_games list orbited the same few ubiquitous titles; this one has to
  // earn each entry — and every entry opens in-app instead of navigating away.
  const similar = typeof similarByFeatures === "function" ? similarByFeatures(d, drawerRow) : [];
  const simHtml = similar.length
    ? `<div class="detail-row notes"><div class="k">Similar games you own <span class="muted">${similar.length}</span></div>
        <div class="similar">${similar.map((s) => {
          const cover = s.cover ? IMG(s.cover, "cover_small") : coverSrc(ENRICH[s.row._k], "cover_small");
          const mark = s.row.completed ? `<i class="sim-done" title="Beaten">✓</i>`
            : s.row.owned ? `<i class="sim-owned" title="Owned">●</i>` : "";
          return `<button class="sim" data-simk="${escapeHtml(String(s.row._k || ""))}" title="${escapeHtml(s.name + (s.why ? " — " + s.why : ""))}">
            ${cover ? `<img loading="lazy" src="${escapeHtml(cover)}" alt="">` : `<span class="sim-ph">${icon("i-library", 18)}</span>`}
            ${mark}
            <span>${escapeHtml(s.name)}</span>
          </button>`;
        }).join("")}</div></div>`
    : "";

  const text = d.summary || d.storyline;
  // Genre / theme / mode, under the summary. They're a way INTO the collection
  // (every chip is a filter), so they belong next to the prose that made you
  // curious, not stacked above the cover.
  // Genre chips filter the UNIFIED genre facet (canonicalised so an IGDB "Platform"
  // chip filters "Platformer"); themes/modes stay IGDB-only facets.
  // Curated genres lead — "Nonogram" is the thing I actually went looking for, and IGDB's
  // own list would only ever say "Puzzle".
  const curated = drawerRow ? curatedGenres(drawerRow) : [];
  const genreChips = [...new Set([...curated, ...(d.genres || []).map((g) => String(canonGenre(g)))])];
  // One combined, capped list: genres/themes/perspectives/modes first, then IGDB's long
  // keyword tail. Everything past TAG_CAP folds behind "+N more" (tagChipsHtml).
  const tagItems = [
    ...genreChips.map((x) => ({ x, fk: "genre" })),
    ...(d.themes || []).map((x) => ({ x, fk: "__igdb_theme" })),
    ...(d.perspectives || []).map((x) => ({ x, fk: "__igdb_persp" })),
    ...(d.gameModes || []).map((x) => ({ x, fk: "__igdb_mode" })),
    ...(d.keywords || []).map((x) => ({ x, fk: "__igdb_kw" })),
  ];
  const tags = tagChipsHtml(tagItems);
  return (badge ? `<div class="badges">${badge}</div>` : "") +
    (text ? `<div class="detail-row notes"><div class="k">Summary (${escapeHtml(d.source || "IGDB")})</div><div class="v">${escapeHtml(text)}</div></div>` : "") +
    (tags ? `<div class="detail-row notes tag-row"><div class="k">Tags</div><div class="v">${tags}</div></div>` : "") +
    meta.join("") + shots + simHtml +
    igdbAttr(d);
}

// ---- cinematic hero ------------------------------------------------------
// A screenshot, blurred and dimmed, sits behind the cover and title; the numbers
// that matter become a stat strip. Built from the light enrichment immediately,
// then upgraded in place when the full detail lands.
function heroStatsHtml(row) {
  const e = ENRICH[row._k] || {};
  const pct = (v) => `${Math.round(v * 100)}`;
  const cells = [];
  const mine = row.rating != null ? row.rating : null;
  if (mine != null) cells.push([pct(mine), "Your rating", ratingClass(mine)]);
  const mc = metacriticOf(row);
  if (mc != null) cells.push([pct(mc), "Critics", ratingClass(mc)]);
  const ur = userRatingOf(row);
  if (ur != null) cells.push([pct(ur), "Players", ratingClass(ur)]);
  const pt = playtimeOf(row);
  if (pt != null) cells.push([fmtHours(pt), e.hltbBest != null ? "HowLongToBeat" : "Est. playtime", ""]);
  // The hours the platform itself counted — real, not estimated (see mine.js).
  if (typeof mineStatCells === "function") cells.push(...mineStatCells(row._k));
  const units = salesOf(row);
  if (units != null) cells.push([fmtUnits(units), "Units sold", ""]);
  const cv = collectionValueOf(row);
  if (cv != null) cells.push(["$" + cv.toFixed(0), "Value", ""]);
  // What we think YOU'd score it — only for games you haven't rated.
  const pred = typeof predictedCached === "function" ? predictedCached(row) : null;
  if (pred) cells.push([`~${Math.round(pred.score * 100)}`, "Predicted", ratingClass(pred.score)]);
  if (!cells.length) return "";
  return `<div class="hero-stats">` + cells.slice(0, 6).map(([v, l, cls]) =>
    `<div class="hero-stat"><b class="${cls}">${escapeHtml(String(v))}</b><span>${escapeHtml(l)}</span></div>`).join("") + `</div>`;
}

// Show the model's working. A prediction you can't interrogate is a horoscope.
// Each signal is a bar read against your own average, so it's obvious at a glance
// what pulled the number up and what dragged it down.
/* The prediction: a verdict, then the evidence.

   It used to be a four-column grid of tiny bars measured against a hairline you
   had to hover to identify, with values like "49 ×16" — model internals. The
   number is the most interesting thing on the card and it read like a debug view.

   The insight that reshaped it: "Compilation: 55" means nothing on its own. Is 55
   good? Only against YOUR average of 70. Every signal here is already a comparison,
   so print the comparison instead of making the reader compute it. */
function predictWhyHtml(row) {
  const p = typeof predictedCached === "function" ? predictedCached(row) : null;
  if (!p || !p.signals || !p.signals.length) return "";
  const base = p.baseline;                       // what you'd give an ordinary game TODAY
  // One baseline for everything the panel shows — the verdict, the up/down split, every bar, and
  // the foot line. Splitting the bars onto the all-time average let a factor read "above your
  // average" in its bar while the verdict, reading today's average, called it one you rate lower.
  const barBase = base;
  const conf = p.confidence >= 0.75 ? "high" : p.confidence >= 0.5 ? "fair" : "low";
  const pts = (v) => Math.round(v * 100);
  const delta = (v) => pts(v) - pts(barBase);

  // What the number MEANS, in a sentence. The signals already say which way each
  // one pulls; the verdict is just the sum of them, said out loud.
  const up = p.signals.filter((sg) => sg.value >= barBase);
  const down = p.signals.filter((sg) => sg.value < barBase);
  // The named factors MUST agree with the verdict. The verdict is the sign of the
  // overall gap (below), so lead by the same sign — not by which group is larger.
  // Picking the bigger group let a below-average prediction cite your ABOVE-average
  // factors and claim you "rate them lower", which is exactly backwards.
  const gap = pts(p.score) - pts(base);
  const lead = gap >= 0 ? up : down;
  /* Only things YOU rate can go in "you rate X higher" — the model also feeds on outside
     opinions, and naming one here produced "You rate Metacritic higher than most of what
     you own", then later "You rate User score higher". You don't rate Metacritic;
     Metacritic rates the game. The signal itself now says whether it's your taste
     (`taste: true`) rather than the UI guessing from its name, so the next outside source
     can't reintroduce this a third time. */
  const taste = lead.filter((sg) => sg.taste);
  const names = taste.slice(0, 2).map((sg) => sg.label).filter(Boolean);
  const critic = p.signals.find((sg) => sg.kind === "Critics");

  // Landing ON your average is not "better than your usual" — it's your usual.
  // Within a couple of points either way, the model is saying nothing much.
  let verdict;
  const headline = gap > 0 ? "Better than your usual." : "Below your usual.";
  if (Math.abs(gap) <= 2) {
    verdict = `<b>About your usual.</b> Nothing here pulls it far from your ${pts(base)}% average.`;
  } else if (!names.length) {
    // Nothing but the critic score to go on — so say that, rather than inventing
    // a taste signal we don't have.
    verdict = critic
      ? `<b>${headline}</b> Little to go on beyond the critics, who gave it ${pts(critic.value)}.`
      : `<b>${headline}</b> Not much to go on for this one.`;
  } else {
    const list = names.join(" and ");
    verdict = gap > 0
      ? `<b>${headline}</b> You rate ${list} higher than most of what you own.`
      : `<b>${headline}</b> You rate ${list} lower than most of what you own.`;
  }

  const rows = p.signals.map((sg) => {
    const d = delta(sg.value);
    // An outside opinion isn't a thing you've rated, so it doesn't get "N rated" — it
    // says who was doing the rating instead, and HOW MANY of them there were where the
    // source says. "IGDB players gave it 95" reads identically off two votes and off five
    // thousand; the model has always known the difference (it shrinks the number by the
    // count — see VOTE_K in predict.js) and the panel was the last place still hiding it.
    const who = sg.n != null
      ? `${escapeHtml(sg.label)} <span>(${sg.n.toLocaleString()})</span>`
      : escapeHtml(sg.label);
    const label = sg.taste
      ? `${escapeHtml(sg.label)}${sg.n ? ` <span>· ${sg.n} rated</span>` : ""}`
      : `${escapeHtml(sg.kind)} <span>· ${who} gave it ${pts(sg.value)}</span>`;
    return `<div class="vd-r">
      <span class="vd-t">${label}</span>
      <span class="vd-d ${d >= 0 ? "up" : "dn"}">${d >= 0 ? "+" : "−"}${Math.abs(d)} vs your average</span>
    </div>`;
  }).join("");

  const m = typeof tasteModel === "function" ? tasteModel() : {};
  const err = m && m.eval && m.eval.mae != null ? ` Model error: ±${(m.eval.mae * 100).toFixed(1)} points.` : "";

  return `<div class="vd">
    <div class="vd-top">
      <span class="vd-num ${ratingClass(p.score)}">${pts(p.score)}<small>%</small></span>
      <span class="vd-side">
        <span class="vd-eye">${icon("i-trend", 12)} You'd probably rate this</span>
        <span class="vd-say">${verdict}</span>
      </span>
      <span class="vd-conf vd-${conf}">${conf} confidence</span>
    </div>
    <div class="vd-why">${rows}</div>
    <p class="vd-foot">Your average across ${(m.n || 0).toLocaleString()} rated games is ${pts(base)}%.${err}</p>
  </div>`;
}

function heroHtml(row, titleText) {
  const cs = coverSrc(ENRICH[row._k], "cover_big");
  const pixel = coverIsPixelArt(ENRICH[row._k], cs) ? " pixel" : "";
  const cover = cs
    ? `<img class="cover-big${pixel}" id="heroCover" src="${escapeHtml(cs)}" alt="">`
    : coverPending(row)
      ? `<div class="cover-big skel" id="heroCover"></div>`
      : `<div class="cover-big ph" id="heroCover">${icon("i-library", 40)}</div>`;
  const bits = [row.platform, row.releaseYear || row.releaseDate || row.release, row.genre]
    .filter((x) => x != null && x !== "")
    .map((x) => `<span class="pill facet-link" data-fk="${x === row.platform ? "platform" : x === row.genre ? "genre" : "releaseYear"}" data-fv="${escapeHtml(String(x))}">${escapeHtml(String(x))}</span>`);
  // The pills can only carry the YEAR — that's the facet you can click. The exact day was
  // in the sheet all along and surfaced nowhere but the Raw data disclosure, so say it
  // here, in plain text, next to the year it belongs to.
  const relISO = row.releaseDate || row.release;
  const region = row.releaseRegion || row.region;
  // A wishlisted game may not be out yet — read the tense off the date so an
  // unreleased title says "Releases", not "Released … " in the past.
  const future = relISO && String(relISO).length > 4 && Date.parse(relISO) > Date.now();
  const relLine = relISO && String(relISO).length > 4
    ? `<div class="hero-rel">${future ? "Releases" : "Released"} ${escapeHtml(fmtDate(relISO))}${
        region ? ` <span class="muted">· ${escapeHtml(String(region))}</span>` : ""}</div>`
    : "";
  return `<div class="hero" id="drawerHero">
    <div class="hero-bg" id="heroBg"></div>
    <div class="hero-inner">
      ${cover}
      <div class="hero-txt">
        <h2>${titleText}</h2>
        <div class="subtitle">${bits.join("")}</div>
        ${relLine}
      </div>
    </div>
    <!-- Chips sit BELOW the cover+title row, not inside the text column: on a
         narrow screen they made that column taller than the cover, and the
         bottom-aligned cover then slid down past the title. -->
    <div id="heroChips"></div>
    ${heroStatsHtml(row)}
    ${predictWhyHtml(row)}
    ${launchHtml(row) ? `<div class="hero-actions">${launchHtml(row)}</div>` : ""}
  </div>`;
}

/* The rating boards' badges — the real artwork, not a lookalike.

   IGDB hands back a string ("ESRB M", "PEGI 18", "CERO Z") which maps straight onto an SVG
   in static/ratings/. These are the official marks: the boards each have a specific, fussy
   geometry (ESRB's split box, PEGI's notched shield, CERO's rounded lozenge) and a redrawn
   approximation reads as slightly wrong in a way that's hard to place but easy to see.

   Vector, so they stay crisp at any size, and they carry their own colours — a PEGI 18 that
   went grey in dark mode would not be a PEGI 18. Boards we have no art for (USK, GRAC, ACB,
   CLASS_IND) fall back to a plain drawn chip rather than a wrong picture. */
const AGE_ART = {
  "ESRB RP": "rp", "ESRB EC": "ec", "ESRB E": "e", "ESRB E10+": "e10",
  "ESRB T": "t", "ESRB M": "m", "ESRB AO": "ao",
};
const ESRB_WORD = {
  RP: "Rating Pending", EC: "Early Childhood", E: "Everyone", "E10+": "Everyone 10+",
  T: "Teen", M: "Mature 17+", AO: "Adults Only",
};

function ageArtSrc(rating) {
  const [board, ...rest] = String(rating || "").trim().split(/\s+/);
  const val = rest.join(" ");
  if (!board || !val) return null;
  if (board === "ESRB") {
    const slug = AGE_ART[`ESRB ${val}`];
    return slug ? `ratings/esrb-${slug}.svg` : null;
  }
  if (board === "PEGI" && ["3", "7", "12", "16", "18"].includes(val)) return `ratings/pegi-${val}.svg`;
  if (board === "CERO" && ["A", "B", "C", "D", "Z"].includes(val)) return `ratings/cero-${val.toLowerCase()}.svg`;
  if (board === "USK" && ["0", "6", "12", "16", "18"].includes(val)) return `ratings/usk-${val}.svg`;
  return null;
}

function ageBadgeHtml(rating) {
  if (!rating) return "";
  const [board, ...rest] = String(rating).trim().split(/\s+/);
  const val = rest.join(" ");
  if (!val) return "";
  const src = ageArtSrc(rating);
  const alt = board === "ESRB" ? `ESRB ${ESRB_WORD[val] || val}` : `${board} ${val}`;
  if (src) {
    return `<img class="age-art ${escapeHtml(board.toLowerCase())}" src="${escapeHtml(src)}"
      alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" loading="lazy">`;
  }
  // A board we have no artwork for: an honest chip beats a wrong picture.
  return `<span class="age-b gen" title="${escapeHtml(alt)}"><b>${escapeHtml(val)}</b><em>${escapeHtml(board)}</em></span>`;
}

function igdbAttr(d) {
  const name = d.source || "IGDB";
  const link = d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">View on ${escapeHtml(name)} ↗</a> · ` : "";
  const by = d.source
    ? `Metadata via ${escapeHtml(name)}`
    : `Metadata by <a href="https://www.igdb.com" target="_blank" rel="noopener">IGDB</a>`;
  return `<div class="igdb-attr">${link}${by}</div>`;
}

function mapControlHtml(key) {
  // Current mapping per source, so the boxes show what a game is already matched to.
  const d = DETAIL[key] || {};
  const primary = d.source ? String(d.source).toLowerCase() : (d.igdbId ? "igdb" : null);
  const cur = {
    igdb: primary === "igdb" ? d.url || "" : "",
    steam: primary === "steam" ? d.url || "" : "",
    ign: primary === "ign" ? d.url || "" : "",
    launchbox: primary === "launchbox" ? d.url || "" : "",
    keitai: primary === "keitai wiki" ? d.url || "" : "",
    hltb: (HLTBC[key] || {}).url || "",
    metacritic: (MCC[key] || {}).url || "",
    gameye: (GEC[key] || {}).url || "",
    arcadedb: (ADBC[key] || {}).url || "",
    vndb: (VNC[key] || {}).url || "",
    vgchartz: (VGC[key] || {}).url || "",
    steamx: (SXC[key] || {}).url || "",
    speedrun: (SRC[key] || {}).url || "",
    guides: (GDC[key] || {}).url || "",
    khinsider: (KHC[key] || {}).url || "",
  };
  // IGDB / Steam / IGN all fill the same "primary metadata" slot.
  const rows = [
    { id: "igdb", label: "Metadata · IGDB", ph: "IGDB game URL" },
    { id: "steam", label: "Metadata · Steam", ph: "Steam store URL (…/app/<id>/)" },
    { id: "ign", label: "Metadata · IGN", ph: "IGN game URL" },
    { id: "launchbox", label: "Metadata · LaunchBox", ph: "LaunchBox game URL" },
    // The only source that knows the Japanese feature phones, so it's the one you reach
    // for when a DoJa game's title on the wiki isn't the title in the sheet.
    { id: "keitai", label: "Metadata · Keitai Wiki", ph: "keitaiwiki.com/wiki/<page>" },
  ];
  // Every configured source gets a box. The auto-enrichment gates (VNDB only asks about
  // sheet-genre "Visual Novel"/"Adventure", Arcade Database only about MAME romsets, and
  // so on) decide who we ASK — they must not decide who you can MAP. Gating the fix-it
  // panel behind the same heuristic that made the mistake is what hid VNDB on Tōshin Toshi
  // II, a VN the sheet happens to file as a Dungeon Crawler. The panel is collapsed behind
  // "Fix mapping" anyway, so the cost of an extra row is nothing next to an unfixable game.
  if (ENRICH_SOURCES.includes("hltb")) rows.push({ id: "hltb", label: "HowLongToBeat", ph: "HLTB game URL" });
  if (ENRICH_SOURCES.includes("metacritic")) rows.push({ id: "metacritic", label: "Metacritic", ph: "Metacritic game URL" });
  if (ENRICH_SOURCES.includes("gameye")) rows.push({ id: "gameye", label: "GameEye value", ph: "GameEye encyclopedia URL" });
  if (ENRICH_SOURCES.includes("arcadedb")) rows.push({ id: "arcadedb", label: "Arcade Database", ph: "adb.arcadeitalia.net/?mame=<romset>" });
  if (ENRICH_SOURCES.includes("vndb")) rows.push({ id: "vndb", label: "VNDB", ph: "vndb.org/v<id>" });
  if (ENRICH_SOURCES.includes("vgchartz")) rows.push({ id: "vgchartz", label: "VGChartz sales", ph: "vgchartz.com/games/game.php?id=<id>" });
  // Steam extras are keyed on the appid, so mapping means pointing at the store page.
  if (ENRICH_SOURCES.includes("steamx")) rows.push({ id: "steamx", label: "Steam Deck / ProtonDB", ph: "store.steampowered.com/app/<appid>/" });
  if (ENRICH_SOURCES.includes("speedrun")) rows.push({ id: "speedrun", label: "speedrun.com", ph: "speedrun.com/<game>" });
  if (ENRICH_SOURCES.includes("cooptimus")) rows.push({ id: "cooptimus", label: "Co-Optimus", ph: "co-optimus.com/game/<id>/..." });
  if (ENRICH_SOURCES.includes("guides")) rows.push({ id: "guides", label: "StrategyWiki guide", ph: "strategywiki.org/wiki/<Page>" });
  if (ENRICH_SOURCES.includes("khinsider")) rows.push({ id: "khinsider", label: "KHInsider soundtrack", ph: "downloads.khinsider.com/game-soundtracks/album/<slug>" });
  // These two join on an id rather than a title (the Steam appid, the IGDB slug), so they
  // can't strictly be MIS-matched — but the id itself can be missing or point at the wrong
  // entry, so the escape hatch still earns its place.
  if (ENRICH_SOURCES.includes("pcgw")) rows.push({ id: "pcgw", label: "PCGamingWiki", ph: "pcgamingwiki.com/wiki/<Page>" });
  if (ENRICH_SOURCES.includes("wikidata")) rows.push({ id: "wikidata", label: "Wikidata", ph: "igdb.com/games/<slug>" });
  return `<details class="map-menu"><summary>${icon("i-edit", 13)} Fix mapping</summary>` +
    rows.map((s) => `<div class="map-src" data-src="${s.id}"><label>${escapeHtml(s.label)}</label>
      <div class="map-row"><input type="url" placeholder="${s.ph}" value="${escapeHtml(cur[s.id] || "")}" data-map-input>
      <button class="btn" data-map-go>Map</button>
      <button class="linkbtn" data-map-reset title="Re-run auto-matching">Auto</button>
      <button class="linkbtn danger" data-map-remove title="Pin as no match. Auto-matching won't re-fill it">Remove</button>
      </div></div>`).join("") +
    `</details>`;
}

function hltbHtml(h) {
  const est = drawerRow ? drawerRow.estimatedTime : null;
  if (h) {
    const rows = [["Main Story", h.main], ["Main + Extras", h.mainPlus], ["Completionist", h.hundred], ["All Styles", h.allStyles]]
      .filter(([, v]) => v != null);
    if (!rows.length && est == null) return "";
    return `<div class="hltb"><div class="hltb-head">⏱ HowLongToBeat</div>` +
      rows.map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${fmtHours(v)}</b></div>`).join("") +
      (h.url ? `<a class="hltb-link" href="${escapeHtml(h.url)}" target="_blank" rel="noopener">View on HowLongToBeat ↗</a>` : "") +
      `</div>`;
  }
  if (est != null)
    return `<div class="hltb"><div class="hltb-head">⏱ Playtime</div><div class="hltb-row"><span>Estimated (from sheet)</span><b>${fmtHours(est)}</b></div></div>`;
  return "";
}
