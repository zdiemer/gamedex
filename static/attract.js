"use strict";

// ---- Attract mode --------------------------------------------------------
// A lean-back, full-screen slideshow: cross-fade between random games, each
// shown as full-screen details with its trailer autoplaying (muted) behind.
// A game with no trailer falls back to a blurred, slowly-panning screenshot.
//
// This rides entirely on machinery app.js already has: the YouTube engine
// (ytSrc / ytWatch / ytCmd / previewClip, bot-wall handling and all), the
// enrichment caches (ENRICH light + DETAIL full), and the overlay conventions
// (anyOverlayOpen + syncScrollLock). Registering #attract-overlay in
// anyOverlayOpen() is what makes the ambient card tour stand down while this is
// up. Launched from a button on Home; Esc / × exits back to it.

const ATTRACT_DWELL = 16000;   // how long each game holds the screen
const ATTRACT_FADE  = 900;     // cross-fade duration — MUST match the CSS transition
// How far into a game's turn the NEXT one starts loading. The gap this leaves (~7.2s of a
// full dwell) is the whole budget for the next trailer to load, start, and burn off
// YouTube's bezel. Measured warm, that costs ~1s to reach PLAYING and ~2.5s of bezel — so
// this is roughly double what it needs, and the slack is what buys a cold connection its
// clean picture too. Earlier only costs a longer overlap with two players running.
const ATTRACT_PRELOAD_AT  = 0.55;
const ATTRACT_PRELOAD_MIN = 2500;   // don't bother with a run-up shorter than the bezel itself

let attractOn = false;
let attractPaused = false;      // true while a game's drawer is open over a paused run
let attractPool = [];          // shuffled [{row, sheetKey}]
let attractIdx = -1;
let attractTimer = null;
let attractDwellStart = 0;     // Date.now() when the current game's countdown began
let attractDwellLeft = 16000;  // ms budgeted for it — trimmed to what's LEFT on a resume
let attractStartPct = 0;       // bar % the current countdown began at (nonzero after a resume)
let attractStage = null;       // the stage currently on screen
let attractPreStage = null;    // the NEXT game's stage, already built and playing invisibly
let attractPreIdx = -1;        // pool index it was built for (-1 = nothing in preroll)
let attractPreTimer = null;
let attractMuted = true;       // start muted so autoplay is never blocked
let attractWentFullscreen = false;   // we requested fullscreen and should undo it on exit
let attractWakeLock = null;          // Screen Wake Lock sentinel — keeps the display awake
let attractIdleTimer = null;         // desktop: hide the chrome after a spell of no movement
const ATTRACT_IDLE = 2600;

// Fullscreen + auto-hiding controls are desktop affordances: touch has no mouse to
// go idle, and mobile fullscreen is a mess. Gate both on a fine pointer.
const attractDesktop = () => window.matchMedia("(pointer: fine)").matches;

// Fisher–Yates. Home's shuffle is date-seeded (stable per day) on purpose; an
// attract run wants fresh randomness every time, so it gets its own.
function attractShuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function attractBuildPool() {
  const out = [];
  const add = (sheetKey) => {
    for (const row of ((DATA.sheets[sheetKey] || {}).rows || [])) {
      // A key we matched to IGDB (or at least haven't ruled out) — anything else
      // has no cover, no video and no detail, so it's a blank stage.
      if (row && row._k && !NO_MATCH.has(row._k)) out.push({ row, sheetKey });
    }
  };
  // Games you actually own: All Games / Completed / On Order. Recommend is the catalogue of
  // games you DON'T own, and Wishlist is games you don't own yet — neither belongs in a
  // slideshow of your collection, so both are excluded.
  TABS.filter((t) => t !== "recs" && t !== "wishlist").forEach(add);
  return attractShuffle(out);
}

function attractTitle(entry) {
  const cols = (DATA.sheets[entry.sheetKey] || DATA.sheets.games).columns;
  const key = cols && cols[0] ? cols[0].key : "title";
  return String(entry.row[key] ?? entry.row.title ?? "Untitled");
}

function attractRequestFullscreen() {
  const el = document.documentElement;                  // the PAGE, not the overlay: hiding
  if (document.fullscreenElement || !el.requestFullscreen) return;  // the overlay when a
  el.requestFullscreen().then(() => { attractWentFullscreen = true; }).catch(() => {});
}                                                        // drawer opens must not drop fullscreen
function attractExitFullscreen() {
  if (attractWentFullscreen && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  attractWentFullscreen = false;
}

// Keep the screen from dimming/sleeping while a trailer plays (no touches to register
// activity). The OS drops the lock whenever the tab is backgrounded, so it's re-acquired
// on visibilitychange while attract is up. HTTPS + the launch gesture make it grantable.
async function attractAcquireWake() {
  if (attractWakeLock || !("wakeLock" in navigator)) return;
  try {
    attractWakeLock = await navigator.wakeLock.request("screen");
    attractWakeLock.addEventListener("release", () => { attractWakeLock = null; });
  } catch (_) { attractWakeLock = null; }   // denied (e.g. low battery) → just let it dim
}
function attractReleaseWake() {
  if (!attractWakeLock) return;
  try { attractWakeLock.release(); } catch (_) { /* already gone */ }
  attractWakeLock = null;
}

// Desktop: reveal the controls/hint on any movement, then fade them (and the cursor)
// after a still moment. Never hides while a drawer is open over a paused run.
function attractPoke() {
  const ov = $("#attract-overlay");
  if (!ov) return;
  ov.classList.remove("attract-idle");
  clearTimeout(attractIdleTimer);
  attractIdleTimer = setTimeout(() => {
    if (attractOn && !attractPaused) ov.classList.add("attract-idle");
  }, ATTRACT_IDLE);
}

// Clicking a game hands off to its full drawer, but attract mode isn't over — it
// just steps aside. Freeze the run (stop the trailer + countdown) and drop the overlay
// BELOW the drawer rather than hiding it, so the game's scene still shows through the
// drawer's scrim. closeDrawer() calls attractResume() to pick it back up.
function attractPause() {
  if (!attractOn || attractPaused) return;
  attractPaused = true;
  // Freeze the countdown mid-flight (all from time, no DOM reads): how far the bar had
  // filled, and how much of this game's turn is left to bank for the resume.
  const elapsed = Date.now() - attractDwellStart;
  const frac = attractDwellLeft > 0 ? Math.min(1, elapsed / attractDwellLeft) : 1;
  attractStartPct = attractStartPct + (100 - attractStartPct) * frac;
  attractDwellLeft = Math.max(1500, attractDwellLeft - elapsed);
  clearTimeout(attractTimer); attractTimer = null;
  clearTimeout(attractIdleTimer); attractIdleTimer = null;
  // Drop any preroll outright rather than freezing it: it was aimed at a reveal time that
  // no longer means anything, and a drawer can sit open for minutes. attractResume's
  // attractNext re-schedules one against the turn that's actually left.
  attractDiscardPreload();
  attractSetProgressStatic(attractStartPct);
  attractStopPlayer(attractStage);
  const ov = $("#attract-overlay");
  ov.classList.remove("attract-idle");
  ov.classList.add("attract-behind");
}

// Returns true if it actually resumed — closeDrawer uses that to skip its own
// scroll-unlock / tour-kick, since attract mode is taking the screen straight back.
function attractResume() {
  if (!attractOn || !attractPaused) return false;
  attractPaused = false;
  $("#attract-overlay").classList.remove("attract-behind");
  syncScrollLock();
  if (attractDesktop()) attractPoke();
  attractNext(0, attractDwellLeft, attractStartPct);   // same game, from where its turn paused
  return true;
}

// Stop a stage's trailer (audio + loop) without tearing the whole stage down.
function attractStopPlayer(stage) {
  if (!stage) return;
  if (stage._loop) { clearInterval(stage._loop); stage._loop = null; }
  if (stage._shotLoop) { clearInterval(stage._shotLoop); stage._shotLoop = null; }
  if (stage._volRamp) { clearInterval(stage._volRamp); stage._volRamp = null; }
  if (stage._watch) { stage._watch(); stage._watch = null; }
  if (stage._frame) {
    const wrap = stage._frame.closest(".attract-video");
    (wrap || stage._frame).remove();
    stage._frame = null;
  }
}

// Attract owns the keyboard while it's up, so global shortcuts don't fire behind
// the overlay (capture + stopPropagation beats app.js's document-level listeners).
function attractKey(e) {
  // Paused (a game's drawer is open over us) → the drawer owns the keyboard.
  if (!attractOn || attractPaused || $("#attract-overlay").hidden) return;
  e.stopPropagation();
  switch (e.key) {
    case "Escape":     e.preventDefault(); closeAttract(); break;
    case "ArrowRight": e.preventDefault(); attractNext(1); break;
    case "ArrowLeft":  e.preventDefault(); attractNext(-1); break;
    case "m": case "M": e.preventDefault(); attractToggleMute(); break;
  }
}

function attractNext(dir, dwellMs, startPct) {
  if (!attractOn) return;
  clearTimeout(attractTimer); attractTimer = null;
  clearTimeout(attractPreTimer); attractPreTimer = null;
  const n = attractPool.length;
  attractIdx = ((attractIdx + dir) % n + n) % n;
  const entry = attractPool[attractIdx];

  const host = $("#attractStages");
  const prev = attractStage;

  // The game we're going to may already BE here — built two thirds of the way through the
  // last turn and playing silently at opacity 0 on top of it (attractPreload). Adopt it and
  // its trailer is already past YouTube's start-up bezel. Anything else in preroll (an arrow
  // key went somewhere the preload didn't expect) is just a stage nobody claimed; the sweep
  // below collects it.
  let stage = (attractPreStage && attractPreIdx === attractIdx) ? attractPreStage : null;
  attractPreStage = null; attractPreIdx = -1;

  // Rapid arrow-mashing can outrun the fade; keep at most the outgoing stage.
  host.querySelectorAll(".attract-stage").forEach((s) => { if (s !== prev && s !== stage) attractTeardownStage(s); });

  if (stage) attractRevealPre(stage);
  else { stage = attractBuildStage(entry, 0); host.appendChild(stage); }
  void stage.offsetWidth;                 // commit initial opacity:0 before fading in
  stage.classList.add("attract-in");
  if (prev) {
    prev.classList.remove("attract-in");
    attractRampVolume(prev, 0, ATTRACT_FADE);   // fade the outgoing trailer's audio out too
    setTimeout(() => attractTeardownStage(prev), ATTRACT_FADE);
  }
  attractStage = stage;

  // Warm the next game's detail so its summary/screenshot is ready at swap time.
  const nxt = attractPool[(attractIdx + 1) % n];
  if (nxt && nxt.row._k) attractFetchDetail(nxt.row._k);

  // A fresh game (or a manual next/prev) gets the full dwell from an empty bar. A
  // resume passes the time that was LEFT when the drawer opened AND the bar % it froze
  // at, so the countdown continues from there rather than restarting.
  const ms = dwellMs || ATTRACT_DWELL;
  attractDwellStart = Date.now();
  attractDwellLeft = ms;
  attractStartPct = startPct || 0;
  attractSetProgress(attractStartPct, ms);
  attractTimer = setTimeout(() => attractNext(1), ms);
  // Start the next game loading with enough of this turn left for it to come good. A
  // resumed sliver of a turn hasn't got the run-up to be worth the second player.
  const lead = ms * (1 - ATTRACT_PRELOAD_AT);
  if (lead >= ATTRACT_PRELOAD_MIN) attractPreTimer = setTimeout(attractPreload, ms - lead);
}

// Load the next game's trailer while the current one still owns the screen.
//
// YouTube draws a centred play/pause bezel over the first ~2.5s of playback and nothing
// suppresses it — not controls=0, not any player size, and it can't be styled (cross-origin)
// or cropped (it's centred). startPreview has the full autopsy. But it only costs us anything
// if it's on screen when it plays: a stage sits at opacity 0 until .attract-in, so a trailer
// started EARLY burns the bezel off where nobody can see it, and the cross-fade brings in a
// clean picture. It's the one way out that doesn't need YouTube's cooperation.
//
// Only worth it for a game that HAS a trailer. Without one there's nothing to get ahead of,
// and a stage built early would arrive with its Ken-Burns pan already seconds along.
function attractPreload() {
  if (!attractOn || attractPaused) return;
  const n = attractPool.length;
  const idx = (attractIdx + 1) % n;
  const entry = attractPool[idx];
  if (!entry || !entry.row._k) return;
  if (!(ENRICH[entry.row._k] || {}).video || YT_BLOCKED || !WANTS_MOTION) return;
  if (attractPreStage) attractTeardownStage(attractPreStage);
  // Built against the moment it will be revealed, so its trailer can aim for it.
  const stage = attractBuildStage(entry, attractDwellStart + attractDwellLeft);
  $("#attractStages").appendChild(stage);
  attractPreStage = stage;
  attractPreIdx = idx;
}

// A preloaded stage takes the screen: it can be clicked into again, and its trailer — kept
// silent through the preroll so it couldn't be heard playing over the game you were actually
// watching — comes up to volume. A trailer that hasn't started yet is handled by
// attractPlayVideo's onPlay instead, which reads the _pre flag we're clearing here.
function attractRevealPre(stage) {
  stage._pre = false;
  stage.classList.remove("attract-pre");
  if (stage._videoLive && !attractMuted) attractRampVolume(stage, 100, ATTRACT_AUDIO_FADE);
}

function attractDiscardPreload() {
  clearTimeout(attractPreTimer); attractPreTimer = null;
  if (attractPreStage) attractTeardownStage(attractPreStage);
  attractPreStage = null; attractPreIdx = -1;
}

// The countdown bar. Progress is tracked from TIME (not by measuring the animating
// DOM), so freezing it mid-flight is exact. attractSetProgress animates startPct→100%
// over `ms`; attractSetProgressStatic pins it; attractClearProgress empties it.
function attractSetProgress(startPct, ms) {
  const fill = $("#attractProgressFill");
  if (!fill) return;
  fill.style.transition = "none";
  fill.style.width = startPct + "%";
  void fill.offsetWidth;                                   // commit the start before animating
  fill.style.transition = `width ${ms}ms linear`;
  fill.style.width = "100%";
}
function attractSetProgressStatic(pct) {
  const fill = $("#attractProgressFill");
  if (!fill) return;
  fill.style.transition = "none";
  fill.style.width = pct + "%";
}
function attractClearProgress() { attractSetProgressStatic(0); }

// Pick the best backdrop from a game's detail: cross-fade its screenshots (then
// artworks); a single image gets a Ken-Burns still; nothing usable falls back to the
// cover, which at least pans rather than sitting there stretched.
function attractShowBackdrop(stage, d, cs) {
  const shots = [...((d && d.screenshots) || []), ...((d && d.artworks) || [])]
    .slice(0, 6).map((id) => IMG(id, "screenshot_big"));
  if (WANTS_MOTION && shots.length > 1) attractRunShots(stage, stage._bg, shots);
  else attractShowArt(stage._bg, shots[0] || cs, true);
}

const ATTRACT_SHOT_MS = 4200;

const ATTRACT_AUDIO_FADE = 1100;   // ms to ease a trailer's audio in / out
// Ramp a stage's trailer volume from where it is to `to` (0–100) over `ms`, via the
// IFrame API's setVolume. YouTube autoplay forces a muted start, so this is only
// audible after the user has unmuted — but the fade is applied regardless.
function attractRampVolume(stage, to, ms) {
  if (!stage || !stage._frame) return;
  if (stage._volRamp) { clearInterval(stage._volRamp); stage._volRamp = null; }
  const frame = stage._frame;
  const from = stage._vol != null ? stage._vol : 0;
  const t0 = Date.now();
  if (to > 0) ytCmd(frame, "unMute");
  stage._volRamp = setInterval(() => {
    const p = Math.min(1, (Date.now() - t0) / ms);
    stage._vol = Math.round(from + (to - from) * p);
    ytCmd(frame, "setVolume", [Math.max(0, Math.min(100, stage._vol))]);
    if (p >= 1) {
      clearInterval(stage._volRamp); stage._volRamp = null;
      if (to <= 0) ytCmd(frame, "mute");   // silence fully once faded out
    }
  }, 50);
}

// The trailer never played — make sure the screenshot backdrop is up (it usually
// already is from the detail fetch; this covers the race where detail lands late).
function attractVideoFailed(stage, cs) {
  if (stage._dead || stage._videoLive || stage._shotLoop) return;
  if (stage._detail) attractShowBackdrop(stage, stage._detail, cs);
  else if (stage._k) attractFetchDetail(stage._k).then((d) => {
    if (d && !stage._dead && !stage._videoLive) { stage._detail = d; attractShowBackdrop(stage, d, cs); }
  });
}

function attractTeardownStage(stage) {
  if (!stage) return;
  stage._dead = true;
  if (stage._loop) { clearInterval(stage._loop); stage._loop = null; }
  if (stage._shotLoop) { clearInterval(stage._shotLoop); stage._shotLoop = null; }
  if (stage._volRamp) { clearInterval(stage._volRamp); stage._volRamp = null; }
  if (stage._watch) { stage._watch(); stage._watch = null; }   // ytWatch's own cleanup
  stage.remove();
}

// Detail fetch that only cares about the IGDB record (loadDetail does much more,
// for the drawer). Shares the DETAIL cache, de-dupes in-flight requests.
const _attractDetailReq = {};
function attractFetchDetail(k) {
  if (DETAIL[k]) return Promise.resolve(DETAIL[k]);
  if (_attractDetailReq[k]) return _attractDetailReq[k];
  const p = fetch("api/enrichment/detail?key=" + encodeURIComponent(k))
    .then((r) => r.json())
    .then((j) => (j && j.status === "matched" && j.detail) ? (DETAIL[k] = j.detail) : null)
    .catch(() => null)
    .finally(() => { delete _attractDetailReq[k]; });
  _attractDetailReq[k] = p;
  return p;
}

function attractToggleMute() {
  attractMuted = !attractMuted;
  const stage = attractStage;
  if (stage && stage._frame) {
    if (attractMuted) attractRampVolume(stage, 0, 450);    // fade down, then mute
    else attractRampVolume(stage, 100, 650);               // unmute + fade up
  }
  attractApplyMuteBtn();
}

// Controls live in index.html (fixtures of the overlay), so wire them once at load.
// stopPropagation keeps a control click from also triggering the stage's open-drawer.
(function attractWireControls() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
  };
  bind("attractClose", closeAttract);
  bind("attractMute", attractToggleMute);
  bind("attractPrev", () => attractNext(-1));
  bind("attractNext", () => attractNext(1));

  // Touch: swipe left/right to page, the way a phone photo gallery does — the arrows
  // are still there, but a swipe is the gesture you reach for. Only a deliberate
  // horizontal drag counts; a vertical move or a plain tap (which opens the game via
  // the cover/title handler) is left alone. Ignored while a game's drawer is open over
  // a paused run — that swipe belongs to the drawer.
  const stages = $("#attractStages");
  if (stages) {
    let x0 = null, y0 = null;
    stages.addEventListener("touchstart", (e) => {
      if (!attractOn || attractPaused) { x0 = null; return; }
      x0 = e.changedTouches[0].clientX; y0 = e.changedTouches[0].clientY;
    }, { passive: true });
    stages.addEventListener("touchend", (e) => {
      if (x0 == null || !attractOn || attractPaused) { x0 = null; return; }
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy)) return;   // a tap or a vertical scroll
      attractNext(dx < 0 ? 1 : -1);                                   // left → next, right → prev
    }, { passive: true });
  }

  // Leaving fullscreen (Esc / F11) while watching means "I'm done" — exit attract too,
  // so a single Esc gets you all the way out. Skipped while a game's drawer is open over
  // a paused run (that Esc belongs to the drawer), and a no-op when WE dropped fullscreen
  // on the way out (attractWentFullscreen is already cleared by then).
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) return;
    const wasOurs = attractWentFullscreen;
    attractWentFullscreen = false;
    if (wasOurs && attractOn && !attractPaused) closeAttract();
  });

  // The OS drops the wake lock when the tab is backgrounded — take it back on return.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && attractOn) attractAcquireWake();
  });
})();
