"use strict";

// UI components for enrich.js. Feature state and orchestration remain in that module.

function coverCell(row) {
  const src = coverSrc(ENRICH[row._k], "cover_small");
  if (src) return `<img class="cover-thumb" loading="lazy" src="${src}" alt="">`;
  return `<span class="cover-ph${coverPending(row) ? " skel" : ""}"></span>`;
}

// Shimmering placeholder cards while the spreadsheet loads.
// Per-page loading skeletons. On boot the target tab isn't applied yet (applyStateFromURL
// runs after the data lands), so peek at the URL — landing on Home and seeing a grid of
// listing-card skeletons was the giveaway that the shell was generic. Home gets a hero +
// shelves skeleton; the listing tabs (and the enrich-wait hold) get the card grid.
function showSkeletons(n = 30) {
  const tab = (activeTab && activeTab !== "home") ? activeTab
    : (new URLSearchParams(location.search).get("tab") || "home");
  if (tab === "home") return showHomeSkeleton();
  if (typeof setSpecialMode === "function") setSpecialMode(null);
  $("#gridwrap").hidden = false;
  $("#grid").innerHTML = Array.from({ length: n }, () =>
    `<div class="card"><div class="card-cover ph skel"></div><div class="card-body">
      <div class="skel skel-line"></div><div class="skel skel-line short"></div></div></div>`).join("");
}

// A skeleton the shape of Home: the hero, then a couple of horizontal shelves.
function showHomeSkeleton() {
  if (typeof setSpecialMode === "function") setSpecialMode("home");
  const host = $("#home");
  if (!host) return;
  const shelfRow = Array.from({ length: 9 }, () =>
    `<div class="card sk-shelf-card"><div class="card-cover ph skel"></div></div>`).join("");
  const sect = () => `<section class="h-sect">
    <div class="h-sect-head"><div class="skel skel-line sk-head"></div></div>
    <div class="h-shelf">${shelfRow}</div></section>`;
  host.innerHTML = `
    <div class="h-hero"><div class="h-hero-inner">
      <div class="h-hero-cover ph skel"></div>
      <div class="h-hero-txt">
        <div class="skel skel-line sk-eyebrow"></div>
        <div class="skel skel-line sk-title"></div>
        <div class="skel skel-line"></div>
        <div class="skel skel-line short"></div>
      </div></div></div>
    ${sect()}${sect()}`;
}
