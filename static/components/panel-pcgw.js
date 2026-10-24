"use strict";

/* PCGamingWiki: will it actually run properly? Joined on the Steam appid, so unlike every
   fuzzy-title source in here it CANNOT be the wrong game.

   The wiki's vocabulary is kept as it is. "hackable" and "limited" are not "yes", and
   flattening them to a tick would be lying about what it says. */
const _PCGW_TONE = { true: "good", false: "bad", hackable: "warn", limited: "warn" };
const pcgwCell = (v) =>
  `<b class="${_PCGW_TONE[String(v).toLowerCase()] || ""}">${escapeHtml(titleCase(String(v)))}</b>`;

function pcgwHtml(key) {
  const p = PCGWC[key];
  if (!p) return "";
  const display = [
    ["Widescreen", p.widescreen], ["Ultrawide", p.ultrawide],
    ["4K", p.uhd4k], ["HDR", p.hdr], ["Ray tracing", p.rayTracing],
    ["Controller", p.controller], ["Surround", p.surround],
  ].filter(([, v]) => v)
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span>${pcgwCell(v)}</div>`).join("");
  // The APIs it renders with, and whether it's a 64-bit binary — the things that decide
  // whether a 2007 PC game is going to behave on a modern machine.
  const tech = [
    ["Direct3D", p.d3d], ["OpenGL", p.opengl], ["Vulkan", p.vulkan],
    ["64-bit", p.win64],
  ].filter(([, v]) => v)
    .map(([l, v]) => `<div class="hltb-row"><span>${l}</span><b>${escapeHtml(titleCase(String(v)))}</b></div>`).join("");
  if (!(display || tech || p.url)) return "";
  // A page can exist with none of its infobox filled in (15 of the first 238 matched). The
  // link is still the point of the section — that page is where the fixes and tweaks live —
  // so surface it rather than hiding the whole thing over a set of empty fields.
  const blank = !display && !tech
    ? `<div class="hltb-note muted">No compatibility details filled in yet.</div>` : "";
  return sourcePanelHtml(`${icon("i-play", 15)} On PC (PCGamingWiki)`,
    display + tech + blank +
    (p.url ? `<a class="hltb-link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">Fixes and details on PCGamingWiki ↗</a>` : ""));
}
