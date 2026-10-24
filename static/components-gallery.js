"use strict";

// This page loads renderers, never app.js/chrome.js startup. Fixtures are local;
// account writes and library fetches only exist in explicitly opened live previews.
drawerRow = { _k: "example", title: "Example Adventure", platform: "PC", releaseYear: 2024,
  genre: "Adventure", rating: .9, estimatedTime: 18, condition: "Complete", physicalMedia: "Cartridge" };
DATA = { sheets: { games: { columns: [{ key: "title", primary: true }], rows: [drawerRow] }, completed: { rows: [] } } };
ENRICH.example = { coverUrl: "icon.svg", rating: .88, metascore: 88, hltbBest: 18, geCib: 48 };
GEC.example = { priceLoose: 28, priceCib: 48, priceNew: 70, priceManual: 8, priceBox: 12 };
ADBC.example = { players: 2, controls: "Joystick", buttons: 3, manufacturer: "Example studio", year: 1994, history: "Example cabinet history." };
VNC.example = { description: "An example visual novel synopsis.", rating: .84, hours: 22 };
VGC.example = { units: 1200000, shipped: 1200000, sold: 1100000, console: "PC" };
THC.example = { platform: "Thumby", description: "A tiny adventure with pixel-art graphics.", icon: "icon.svg" };
COOPC.example = { localPlayers: 2, onlinePlayers: 4, campaignCoop: true, dropIn: true, features: ["Shared screen", "Online co-op"] };
SXC.example = { deck: "Verified", protonTier: "platinum", reviewScore: .92, positive: 3864, negative: 336 };
SRC.example = { wrTime: "42m 10s", categories: [{ category: "Any%", time: "42m 10s" }, { category: "100%", time: "1h 18m" }] };
GDC.example = { sections: ["Walkthrough", "Items", "Secrets"], hasWalkthrough: true, url: "https://strategywiki.org/" };
PCGWC.example = { widescreen: "true", ultrawide: "limited", hdr: "false", controller: "true", win64: "true" };
WDC.example = { composers: ["Example composer"], directors: ["Example director"] };
MANC.example = { pages: 32 };
GTDBC.example = { gameId: "DEMO", region: "North America" };

const SOURCE_TEXT = new Map();
const loadSource = async file => {
  if (!SOURCE_TEXT.has(file)) SOURCE_TEXT.set(file, fetch(file).then(r => {
    if (!r.ok) throw new Error(`Cannot load ${file}`);
    return r.text();
  }));
  return SOURCE_TEXT.get(file);
};
let templateDocument, catalogue = [], selectedId, renderVersion = 0;
const say = text => { $("#feedback").textContent = text; };
const example = (id, name, category, file, description, render, setup) =>
  ({ id, name, category, file, description, render, setup, isolated: true });
function template(selector, transform) {
  const node = templateDocument.querySelector(selector)?.cloneNode(true);
  if (!node) throw new Error(`Template component missing: ${selector}`);
  node.hidden = false;
  node.querySelectorAll("[hidden]").forEach(el => { el.hidden = false; });
  node.querySelectorAll("script").forEach(el => el.remove());
  if (node.id === "themeToggle") node.id = "sampleThemeToggle";
  transform?.(node);
  return node.outerHTML;
}
const panels = {
  hltbHtml: () => sourcePanelHtml("hltb", { main: 18, mainPlus: 25, hundred: 40 }),
  metacriticHtml: () => sourcePanelHtml("metacritic", "example"), gameyeHtml: () => sourcePanelHtml("gameye", "example"),
  arcadeHtml: () => sourcePanelHtml("arcade", "example"), vndbHtml: () => sourcePanelHtml("vndb", "example"),
  salesHtml: () => sourcePanelHtml("sales", "example"), thumbyHtml: () => sourcePanelHtml("thumby", "example"),
  coopHtml: () => sourcePanelHtml("coop", "example"), steamxHtml: () => sourcePanelHtml("steamx", "example"),
  speedrunHtml: () => sourcePanelHtml("speedrun", "example"), guidesHtml: () => sourcePanelHtml("guides", "example"),
  pcgwHtml: () => sourcePanelHtml("pcgw", "example"), wikidataHtml: () => sourcePanelHtml("wikidata", "example"),
  physicalHtml: () => sourcePanelHtml("physical", "example"),
};
function dialogExamples() {
  return `<div class="examples" id="dialogs">${buttonHtml("Prompt", { id: "demoPrompt" })}${buttonHtml("Confirm", { id: "demoConfirm" })}${buttonHtml("Modal", { id: "demoModal" })}</div>`;
}
function wireDialogs() {
  $("#demoPrompt").onclick = async () => {
    const value = await uiPrompt({ title: "Name this collection", value: "Favorites" });
    say(value === null ? "Prompt cancelled." : `Saved: ${value}`);
  };
  $("#demoConfirm").onclick = async () => {
    say(await uiConfirm({ title: "Delete collection?", body: "This is a demo.", danger: true, ok: "Delete" }) ? "Demo confirmed." : "Confirmation cancelled.");
  };
  $("#demoModal").onclick = () => {
    const dialog = openUiDialog({ label: "Example modal", panelClass: "ce-narrow", html: '<h3>Example modal</h3><p>Close with the button, backdrop, or Escape.</p>' });
    dialog.host.querySelector(".ce-x").focus();
  };
}
function sampleEntries() {
  const entries = [
    example("panel", "Panel — shared structure", "Detail drawer", "components/panels/panel.js", "One configurable panel with optional heading and reusable rows. Source adapters below provide its game-specific content.", () => panelHtml({headingHtml: "Example panel", bodyHtml: panelRowHtml({labelHtml: "Status", valueHtml: "Available", valueClass: "good"})})),
    example("buttons", "Buttons & action states", "Controls & dialogs", "components/controls/primitives.js", "Default, secondary, destructive, and disabled actions use the shared button builder.", () => `<div class="examples" id="buttons">${buttonHtml("Add game", { id: "exampleAdd" })}${buttonHtml("Cancel", { variant: "ghost" })}${buttonHtml("Delete", { variant: "danger" })}${buttonHtml("Saving…", { disabled: true })}</div>`, () => { $("#buttons").onclick = e => { if (e.target.closest("button")) say(`Demo action: ${e.target.textContent}`); }; }),
    example("search", "Search bars — global, inline & reusable", "Controls & dialogs", "components/controls/data.js", "The real header and listing templates, plus searchField(). Type and clear to inspect field states.", () => template(".field-top") + template(".field-inline") + searchField("sampleSearch", "Search this section…"), () => { $("#searchClear").onclick = () => { $("#search").value = ""; $("#search").focus(); }; }),
    example("account", "User avatar — signed out & signed in", "Navigation & account", "components/navigation/chrome.js", "Account button states use the header's avatar markup and production styles. Account menus and forms are available in the live app.", () => `<div class="account-samples"><div>${template("#account")}<p>Signed out</p></div><div>${template("#account", el => { el.id = "sampleAdmin"; el.classList.add("signed-in"); el.textContent = "A"; el.setAttribute("aria-label", "Account: Admin"); })}<p>Signed in</p></div></div>`),
    example("theme", "Theme toggle", "Controls & dialogs", "index.html", "The header's light/dark segmented control. Both buttons change the gallery theme.", () => template("#themeToggle"), host => { host.querySelectorAll("[data-set-theme]").forEach(btn => btn.onclick = () => setTheme(btn.dataset.setTheme)); }),
    example("views", "View toggles", "Controls & dialogs", "index.html", "Table, grid, and timeline view states, from the listing toolbar.", () => template(".viewtoggle"), host => { host.querySelectorAll("button").forEach(btn => btn.onclick = () => { host.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn)); }); }),
    example("dropdowns", "Dropdowns & sort direction", "Controls & dialogs", "index.html", "Page-size and sort dropdowns use the real result-bar controls.", () => template("#rbControls", el => { el.querySelector("#gridsort").innerHTML = '<option>Title</option><option>Release year</option><option>Rating</option>'; }), host => { host.querySelector("#gridsortdir").onclick = e => { e.currentTarget.textContent = e.currentTarget.textContent === "▼" ? "▲" : "▼"; }; }),
    example("nav", "Navigation drawer & admin destinations", "Navigation & account", "index.html", "Production navigation groups and destinations. The Component library link belongs to the admin group.", () => template(".navdrawer-panel")),
    example("toolbar", "Listing toolbar", "Lists & filtering", "index.html", "Filtering, result count, page size, sorting, and view controls composed from the production template.", () => template(".resultbar")),
    example("icons", "Icon sprite", "Foundations", "index.html", "Every symbol in the app's inline sprite. Icons inherit currentColor; reuse icon(id, size).", () => `<div class="icon-samples">${[...templateDocument.querySelectorAll('symbol[id^="i-"]')].map(el => `<span>${icon(el.id, 24)}${escapeHtml(el.id)}</span>`).join("")}</div>`),
    example("tokens", "Theme colors & surfaces", "Foundations", "style.css", "Existing CSS variables; toggle the theme to compare the same tokens.", () => `<div class="swatches">${["bg","surface","surface-2","text","muted","accent","good","warn","bad","border"].map(token => `<div class="swatch"><i style="background:var(--${token})"></i><code>--${token}</code></div>`).join("")}</div>`),
    example("typography", "Typography & value formatting", "Foundations", "components/foundations/core.js", "Display and body fonts, numeric ratings, hours, currency, dates, and missing values.", () => `<h2>Game title · display</h2><p>Supporting text uses the shared body font.</p><div class="examples">${fmtCell(.92,"rating")} ${fmtCell(18.5,"hours")} ${fmtCell(49.99,"money")} ${fmtCell("2024-06-12","date")} ${fmtCell(null,"text")}</div>`),
    example("chips", "Metadata chips & facet tags", "Controls & dialogs", "components/controls/primitives.js", "Plain chips, facet links, and compact pills use the shared builders and styles.", () => chips(["Adventure","Puzzle",2024]) + chips(["PC","Switch"],"platform") + '<span class="pill">Completed</span>'),
    example("tags", "Collapsible tags", "Detail drawer", "components/drawer/drawer-detail.js", "The actual tagChipsHtml renderer; expand the overflow to inspect long lists.", () => tagChipsHtml(Array.from({length:18}, (_,i) => ({x:`Tag ${i+1}`,fk:"genre"}))), host => { host.querySelector(".tag-more").onclick = e => { host.querySelector(".tag-chips").classList.toggle("collapsed"); e.currentTarget.textContent = host.querySelector(".collapsed") ? "+6 more" : "Show less"; }; }),
    example("empty", "Empty states", "Loading & feedback", "components/controls/primitives.js", "With and without an action. Text and labels are escaped by the shared builder.", () => emptyState("No games match", "Try clearing a filter.", "Clear filters") + emptyState("No saved games", "Save a game to see it here."), () => { $("#emptyAction").onclick = () => say("Demo filters cleared."); }),
    example("dialogs", "Prompts, confirmations & modal shells", "Controls & dialogs", "components/controls/dialog.js", "Interactive examples of the shared lifecycle, including keyboard dismissal and focus restoration.", dialogExamples, wireDialogs),
    example("posters", "Game box tiles — cover, completed, partial & missing", "Game tiles & lists", "components/lists/poster-card.js", "Real posterCardHtml renderer with deterministic sample data. The icon is sample cover art, not a fetched game image.", () => `<div class="poster-samples">${posterCardHtml(drawerRow)}${posterCardHtml({...drawerRow,title:"Completed game"},{cls:"done",note:"Completed"})}${posterCardHtml({...drawerRow,title:"Partial collection",vr:true},{cls:"partial",note:"2 of 4 completed"})}${posterCardHtml({_k:"missing",title:"Missing cover",platform:"PC"})}</div>`),
    example("poster-loading", "Game tile — pending artwork", "Loading & feedback", "components/lists/poster-card.js", "The same poster shell shows a skeleton only while a cover is pending.", () => `<div class="poster-samples"><div class="card">${posterContentHtml({_k:"pending"},posterSummaryHtml({title:"Loading artwork",platform:"PC"}),{pending:true})}</div></div>`),
    example("drawer", "Detail drawer — hero & panel composition", "Detail drawer", "components/drawer/hero.js", "The production hero, statistic strip, and source panels composed with sample data. Open the live app to exercise a complete drawer.", () => `<div class="drawer-sample">${heroHtml(drawerRow,escapeHtml(drawerRow.title))}${panels.hltbHtml()}${panels.gameyeHtml()}${panels.coopHtml()}${panels.physicalHtml()}</div>`),
    example("hero-stats", "Detail statistics", "Detail drawer", "components/drawer/hero.js", "Your rating, critic/player scores, playtime, and value use heroStatsHtml.", () => heroStatsHtml(drawerRow)),
    example("ratings", "Age rating badges", "Detail drawer", "components/drawer/age-badge.js", "Official ESRB, PEGI and CERO artwork with text fallback.", () => `<div class="examples">${["ESRB E","ESRB T","ESRB M","PEGI 7","PEGI 18","CERO Z","USK 12"].map(ageBadgeHtml).join("")}</div>`),
    example("achievements", "Achievements & trophy progress", "Account & personal data", "components/account/mine.js", "The actual achievement renderer shows unlocked, locked, rare, and hidden states.", () => mineAchHtml("steam", {achievements:[{name:"First steps",description:"Start an adventure",unlocked:true,globalPct:80,iconUrl:"icon.svg"},{name:"Explorer",description:"Find every secret",unlocked:true,globalPct:3,iconUrl:"icon.svg"},{name:"Hidden",hidden:true,unlocked:false,iconUrl:"icon.svg"}]})),
    example("progress", "Enrichment progress", "Loading & feedback", "index.html", "Progress track from the app shell.", () => template("#progress", el => { el.querySelector(".progress-bar").style.width = "65%"; })),
    example("toast", "Toast feedback", "Loading & feedback", "index.html", "Production toast styling. showToast owns timed display in the app.", () => template("#toast", el => { el.textContent = "Collection saved"; el.classList.add("show"); })),
    example("refresh", "Icon controls & busy state", "Controls & dialogs", "index.html", "Menu, refresh, disabled and spinning icon controls.", () => `<div class="examples">${template("#navToggle")}${template("#refresh")}${template("#refresh",el=>{el.id="sampleBusy";el.classList.add("spinning");el.disabled=true;})}</div>`),
    example("mobile", "Mobile filter bar & sort sheet", "Navigation & account", "index.html", "The existing phone controls and bottom-sheet shell, shown inline for inspection.", () => template("#fab")+template("#sheet",el=>{el.querySelector("#sheetBody").innerHTML=template("#rbControls");})),
    example("palette", "Command palette shell", "Navigation & account", "index.html", "The app's command field, result area, and keyboard hints. Open the live app for command execution.", () => template(".cmdk-box")),
    example("bars", "Horizontal bar chart", "Charts & statistics", "components/statistics/stats.js", "svgBarsH with sample counts; chart markup comes from the production renderer.", () => svgBarsH([{label:"Adventure",value:42},{label:"RPG",value:28},{label:"Puzzle",value:16}])),
  ];
  for (const [name, render] of Object.entries(panels)) {
    entries.push(example(`panel-${name}`, name.replace(/Html$/,'').replace(/([A-Z])/g,' $1')+" panel variant", "Detail drawer", "components/panels/panel.js", `Variant of the shared panel component using ${name.replace(/Html$/, "")} source data. Missing source data hides the panel in the app.`, render));
  }
  entries.push(
    example("chart-bars", "Bar charts & tooltips", "Charts & statistics", "components/statistics/charts.js", "Production horizontal/vertical chart primitives; hover for detail.", () => barsH([{label:"Adventure",value:42,tip:"42 games in Adventure"},{label:"RPG",value:28},{label:"Puzzle",value:16}]) + barsV([{label:"2022",value:18},{label:"2023",value:24},{label:"2024",value:31}]), wireCharts),
    example("chart-donut", "Donut chart & legend", "Charts & statistics", "components/statistics/charts.js", "The shared category chart uses production donut().", () => donut([{label:"Completed",value:42},{label:"Backlog",value:58}]), wireCharts),
    example("autocomplete", "Autocomplete dropdown", "Controls & dialogs", "components/foundations/core.js", "Type at least two letters (try Adventure) and use arrows, Enter, or Escape.", () => '<div class="px-guess">'+searchField("demoAutocomplete","Find a game…")+'</div>', host => acAttach(host.querySelector("input"), () => ["Adventure Island","Adventure Quest","Puzzle World"].map(t=>({t,f:acFold(t)})))),
  );
  const symbols = {panel:"panelHtml",buttons:"buttonHtml",search:"searchField",account:"applyAdminUI",chips:"chipHtml",tags:"tagChipsHtml",empty:"emptyState",dialogs:"openUiDialog",posters:"posterCardHtml","poster-loading":"posterContentHtml",drawer:"heroHtml","hero-stats":"heroStatsHtml",ratings:"ageBadgeHtml",achievements:"mineAchHtml",bars:"svgBarsH","chart-bars":"barsH","chart-donut":"donut",autocomplete:"acAttach"};
  entries.forEach(entry => { const templates = {
      theme: "navigation/header.html", dropdowns: "lists/toolbar.html",
      views: "lists/toolbar.html", nav: "navigation/sidebar.html", toolbar: "lists/toolbar.html",
      header: "navigation/header.html", progress: "feedback/status.html",
      toast: "feedback/status.html", lightbox: "media/lightbox.html",
      mobile: "navigation/mobile-controls.html", command: "navigation/command-palette.html",
      icons: "foundations/icons.svg",
    };
    if (entry.file === "index.html") entry.file = "components/" + (templates[entry.id] || "navigation/header.html");
    entry.symbol = symbols[entry.id] || (entry.id.startsWith("panel-") ? "sourcePanelHtml" : null);
    const owner = COMPONENT_SOURCES.find(source => source.name === entry.symbol);
    if (owner) entry.file = owner.file;
    if (entry.id.startsWith("panel-")) entry.configurationFile = "components/panels/sources.js"; });
  return entries;
}

const LIVE_SURFACES = [
  ["login", "Sign-in form", "Navigation & account", "components/navigation/chrome.js", "home", ".auth", "openLoginDialog"],
  ["account-menu", "Account menu", "Navigation & account", "components/navigation/chrome.js", "home", ".auth", "openAccountMenu"],
  ["password", "Change-password form", "Navigation & account", "components/navigation/chrome.js", "home", ".auth", "openPasswordDialog"],
  ["platforms", "Linked platform cards & forms", "Account & personal data", "components/account/mine.js", "home", ".plat-wide", "openPlatformsDialog"],
  ["facets", "Facet groups, counts, ranges & exclusions", "Lists & filtering", "components/lists/filters.js", "games", "#facets"],
  ["saved-views", "Saved views & filter presets", "Lists & filtering", "components/lists/filters.js", "games", "#views"],
  ["pagination", "Pagination & page jump", "Lists & filtering", "components/lists/preview.js", "games", "#pager"],
  ["game-table", "Sortable game table & rows", "Game tiles & lists", "components/lists/table.js", "games", "#tablewrap", "table"],
  ["search-results", "Global search results & ownership badges", "Lists & filtering", "components/lists/search.js", "search", "#searchpage"],
  ["drawer-live", "Complete interactive detail drawer", "Detail drawer", "components/drawer/drawer.js", "games", "#drawer", "drawer"],
  ["history", "Personal history, review & quick log", "Detail drawer", "components/drawer/drawer.js", "games", ".mine-section", "drawer"],
  ["carousel", "Screenshot carousel & trailer player", "Media & audio", "components/media/media-carousel.js", "games", ".shots", "drawer"],
  ["relations", "Related games, editions & collection progress", "Detail drawer", "components/drawer/relations.js", "games", ".relations", "drawer"],
  ["manual", "Manual reader, disc & cartridge display", "Shelf & physical media", "components/shelf/media.js", "shelf", "#shelfview"],
  ["shelf", "Shelf boards, spines & physical game boxes", "Shelf & physical media", "components/shelf/shelf.js", "shelf", "#shelfview"],
  ["cover-editor", "Cover editor & crop controls", "Admin & editing", "components/shelf/shelf.js", "shelf", "#shelfview"],
  ["home", "Home hero, shelves & progress cards", "Home & discovery", "components/discovery/home.js", "home", "#home"],
  ["picker", "Game picker, rules & randomizer slots", "Home & discovery", "components/discovery/pick.js", "pick", "#picker"],
  ["groups", "Collection cards & group detail", "Collections & challenges", "components/collections/groups.js", "groups", "#groups"],
  ["challenges", "Challenge cards, progress & builder", "Collections & challenges", "components/collections/challenges.js", "challenges", "#challenges"],
  ["timeline", "Completion timeline & year navigation", "Game tiles & lists", "components/lists/timeline.js", "completed", "#timeline", "timeline"],
  ["stats", "Stat cards, charts, tabs & review summaries", "Charts & statistics", "components/statistics/stats.js", "stats", "#stats"],
  ["events", "Every seasonal banner & event layout", "Events & themes", "components/events/events.js", "events", "#eventsAdmin"],
  ["themes", "Theme selectors, slates, meters & game slots", "Events & themes", "components/events/themes.js", "themes", "#event"],
  ["daily", "Daily game launchers & streaks", "Daily games", "components/games/picross.js", "daily", "#daily"],
  ["picross", "Picross board, clues & tools", "Daily games", "components/games/picross.js", "picross", "#picross"],
  ["dexle", "Dexle clues, guesses & result cards", "Daily games", "components/games/dexle.js", "dexle", "#dexle"],
  ["hilo", "Hi-Lo cards, score & results", "Daily games", "components/games/hilo.js", "hilo", "#hilo"],
  ["jukebox", "Jukebox dock, playlist & volume", "Media & audio", "components/media/jukebox.js", "home", "#jukebox"],
  ["recommendations", "Recommendation cards & explanations", "Recommendations & wishlist", "components/recommendations/recs.js", "recs", "#grid"],
  ["wishlist", "Wishlist pricing, deals & bundles", "Recommendations & wishlist", "components/recommendations/wishlist.js", "wishlist", "#grid"],
  ["swipe", "Swipe deck & action controls", "Recommendations & wishlist", "components/recommendations/swipe.js", "swipe", "#swipe"],
  ["translations", "Translation cards, status & filters", "Recommendations & wishlist", "components/recommendations/translations.js", "translations", "#translations"],
  ["health", "Health dashboard, checks & match status", "Admin & editing", "components/admin/health.js", "health", "#health"],
  ["add-game", "Add-game search & editor", "Admin & editing", "components/admin/edits.js", "games", ".ed-ce", "openAddGame"],
  ["pending", "Pending edits, conflicts & staged rows", "Admin & editing", "components/admin/edits.js", "games", ".ed-ce", "openPendingEdits"],
];
const categorySelect = $("#libraryCategory");
const libraryEmbedded = window.parent !== window;
const libraryParams = new URLSearchParams(location.search);
if (libraryEmbedded) document.documentElement.classList.add("library-embedded");
function setTheme(theme, notifyParent = true) {
  if (!["light", "dark"].includes(theme)) return;
  if (libraryEmbedded && notifyParent) parent.postMessage({ type: "component-library-theme", theme }, location.origin);
  document.documentElement.dataset.theme = theme;
  $("#themeToggle").setAttribute("aria-pressed", String(theme === "light"));
  document.querySelectorAll("[data-set-theme]").forEach(btn => btn.classList.toggle("on", btn.dataset.setTheme === theme));
  const frame = $("#componentPreview iframe");
  if (frame?.contentDocument) frame.contentDocument.documentElement.dataset.theme = theme;
}
function filterCatalogue() {
  const query = $("#librarySearch").value.trim().toLowerCase();
  const category = categorySelect.value;
  const entries = catalogue.filter(entry => (!category || entry.category === category) &&
    `${entry.name} ${entry.file} ${entry.category} ${entry.description || ""}`.toLowerCase().includes(query));
  $("#resultCount").textContent = `${entries.length} components`;
  $("#componentList").innerHTML = entries.map(entry => `<button type="button" data-entry="${escapeHtml(entry.id)}" aria-current="${entry.id === selectedId}">${escapeHtml(entry.name)}<small>${entry.isolated ? "Isolated example" : "App context"} · ${escapeHtml(entry.file)}</small></button>`).join("") || '<p>No components match. Try another name or category.</p>';
}
function livePreview(entry, token) {
  const host = $("#componentPreview");
  const note = document.createElement("p");
  note.className = "fixture-note";
  note.textContent = "Live app preview — uses your library and signed-in account. Actions here affect the app. Open a game or use the screen controls to inspect data-dependent states.";
  host.replaceChildren(note);
  const frame = document.createElement("iframe");
  frame.title = `${entry.name} in Gamedex`;
  frame.src = `index.html?tab=${encodeURIComponent(entry.tab || "games")}`;
  frame.loading = "lazy";
  host.appendChild(frame);
  frame.addEventListener("load", async () => {
    const target = entry.selector || (entry.category === "Detail drawer" ? "#drawer" : null);
    for (let attempt = 0; attempt < 60 && token === renderVersion && frame.isConnected; attempt++) {
      const doc = frame.contentDocument, app = frame.contentWindow;
      doc.documentElement.dataset.theme = document.documentElement.dataset.theme || "dark";
      if (attempt === 0) {
        // Keep the embedded app within its own viewport; do not register a second
        // gallery event handler in it or copy its rendered HTML into this page.
        const style = doc.createElement("style");
        style.textContent = '.library-highlight { outline:3px solid var(--accent) !important; outline-offset:3px; }';
        doc.head.appendChild(style);
      }
      const needsDrawer = entry.action === "drawer" || entry.category === "Detail drawer";
      if (needsDrawer && doc.querySelector("#overlay")?.hidden) {
        const card = doc.querySelector("#grid .card");
        if (card) card.click();
      } else if (entry.action === "table" || entry.action === "timeline") {
        // The toolbar exists before startup assigns activeTab and tabState.
        // Wait for real rows, not the initial table/skeleton, before switching.
        if (!doc.querySelector("#grid .card[data-k], #tbody tr[data-k]")) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        doc.querySelector(entry.action === "table" ? "#viewTable" : "#viewTimeline")?.click();
        entry = { ...entry, action: null };
      } else if (entry.action && typeof app[entry.action] === "function" && doc.querySelector("#account.signed-in")) {
        app[entry.action]();
        entry = { ...entry, action: null };
      }
      const element = target && doc.querySelector(target);
      if (element && element.getBoundingClientRect().height && !element.closest("[hidden]")) {
        element.classList.add("library-highlight");
        element.scrollIntoView({ block: "nearest" });
        note.textContent += " The available component is outlined. Some states require a game with matching data.";
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (token === renderVersion) note.textContent += " This component is not currently visible; use the preview's controls to open it. Its source is available below.";
  });
}
async function selectEntry(id, updateHash = true) {
  const entry = catalogue.find(item => item.id === id || item.legacyId === id) || catalogue[0];
  selectedId = entry.id;
  const token = ++renderVersion;
  if (libraryEmbedded) parent.postMessage({ type: "component-library-selection", id: entry.id }, location.origin);
  else if (updateHash) history.replaceState(null, "", `#${encodeURIComponent(entry.id)}`);
  $("#componentCategory").textContent = entry.category;
  $("#componentTitle").textContent = entry.name;
  $("#componentDescription").textContent = entry.description || "Production UI renderer. Inspect its implementation below, or open the app context to see it with your library data.";
  $("#componentFullSource").href = entry.file;
  $("#componentOwner").textContent = `Source: static/${entry.file}${entry.line ? `:${entry.line}` : ""}`;
  $("#componentUsage").textContent = entry.isolated
    ? "This example calls production builders or clones the current app template. Change the owning implementation, then update this example when its contract changes."
    : "Reuse this implementation in its owning module. Read its parameters, state dependencies, and callers before changing it; preserve selectors, event wiring, and accessibility.";
  $("#feedback").textContent = "";
  $("#componentPreview").replaceChildren();
  $("#componentActions").innerHTML = buttonHtml("Preview in app", { id: "previewLive", variant: "ghost" }) + ` <a class="btn ghost" href="index.html?tab=${encodeURIComponent(entry.tab || "games")}" target="_blank" rel="noopener">Open app ↗</a>`;
  if (entry.configurationFile) {
    const link = document.createElement("a");
    link.className = "btn ghost"; link.href = entry.configurationFile;
    link.textContent = "Source configuration";
    $("#componentActions").appendChild(link);
  }
  $("#previewLive").onclick = () => livePreview(entry, token);
  filterCatalogue();
  if (entry.render) {
    try {
      $("#componentPreview").innerHTML = entry.render();
      entry.setup?.($("#componentPreview"));
      settleCachedCovers($("#componentPreview"));
    } catch (error) {
      $("#componentPreview").innerHTML = `<p class="preview-error">Example failed: ${escapeHtml(error.message)}</p>`;
      console.error(error);
    }
  } else {
    $("#componentPreview").innerHTML = '<p>This component needs its page state or library data. Select <b>Preview in app</b> to load it in context. The implementation is available below.</p>';
  }
  $("#componentSource").textContent = "Loading source…";
  try {
    const source = await loadSource(entry.file);
    if (token !== renderVersion) return;
    const lines = source.split("\n");
    const symbolLine = entry.symbol ? lines.findIndex(line => line.includes(`function ${entry.symbol}(`) || line.includes(`const ${entry.symbol} =`)) : -1;
    const start = Math.max(0, symbolLine >= 0 ? symbolLine : (entry.line || 1) - 1);
    $("#componentSource").textContent = lines.slice(start, start + 100).map((line, index) => `${start + index + 1}  ${line}`).join("\n");
  } catch (error) { if (token === renderVersion) $("#componentSource").textContent = error.message; }
}
async function initLibrary() {
  const source = await loadSource("index.html");
  templateDocument = new DOMParser().parseFromString(source, "text/html");
  const sprite = templateDocument.querySelector('svg[aria-hidden="true"]');
  document.body.prepend(sprite.cloneNode(true));
  const examples = sampleEntries();
  const surfaces = LIVE_SURFACES.map(([id,name,category,file,tab,selector,action]) => ({ id:`live-${id}`,name,category,file,tab,selector,action }));
  const sources = COMPONENT_SOURCES.map(entry => {
    const context = surfaces.find(surface => surface.file === entry.file);
    if (context) entry = { ...entry, tab: context.tab, selector: context.selector, action: context.action };
    const sample = examples.find(item => item.symbol === entry.name && item.file === entry.file);
    return sample ? { ...entry, render: sample.render, setup: sample.setup, isolated: true, description: sample.description } : entry;
  });
  catalogue = [...examples, ...surfaces, ...sources];
  for (const category of [...new Set(catalogue.map(entry => entry.category))].sort()) {
    const option = document.createElement("option"); option.value = category; option.textContent = category; categorySelect.appendChild(option);
  }
  $("#libraryCounts").textContent = `${examples.length} isolated examples · ${surfaces.length} app surfaces · ${COMPONENT_SOURCES.length} indexed UI implementations`;
  $("#librarySearch").oninput = filterCatalogue;
  categorySelect.onchange = filterCatalogue;
  $("#componentList").onclick = event => { const button = event.target.closest("[data-entry]"); if (button) selectEntry(button.dataset.entry); };
  $("#themeToggle").onclick = () => setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  window.addEventListener("hashchange", () => selectEntry(decodeURIComponent(location.hash.slice(1)), false));
  setTheme(libraryParams.get("theme") || document.documentElement.dataset.theme || "dark", false);
  window.addEventListener("message", event => {
    if (!libraryEmbedded || event.origin !== location.origin || event.source !== parent ||
        event.data?.type !== "component-library-view") return;
    setTheme(event.data.theme, false);
    if (event.data.id !== selectedId) selectEntry(event.data.id, false);
  });
  await selectEntry((libraryEmbedded ? libraryParams.get("component") : decodeURIComponent(location.hash.slice(1))) || "search", false);
  document.body.dataset.libraryReady = "true";
}
initLibrary().catch(error => { say(`Unable to load the catalogue: ${error.message}`); console.error(error); });
