"use strict";

/* One-card-at-a-time actions over recs.js's IGDB ranking. Left persists the
   existing "not interested" preference. Right creates a normal staged Games
   row, so Pending edits remains the single reconciliation path. */

let _swipeRanked = null;
let _swipeEpoch = -1;
let _swipeBusy = false;
let _swipeMetaBusy = false;
let _swipeLast = null;
let _swipeAccepted = 0;
let _swipePassed = 0;
const _swipeHandled = new Set();
const _swipeMetaFetched = new Set();
const _swipePlatforms = new Map();
const _swipeOrder = new Map();
const SWIPE_DEFAULTS = { minYear: null, maxYear: null, minScore: 0,
  confidence: "any", genres: [], platforms: [] };

function resetSwipe() {
  _swipeRanked = null;
  _swipeEpoch = -1;
}

function swipeRanked() {
  if (_swipeRanked && _swipeEpoch === _enrichEpoch) return _swipeRanked;
  _swipeEpoch = _enrichEpoch;
  return (_swipeRanked = recsRanked().slice().sort((a, b) => {
    const aid = a.row.igdbId;
    const bid = b.row.igdbId;
    if (!_swipeOrder.has(aid)) _swipeOrder.set(aid, Math.random());
    if (!_swipeOrder.has(bid)) _swipeOrder.set(bid, Math.random());
    return _swipeOrder.get(aid) - _swipeOrder.get(bid) || String(aid).localeCompare(String(bid));
  }));
}

const swipeHistory = () => prefsLocal("swiped").map(Number).filter(Number.isFinite);

function swipeSeen() {
  return new Set([...swipeHistory(),
    ...prefsLocal("dismissed").map(Number).filter(Number.isFinite)]);
}

function swipeRemember(id) {
  id = Number(id);
  const history = swipeHistory();
  if (Number.isFinite(id) && !history.includes(id)) prefsSave("swiped", [...history, id].slice(-30000));
}

function swipeForget(id) {
  id = Number(id);
  prefsSave("swiped", swipeHistory().filter((x) => x !== id));
}

function swipeSettings() {
  const raw = prefsLocal("swipeSettings");
  const value = Array.isArray(raw) && raw[0] && typeof raw[0] === "object" ? raw[0] : {};
  const year = (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 1900 && n <= 2100 ? n : null;
  };
  const list = (v) => Array.isArray(v) ? [...new Set(v.map(String).filter(Boolean))] : [];
  const score = Number(value.minScore);
  return {
    minYear: year(value.minYear), maxYear: year(value.maxYear),
    minScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    confidence: ["fair", "high"].includes(value.confidence) ? value.confidence : "any",
    genres: list(value.genres), platforms: list(value.platforms),
  };
}

function swipeSettingsCount(settings = swipeSettings()) {
  return +(settings.minYear != null || settings.maxYear != null) + +(settings.minScore > 0)
    + +(settings.confidence !== "any") + +(settings.genres.length > 0) + +(settings.platforms.length > 0);
}

function swipeMatches(x, settings) {
  const rec = x.row._igdb || {};
  const year = Number(rec.year);
  if (settings.minYear != null && (!Number.isFinite(year) || year < settings.minYear)) return false;
  if (settings.maxYear != null && (!Number.isFinite(year) || year > settings.maxYear)) return false;
  if ((Number(x.p.score) || 0) * 100 < settings.minScore) return false;
  if (settings.confidence === "fair" && (Number(x.p.confidence) || 0) < .5) return false;
  if (settings.confidence === "high" && (Number(x.p.confidence) || 0) < .75) return false;
  if (settings.genres.length && !settings.genres.some((v) => (rec.genres || []).includes(v))) return false;
  if (settings.platforms.length && !settings.platforms.some((v) => (rec.platforms || []).includes(v))) return false;
  return true;
}

function swipeDeck() {
  const seen = swipeSeen();
  const settings = swipeSettings();
  return swipeRanked().filter((x) => {
    const id = x.row.igdbId;
    return id != null && !seen.has(Number(id)) && !_swipeHandled.has(id) && swipeMatches(x, settings);
  });
}

function swipeCurrent() { return swipeDeck()[0] || null; }

function swipeSheetPlatforms() {
  const counts = new Map();
  for (const row of (((DATA || {}).sheets || {}).games || {}).rows || []) {
    if (row.platform) counts.set(row.platform, (counts.get(row.platform) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}

function swipeFacetValues(field) {
  const counts = new Map();
  for (const x of swipeRanked()) {
    for (const value of (x.row._igdb || {})[field] || []) {
      counts.set(value, (counts.get(value) || 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function swipeChecks(name, values, selected) {
  const on = new Set(selected);
  return values.map(([value, count]) => `<label><input type="checkbox" name="${name}"
    value="${escapeHtml(value)}"${on.has(value) ? " checked" : ""}>
    <span>${escapeHtml(value)}</span><small>${count.toLocaleString()}</small></label>`).join("");
}

async function swipeLoadMeta(items) {
  if (_swipeMetaBusy) return;
  const ids = items.map((x) => x && x.row && x.row.igdbId)
    .filter((id) => id && !Object.prototype.hasOwnProperty.call(RECS_META, id)
      && !_swipeMetaFetched.has(id)).slice(0, 12);
  if (!ids.length) return;
  _swipeMetaBusy = true;
  ids.forEach((id) => _swipeMetaFetched.add(id));
  try {
    const res = await fetch("api/games/meta?ids=" + ids.join(","));
    if (!res.ok) throw new Error("meta");
    const body = await res.json();
    for (const id of ids) RECS_META[id] = (body.items || {})[id] || null;
  } catch (_) {
    ids.forEach((id) => _swipeMetaFetched.delete(id));
  } finally {
    _swipeMetaBusy = false;
    if (activeTab === "swipe") renderSwipe();
  }
}

function swipeResetCard(card) {
  if (!card) return;
  card.classList.remove("dragging", "saving");
  card.style.transition = "transform .32s cubic-bezier(.2,.85,.25,1), opacity .18s ease";
  card.style.transform = "";
  card.style.opacity = "";
  card.querySelectorAll(".sw-stamp").forEach((n) => { n.style.opacity = ""; });
  setTimeout(() => { if (card.isConnected) card.style.transition = ""; }, 340);
}

function swipeFling(card, direction) {
  if (!card) return Promise.resolve();
  const sign = direction === "right" ? 1 : -1;
  card.classList.remove("dragging");
  card.style.transition = "transform .28s cubic-bezier(.4,0,.8,.35), opacity .24s ease";
  requestAnimationFrame(() => {
    card.style.transform = `translate3d(${sign * 120}vw,-18px,0) rotate(${sign * 24}deg)`;
    card.style.opacity = "0";
  });
  return new Promise((resolve) => setTimeout(resolve, 285));
}

function swipeError(card, message) {
  const err = card && card.querySelector("[data-sw-error]");
  if (err) { err.textContent = message; err.hidden = false; }
  swipeResetCard(card);
}

function swipeSetBusy(host, busy, label) {
  _swipeBusy = busy;
  host.querySelectorAll("button,select").forEach((el) => { el.disabled = busy; });
  if (!busy) {
    const want = host.querySelector("[data-sw-want]");
    const undo = host.querySelector("[data-sw-undo]");
    const currentCard = host.querySelector("[data-sw-card]");
    const currentId = currentCard ? +currentCard.dataset.id : null;
    if (want) want.disabled = !Object.prototype.hasOwnProperty.call(RECS_META, currentId);
    if (undo) undo.disabled = !_swipeLast;
  }
  const card = host.querySelector("[data-sw-card]");
  if (card) card.classList.toggle("saving", busy);
  const live = host.querySelector("#swipeStatus");
  if (live) live.textContent = label || "";
}

function swipeSeedEnrichment(body, x) {
  if (!body.igdbPinned || !body.matchKey) return undefined;
  const before = Object.prototype.hasOwnProperty.call(ENRICH, body.matchKey)
    ? { ...ENRICH[body.matchKey] } : undefined;
  const rec = x.row._igdb || {};
  ENRICH[body.matchKey] = {
    ...(ENRICH[body.matchKey] || {}), igdbId: x.row.igdbId, cover: rec.cover || null,
    genres: rec.genres || [], themes: rec.themes || [], gameModes: rec.gameModes || [],
    perspectives: rec.perspectives || [], keywords: rec.keywords || [], engines: rec.engines || [],
    developers: rec.developers || [], publishers: rec.publishers || [], franchises: rec.franchises || [],
  };
  _enrichEpoch++;
  resetCatalogue();
  return before;
}

function swipeInsertLocal(body, x) {
  const row = { ...body.fields, _rowId: body.rowId, _added: true, _k: body.matchKey,
                _igdbId: x.row.igdbId };
  ((DATA.sheets.games || {}).rows || []).push(row);
  const previousEnrich = swipeSeedEnrichment(body, x);
  if (body.counts) { EDIT_COUNTS = body.counts; editsPaintBadge(); }
  if (typeof buildWishlistSheet === "function") buildWishlistSheet();
  return { row, previousEnrich };
}

async function swipeAct(direction, x) {
  if (_swipeBusy || !x) return;
  const host = $("#swipe");
  const card = host.querySelector("[data-sw-card]");
  const id = x.row.igdbId;
  if (direction === "left") {
    swipeSetBusy(host, true, "Passed");
    recsDismiss(id);
    swipeRemember(id);
    _swipePassed++;
    _swipeLast = { direction, x };
    await swipeFling(card, direction);
    _swipeBusy = false;
    renderSwipe();
    return;
  }

  const select = card && card.querySelector("[data-sw-platform]");
  const platform = select && select.value;
  if (!platform) {
    swipeError(card, "Choose the platform you want before swiping right.");
    if (select) select.focus();
    return;
  }
  _swipePlatforms.set(id, platform);
  swipeSetBusy(host, true, `Adding ${x.row.title} to Pending edits…`);
  // Start the gesture response before waiting on the server. On a phone the
  // round trip is noticeable, especially over a high-latency connection; a
  // failed request restores this same card below.
  const fling = swipeFling(card, direction);
  let res, body;
  try {
    res = await fetch("api/games", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        igdbId: id, platform, sheet: "games",
        fields: { wishlisted: true, priority: "Want to Play", dateAdded: todayISO() },
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (_) {
    await fling;
    swipeSetBusy(host, false, "");
    swipeError(card, "Offline — the game wasn’t added.");
    return;
  }
  if (res.status === 409) {
    swipeRemember(id);
    _swipeHandled.add(id);
    _swipeLast = null;
    showToast("Already in your collection", "i-check");
    await fling;
    _swipeBusy = false;
    renderSwipe();
    return;
  }
  if (!res.ok) {
    await fling;
    swipeSetBusy(host, false, "");
    swipeError(card, body.error || "That game couldn’t be added.");
    return;
  }

  const local = swipeInsertLocal(body, x);
  swipeRemember(id);
  _swipeHandled.add(id);
  _swipeAccepted++;
  _swipeLast = { direction, x, rowId: body.rowId, matchKey: body.matchKey,
                 previousEnrich: local.previousEnrich };
  showToast("Wishlisted — added to Pending edits", "i-edit");
  await fling;
  _swipeBusy = false;
  renderSwipe();
}

async function swipeUndo() {
  if (_swipeBusy || !_swipeLast) return;
  const last = _swipeLast;
  if (last.direction === "left") {
    const id = last.x.row.igdbId;
    prefsSave("dismissed", prefsLocal("dismissed").filter((x) => Number(x) !== id));
    swipeForget(id);
    buildRecsSheet(true);
    _swipePassed = Math.max(0, _swipePassed - 1);
    _swipeLast = null;
    renderSwipe();
    showToast("Pass undone");
    return;
  }
  _swipeBusy = true;
  try {
    const res = await fetch(`api/games/${encodeURIComponent(last.rowId)}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Couldn’t undo");
    for (const sheet of Object.values(DATA.sheets || {})) {
      if (sheet.rows) sheet.rows = sheet.rows.filter((r) => r._rowId !== last.rowId);
    }
    if (last.previousEnrich === undefined) delete ENRICH[last.matchKey];
    else ENRICH[last.matchKey] = last.previousEnrich;
    _enrichEpoch++;
    resetCatalogue();
    _swipeHandled.delete(last.x.row.igdbId);
    swipeForget(last.x.row.igdbId);
    _swipeAccepted = Math.max(0, _swipeAccepted - 1);
    if (body.counts) { EDIT_COUNTS = body.counts; editsPaintBadge(); }
    if (typeof buildWishlistSheet === "function") buildWishlistSheet();
    _swipeLast = null;
    showToast("Wishlist add undone");
  } catch (err) {
    showToast(String(err.message || err));
  } finally {
    _swipeBusy = false;
    renderSwipe();
  }
}

function swipeWire(host, x) {
  host.querySelectorAll("[data-sw-settings]").forEach((b) => { b.onclick = openSwipeSettings; });
  host.querySelectorAll("[data-sw-undo]").forEach((b) => { b.onclick = swipeUndo; });
  const reset = host.querySelector("[data-sw-reset]");
  if (reset) reset.onclick = () => {
    const passed = recsDismissed();
    prefsSave("swiped", swipeHistory().filter((id) => !passed.has(id)));
    recsUndismissAll();
    _swipeLast = null;
    _swipePassed = 0;
    renderSwipe();
  };
  if (!x) return;
  const card = host.querySelector("[data-sw-card]");
  const select = host.querySelector("[data-sw-platform]");
  if (select) select.onchange = () => {
    _swipePlatforms.set(x.row.igdbId, select.value);
    const err = card.querySelector("[data-sw-error]");
    if (err) err.hidden = true;
  };
  host.querySelector("[data-sw-pass]").onclick = () => swipeAct("left", x);
  host.querySelector("[data-sw-want]").onclick = () => swipeAct("right", x);
  host.querySelector("[data-sw-details]").onclick = () => openDrawer(recRow(x), "recs");

  let startX = 0, startY = 0, startAt = 0, dx = 0, dy = 0, dragging = false, moved = false;
  const art = host.querySelector("[data-sw-art]");
  if (art) art.onclick = (e) => {
    if (moved) { e.preventDefault(); return; }
    openDrawer(recRow(x), "recs");
  };
  const finish = (e, cancelled) => {
    if (!dragging) return;
    dragging = false;
    try { card.releasePointerCapture(e.pointerId); } catch (_) {}
    const speed = Math.abs(dx) / Math.max(1, performance.now() - startAt);
    const threshold = Math.min(140, card.clientWidth * .23);
    if (!cancelled && (Math.abs(dx) > threshold || (Math.abs(dx) > 45 && speed > .55))) {
      swipeAct(dx > 0 ? "right" : "left", x);
    } else swipeResetCard(card);
  };
  card.onpointerdown = (e) => {
    if (_swipeBusy || e.button !== 0 || e.target.closest("button,a,select,label")) return;
    startX = e.clientX; startY = e.clientY; startAt = performance.now();
    dx = 0; dy = 0; moved = false; dragging = true;
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  };
  card.onpointermove = (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    moved ||= Math.abs(dx) > 8 || Math.abs(e.clientY - startY) > 8;
    dy = Math.max(-30, Math.min(30, (e.clientY - startY) * .18));
    card.style.transform = `translate3d(${dx}px,${dy}px,0) rotate(${dx / 28}deg)`;
    const amount = Math.min(1, Math.abs(dx) / Math.max(90, card.clientWidth * .22));
    card.querySelector(".sw-stamp-no").style.opacity = dx < 0 ? amount : 0;
    card.querySelector(".sw-stamp-yes").style.opacity = dx > 0 ? amount : 0;
  };
  card.onpointerup = (e) => finish(e, false);
  card.onpointercancel = (e) => finish(e, true);
}

document.addEventListener("keydown", (e) => {
  if (activeTab !== "swipe" || _swipeBusy || e.defaultPrevented) return;
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (!$("#overlay").hidden || document.querySelector(".ce-scrim")) return;
  const x = swipeCurrent();
  if (e.key === "ArrowLeft" && x) { e.preventDefault(); swipeAct("left", x); }
  else if (e.key === "ArrowRight" && x) { e.preventDefault(); swipeAct("right", x); }
  else if ((e.key === "z" || e.key === "Z") && _swipeLast) { e.preventDefault(); swipeUndo(); }
});
