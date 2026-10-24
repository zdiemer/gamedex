"use strict";

/* The soundtrack panel and its player — the game's music, from KHInsider (src/khinsider.py).

   The drawer is already a tall stack of source panels, so this one stays SMALL until you ask
   for it: a single collapsed bar (cover · album · N tracks · play), the tracklist only appears
   on the caret, and playback happens in a slim bar DOCKED to the bottom of the drawer that
   persists as you keep scrolling through the rest of the card. Nothing here adds height unless
   you're using it.

   Two lazy hops the source forces (see app.py): switching to another release fetches that
   album's tracklist on demand (/api/khinsider/album), and a track's real CDN mp3 is one page
   deep, so the <audio> points at /api/khinsider/audio which resolves-and-redirects. The audio
   itself streams straight off the CDN (range requests, no Referer check), so seeking is real. */

// The one live player. Detached <audio> + the state the dock draws from; there is only ever
// one, torn down and rebuilt as the drawer opens a different game (see stopSoundtrack).
let OSTP = null;

function fmtClock(secs) {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// Play track `i` of the game's current album, building the docked player if needed.
function playSoundtrack(key, i) {
  const rec = KHC[key];
  if (!rec || !(rec.tracks || [])[i]) return;
  if (!OSTP || OSTP.key !== key) {
    stopSoundtrack();
    if (typeof jukeboxPause === "function") jukeboxPause();   // one radio at a time
    const audio = new Audio();
    audio.preload = "none";
    OSTP = { key, rec, i: -1, audio, dock: buildOstDock() };
    audio.addEventListener("timeupdate", drawOstProgress);
    audio.addEventListener("durationchange", drawOstProgress);
    audio.addEventListener("play", () => setOstPlayIcon(true));
    audio.addEventListener("pause", () => setOstPlayIcon(false));
    audio.addEventListener("ended", () => playSoundtrack(OSTP.key, OSTP.i + 1));
  }
  OSTP.rec = rec;                       // may have changed if a release was switched
  if (i < 0 || i >= rec.tracks.length) return;
  OSTP.i = i;
  const trk = rec.tracks[i];
  OSTP.audio.src = "api/khinsider/audio?song=" + encodeURIComponent(trk.song);
  OSTP.audio.play().catch(() => {});
  drawOstDock();
  highlightOstTrack();
}

// Mark the row that's playing, but only if the panel for THIS game is on screen (a different
// game may be open now while the previous one's track plays on).
function highlightOstTrack() {
  document.querySelectorAll(".ost-trk.playing").forEach((li) => li.classList.remove("playing"));
  if (!OSTP) return;
  const panel = document.querySelector(`.ost[data-ost-key="${CSS.escape(OSTP.key)}"]`);
  if (!panel) return;
  const li = panel.querySelector(`[data-ost-trk="${OSTP.i}"]`);
  if (li) li.classList.toggle("playing", !OSTP.audio.paused);
}

function stopSoundtrack() {
  if (OSTP) {
    try { OSTP.audio.pause(); OSTP.audio.src = ""; } catch (_) {}
    if (OSTP.dock) OSTP.dock.remove();
    OSTP = null;
  }
  const stray = document.getElementById("ostDock");
  if (stray) stray.remove();
  document.querySelectorAll(".ost-trk.playing").forEach((li) => li.classList.remove("playing"));
}
