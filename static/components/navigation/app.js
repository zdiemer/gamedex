"use strict";

// UI components for app.js. Feature state and orchestration remain in that module.

function renderAll() {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  if (perf) perf.page(activeTab);
  const end = perf ? perf.start("renderAll", activeTab) : () => {};
  try { return _renderAll(); } finally { end(); }
}

// Holding for the map: show the skeleton we booted with, not a list we know is wrong.
function renderEnrichWait() {
  if (typeof disposeTimeline === "function") disposeTimeline();
  $("#facets").innerHTML = "";     // the counts would be wrong for exactly the same reason
  $("#tablewrap").hidden = true;
  $("#timeline").hidden = true;
  $("#views").hidden = true;
  $("#pager").style.display = "none";
  $("#count").textContent = "Loading game data…";
  showSkeletons();
}

// The "you are here" label in the top bar, now that the tabs live behind the ☰. Blank on
// Home (the logo already says Gamedex) — it reappears the moment you're anywhere else.
function updateNavHere() {
  const el = $("#navHere");
  if (!el) return;
  const btn = document.querySelector(`#tabs button[data-tab="${activeTab}"]`);
  const ev = typeof evById === "function" ? evById(activeTab) : null;
  const label = btn ? (btn.querySelector("span") || {}).textContent
    : ev ? ev.name
    : activeTab === "events" ? "Seasonal events"
    : ({ picross: "Daily Picross", dexle: "Dexle", hilo: "Daily Hi-Lo", daily: "Daily Games", search: "Search",
         spooktober: "Spooktober" }[activeTab] || "");
  const iconHref = btn ? (btn.querySelector("use") || {}).getAttribute("href")
    : ev ? "#" + ev.icon
    : activeTab === "events" ? "#i-calendar"
    : (activeTab === "search" ? "#i-search"
      : (activeTab === "dexle" || activeTab === "daily") ? "#i-dice"
      : activeTab === "spooktober" ? "#i-pumpkin"
      : activeTab === "hilo" ? "#i-trend" : null);
  const show = label && activeTab !== "home";
  el.hidden = !show;
  if (show) el.innerHTML = (iconHref ? `<svg class="ico" width="15" height="15" aria-hidden="true"><use href="${iconHref}"/></svg>` : "") + escapeHtml(label);
}

function setFreshness() {
  const m = DATA.meta || {};
  const el = $("#freshness");
  if (!m.lastUpdated) { el.textContent = ""; return; }
  const when = new Date(m.lastUpdated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  el.innerHTML = `data as of<br>${escapeHtml(when)}`;
  if (m.lastError) {
    const banner = $("#banner");
    banner.hidden = false;
    banner.innerHTML = `${icon("i-alert", 13)} Couldn't refresh the library (${escapeHtml(m.lastError)}). Showing last-known data.`;
  }
}
