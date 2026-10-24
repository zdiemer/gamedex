"use strict";

/* Cinematic drawer hero and its in-place enrichment updates. */

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
  // Not on a combined card: its _k is the lead copy's, so the lead's Steam clock
  // would pose as the group's number (drawer.js guards its pills the same way).
  const grouped = !!(row._members && row._members.length > 1);
  if (!grouped && typeof mineStatCells === "function") cells.push(...mineStatCells(row._k));
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
      <span class="vd-conf vd-${conf}">${conf}<span class="vd-conf-lbl"> confidence</span></span>
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
  // A group's platform is a joined label ("PS4 · PC · Switch") — as one facet
  // value it filters for a platform no row has, so the pill led to an empty
  // result. Pill each real platform instead; each click filters to that copy.
  const pill = (fk, v) => `<span class="pill facet-link" data-fk="${fk}" data-fv="${escapeHtml(String(v))}">${escapeHtml(String(v))}</span>`;
  const plats = row._platforms && row._platforms.length > 1 ? row._platforms
    : row.platform != null && row.platform !== "" ? [row.platform] : [];
  const year = row.releaseYear || row.releaseDate || row.release;
  const bits = [
    ...plats.map((p) => pill("platform", p)),
    ...(year != null && year !== "" ? [pill("releaseYear", year)] : []),
    ...(row.genre != null && row.genre !== "" ? [pill("genre", row.genre)] : []),
  ];
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

function fillHero(detail) {
  const bg = $("#heroBg"), coverEl = $("#heroCover"), chipsEl = $("#heroChips");
  if (!detail) return;
  // Artwork first: it's cinematic key art, made to be looked at. A screenshot is
  // a fallback — it's a picture of a HUD. Ask for the big version: this is a
  // full-bleed banner now, not a blurred wash, so a low-res source would show.
  const art = (detail.artworks || [])[0] || (detail.screenshots || [])[0];
  if (bg && art) {
    const img = new Image();          // fade it in only once it's actually there
    img.onload = () => {
      bg.style.backgroundImage = `url("${IMG(art, "1080p")}")`;
      bg.classList.add("on");
    };
    img.src = IMG(art, "1080p");
  }
  const cs = coverSrc(detail, "cover_big");
  if (coverEl && cs && coverEl.tagName !== "IMG") {
    const img = document.createElement("img");
    img.className = "cover-big"; img.id = "heroCover"; img.alt = ""; img.src = cs;
    coverEl.replaceWith(img);
  }
  // Chips moved out of the hero: they crowded the cover and title, and the IGDB
  // score chip repeated the "Players" figure already in the stat strip. They live
  // under the summary now, which is where you're reading about the game anyway.
  if (chipsEl) chipsEl.innerHTML = "";
}
