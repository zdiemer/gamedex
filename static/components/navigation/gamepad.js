"use strict";

// UI components for gamepad.js. Feature state and orchestration remain in that module.

// Visible means it has a box, isn't clipped away in a collapsed section, and is
// somewhere near the screen. The last part matters: a listing renders 50 cards,
// and the ones a page-scroll away shouldn't win a "nearest to the right" contest.
// Ordered by cost: the rect is one batched layout and throws out most of the field
// (display:none measures zero), and only the survivors pay for a style resolve.
function gpVisible(el, r) {
  r = r || el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.bottom < -600 || r.top > window.innerHeight + 600) return false;
  if (el.hidden || el.disabled || el.closest("[hidden]")) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.pointerEvents !== "none";
}

// ---- the hint bar ---------------------------------------------------------

/* Glyphs are drawn here rather than added to the sprite in index.html: they are
   this file's business, six of them exist per brand, and none of the rest of the
   app has any use for a Cross button. All on a 24 grid like the site's own icons. */
const gpSvg = (inner) =>
  `<svg class="gp-ico" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${inner}</svg>`;

// One hint's glyph. The shoulders are a pair of lettered chips rather than SVG:
// "LB RB" is a name, and a name at 18px reads better set than drawn.
function gpGlyphs(token, brand) {
  const n = GP_NAMES[brand] || GP_NAMES.xbox;
  if (token === "south" || token === "east" || token === "north") return gpFaceGlyph(token, brand);
  if (token === "menu" || token === "view") return gpSvg((GP_CENTRE[brand] || GP_CENTRE.xbox)[token]);
  if (token === "dpad") return gpSvg(GP_DPAD);
  if (token === "bump") return `<i class="gp-chip">${escapeHtml(n.l)}</i><i class="gp-chip">${escapeHtml(n.r)}</i>`;
  return "";
}

function gpRenderHints() {
  const bar = $("#gpHints");
  if (!bar) return;
  const hints = gpHints();
  const brand = _gpBrand;
  // Keyed so this repaints when the surface, the tab or the pad changes, not on
  // every one of sixty frames a second — and so the measure below is just as rare.
  const key = gpScope() + "|" + activeTab + "|" + brand + "|" + hints.length;
  if (key === gpHintKey) return;
  gpHintKey = key;
  bar.dataset.brand = brand;
  bar.innerHTML = hints.map(([token, label]) =>
    `<span class="gp-hint">${gpGlyphs(token, brand)}<span>${escapeHtml(label)}</span></span>`
  ).join("");
  // A listing keeps its pager pinned to the bottom of the window, so the bar rides
  // above it there and drops back to the corner on the tabs that have none.
  const pager = $("#pager");
  const h = pager && !pager.hidden ? pager.offsetHeight : 0;
  bar.style.bottom = (h ? h + 10 : 14) + "px";
}
