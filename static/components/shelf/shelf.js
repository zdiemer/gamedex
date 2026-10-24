"use strict";

// UI components for shelf.js. Feature state and orchestration remain in that module.

// The inner markup for a standard spine — shared by the flat shelf spine and the 3D
// case's left wall, so a pulled game's spine matches the one it came from.
function stdSpineHtml(g) {
  const s = spineStyle(g.p);
  const stripe = s.stripe ? `<i class="sp-stripe" style="background:${s.stripe}"></i>` : "";
  return stripe +
    `<span class="sp-band" style="background:${s.band};color:${s.bandInk};${s.mark || ""}">${escapeHtml(s.label)}</span>` +
    `<span class="sp-name" style="color:${s.ink};font-size:${shTitlePx(g.t, g.case.h)}px">${escapeHtml(g.t)}</span>`;
}

async function renderShelf() {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("renderShelf", activeTab) : () => {};
  try { return await _renderShelf(); } finally { end(); }
}

async function _renderShelf() {
  const host = document.getElementById("shelfview");
  if (!SHELF.loaded) {
    host.innerHTML = `<div class="sh-empty">Reading the shelf…</div>`;
    await loadShelf();
  }
  const wraps = SHELF.games.filter(shHasFaces).length;
  const plats = [...new Set(SHELF.games.map((g) => g.p))].sort();

  host.innerHTML = `
    <div class="sh-head">
      <div>
        <h2>My Collection</h2>
        <p class="sh-sub">
          <b>${SHELF.games.length.toLocaleString()}</b> games you can physically pick up —
          digital ones aren't objects and aren't here.
          <b>${wraps}</b> are showing the real scanned box.
        </p>
      </div>
      <div class="sh-tools">
        ${searchField("shelfsearch", "Find on the shelf…")}
        <select id="shelfplat" class="sel" aria-label="Platform">
          <option value="">All platforms</option>
          ${plats.map((p) => `<option${p === SHELF.plat ? " selected" : ""}>${escapeHtml(p)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="sh-stage" id="shStage">
      <div class="sh-rows" id="shRows"></div>
    </div>
    <div class="sh-pull" id="shPull">
      <div class="sh-veil" id="shVeil"></div>
      <div class="sh-info" id="shInfo"></div>
    </div>`;

  const q = document.getElementById("shelfsearch");
  q.value = SHELF.filter;
  q.oninput = () => { SHELF.filter = q.value; paintShelfRows(); };
  document.getElementById("shelfplat").onchange = (e) => { SHELF.plat = e.target.value; paintShelfRows(); };
  document.getElementById("shVeil").onclick = shelfClose;
  window.addEventListener("resize", shOnResize);   // dedup'd — re-pack boards to new width
  paintShelfRows();
  shLastW = document.getElementById("shRows")?.clientWidth || 0;   // baseline for the width-only guard
}

// One spine on the flat shelf: a real scanned spine if we have a wrap, otherwise the
// system's standard spine with the title set automatically.
function shSpineHtml(g, i) {
  const real = shHasFaces(g);
  const dims = `width:${shPx(g.case.d)}px;height:${shPx(g.case.h)}px`;
  const t = `title="${escapeHtml(g.t)} · ${escapeHtml(g.p)}${g.done ? " · Beaten" : ""}"`;
  // Beaten-at-a-glance: a check on the top of a finished game's spine. Absolute, so it
  // never touches the flex row (desktop) or the scroll snap (mobile).
  const done = g.done ? " done" : "";
  const badge = g.done ? `<i class="sh-check" aria-hidden="true"></i>` : "";
  if (real) {
    // The hue sits UNDER the scan, so a spine whose scan hasn't arrived yet is the right
    // colour rather than a black rectangle. The scan itself is LAZY — decoding two thousand
    // spine images up front is what made the shelf crawl on low-spec machines. It's stashed
    // in data-bg and applied by shObserveFit only as the spine nears the viewport.
    const bg = `${g.hue} center/100% 100% no-repeat url(${faceUrl(g.k, "spine", g.uv)})`;
    return `<button class="sh-spine real${done}" data-i="${i}" ${t} data-bg="${escapeHtml(bg)}" style="${dims};background:${g.hue}">${badge}</button>`;
  }
  const s = spineStyle(g.p);
  return `<button class="sh-spine std${done}" data-i="${i}" ${t} style="${dims};background:${s.base}">${badge}${stdSpineHtml(g)}</button>`;
}

function paintShelfRows() {
  const rows = document.getElementById("shRows");
  if (!rows) return;
  shelfClose();
  const games = shelfVisible();
  if (!games.length) {
    rows.innerHTML = `<div class="sh-empty">Nothing on the shelf matches.</div>`;
    return;
  }
  // One CONTINUOUS shelf. Games flow across boards regardless of platform, and each
  // board highlights the platform SEGMENTS running through it — so a platform that
  // spans three boards is labelled on all three, and the shelf reads as one run.
  const idxOf = new Map(SHELF.games.map((g, i) => [g, i]));
  const total = {};
  for (const g of games) total[g.p] = (total[g.p] || 0) + 1;
  const started = new Set();

  // Pack each board to the shelf's real WIDTH rather than a fixed count. Fixed counts
  // let a wide board out-measure the viewport; flexbox then shrinks the runs while the
  // fixed-width spines inside can't shrink, so they spill over and platforms overlap.
  // Widths here mirror the CSS: 2px between spines, 7px between platform runs, 20px pad.
  const avail = Math.max((rows.clientWidth || 1100) - 20, 320);
  const boards = [];
  let cur = [], curW = 0, curPlat = null;
  for (const g of games) {
    const w = shPx(g.case.d) + 2;
    const gap = curPlat !== null && curPlat !== g.p ? 7 : 0;
    if (cur.length && curW + gap + w > avail) { boards.push(cur); cur = []; curW = 0; curPlat = null; }
    const gap2 = curPlat !== null && curPlat !== g.p ? 7 : 0;
    cur.push(g); curW += gap2 + w; curPlat = g.p;
  }
  if (cur.length) boards.push(cur);

  rows.innerHTML = boards.map((board, bi) => {
    // Consecutive same-platform spines form a labelled run within this board.
    const runs = [];
    for (const g of board) {
      const last = runs[runs.length - 1];
      if (!last || last.p !== g.p) runs.push({ p: g.p, games: [g] });
      else last.games.push(g);
    }
    return `<div class="sh-board" data-b="${bi}">
      <div class="sh-row">
        ${runs.map((run) => {
          const first = !started.has(run.p);
          started.add(run.p);
          const name = escapeHtml(run.p || "Unknown");
          return `<div class="sh-run">
            <div class="sh-spines">${run.games.map((g) => shSpineHtml(g, idxOf.get(g))).join("")}</div>
            <div class="sh-seg${first ? " head" : ""}" data-full="${name} · ${total[run.p]}${first ? "" : " · continued"}">
              <span>${name}</span>${first ? `<em>${total[run.p]}</em>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="sh-plank"></div>
    </div>`;
  }).join("");

  rows.onclick = (e) => {
    const b = e.target.closest(".sh-spine");
    if (b) shelfOpen(+b.dataset.i);
  };
  shObserveFit(rows);
}

function shelfCase() {
  if (shEl && shEl.isConnected) return shEl;
  shEl = document.createElement("div");
  shEl.className = "sh-case";
  shEl.tabIndex = 0;
  shEl.setAttribute("role", "img");
  shBindCase(shEl);
  document.getElementById("shPull").appendChild(shEl);
  return shEl;
}

function shBuild(i) {
  const g = SHELF.games[i];
  const el = shelfCase();
  shW = shPx(g.fitW ?? g.case.w); shH = shPx(g.case.h);
  el.style.setProperty("--w", shW + "px");
  el.style.setProperty("--h", shH + "px");
  el.style.setProperty("--d", shPx(g.case.d) + "px");
  el.style.width = shW + "px"; el.style.height = shH + "px";
  el.setAttribute("aria-label", `${g.t} · drag to turn`);

  // An IGDB image id when we have one, otherwise a whole URL from whichever source did
  // have art (GameTDB's box front, most often). Either way it beats a blank slab.
  const cover = g.cover ? IMG(g.cover, "cover_big") : (g.coverUrl || "");
  el.innerHTML =
    shHasFaces(g) ? `
      <div class="sh-face f-front"><img src="${faceUrl(g.k, "front", g.uv)}" alt="" draggable="false"></div>
      <div class="sh-face f-back wrapped"><img src="${faceUrl(g.k, "back", g.uv)}" alt="" draggable="false"></div>
      <div class="sh-face f-left wrapped"><img src="${faceUrl(g.k, "spine", g.uv)}" alt="" draggable="false"></div>
      <div class="sh-face f-right"></div><div class="sh-face f-top"></div><div class="sh-face f-bottom"></div>`
    : g.src === "cover" ? `
      <div class="sh-face f-front"><img src="${cover}" alt="" draggable="false"></div>
      <div class="sh-face f-back"><img src="${cover}" alt="" draggable="false">
        <div class="sh-blurb"><i></i><i></i><i></i><i></i><i></i><span>${escapeHtml(g.p)}</span></div></div>
      <div class="sh-face f-left std" style="background:${spineStyle(g.p).base}">${stdSpineHtml(g)}</div>
      <div class="sh-face f-right"></div><div class="sh-face f-top"></div><div class="sh-face f-bottom"></div>`
    : `
      <div class="sh-face f-front sh-blank" style="--tint:${g.hue}">
        <b>${escapeHtml(g.t)}</b><small>${escapeHtml(g.p)}</small></div>
      <div class="sh-face f-back sh-blank" style="--tint:${g.hue}"></div>
      <div class="sh-face f-left std" style="background:${spineStyle(g.p).base}">${stdSpineHtml(g)}</div>
      <div class="sh-face f-right"></div><div class="sh-face f-top"></div><div class="sh-face f-bottom"></div>`;

  /* A FACE THAT ISN'T THERE YET. /api/shelf/face 404s until the server has fetched and cut
     that box — which for a ScreenScraper game means waiting for the boot-time warm crawl to
     reach it, and if their daily quota runs out first, until the NEXT boot's crawl resumes.
     Without this, those games are strictly worse than before they had real art: the shelf
     stops drawing the IGDB cover (it thinks there's a real box now) and the case comes out
     empty. So the front falls back to the cover we already had, and the other two faces just
     drop their image and let the face's own surface show. Nothing here fires once a box is
     cached, which is the normal case forever after. */
  if (shHasFaces(g)) {
    const front = el.querySelector(".f-front img");
    if (front && cover) front.onerror = () => {
      front.onerror = null;
      front.dataset.stand = "1";       // a stand-in: don't cut the box to its shape (shFitCase)
      front.src = cover;
    };
    const back = el.querySelector(".f-back img");
    if (back) back.onerror = () => {
      back.onerror = null;
      // Dropping `wrapped` is what turns the back into the stand-in: the CSS blurs and
      // darkens any back image that isn't a real scan (.f-back:not(.wrapped) img).
      back.closest(".f-back").classList.remove("wrapped");
      if (cover) back.src = cover; else back.remove();
    };
    const spine = el.querySelector(".f-left img");
    if (spine) spine.onerror = () => {
      const face = spine.closest(".f-left");
      face.classList.remove("wrapped");
      face.classList.add("std");
      face.style.background = spineStyle(g.p).base;
      face.innerHTML = stdSpineHtml(g);       // the system's standard spine, title and all
      shFitName(face);
    };
  }

  /* THE INSIDE OF THE BOX. Built into the 3D case itself, behind the front cover, so when the
     cover swings the media is genuinely in there — not a picture that appears beside the box.

     Built for EVERY game, even ones with nothing to put in it. The back face is
     backface-visibility:hidden (it has to be, or faces show through the closed box), which means
     that from the inside it simply is not there — so a case with no interior panel opened onto a
     view straight through the box to the shelf behind. The interior is the back wall. */
  /* …and it needs WALLS, not just a back panel. Every face of the case is backface-visibility:
     hidden, so from inside the box none of them exist — the back wall alone left the sides and top
     open, and you looked straight out through them to the shelf behind. That's the interior that
     kept coming up "invisible": not a missing panel, a missing ROOM. Four inner walls close it. */
  const inside = document.createElement("div");
  inside.className = "sh-inside";
  inside.innerHTML =
    `<span class="sh-wall w-l"></span><span class="sh-wall w-r"></span>
     <span class="sh-wall w-t"></span><span class="sh-wall w-b"></span>`
    + ((typeof mediaModelHtml === "function" && mediaFor(g.p)) ? mediaModelHtml(g) : "");
  el.appendChild(inside);

  // The case element is REUSED between games. Leave it open and the next box you pull out is
  // already hanging open — which is exactly what happened. `fit` is per game for the same reason:
  // it says "this box has been cut to its art", which the next game has to earn for itself.
  el.classList.remove("open", "slide");
  el.classList.toggle("fit", g.fitW != null);

  /* THE LID IS A SLAB. A real case's cover is a few millimetres of plastic, and a single sliver
     down its free edge didn't sell that from any angle — so the lid gets a full perimeter edge:
     top, bottom, the free side and the hinge. The BACK cover gets its thickness from a moulded rim
     in CSS instead; it must not hold 3D children (see .f-back::after in style.css for why). */
  const lid = el.querySelector(".f-front");
  // ...and a LINING, because the back of the cover is the inside of the box, not the cover
  // printed backwards. See .sh-liner.
  if (lid) {
    const liner = document.createElement("span");
    liner.className = "sh-liner";
    lid.appendChild(liner);
    // ...and the BOOKLET, clipped inside the lid — hinged cases only; a cardboard
    // sleeve never held its manual against the lid. The raw Archive URL is the
    // cover cache's key, so no cManual rewrite. A 404 (no PDF cover renderable)
    // removes the layer entirely: no booklet beats a blank slab pretending.
    const art = typeof mediaArt === "function" ? mediaArt(g) : {};
    if (typeof opensBy === "function" && opensBy(g.p) === "hinge" && art.manualPdf) {
      const man = document.createElement("span");
      man.className = "sh-manual";
      const im = new Image();
      im.draggable = false;
      im.onerror = () => man.remove();
      im.src = `/api/manual/cover?u=${encodeURIComponent(art.manualPdf)}`;
      man.appendChild(im);
      lid.appendChild(man);
    }
  }
  for (const e of lid ? ["e-t", "e-r", "e-b", "e-l"] : []) {
    const edge = document.createElement("span");
    edge.className = `sh-edge ${e}`;
    lid.appendChild(edge);
  }

  // Where the case has to START: exactly on top of the spine it came from. At
  // rotateY(90) the left wall lands at world z = 0 IF the case is pushed back by half
  // its width — and then its projection IS the spine's rectangle, to the pixel.
  shFrom = shSpineAt(i);

  const src =
    g.src === "upload"
      ? `<span class="sh-badge mine">Your upload</span>`
      : g.src === "wrap" || g.src === "ss"
        // "Real box" plus where it came from, and the printing. `regionOff` means it's
        // a real box but not YOUR region's — say so rather than let the region code
        // imply the copy on your shelf.
        ? `<span class="sh-badge real">Real box${g.artFrom ? " · " + escapeHtml(g.artFrom) : ""}${
             g.region && g.region !== "user" ? " · " + escapeHtml(g.region.toUpperCase()) : ""}${
             g.regionOff ? " box" : ""}</span>`
        : g.src === "cover"
          ? `<span class="sh-badge fake">Front only · ${escapeHtml(g.coverFrom || "IGDB")}</span>`
          : `<span class="sh-badge none">No art anywhere</span>`;

  document.getElementById("shInfo").innerHTML = `
    <button class="sh-handle" id="shGrip" aria-expanded="false" aria-controls="shInfo"
      aria-label="Expand game details"><span></span></button>
    <h3>${escapeHtml(g.t)}</h3>
    <div class="sh-plat">${escapeHtml(g.p)}${g.done ? ' · <span class="sh-done">Beaten</span>' : ""}</div>
    ${src}
    <dl>
      <dt>Case</dt><dd id="shDims">${g.fitW ?? g.case.w} × ${g.case.h} × ${g.case.d} mm</dd>
      ${g.year ? `<dt>Released</dt><dd>${g.year}</dd>` : ""}
      ${g.series ? `<dt>Series</dt><dd>${escapeHtml(g.series)}</dd>` : ""}
    </dl>
    <div class="sh-acts">
      <button class="sh-btn primary" id="shDetails">Full details</button>
      ${typeof hasBoxContents === "function" && hasBoxContents(g)
        ? `<button class="sh-btn" id="shOpen">Open the box</button>` : ""}
      ${typeof IS_ADMIN !== "undefined" && IS_ADMIN
        ? `<button class="sh-btn" id="shArt">${g.src === "upload" ? "Change art" : "Add / fix art"}</button>` : ""}
      <button class="sh-btn" id="shBack">← Put it back</button>
    </div>
    <div id="shMedia"></div>`;

  /* Measure whatever front ACTUALLY arrives and re-cut the box to it (see shFitCase) — the real
     scanned face, or the cover it fell back to when that face isn't fetched yet. Hooked up after
     the card exists, because the fit rewrites the case dimensions it prints. */
  const frontImg = shHasFaces(g) ? el.querySelector(".f-front img") : null;
  if (frontImg) {
    // NOT from the stand-in. A ScreenScraper face 404s until the warm crawl reaches it, and the
    // cover that steps in meanwhile is a different shape — fitting the box to that would cut it
    // to the wrong proportions and, because the fit is remembered, keep it there for the session.
    const fit = () => { if (!frontImg.dataset.stand) shFitCase(el, g, frontImg); };
    frontImg.addEventListener("load", fit);
    if (frontImg.complete && frontImg.naturalWidth) fit();     // already in the browser's cache
  }

  /* On a phone the card is a bottom sheet, and it used to open on top of the very box it
     describes. It now RESTS at its handle, its title and its buttons — everything you need to
     turn the box, open it or put it back — and the case is placed in the room left above it.
     Drag it up for the rest. The card element is reused between games, so the sheet has to be
     put back down here or the next box you pull comes out behind an already-raised sheet. */
  const card = document.getElementById("shInfo");
  card.classList.remove("up", "drag");
  card.style.transform = "";
  shPlaceTarget();                              // needs the card's real height: measure, then place
  shBindSheet(card);

  // Open the box: the media comes out, and the booklet with it.
  const openBtn = document.getElementById("shOpen");
  if (openBtn) openBtn.onclick = () => {
    const host = document.getElementById("shMedia");
    const kase = shEl;
    const opening = !kase.classList.contains("open");
    // A bare cartridge never lived in a hinged case — it slid out of a sleeve. Cards and discs did,
    // so those still swing open. The box opens the way the real one did.
    kase.classList.toggle("slide", opensBy(g.p) === "slide");
    kase.classList.toggle("open", opening);
    openBtn.textContent = opening ? "Close the box" : "Open the box";
    host.innerHTML = opening ? mediaPanelHtml(g) : "";
    if (!opening) return;
    const man = document.getElementById("mdManual");
    if (man) man.onclick = () => openManual(g);
  };
  document.getElementById("shBack").onclick = shelfClose;
  document.getElementById("shDetails").onclick = () => {
    // The app already has a detail card. Reuse it rather than inventing a second one.
    const row = (DATA.sheets.games.rows || []).find((r) => r._k === g.mk);
    if (row) openDrawer(row, "games");
  };
  const artBtn = document.getElementById("shArt");   // absent for the public (admin-only)
  if (artBtn) artBtn.onclick = () =>
    openCoverEditor({ key: g.k, platform: g.p, title: g.t, hasUpload: g.src === "upload",
      caseDefault: g.case, existing: g.upload, onDone: () => reloadShelfBox(g.k) });
}

/* ============ the cover editor (shared: shelf card + main drawer) ============
 * Two explicit choices, no auto-detect, because the user asked for it that way:
 *   "Full box art"  — a back|spine|front wrap; you drag the two guides to the spine and
 *                     we slice there. The front face takes the FRONT panel's aspect.
 *   "Front only"    — just the front; the case takes the IMAGE's aspect, so a tall Game
 *                     Boy cover isn't forced into a wide Blu-ray shape.
 * The box's proportions come from the image and from you — not a per-platform table.  */
function openCoverEditor({ key, platform, title, hasUpload, caseDefault, existing, onDone }) {
  const NOMINAL_H = (caseDefault && caseDefault.h) || 175;   // case height in mm, for size
  let kind = (existing && existing.kind) || "wrap", rotate = 0, file = null, img = null;
  // SNES/N64 art is a landscape strip with the panels lying on their side — the same
  // shape the Cover Project scans come in. Default those platforms to the per-face turn
  // (front rot90 / back rot270 / spine 0); everything else to none. Toggleable, in case
  // a given scan is already upright.
  const SIDEWAYS_PLATS = new Set(["snes", "n64"]);
  let faceRot = (existing && existing.faceRot != null)
    ? existing.faceRot
    : (SIDEWAYS_PLATS.has(PLAT_KEY[(platform || "").trim().toLowerCase()]) ? 90 : 0);
  let x1 = (existing && existing.x1) ?? 130 / 273;           // spine guides (fractions of width)
  let x2 = (existing && existing.x2) ?? 144 / 273;
  let depth = (existing && existing.d) || (caseDefault && caseDefault.d) || 14;
  // Front-only crop, as fractions of the rotated image. Front art in the wild comes with
  // a scanner bed's white margin, a shelf photo's background, or the rest of a wrap around
  // it — so the front face is whatever rectangle you drag, not the whole file. Full frame
  // by default, which is exactly the old behaviour.
  const FULL_CROP = { x1: 0, y1: 0, x2: 1, y2: 1 };
  const isFullCrop = (c) => c.x1 <= 0.001 && c.y1 <= 0.001 && c.x2 >= 0.999 && c.y2 >= 0.999;
  let crop = (existing && existing.crop) ? { ...existing.crop } : { ...FULL_CROP };

  const { host, close } = openUiDialog({ label: `Box art for ${title}`, html: `
      <h3>Box art</h3>
      <div class="ce-sub">${escapeHtml(title)} · ${escapeHtml(platform)}</div>

      <div class="ce-seg" role="tablist">
        <button class="ce-opt on" data-kind="wrap">Full box art</button>
        <button class="ce-opt" data-kind="front">Front only</button>
      </div>
      <p class="ce-hint" id="ceHint"></p>

      <div class="ce-drop" id="ceDrop">
        <input type="file" accept="image/*" hidden>
        <button type="button" class="ce-empty" id="ceOpen"><b>Choose an image</b><span>or drop it here</span></button>
        <div class="ce-stage" hidden>
          <div class="ce-imgwrap">
            <img alt="" draggable="false">
            <div class="ce-region back"><span>back</span></div>
            <div class="ce-region front"><span>front</span></div>
            <div class="ce-guide" data-g="1"></div>
            <div class="ce-guide" data-g="2"></div>
            <div class="ce-crop" hidden>
              <i class="ce-ch" data-h="nw"></i><i class="ce-ch" data-h="ne"></i>
              <i class="ce-ch" data-h="sw"></i><i class="ce-ch" data-h="se"></i>
            </div>
          </div>
        </div>
      </div>

      <div class="ce-tools" hidden id="ceTools">
        <button class="sh-btn" id="ceRot" type="button">↻ Rotate</button>
        <button class="sh-btn ce-side" id="ceSide" type="button"
                title="SNES/N64 scans: the panels lie on their side, so each face is turned upright">⤾ Sideways panels</button>
        <button class="sh-btn" id="ceChange" type="button">Change image</button>
        <button class="sh-btn" id="ceUncrop" type="button" hidden>⤢ Reset crop</button>
        <label class="ce-depth" id="ceDepthWrap">Spine
          <input type="range" id="ceDepth" min="4" max="40" step="1">
          <span id="ceDepthVal"></span></label>
        <span class="ce-dim" id="ceDim"></span>
      </div>

      <div class="ce-acts">
        ${hasUpload ? `<button class="sh-btn ce-rm" id="ceRemove" type="button">Remove my art</button>` : `<span></span>`}
        <div class="ce-right">
          <button class="sh-btn" id="ceCancel" type="button">Cancel</button>
          <button class="sh-btn primary" id="ceSave" type="button" disabled>Save</button>
        </div>
      </div>
    ` });

  const $ = (s) => host.querySelector(s);
  const hint = $("#ceHint"), drop = $("#ceDrop"), input = drop.querySelector("input");
  const stage = $(".ce-stage"), imgwrap = $(".ce-imgwrap"), imgEl = imgwrap.querySelector("img");
  const empty = $(".ce-empty"), tools = $("#ceTools"), save = $("#ceSave"), dim = $("#ceDim");
  const sideBtn = $("#ceSide");
  const gEls = [...host.querySelectorAll(".ce-guide")];
  const regBack = $(".ce-region.back"), regFront = $(".ce-region.front");
  const depthWrap = $("#ceDepthWrap"), depthEl = $("#ceDepth"), depthVal = $("#ceDepthVal");
  const cropEl = $(".ce-crop"), uncropBtn = $("#ceUncrop");
  depthEl.value = depth;

  const HINTS = {
    wrap: "A full wrap (back, spine, and front in one image). Drag the two lines onto the spine and it gets sliced there.",
    front: "Just the front cover. Drag the box to crop out any margin or background, and the case takes the shape of whatever you keep (with a stand-in spine and back).",
  };

  // The rotated image's on-screen dimensions (what the guides and slicing act on).
  const rotDims = () => rotate % 180
    ? { w: img.naturalHeight, h: img.naturalWidth }
    : { w: img.naturalWidth, h: img.naturalHeight };

  // Draw the file into a canvas at the chosen rotation, so the preview and the server
  // agree on orientation and the guides land on the real pixels.
  function paintImage() {
    if (!img) return;
    const { w, h } = rotDims();
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotate * Math.PI / 180);                       // clockwise, matches the server
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    imgEl.src = c.toDataURL("image/jpeg", 0.92);
    layout();
  }

  // What the front face will actually be, in image pixels — the crop, not the file.
  function cropPx() {
    const { w, h } = rotDims();
    return { w: Math.max(1, Math.round((crop.x2 - crop.x1) * w)),
             h: Math.max(1, Math.round((crop.y2 - crop.y1) * h)) };
  }

  function layout() {
    const wrap = kind === "wrap";
    gEls.forEach((g, k) => { g.hidden = !wrap; g.style.left = (k ? x2 : x1) * 100 + "%"; });
    regBack.hidden = regFront.hidden = !wrap;
    if (wrap) {
      regBack.style.width = x1 * 100 + "%";
      regFront.style.left = x2 * 100 + "%";
      regFront.style.width = (1 - x2) * 100 + "%";
    }
    // Crop is a front-only affair: in wrap mode the spine guides already say where the
    // front begins, and two overlapping rectangles would just fight each other.
    cropEl.hidden = wrap;
    uncropBtn.hidden = wrap || isFullCrop(crop);
    imgwrap.classList.toggle("cropping", !wrap);
    if (!wrap) {
      cropEl.style.left = crop.x1 * 100 + "%";
      cropEl.style.top = crop.y1 * 100 + "%";
      cropEl.style.width = (crop.x2 - crop.x1) * 100 + "%";
      cropEl.style.height = (crop.y2 - crop.y1) * 100 + "%";
    }
    imgwrap.classList.toggle("sideways", wrap && faceRot % 360 !== 0);
    sideBtn.classList.toggle("on", faceRot % 360 !== 0);
    sideBtn.hidden = !wrap;
    depthWrap.style.display = wrap ? "none" : "";             // wrap depth comes from the guides
    depthVal.textContent = depth + " mm";
    if (img) {
      const { w, h } = rotDims();
      const c = cropPx();
      dim.textContent = (!wrap && !isFullCrop(crop))
        ? `${c.w}×${c.h} · cropped from ${w}×${h}`
        : `${w}×${h}`;
    }
  }

  function setKind(k) {
    kind = k;
    host.querySelectorAll(".ce-opt").forEach((b) => b.classList.toggle("on", b.dataset.kind === k));
    hint.textContent = HINTS[k]; hint.classList.remove("ce-err");
    imgwrap.classList.toggle("is-wrap", k === "wrap");
    layout();
  }

  // Load any image blob — a freshly-chosen file, or the ORIGINAL of an existing upload
  // when reopening to adjust it. A fresh file resets rotation; a reopened one keeps it.
  function loadBlob(blob, opts = {}) {
    if (!blob || !(blob.type || "").startsWith("image/")) return;
    file = blob; rotate = opts.rotate || 0;
    crop = opts.crop ? { ...opts.crop } : { ...FULL_CROP };   // a new file starts uncropped
    const url = URL.createObjectURL(blob);
    img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      empty.hidden = true; stage.hidden = false; tools.hidden = false; save.disabled = false;
      paintImage();
    };
    img.src = url;
  }
  const loadFile = (f) => loadBlob(f, { rotate: 0 });

  // Drag a spine guide. Positions are fractions of the displayed image width.
  function dragGuide(which, clientX) {
    const r = imgwrap.getBoundingClientRect();
    let f = (clientX - r.left) / r.width;
    f = Math.max(0, Math.min(1, f));
    if (which === 0) x1 = Math.min(f, x2 - 0.01);
    else x2 = Math.max(f, x1 + 0.01);
    layout();
  }
  gEls.forEach((g, k) => {
    g.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation(); g.setPointerCapture(e.pointerId);
      const move = (ev) => dragGuide(k, ev.clientX);
      const up = (ev) => { g.releasePointerCapture(e.pointerId);
        g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); };
      g.addEventListener("pointermove", move); g.addEventListener("pointerup", up);
    });
  });

  // Drag the crop box: a corner resizes, anywhere else moves the whole rectangle.
  // Capture is set inside a try/catch AFTER the drag state exists — a touch pointer that
  // refuses capture must not leave the drag half-started (the iOS 3D-box bug).
  const MIN_CROP = 0.05;
  cropEl.addEventListener("pointerdown", (e) => {
    if (kind !== "front" || !img) return;
    e.preventDefault(); e.stopPropagation();
    const h = e.target.dataset.h || "";                    // "" → move, else nw/ne/sw/se
    const box = imgwrap.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY, ...crop };
    const el = e.target;
    const move = (ev) => {
      const dx = (ev.clientX - from.x) / box.width, dy = (ev.clientY - from.y) / box.height;
      let { x1: a, y1: b, x2: c, y2: d } = from;
      if (!h) {                                            // translate, clamped to the image
        const w = c - a, ht = d - b;
        a = Math.max(0, Math.min(1 - w, a + dx)); c = a + w;
        b = Math.max(0, Math.min(1 - ht, b + dy)); d = b + ht;
      } else {
        if (h.includes("w")) a = Math.max(0, Math.min(c - MIN_CROP, a + dx));
        if (h.includes("e")) c = Math.min(1, Math.max(a + MIN_CROP, c + dx));
        if (h.includes("n")) b = Math.max(0, Math.min(d - MIN_CROP, b + dy));
        if (h.includes("s")) d = Math.min(1, Math.max(b + MIN_CROP, d + dy));
      }
      crop = { x1: a, y1: b, x2: c, y2: d };
      layout();
    };
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
  });

  host.querySelectorAll(".ce-opt").forEach((b) => b.onclick = () => setKind(b.dataset.kind));
  input.onchange = () => loadFile(input.files[0]);
  // Opening the file dialog is now an explicit button — the preview is no longer a
  // <label>, so dragging a guide can't accidentally re-trigger the picker.
  $("#ceOpen").onclick = () => input.click();
  $("#ceChange").onclick = () => input.click();
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); loadFile(e.dataTransfer.files[0]); });
  // Rotating swaps the axes, so a crop drawn against the old orientation is meaningless.
  $("#ceRot").onclick = () => { rotate = (rotate + 90) % 360; crop = { ...FULL_CROP }; paintImage(); };
  uncropBtn.onclick = () => { crop = { ...FULL_CROP }; layout(); };
  sideBtn.onclick = () => { faceRot = faceRot % 360 ? 0 : 90; layout(); };
  depthEl.oninput = () => { depth = +depthEl.value; depthVal.textContent = depth + " mm"; };
  setKind(kind);

  // Reopening a game that already has art: pull its original image back in, at the
  // rotation and guides it was saved with, so you adjust rather than start over.
  if (existing) {
    fetch(`/api/shelf/original?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => { if (b) loadBlob(b, { rotate: existing.rotate || 0, crop: existing.crop }); })
      .catch(() => {});
  }

  $("#ceCancel").onclick = () => close();
  if (hasUpload) $("#ceRemove").onclick = async () => {
    $("#ceRemove").disabled = true;
    await fetch(`/api/shelf/cover?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    close(); onDone && onDone();
  };

  // Compute the case dims from the image + guides, so nothing is squashed to a template.
  function caseDims() {
    const { w, h } = rotDims();
    const H = NOMINAL_H;
    // The box takes the shape of the KEPT rectangle — crop away a scanner margin and the
    // case narrows to the art, instead of the box keeping the paper's proportions.
    if (kind === "front") { const c = cropPx(); return { w: Math.round(H * (c.w / c.h)), h: H, d: depth }; }
    const frontW = (1 - x2) * w, spineW = (x2 - x1) * w;     // panel widths, in image pixels
    if (faceRot % 360) {
      // Sideways panels (SNES/N64): the front panel is frontW × h in the strip, but it
      // gets turned upright, so the real face is h × frontW — a LANDSCAPE box. The box
      // height is therefore the panel's WIDTH, and everything scales off that.
      return { w: Math.round(H * (h / frontW)), h: H,
               d: Math.max(3, Math.round(H * (spineW / frontW))) };
    }
    return { w: Math.round(H * (frontW / h)), h: H, d: Math.max(3, Math.round(H * (spineW / h))) };
  }

  save.onclick = async () => {
    if (!file) return;
    save.disabled = true; save.textContent = "Saving…";
    const c = caseDims();
    const q = new URLSearchParams({ key, kind, rotate, w: c.w, h: c.h, d: c.d });
    if (kind === "wrap") {
      q.set("x1", x1.toFixed(4)); q.set("x2", x2.toFixed(4));
      q.set("face_rot", String(faceRot % 360));
    } else if (!isFullCrop(crop)) {
      q.set("cx1", crop.x1.toFixed(4)); q.set("cy1", crop.y1.toFixed(4));
      q.set("cx2", crop.x2.toFixed(4)); q.set("cy2", crop.y2.toFixed(4));
    }
    try {
      const r = await fetch(`/api/shelf/cover?${q}`, { method: "POST", body: file });
      // HTTP/2 (production behind Traefik) sends no statusText, so reading it left the
      // message blank on every failure. Read the JSON error, then the body, then status.
      if (!r.ok) {
        let msg = "";
        try { msg = (await r.clone().json()).error; } catch { try { msg = await r.text(); } catch {} }
        throw new Error(msg || `HTTP ${r.status}`);
      }
      close(); onDone && onDone();
    } catch (err) {
      save.disabled = false; save.textContent = "Save";
      hint.textContent = "Upload failed: " + err.message; hint.classList.add("ce-err");
    }
  };
}
