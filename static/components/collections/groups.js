"use strict";

// UI components for groups.js. Feature state and orchestration remain in that module.

// ---- aggregates ----------------------------------------------------------

// The group's numbers, as the same stat strip the game drawer uses.
function groupStatsHtml(s) {
  const pct = (v) => String(Math.round(v * 100));
  const cells = [];
  if (s.avgRating != null) cells.push([pct(s.avgRating), `Your rating · ${s.nRated} rated`, ratingClass(s.avgRating)]);
  if (s.avgCritic != null) cells.push([pct(s.avgCritic), "Critics", ratingClass(s.avgCritic)]);
  if (s.played > 0) cells.push([fmtHours(s.played), "You've played", ""]);
  if (s.left > 0) cells.push([fmtHours(s.left), "Left to beat", ""]);
  if (s.spent > 0) cells.push(["$" + Math.round(s.spent), "Spent", ""]);
  if (s.y0) cells.push([s.y0 === s.y1 ? String(s.y0) : `${s.y0}–${s.y1}`, "Span", ""]);
  if (!cells.length) return "";
  return `<div class="hero-stats fr-stats">` + cells.map(([v, l, cls]) =>
    `<div class="hero-stat"><b class="${cls}">${escapeHtml(String(v))}</b><span>${escapeHtml(l)}</span></div>`
  ).join("") + `</div>`;
}

// One line of it for the index card — the two that tell you most at a glance.
function groupCardStats(s) {
  const bits = [];
  if (s.avgRating != null) bits.push(`<span class="${ratingClass(s.avgRating)}">${Math.round(s.avgRating * 100)}%</span> avg`);
  if (s.played > 0) bits.push(`${fmtHours(s.played)} played`);
  else if (s.left > 0) bits.push(`${fmtHours(s.left)} left`);
  return bits.length ? `<span class="muted fr-mini">${bits.join(" · ")}</span>` : "";
}

function groupCardHtml(s) {
  const best = groupBest(s);
  // A group has no art of its own, so it borrows from a member — and it should borrow from
  // YOUR favourite, not from whichever one happened to sort first.
  const art = (best && coverSrc(ENRICH[best._k], "cover_small") ? best : null)
    || s.games.find((g) => coverSrc(ENRICH[g._k], "cover_small"))
    || s.games[0];
  const cs = art ? coverSrc(ENRICH[art._k], "cover_big") : "";
  const complete = s.done === s.games.length;
  return `<button class="fr-card${complete ? " done" : ""}" data-fr="${escapeHtml(s.name)}" data-fk="${escapeHtml(String((art && art._k) || ""))}">
    ${cs ? `<img class="fr-art" loading="lazy" src="${escapeHtml(cs)}" alt="">` : `<span class="fr-art ph">${icon("i-library", 22)}</span>`}
    <span class="fr-body">
      <b>${escapeHtml(s.name)}</b>
      <span class="muted">${s.done} of ${s.games.length} completed${s.owned ? ` · ${s.owned} owned` : ""}</span>
      ${groupCardStats(s)}
      <span class="ch-bar"><span style="width:${(s.pct * 100).toFixed(1)}%"></span></span>
    </span>
    ${complete ? `<span class="fr-done">✓</span>` : ""}
  </button>`;
}

/* The best thing in the group, on the group's own page. Not a pill in a list — the whole
   point of opening a series is remembering what it meant, so give it the cover, the score,
   and what I actually wrote about it at the time. The review lives on the Completed sheet,
   which historyOf() already joins for the drawer. */
function groupFavHtml(s) {
  const best = groupBest(s);
  if (!best) return "";
  const i = s.games.indexOf(best);
  const cs = coverSrc(ENRICH[best._k], "cover_big");
  const h = typeof historyOf === "function" ? historyOf(best) : {};
  const bits = [best.platform, best.releaseYear].filter(Boolean).map(String).map(escapeHtml).join(" · ");
  const when = h.finished ? `Finished ${escapeHtml(fmtDate(h.finished))}` : "";
  const played = h.playTime != null ? `${escapeHtml(fmtHours(h.playTime))} played` : "";
  const meta = [bits, when, played].filter(Boolean).join(" · ");
  const review = h.review ? String(h.review) : "";
  return `<div class="fr-fav">
    <span class="h-eyebrow">${icon("i-star", 13)} Your favorite here</span>
    <button class="fr-fav-card" data-fg="${escapeHtml(String(best._k || ""))}" data-fi="${i}">
      ${cs ? `<img class="fr-fav-art" loading="lazy" src="${escapeHtml(cs)}" alt="">`
           : `<span class="fr-fav-art ph">${icon("i-library", 22)}</span>`}
      <span class="fr-fav-b">
        <b>${escapeHtml(String(best.title || best.game || ""))}</b>
        <span class="muted">${meta}</span>
        ${review ? `<q class="fr-fav-q">${escapeHtml(review)}</q>` : ""}
      </span>
      <span class="fr-fav-score ${ratingClass(best.rating)}">
        <b>${Math.round(best.rating * 100)}</b><i>my rating</i>
      </span>
    </button>
  </div>`;
}

function groupGameRow(g, i) {
  const cs = coverSrc(ENRICH[g._k], "cover_small");
  /* "alt" is the state the sheet has no column for: you never finished THIS row, but you
     finished the game — on another machine, in a remaster, out of a compilation. A dimmed
     tick rather than a green one, because it isn't this copy you beat, and hovering says
     which one was. It's also what explains why Play next stepped over this line. */
  const other = g.completed ? null
    : (typeof alreadyPlayed === "function" ? alreadyPlayed(g) : null);
  const state = g.completed ? "done" : g.playingStatus ? "playing"
    : other ? "alt" : g.owned ? "owned" : "missing";
  const mark = { done: "✓", playing: "▶", alt: "✓", owned: "•", missing: "" }[state];
  const why = other ? ` title="${altWhy(other).replace(/^you/, "You")}"` : "";
  const bits = [g.platform, g.releaseYear].filter(Boolean).map((x) => escapeHtml(String(x))).join(" · ");
  const score = g.rating != null
    ? `<span class="${ratingClass(g.rating)}">${Math.round(g.rating * 100)}</span>` : "";
  /* Your time if you finished it, an estimate if you haven't. playtimeOf() is an ESTIMATE
     (HowLongToBeat, else VNDB, else the sheet's guess) — the right answer for a game still in
     the backlog, the wrong one for a game you beat and wrote a time down for.

     A finished game with no recorded time still falls back to the estimate (Health flags the
     ~700 of them). The ~ marks it, so a guess can never be read as a measurement. */
  const mine = playedHoursOf(g);
  const t = mine != null ? mine : playtimeOf(g);
  const time = t == null ? "" :
    `<span class="muted" title="${mine != null ? "Your completion time" : "Estimated time to beat"}">${
      mine != null ? "" : "~"}${escapeHtml(fmtHours(t))}</span>`;
  return `<button class="fr-game fr-${state}" data-fg="${escapeHtml(String(g._k || ""))}" data-fi="${i}">
    <span class="fr-mark"${why}>${mark}</span>
    ${cs ? `<img loading="lazy" src="${escapeHtml(cs)}" alt="">` : `<span class="fr-ph">${icon("i-library", 16)}</span>`}
    <span class="fr-game-t"><b>${escapeHtml(String(g.title))}</b><span class="muted">${bits}</span></span>
    <span class="fr-game-x">${time}${score}</span>
  </button>`;
}

// ---- render --------------------------------------------------------------
function renderGroups() {
  const end = typeof gamedexPerf !== "undefined" ? gamedexPerf.start("renderGroups", activeTab) : () => {};
  try { return _renderGroups(); } finally { end(); }
}

function _renderGroups() {
  const host = $("#groups");
  if (!DATA) return;

  if (!groupState.kind) return renderGroupMenu(host);

  const g = grouping(groupState.kind);
  if (!g) { groupState.kind = null; return renderGroups(); }
  const all = grGroups(g.id);

  // ---- one group ----
  if (groupState.open) {
    const s = all.find((x) => x.name === groupState.open) ||
      groupIndex(g.id).find((x) => x.name === groupState.open);
    if (!s) { groupState.open = null; return renderGroups(); }
    host.innerHTML =
      `<div class="fr-detail">
        <button class="ch-back" id="grBack">← All ${escapeHtml(g.units)}</button>
        <div class="fr-head">
          <div>
            <span class="h-eyebrow">${glyph(g.icon, 14)} ${escapeHtml(g.label)}</span>
            <h1>${escapeHtml(s.name)}</h1>
            <p class="muted">${s.games.length} games · ${s.done} completed · ${s.owned} owned</p>
            <div class="ch-bar big" style="margin:14px 0 0"><span style="width:${(s.pct * 100).toFixed(1)}%"></span></div>
          </div>
          ${typeof chRing === "function" ? chRing(s.pct, 84) : ""}
        </div>
        ${groupStatsHtml(s)}
        ${groupFavHtml(s)}
        ${s.next ? `<div class="fr-next">
          <span class="h-eyebrow">Play next</span>
          ${groupGameRow(s.next, s.games.indexOf(s.next))}
          ${s.skipped ? `<p class="fr-skip muted">Skipping ${escapeHtml(String(s.skipped.game.title))}${
            s.skipped.game.platform ? ` (${escapeHtml(String(s.skipped.game.platform))})` : ""
          } — ${altWhy(s.skipped.played)}.</p>` : ""}
        </div>` : s.allPlayed ? `<div class="fr-next">
          <span class="h-eyebrow">Play next</span>
          <p class="fr-skip muted">Nothing new left — every unfinished game here is one
             you've already played in another form.</p>
        </div>` : ""}
        <h2 class="ch-sec">In release order</h2>
        <div class="fr-games">${s.games.map((x, i) => groupGameRow(x, i)).join("")}</div>
      </div>`;
    $("#grBack").onclick = () => { groupState.open = null; renderGroups(); nav(); };
    host.querySelectorAll("[data-fg]").forEach((el) => {
      el.onclick = () => { const x = s.games[+el.dataset.fi]; if (x) openDrawer(x, "games"); };
    });
    host.scrollTop = 0;
    return;
  }

  // ---- the index for one axis ----
  const q = groupState.q.toLowerCase().trim();
  const sorted = (list) => list.slice().sort((GROUP_SORTS[groupState.sort] || GROUP_SORTS.size).cmp);
  const shown = sorted(all.filter((s) => !q || s.name.toLowerCase().includes(q)));
  const finished = all.filter((s) => s.done === s.size).length;

  host.innerHTML =
    `<div class="fr-index-head">
      <button class="ch-back" id="grHome">← All groupings</button>
      <h1>${glyph(g.icon, 24)} ${escapeHtml(g.label)}</h1>
      <p>${all.length.toLocaleString()} ${escapeHtml(g.units)} with ${MIN_GROUP}+ games · ${finished.toLocaleString()} completed end to end.</p>
      <div class="rev-controls">
        ${searchField("grQ", `Find a ${g.units.replace(/e?s$/, "")}…`, groupState.q)}
        <label class="ctl">Sort
          <select id="grSort">${Object.entries(GROUP_SORTS).map(([k, v]) =>
            `<option value="${k}"${k === groupState.sort ? " selected" : ""}>${escapeHtml(v.label)}</option>`).join("")}</select>
        </label>
        <span class="muted">${shown.length.toLocaleString()} shown</span>
      </div>
    </div>
    <div class="fr-grid">${shown.slice(0, 120).map(groupCardHtml).join("")}</div>` +
    (shown.length > 120 ? `<p class="hz-more">Showing the first 120 of ${shown.length.toLocaleString()}.</p>` : "");

  $("#grHome").onclick = () => { groupState.kind = null; groupState.q = ""; renderGroups(); nav(); };
  const qi = $("#grQ");
  qi.oninput = () => {
    // Repaint the grid only — replacing the input would drop focus mid-word.
    groupState.q = qi.value;
    const q2 = groupState.q.toLowerCase().trim();
    $(".fr-grid").innerHTML = sorted(all.filter((s) => !q2 || s.name.toLowerCase().includes(q2)))
      .slice(0, 120).map(groupCardHtml).join("");
    wireGroupCards(host);
  };
  $("#grSort").onchange = (e) => { groupState.sort = e.target.value; renderGroups(); };
  wireGroupCards(host);
}

// The landing page: choose an axis. Each tile shows how many groups that axis
// yields and names the biggest few, so the choice isn't blind.
function renderGroupMenu(host) {
  const tiles = GROUPINGS.map((g) => {
    const all = groupMembers(g.id).filter(s => s.size >= MIN_GROUP);
    const top = all.slice().sort((a, b) => b.size - a.size).slice(0, 3);
    const done = all.filter((s) => s.done === s.size).length;
    return `<button class="gr-tile" data-gk="${escapeHtml(g.id)}">
      <span class="gr-icon">${glyph(g.icon, 26)}</span>
      <span class="gr-tile-b">
        <b>${escapeHtml(g.label)}</b>
        <span class="gr-n">${all.length.toLocaleString()} ${escapeHtml(g.units)}${done ? ` · ${done.toLocaleString()} completed` : ""}</span>
        <span class="muted">${escapeHtml(g.blurb)}</span>
        <span class="gr-eg">${top.map((s) =>
          `<span>${escapeHtml(s.name)} <i>${s.size}</i></span>`).join("")}</span>
      </span>
      <span class="gr-go">→</span>
    </button>`;
  }).join("");

  host.innerHTML =
    `<div class="fr-index-head">
      <h1>Collections</h1>
      <p>Your collection, cut along whichever axis you care about. Each collection shows what you own,
         what you've completed, how far through you are, and what to play next.</p>
    </div>
    <div class="gr-tiles">${tiles}</div>`;

  host.querySelectorAll("[data-gk]").forEach((el) => {
    el.onclick = () => { groupState.kind = el.dataset.gk; groupState.open = null; groupState.q = ""; renderGroups(); nav(); };
  });
}

// Enrichment lands after the first paint; fill the art in place rather than
// re-rendering the grid.
function patchGroupCovers() {
  const host = $("#groups");
  if (!host || host.hidden) return;
  host.querySelectorAll("[data-fk]").forEach((el) => {
    const ph = el.querySelector(".fr-art.ph");
    if (!ph) return;
    const cs = coverSrc(ENRICH[el.dataset.fk], "cover_big");
    if (!cs) return;
    const img = document.createElement("img");
    img.className = "fr-art"; img.loading = "lazy"; img.alt = ""; img.src = cs;
    ph.replaceWith(img);
  });
  host.querySelectorAll("[data-fg]").forEach((el) => {
    const ph = el.querySelector(".fr-ph");
    if (!ph) return;
    const cs = coverSrc(ENRICH[el.dataset.fg], "cover_small");
    if (!cs) return;
    const img = document.createElement("img");
    img.loading = "lazy"; img.alt = ""; img.src = cs;
    ph.replaceWith(img);
  });
}
