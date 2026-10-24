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

const last = (pts) => (pts && pts.length ? pts[pts.length - 1].value.toLocaleString() : "0");

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

let VALUE_HISTORY = null;          // [{day,total,games,priced}] — daily snapshots
let RECS = null;                   // "because you liked …" (see src/recommend.py)

async function loadRecs() {
  try {
    const res = await fetch("api/recommendations");
    const j = await res.json();
    RECS = j.items || [];
    // The "Because you liked…" shelf and nothing else — a full renderHome() here rebuilt
    // every <img> on the page, which now means wiping the covers that already painted.
    if (activeTab === "home") patchHomeRecs();
  } catch (_) { RECS = []; }
  if (activeTab === "recs") renderAll();
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

// Landing state (core.js). renderStats re-derives the newest year when it's null.
TAB_RESET.stats = () => { statsState.section = "overview"; statsState.year = null; };
