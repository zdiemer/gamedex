"use strict";

/* The Stats tab: hand-rolled SVG, no chart library.

   The primitives at the top (svgBarsH/svgBarsV/svgDonut) are deliberately dumb --
   they take data and return a string. Anything that needs a real axis or a
   tooltip is in charts.js, which renders bars as HTML instead; see its header for
   why. Year-in-review and the backlog burn-down are the two views built on top. */

// ---- Stats dashboard (hand-rolled SVG, no deps) -------------------------
const PALETTE = ["#7c5cff", "#22d3ee", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#fb923c", "#a78bfa", "#2dd4bf", "#f87171", "#e879f9", "#facc15"];
function countBy(arr) {
  const m = new Map();
  for (const v of arr) { if (v == null || v === "") continue; m.set(v, (m.get(v) || 0) + 1); }
  return m;
}
function topCounts(arr, n) {
  return [...countBy(arr).entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, value]) => ({ label, value }));
}
function svgBarsH(data, width = 340, barH = 20, gap = 7, fmt = (v) => v.toLocaleString()) {
  if (!data.length) return `<div class="s-empty">No data</div>`;
  const max = Math.max(1, ...data.map((d) => d.value));
  const labelW = 130, valW = 52, chartW = width - labelW - valW, h = data.length * (barH + gap);
  let y = 0, out = "";
  data.forEach((d, i) => {
    const w = Math.max(2, chartW * d.value / max);
    out += `<g transform="translate(0,${y})"><text x="${labelW - 6}" y="${barH / 2}" dy="0.35em" text-anchor="end" class="s-lbl">${escapeHtml(String(d.label))}</text>` +
      `<rect x="${labelW}" y="1" width="${w.toFixed(1)}" height="${barH - 2}" rx="3" fill="${PALETTE[i % PALETTE.length]}"/>` +
      `<text x="${(labelW + w + 5).toFixed(1)}" y="${barH / 2}" dy="0.35em" class="s-val">${escapeHtml(fmt(d.value))}</text></g>`;
    y += barH + gap;
  });
  return `<svg viewBox="0 0 ${width} ${h}" class="s-svg" preserveAspectRatio="xMinYMin meet">${out}</svg>`;
}
function svgBarsV(data, width = 360, height = 170, color = PALETTE[0]) {
  if (!data.length) return `<div class="s-empty">No data</div>`;
  const max = Math.max(1, ...data.map((d) => d.value)), n = data.length, bw = width / n;
  let out = "";
  data.forEach((d, i) => {
    const bh = (height - 26) * d.value / max;
    out += `<g transform="translate(${(i * bw).toFixed(1)},0)">` +
      `<rect x="${(bw * 0.15).toFixed(1)}" y="${(height - 26 - bh).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"/>` +
      `<text x="${(bw / 2).toFixed(1)}" y="${height - 9}" text-anchor="middle" class="s-axis">${escapeHtml(String(d.label))}</text>` +
      (d.value ? `<text x="${(bw / 2).toFixed(1)}" y="${(height - 28 - bh).toFixed(1)}" text-anchor="middle" class="s-val">${d.value}</text>` : "") + `</g>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" class="s-svg">${out}</svg>`;
}
function svgDonut(segments, size = 150) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1, r = size / 2, rin = r * 0.58;
  let a0 = -Math.PI / 2, paths = "";
  segments.forEach((s, i) => {
    if (!s.value) return;
    const a1 = a0 + 2 * Math.PI * s.value / total, large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => [(r + rad * Math.cos(ang)).toFixed(2), (r + rad * Math.sin(ang)).toFixed(2)];
    const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r), [xi0, yi0] = p(a1, rin), [xi1, yi1] = p(a0, rin);
    paths += `<path d="M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${xi0},${yi0} A${rin},${rin} 0 ${large} 0 ${xi1},${yi1} Z" fill="${PALETTE[i % PALETTE.length]}"/>`;
    a0 = a1;
  });
  const legend = segments.filter((s) => s.value).map((s, i) =>
    `<div class="s-leg"><span style="background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(String(s.label))} <b>${s.value}</b></div>`).join("");
  return `<div class="s-donut-wrap"><svg viewBox="0 0 ${size} ${size}" class="s-donut">${paths}</svg><div class="s-legend">${legend}</div></div>`;
}
// A numeric value counts up on scroll-in (data-n); anything else renders as-is.
/* A stat card. Eleven of these used to be identical — same size, same accent
   gradient on every number — so nothing led and nothing receded, and the accent
   was doing the job state colour should do.

   opts.tone   "lead" | "good" | "warn" | "" — colour carries MEANING now.
   opts.icon   an icon id, set back in the corner.
   opts.sub    the line under the number that says what it's of. */
const statCard = (v, l, pre = "", post = "", opts = {}) => {
  const { tone = "", icon: ic = "", sub = "" } = opts;
  const num = typeof v === "number" && isFinite(v);
  const body = num
    ? `<div class="s-num" data-n="${v}" data-pre="${escapeHtml(pre)}" data-post="${escapeHtml(post)}">${escapeHtml(pre)}0${escapeHtml(post)}</div>`
    : `<div class="s-num">${v == null ? "—" : escapeHtml(String(v))}</div>`;
  return `<div class="stat-card${tone ? " t-" + tone : ""}">
    ${ic ? `<span class="s-ico">${icon(ic, 15)}</span>` : ""}
    ${body}
    <div class="s-cap">${escapeHtml(l)}</div>
    ${sub ? `<div class="s-sub">${escapeHtml(sub)}</div>` : ""}
  </div>`;
};
const last = (pts) => (pts && pts.length ? pts[pts.length - 1].value.toLocaleString() : "0");

const statPanel = (title, body, cls = "", note = "") =>
  `<div class="stat-panel ${cls}"><h3>${escapeHtml(title)}</h3>${
    note ? `<p class="s-note">${escapeHtml(note)}</p>` : ""}${body}</div>`;

const usd = (v) => "$" + Math.round(v).toLocaleString();
const yr2 = (y) => `'${String(y).slice(2)}`;
const yearOf = (iso) => (typeof iso === "string" && /^\d{4}/.test(iso) ? +iso.slice(0, 4) : null);
const bucketize = (data, buckets, val) => buckets.map(([label, lo, hi]) => ({ label, value: data.filter((r) => { const v = val(r); return v != null && v >= lo && v < hi; }).length }));

// ---- Year in review + backlog burn-down ---------------------------------
// The Stats tab is split into sub-pages: the page used to be one enormous scroll
// that re-rendered ~40 charts on every visit. `section` says which sub-page is
// showing; it rides in the URL (?s=) like the other special tabs' sub-state.
const statsState = { year: null, section: "overview" };
const STATS_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "year", label: "Year in Review" },
  { id: "completed", label: "Completed" },
  { id: "backlog", label: "Backlog" },
  { id: "purchases", label: "Purchases & Value" },
  { id: "reviews", label: "Reviews" },
];
const STATS_NAV_BLURB = {
  year: "Your year in games. A heatmap, the best of what you played, and the backlog burn-down.",
  completed: "Everything you've completed: playthroughs, your taste, and you against the critics.",
  backlog: "What's left to play, by platform, genre, length and status.",
  purchases: "Spending, collection value, and how long games sit before you play them.",
  reviews: "The words behind your scores, and how well the rating model does.",
};

// Counts of a field, as bars that filter that tab when clicked. A bar is a pile
// of games; say which ones — a count you can't interrogate is just a number.
// Shared by the Completed / Backlog / Purchases sections, so it lives here.
const statNameOf = (r) => String(r.game || r.title || "");
const countBars = (src, field, n, tab) =>
  topCounts(src.map((r) => r[field]), n).map((d) => {
    const members = src.filter((r) => r[field] === d.label);
    return { ...d, link: facetLink(tab, field, d.label),
             tip: tipList(`${d.label} · ${d.value.toLocaleString()} games`, members.map(statNameOf), members.length) };
  });

// A stats sub-section header + its grid of panels.
const sect = (title, panels) =>
  `<h2 class="stat-sec"><span>${escapeHtml(title)}</span><i>${panels.length}</i></h2>` +
  `<div class="stat-grid">${panels.join("")}</div>`;

// The pill sub-nav shown atop every Stats sub-page.
const statsNav = () =>
  `<nav class="stats-nav">` + STATS_SECTIONS.map((s) =>
    `<button class="stats-nav-pill${statsState.section === s.id ? " active" : ""}" data-ssec="${s.id}">${escapeHtml(s.label)}</button>`
  ).join("") + `</nav>`;

// The Overview landing: headline cards + a card per other sub-page.
const statsNavGrid = () =>
  `<div class="stats-navgrid">` + STATS_SECTIONS.filter((s) => s.id !== "overview").map((s) =>
    `<button class="stats-navcard" data-ssec="${s.id}">
      <span class="stats-navcard-t">${escapeHtml(s.label)}</span>
      <span class="stats-navcard-d">${escapeHtml(STATS_NAV_BLURB[s.id] || "")}</span>
      <span class="stats-navcard-c" aria-hidden="true">›</span>
    </button>`).join("") + `</div>`;
let VALUE_HISTORY = null;          // [{day,total,games,priced}] — daily snapshots
let RECS = null;                   // "because you liked …" (see src/recommend.py)

async function loadRecs() {
  try {
    const res = await fetch("api/recommendations");
    const j = await res.json();
    RECS = j.items || [];
    if (activeTab === "home") renderHome();
  } catch (_) { RECS = []; }
}

// GameEye only knows today's price, so the trend has to be recorded as it
// happens (see enrich.snapshot_value). One point per day; useless on day one.
async function loadValueHistory() {
  try {
    const res = await fetch("api/value-history");
    const j = await res.json();
    VALUE_HISTORY = j.history || [];
    if (activeTab === "stats" && VALUE_HISTORY.length > 1) renderStats();
  } catch (_) { VALUE_HISTORY = []; }
}

function yearInReview(rows, games) {
  const years = [...new Set(rows.map((r) => yearOf(r.date)).filter(Boolean))].sort((a, b) => b - a);
  if (!years.length) return "";
  if (statsState.year == null || !years.includes(statsState.year)) statsState.year = years[0];
  const y = statsState.year;
  const mine = rows.filter((r) => yearOf(r.date) === y);
  const prev = rows.filter((r) => yearOf(r.date) === y - 1);

  const hours = mine.reduce((a, r) => a + (r.playTime || 0), 0);
  const rated = mine.filter((r) => r.rating != null);
  const avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : null;
  const best = rated.slice().sort((a, b) => b.rating - a.rating)[0];
  const worst = rated.slice().sort((a, b) => a.rating - b.rating)[0];
  const longest = mine.filter((r) => r.playTime).sort((a, b) => b.playTime - a.playTime)[0];
  const delta = prev.length ? mine.length - prev.length : null;
  const deltaTxt = delta == null ? "" :
    `<span class="yr-delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} vs ${y - 1}</span>`;

  const gameChip = (r, label) => r
    ? `<button class="yr-game" data-yg="${escapeHtml(String(r._k || ""))}">
         <span class="yr-game-l">${escapeHtml(label)}</span>
         <b>${escapeHtml(String(r.game))}</b>
         <span class="muted">${r.rating != null ? Math.round(r.rating * 100) + "%" : ""}${r.playTime ? ` · ${fmtHours(r.playTime)}` : ""}</span>
       </button>` : "";

  // Day-by-day, not month-by-month: monthly bars hid the fact that completions
  // come in bursts.
  const byDay = {}, gamesByDay = {};
  mine.forEach((r) => {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(r.date))) return;
    const d = String(r.date).slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
    (gamesByDay[d] = gamesByDay[d] || []).push(String(r.game));
  });
  // A count tells you a day was busy; the names tell you what the day WAS.
  const dayTip = (iso, n) => tipList(`${fmtDate(iso)} · ${n} completed`, gamesByDay[iso] || []);
  // Land on that day in the Completed timeline, neighbours intact (timeline.js).
  const showDay = (iso) => timelineJumpToDay(iso);
  // Best and worst come off the same ranking, and the worst row only gets what
  // the best row didn't take: a thin year has no worst, rather than the same
  // games standing under both headings.
  const ranked = rated.slice().sort((a, b) => b.rating - a.rating);
  const top = ranked.slice(0, 10);
  const bottom = ranked.slice(Math.max(top.length, ranked.length - 10)).reverse();

  return `<section class="yr">
    <div class="yr-head">
      <h2>${y} in review</h2>
      <label class="ctl">Year
        <select id="yrPick">${years.map((v) => `<option value="${v}"${v === y ? " selected" : ""}>${v}</option>`).join("")}</select>
      </label>
    </div>
    <div class="yr-grid">
      <div class="yr-cards">
        ${statCard(mine.length, "Games finished")}
        ${statCard(Math.round(hours), "Hours played", "", "h")}
        ${statCard(avg != null ? Math.round(avg * 100) : null, "Avg rating", "", "%")}
        ${statCard(mine.filter((r) => r.vr).length, "In VR")}
      </div>
      ${deltaTxt}
      <div class="yr-games">
        ${gameChip(best, "Favorite")}
        ${gameChip(longest, "Longest")}
        ${gameChip(worst, "Least favorite")}
      </div>
    </div>
    ${statPanel(`Every day of ${y}`, heatmap(byDay, y, { onDay: showDay, tipFor: dayTip }), "wide")}
    ${statPanel(`The best of ${y}`, posterRow(top, { note: (r) => `${Math.round(r.rating * 100)}%` }), "wide")}
    ${bottom.length ? statPanel(`The worst of ${y}`, posterRow(bottom, { note: (r) => `${Math.round(r.rating * 100)}%` }), "wide") : ""}
    ${statPanel(`What you played in ${y}`, barsH(topCounts(mine.map((r) => r.genre), 7)))}
    ${statPanel(`Where you played in ${y}`, barsH(topCounts(mine.map((r) => r.platform), 8)))}
  </section>`;
}

// At your recent pace, how long does the backlog actually take?
function burnDown(rows, games) {
  const years = [...new Set(rows.map((r) => yearOf(r.date)).filter(Boolean))].sort((a, b) => b - a);
  const recent = years.slice(0, 3);
  if (!recent.length) return "";
  const rate = recent.reduce((a, y) => a + rows.filter((r) => yearOf(r.date) === y).length, 0) / recent.length;
  const backlog = games.filter((r) => !r.completed).length;
  const yrs = rate ? backlog / rate : Infinity;
  const now = new Date().getFullYear();

  // The same backlog, if you were choosier about length.
  const scen = [
    ["Everything", backlog],
    ["Under 20h only", games.filter((r) => !r.completed && (playtimeOf(r) ?? 99) < 20).length],
    ["Under 10h only", games.filter((r) => !r.completed && (playtimeOf(r) ?? 99) < 10).length],
    ["Under 5h only", games.filter((r) => !r.completed && (playtimeOf(r) ?? 99) < 5).length],
    ["Owned only", games.filter((r) => !r.completed && r.owned).length],
  ].map(([label, n]) => ({ label, value: Math.round(n / rate), n }));

  return `<section class="yr">
    <div class="yr-head"><h2>Backlog burn-down</h2></div>
    <p class="yr-note">You finished <b>${Math.round(rate)}</b> games a year over ${recent.length === 1 ? "the last year" : `${recent.length} years`}.
      At that pace the <b>${backlog.toLocaleString()}</b>-game backlog runs out in
      <b>${isFinite(yrs) ? Math.round(yrs).toLocaleString() : "∞"} years</b>, around <b>${isFinite(yrs) ? now + Math.round(yrs) : "never"}</b>.</p>
    ${statPanel("Years to clear the backlog", barsH(scen, { fmt: (v) => v.toLocaleString() + " yrs" }), "wide")}
  </section>`;
}

// Show the prediction model's homework. A model that can't state its own error
// bar is asking to be trusted on vibes.
function predictionPanel() {
  const m = typeof tasteModel === "function" ? tasteModel() : null;
  if (!m || !m.ok) return "";
  const e = m.eval;
  const pts = (v) => (v * 100).toFixed(1);
  const beatsCritics = e.liftVsCritic > 0;
  return `<h2 class="stat-sec">Predicted ratings</h2>
    <div class="stat-grid">
      <div class="stat-panel wide">
        <h3>How good is the guess?</h3>
        <p class="yr-note">
          Trained on your <b>${m.n.toLocaleString()}</b> rated games and scored by
          <b>${e.folds}-fold cross-validation</b>: every game gets predicted by a model
          that never saw it, and the group averages are rebuilt from the training games
          alone, so it can't mark its own homework. It is off by
          <b>${pts(e.mae)} points</b> on average, against <b>${pts(e.maeMean)}</b> if we
          just guessed your average every time, and <b>${pts(e.maeCritic)}</b> if we simply
          quoted the critics. So it is <b>${(e.liftVsMean * 100).toFixed(0)}%</b> better than
          guessing${beatsCritics
            ? ` and <b>${(e.liftVsCritic * 100).toFixed(0)}%</b> better than the critics`
            : `, but <b>not</b> better than just quoting the critics, so treat it with suspicion`}.
        </p>
        ${barsH([
          { label: "This model", value: +pts(e.mae) },
          { label: "Just use Metacritic", value: +pts(e.maeCritic) },
          { label: "Guess your average", value: +pts(e.maeMean) },
        ], { fmt: (v) => v + " pts off" })}
        <p class="yr-note">
          It also knows <b>when</b> you rated something, because your standard has moved:
          you averaged <b>${pts(m.baselineNow)}%</b> over the last few years against
          <b>${pts(m.global)}%</b> across all ${m.n.toLocaleString()}. A game you haven't
          played is scored on <b>today's</b> scale: what you'd make of it now, not what
          you'd have said a decade ago. Ignoring that, the model came out
          <b>four points too generous</b> on everything you finished since 2024.
        </p>
      </div>
    </div>`;
}

// Stats is split into sub-pages (statsState.section). renderStats() renders the
// pill sub-nav and the active section only — one section's charts, not all forty.
function renderStats() {
  const rows = (DATA.sheets.completed || { rows: [] }).rows;
  const games = ((DATA.sheets.games || {}).rows) || [];
  const host = $("#stats");
  if (!rows.length && !games.length) { host.innerHTML = emptyState("No data yet", "Your library hasn't loaded."); return; }
  resetChartLinks();

  const section = STATS_SECTIONS.some((s) => s.id === statsState.section) ? statsState.section : "overview";
  statsState.section = section;
  const body =
    section === "year" ? (yearInReview(rows, games) + burnDown(rows, games))
    : section === "completed" ? renderStatsCompleted(rows, games)
    : section === "backlog" ? renderStatsBacklog(rows, games)
    : section === "purchases" ? renderStatsPurchases(rows, games)
    : section === "reviews" ? renderStatsReviews(rows)
    : renderStatsOverview(rows, games);

  host.innerHTML = statsNav() + `<div class="stats-body">${body}</div>`;

  host.querySelectorAll("[data-ssec]").forEach((el) => {
    el.onclick = () => { statsState.section = el.dataset.ssec; renderStats(); nav(); host.scrollTop = 0; };
  });
  const yp = $("#yrPick");
  if (yp) yp.onchange = (e) => { statsState.year = +e.target.value; renderStats(); nav(); };
  host.querySelectorAll("[data-yg]").forEach((el) => {
    el.onclick = () => {
      const row = rows.find((r) => String(r._k || "") === el.dataset.yg);
      if (row) openDrawer(row, "completed");
    };
  });
  wireCharts(host);
}

// Overview — the headline "all time" numbers, then a card into each sub-page.
function renderStatsOverview(rows, games) {
  const hours = rows.reduce((a, r) => a + (r.playTime || 0), 0);
  const rated = rows.filter((r) => r.rating != null);
  const avg = rated.length ? rated.reduce((a, r) => a + r.rating, 0) / rated.length : null;
  const critRated = rows.filter((r) => r.criticScore != null);
  const avgCrit = critRated.length ? critRated.reduce((a, r) => a + r.criticScore, 0) / critRated.length : null;
  const years = rows.map((r) => yearOf(r.date)).filter(Boolean);
  const curYear = years.length ? Math.max(...years) : 0;
  const thisYear = years.filter((y) => y === curYear).length;
  const backlog = games.filter((r) => !r.completed);
  const backlogHours = backlog.reduce((a, r) => a + (playtimeOf(r) || 0), 0);
  const complPct = games.length ? Math.round(100 * games.filter((r) => r.completed).length / games.length) : 0;
  const purchases = games.filter((r) => r.purchasePrice != null && yearOf(r.datePurchased));
  const totalSpent = purchases.reduce((a, r) => a + r.purchasePrice, 0);
  const ownedPhys = games.filter((r) => r.owned && (r.format || "").toLowerCase() === "physical");
  const collectionVal = ownedPhys.map((r) => collectionValueOf(r)).filter((v) => v != null).reduce((a, v) => a + v, 0);
  const dayGaps = games.filter((r) => r.completed && /^\d{4}-/.test(String(r.datePurchased)) && /^\d{4}-/.test(String(r.dateCompleted)))
    .map((r) => (new Date(r.dateCompleted) - new Date(r.datePurchased)) / 864e5).filter((d) => d >= 0);
  const avgGapMo = dayGaps.length ? Math.round(dayGaps.reduce((a, b) => a + b, 0) / dayGaps.length / 30) : null;

  // Two ranks. Beaten / backlog / library-done are the three numbers the page is
  // actually about; the rest are supporting. Green means beaten and amber means
  // outstanding — the accent stays out of it.
  return `<h2 class="stat-sec">All time</h2>
    <div class="stat-cards lead">
      ${statCard(rows.length, "Completed", "", "", { tone: "good", icon: "i-trophy", sub: `of ${games.length.toLocaleString()} cataloged` })}
      ${statCard(backlog.length, "In backlog", "", "", { tone: "warn", icon: "i-clock", sub: `${Math.round(backlogHours).toLocaleString()} hours of it` })}
      ${statCard(complPct, "Library done", "", "%", { tone: "lead", icon: "i-target", sub: `${thisYear} beaten in ${curYear || "—"}` })}
    </div>
    <div class="stat-cards">
      ${statCard(Math.round(hours), "Hours played", "", "h", { icon: "i-clock" })}
      ${statCard(avg != null ? Math.round(avg * 100) : null, "Avg rating", "", "%", { icon: "i-star" })}
      ${statCard(avg != null && avgCrit != null ? `${Math.round(avg * 100)}/${Math.round(avgCrit * 100)}` : "—", "You vs critics", "", "", { icon: "i-trend" })}
      ${statCard(Math.round(totalSpent), "Total spent", "$", "", { icon: "i-package" })}
      ${statCard(Math.round(collectionVal), "Collection value", "$", "", { icon: "i-trend" })}
      ${statCard(avgGapMo != null ? avgGapMo : null, "Avg buy→finish", "", " mo", { icon: "i-calendar" })}
    </div>
    <h2 class="stat-sec">Dig in</h2>
    ${statsNavGrid()}`;
}

// Completed — playthroughs, taste, and you against the critics.
function renderStatsCompleted(rows, games) {
  const years = rows.map((r) => yearOf(r.date)).filter(Boolean);
  const byYear = countBy(years);
  const yearData = [...byYear.keys()].sort((a, b) => a - b).map((y) => ({ label: yr2(y), value: byYear.get(y) }));
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const bm = new Array(12).fill(0);
  rows.forEach((r) => { if (typeof r.date === "string" && /^\d{4}-\d{2}/.test(r.date)) bm[+r.date.slice(5, 7) - 1]++; });
  const monthData = MONTHS.map((m, i) => ({ label: m, value: bm[i] }));
  const decades = countBy(rows.map((r) => (r.releaseYear && /^\d/.test(String(r.releaseYear)) ? Math.floor(+r.releaseYear / 10) * 10 : null)));
  const decadeData = [...decades.keys()].sort((a, b) => a - b).map((d) => ({ label: `${d}s`, value: decades.get(d) }));
  const ratingData = bucketize(rows, [["90–100", .9, 1.01], ["80–89", .8, .9], ["70–79", .7, .8], ["60–69", .6, .7], ["< 60", -1, .6]], (r) => r.rating);

  // Game-level charts link straight to the game.
  const longest = rows.filter((r) => r.playTime).sort((a, b) => b.playTime - a.playTime).slice(0, 10)
    .map((r) => ({ label: r.game, value: Math.round(r.playTime), link: gameLink(r, "completed") }));
  const gaps = rows.filter((r) => r.criticScore != null && r.rating != null)
    .map((r) => ({ label: r.game, value: Math.round((r.rating - r.criticScore) * 100), link: gameLink(r, "completed") }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 10);
  // Running total of everything ever finished, set against the two ways a game
  // arrives. A finishing rate on its own says nothing; the GAP between the lines
  // is the backlog, drawn.
  //
  //   Acquired  — Date Purchased. 2008-2026, the long history.
  //   Added     — Date Added. Flat until 2024 because that is when the column
  //               started being filled in, which is honest rather than broken.
  const cumFrom = (src, dateOf) => {
    const per = new Map();
    for (const r of src) { const y = yearOf(dateOf(r)); if (y) per.set(y, (per.get(y) || 0) + 1); }
    let run = 0;
    return [...per.keys()].sort((a, b) => a - b).map((yy) => {
      run += per.get(yy);
      // x is the real year: this axis is shared with series that start in other
      // years, and "'07" sorts as a string in ways nobody wants.
      return { x: yy, label: yr2(yy), value: run,
               tip: `${yy} · ${run.toLocaleString()} (+${per.get(yy).toLocaleString()} that year)` };
    });
  };
  const cumulative = cumFrom(rows, (r) => r.date);
  const cumAcquired = cumFrom(games.filter((r) => r.purchasePrice != null), (r) => r.datePurchased);
  const cumAdded = cumFrom(games, (r) => r.dateAdded);
  // Every rated game as a dot against the critics.
  const scatterPts = rows
    .filter((r) => r.rating != null && r.criticScore != null)
    .map((r) => ({ x: r.criticScore, y: r.rating, label: String(r.game), link: gameLink(r, "completed") }));
  // Taste profile: average score per genre, for genres you've played enough of.
  const gSum = new Map(), gN = new Map();
  for (const r of rows) {
    if (!r.genre || r.rating == null) continue;
    gSum.set(r.genre, (gSum.get(r.genre) || 0) + r.rating);
    gN.set(r.genre, (gN.get(r.genre) || 0) + 1);
  }
  const genreRadar = [...gN.entries()].filter(([, n]) => n >= 15)
    .map(([g, n]) => ({
      label: g, value: gSum.get(g) / n,
      tip: `${g}\nYour average: ${Math.round((gSum.get(g) / n) * 100)}%\nAcross ${n} finished games`,
    }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  const bestRows = rows.filter((r) => r.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 12);

  const flags = [
    { label: "Steam Deck", value: rows.filter((r) => r.steamDeck).length },
    { label: "Emulated", value: rows.filter((r) => r.emulated).length },
    { label: "VR", value: rows.filter((r) => r.vr).length },
  ];

  /* ---- playthrough pacing & overlap, ported from GamePicker's statistics/ ---- */

  // How hard you actually played it: hours finished / days it took.
  const paced = rows.filter((r) => r.playTime > 0 && r.started && r.date && r.date >= r.started)
    .map((r) => {
      const days = Math.max(1, (new Date(r.date) - new Date(r.started)) / 864e5);
      return { r, perDay: r.playTime / days, days };
    });
  const bingeRows = paced.slice().sort((a, b) => b.perDay - a.perDay).slice(0, 10)
    .map((x) => ({ label: x.r.game, value: Math.round(x.perDay * 10) / 10, link: gameLink(x.r, "completed"),
                   tip: `${x.r.game}\n${fmtHours(x.r.playTime)} over ${Math.round(x.days)} day${x.days < 2 ? "" : "s"}` }));

  // How many games you had on the go at once. A sweep over start/finish events.
  const events = [];
  for (const r of rows) {
    if (!r.started || !r.date || r.date < r.started) continue;
    events.push([r.started, 1], [r.date, -1]);
  }
  events.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || a[1] - b[1]);
  let cur = 0, peak = 0, peakOn = null;
  for (const [d, delta] of events) {
    cur += delta;
    if (cur > peak) { peak = cur; peakOn = d; }
  }

  /* ---- what the purchase / start / finish dates say about how you work ----------
     Three rankings and a distribution. The gap charts need datePurchased, which only
     the GAMES sheet carries; the playthrough ones use the completed sheet, like the
     binge and peak numbers above, so they all agree with each other. */
  const fmtSpan = (d) => (d < 60 ? `${Math.round(d)}d`
    : d < 730 ? `${Math.round(d / 30.4)} mo`
    : `${(d / 365.25).toFixed(1)} yrs`);
  const isoD = (v) => /^\d{4}-\d{2}-\d{2}/.test(String(v || ""));
  const dayDiff = (a, b) => (new Date(b) - new Date(a)) / 864e5;
  const shortD = (v) => String(v).slice(0, 10);

  // Bought, then left to sit — the backlog made personal.
  const buyBeat = games
    .filter((r) => r.completed && isoD(r.datePurchased) && isoD(r.dateCompleted))
    .map((r) => ({ r, d: dayDiff(r.datePurchased, r.dateCompleted) }))
    .filter((x) => x.d >= 0).sort((a, b) => b.d - a.d).slice(0, 12)
    .map(({ r, d }) => ({ label: r.title, value: d, link: gameLink(r, "games"),
      tip: `${r.title}\nBought ${shortD(r.datePurchased)}\nBeaten ${shortD(r.dateCompleted)}\n${fmtSpan(d)} on the shelf` }));

  // Bought -> started, as a DISTRIBUTION. A mean over a tail this long tells you nothing
  // on its own, so the shape leads and the median rides along in the note.
  const bsDays = games.filter((r) => isoD(r.datePurchased) && isoD(r.dateStarted))
    .map((r) => dayDiff(r.datePurchased, r.dateStarted)).filter((d) => d >= 0)
    .sort((a, b) => a - b);
  const BS = [["Same week", 7], ["< 1 mo", 30], ["1–3 mo", 91], ["3–6 mo", 183],
              ["6–12 mo", 365], ["1–2 yr", 730], ["2 yr+", Infinity]];
  const bsData = BS.map(([label]) => ({ label, value: 0 }));
  for (const d of bsDays) bsData[BS.findIndex(([, lim]) => d < lim)].value++;
  const bsMed = bsDays.length ? bsDays[bsDays.length >> 1] : null;
  const bsAvg = bsDays.length ? bsDays.reduce((a, b) => a + b, 0) / bsDays.length : null;

  // The slow burns: longest from first session to the credits, in CALENDAR time.
  const slowBurn = paced.slice().sort((a, b) => b.days - a.days).slice(0, 12)
    .map((x) => ({ label: x.r.game, value: x.days, link: gameLink(x.r, "completed"),
      tip: `${x.r.game}\nStarted ${shortD(x.r.started)}\nFinished ${shortD(x.r.date)}\n${fmtSpan(x.days)} start to credits` }));

  // Every playthrough open around your busiest stretch, drawn as spans on one timeline.
  const PK = peakOn ? +new Date(peakOn) : 0, WIN = 150 * 864e5;
  const ivl = !peakOn ? [] : rows
    .filter((r) => r.started && r.date && r.date >= r.started)
    .map((r) => ({ r, s: +new Date(r.started), e: +new Date(r.date) }))
    .filter((x) => x.e >= PK - WIN && x.s <= PK + WIN)
    .sort((a, b) => (b.e - b.s) - (a.e - a.s)).slice(0, 40)
    .map((x) => ({ label: x.r.game, start: new Date(x.s), end: new Date(x.e),
      link: gameLink(x.r, "completed"),
      tip: `${x.r.game}\n${shortD(x.r.started)} → ${shortD(x.r.date)}\n${fmtSpan((x.e - x.s) / 864e5)}` }));

  return sect("Completed games", [
      statPanel("Finished vs added, cumulatively", multiLine([
        { points: cumAcquired, color: 3, name: "Acquired", label: `Acquired · ${last(cumAcquired)}` },
        { points: cumAdded, color: 1, name: "Added to the sheet", label: `Added to the sheet · ${last(cumAdded)}` },
        { points: cumulative, color: 0, name: "Finished", label: `Finished · ${rows.length.toLocaleString()}` },
      ]), "wide",
      "The gap between the lines is your backlog. Acquired uses Date Purchased; Added uses Date Added, which only starts in 2024. That is when you began recording it, not a gap in the chart."),
      statPanel("Your hall of fame", posterRow(bestRows, { note: (r) => `${Math.round(r.rating * 100)}%` }), "wide"),
      statPanel("You vs the critics", scatter(scatterPts, { xLabel: "Critics", yLabel: "You" })),
      statPanel("Your taste, by genre", radar(genreRadar, { color: 4 }), "",
        "Your average rating per genre (0-100%), for genres you've finished 15+ games in. A long spoke means you rate that genre highly, not that you play it a lot."),
      statPanel("Completions per year", barsV(yearData, { tone: "good" }), "wide"),
      statPanel("Completions by month", barsV(monthData, { tone: "good" })),
      statPanel("By release decade", barsV(decadeData)),
      statPanel("Top platforms", barsH(countBars(rows, "platform", 10, "completed"))),
      statPanel("Top genres", barsH(countBars(rows, "genre", 12, "completed"))),
      statPanel("Top franchises", barsH(countBars(rows, "franchise", 10, "completed"))),
      statPanel("Top developers", barsH(countBars(rows, "developer", 10, "completed"))),
      statPanel("Top publishers", barsH(countBars(rows, "publisher", 10, "completed"))),
      statPanel("Rating distribution", barsH(ratingData)),
      statPanel("By region", barsH(countBars(rows, "region", 8, "completed"))),
      statPanel("How I played", barsH(flags)),
      statPanel("Most hours played", barsH(longest, { fmt: (v) => v + "h" }), "",
        "Hours at the pad. For the games that took the longest in CALENDAR time, see the slow burns below."),
      statPanel("Longest playthroughs (start → finish)", barsH(slowBurn, { fmt: fmtSpan }), "",
        "Calendar time from first session to credits. A big number here just means it sat around a while, not that the game is long."),
      statPanel("Biggest me-vs-critic gaps", barsH(gaps, { fmt: (v) => (v > 0 ? "+" : "") + v, diverging: true }), "",
        "Green: you rated it higher than the critics did. Red: lower."),
      statPanel("Hardest you've binged", barsH(bingeRows, { fmt: (v) => v + "h/day" }), "",
        "Hours played divided by the days it took. The top of this list was probably a lost weekend."),
      statPanel("Most overlapping playthroughs",
        intervals(ivl, peakOn ? { from: PK - WIN, to: PK + WIN } : {}), "wide",
        peak ? `Your busiest stretch: ${peak} games on the go at once, around ${peakOn ? fmtDate(peakOn) : "—"}. Each bar is one playthrough and stacks when it overlaps another. The height of the pile is how many you were juggling. A bar that runs off an edge was already under way. Click one to open it.`
             : "Counted from start and finish dates."),
    ]) +
    sect("Buying vs playing", [
      statPanel("Longest waits: bought → beaten", barsH(buyBeat, { fmt: fmtSpan }), "wide",
        "How long a game sat between paying for it and finishing it. Click a bar to open the game."),
      statPanel("Bought → started", barsV(bsData), "wide",
        bsMed != null
          ? `Half the games you start, you start within ${fmtSpan(bsMed)} of buying them, but the average is ${fmtSpan(bsAvg)}, dragged out by the tail on the right. The shape is what matters here: you either play it almost at once, or it sits for years (that right-hand spike is the backlog).`
          : "Needs both a purchase date and a start date."),
    ]);
}

// Backlog — what's left to play.
function renderStatsBacklog(rows, games) {
  const backlog = games.filter((r) => !r.completed);
  const backlogTime = bucketize(backlog, [["< 2h", -1, 2], ["2–5h", 2, 5], ["5–10h", 5, 10], ["10–20h", 10, 20], ["20–40h", 20, 40], ["40h+", 40, 1e9]], playtimeOf);
  return sect("Backlog", [
    statPanel("Backlog by platform", barsH(countBars(backlog, "platform", 10, "games"))),
    statPanel("Backlog by genre", barsH(countBars(backlog, "genre", 12, "games"))),
    statPanel("Backlog by length", barsH(backlogTime)),
    statPanel("Backlog by status", barsH(countBars(backlog, "playingStatus", 6, "games"))),
  ]);
}

// Purchases & Value — spending, collection worth, and buy→play lag.
function renderStatsPurchases(rows, games) {
  const purchases = games.filter((r) => r.purchasePrice != null && yearOf(r.datePurchased));
  const spendMap = new Map(), boughtMap = new Map();
  purchases.forEach((r) => { const y = yearOf(r.datePurchased); spendMap.set(y, (spendMap.get(y) || 0) + r.purchasePrice); boughtMap.set(y, (boughtMap.get(y) || 0) + 1); });
  const spendData = [...spendMap.keys()].sort((a, b) => a - b).map((y) => ({ label: yr2(y), value: Math.round(spendMap.get(y)) }));
  const boughtData = [...boughtMap.keys()].sort((a, b) => a - b).map((y) => ({ label: yr2(y), value: boughtMap.get(y) }));
  const totalSpent = purchases.reduce((a, r) => a + r.purchasePrice, 0);
  const ownedPhys = games.filter((r) => r.owned && (r.format || "").toLowerCase() === "physical");
  const valued = ownedPhys.map((r) => ({ r, v: collectionValueOf(r) })).filter((x) => x.v != null);
  let runSpend = 0;
  const cumSpend = [...spendMap.keys()].sort((a, b) => a - b).map((yy) => {
    runSpend += spendMap.get(yy);
    return { label: yr2(yy), value: Math.round(runSpend) };
  });
  const topValueRows = valued.slice().sort((a, b) => b.v - a.v).slice(0, 12).map((x) => x.r);

  // Spend by quarter. A year is too coarse to see a Steam sale in.
  const qMap = new Map();
  for (const r of purchases) {
    const d = String(r.datePurchased);
    if (!/^\d{4}-\d{2}/.test(d)) continue;
    const q = `${d.slice(0, 4)} Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`;
    qMap.set(q, (qMap.get(q) || 0) + r.purchasePrice);
  }
  const quarterly = [...qMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-16)
    .map(([q, v]) => ({ label: q.replace(" ", " "), value: Math.round(v) }));

  // Buy it, then actually play it — how long does that take?
  const gapMonths = games
    .filter((r) => r.completed && /^\d{4}-/.test(String(r.datePurchased)) && /^\d{4}-/.test(String(r.dateCompleted)))
    .map((r) => (new Date(r.dateCompleted) - new Date(r.datePurchased)) / 864e5 / 30.4)
    .filter((m) => m >= 0);
  const gapBuckets = [
    ["Same month", (m) => m < 1], ["1-3 months", (m) => m >= 1 && m < 3],
    ["3-6 months", (m) => m >= 3 && m < 6], ["6-12 months", (m) => m >= 6 && m < 12],
    ["1-2 years", (m) => m >= 12 && m < 24], ["2-5 years", (m) => m >= 24 && m < 60],
    ["5 years+", (m) => m >= 60],
  ].map(([label, test]) => ({ label, value: gapMonths.filter(test).length }));
  // What a game is worth NOW minus what you paid for it. This is the one thing
  // the price data knows that the crown-jewels wall can't show: a $60 game worth
  // $58 is not a find, and a $5 one worth $180 is. Both ends, because the losses
  // are the more interesting half.
  const moved = ownedPhys
    .map((r) => ({ r, gain: (collectionValueOf(r) ?? NaN) - r.purchasePrice }))
    .filter((x) => r0(x.r.purchasePrice) && isFinite(x.gain) && Math.abs(x.gain) >= 1)
    .sort((a, b) => b.gain - a.gain);
  const moverCount = moved.length;
  const moverBar = (x) => ({
    label: x.r.title, value: Math.round(x.gain), link: gameLink(x.r, "games"),
    tip: `${x.r.title}\nPaid ${usd(x.r.purchasePrice)} · now ${usd(collectionValueOf(x.r))}\n${
      x.gain > 0 ? "Up" : "Down"} ${usd(Math.abs(x.gain))}`,
  });
  const movers = [...moved.slice(0, 8).map(moverBar), ...moved.slice(-5).reverse().map(moverBar)]
    .filter((b, i, a) => a.findIndex((o) => o.label === b.label) === i);   // tiny sets can overlap
  const topSales = games.map((r) => ({ r, v: salesOf(r) })).filter((x) => x.v != null)
    .sort((a, b) => b.v - a.v).slice(0, 10)
    .map((x) => ({ label: x.r.title, value: x.v, link: gameLink(x.r, "games") }));

  return sect("Purchases & collection", [
    statPanel("Spending per year", barsV(spendData, { fmt: usd, tone: "warn" }), "wide"),
    statPanel("Games bought per year", barsV(boughtData)),
    statPanel("Cumulative spend", areaLine(cumSpend, { color: 3, fmt: usd, label: usd(totalSpent) + " all in" }), "wide"),
    ...(VALUE_HISTORY && VALUE_HISTORY.length > 1
      ? [statPanel("Collection value over time",
          areaLine(VALUE_HISTORY.map((h) => ({ label: fmtDate(h.day).replace(/,.*/, ""), value: Math.round(h.total) })),
            { color: 2, fmt: usd, label: usd(VALUE_HISTORY[VALUE_HISTORY.length - 1].total) + " today" }), "wide")]
      : [statPanel("Collection value over time",
          `<div class="s-empty">Recording daily from today. A trend needs at least two points.
           ${VALUE_HISTORY && VALUE_HISTORY.length ? `First snapshot: ${escapeHtml(fmtDate(VALUE_HISTORY[0].day))} at ${usd(VALUE_HISTORY[0].total)}.` : ""}</div>`, "wide")]),
    statPanel("The crown jewels", posterRow(topValueRows, { note: (r) => usd(collectionValueOf(r)) }), "wide"),
    statPanel("Biggest movers", barsH(movers, { fmt: (v) => (v > 0 ? "+" : "-") + usd(Math.abs(v)) }), "wide",
      `What it's worth now minus what you paid, across ${moverCount.toLocaleString()} games where we know both. Up is profit.`),
    statPanel("Best selling (VGChartz)", barsH(topSales, { fmt: fmtUnits })),
    statPanel("Purchases by platform", barsH(countBars(purchases, "platform", 10, "games"))),
    statPanel("Spending by quarter", barsV(quarterly, { fmt: usd, tone: "warn" }), "wide",
      "A year is too coarse to see a Steam sale in."),
    statPanel("Bought, then finally played", barsH(gapBuckets), "",
      `How long a game waits between the till and the credits. ${gapMonths.length.toLocaleString()} games where we know both dates.`),
  ]);
}

// Reviews — the words behind your scores, and how the rating model does.
function renderStatsReviews(rows) {
  return (typeof reviewStats === "function" ? reviewStats(rows) : "") + predictionPanel();
}

// Landing state (core.js). renderStats re-derives the newest year when it's null.
TAB_RESET.stats = () => { statsState.section = "overview"; statsState.year = null; };
