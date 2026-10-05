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

function swipeCurrent() {
  const dismissed = recsDismissed();
  return swipeRanked().find((x) => {
    const id = x.row.igdbId;
    return id != null && !dismissed.has(id) && !_swipeHandled.has(id);
  }) || null;
}

function swipeSheetPlatforms() {
  const counts = new Map();
  for (const row of (((DATA || {}).sheets || {}).games || {}).rows || []) {
    if (row.platform) counts.set(row.platform, (counts.get(row.platform) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}

function swipePlatformHtml(id, meta) {
  if (!meta) {
    return `<label class="sw-platform waiting"><span>Platform</span>
      <select disabled><option>Loading platforms…</option></select></label>`;
  }
  const mapped = [...new Set(meta.sheetPlatforms || [])];
  const all = swipeSheetPlatforms();
  const other = all.filter((p) => !mapped.includes(p));
  let selected = _swipePlatforms.get(id);
  if (selected && !all.includes(selected)) selected = null;
  if (!selected && mapped.length) {
    selected = mapped[0];
    _swipePlatforms.set(id, selected);
  }
  const options = (values) => values.map((p) =>
    `<option value="${escapeHtml(p)}"${p === selected ? " selected" : ""}>${escapeHtml(p)}</option>`).join("");
  return `<label class="sw-platform"><span>Wishlist it for</span>
    <select data-sw-platform aria-label="Platform for this game">
      <option value="">Choose a platform…</option>
      ${mapped.length ? `<optgroup label="Released on">${options(mapped)}</optgroup>` : ""}
      ${other.length ? `<optgroup label="Other collection platforms">${options(other)}</optgroup>` : ""}
    </select></label>`;
}

function swipeMessage(title, copy, action = "") {
  return `<div class="sw-empty"><div class="sw-empty-mark">${icon("i-heart", 28)}</div>
    <h2>${escapeHtml(title)}</h2><p>${copy}</p>${action}</div>`;
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

function swipeCardHtml(x) {
  const row = recRow(x);
  const id = row._igdbId;
  const rec = x.row._igdb || {};
  const metaKnown = Object.prototype.hasOwnProperty.call(RECS_META, id);
  const meta = RECS_META[id] || null;
  const cover = rec.cover ? IMG(rec.cover, "cover_big") : "";
  const pct = Math.round((row.predicted || 0) * 100);
  const why = x.because && x.because.because && x.because.because.length
    ? `Because you liked <b>${x.because.because.slice(0, 2).map(escapeHtml).join("</b> and <b>")}</b>`
    : "Picked from the shape of your ratings";
  const genres = (rec.genres || []).slice(0, 3);
  const summary = meta && meta.summary
    ? escapeHtml(meta.summary.length > 360 ? meta.summary.slice(0, 357).trimEnd() + "…" : meta.summary)
    : (metaKnown ? "No description is available from IGDB."
                 : "Loading IGDB’s description and release details…");
  const dismissed = recsDismissed();
  const next = swipeRanked().filter((q) => {
    const qid = q.row.igdbId;
    return qid !== id && !dismissed.has(qid) && !_swipeHandled.has(qid);
  }).slice(0, 2);
  swipeLoadMeta([x, ...next]);

  return `<div class="sw-stage">
    <div class="sw-shadow-card sw-shadow-two"></div><div class="sw-shadow-card sw-shadow-one"></div>
    <article class="sw-card" data-sw-card data-id="${id}" tabindex="0"
      aria-label="${escapeHtml(row.title)}, predicted ${pct} percent">
      <div class="sw-art"${cover ? ` style="--sw-bg:url('${escapeHtml(cover)}')"` : ""}>
        ${cover ? `<img src="${escapeHtml(cover)}" alt="" draggable="false">`
                : `<div class="sw-no-cover">${icon("i-library", 42)}</div>`}
        <div class="sw-stamp sw-stamp-no" aria-hidden="true">PASS</div>
        <div class="sw-stamp sw-stamp-yes" aria-hidden="true">WANT</div>
        <span class="sw-score ${ratingClass(row.predicted || 0)}"><b>${pct}</b><small>predicted</small></span>
      </div>
      <div class="sw-info">
        <div class="sw-kicker"><span>IGDB MATCH</span><span>${escapeHtml(row.confidence || "")} confidence</span></div>
        <h1>${escapeHtml(row.title || "Untitled")}</h1>
        <div class="sw-meta">${[(meta && meta.release) || rec.year,
          ...(meta && meta.platforms || rec.platforms || []).slice(0, 3)]
          .filter(Boolean).map((v) => `<span>${escapeHtml(String(v))}</span>`).join("")}</div>
        <p class="sw-why">${why}</p>
        ${genres.length ? `<div class="sw-tags">${genres.map((g) => `<span>${escapeHtml(g)}</span>`).join("")}</div>` : ""}
        <p class="sw-summary">${summary}</p>
        <div class="sw-card-foot">${swipePlatformHtml(id, metaKnown ? (meta || {}) : null)}
          <button class="linkbtn sw-details" data-sw-details>Full details</button></div>
        <p class="sw-error" data-sw-error role="alert" hidden></p>
      </div>
    </article>
  </div>
  <div class="sw-actions" aria-label="Recommendation actions">
    <button class="sw-action pass" data-sw-pass aria-label="Pass on ${escapeHtml(row.title)}">
      ${icon("i-close", 22)}<span>Pass</span><kbd>←</kbd></button>
    <button class="sw-undo" data-sw-undo${_swipeLast ? "" : " disabled"} aria-label="Undo last swipe">
      <span aria-hidden="true">↶</span> Undo</button>
    <button class="sw-action want" data-sw-want${metaKnown ? "" : " disabled"} aria-label="Add ${escapeHtml(row.title)} to wishlist">
      ${icon("i-heart", 21)}<span>Want</span><kbd>→</kbd></button>
  </div><div class="sw-live" id="swipeStatus" aria-live="polite"></div>`;
}

function renderSwipe() {
  const host = $("#swipe");
  if (!host) return;
  if (!IS_ADMIN) {
    host.innerHTML = swipeMessage("Sign in to swipe", "Accepted games are staged as edits, so this view is available to the collection owner.");
    return;
  }
  if (!catEnabled()) {
    host.innerHTML = swipeMessage("Recommendations aren’t enabled", "Turn on the IGDB catalogue to build a swipe deck.");
    return;
  }
  if (!CAT) {
    host.innerHTML = swipeMessage("Building your deck", "Fetching the IGDB catalogue and comparing it with your ratings…",
      `<div class="sw-loader" aria-label="Loading"></div>`);
    ensureCatalogue().then(() => { if (activeTab === "swipe") renderSwipe(); });
    return;
  }
  const model = tasteModel();
  if (!model.ok) {
    host.innerHTML = swipeMessage("Rate a few more games", `Gamedex needs at least ${MIN_HISTORY} ratings before it can make personal recommendations.`);
    return;
  }
  const x = swipeCurrent();
  if (!x) {
    const dismissed = recsDismissed().size;
    host.innerHTML = swipeMessage("You’re caught up",
      dismissed ? "There are no unseen recommendations left in this deck." : "There are no new IGDB recommendations right now.",
      `<div class="sw-empty-actions">
        ${_swipeLast ? `<button class="sh-btn" data-sw-undo>Undo last swipe</button>` : ""}
        ${dismissed ? `<button class="btn" data-sw-reset>Restore passed games</button>` : ""}
      </div>`);
    swipeWire(host, null);
    return;
  }
  const dismissed = recsDismissed();
  const remaining = swipeRanked().filter((q) => {
    const id = q.row.igdbId;
    return id != null && !dismissed.has(id) && !_swipeHandled.has(id);
  }).length;
  host.innerHTML = `<div class="sw-shell"><header class="sw-head">
      <div><span class="sw-eyebrow">${icon("i-sparkle", 13)} FOR YOU</span>
        <h2>Find your next game</h2><p>Left to pass. Right to add it to Wishlist and Pending edits.</p></div>
      <div class="sw-progress"><b>${remaining.toLocaleString()}</b><span>matches left</span>
        <small>${_swipeAccepted} wanted · ${_swipePassed} passed this session</small></div>
    </header>${swipeCardHtml(x)}</div>`;
  swipeWire(host, x);
}

function swipeResetCard(card) {
  if (!card) return;
  card.classList.remove("dragging", "saving");
  card.style.transition = "transform .32s cubic-bezier(.2,.85,.25,1)";
  card.style.transform = "";
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
    swipeSetBusy(host, false, "");
    swipeError(card, "Offline — the game wasn’t added.");
    return;
  }
  if (res.status === 409) {
    _swipeHandled.add(id);
    _swipeLast = null;
    showToast("Already in your collection", "i-check");
    await swipeFling(card, direction);
    _swipeBusy = false;
    renderSwipe();
    return;
  }
  if (!res.ok) {
    swipeSetBusy(host, false, "");
    swipeError(card, body.error || "That game couldn’t be added.");
    return;
  }

  const local = swipeInsertLocal(body, x);
  _swipeHandled.add(id);
  _swipeAccepted++;
  _swipeLast = { direction, x, rowId: body.rowId, matchKey: body.matchKey,
                 previousEnrich: local.previousEnrich };
  showToast("Wishlisted — added to Pending edits", "i-edit");
  await swipeFling(card, direction);
  _swipeBusy = false;
  renderSwipe();
}

async function swipeUndo() {
  if (_swipeBusy || !_swipeLast) return;
  const last = _swipeLast;
  if (last.direction === "left") {
    const id = last.x.row.igdbId;
    prefsSave("dismissed", prefsLocal("dismissed").filter((x) => x !== id));
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
  host.querySelectorAll("[data-sw-undo]").forEach((b) => { b.onclick = swipeUndo; });
  const reset = host.querySelector("[data-sw-reset]");
  if (reset) reset.onclick = () => {
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

  let startX = 0, startY = 0, startAt = 0, dx = 0, dy = 0, dragging = false;
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
    dx = 0; dy = 0; dragging = true;
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  };
  card.onpointermove = (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
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
