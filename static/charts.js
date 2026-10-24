"use strict";

/* Charts for the Stats tab.

   Bars are HTML/CSS, not SVG. SVG text has no line-breaking and no ellipsis, so
   long labels ("Biggest me-vs-critic gaps" is all game titles) either overflowed
   the panel or got clipped — that was the old implementation's main visual bug.
   In HTML a label is just a <span> with text-overflow, a bar is a <button> that
   can link straight to a game, and the width animates with a plain transition.

   The donut stays SVG: arcs need paths.

   Loaded after app.js; shares its globals (openDrawer, tabState, …). */

/* Colour has exactly three jobs. Anything else is decoration, and decoration is
   what makes a chart hard to read.

   1 MAGNITUDE — one ramp, from the accent. Ordered data: a ranking, a density, a
     count. The eye reads dark-to-bright as less-to-more without being told.
   2 STATE — green/amber/red, fixed meanings, used NOWHERE else. The moment green
     means "beaten" AND "the third bar", it means nothing.
   3 CATEGORY — a few harmonised hues, only where the categories differ in KIND.

   What this replaces: twelve rotating hues handed out in render order, so a bar
   was teal because it was third. Nothing was encoded. */
const RAMP = ["#7C5CFF", "#6B4FE0", "#5B44C2", "#4C3AA3", "#3D3085", "#332A70", "#2A2360", "#241E52"];
const STATE = { good: "#35D07F", warn: "#F5A524", bad: "#F2555A" };
// Only for genuinely different KINDS of thing (platform families), never for a ranking.
const FAMILY = ["#7C5CFF", "#3DBFD9", "#4FC08D", "#E8894A", "#9AA4B8", "#C77DD6"];

// A ranked bar already encodes its value in LENGTH. The ramp reinforces that
// order instead of arguing with it.
const rampAt = (i, n) => RAMP[Math.min(RAMP.length - 1, Math.round((i / Math.max(1, n - 1)) * (RAMP.length - 1)))];
const chartColor = (i) => [FAMILY[i % FAMILY.length], FAMILY[i % FAMILY.length]];

// Click targets are registered per render and referenced by index, so a bar can
// carry a closure (open this game / filter by this platform) without any global
// lookup table of rows.
let CHART_LINKS = [];
const resetChartLinks = () => { CHART_LINKS = []; };
function chartLink(fn) {
  if (!fn) return "";
  CHART_LINKS.push(fn);
  return ` data-cl="${CHART_LINKS.length - 1}"`;
}

const chartFmt = (v) => v.toLocaleString();

/* A real tooltip, because the native SVG <title> can't do what these charts need:
   it waits a second to appear, can't be styled, and turns a list of games into an
   unreadable smear. Anything with data-tip gets one. Multi-line text is fine —
   the box renders newlines. */
let _tipEl = null;

const tipAttr = (text) => (text ? ` data-tip="${escapeHtml(String(text))}"` : "");

function showTip(el, ev) {
  const tip = chartTipEl();
  tip.textContent = el.getAttribute("data-tip");
  tip.hidden = false;
  const pad = 14, r = tip.getBoundingClientRect();
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - pad;   // flip near the right edge
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - pad;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { if (_tipEl) _tipEl.hidden = true; };

// A bar/dot/cell knows the games behind it; say so, and cap the list.
function tipList(title, names, total) {
  const shown = names.slice(0, 6);
  const more = (total ?? names.length) - shown.length;
  return [title, ...shown.map((n) => "· " + n), more > 0 ? `+ ${more.toLocaleString()} more` : ""]
    .filter(Boolean).join("\n");
}

/* Big numbers count up from zero when the card scrolls into view. */
function animateCounters(host) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target;
      const target = parseFloat(el.dataset.n);
      if (!isFinite(target)) continue;
      const pre = el.dataset.pre || "", post = el.dataset.post || "";
      const dur = 900, t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 3);          // ease-out cubic
        const v = target * eased;
        el.textContent = pre + Math.round(v).toLocaleString() + post;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }, { threshold: 0.4 });
  host.querySelectorAll("[data-n]").forEach((el) => io.observe(el));
}

/* Bars animate from zero once their panel is on screen. */
function animateCharts(host) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { host.querySelectorAll(".bars, .cols, .s-svg").forEach((c) => c.classList.add("drawn")); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      e.target.classList.add("drawn");
    }
  }, { threshold: 0.15 });
  host.querySelectorAll(".bars, .cols, .s-svg").forEach((c) => io.observe(c));
}

// One delegated listener for every linked bar/legend row on the page. Bound
// once — renderStats() runs on every tab switch and theme change, and the host
// element survives, so re-binding here would stack duplicate handlers.
let _chartsBound = false;
function wireCharts(host) {
  if (!_chartsBound) {
    _chartsBound = true;
    host.addEventListener("click", (e) => {
      const el = e.target.closest("[data-cl]");
      if (!el) return;
      const fn = CHART_LINKS[+el.dataset.cl];
      if (fn) fn();
    });
    // One delegated tooltip for every bar, dot, cell and spoke on the page.
    host.addEventListener("mousemove", (e) => {
      const el = e.target.closest("[data-tip]");
      if (el) showTip(el, e); else hideTip();
    });
    host.addEventListener("mouseleave", hideTip);
    host.addEventListener("scroll", hideTip, true);
    window.addEventListener("scroll", hideTip, { passive: true });
  }
  hideTip();
  animateCharts(host);
  animateCounters(host);
}

// A bar that opens a game's detail drawer.
const gameLink = (row, sheet) => () => openDrawer(row, sheet);
// A bar that filters a tab by one facet value.
const facetLink = (tab, key, val) => () => {
  if (!tabState[tab]) return;
  // goTab clears the search/sort/page this used to clear by hand, then this one facet
  // goes on top of the clean state — the whole point of the link.
  goTab(tab, () => { tabState[tab].facets = { [key]: new Set([String(val)]) }; });
};

/* ==========================================================================
   Richer chart types. Bars and donuts everywhere made the Stats page read
   same-y; these give each question a shape that suits it.
   ========================================================================== */

/* Area/line — a running total over time. Draws itself in with a dash offset.

   Takes one OR MORE series sharing an x axis, because a single line rarely
   answers the question on its own: "games finished" only means something next to
   "games acquired", and the gap between them IS the backlog. */
function areaLine(data, opts = {}) {
  return multiLine([{ points: data, color: opts.color || 0, label: opts.label || "" }], opts);
}

const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
