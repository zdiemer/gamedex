"use strict";

/* Everything around the results: the header controls, the mobile sheet, the
   theme toggle, the command palette, and signing in.

   Last of app.js's own files, and it ends by calling load() — which is what starts
   the app. That position is deliberate and inherited: load() awaits almost
   immediately, so home.js/shelf.js/challenges.js and the rest parse while the first
   fetch is in flight, and by the time it resumes, every renderer it calls exists. */

let searchTimer = null;
$("#search").addEventListener("input", (e) => {
  const st = tabState[activeTab];
  if (!st) return;             // a special tab (Home, Stats…) has no results list to filter
  // Beginning a search is a FRESH query — it shouldn't inherit facets you'd selected
  // before (and then paged away from). Clear them as the search STARTS (empty → typed),
  // not on every keystroke, so you can still add facets to narrow an active search.
  const starting = !st.search && e.target.value;
  st.search = e.target.value;
  st.page = 1;
  if (starting) st.facets = {};
  // Coalesce keystrokes. Filtering 14.7k rows and rebuilding every facet is
  // fast now, but not fast enough to do it between two quick keypresses.
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    renderAll();
    syncURL(false);        // replace so typing doesn't flood history
  }, 140);
});
// Enter from a tab with no results list of its own (Home, Stats, Shelf, …) takes the
// query to All Games and shows it there, which is what a search box implies.
$("#search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (["games", "completed", "onOrder"].includes(activeTab)) { e.target.blur(); return; }
  const q = e.target.value;
  // A fresh search from the header — start All Games clean rather than carrying whatever
  // facets were left selected there.
  tabState.games = { ...freshState(), view: tabState.games.view, combine: tabState.games.combine };
  tabState.games.search = q;
  switchTab("games");
  nav();
});
// closest(), not e.target: a tab now contains an <svg> and a <span>, so the click
// lands on the icon and e.target.dataset.tab is undefined. This is exactly what
// broke navigation when the emoji became icons.
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) { switchTab(btn.dataset.tab, true); nav(); }
});
$("#clear").addEventListener("click", () => {
  const st = tabState[activeTab];
  st.search = ""; st.facets = {}; st.page = 1;
  $("#search").value = "";
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
  PAGE_SIZE = parseInt(e.target.value, 10) || 50;
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
  const update = () => {
    ticking = false;
    const y = Math.max(0, window.scrollY), dy = y - lastY;
    lastY = y;
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
  // Show the mode you'd switch TO, so the control says what it does.
  $("#theme").innerHTML = icon(t === "dark" ? "i-sun" : "i-moon", 16);
  $("#theme").title = t === "dark" ? "Switch to light" : "Switch to dark";
}
applyTheme(currentTheme());
// The shortcut differs by platform, so the keycap should too.
{
  const mod = $("#cmdkMod");
  if (mod && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)) mod.textContent = "\u2318";
}
$("#theme").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  if (activeTab === "stats") renderStats();     // recolour the charts' text
});

// ---- command palette (⌘K / Ctrl-K) ---------------------------------------
// 14.7k games is too many to browse to. Type a few letters, hit enter.
const cmdk = { open: false, sel: 0, results: [] };

// Read the tab list from the live header, so the palette can never go stale — adding
// or removing a tab (Shelf in, Reviews out) updates it for free.
function cmdkTabs() {
  const tabs = [...document.querySelectorAll("#tabs button[data-tab]")].map((b) => ({
    id: b.dataset.tab,
    label: (b.querySelector("span") || {}).textContent || b.dataset.tab,
    icon: ((b.querySelector("use") || {}).getAttribute?.("href") || "#i-home").slice(1),
  }));
  // Picross has no nav button on purpose — it's a once-a-day thing, and the nav is already
  // ten deep. It lives on Home. But it must still be REACHABLE, so the palette knows it.
  tabs.push({ id: "picross", label: "Daily Picross", icon: "i-target" });
  return tabs;
}

function cmdkCandidates(q) {
  const out = [];
  const needle = q.toLowerCase().trim();
  if (!needle) {
    return cmdkTabs().map((t) => ({ kind: "Tab", label: t.label, icon: t.icon, run: () => switchTab(t.id) }));
  }
  // Tabs
  for (const t of cmdkTabs()) {
    if (t.label.toLowerCase().includes(needle))
      out.push({ kind: "Tab", label: t.label, icon: t.icon, run: () => switchTab(t.id) });
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
      row: r, run: () => { switchTab("games"); openDrawer(r, "games"); },
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

function cmdkRender() {
  const host = $("#cmdkResults");
  if (!cmdk.results.length) {
    host.innerHTML = `<div class="cmdk-none">No matches</div>`;
    return;
  }
  host.innerHTML = cmdk.results.map((r, i) => {
    const cover = r.row ? coverSrc(ENRICH[r.row._k], "cover_small") : "";
    const art = r.row
      ? (cover ? `<img src="${escapeHtml(cover)}" alt="">` : `<span class="cmdk-ph">${icon("i-library", 15)}</span>`)
      : "";
    return `<button class="cmdk-item${i === cmdk.sel ? " sel" : ""}" data-i="${i}">
      ${art}<span class="cmdk-txt"><b>${escapeHtml(r.label)}</b>${r.sub ? `<span>${escapeHtml(r.sub)}</span>` : ""}</span>
      <span class="cmdk-kind">${escapeHtml(r.kind)}</span></button>`;
  }).join("");
  const sel = host.querySelector(".cmdk-item.sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
  host.querySelectorAll(".cmdk-item").forEach((el) => {
    el.onclick = () => cmdkRun(+el.dataset.i);
  });
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
  for (const t of TABS) tabState[t] = { ...freshState(), view: tabState[t].view, combine: tabState[t].combine };
  closePickPop(); applyPreset("backlog"); pickState.minutes = 0;
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
  if (k === "__default" || (activeTab === "games" && k === "releaseDate")) {
    st.sort = null;          // the default: releaseDateDesc, which ranks "Early Access" newest
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
$("#drawerClose").addEventListener("click", closeDrawer);
$("#overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeDrawer(); });
$("#drawerBody").addEventListener("click", (e) => {
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
  else if (!$("#sheet").hidden) setSheet(false);
  // Esc unwinds the drawer history one step at a time, then closes.
  else if (drawerStack.length && !$("#overlay").hidden) drawerBack();
  else closeDrawer();
});

function showToast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 250); }, 2500);
}

/* ---- admin login -----------------------------------------------------------
   One privileged account. The public gets a read-only app; signing in reveals the
   write controls (fix mappings, box art, refresh) and the sensitive reads (NAS, RomM),
   which the server gates too — this only decides what's shown. */
async function loadMe() {
  try {
    const r = await fetch("api/me");
    if (r.ok) { ME = await r.json(); IS_ADMIN = !!ME.authenticated; }
  } catch (_) { /* offline: stay public */ }
  applyAdminUI();
}

function applyAdminUI() {
  const acct = $("#account");
  $("#refresh").hidden = !IS_ADMIN;          // the endpoint is gated too; hide the button
  if (!acct) return;
  if (IS_ADMIN) {
    acct.title = `Signed in as ${ME.username} — account`;
    acct.setAttribute("aria-label", "Account");
    acct.classList.add("signed-in");
  } else {
    acct.title = "Sign in";
    acct.setAttribute("aria-label", "Sign in");
    acct.classList.remove("signed-in");
  }
}

function closeAuthModal() {
  document.querySelector(".ce-scrim.auth")?.remove();
  if (typeof syncScrollLock === "function") syncScrollLock();
}

function openAuthModal(inner) {
  closeAuthModal();
  const host = document.createElement("div");
  host.className = "ce-scrim auth";
  host.innerHTML = `<div class="ce ce-narrow" role="dialog" aria-modal="true">
      <button class="ce-x" aria-label="Close">✕</button>${inner}</div>`;
  host.addEventListener("mousedown", (e) => { if (e.target === host) closeAuthModal(); });
  host.querySelector(".ce-x").onclick = closeAuthModal;
  document.body.appendChild(host);
  if (typeof syncScrollLock === "function") syncScrollLock();
  return host;
}

function openLoginDialog() {
  const host = openAuthModal(`
      <h3>Sign in</h3>
      <div class="ce-sub">Admin access</div>
      <form id="loginForm" class="auth-form" autocomplete="on">
        <label>Username<input id="loginUser" type="text" autocomplete="username" autofocus></label>
        <label>Password<input id="loginPass" type="password" autocomplete="current-password"></label>
        <p class="auth-err" id="loginErr" hidden></p>
        <div class="ce-acts"><span></span><div class="ce-right">
          <button class="sh-btn" type="button" id="loginCancel">Cancel</button>
          <button class="sh-btn primary" type="submit">Sign in</button>
        </div></div>
      </form>`);
  const err = host.querySelector("#loginErr");
  host.querySelector("#loginCancel").onclick = closeAuthModal;
  host.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const username = host.querySelector("#loginUser").value.trim();
    const password = host.querySelector("#loginPass").value;
    try {
      const r = await fetch("api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (r.ok) { closeAuthModal(); location.reload(); return; }
      err.textContent = r.status === 401 ? "Wrong username or password." : "Sign in failed.";
      err.hidden = false;
    } catch (_) { err.textContent = "Couldn't reach the server."; err.hidden = false; }
  });
}

function openAccountMenu() {
  const host = openAuthModal(`
      <h3>${escapeHtml(ME.username)}</h3>
      <div class="ce-sub">Signed in</div>
      <div class="auth-menu">
        <button class="sh-btn" id="acctPw" type="button">${icon("i-lock", 14)} Change password</button>
        <button class="sh-btn" id="acctOut" type="button">Log out</button>
      </div>`);
  host.querySelector("#acctPw").onclick = openPasswordDialog;
  host.querySelector("#acctOut").onclick = async () => {
    try { await fetch("api/logout", { method: "POST" }); } catch (_) {}
    closeAuthModal(); location.reload();
  };
}

function openPasswordDialog() {
  const host = openAuthModal(`
      <h3>Change password</h3>
      <div class="ce-sub">${escapeHtml(ME.username)}</div>
      <form id="pwForm" class="auth-form">
        <label>Current password<input id="pwCur" type="password" autocomplete="current-password" autofocus></label>
        <label>New password<input id="pwNew" type="password" autocomplete="new-password"></label>
        <label>Confirm new password<input id="pwNew2" type="password" autocomplete="new-password"></label>
        <p class="auth-err" id="pwErr" hidden></p>
        <div class="ce-acts"><span></span><div class="ce-right">
          <button class="sh-btn" type="button" id="pwCancel">Cancel</button>
          <button class="sh-btn primary" type="submit">Update</button>
        </div></div>
      </form>`);
  const err = host.querySelector("#pwErr");
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  host.querySelector("#pwCancel").onclick = closeAuthModal;
  host.querySelector("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const cur = host.querySelector("#pwCur").value;
    const nw = host.querySelector("#pwNew").value;
    const nw2 = host.querySelector("#pwNew2").value;
    if (nw.length < 8) return fail("New password must be at least 8 characters.");
    if (nw !== nw2) return fail("The new passwords don't match.");
    try {
      const r = await fetch("api/account/password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: cur, new_password: nw }),
      });
      if (r.ok) { closeAuthModal(); showToast("Password changed ✓"); return; }
      if (r.status === 403) return fail("Your current password is wrong.");
      const j = await r.json().catch(() => ({}));
      fail(j.detail || "Couldn't change the password.");
    } catch (_) { fail("Couldn't reach the server."); }
  });
}

$("#account").addEventListener("click", () => {
  if (IS_ADMIN) openAccountMenu(); else openLoginDialog();
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAuthModal();
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
        resetCollections();
        resetSearchCache();
        const en = DATA.meta && DATA.meta.enrichment;
        ENRICH_ENABLED = !!(en && en.enabled !== false);
        setFreshness(); renderAll(); loadAllEnrichment();
      }
      showToast(j.changed ? "Spreadsheet updated ✓" : "Already up to date");
    } else showToast("Refresh failed: " + (j.error || res.status));
  } catch (_) { showToast("Refresh failed"); }
  finally { btn.classList.remove("spinning"); btn.disabled = false; }
});

load().catch((err) => { console.error(err); $("#count").textContent = "Error: " + err.message; });
