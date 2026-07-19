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

// The collapsed panel. Everything past the one-line bar is behind the caret.
function soundtrackHtml(key) {
  const rec = KHC[key];
  if (!rec || !(rec.tracks || []).length) return "";
  const cover = rec.cover
    ? `<img class="ost-cover" loading="lazy" src="${escapeHtml(cImg(rec.cover))}" alt="">`
    : `<span class="ost-cover ost-cover-blank">${icon("i-music", 20)}</span>`;
  const sub = [rec.type, rec.year, rec.trackCount ? `${rec.trackCount} tracks` : null]
    .filter(Boolean).join(" · ");
  // "Other releases" — the runners-up the match kept (arrangements, gamerips…). Switching
  // one in fetches its tracklist lazily. Only shown when there's actually a choice.
  const alts = (rec.alternates || []);
  const picker = alts.length
    ? `<select class="ost-alts" data-ost-alts title="Other releases on KHInsider">
         <option value="${escapeHtml(rec.slug)}" selected>${escapeHtml(rec.name)}${rec.type ? ` · ${escapeHtml(rec.type)}` : ""}</option>
         ${alts.map((a) => `<option value="${escapeHtml(a.slug)}">${escapeHtml(a.name)}${a.type ? ` · ${escapeHtml(a.type)}` : ""}${a.year ? ` (${escapeHtml(a.year)})` : ""}</option>`).join("")}
       </select>`
    : "";
  const tracks = (rec.tracks || []).map((t, i) =>
    `<li class="ost-trk" data-ost-trk="${i}">
       <span class="ost-n">${t.n || i + 1}</span>
       <span class="ost-name">${escapeHtml(t.name || "")}</span>
       <span class="ost-dur">${t.dur ? escapeHtml(t.dur) : ""}</span>
     </li>`).join("");
  return `<div class="hltb ost" data-ost-key="${escapeHtml(key)}">
    <div class="hltb-head">${icon("i-music", 14)} Soundtrack (KHInsider)</div>
    <div class="ost-bar">
      ${cover}
      <button class="ost-play" data-ost-playall title="Play soundtrack">${icon("i-play", 18)}</button>
      <div class="ost-meta">
        <b class="ost-title">${escapeHtml(rec.name || "")}</b>
        <span class="ost-sub muted">${escapeHtml(sub)}</span>
      </div>
      <button class="ost-toggle linkbtn" data-ost-toggle aria-expanded="false">Tracks ▾</button>
    </div>
    <div class="ost-more" data-ost-more hidden>
      ${picker}
      <ol class="ost-list" data-ost-listhost>${tracks}</ol>
    </div>
    <a class="hltb-link" href="${escapeHtml(rec.url)}" target="_blank" rel="noopener">Open on KHInsider ↗</a>
  </div>`;
}

function wireSoundtrack(key, host) {
  const el = host.querySelector(".ost");
  if (!el) return;
  const more = el.querySelector("[data-ost-more]");
  const toggle = el.querySelector("[data-ost-toggle]");
  if (toggle) toggle.onclick = () => {
    const open = more.hasAttribute("hidden");
    more.toggleAttribute("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Tracks ▴" : "Tracks ▾";
  };
  el.querySelectorAll("[data-ost-trk]").forEach((li) => {
    li.onclick = () => playSoundtrack(key, +li.dataset.ostTrk);
  });
  const playAll = el.querySelector("[data-ost-playall]");
  if (playAll) playAll.onclick = () => playSoundtrack(key, 0);

  // Switching to another release: fetch its tracklist, fold it into the record (keeping the
  // full alternates list so you can switch back), then re-render the panel in place.
  const alts = el.querySelector("[data-ost-alts]");
  if (alts) alts.onchange = async () => {
    const slug = alts.value, prev = KHC[key];
    if (!slug || slug === prev.slug) return;
    alts.disabled = true;
    try {
      const r = await fetch("api/khinsider/album?slug=" + encodeURIComponent(slug));
      if (!r.ok) throw new Error("album");
      const album = await r.json();
      // Rebuild the alternates list around the newly-selected album: the old best rejoins
      // the pool, the new one leaves it.
      const pool = [{ slug: prev.slug, name: prev.name, type: prev.type, year: prev.year, url: prev.url },
                    ...(prev.alternates || [])].filter((a) => a.slug !== slug);
      KHC[key] = Object.assign(album, { alternates: pool });
      if (OSTP && OSTP.key === key) stopSoundtrack();   // the playing album is gone; reset
      const fresh = document.createElement("div");
      fresh.innerHTML = soundtrackHtml(key);
      el.replaceWith(fresh.firstElementChild);
      wireSoundtrack(key, host);
    } catch (_) {
      alts.disabled = false;
    }
  };
}

// Play track `i` of the game's current album, building the docked player if needed.
function playSoundtrack(key, i) {
  const rec = KHC[key];
  if (!rec || !(rec.tracks || [])[i]) return;
  if (!OSTP || OSTP.key !== key) {
    stopSoundtrack();
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

function buildOstDock() {
  // Sticky at the bottom of the drawer's own scroll area, so it stays put while the rest of
  // the card scrolls under it. A child of #drawer (the scroller), not #drawerBody (rebuilt on
  // every open) — stopSoundtrack removes it.
  const old = document.getElementById("ostDock");
  if (old) old.remove();
  const dock = document.createElement("div");
  dock.id = "ostDock";
  dock.innerHTML = `
    <button class="ost-dk-btn" data-ost-prev title="Previous" aria-label="Previous track">${icon("i-skip-back", 20)}</button>
    <button class="ost-dk-btn ost-dk-play" data-ost-toggle-play title="Play/pause" aria-label="Play or pause">${icon("i-play", 20)}</button>
    <button class="ost-dk-btn" data-ost-next title="Next" aria-label="Next track">${icon("i-skip-fwd", 20)}</button>
    <div class="ost-dk-info">
      <span class="ost-dk-title"></span>
      <div class="ost-dk-seekrow">
        <span class="ost-dk-cur">0:00</span>
        <input class="ost-dk-seek" type="range" min="0" max="0" value="0" step="1" data-ost-seek>
        <span class="ost-dk-tot">0:00</span>
      </div>
    </div>
    <button class="ost-dk-btn ost-dk-close" data-ost-close title="Close player">${icon("i-close", 15)}</button>`;
  $("#drawer").appendChild(dock);
  dock.querySelector("[data-ost-toggle-play]").onclick = () => {
    if (!OSTP) return;
    if (OSTP.audio.paused) OSTP.audio.play().catch(() => {}); else OSTP.audio.pause();
  };
  dock.querySelector("[data-ost-prev]").onclick = () => OSTP && playSoundtrack(OSTP.key, OSTP.i - 1);
  dock.querySelector("[data-ost-next]").onclick = () => OSTP && playSoundtrack(OSTP.key, OSTP.i + 1);
  dock.querySelector("[data-ost-close]").onclick = () => stopSoundtrack();
  const seek = dock.querySelector("[data-ost-seek]");
  seek.oninput = () => { if (OSTP && isFinite(OSTP.audio.duration)) OSTP.audio.currentTime = +seek.value; };
  return dock;
}

function drawOstDock() {
  if (!OSTP) return;
  const trk = OSTP.rec.tracks[OSTP.i] || {};
  const n = OSTP.i + 1, total = OSTP.rec.tracks.length;
  OSTP.dock.querySelector(".ost-dk-title").textContent =
    `${n}. ${trk.name || ""}  ·  ${OSTP.rec.name || ""}`;
  OSTP.dock.querySelector("[data-ost-prev]").disabled = OSTP.i <= 0;
  OSTP.dock.querySelector("[data-ost-next]").disabled = OSTP.i >= total - 1;
  drawOstProgress();
}

function drawOstProgress() {
  if (!OSTP) return;
  const a = OSTP.audio, dur = isFinite(a.duration) ? a.duration : 0;
  const seek = OSTP.dock.querySelector("[data-ost-seek]");
  seek.max = String(Math.floor(dur));
  seek.value = String(Math.floor(a.currentTime || 0));
  OSTP.dock.querySelector(".ost-dk-cur").textContent = fmtClock(a.currentTime || 0);
  OSTP.dock.querySelector(".ost-dk-tot").textContent = fmtClock(dur);
}

function setOstPlayIcon(playing) {
  if (!OSTP) return;
  OSTP.dock.querySelector(".ost-dk-play").innerHTML = icon(playing ? "i-pause" : "i-play", 20);
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
