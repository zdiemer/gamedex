"use strict";

/* Recommendations — games you don't own, ranked by what you'd probably score them.
 *
 * Everything else in this app recommends out of the backlog, which can only re-rank what
 * you already bought. This is the other half: 25k games from the IGDB catalogue that the
 * sheet has never heard of, scored by the model in predict.js.
 *
 * TWO INDEPENDENT VOICES, and they answer different questions.
 *   the model    "what would you score this?" — your own ratings, generalised through
 *                IGDB's tags and the two outside opinions. It has an opinion about
 *                everything, and its honest error is 9.10 points (see predict.js).
 *   similar_games "IGDB says this is like something you loved" — recommend.py's
 *                IDF-weighted votes. It only speaks up for games actually adjacent to your
 *                favourites, but when it does it can say WHY, and "because you liked Yakuza
 *                0" is an argument in a way that "87%" never is.
 * A game both agree on is the strongest thing this tab has, so that's the default sort.
 *
 * WHAT IT CANNOT DO, said out loud rather than buried: the model is trained on games you
 * CHOSE to buy and rate. Asking it about a game you didn't choose is a different question
 * from the one it learned, and its error is much worse on obscure games than famous ones
 * (12.23 points under ten voters, 6.95 over a hundred — and 70% of the catalogue is under
 * ten). It can't reach the top of the list from there, because a game with no outside
 * opinion worth believing gets parked at your average rather than at 90% — but the
 * confidence bar is the honest reading, and it now knows the difference.
 *
 * Loaded after predict.js and catalogue.js; shares their globals. */

const recsState = { sort: "both", era: "", genre: "", minConf: 0, page: 1 };
const RECS_PAGE = 60;
let _recsRanked = null, _recsEpoch = -1, _recsSig = "";
let _recsBusy = false;

const RECS_SORTS = [
  { id: "both", label: "Best of both" },
  { id: "predicted", label: "Predicted rating" },
  { id: "because", label: "Because you liked…" },
];
const RECS_ERAS = [
  { id: "", label: "Any year" },
  { id: "2020", label: "2020s" }, { id: "2010", label: "2010s" },
  { id: "2000", label: "2000s" }, { id: "1990", label: "1990s" },
  { id: "old", label: "Before 1990" },
];

const recsDismissed = () => new Set(prefsLocal("dismissed"));

function recsDismiss(id) {
  const cur = prefsLocal("dismissed");
  if (cur.includes(id)) return;
  prefsSave("dismissed", [...cur, id]);
  _recsRanked = null;
  renderRecs();
}
function recsUndismissAll() {
  prefsSave("dismissed", []);
  _recsRanked = null;
  renderRecs();
}

/* The similar-games vote, by IGDB name. recommend.py hands back the games it recommends
   out of the BACKLOG; `catalogue` is the same machinery pointed at the games you don't own
   (see recommend.py's `pool`). Indexed by igdbId so it joins to a catalogue row exactly. */
function recsBecause() {
  const out = new Map();
  for (const r of (RECS && RECS.catalogue) || []) if (r.igdbId != null) out.set(r.igdbId, r);
  return out;
}

/* Score every catalogue game we don't own. ~25k rows through a 22-feature ridge — about a
   second, so it is done ONCE per enrichment epoch and cached, not per render. The epoch is
   the right key: the pool itself shrinks as enrichment matches more of the sheet. */
function recsRanked() {
  if (_recsRanked && _recsEpoch === _enrichEpoch) return _recsRanked;
  const because = recsBecause();
  const out = [];
  for (const row of catFresh()) {
    const p = predictedCached(row);
    if (!p) continue;
    const b = because.get(row.igdbId) || null;
    out.push({ row, p, because: b });
  }
  _recsEpoch = _enrichEpoch;
  return (_recsRanked = out);
}

function recsSorted() {
  const all = recsRanked();
  const dismissed = recsDismissed();
  let list = all.filter((x) => !dismissed.has(x.row.igdbId));
  if (recsState.era) {
    list = list.filter((x) => {
      const y = x.row.releaseYear;
      if (!y) return false;
      if (recsState.era === "old") return y < 1990;
      const d = +recsState.era;
      return y >= d && y < d + 10;
    });
  }
  if (recsState.genre) list = list.filter((x) => (x.row._igdb.genres || []).includes(recsState.genre));
  if (recsState.minConf) list = list.filter((x) => x.p.confidence >= recsState.minConf);

  const byPred = (a, b) => b.p.score - a.p.score;
  if (recsState.sort === "predicted") return list.sort(byPred);
  if (recsState.sort === "because") {
    return list.filter((x) => x.because).sort((a, b) => b.because.score - a.because.score);
  }
  /* "Best of both": the model's score, lifted by how hard the similar-games vote argues
     for it. Multiplicative on a small bonus rather than a blended rank — the prediction is
     a number in your own units and should stay one, and a game nothing vouches for should
     not be pushed DOWN the list for it (most of the catalogue has no vote at all; that is
     the vote being silent, not negative). */
  return list.sort((a, b) => recsBoth(b) - recsBoth(a));
}
const recsBoth = (x) => x.p.score * (1 + Math.min(0.15, (x.because ? x.because.score : 0) * 0.05));

const recsGenres = () => {
  const c = new Map();
  for (const x of recsRanked()) for (const g of x.row._igdb.genres || []) c.set(g, (c.get(g) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
};

function recsCard(x) {
  const { row, p, because } = x;
  const rec = row._igdb;
  const cs = coverSrc(rec, "cover_big");
  const cover = cs
    ? `<img class="card-cover" src="${escapeHtml(cs)}" alt="" loading="lazy">`
    : `<div class="card-cover ph">${icon("i-library", 26)}</div>`;
  const pct = Math.round(p.score * 100);
  const conf = p.confidence >= 0.75 ? "high" : p.confidence >= 0.5 ? "fair" : "low";
  // The single most-moved signal, as the one-line argument. "Because you liked X" wins
  // when it exists: a name you recognise beats a tag every time.
  const why = because
    ? `Like ${escapeHtml(because.because.slice(0, 2).join(" & "))}`
    : (p.signals[0] ? `${escapeHtml(p.signals[0].kind)}: ${escapeHtml(p.signals[0].label)}` : "");
  const votes = rec.userRatingCount;
  // The vote count is the honest caveat on the score beside it, so it goes ON the card
  // rather than in a tooltip: 27 voters and 5,827 voters produce the same-looking 82%.
  const meta = [row.releaseYear || null, votes != null ? `${votes.toLocaleString()} voted` : null]
    .filter(Boolean).join(" · ");
  return `<div class="rec" data-id="${row.igdbId}">
    <div class="rec-art">${cover}
      <span class="rec-score ${ratingClass(p.score)}">${pct}<small>%</small></span>
    </div>
    <div class="rec-body">
      <h3>${escapeHtml(String(row.title))}</h3>
      <div class="rec-meta">${escapeHtml(meta)}</div>
      ${why ? `<div class="rec-why">${why}</div>` : ""}
      <div class="rec-foot">
        <span class="rec-conf ${conf}"
              title="How much evidence is behind this number — ${conf} confidence">${conf}</span>
        <a class="rec-igdb" href="${escapeHtml(rec.url || "#")}" target="_blank" rel="noopener">IGDB ↗</a>
      </div>
    </div>
    <button class="rec-no" data-no="${row.igdbId}" title="Not interested" aria-label="Dismiss">✕</button>
  </div>`;
}

function renderRecs() {
  const host = $("#recs");
  if (!catEnabled()) {
    host.innerHTML = `<div class="rec-empty"><h2>Recommendations</h2>
      <p>The IGDB catalogue isn't enabled, so there's nothing to recommend from.
      Set <code>igdb.catalogue: true</code> and give the crawl a few minutes.</p></div>`;
    return;
  }
  if (!CAT) {
    // First visit. Say what's happening — this is a 2.2MB download, once a day per device.
    host.innerHTML = `<div class="rec-empty"><h2>Recommendations</h2>
      <p class="rec-load">${icon("i-sparkle", 16)} Fetching the IGDB catalogue…</p></div>`;
    if (!_recsBusy) {
      _recsBusy = true;
      ensureCatalogue().then(() => { _recsBusy = false; if (activeTab === "recs") renderRecs(); });
    }
    return;
  }
  if (CAT_ERROR || !CAT.length) {
    host.innerHTML = `<div class="rec-empty"><h2>Recommendations</h2>
      <p>${CAT_ERROR ? "Couldn't fetch the catalogue." : "The catalogue is still being built — check back shortly."}</p></div>`;
    return;
  }
  const m = tasteModel();
  if (!m.ok) {
    host.innerHTML = `<div class="rec-empty"><h2>Recommendations</h2>
      <p>Not enough rated games yet to predict anything (${m.n} of ${MIN_HISTORY}).</p></div>`;
    return;
  }

  const list = recsSorted();
  const shown = list.slice(0, recsState.page * RECS_PAGE);
  const dismissed = recsDismissed();
  const err = (m.igdb.eval.mae * 100).toFixed(1);

  const sel = (id, opts, cur) => `<select id="${id}">${opts.map((o) =>
    `<option value="${escapeHtml(o.id)}"${o.id === cur ? " selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}</select>`;

  host.innerHTML = `
    <div class="rec-head">
      <h2>${icon("i-sparkle", 20)} Recommendations</h2>
      <p class="rec-sub">${list.length.toLocaleString()} games IGDB knows about that aren't on your
        sheet, scored by your own ${m.n.toLocaleString()} ratings. This model is off by
        <b>${err} points</b> on average — it's fitted on what a game you don't own actually
        has, which is less than your sheet carries, so it's a little worse than the one on
        the Games tab. It's least sure about obscure games; the confidence tag says which.</p>
    </div>
    <div class="rec-bar">
      ${sel("recSort", RECS_SORTS, recsState.sort)}
      ${sel("recEra", RECS_ERAS, recsState.era)}
      ${sel("recGenre", [{ id: "", label: "Any genre" },
                         ...recsGenres().map((g) => ({ id: g, label: g }))], recsState.genre)}
      <label class="rec-conf-f"><input type="checkbox" id="recConf"${recsState.minConf ? " checked" : ""}>
        Only where I'm reasonably sure</label>
      ${dismissed.size ? `<button class="linkbtn" id="recUndo">Undo ${dismissed.size} dismissed</button>` : ""}
    </div>
    ${shown.length ? `<div class="rec-grid">${shown.map(recsCard).join("")}</div>` : `
      <div class="rec-empty"><p>Nothing matches those filters.</p></div>`}
    ${shown.length < list.length
      ? `<div class="rec-more"><button id="recMore">Show more (${(list.length - shown.length).toLocaleString()} left)</button></div>`
      : ""}`;

  $("#recSort").onchange = (e) => { recsState.sort = e.target.value; recsState.page = 1; renderRecs(); nav(); };
  $("#recEra").onchange = (e) => { recsState.era = e.target.value; recsState.page = 1; renderRecs(); nav(); };
  $("#recGenre").onchange = (e) => { recsState.genre = e.target.value; recsState.page = 1; renderRecs(); nav(); };
  $("#recConf").onchange = (e) => { recsState.minConf = e.target.checked ? 0.5 : 0; recsState.page = 1; renderRecs(); nav(); };
  const more = $("#recMore");
  if (more) more.onclick = () => { recsState.page++; renderRecs(); };
  const undo = $("#recUndo");
  if (undo) undo.onclick = recsUndismissAll;
  host.querySelectorAll("[data-no]").forEach((b) => {
    b.onclick = () => recsDismiss(+b.dataset.no);
  });
}

function resetRecs() { _recsRanked = null; _recsEpoch = -1; }
