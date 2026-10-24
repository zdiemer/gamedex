/* The shelf — the physical collection, as objects you can pick up.
 *
 * The shelf is SPINES: flat divs with a background colour or a scanned spine. Two
 * thousand games is two thousand divs, and that is all it costs.
 *
 * Exactly ONE 3D case exists at a time — the game in your hand. It is built when you
 * pull a game out and thrown away when you put it back, so a shelf of 2,000 never pays
 * for 2,000 `preserve-3d` subtrees.
 *
 * The pull is one number. At rotateY(90deg) a case is edge-on: the front cover has zero
 * projected width and the only thing you can see is its left wall — which IS a spine.
 * So pulling a game off the shelf is animating that angle from 90 to 24 while the case
 * rises toward you. No swap, no cross-fade, no second element: the spine you clicked is
 * the case, turned.
 */

const SHELF = { games: [], loaded: false, filter: "", plat: "" };

const PX_MM = 1.28;                  // one scale, millimetres -> pixels, for everything
const SHELF_REST_Y = 24;             // +y turns the LEFT wall (the spine) toward you
const SHELF_TILT_MAX = 34;
const SHELF_PULL_Z = 210;
const SHELF_PERSP = 1600;            // must match .sh-stage { perspective }
const SHELF_TOP_GAP = 46;
const SHELF_PERSP_Y = 0.42;  // fraction of the viewport; must match .sh-pull CSS
const shClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const shLerp = (a, b, t) => a + (b - a) * t;
const shPx = (mm) => Math.round(mm * PX_MM);
// Key goes in the QUERY string, never the path: a match key can contain '/' (Commodore
// Plus/4, OS/2, TI-99/4A), and an encoded slash in a path is decoded by the proxy and
// re-splits the route — a 405 on upload, a 404 on the face.
const faceUrl = (k, f, v) =>
  `/api/shelf/face?key=${encodeURIComponent(k)}&face=${f}${v ? `&v=${v}` : ""}`;

/* Does this box have REAL art on its faces — i.e. is /api/shelf/face going to answer?
 * Three sources say yes: the owner's own upload, a Cover Project wrap, and a
 * ScreenScraper scan. They differ in where the pixels came from and nowhere else, so
 * everything downstream of this asks the question once, here, instead of growing a
 * third arm of the same `||` in five places. The server resolves each FACE separately
 * behind that endpoint (see shelf.py face()), which is why the browser doesn't have to
 * know that a ScreenScraper box may be wearing a Cover Project spine. */
const shHasFaces = (g) => g.src === "wrap" || g.src === "upload" || g.src === "ss";

/* A game with no scanned wrap doesn't get a flat coloured slab — it gets that
 * system's STANDARD spine: the console's brand band up top, the game's title set
 * automatically below. Brand colours are facts; the short label stands in for the
 * logo we can't reproduce. Anything not in the table falls back to a neutral spine
 * carrying the platform name, so every game reads as a real object on the shelf. */
// Each entry paints that console's real retail spine as closely as styled text can:
// accurate brand colour, the band where the system puts it, an edge stripe where the
// case has one (the PS2's blue spine, the Xbox green rail), and the wordmark set in
// that family's style. `mark` is extra CSS for the wordmark; `stripe` an outer-edge bar.
const PS_MARK   = "text-transform:none;font-weight:600;letter-spacing:.01em;";
const XBOX_MARK = "font-weight:800;letter-spacing:.18em;";
const WII_MARK  = "text-transform:none;font-weight:800;letter-spacing:.02em;";
const SPINE_LOGOS = {
  gameboy:  { base:"linear-gradient(90deg,#8f88ab,#a49dbf)", band:"#211d38", bandInk:"#e7e3f4", ink:"#1a182a", label:"GAME BOY", mark:"font-size:7.5px;" },
  gbc:      { base:"linear-gradient(90deg,#574fa4,#6a61b6)", band:"#241a66", bandInk:"#ffd23f", ink:"#ffffff", label:"GAME BOY COLOR", mark:"font-size:7px;letter-spacing:.04em;" },
  gba:      { base:"linear-gradient(90deg,#33287a,#40338c)", band:"#160f4a", bandInk:"#9c8ef6", ink:"#ffffff", label:"GAME BOY ADVANCE", mark:"font-size:7px;letter-spacing:.04em;" },
  ds:       { base:"linear-gradient(90deg,#eceef2,#f6f7fa)", band:"#c6c9d1", bandInk:"#16181d", ink:"#16181d", label:"NINTENDO DS", mark:"font-size:7.5px;" },
  n3ds:     { base:"linear-gradient(90deg,#eceef2,#f6f7fa)", band:"#d21a24", bandInk:"#ffffff", ink:"#16181d", label:"NINTENDO 3DS", mark:"font-size:7.5px;" },
  nes:      { base:"linear-gradient(90deg,#bfbfc8,#cdcdd5)", band:"#1c1c1f", bandInk:"#e6352b", ink:"#16181d", label:"NES", mark:"letter-spacing:.12em;" },
  snes:     { base:"linear-gradient(90deg,#c5c6d0,#d2d3db)", band:"#4b3f8f", bandInk:"#ffffff", ink:"#1b1c22", label:"SUPER NINTENDO", mark:"font-size:7px;" },
  n64:      { base:"linear-gradient(90deg,#141416,#202024)", band:"#141416", bandInk:"#f2f2f5", ink:"#f2f2f5", label:"NINTENDO 64", mark:"font-size:7.5px;" },
  gamecube: { base:"linear-gradient(90deg,#352a72,#463a8c)", band:"#1e1650", bandInk:"#c9c2f0", ink:"#ffffff", label:"GAMECUBE" },
  wii:      { base:"linear-gradient(90deg,#eef1f5,#f7f9fb)", band:"#12a5db", bandInk:"#ffffff", ink:"#16181d", label:"Wii", mark:WII_MARK },
  wiiu:     { base:"linear-gradient(90deg,#eef1f5,#f7f9fb)", band:"#0e93cc", bandInk:"#ffffff", ink:"#16181d", label:"Wii U", mark:WII_MARK },
  switch:   { base:"linear-gradient(90deg,#dd0018,#f01b2c)", band:"#c00010", bandInk:"#ffffff", ink:"#ffffff", label:"SWITCH", mark:"letter-spacing:.14em;" },
  switch2:  { base:"linear-gradient(90deg,#d1001a,#e6142c)", band:"#b3000f", bandInk:"#ffffff", ink:"#ffffff", label:"SWITCH 2", mark:"letter-spacing:.1em;" },
  ps1:      { base:"linear-gradient(90deg,#121318,#1c1d24)", band:"#121318", bandInk:"#f2f2f5", ink:"#e9e9ef", label:"PlayStation", mark:PS_MARK },
  ps2:      { base:"linear-gradient(90deg,#0b0b12,#15161e)", band:"#0b0b12", bandInk:"#dfe4ff", ink:"#eef0f6", label:"PlayStation 2", mark:PS_MARK+"font-size:7.5px;", stripe:"#0e39c4" },
  ps3:      { base:"linear-gradient(90deg,#0d0d12,#17171e)", band:"#0d0d12", bandInk:"#e8e8ee", ink:"#eef0f6", label:"PS3", mark:"font-weight:800;" },
  ps4:      { base:"linear-gradient(90deg,#0e1116,#181c24)", band:"#0064d2", bandInk:"#ffffff", ink:"#eef0f6", label:"PS4", mark:"font-weight:800;" },
  ps5:      { base:"linear-gradient(90deg,#f4f6f9,#ffffff)", band:"#101014", bandInk:"#ffffff", ink:"#16181d", label:"PS5", mark:"font-weight:800;" },
  psp:      { base:"linear-gradient(90deg,#101015,#1a1a20)", band:"#101015", bandInk:"#e8e8ee", ink:"#eef0f6", label:"PSP", mark:"font-weight:800;letter-spacing:.1em;" },
  vita:     { base:"linear-gradient(90deg,#101015,#1a1a20)", band:"#101015", bandInk:"#e8e8ee", ink:"#eef0f6", label:"PS VITA", mark:"font-weight:700;letter-spacing:.06em;" },
  xbox:     { base:"linear-gradient(90deg,#107c10,#149314)", band:"#0a5c0a", bandInk:"#eafff0", ink:"#ffffff", label:"XBOX", mark:XBOX_MARK },
  xbox360:  { base:"linear-gradient(90deg,#eef2ee,#f8faf8)", band:"#107c10", bandInk:"#ffffff", ink:"#16181d", label:"XBOX 360", mark:XBOX_MARK },
  xboxone:  { base:"linear-gradient(90deg,#15171b,#1f2228)", band:"#107c10", bandInk:"#ffffff", ink:"#eef0f6", label:"XBOX ONE", mark:XBOX_MARK },
  xboxsx:   { base:"linear-gradient(90deg,#0c0d10,#16181d)", band:"#107c10", bandInk:"#ffffff", ink:"#eef0f6", label:"XBOX SERIES", mark:XBOX_MARK },
  genesis:  { base:"linear-gradient(90deg,#141416,#202024)", band:"#c1121f", bandInk:"#ffffff", ink:"#f2f2f5", label:"GENESIS", mark:"letter-spacing:.1em;" },
  dreamcast:{ base:"linear-gradient(90deg,#eef1f5,#f7f9fb)", band:"#e35205", bandInk:"#ffffff", ink:"#16181d", label:"DREAMCAST", mark:"font-size:7.5px;" },
  saturn:   { base:"linear-gradient(90deg,#101014,#1a1a20)", band:"#101014", bandInk:"#e8e8ee", ink:"#eef0f6", label:"SEGA SATURN", mark:"font-size:7.5px;letter-spacing:.06em;" },
};
const PLAT_KEY = {
  "nintendo switch":"switch", "switch":"switch",
  "nintendo switch 2":"switch2", "switch 2":"switch2",
  "super nintendo entertainment system":"snes", "super nintendo":"snes", "snes":"snes",
  "nintendo entertainment system":"nes", "nes":"nes",
  "nintendo 64":"n64", "n64":"n64",
  "nintendo gamecube":"gamecube", "gamecube":"gamecube",
  "nintendo wii":"wii", "wii":"wii",
  "nintendo wii u":"wiiu", "wii u":"wiiu",
  "nintendo 3ds":"n3ds", "new nintendo 3ds":"n3ds", "3ds":"n3ds",
  "nintendo ds":"ds", "nintendo dsi":"ds", "ds":"ds", "nds":"ds",
  "nintendo game boy":"gameboy", "game boy":"gameboy",
  "nintendo game boy color":"gbc", "game boy color":"gbc",
  "nintendo game boy advance":"gba", "game boy advance":"gba",
  "playstation":"ps1", "playstation 1":"ps1", "ps1":"ps1", "psx":"ps1", "ps one":"ps1",
  "playstation 2":"ps2", "ps2":"ps2",
  "playstation 3":"ps3", "ps3":"ps3",
  "playstation 4":"ps4", "ps4":"ps4",
  "playstation 5":"ps5", "ps5":"ps5",
  "playstation portable":"psp", "psp":"psp",
  "playstation vita":"vita", "ps vita":"vita", "vita":"vita",
  "xbox":"xbox",
  "xbox 360":"xbox360",
  "xbox one":"xboxone",
  "xbox series x|s":"xboxsx", "xbox series x":"xboxsx", "xbox series s":"xboxsx", "xbox series":"xboxsx",
  "sega genesis":"genesis", "genesis":"genesis", "sega mega drive":"genesis", "mega drive":"genesis",
  "sega dreamcast":"dreamcast", "dreamcast":"dreamcast",
  "sega saturn":"saturn", "saturn":"saturn",
};
const spineStyle = (p) =>
  SPINE_LOGOS[PLAT_KEY[(p || "").trim().toLowerCase()]] ||
  { base:"#26262d", band:"#3a3a45", bandInk:"rgba(255,255,255,.82)", ink:"#f2f2f5",
    label:(p || "Unknown").toUpperCase() };

// A starting title size that lands close, so nothing paints hugely-clipped: the title
// runs down the spine, so it's the case HEIGHT the text has to fit in. shFitName then
// trims the last pixel of overflow once the element is measured for real.
function shTitlePx(t, hmm) {
  const avail = shPx(hmm) * 0.6;                 // the track left for the title after the band
  const px = avail / (Math.max((t || "").length, 1) * 0.52);  // ~0.52em per rotated latin glyph
  return Math.max(6, Math.min(10.5, Math.round(px * 2) / 2));
}

// Shrink a rendered title until it no longer overflows its spine. Titles run vertically,
// so overflow is along the block (scroll) axis. Cheap, and only ever run on spines the
// viewer is about to see (see shFitObs), so 1,800 spines cost nothing up front.
function shFitName(spine) {
  const nm = spine.querySelector(".sp-name");
  if (!nm) return;
  let fs = parseFloat(nm.style.fontSize) || parseFloat(getComputedStyle(nm).fontSize) || 9;
  let guard = 0;
  while (nm.scrollHeight > nm.clientHeight + 1 && fs > 5.5 && guard++ < 16) {
    fs -= 0.5;
    nm.style.fontSize = fs.toFixed(1) + "px";
  }
}
let shFitObs = null;
// One observer, two jobs, both keyed on "about to be seen": fit a standard spine's title,
// and load a real spine's scan (deferred from first paint — see shSpineHtml). rootMargin
// warms each a little before it scrolls into view, so neither pops in visibly.
function shObserveFit(root) {
  if (shFitObs) shFitObs.disconnect();
  shFitObs = new IntersectionObserver((ents) => {
    for (const e of ents) {
      if (!e.isIntersecting) continue;
      const el = e.target;
      if (el.dataset.bg) { el.style.background = el.dataset.bg; delete el.dataset.bg; }  // real: load the scan
      else shFitName(el);                                                                // std: fit the title
      shFitObs.unobserve(el);
    }
  }, { rootMargin: "300px" });
  root.querySelectorAll(".sh-spine.std, .sh-spine.real[data-bg]").forEach((el) => shFitObs.observe(el));
}

async function loadShelf() {
  if (SHELF.loaded) return;
  const r = await fetch("/api/shelf");
  if (!r.ok) return;
  const d = await r.json();
  SHELF.games = d.games || [];
  SHELF.loaded = true;
}

// The board width depends on the viewport, so re-pack when it changes. Debounced, and a
// no-op once the shelf is gone from the DOM.
let shResizeT = 0, shLastW = 0;
function shOnResize() {
  clearTimeout(shResizeT);
  shResizeT = setTimeout(() => {
    const rows = document.getElementById("shRows");
    if (!rows) return;
    const w = rows.clientWidth;
    // A box in your hand: NEVER re-pack — paintShelfRows() closes the open case, and that
    // was the phone bug where tapping a spine popped the box out and it snapped straight
    // back. Just re-place it in the (possibly reshaped) room. The mobile URL bar hiding on
    // tap fires a resize with an unchanged width; only a real WIDTH change needs a re-pack.
    if (shCur >= 0) { shLastW = w; shPlaceTarget(); shPaint(); return; }
    if (w !== shLastW) { shLastW = w; paintShelfRows(); }
  }, 160);
}

/* ---------- the rows of spines ---------- */

function shelfVisible() {
  const q = SHELF.filter.trim().toLowerCase();
  return SHELF.games.filter((g) =>
    (!SHELF.plat || g.p === SHELF.plat) &&
    (!q || (g.t || "").toLowerCase().includes(q)));
}

/* ---------- the one case ---------- */

function shSpineAt(i) {
  const s = document.querySelector(`.sh-spine[data-i="${i}"]`);
  if (!s) return { x: innerWidth / 2, y: innerHeight };
  const r = s.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const shState = { p: 0, vp: 0, rx: 0, ry: 0, vx: 0, vy: 0 };
let shEl = null, shCur = -1, shTarget = 0, shPending = -1, shRaf = 0, shDrag = null;
let shW = 0, shH = 0, shFrom = { x: 0, y: 0 }, shTo = { x: 0, y: 0 };
const shReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* THE BOX TAKES THE SHAPE OF THE ART.
 *
 * The case starts at the platform's real millimetres, which is a fine guess and only a guess:
 * printings differ (the Super Famicom Chrono Trigger box is portrait where the SNES one is
 * landscape) and a table cannot know which one you own. The art does. So the moment the front
 * image lands we measure it and re-cut the box to its aspect, keeping the case's HEIGHT — that
 * is the dimension the shelf is built on, and it stays honest per platform.
 *
 * Two rules keep it from doing something silly:
 *
 *   THE RECIPROCAL. ScreenScraper's DS and 3DS art is squeezed onto a canvas with its width and
 *   height the wrong way round: a 3DS box is 122x137mm (0.891) and every one of their fronts
 *   measures 1.122, which is 1/0.891 to three decimals. Fitting the box to THAT gives a landscape
 *   3DS case, which is not a thing. When the art's aspect is the reciprocal of the case's, the
 *   case wins — and because the face stretches to fill (object-fit: fill), painting it back into
 *   the right rectangle un-squashes the art at the same time.
 *
 *   THE ABSURD. No printed box front is thinner than a phone or wider than a keyboard, so an
 *   aspect outside 0.35..2.6 is a broken image, not a box, and is ignored.
 *
 * Nothing here crops. Cropping to fit was the old behaviour and it is what quietly ate a third of
 * every Game Boy cover; a box whose proportions came from a table can only ever cut or squash.
 *
 * Only REAL box art gets this. The fallback tier is an IGDB cover — key art, not a photograph of
 * a box — so a Switch game with no scan keeps its Switch-shaped case and the cover is cropped into
 * it, the way every cover in the app is. Fitting the box to that would hand one game on the shelf
 * a shape no copy of it ever had. */
const SH_AR_MIN = 0.35, SH_AR_MAX = 2.6;
const SH_RECIPROCAL = 0.06;          // log-space slack: within ~6%, it's a swapped canvas

function shFitCase(el, g, img) {
  const ar = img.naturalWidth / Math.max(img.naturalHeight, 1);
  if (!isFinite(ar) || ar < SH_AR_MIN || ar > SH_AR_MAX) return;
  el.classList.add("fit");                       // …and now the faces fill rather than crop

  const caseAr = g.case.w / Math.max(g.case.h, 1);
  const w = Math.abs(Math.log(ar) + Math.log(caseAr)) < SH_RECIPROCAL
    ? g.case.w                                   // swapped canvas: keep the box, unsquash the art
    : Math.round(g.case.h * ar);
  const prev = g.fitW ?? g.case.w;
  g.fitW = w;                                    // remembered, so re-pulling the same box is instant
  if (w === Math.round(prev)) return;            // the box is already this shape
  shW = shPx(w);
  el.style.setProperty("--w", shW + "px");
  el.style.width = shW + "px";
  const dims = document.getElementById("shDims");
  if (dims) dims.textContent = `${w} × ${g.case.h} × ${g.case.d} mm`;
  // The thing inside was sized against the box's old shape; give it the new one.
  if (typeof mediaResize === "function") mediaResize(el, g.p, { w, h: g.case.h });
  if (shCur >= 0) shPaint();                     // the pull animation is mid-flight; keep it centred
}

/* ---------- the bottom sheet (phones only) ---------- */

const SH_MOBILE = () => matchMedia("(max-width: 860px)").matches;

/* How much of the sheet stays on screen when it's down. MEASURED, not guessed: a title that
   wraps to two lines, or a game with no "Open the box" button, changes the height of the block
   we want to leave showing — and a guessed number either clips the buttons or leaves a gap.
   Zero on desktop, where the card sits beside the box and none of this applies. */
function shPeek() {
  const card = document.getElementById("shInfo");
  const acts = card?.querySelector(".sh-acts");
  if (!card || !acts || !SH_MOBILE()) return 0;
  const pad = parseFloat(getComputedStyle(card).paddingBottom) || 0;
  const peek = Math.round(acts.offsetTop + acts.offsetHeight + pad);
  card.style.setProperty("--sh-peek", peek + "px");
  return peek;
}

/* Where the case comes to rest. Coming toward you through a lens MAGNIFIES the case, and the
   magnification pushes away from the perspective origin — not from the case's own centre — so
   solve for the centre that LANDS where we want it. On a phone "where we want it" is the middle
   of the room left above the resting sheet; on desktop, the middle of the view. */
function shPlaceTarget() {
  const s = SHELF_PERSP / (SHELF_PERSP - SHELF_PULL_Z);
  const po = innerHeight * SHELF_PERSP_Y;       // must match .sh-pull perspective-origin
  const free = innerHeight - shPeek();          // the whole viewport on desktop
  const half = (shH * s) / 2;                   // half the case, as it will be SEEN
  // A tall case on a short phone can't both clear the top and clear the sheet. Clearing the top
  // wins: the box tucks a little behind the sheet, which you can drag away, rather than losing
  // its head off the top of the screen, which you can't.
  const wantY = SH_MOBILE()
    ? Math.max(SHELF_TOP_GAP + half, Math.min(free / 2, free - half - 8))
    : innerHeight * 0.46;
  shTo = { x: innerWidth / 2 - (innerWidth > 900 ? 130 : 0),   // leave room for the card
           y: po + (wantY - po) / s };
}

/* Drag the sheet by its handle (or its title): it follows your finger and snaps to whichever
   end you left it nearest — or, if you flicked, to the way you threw it. A tap on the handle
   toggles. Buttons and the media panel are deliberately not drag surfaces: "Open the box" has
   to stay a tap, and the cartridge in the media panel has its own drag-to-turn.
   Same pointer-capture shape as shBindCase, try/catch and all — iOS throws on a touch pointer. */
const SH_FLING = 0.4;    // px/ms — past this it's a throw, not a drag
const SH_TAP = 4;        // px — under this it never moved, so it was a tap

function shBindSheet(card) {
  // ONCE. The card is a fixture of the overlay — only its contents are rewritten per game — so
  // binding it per build stacked a second set of listeners on the second pull, a third on the
  // third. Two listeners both settle a tap, and the second one reads the class the first just
  // wrote and toggles it straight back: the sheet stopped answering taps entirely.
  if (card.dataset.sheetBound) return;
  card.dataset.sheetBound = "1";

  let d = null;
  const H = () => card.offsetHeight;
  const down = () => H() - shPeek();            // resting offset, in px
  const at = (y) => { card.style.transform = `translateY(${y.toFixed(1)}px)`; };
  const grip = () => card.querySelector(".sh-handle");   // rebuilt with every game

  const settle = (up) => {
    card.classList.remove("drag");
    card.style.transform = "";                  // hand it back to CSS, which animates the snap
    card.classList.toggle("up", up);
    const handle = grip();
    handle?.setAttribute("aria-expanded", up ? "true" : "false");
    handle?.setAttribute("aria-label", up ? "Collapse game details" : "Expand game details");
  };

  card.addEventListener("pointerdown", (e) => {
    if (!SH_MOBILE()) return;
    if (!e.target.closest(".sh-handle, h3, .sh-plat")) return;   // never steal a button's tap
    d = { y: e.clientY, t: e.timeStamp, from: card.classList.contains("up") ? 0 : down(),
          moved: 0, v: 0 };
    handled = false;
    card.classList.add("drag");
    try { card.setPointerCapture(e.pointerId); } catch {}
  }, { passive: false });

  card.addEventListener("pointermove", (e) => {
    if (!d) return;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dy));
    const dt = Math.max(8, e.timeStamp - d.t);
    d.v = dy / dt;                              // px/ms, signed: + is downward
    at(shClamp(d.from + dy, 0, down()));
    e.preventDefault();                         // it's a drag, not a scroll
  }, { passive: false });

  // Every finger release settles the sheet itself, so the click that follows it — whose target
  // isn't even reliable once the pointer has been captured — must be swallowed. Settle in both
  // and the sheet toggles twice, which reads as nothing happening at all. A click that arrives
  // with no release behind it is a keyboard or a screen reader pressing the button, and that
  // has to keep working.
  let handled = false;
  const release = (e) => {
    if (!d) return;
    const drag = d; d = null;
    handled = true;
    try { card.releasePointerCapture(e.pointerId); } catch {}
    if (drag.moved < SH_TAP) return settle(!card.classList.contains("up"));      // a tap: toggle
    if (Math.abs(drag.v) > SH_FLING) return settle(drag.v < 0);                  // a throw: obey it
    const y = shClamp(drag.from + (e.clientY - drag.y), 0, down());
    settle(y < down() / 2);                     // otherwise: whichever end it's nearer
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", () => { if (d) { d = null; settle(card.classList.contains("up")); } });

  // Delegated, because the handle itself is a new element with every game.
  card.addEventListener("click", (e) => {
    if (!e.target.closest(".sh-handle")) return;
    e.preventDefault();
    if (handled) { handled = false; return; }   // a finger already settled it; this is its echo
    if (SH_MOBILE()) settle(!card.classList.contains("up"));
  });
}

// After an upload changes, refresh just this game's data + the pulled case, without a
// full shelf reload.
async function reloadShelfBox(k) {
  const r = await fetch("/api/shelf");
  if (r.ok) SHELF.games = (await r.json()).games || SHELF.games;
  paintShelfRows();
  const g = SHELF.games.find((x) => x.k === k);
  if (g) shelfOpen(SHELF.games.indexOf(g));
}

function shPaint() {
  if (!shEl) return;
  const e = shState.p;
  const x = shLerp(shFrom.x, shTo.x, e) - shW / 2;
  const y = shLerp(shFrom.y, shTo.y, e) - shH / 2;
  const z = shLerp(-shW / 2, SHELF_PULL_Z, e);
  const yaw = shLerp(90, SHELF_REST_Y, e) + shState.ry * e;   // 90deg = edge-on = a spine
  shEl.style.transform =
    `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) ` +
    `rotateX(${(shState.rx * e).toFixed(2)}deg) rotateY(${yaw.toFixed(2)}deg)`;
  const f = shEl.querySelector(".f-front");
  if (f) f.style.setProperty("--sheen",
    (0.18 + Math.min(0.45, Math.abs(yaw - SHELF_REST_Y) / 160)).toFixed(3));
}

function shTick() {
  shRaf = 0;
  if (!shDrag) {
    // Putting a box back is snappier than pulling it out — pulling is a reveal you
    // want to watch, putting back is done. Stiffer spring on the way home.
    const home = shTarget === 0;
    shState.vp = (shState.vp + (shTarget - shState.p) * (home ? 0.26 : 0.14)) * (home ? 0.70 : 0.74);
    shState.p = shClamp(shState.p + shState.vp, -0.02, 1.06);
    if (home) {                                 // going home: unwind the turn too
      shState.vx = (shState.vx + (0 - shState.rx) * 0.20) * 0.70;
      shState.vy = (shState.vy + (0 - shState.ry) * 0.20) * 0.70;
    } else {
      shState.vx *= 0.93; shState.vy *= 0.93;   // in hand: momentum, bleeding off
    }
    shState.rx = shClamp(shState.rx + shState.vx, -SHELF_TILT_MAX, SHELF_TILT_MAX);
    shState.ry += shState.vy;
  }
  shPaint();

  const still = Math.abs(shState.vp) < 0.002 && Math.abs(shTarget - shState.p) < 0.003
    && Math.abs(shState.vx) < 0.03 && Math.abs(shState.vy) < 0.03
    && (shTarget === 1 || (Math.abs(shState.rx) < 0.1 && Math.abs(shState.ry) < 0.1));
  if (still && !shDrag) {
    shState.p = shTarget; shState.vp = 0;
    if (shTarget === 0) {                       // fully back in the row
      shState.rx = shState.ry = shState.vx = shState.vy = 0;
      shEl?.classList.remove("live");
      const s = document.querySelector(`.sh-spine[data-i="${shCur}"]`);
      s?.classList.remove("out");
      s?.nextElementSibling?.classList.remove("lean");
      document.getElementById("shPull")?.classList.remove("open");
      shCur = -1;
      syncScrollLock?.();
      if (shPending >= 0) { const n = shPending; shPending = -1; shelfOpen(n); }
      return;
    }
    shPaint(); return;
  }
  shRaf = requestAnimationFrame(shTick);
}
const shKick = () => { if (!shRaf) shRaf = requestAnimationFrame(shTick); };

function shelfOpen(i) {
  if (shCur === i) return;
  if (shCur >= 0) { shPending = i; shelfClose(); return; }   // put the current one back first
  shCur = i;
  shBuild(i);
  shState.p = 0; shState.vp = 0; shState.rx = shState.ry = shState.vx = shState.vy = 0;
  shEl.classList.add("live");
  shPaint();                                    // land on the spine BEFORE animating
  const s = document.querySelector(`.sh-spine[data-i="${i}"]`);
  s.classList.add("out");
  s.nextElementSibling?.classList.add("lean");  // its neighbour tips into the gap
  document.getElementById("shPull").classList.add("open");
  syncScrollLock?.();                            // freeze the shelf behind the 3D box
  shTarget = 1;
  if (shReduced()) { shState.p = 1; shPaint(); return; }
  shKick();
  shEl.focus({ preventScroll: true });
}

function shelfClose() {
  if (shCur < 0) return;
  // Shut the lid before putting the box back — a box goes home closed, not gaping open.
  // Drop .open (the hinge swings shut on its CSS transition); if it WAS open, let it finish
  // most of the way, then re-enter to do the slide-back.
  const wasOpen = shEl && shEl.classList.contains("open");
  if (shEl) shEl.classList.remove("open", "slide");
  if (wasOpen && !shReduced()) {
    setTimeout(() => { if (shCur >= 0) shelfClose(); }, 560);
    return;
  }
  shFrom = shSpineAt(shCur);      // it goes back where the spine IS now, not where it was
  shTarget = 0;
  if (shReduced()) {
    shState.p = 0; shState.rx = shState.ry = 0; shPaint();
    shEl?.classList.remove("live");
    const s = document.querySelector(`.sh-spine[data-i="${shCur}"]`);
    s?.classList.remove("out");
    s?.nextElementSibling?.classList.remove("lean");
    document.getElementById("shPull")?.classList.remove("open");
    shCur = -1;
    syncScrollLock?.();
    if (shPending >= 0) { const n = shPending; shPending = -1; shelfOpen(n); }
    return;
  }
  shKick();
}

/* Leaving the tab entirely. shelfClose() is the animated path and needs the shelf on
   screen to run — it can't put a box back onto a host that's about to be hidden, and its
   560ms "let the lid finish" re-entry would land after the DOM is gone.

   The part that actually bit: shCur >= 0 is one of the things anyOverlayOpen() counts
   (drawer.js), so a box left out held the body scroll lock onto whatever tab you went to
   next — the whole app unscrollable until you came back and closed it. Snap, don't
   animate; the host is going away regardless. Called from setSpecialMode, so it runs on
   back/forward too (which deliberately never resets). */
function shelfTeardown() {
  if (shCur < 0 && !shRaf) return;
  if (shRaf) { cancelAnimationFrame(shRaf); shRaf = 0; }
  shCur = -1; shPending = -1; shTarget = 0; shDrag = null; shEl = null;
  document.getElementById("shPull")?.classList.remove("open");
  syncScrollLock?.();
}

// Landing state (core.js). The filters only — SHELF.games/loaded is the /api/shelf
// payload, and dropping it would re-fetch and flash "Reading the shelf…" every visit.
TAB_RESET.shelf = () => { SHELF.filter = ""; SHELF.plat = ""; };

/* ---------- turning it, once it's out ---------- */

function shBindCase(el) {
  el.addEventListener("pointerdown", (e) => {
    if (shState.p < 0.25) return;               // still coming out; let it arrive
    // Set the drag state BEFORE capturing. On iOS setPointerCapture can throw for a
    // touch pointer on a thin, edge-on element; if it did (and it wasn't guarded), the
    // drag never started and the box wouldn't turn at all on iPhone.
    shDrag = { px: e.clientX, py: e.clientY, t: e.timeStamp };
    shState.vx = shState.vy = 0;
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();                         // no text selection, no native image drag
  }, { passive: false });
  el.addEventListener("pointermove", (e) => {
    if (!shDrag) return;
    const dt = Math.max(8, e.timeStamp - shDrag.t);
    const dy = (e.clientX - shDrag.px) * 0.55;  // drag across -> yaw
    const dx = -(e.clientY - shDrag.py) * 0.40; // drag up/down -> pitch
    shState.ry += dy;
    shState.rx = shClamp(shState.rx + dx, -SHELF_TILT_MAX, SHELF_TILT_MAX);
    shState.vy = shClamp(dy / dt * 16, -13, 13);   // deg/frame, so the glide picks up
    shState.vx = shClamp(dx / dt * 16, -13, 13);   // where your hand left off
    shDrag = { px: e.clientX, py: e.clientY, t: e.timeStamp };
    shPaint();
  });
  const release = (e) => {
    if (!shDrag) return;
    shDrag = null;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (shReduced()) { shState.vx = shState.vy = 0; return; }
    shKick();                                   // glide to a stop, stay where it lands
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);
  el.addEventListener("keydown", (e) => {
    const step = 12;
    if (e.key === "ArrowLeft") shState.ry -= step;
    else if (e.key === "ArrowRight") shState.ry += step;
    else if (e.key === "ArrowUp") shState.rx = shClamp(shState.rx + step, -SHELF_TILT_MAX, SHELF_TILT_MAX);
    else if (e.key === "ArrowDown") shState.rx = shClamp(shState.rx - step, -SHELF_TILT_MAX, SHELF_TILT_MAX);
    else return;
    e.preventDefault();
    shState.vx = shState.vy = 0;
    shPaint();
  });
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeTab === "shelf" && shCur >= 0 && !document.querySelector(".drawer.open")) {
    shelfClose();
  }
});
