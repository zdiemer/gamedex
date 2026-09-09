"use strict";

/* Controller navigation.

   A collection of games ought to be browsable from the couch, so this drives the
   whole site from a gamepad: the stick and d-pad move a focus ring, A activates,
   B unwinds, Menu opens the command palette.

   Two rules keep it from becoming a second, divergent copy of the app's input
   handling:

   * Anything the keyboard already does, the pad does BY SYNTHESISING THE KEY.
     Escape's unwind chain (palette → nav → sheet → drawer), the palette's own
     up/down/enter, the lightbox arrows and attract's ←/→/m all live in exactly one
     place — chrome.js, attract.js — and stay there. gpKey() is the whole bridge.
   * Only movement is ours, because nothing on this site is keyboard-navigable in
     the first place: it's a grid of 14.7k cards, and Tab order through those is
     useless. gpMove() picks the nearest element in the direction you pushed.

   Nothing here runs until a pad reports itself. The poll loop is started by
   `gamepadconnected` and stopped when the last pad leaves, so a mouse-and-keyboard
   visit pays for one event listener and no frames. */

// Standard-mapping indices (the layout every modern pad reports through
// navigator.getGamepads). Named because gp.buttons[9] is unreadable.
const GP = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8,        // Xbox View / PS Create / Switch Minus
  MENU: 9,        // Xbox Menu / PS Options / Switch Plus — opens the palette
  L3: 10, R3: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
};
const GP_DEADZONE = 0.55;      // stick throw before it counts as a direction
const GP_REPEAT_FIRST = 420;   // ms held before a direction starts repeating
const GP_REPEAT_NEXT = 110;    // ms between repeats after that
const GP_SCROLL_SPEED = 22;    // px per frame at full right-stick deflection

const gpState = {
  on: false,             // a pad is connected and we're polling
  raf: 0,
  prev: {},              // index -> was-pressed, for edge detection
  dirHeld: "",           // direction currently held (d-pad or stick, unified)
  dirAt: 0,              // when it was first held, for the repeat timer
  dirNext: 0,            // when the next repeat is due
  focus: null,           // the element wearing the ring
  scope: "",             // surface the ring last belonged to
};

// ---- reading the pad -----------------------------------------------------

// First pad with a button pressed wins, so a second controller (or a phantom
// one, which is common on Windows) doesn't fight the one in your hands.
function gpActive() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let first = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    if (!first) first = p;
    if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > GP_DEADZONE)) return p;
  }
  return first;
}

const gpDown = (pad, i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
// True on the frame a button goes down, false while it's held. Every action here
// is edge-triggered: holding A must not click a card sixty times a second.
function gpEdge(pad, i) {
  const now = gpDown(pad, i), was = !!gpState.prev[i];
  gpState.prev[i] = now;
  return now && !was;
}

// The d-pad and the left stick are the same input as far as the UI cares, so they
// collapse to one held direction with one repeat timer. Returns a direction only
// on the press edge and on each repeat tick, which is what makes a held stick
// step through a grid instead of flying across it.
function gpDirection(pad, t) {
  const [lx, ly] = [pad.axes[0] || 0, pad.axes[1] || 0];
  let dir = "";
  if (gpDown(pad, GP.UP) || ly < -GP_DEADZONE) dir = "up";
  else if (gpDown(pad, GP.DOWN) || ly > GP_DEADZONE) dir = "down";
  else if (gpDown(pad, GP.LEFT) || lx < -GP_DEADZONE) dir = "left";
  else if (gpDown(pad, GP.RIGHT) || lx > GP_DEADZONE) dir = "right";
  if (!dir) { gpState.dirHeld = ""; return ""; }
  if (dir !== gpState.dirHeld) {
    gpState.dirHeld = dir;
    gpState.dirAt = t;
    gpState.dirNext = t + GP_REPEAT_FIRST;
    return dir;
  }
  if (t >= gpState.dirNext) { gpState.dirNext = t + GP_REPEAT_NEXT; return dir; }
  return "";
}

// ---- the keyboard bridge -------------------------------------------------

// Hand the app a real keydown. Dispatched from the focused element (body when
// there is none) so it bubbles through document-level handlers AND is seen by
// attract.js's capture listener, exactly as a typed key would be.
function gpKey(key) {
  const el = document.activeElement && document.activeElement !== document.body
    ? document.activeElement : document.body;
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

// ---- what's on top -------------------------------------------------------

// Which surface owns the pad right now. Order matters: it's the stacking order of
// the overlays, topmost first. "page" means the site itself.
function gpScope() {
  if (!$("#attract-overlay").hidden) return "attract";
  if (!$("#lightbox").hidden) return "lightbox";
  if (typeof cmdk !== "undefined" && cmdk.open) return "cmdk";
  if (!$("#navdrawer").hidden) return "nav";
  if (!$("#sheet").hidden) return "sheet";
  if (!$("#overlay").hidden) return "drawer";
  return "page";
}

// The element movement is confined to. Roaming out of an open drawer into the
// list behind it would focus something you can't see.
function gpRoot() {
  switch (gpScope()) {
    case "nav": return $(".navdrawer-panel");
    case "sheet": return $("#sheet");
    case "drawer": return $("#overlay");
    default: return document.body;
  }
}

// ---- focus ---------------------------------------------------------------

const GP_FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// Visible means it has a box, isn't clipped away in a collapsed section, and is
// somewhere near the screen. The last part matters: a listing renders 50 cards,
// and the ones a page-scroll away shouldn't win a "nearest to the right" contest.
// Ordered by cost: the rect is one batched layout and throws out most of the field
// (display:none measures zero), and only the survivors pay for a style resolve.
function gpVisible(el, r) {
  r = r || el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  if (r.bottom < -600 || r.top > window.innerHeight + 600) return false;
  if (el.hidden || el.disabled || el.closest("[hidden]")) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.pointerEvents !== "none";
}

/* What the ring is allowed to land on.

   Buttons and links are the easy half. The other half is the entire point of the
   page: a grid card is a <div class="card"> with an onclick, a listing row is a
   <tr> with an onclick, and neither is keyboard-reachable — deliberately, since
   fifty cards in the Tab order would help nobody. Rather than bolt tabindex onto
   shared markup for the pad's sake, take the app at its word: anything it wired a
   click handler onto is somewhere you can go. The codebase assigns those with
   `el.onclick = …` throughout, which is directly readable off the node.

   A handful of those handlers are delegation on a big container (shelf's row
   strip). Dropping any candidate that contains another keeps the ring on the
   thing you meant rather than the box around it.

   Geometry comes back alongside the elements because the move scores on it:
   measuring here and scoring off that is one layout pass per scan, not two. */
function gpScan() {
  const root = gpRoot() || document.body;
  // querySelectorAll for the focusable half (native, and far cheaper than running
  // matches() over three thousand nodes); a single walk for the click-wired half.
  const seen = new Set(root.querySelectorAll(GP_FOCUSABLE));
  for (const el of root.querySelectorAll("*")) if (el.onclick !== null) seen.add(el);
  const hits = [];
  for (const el of seen) {
    const r = el.getBoundingClientRect();
    if (!gpVisible(el, r)) continue;
    hits.push({ el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  }
  // Only something big can be a delegation container swallowing its own children,
  // so the containment test runs on those alone instead of on every pair.
  const big = window.innerWidth * window.innerHeight * 0.25;
  return hits.filter((h) => h.r.width * h.r.height < big
    || !hits.some((o) => o.el !== h.el && h.el.contains(o.el)));
}

/* The scan is the expensive part (a few ms, and several times that while the
   ambient card animation is dirtying layout between calls), and a held direction
   asks for it nine times a second. So it's cached until something can have changed
   it: a render swapping the nodes out, a scroll moving them, or a resize. The TTL
   is the backstop for whatever those three miss. */
const GP_SCAN_TTL = 500;
let _gpScan = null, _gpScanAt = 0;
const gpInvalidate = () => { _gpScan = null; };

function gpCandidates() {
  const now = performance.now();
  if (_gpScan && now - _gpScanAt < GP_SCAN_TTL) return _gpScan;
  _gpScan = gpScan();
  _gpScanAt = now;
  return _gpScan;
}

// Scroll doesn't bubble, hence the capture phase — and it matters as much as a
// render here, because every score below is in viewport coordinates.
if (typeof MutationObserver === "function") {
  new MutationObserver(gpInvalidate).observe(document.documentElement, { childList: true, subtree: true });
}
document.addEventListener("scroll", gpInvalidate, true);
window.addEventListener("resize", gpInvalidate);

/* Spatial move: from the focused element's centre, keep the candidates that lie
   in the pushed direction, then score them by distance along that axis plus a
   penalty for drifting off it.

   The x4 weight on the off-axis term is what makes a grid feel like a grid.
   Straight distance alone jumps diagonally to whatever happens to be closest,
   and you can never get back to where you were with the opposite press. */
function gpMove(dir) {
  const items = gpCandidates();
  if (!items.length) return;
  const cur = items.find((h) => h.el === gpState.focus);
  if (!cur) { gpSetFocus(items[0].el); return; }

  let best = null, bestScore = Infinity;
  for (const h of items) {
    if (h.el === cur.el) continue;
    const dx = h.cx - cur.cx, dy = h.cy - cur.cy;
    let along, off;
    if (dir === "left") { along = -dx; off = Math.abs(dy); }
    else if (dir === "right") { along = dx; off = Math.abs(dy); }
    else if (dir === "up") { along = -dy; off = Math.abs(dx); }
    else { along = dy; off = Math.abs(dx); }
    if (along < 6) continue;                    // behind us, or the same row/column
    const score = along + off * 4;
    if (score < bestScore) { bestScore = score; best = h.el; }
  }
  if (best) gpSetFocus(best);
}

function gpSetFocus(el) {
  if (gpState.focus) gpState.focus.classList.remove("gp-focus");
  gpState.focus = el || null;
  if (!el) return;
  el.classList.add("gp-focus");
  // A click-wired <div> or <tr> can't take focus at all without this, which would
  // leave the ring on one element and the browser's focus somewhere else entirely.
  // -1 keeps it out of the Tab order, so the keyboard experience is unchanged.
  if (!el.hasAttribute("tabindex") && !el.matches(GP_FOCUSABLE)) el.tabIndex = -1;
  // preventScroll, then scroll ourselves: focus() would slam the element to the
  // middle of the viewport, and "nearest" keeps a grid stepping smoothly.
  try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
  // Any scroll this causes invalidates the cache through the scroll listener
  // above, a frame before the next move can read it.
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// Focus is re-seeded rather than restored after a re-render: the old node is gone
// (renderAll rebuilds the list wholesale), so the ring would sit on an orphan.
function gpReseed() {
  if (gpState.focus && gpState.focus.isConnected && gpVisible(gpState.focus)) return;
  gpSetFocus((gpCandidates()[0] || {}).el || null);
}

// ---- actions -------------------------------------------------------------

function gpActivate() {
  // In the palette, A means "take the highlighted result", which is Enter into
  // the input — cmdk owns its own selection, and we must not fight it.
  if (gpScope() === "cmdk") { gpKey("Enter"); return; }
  // Attract has one thing worth pressing: the cover, which opens the game.
  if (gpScope() === "attract") {
    const cover = document.querySelector(".attract-stage:not(.pre) .attract-cover");
    if (cover) cover.click();
    return;
  }
  if (!gpState.focus || !gpState.focus.isConnected) { gpReseed(); return; }
  gpState.focus.click();
}

// Tabs come from the live nav, hidden ones skipped, so LB/RB walks exactly what
// the menu offers — the same trick cmdkTabs() plays for the palette.
function gpCycleTab(step) {
  const btns = [...document.querySelectorAll("#tabs button[data-tab]")].filter((b) => !b.hidden);
  if (!btns.length) return;
  const at = btns.findIndex((b) => b.dataset.tab === activeTab);
  const next = btns[(at < 0 ? 0 : at + step + btns.length) % btns.length];
  goTab(next.dataset.tab);
  gpState.focus = null;
  requestAnimationFrame(gpReseed);
}

/* Right stick scrolls whatever is actually scrolling, which on this site is almost
   never the window: html and body are height:100% and every pane (.gridwrap, .home,
   .stats, the drawer, the nav) is its own `flex: 1; overflow: auto` box. window.scrollBy
   moves nothing on a desktop page that is exactly one viewport tall.

   So: the focused element's nearest scrollable ancestor, else whatever is scrollable
   under the middle of the screen (which finds the pane you're looking at without
   enumerating every pane the app has), else the window for the mobile layout, where
   the body really is the scroller. */
const gpScrollable = (el) =>
  !!el && el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);

function gpScrollerFrom(el) {
  while (el && el !== document.body && el !== document.documentElement) {
    if (gpScrollable(el)) return el;
    el = el.parentElement;
  }
  return null;
}

function gpScroller() {
  return gpScrollerFrom(gpState.focus)
    || gpScrollerFrom(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2))
    || gpScrollerFrom(gpRoot());
}

function gpScroll(dy) {
  const el = gpScroller();
  if (el) el.scrollTop += dy;
  else window.scrollBy(0, dy);
}

// ---- Konami ---------------------------------------------------------------

// Up up down down left right left right B A, watched in PARALLEL: the presses
// still do their normal job on the way past (B may close something, A may click),
// because a code that swallowed your back button would be worse than no code.
// konami.js keeps the keyboard copy; this is the pad's, sharing only konamiRun().
const GP_KONAMI = ["up", "up", "down", "down", "left", "right", "left", "right", "B", "A"];
let gpKonamiAt = 0;
function gpKonami(token) {
  if (!token) return;
  if (token === GP_KONAMI[gpKonamiAt]) {
    gpKonamiAt++;
    if (gpKonamiAt === GP_KONAMI.length) {
      gpKonamiAt = 0;
      if (typeof konamiRun === "function") konamiRun();
    }
  } else {
    // A wrong token that is itself a valid opening Up restarts at 1, so pressing
    // Up three times doesn't cost you the run.
    gpKonamiAt = token === GP_KONAMI[0] ? 1 : 0;
  }
}

// ---- the hint bar ---------------------------------------------------------

// What each surface answers to, in the order you'd reach for it. Shown while a
// pad is connected and rebuilt when the top surface changes.
function gpHints() {
  switch (gpScope()) {
    case "attract": return [["A", "Details"], ["B", "Exit"], ["Y", "Mute"], ["pad", "Browse"]];
    case "lightbox": return [["B", "Close"], ["pad", "Browse"]];
    case "cmdk": return [["A", "Open"], ["B", "Close"], ["pad", "Move"]];
    case "nav": return [["A", "Select"], ["B", "Close"], ["pad", "Move"]];
    default: return [["A", "Select"], ["B", "Back"], ["menu", "Search"], ["view", "Menu"], ["bump", "Tabs"]];
  }
}

const GP_GLYPH = { pad: "✚", menu: "☰", view: "▣", bump: "LB RB" };
let gpHintKey = "";
function gpRenderHints() {
  const bar = $("#gpHints");
  if (!bar) return;
  const hints = gpHints();
  // Keyed so this repaints when the surface or the tab changes, not on every one of
  // sixty frames a second — and so the measurement below is just as rare.
  const key = gpScope() + "|" + activeTab + "|" + hints.length;
  if (key === gpHintKey) return;
  gpHintKey = key;
  bar.innerHTML = hints.map(([b, label]) =>
    `<span class="gp-hint"><i class="gp-btn gp-btn-${b}">${GP_GLYPH[b] || b}</i>${escapeHtml(label)}</span>`
  ).join("");
  // A listing keeps its pager pinned to the bottom of the window, so the bar rides
  // above it there and drops back to the corner on the tabs that have none.
  const pager = $("#pager");
  const h = pager && !pager.hidden ? pager.offsetHeight : 0;
  bar.style.bottom = (h ? h + 10 : 14) + "px";
}

function gpShowHints(on) {
  const bar = $("#gpHints");
  if (!bar) return;
  bar.hidden = !on;
  if (on) { gpHintKey = ""; gpRenderHints(); }
}

// ---- the loop -------------------------------------------------------------

function gpTick(t) {
  const pad = gpActive();
  if (!pad) { gpStop(); return; }
  const scope = gpScope();
  // Opening or closing an overlay changes what the ring is allowed to sit on, and
  // the old element is usually behind a backdrop now. Re-seed inside the new scope.
  if (scope !== gpState.scope) {
    gpState.scope = scope;
    gpSetFocus(null);
    if (scope !== "cmdk" && scope !== "attract" && scope !== "lightbox") gpReseed();
  }

  // Direction: movement on the page, but a key inside anything that already
  // handles arrows itself.
  const dir = gpDirection(pad, t);
  if (dir) {
    gpKonami(dir);
    if (scope === "cmdk") { if (dir === "up" || dir === "down") gpKey(dir === "up" ? "ArrowUp" : "ArrowDown"); }
    else if (scope === "attract" || scope === "lightbox") {
      if (dir === "left" || dir === "right") gpKey(dir === "left" ? "ArrowLeft" : "ArrowRight");
    } else gpMove(dir);
  }

  // Every edge is read every frame, whatever the scope: skipping the read would
  // leave that button's "was pressed" stuck, and it would fire again on release.
  const hit = {
    a: gpEdge(pad, GP.A), b: gpEdge(pad, GP.B), y: gpEdge(pad, GP.Y),
    menu: gpEdge(pad, GP.MENU), view: gpEdge(pad, GP.VIEW),
    lb: gpEdge(pad, GP.LB), rb: gpEdge(pad, GP.RB),
  };

  if (hit.a) { gpKonami("A"); gpActivate(); }
  if (hit.b) { gpKonami("B"); gpKey("Escape"); }
  if (hit.y && scope === "attract") gpKey("m");
  // Menu opens the palette and closes it again through chrome.js's own toggle, so
  // ⌘K and the pad can never disagree about the state. Not over attract though:
  // that's a screensaver you're watching, and B gets you out of it first.
  if (scope !== "attract") {
    if (hit.menu) setCmdk(!cmdk.open);
    if (hit.view) setNav($("#navdrawer").hidden);
  }
  // Tabs only from the page itself: with the palette or a drawer up, the shoulder
  // buttons would swap the page out from under whatever you were reading.
  if (scope === "page") {
    if (hit.lb) gpCycleTab(-1);
    if (hit.rb) gpCycleTab(1);
  }

  // Right stick scrolls. Squared response so small pushes creep and a full
  // deflection moves, which is how a stick should read for a fine motion.
  const ry = pad.axes[3] || 0;
  if (Math.abs(ry) > 0.18) gpScroll(Math.sign(ry) * Math.pow(Math.abs(ry), 2) * GP_SCROLL_SPEED);

  gpRenderHints();
  gpState.raf = requestAnimationFrame(gpTick);
}

function gpStart() {
  if (gpState.on) return;
  gpState.on = true;
  gpState.prev = {};
  document.documentElement.classList.add("gp-on");
  gpShowHints(true);
  gpReseed();
  gpState.raf = requestAnimationFrame(gpTick);
}

function gpStop() {
  if (!gpState.on) return;
  gpState.on = false;
  cancelAnimationFrame(gpState.raf);
  document.documentElement.classList.remove("gp-on");
  gpShowHints(false);
  gpSetFocus(null);
}

if (navigator.getGamepads) {
  window.addEventListener("gamepadconnected", gpStart);
  // Don't stop on the event itself: it fires per pad, and unplugging the second
  // one shouldn't end the session. gpTick sees the empty list and stops itself.
  window.addEventListener("gamepaddisconnected", () => { if (!gpActive()) gpStop(); });
  // A pad already held at load stays invisible to the page until a button is
  // pressed (a fingerprinting guard, not a bug), and that press fires connected.
}

// A mouse or a keypress means the pad isn't driving any more: drop the ring so
// there aren't two competing cursors on screen. The loop keeps running, and the
// next stick push seeds a fresh ring where it makes sense.
window.addEventListener("pointerdown", () => { if (gpState.focus) gpSetFocus(null); }, true);
