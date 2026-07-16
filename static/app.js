"use strict";

/* The spine: which tab is showing, what the URL says, and boot.

   renderAll() is the one entry point every other file calls after it changes
   state. The URL is the source of truth for a shared or refreshed link -- if it
   isn't in syncURL/applyStateFromURL, it doesn't survive a reload.

   load() runs last, from chrome.js, once every script has parsed. */

// ---- orchestration ------------------------------------------------------
let currentFiltered = [];
let lastGroupedCount = -1;      // so the grouped view repaints once enrichment lands
const SPECIAL_TABS = ["home", "stats", "pick", "challenges", "health", "groups", "shelf", "picross", "recs"];
function setSpecialMode(mode) {   // null | "home" | "stats" | "pick" | "challenges"
  const special = SPECIAL_TABS.includes(mode);
  $("#stats").hidden = mode !== "stats";
  $("#picker").hidden = mode !== "pick";
  $("#challenges").hidden = mode !== "challenges";
  $("#home").hidden = mode !== "home";
  $("#health").hidden = mode !== "health";
  $("#groups").hidden = mode !== "groups";
  $("#shelfview").hidden = mode !== "shelf";
  $("#picross").hidden = mode !== "picross";
  $("#recs").hidden = mode !== "recs";
  $(".resultbar").hidden = special;
  $("#pager").style.display = special ? "none" : "";
  document.querySelector(".facets").style.display = special ? "none" : "";
  // Filters/sort don't apply on Stats/Pick — leave only "back to top".
  $("#fabFilters").hidden = special;
  $("#fabSort").hidden = special;
  if (special) {
    setSheet(false); setFacets(false);
    $("#tablewrap").hidden = true;
    $("#gridwrap").hidden = true;
    $("#timeline").hidden = true;    // ← was left on screen, showing through Series
    $("#views").hidden = true;
  }
}

function renderAll() {
  if (activeTab === "home") { setSpecialMode("home"); renderHome(); return; }
  if (activeTab === "stats") { setSpecialMode("stats"); renderStats(); return; }
  if (activeTab === "pick") { setSpecialMode("pick"); renderPicker(); return; }
  if (activeTab === "challenges") { setSpecialMode("challenges"); renderChallenges(); return; }
  if (activeTab === "health") { setSpecialMode("health"); renderHealth(); return; }
  if (activeTab === "groups") { setSpecialMode("groups"); renderGroups(); return; }
  if (activeTab === "shelf") { setSpecialMode("shelf"); renderShelf(); return; }
  if (activeTab === "picross") { setSpecialMode("picross"); renderPicross(); return; }
  if (activeTab === "recs") { setSpecialMode("recs"); renderRecs(); return; }
  setSpecialMode(null);
  renderFacets();
  // Completed shows every finished game individually — each episode of a series
  // stands on its own rather than collapsing into one collection card. (The
  // collection is still reachable: a member's drawer links up to it.)
  currentFiltered = filterRows(null);
  renderTable(currentFiltered);
}

// reset: a deliberate navigation to a tab (clicking it) starts clean. Filters you
// set on All Games shouldn't still be there when you come back to it later — the
// only state that should survive is what's in the URL, which is how back/forward
// and shared links restore a view on purpose.
function switchTab(tab, reset) {
  if (reset && tabState[tab]) {
    const keep = tabState[tab];
    tabState[tab] = { ...freshState(), view: keep.view, combine: keep.combine };
  }
  activeTab = tab;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  if (!SPECIAL_TABS.includes(tab)) $("#search").value = tabState[tab].search;
  renderAll();
}

// ---- URL state: back/forward + shareable/refreshable links ---------------
let applyingState = false;
function syncURL(push) {
  if (applyingState) return;
  const p = new URLSearchParams();
  if (activeTab !== "home") p.set("tab", activeTab);
  if (activeTab === "pick") {
    // A preset is a name; anything you've edited since is a tree, and only the tree
    // is the truth. Send whichever one describes what's on screen.
    if (pickState.preset) p.set("sel", pickState.preset);
    else if (pickState.filter && pickState.filter.kids.length) p.set("fb", pickEncode(pickState.filter));
    if (pickState.minutes) p.set("mins", String(pickState.minutes));
  } else if (activeTab === "groups") {
    if (groupState.kind) p.set("g", groupState.kind);
    if (groupState.open) p.set("gk", groupState.open);
  } else if (activeTab === "challenges") {
    if (chState.open) p.set("ch", chState.open);
  } else if (activeTab === "recs") {
    if (recsState.sort !== "both") p.set("rs", recsState.sort);
    if (recsState.era) p.set("re", recsState.era);
    if (recsState.genre) p.set("rg", recsState.genre);
    if (recsState.minConf) p.set("rc", "1");
  } else if (activeTab === "stats") {
    if (statsState.section && statsState.section !== "overview") p.set("s", statsState.section);
    if (statsState.year) p.set("sy", String(statsState.year));
  } else if (tabState[activeTab]) {
    // Guarded on tabState, not on a list of tab names. Home, Reviews and Health
    // have no row state, and the old `!== "stats"` test let them fall in here and
    // blow up on tabState["health"].view.
    const st = tabState[activeTab];
    if (st.view !== VIEW_DEFAULT[activeTab]) p.set("view", st.view);
    if (PAGE_SIZE !== 50) p.set("ps", String(PAGE_SIZE));
    if (st.search) p.set("q", st.search);
    if (st.page > 1) p.set("page", String(st.page));
    if (st.sort && st.sort.length) p.set("sort", st.sort.map((s) => `${s.key}:${s.dir}`).join(","));
    for (const [k, set] of Object.entries(st.facets)) if (set && set.size) p.set("f." + k, [...set].join("~"));
  }
  const qs = p.toString();
  history[push ? "pushState" : "replaceState"]({}, "", qs ? "?" + qs : location.pathname);
}
function applyStateFromURL() {
  applyingState = true;
  const p = new URLSearchParams(location.search);
  let tab = p.get("tab") === "series" ? "groups" : p.get("tab");   // old links still work
  // "picross" is in here but NOT in the nav — it's reached from Home, the palette, or a
  // direct link, and a link has to actually work.
  tab = ["home", "games", "completed", "onOrder", "groups", "stats", "pick", "challenges",
         "health", "shelf", "picross", "recs"].includes(tab) ? tab : "home";
  if (SPECIAL_TABS.includes(tab)) {
    if (tab === "pick") {
      pickState.minutes = +(p.get("mins") || 0);
      const fb = p.get("fb");
      // An old link names a selector that may no longer exist (the Playtime and
      // "By…" groups are fields now) — fall back rather than 404 the tab.
      if (fb) { pickState.filter = pickDecode(fb); pickState.preset = ""; }
      else applyPreset(p.get("sel") || pickState.preset || "backlog");
    }
    if (tab === "recs") {
      const rs = p.get("rs");
      recsState.sort = RECS_SORTS.some((x) => x.id === rs) ? rs : "both";
      recsState.era = RECS_ERAS.some((x) => x.id === p.get("re")) ? p.get("re") : "";
      recsState.genre = p.get("rg") || "";
      recsState.minConf = p.get("rc") ? 0.5 : 0;
      recsState.page = 1;
    }
    if (tab === "challenges") { chState.open = p.get("ch") || null; chState.showAll = null; }
    if (tab === "stats") {
      const s = p.get("s");
      statsState.section = STATS_SECTIONS.some((x) => x.id === s) ? s : "overview";
      const sy = parseInt(p.get("sy"), 10);
      if (sy) statsState.year = sy;
    }
    if (tab === "groups") {
      // ?fr=<franchise> was the old Series link; it means the franchise axis.
      const legacy = p.get("fr");
      groupState.kind = legacy ? "series" : (p.get("g") || null);
      groupState.open = legacy || p.get("gk") || null;
      groupState.q = "";
    }
    applyingState = false; switchTab(tab); return;
  }
  const st = tabState[tab];
  st.view = ["table", "grid", "timeline"].includes(p.get("view")) ? p.get("view") : VIEW_DEFAULT[tab];
  st.combine = COMBINE_DEFAULT[tab];
  PAGE_SIZE = parseInt(p.get("ps"), 10) || 50;
  st.search = p.get("q") || "";
  st.page = parseInt(p.get("page"), 10) || 1;
  const sort = p.get("sort");
  st.sort = sort ? sort.split(",").map((s) => { const [key, dir] = s.split(":"); return { key, dir: dir === "asc" ? "asc" : "desc" }; }) : null;
  st.facets = {};
  for (const [k, v] of p.entries()) if (k.startsWith("f.")) st.facets[k.slice(2)] = new Set(v.split("~"));
  $("#pagesize").value = String(PAGE_SIZE);
  applyingState = false;
  switchTab(tab);
}
const nav = () => syncURL(true);
window.addEventListener("popstate", applyStateFromURL);

function setFreshness() {
  const m = DATA.meta || {};
  const el = $("#freshness");
  if (!m.lastUpdated) { el.textContent = ""; return; }
  const when = new Date(m.lastUpdated).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  el.innerHTML = `data as of<br>${escapeHtml(when)}`;
  if (m.lastError) {
    const banner = $("#banner");
    banner.hidden = false;
    banner.textContent = `⚠ Last Dropbox refresh failed (${m.lastError}). Showing last-known data.`;
  }
}

// ---- boot ---------------------------------------------------------------
async function load() {
  showSkeletons();
  await loadMe();               // admin state first, so nothing renders an admin-only control to the public
  let payload = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch("api/data", { cache: "no-store" });
    if (res.ok) { payload = await res.json(); break; }
    if (res.status === 503) { $("#count").textContent = "Fetching spreadsheet from Dropbox…"; await sleep(1500); continue; }
    throw new Error(`api/data returned ${res.status}`);
  }
  if (!payload) { $("#count").textContent = "Could not load data — is the Dropbox link set?"; return; }
  DATA = payload;
  resetCollections();
  resetHealth();
  resetSearchCache();
  resetGroups();
  _completedFranchises = null;
  if (typeof chReset === "function") chReset();
  resetTaste();
  resetRelations();
  if (typeof resetCatalogue === "function") resetCatalogue();
  for (const k of Object.keys(_cmdkFacets)) delete _cmdkFacets[k];
  const en = DATA.meta && DATA.meta.enrichment;
  ENRICH_ENABLED = !!(en && en.enabled !== false);
  ENRICH_SOURCES = en && en.sources ? Object.keys(en.sources) : [];
  if (ENRICH_ENABLED) updateEnrichStatus(en);
  setFreshness();
  applyStateFromURL();          // restore tab/filters/sort/view from the URL
  loadAllEnrichment();          // global covers + IGDB facets (polls during backfill)
  loadRomm();                   // which games we can actually play in the browser
  loadNas();                    // which games are actually in the ROM library
  loadUploads();                // hand-uploaded box art becomes the cover everywhere
  loadGameRankings();           // frozen fallback critic score for pre-Metacritic games
  loadPrefs();                  // saved views + custom challenges follow you between browsers
  loadValueHistory();           // daily collection-value snapshots (for the trend chart)
  loadRecs();                   // "because you liked …"
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
