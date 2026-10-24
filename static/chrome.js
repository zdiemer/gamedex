"use strict";

/* Everything around the results: the header controls, the mobile sheet, the
   theme toggle, the command palette, and signing in.

   Last of app.js's own files. Startup waits for DOMContentLoaded so the later
   feature scripts have defined their shared globals before load() uses them. */

// The top-bar box is the GLOBAL search: it lands on the cross-sheet "search" page (search.js)
// and answers "do I already own this / is it on order?" — separate from each listing's own
// inline filter (#tabsearch, below). First keystroke opens the page (one history entry); typing
// there just refilters (replaceState, so it doesn't flood history). renderSearch() debounces the
// heavy result build itself, so every keystroke coalesces.
$("#search").addEventListener("input", (e) => {
  GLOBAL_SEARCH.q = e.target.value;
  if (activeTab !== "search") { switchTab("search"); syncURL(true); }
  else { renderSearch(); syncURL(false); }
});
$("#search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }   // results are already live
});
// The round ✕ in the box. Clearing goes through the input handler above so the search page
// and URL stay in step; visibility is pure CSS (:placeholder-shown). mousedown is swallowed
// so focus never leaves the input — on a phone that would collapse the keyboard mid-search.
$("#searchClear").addEventListener("mousedown", (e) => e.preventDefault());
$("#searchClear").addEventListener("click", () => {
  const s = $("#search");
  s.value = "";
  s.dispatchEvent(new Event("input", { bubbles: true }));
  s.focus();
});

// The inline per-page filter — the OLD top-bar behaviour, now living on each listing so it's
// clearly "narrow THIS list" rather than a misleadingly global-looking box.
let tabSearchTimer = null;
$("#tabsearch").addEventListener("input", (e) => {
  const st = tabState[activeTab];
  if (!st) return;             // a special tab has no results list to filter
  // Beginning a search is a FRESH query — it shouldn't inherit facets you'd selected before
  // (and then paged away from). Clear them as the search STARTS (empty → typed), not on every
  // keystroke, so you can still add facets to narrow an active search.
  const starting = !st.search && e.target.value;
  st.search = e.target.value;
  st.page = 1;
  if (starting) st.facets = {};
  // Coalesce keystrokes — filtering 14.7k rows and rebuilding every facet is fast, but not
  // fast enough to do between two quick keypresses.
  clearTimeout(tabSearchTimer);
  tabSearchTimer = setTimeout(() => { renderAll(); syncURL(false); }, 140);
});
$("#tabsearch").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
});
// closest(), not e.target: a tab now contains an <svg> and a <span>, so the click
// lands on the icon and e.target.dataset.tab is undefined. This is exactly what
// broke navigation when the emoji became icons.
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) { goTab(btn.dataset.tab); setNav(false); }
});

// ---- nav drawer (the tab strip, now behind the ☰) ------------------------
function setNav(open) {
  $("#navdrawer").hidden = !open;
  $("#navToggle").setAttribute("aria-expanded", open ? "true" : "false");
  syncScrollLock();                 // lock the page behind the drawer (it's a full overlay)
}
$("#navToggle").addEventListener("click", () => setNav(true));
$("#navClose").addEventListener("click", () => setNav(false));
$("#navBackdrop").addEventListener("click", () => setNav(false));
// Attract mode sits at the foot of the menu now — close the drawer, then take the screen.
$("#navAttract").addEventListener("click", () => { setNav(false); if (typeof openAttract === "function") openAttract(); });
$("#navJukebox").addEventListener("click", () => { setNav(false); if (typeof jbToggle === "function") jbToggle(); });
$("#clear").addEventListener("click", () => {
  const st = tabState[activeTab];
  st.search = ""; st.facets = {}; st.page = 1;
  $("#tabsearch").value = "";
  renderAll();
  nav();
});
$("#resetsort").addEventListener("click", () => {
  tabState[activeTab].sort = null;
  tabState[activeTab].page = 1;
  renderAll();
  nav();
});
$("#pagesize").addEventListener("change", (e) => {
  const st = tabState[activeTab];
  if (st) st.pageSize = parseInt(e.target.value, 10) || PAGE_SIZE_DEFAULT;
  tabState[activeTab].page = 1;
  renderTable(currentFiltered);
  nav();
});
function setView(mode) {
  tabState[activeTab].view = mode;      // renderTable paints the active state
  renderTable(currentFiltered);
}
$("#viewTable").addEventListener("click", () => { setView("table"); nav(); });
$("#viewGrid").addEventListener("click", () => { setView("grid"); nav(); });
$("#viewTimeline").addEventListener("click", () => { setView("timeline"); nav(); });
// ---- Mobile floating controls ------------------------------------------
// On mobile the page is one scroller, so the result bar scrolls away. Move the
// sort/per-page/view cluster into a bottom sheet and reach it from a FAB.
const MOBILE = window.matchMedia("(max-width: 760px)");
function placeControls() {
  const ctrls = $("#rbControls");
  const home = MOBILE.matches ? $("#sheetBody") : $(".resultbar");
  if (ctrls.parentElement !== home) home.appendChild(ctrls);
  if (!MOBILE.matches) setSheet(false);
  // One phrase both widths: names what you're searching without naming the
  // data behind it. Short enough for the mobile bar as-is.
  const s = $("#search");
  if (s) s.placeholder = "Search my games…";
}
function setSheet(open) {
  $("#sheet").hidden = !open;
  $("#sheetBackdrop").hidden = !open;
}
MOBILE.addEventListener("change", placeControls);
placeControls();

$("#fabFilters").addEventListener("click", () => setFacets(true));
$("#fabSort").addEventListener("click", () => setSheet(true));
$("#fabTop").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
// Mobile: the floating filter bar is fixed at the bottom and sits over the pager.
// Tuck it away on scroll-down (you're heading for the page controls), bring it
// back on scroll-up. Desktop never sees it (.fab is display:none > 760px).
//
// The class is flipped ONCE per sustained direction change, never per frame: we
// accumulate travel in the current direction and only cross a threshold decides
// it, with hysteresis so a fast fling (or iOS momentum's end-of-scroll bounce)
// can't thrash it. That keeps the CSS transition on its own clock — the slide
// always plays out fully, at the same pace, no matter how fast you scrolled.
(() => {
  const fab = $("#fab");
  if (!fab) return;
  const HIDE_AT = 48, SHOW_AT = 24, TOP = 80, BOTTOM = 96;   // px thresholds
  let lastY = Math.max(0, window.scrollY), acc = 0, tucked = false, ticking = false;
  const set = (v) => { if (v !== tucked) { tucked = v; fab.classList.toggle("fab-tucked", v); } acc = 0; };
  /* "Jump to top" earns its spot by there being somewhere to jump FROM, and by the jump
     being on your mind — which is when you're heading UP. At the top it's dead weight (and
     on tabs where Filters/Sort are hidden it was the bar's ONLY button, a lone ↑ over a
     page you haven't scrolled). Revealed only on an upward delta, so scrolling down past
     the threshold doesn't pop it into the still-visible bar just to tuck it away again. */
  const top = $("#fabTop");
  top.hidden = lastY <= TOP;
  const update = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY), dy = y - lastY;
    lastY = y;
    if (y <= TOP) top.hidden = true;
    else if (dy < 0) top.hidden = false;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    // Near the bottom the pager is on screen, so the bar must not be. Force it
    // hidden — but only when the page scrolls enough that you can bring it back
    // by scrolling up; on a short page just hold state so the controls aren't
    // stranded. This also absorbs iOS's end-of-scroll bounce (a phantom upward
    // delta that would otherwise re-show it right over the pager).
    if (maxY - y <= BOTTOM) { if (maxY > 240) set(true); else acc = 0; return; }
    if (y <= TOP) { set(false); return; }          // always reveal near the top
    if (!dy) return;
    if ((dy > 0) !== (acc > 0)) acc = 0;           // direction flipped — reset run
    acc += dy;
    if (!tucked && acc > HIDE_AT) set(true);
    else if (tucked && acc < -SHOW_AT) set(false);
  };
  window.addEventListener("scroll", () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
})();
$("#sheetClose").addEventListener("click", () => setSheet(false));
$("#sheetBackdrop").addEventListener("click", () => setSheet(false));
// Picking a sort/view is the whole point of the sheet — dismiss it so the
// results are visible immediately. (The controls' own handlers still run.)
$("#sheetBody").addEventListener("change", () => setSheet(false));
$("#sheetBody").addEventListener("click", (e) => {
  if (e.target.closest(".viewtoggle, .dirbtn")) setSheet(false);
});

// ---- theme ---------------------------------------------------------------
// An explicit choice wins and persists; otherwise follow the OS.
const THEME_KEY = "gamedex.theme";
// data-theme is ALWAYS set explicitly. Leaving it off means "dark" to the CSS
// but "whatever the OS says" to JS, and the two disagree the moment the OS
// prefers light — the toggle then computes light→dark and appears to do nothing.
function currentTheme() {
  return localStorage.getItem(THEME_KEY)
    || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
}
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  // Light the segment for the mode you're IN (sun = light, moon = dark) — the control shows
  // your current theme rather than making you decode a lone glyph.
  document.querySelectorAll("#themeToggle .th-opt").forEach((b) =>
    b.classList.toggle("on", b.dataset.setTheme === t));
}
applyTheme(currentTheme());
// The shortcut differs by platform, so the keycap should too.
{
  const mod = $("#cmdkMod");
  if (mod && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)) mod.textContent = "\u2318";
}
// The whole control is one toggle button: a click anywhere in the pill flips to the
// other theme — the two segments just show which mode you're in, they aren't targets.
{
  const seg = $("#themeToggle");
  if (seg) seg.addEventListener("click", () => {
    const t = currentTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    if (activeTab === "stats") renderStats();     // recolour the charts' text
  });
}

// ---- command palette (⌘K / Ctrl-K) ---------------------------------------
// 14.7k games is too many to browse to. Type a few letters, hit enter.
const cmdk = { open: false, sel: 0, results: [] };

// Read the tab list from the live header, so the palette can never go stale — adding
// or removing a tab (Shelf in, Reviews out) updates it for free.
function cmdkTabs() {
  // Skip hidden tabs (e.g. Wishlist for the public) — the palette shouldn't reach what
  // the nav deliberately doesn't show.
  const tabs = [...document.querySelectorAll("#tabs button[data-tab]")].filter((b) => !b.hidden).map((b) => ({
    id: b.dataset.tab,
    label: (b.querySelector("span") || {}).textContent || b.dataset.tab,
    icon: ((b.querySelector("use") || {}).getAttribute?.("href") || "#i-home").slice(1),
  }));
  // Picross has no nav button on purpose — it's a once-a-day thing, and the nav is already
  // ten deep. It lives on Home. But it must still be REACHABLE, so the palette knows it,
  // and goTab gives it a real ?tab=picross URL you can link, reload and go Back out of.
  tabs.push({ id: "picross", label: "Daily Picross", icon: "i-target" });
  tabs.push({ id: "dexle", label: "Dexle — guess the game", icon: "i-dice" });
  tabs.push({ id: "hilo", label: "Daily Hi-Lo — higher or lower", icon: "i-trend" });
  tabs.push({ id: "daily", label: "Daily games", icon: "i-dice" });
  // Seasonal, so it comes and goes: in season the palette reaches the event page like any
  // other, out of season it isn't offered (the URL still works — a link people saved in
  // October shouldn't 404 in March).
  if (typeof spookInSeason === "function" && spookInSeason())
    tabs.push({ id: "spooktober", label: "Spooktober — your October calendar", icon: "i-pumpkin" });
  // The rest of the seasonal events, on the same terms: offered while they're on, always
  // reachable by URL. Out of season they'd be eleven dead entries in a palette that already
  // lists twenty (events.js owns the windows).
  if (typeof EV !== "undefined") {
    for (const ev of EV.list) {
      if (ev.external || !evBannerOn(ev)) continue;
      tabs.push({ id: ev.id, label: `${ev.name}: ${ev.blurb || ev.structure}`, icon: ev.icon });
    }
    if (typeof IS_ADMIN !== "undefined" && IS_ADMIN)
      tabs.push({ id: "events", label: "Seasonal events: the preview board", icon: "i-calendar" });
  }
  // Home lost its nav button (the logo goes there now), but the palette should still reach it.
  tabs.unshift({ id: "home", label: "Home", icon: "i-home" });
  return tabs;
}

// Menu entries that aren't tabs — they DO something rather than switch a section.
// Attract mode lives in the nav foot, so the tab scan misses it; list it here so the
// palette still reaches every corner of the menu.
function cmdkActions() {
  const acts = [];
  if (typeof openAttract === "function")
    acts.push({ kind: "Action", label: "Attract mode", run: () => openAttract() });
  // The write surfaces (edits.js) are dialogs rather than tabs, so the tab scan
  // misses them the same way it misses Attract mode. Admin-only, like their buttons.
  if (typeof IS_ADMIN !== "undefined" && IS_ADMIN) {
    if (typeof openAddGame === "function")
      acts.push({ kind: "Action", label: "Add a game", run: () => openAddGame() });
    if (typeof openPendingEdits === "function")
      acts.push({ kind: "Action", label: "Pending edits", run: () => openPendingEdits() });
  }
  return acts;
}

function cmdkCandidates(q) {
  const out = [];
  const needle = q.toLowerCase().trim();
  if (!needle) {
    return [
      ...cmdkTabs().map((t) => ({ kind: "Tab", label: t.label, icon: t.icon, run: () => goTab(t.id) })),
      ...cmdkActions(),
    ];
  }
  // Tabs
  for (const t of cmdkTabs()) {
    if (t.label.toLowerCase().includes(needle))
      out.push({ kind: "Tab", label: t.label, icon: t.icon, run: () => goTab(t.id) });
  }
  // Actions (Attract mode, …)
  for (const a of cmdkActions()) {
    if (a.label.toLowerCase().includes(needle)) out.push(a);
  }
  // Games — prefix matches first, then substring. Capped, so typing stays fast.
  const rows = (DATA.sheets.games || {}).rows || [];
  const pre = [], sub = [];
  for (const r of rows) {
    const t = String(r.title || "").toLowerCase();
    if (!t) continue;
    const i = t.indexOf(needle);
    if (i === 0) pre.push(r);
    else if (i > 0) sub.push(r);
    if (pre.length >= 30) break;
  }
  for (const r of [...pre, ...sub].slice(0, 24)) {
    out.push({
      kind: "Game", label: String(r.title), sub: [r.platform, r.releaseYear].filter(Boolean).join(" · "),
      // No nav() — openDrawer calls syncURL itself, and it writes the freshly-reset
      // tab along with ?game=. A nav() here would push a duplicate history entry.
      row: r, run: () => { resetTab("games"); switchTab("games"); openDrawer(r, "games"); },
    });
  }
  // Facet values on the current tab (platform / genre / franchise / …)
  for (const f of cmdkFacetIndex()) {
    if (out.length > 40) break;
    if (!f.lower.includes(needle)) continue;
    out.push({
      kind: f.label, label: f.val,
      run: () => {
        const st = tabState[activeTab];
        st.facets[f.key] = new Set([f.val]);
        st.page = 1;
        renderAll(); nav();
      },
    });
  }
  return out.slice(0, 40);
}

// Distinct facet values for the active tab, computed once. Scanning 14.7k rows
// on every keystroke would make the palette crawl.
const _cmdkFacets = {};
function cmdkFacetIndex() {
  if (_cmdkFacets[activeTab]) return _cmdkFacets[activeTab];
  // Special tabs (Home, Stats, Shelf…) have no sheet, so columns()/facetCols() throw —
  // which is exactly why the palette worked on All Games and Completed but broke the
  // moment you typed anywhere else. No sheet, no facet values.
  if (!DATA.sheets[activeTab]) return (_cmdkFacets[activeTab] = []);
  const out = [];
  const rows = (sheet() || { rows: [] }).rows || [];
  for (const col of facetCols()) {
    if (col.virtual) continue;
    const seen = new Set();
    for (const row of rows) {
      for (const it of rowFacetItems(row, col)) {
        if (seen.has(it.key)) continue;
        seen.add(it.key);
        out.push({ key: col.key, label: col.label, val: String(it.key), lower: String(it.key).toLowerCase() });
      }
    }
  }
  return (_cmdkFacets[activeTab] = out);
}

function cmdkSearch() {
  cmdk.results = DATA ? cmdkCandidates($("#cmdkInput").value) : [];
  cmdk.sel = 0;
  cmdkRender();
}
function cmdkRun(i) {
  const r = cmdk.results[i];
  setCmdk(false);
  if (r) r.run();
}
function setCmdk(open) {
  cmdk.open = open;
  $("#cmdkOverlay").hidden = !open;
  if (open) {
    $("#cmdkInput").value = "";
    cmdkSearch();
    $("#cmdkInput").focus();
  }
  syncScrollLock();
}
$("#cmdk").addEventListener("click", () => setCmdk(true));
$("#cmdkOverlay").addEventListener("click", (e) => { if (e.target === $("#cmdkOverlay")) setCmdk(false); });
$("#cmdkInput").addEventListener("input", cmdkSearch);
$("#cmdkInput").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); cmdk.sel = Math.min(cmdk.results.length - 1, cmdk.sel + 1); cmdkRender(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); cmdk.sel = Math.max(0, cmdk.sel - 1); cmdkRender(); }
  else if (e.key === "Enter") { e.preventDefault(); cmdkRun(cmdk.sel); }
});

// Wordmark = home: back to the landing page with nothing filtered/sorted.
$("#brand").addEventListener("click", () => {
  // Every tab, not just Home: the wordmark is the "put it all back" affordance. resetTab
  // covers the special tabs' own state too (TAB_RESET, core.js), so the picker/challenge/
  // shelf state this used to clear by hand is now cleared by the tabs that own it.
  for (const t of TABS) resetTab(t);
  for (const t of Object.keys(TAB_RESET)) resetTab(t);
  $("#search").value = "";
  setFacets(false);
  switchTab("home");
  nav();
});
$("#facetToggle").addEventListener("click", () => setFacets(!$("#facets").classList.contains("open")));
$("#facetBackdrop").addEventListener("click", () => setFacets(false));
$("#gridsort").addEventListener("change", (e) => {
  const st = tabState[activeTab];
  const k = e.target.value;
  const def = DEFAULT_SORT[activeTab];
  if (def && def[0].key === k) {
    st.sort = null;          // picking the tab's default column just restores the default
                             // (e.g. games' releaseDateDesc, which ranks "Early Access" newest)
  } else {
    const c = sortMeta(k);
    st.sort = [{ key: k, dir: c && c.type === "text" ? "asc" : "desc",
                 type: c && c.type, kind: c && c.kind }];
  }
  st.page = 1;
  renderTable(currentFiltered);
  nav();
});
$("#gridsortdir").addEventListener("click", () => {
  const st = tabState[activeTab];
  if (st.sort && st.sort.length) {
    st.sort[0].dir = st.sort[0].dir === "asc" ? "desc" : "asc";
    st.page = 1;
    renderTable(currentFiltered);
    nav();
  }
});
$("#drawerBack").addEventListener("click", drawerBack);
$("#drawerClose").addEventListener("click", () => closeDrawer());
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeDrawer(); });
$("#drawerBody").addEventListener("click", (e) => {
  // "+N more" on the Tags row reveals the collapsed tail in place. Handle it before the
  // facet-link path — the button carries the .chip class but must not filter anything.
  const more = e.target.closest(".tag-more");
  if (more) {
    e.preventDefault(); e.stopPropagation();
    const wrap = more.closest(".tag-chips");
    if (wrap) wrap.classList.remove("collapsed");
    more.remove();
    return;
  }
  // "Not interested" on a recommendation: dismiss it and close the drawer.
  const rn = e.target.closest(".rec-dismiss");
  if (rn) {
    e.preventDefault(); e.stopPropagation();
    if (typeof recsDismiss === "function") recsDismiss(+rn.dataset.recNo);
    closeDrawer();
    return;
  }
  const a = e.target.closest(".facet-link");
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  applyDrawerFacet(a.dataset.fk, a.dataset.fv);
});
$("#lbClose").addEventListener("click", closeLightbox);
$("#lbPrev").addEventListener("click", (e) => { e.stopPropagation(); lbShow(-1); });
$("#lbNext").addEventListener("click", (e) => { e.stopPropagation(); lbShow(1); });
$("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
document.addEventListener("keydown", (e) => {
  if (lightboxOpen()) {                       // lightbox owns the keys while open
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") lbShow(-1);
    else if (e.key === "ArrowRight") lbShow(1);
    return;
  }
  if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    setCmdk(!cmdk.open);
    return;
  }
  if (e.key !== "Escape") return;
  if (cmdk.open) setCmdk(false);
  else if (!$("#navdrawer").hidden) setNav(false);
  else if (!$("#sheet").hidden) setSheet(false);
  else if (typeof pickSheetDismiss === "function" && pickSheetDismiss()) { /* Pick's criteria sheet */ }
  // Esc unwinds the drawer history one step at a time, then closes.
  else if (drawerCanBack() && !$("#overlay").hidden) drawerBack();
  else closeDrawer();
});

/* ---- admin login -----------------------------------------------------------
   One privileged account. The public gets a read-only app; signing in reveals the
   write controls (fix mappings, box art, refresh) and the sensitive reads (NAS, RomM),
   which the server gates too — this only decides what's shown. */
async function loadMe() {
  try {
    // The head already asked (index.html). Take that answer once; any later call — the
    // login/logout paths re-run this — goes to the network as before.
    const pre = window.__boot && window.__boot.me;
    if (pre) window.__boot.me = null;
    const r = (await pre) || await fetch("api/me");
    if (r.ok) { ME = await r.json(); IS_ADMIN = !!ME.authenticated; }
  } catch (_) { /* offline: stay public */ }
  applyAdminUI();
}

let authDialog = null;
function closeAuthModal() { authDialog?.close(); }

$("#account").addEventListener("click", () => {
  if (IS_ADMIN) openAccountMenu(); else openLoginDialog();
});

$("#refresh").addEventListener("click", async () => {
  const btn = $("#refresh");
  btn.classList.add("spinning"); btn.disabled = true;
  try {
    const res = await fetch("api/refresh", { method: "POST" });
    const j = await res.json();
    if (res.ok) {
      const dres = await fetch("api/data", { cache: "no-store" });
      if (dres.ok) {
        DATA = await dres.json();
        resetDerived();
        buildWishlistSheet();
        const en = DATA.meta && DATA.meta.enrichment;
        ENRICH_ENABLED = !!(en && en.enabled !== false);
        setFreshness(); renderAll(); loadAllEnrichment();
      }
      showToast(j.changed ? "Library updated" : "Already up to date", j.changed ? "i-check" : null);
    } else showToast("Refresh failed: " + (j.error || res.status));
  } catch (_) { showToast("Refresh failed"); }
  finally { btn.classList.remove("spinning"); btn.disabled = false; }
});

// A warm API response can resume load() before later deferred scripts have
// defined resetCollections/resetTaste/etc. DOMContentLoaded follows all of them;
// the head's data and cover fetches still run in parallel with script loading.
document.addEventListener("DOMContentLoaded", () => {
  load().catch((err) => { console.error(err); $("#count").textContent = "Error: " + err.message; });
}, { once: true });
