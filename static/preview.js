"use strict";

/* Trailers that play without being asked, and the tour that plays them for you.

   Three layers, in order: ytWatch knows whether YouTube ACTUALLY played (it
   serves some clients a bot wall, and a silent black box is worse than no
   trailer); hover-to-play commits a card to a clip after a dwell; the tour takes
   over when the page has been idle long enough to mean nobody is driving.

   All of it is off when the OS asks for reduced motion. */

// ---- YouTube: know whether it actually played ----------------------------
// YouTube serves some clients a "sign in to confirm you're not a bot" wall
// inside the embed. We can't overrule that, and we can't read a cross-origin
// iframe to detect it — but we CAN ask the player whether it started, using the
// IFrame API's postMessage handshake. If it never reaches the playing state, the
// embed is useless: tear it down and show something the user can actually click.
const YT_ORIGIN = location.origin;
const YT_TIMEOUT = 4500;
let ytFailures = 0;               // consecutive; a play resets it
const YT_GIVE_UP = 4;             // dead trailers are common; a wall is not
let YT_BLOCKED = false;         // once YouTube is clearly refusing us, stop trying

const ytSrc = (id, opts = {}) => {
  const p = new URLSearchParams({
    rel: "0", modestbranding: "1", playsinline: "1",
    enablejsapi: "1", origin: YT_ORIGIN, ...opts,
  });
  return `https://www.youtube.com/embed/${id}?${p}`;
};

// Watch a player: onPlay() the moment it truly starts, onFail() if it never does
// within YT_TIMEOUT.
// Drive a player from out here. The widget API takes commands over postMessage, which is
// how we seek and loop WITHOUT asking for it in the URL — see startPreview for why that
// matters.
function ytCmd(frame, func, args) {
  try {
    frame.contentWindow.postMessage(
      JSON.stringify({ event: "command", func, args: args || [], id: 1, channel: "widget" }), "*");
  } catch (_) { /* not loaded yet */ }
}

// Captions ride the VIEWER's YouTube preference into every embed, and there is no URL param
// that turns them off. cc_load_policy=1 forces them ON, but 0 does NOT force them off — it
// only means "don't force", which leaves a default-on track drawing over the picture.
// Measured: with cc_load_policy=0 captions render exactly as often as with it forced on, so
// the param buys nothing and startPreview's minimal-params rule says don't send it. The
// captions MODULE is the only thing that works, and it doesn't exist until the player does —
// which is why this can't live in ytSrc and has to wait for playback.
// (setOption("captions","track",{}) works identically; unloadModule("cc") is the old Flash
// module name and does nothing at all.)
const ytNoCaptions = (frame) => ytCmd(frame, "unloadModule", ["captions"]);

// onPlay fires once, when the player is genuinely PLAYING. onInfo gets every payload
// (playerState, currentTime, duration) and keeps firing, so a caller can drive a loop.
function ytWatch(frame, onFail, onPlay, onInfo) {
  let alive = false, played = false;
  const onMsg = (e) => {
    if (!/youtube(-nocookie)?\.com$/.test(new URL(e.origin).hostname.replace(/^www\./, ""))) return;
    if (e.source !== frame.contentWindow) return;
    let d;
    try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch (_) { return; }
    const info = d && d.info;
    if (!info) return;
    const state = info.playerState;        // 1 playing, 2 paused, 3 buffering, 0 ended
    if (state === 1 || state === 3) {      // playing OR buffering: it's alive, not a wall
      alive = true;
      ytFailures = 0;
      clearTimeout(timer);                 // real player: call off the bot-wall watchdog
    }
    // Reveal ONLY on state 1. BUFFERING is not "started" — the player is still booting.
    if (state === 1 && !played) {
      played = true;
      clearInterval(poke);
      if (onPlay) onPlay();
    }
    if (onInfo) onInfo(info);              // keeps streaming: currentTime / duration
  };
  const cleanup = () => {
    window.removeEventListener("message", onMsg);
    clearTimeout(timer);
    clearInterval(poke);
  };
  window.addEventListener("message", onMsg);

  // The player only starts reporting once we say hello.
  const poke = setInterval(() => {
    try {
      frame.contentWindow.postMessage('{"event":"listening","id":1,"channel":"widget"}', "*");
    } catch (_) { /* not loaded yet */ }
  }, 400);

  const timer = setTimeout(() => {
    // A player that reached buffering is real — it may just be slow. Keep listening for
    // PLAYING (hover-out tears this down anyway) rather than counting a failure.
    if (alive) { clearInterval(poke); return; }
    cleanup();
    // Enough consecutive strikes and we stop asking: if YouTube is walling this
    // client, every further embed is just another wall. But a single dead embed
    // is NOT that — IGDB's video ids go stale (deleted trailers, embedding turned
    // off), and those fail exactly the same way from out here. Give it real
    // evidence of a pattern before writing the feature off; any success resets.
    if (++ytFailures >= YT_GIVE_UP) YT_BLOCKED = true;
    onFail();
  }, YT_TIMEOUT);
  return cleanup;
}

// ---- hover-to-play trailer previews --------------------------------------
// Hover a card and its trailer plays, muted, from a random point in the middle —
// the opening seconds of a trailer are logos, so starting at 0 would show you a
// publisher ident every time. Leaving the card puts the box art back.
//
// Guarded by hover-intent (a moment's dwell), so scrolling across the grid
// doesn't spawn twenty iframes; by a pointer check, since there's no hover on
// touch; and by prefers-reduced-motion.
const WANTS_MOTION = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const PREVIEW_DELAY = 280;                 // dwell before we commit to loading — snappy, sub-second
let previewTimer = null, previewCard = null, previewWatch = null, previewLoop = null, previewShotTimer = null;
const SHOT_PREVIEW_MS = 1600;              // how long each screenshot holds before the next fades in

// WHICH slice of the trailer to show: a random 30 second clip, which then loops. Rolled
// once per video and remembered, so hovering the same card twice shows the same moment — a
// clip that jumps somewhere new on every hover reads as a glitch, not as variety. Rolled
// fresh each page load, so it isn't the same forever. Kept clear of both ends: trailers
// open on publisher idents and close on an endcard.
const PREVIEW_CLIP = new Map();
const PREVIEW_CLIP_LEN = 30;
function previewClip(vid, duration) {
  if (!PREVIEW_CLIP.has(vid)) {
    const d = duration || 90;
    // 30s, unless the trailer is too short to hold one — then take what's there.
    const len = Math.max(8, Math.min(PREVIEW_CLIP_LEN, Math.floor(d - 15)));
    const lo = 10;
    const hi = Math.max(lo + 1, Math.floor(d - len - 5));
    const start = lo + Math.floor(Math.random() * Math.max(1, hi - lo));
    PREVIEW_CLIP.set(vid, { start, len });
  }
  return PREVIEW_CLIP.get(vid);
}

function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
  clearInterval(previewLoop);          // stop re-seeking a player we're about to remove
  previewLoop = null;
  clearInterval(previewShotTimer);     // stop the screenshot slideshow too
  previewShotTimer = null;
  // Cancel the bot-wall watchdog FIRST. Without this, hovering off a card before
  // the video has started still lets the watchdog fire 4.5s later and record a
  // failure against YouTube — so two impatient hovers on a slow connection would
  // trip YT_BLOCKED and kill previews for the rest of the session.
  if (previewWatch) { previewWatch(); previewWatch = null; }
  // Sweep EVERY player, not just the one previewCard happens to point at. One video plays
  // on this page, full stop. Trusting a single pointer means any orphan — a card re-rendered
  // mid-play, a race between the tour and a hover — leaves a second trailer running that
  // nothing can now reach to kill. Cheap query, and it makes "only the hovered one plays"
  // true by construction rather than by careful bookkeeping.
  document.querySelectorAll("iframe.card-preview").forEach((f) => f.remove());
  document.querySelectorAll(".card-shots").forEach((l) => l.remove());
  document.querySelectorAll(".card.previewing, .card.playing")
    .forEach((c) => c.classList.remove("previewing", "playing"));
  previewCard = null;
}

// A card previews its TRAILER if it has one (and YouTube is playing for this client),
// otherwise it cross-fades its SCREENSHOTS. Games with neither don't preview at all — and
// tourEligible never schedules them, so the tour skips them for free.
function startPreview(card) {
  const row = CARD_ROW.get(card);
  if (!row || card === previewCard) return;
  const e = ENRICH[row._k] || {};
  if (e.video && !YT_BLOCKED) return startTrailerPreview(card, e.video);
  if (e.shots && e.shots.length) return startShotPreview(card, e.shots);
}

// Any surface that renders a .card can opt in: it just has to tell us which row
// the card is for. The grid does this as it builds; Home does it after the fact.
function wirePreviewFor(card, row) {
  CARD_ROW.set(card, row);
  wirePreview(card);
  // Home and Pick build their cards through here rather than renderGrid, so this is where
  // the tour gets armed on those surfaces — without it, the landing page (Home) never
  // started a tour at all, which is exactly what the first headless run caught.
  tourArm();
}

function wirePreview(card) {
  if (!WANTS_MOTION) return;
  // pointerenter tells us WHAT is hovering. A media query doesn't: headless
  // Chrome and plenty of real desktops report (hover: none), and a touch that
  // lingers would otherwise trigger a preview you never asked for.
  card.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    const already = previewCard === card;        // the tour is already showing this one
    tourFreeze();                                // you're driving now; the tour yields
    clearTimeout(previewTimer);
    // Adopt the running player rather than tearing it down and starting the clip over
    // under your cursor — hovering what's already playing should be a no-op, not a restart.
    if (already) return;
    // Kill whatever else is playing NOW, not after the dwell: hovering a card should leave
    // exactly one trailer on screen — this one — from the instant you arrive.
    stopPreview();
    previewTimer = setTimeout(() => startPreview(card), PREVIEW_DELAY);
  });
  card.addEventListener("pointerleave", () => {
    if (previewCard === card) stopPreview();
    else clearTimeout(previewTimer);
    tourKick();                                  // hands off the wheel → tour counts down again
  });
  previewVis.observe(card);                      // stop playing the moment it leaves the screen
}

// ---- Autoplay tour -------------------------------------------------------
// Left alone on a page of cards, walk down them playing each one's trailer in turn.
// It rides on the same single-preview machinery as hover — startPreview/stopPreview keep
// exactly one player alive — so the tour can never stack a second video on the page, and
// a hover always wins (pointerenter stops the tour outright).
const TOUR_IDLE = 5000;    // quiet on the page this long before the tour begins
const TOUR_PLAY = 30000;   // each card holds the stage for one full clip loop
const TOUR_GAP  = 1200;    // a beat between cards — long enough to read as a hand-off
const TOUR_FADE = 450;     // must match the .card-preview / .card-cover transition in CSS
let tourIdleTimer = null, tourTimer = null, tourOn = false, tourLast = null;

// A card is eligible only if it has SOMETHING to play — a trailer, or screenshots to
// cross-fade. A card with neither is never scheduled, so it costs no time at all rather
// than burning a turn on a blank tile.
const tourEligible = () => [...document.querySelectorAll(".card")]
  .filter((c) => {
    const row = CARD_ROW.get(c);
    const e = row && ENRICH[row._k];
    return e && (e.video || (e.shots && e.shots.length));
  });

// ...and only if you can actually see it. Autoplaying a card three screens down is a
// video nobody watches — and on scroll, the tour re-picks from what's on screen now.
function tourVisible(el) {
  const r = el.getBoundingClientRect();
  return r.top < window.innerHeight - 40 && r.bottom > 40 && r.left < window.innerWidth && r.right > 0;
}

const tourAllowed = () =>
  WANTS_MOTION && !YT_BLOCKED && !document.hidden && !anyOverlayOpen();

// A video only ever plays on a card you can SEE. This is the authority on that — a scroll
// listener only samples on a throttle and misses anything moved by a keyboard, a jump link
// or a re-layout. It covers hover previews too, not just the tour: scroll a hovered card
// off the top and its trailer is playing to an empty room just the same.
const previewVis = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.target !== previewCard) continue;
    if (e.isIntersecting && e.intersectionRatio >= 0.35) continue;
    const wasTour = tourOn && e.target === tourLast;
    stopPreview();
    if (wasTour) {                       // it was the tour's turn — move on to one in view
      clearTimeout(tourTimer);
      tourTimer = setTimeout(tourNext, TOUR_GAP);
    }
  }
}, { threshold: [0, 0.35, 0.7] });

// Stop SCHEDULING, but leave any running player alone — for when the user takes over by
// hovering the very card the tour is on.
function tourFreeze() {
  tourOn = false;
  clearTimeout(tourIdleTimer); tourIdleTimer = null;
  clearTimeout(tourTimer); tourTimer = null;
}

function tourStop() {
  const owned = previewCard && previewCard === tourLast;
  tourFreeze();
  // Only tear down a player the TOUR started. A hover preview is the user's, not ours.
  if (owned) stopPreview();
}

// Restart the countdown. Called whenever the USER does something — the tour is what happens
// when they stop.
function tourKick() {
  clearTimeout(tourIdleTimer); tourIdleTimer = null;
  clearTimeout(tourTimer); tourTimer = null;
  tourOn = false;
  if (!tourAllowed()) return;
  tourIdleTimer = setTimeout(() => { tourOn = true; tourNext(); }, TOUR_IDLE);
}

// Start the clock if it isn't already running, WITHOUT restarting it. Cards get wired as
// enrichment lands, a few at a time over several seconds — and a full kick per card kept
// shoving the countdown forward, so a "5 second" tour didn't start for eleven. Wiring a card
// is not the user doing something; it just means there is now something worth touring.
function tourArm() {
  if (tourIdleTimer || tourOn || !tourAllowed()) return;
  tourIdleTimer = setTimeout(() => { tourOn = true; tourNext(); }, TOUR_IDLE);
}

function tourNext() {
  if (!tourOn || !tourAllowed()) return tourStop();
  const all = tourEligible();
  const shown = all.filter(tourVisible);
  if (!shown.length) {                       // nothing on screen worth playing — look again later
    tourTimer = setTimeout(tourNext, TOUR_GAP);
    return;
  }
  // Carry on DOWN the list from whoever went last, and wrap when we run off the end.
  let card = shown[0];
  const at = tourLast ? all.indexOf(tourLast) : -1;
  if (at >= 0) card = all.slice(at + 1).find(tourVisible) || shown[0];

  tourLast = card;
  startPreview(card);
  tourTimer = setTimeout(() => {
    // Dissolve, don't cut. Dropping .playing fades the trailer out and the box art back in
    // together; only once that has run do we actually tear the player down. Ripping the
    // iframe out first would snap the cover back mid-fade and there'd be nothing to see.
    fadeOutPreview(card, () => { tourTimer = setTimeout(tourNext, TOUR_GAP); });
  }, TOUR_PLAY);
}

// Fade a tour card back to its cover, then stop it. Anything that has already moved on
// (a hover, a scroll, the next card) short-circuits — stopPreview sweeps regardless.
function fadeOutPreview(card, done) {
  if (previewCard !== card) return void (done && done());
  card.classList.remove("playing");
  setTimeout(() => {
    if (previewCard === card) stopPreview();
    done && done();
  }, TOUR_FADE);
}

if (WANTS_MOTION) {
  // Scrolling doesn't cancel the tour — you're still watching, and pausing it every time
  // the page moves would make it feel broken. Which card is on screen is handled by
  // previewVis above; scrolling just changes the answer.
  // Typing, clicking, or leaving the tab all mean "not idle" — start the clock over.
  ["keydown", "pointerdown"].forEach((ev) =>
    document.addEventListener(ev, () => tourKick(), { passive: true }));
  document.addEventListener("visibilitychange", () => (document.hidden ? tourStop() : tourKick()));
}
