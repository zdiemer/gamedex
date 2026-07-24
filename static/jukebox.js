"use strict";

/* The Jukebox — lean-back shuffle radio across every soundtrack the library matched.

   The drawer already plays one game's album (soundtrack.js); this is the whole shelf on
   random: pick a game with a matched KHInsider OST, pick a track, play it, and when it
   ends pick again. An audio sibling to Attract mode, launched from the same corner of
   the hamburger menu, and it keeps playing while you browse — the player is a small
   dock pinned to the corner of the page, not a tab.

   No new backend: the pool is the light map's ostUrl (slug derived from it), tracklists
   come from /api/khinsider/album, audio streams through /api/khinsider/audio exactly
   like the drawer player. The one genuinely new surface is the COMPOSER view: Wikidata
   `composers` has been captured for years and shown almost nowhere — here it becomes
   the radio's dial ("you own 14 Nobuo Uematsu games — put him on").

   Etiquette: starting the jukebox stops the drawer's player, and vice versa. */

const JB = {
  on: false,
  composer: null,        // radio dial: a composer name, or null = everything
  cur: null,             // {key, row, album, ti} — what's playing
  audio: null,
  history: [],           // played [{key, slug, ti}] so Prev can walk back
  errors: 0,             // consecutive failures; too many and the radio gives up
  browse: false,         // the composer panel is open
  seq: 0,                // async guard: only the latest pick may touch the dock
};
const JBC = {};          // slug -> album record (or null after a failed fetch)

// Volume outlives the session — a radio that resets to full blast isn't lean-back.
const JB_VOL = "gamedex.jukebox.vol";
function jbVolLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(JB_VOL) || "null");
    return v && typeof v.vol === "number" ? v : { vol: 1, muted: false };
  } catch (_) { return { vol: 1, muted: false }; }
}
function jbVolSave(vol, muted) {
  try { localStorage.setItem(JB_VOL, JSON.stringify({ vol, muted })); } catch (_) {}
}

// ---- the pool ---------------------------------------------------------------
const jbSlug = (e) => {
  const m = String((e || {}).ostUrl || "").match(/\/album\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

function jbPool() {
  if (!DATA || !DATA.sheets || !DATA.sheets.games) return [];
  const out = [];
  for (const r of DATA.sheets.games.rows) {
    if (!(r.owned || r.completed)) continue;
    const e = ENRICH[r._k];
    if (!e || !jbSlug(e)) continue;
    if (JB.composer && !(e.composers || []).includes(JB.composer)) continue;
    out.push(r);
  }
  return out;
}

/* The composer dial: who scored the collection, and how much of their work is
   actually playable here. Sorted by playable count — a name with one album is a
   trivia answer, a name with nine is a radio station. */
function jbComposers() {
  const by = new Map();
  if (!DATA || !DATA.sheets || !DATA.sheets.games) return [];
  for (const r of DATA.sheets.games.rows) {
    if (!(r.owned || r.completed)) continue;
    const e = ENRICH[r._k];
    if (!e || !Array.isArray(e.composers)) continue;
    const playable = !!jbSlug(e);
    for (const name of e.composers) {
      const c = by.get(name) || { name, total: 0, playable: 0 };
      c.total += 1;
      if (playable) c.playable += 1;
      by.set(name, c);
    }
  }
  return [...by.values()]
    .filter((c) => c.playable >= 2)
    .sort((a, b) => b.playable - a.playable || b.total - a.total)
    .slice(0, 24);
}

// ---- picking what plays -----------------------------------------------------
async function jbAlbum(slug) {
  if (slug in JBC) return JBC[slug];
  try {
    const r = await fetch(`api/khinsider/album?slug=${encodeURIComponent(slug)}`);
    JBC[slug] = r.ok ? await r.json() : null;
  } catch (_) { JBC[slug] = null; }
  return JBC[slug];
}

const jbDurSecs = (d) => {
  const p = String(d || "").split(":").map(Number);
  return p.some(isNaN) ? 0 : p.reduce((a, b) => a * 60 + b, 0);
};

async function jbNext(pushHistory = true) {
  const seq = ++JB.seq;
  const pool = jbPool();
  if (!pool.length) {
    showToast(ENRICH_READY ? "No playable soundtracks in that pool." : "Soundtracks are still loading — try again in a moment.", "i-music");
    if (!JB.cur) jbStop();
    return;
  }
  // A few draws to avoid replaying the game that just ended; then give in.
  let row = null;
  for (let i = 0; i < 4; i++) {
    row = pool[Math.floor(Math.random() * pool.length)];
    if (!JB.cur || row._k !== JB.cur.key || pool.length === 1) break;
  }
  const album = await jbAlbum(jbSlug(ENRICH[row._k]));
  if (seq !== JB.seq) return;                     // something newer superseded this pick
  const tracks = (album || {}).tracks || [];
  if (!tracks.length) {
    if (++JB.errors >= 6) { showToast("The radio can't reach KHInsider right now.", "i-music"); jbStop(); return; }
    return jbNext(pushHistory);
  }
  // Radio wants music, not stingers: prefer tracks with some body when there's a choice.
  const meaty = tracks.filter((t) => jbDurSecs(t.dur) >= 40);
  const from = meaty.length >= 3 ? meaty : tracks;
  const trk = from[Math.floor(Math.random() * from.length)];
  if (pushHistory && JB.cur) {
    JB.history.push({ key: JB.cur.key, slug: JB.cur.album.slug, ti: JB.cur.ti });
    if (JB.history.length > 50) JB.history.shift();
  }
  jbPlay({ key: row._k, row, album, ti: tracks.indexOf(trk) });
}

async function jbPrev() {
  const last = JB.history.pop();
  if (!last) return;
  const seq = ++JB.seq;
  const album = await jbAlbum(last.slug);
  if (seq !== JB.seq) return;
  const row = (DATA.sheets.games.rows || []).find((r) => r._k === last.key);
  if (!album || !(album.tracks || [])[last.ti] || !row) return jbNext(false);
  jbPlay({ key: last.key, row, album, ti: last.ti }, false);
}

function jbPlay(cur, resetErrors = true) {
  JB.cur = cur;
  if (resetErrors) JB.errors = 0;
  const trk = cur.album.tracks[cur.ti];
  JB.audio.src = "api/khinsider/audio?song=" + encodeURIComponent(trk.song);
  JB.audio.play().catch(() => { /* autoplay refused: the dock shows Play, one tap resumes */ });
  jbDraw();
  jbMediaSession(cur, trk);
}

// ---- lifecycle --------------------------------------------------------------
function jbStart() {
  if (typeof stopSoundtrack === "function") stopSoundtrack();   // one radio at a time
  if (!JB.audio) {
    const audio = new Audio();
    audio.preload = "none";
    audio.addEventListener("ended", () => jbNext());
    audio.addEventListener("error", () => {
      if (!JB.on || !JB.audio.src) return;
      if (++JB.errors >= 6) { showToast("The radio can't reach KHInsider right now.", "i-music"); jbStop(); return; }
      jbNext();
    });
    audio.addEventListener("timeupdate", jbDrawTime);
    audio.addEventListener("durationchange", jbDrawTime);
    audio.addEventListener("play", jbDraw);
    audio.addEventListener("pause", jbDraw);
    const v = jbVolLoad();
    audio.volume = v.vol;
    audio.muted = v.muted;
    JB.audio = audio;
  }
  JB.on = true;
  $("#jukebox").hidden = false;
  jbDraw();
  jbNext(false);
}

function jbStop() {
  JB.on = false; JB.browse = false; JB.cur = null; JB.history = []; JB.seq++;
  if (JB.audio) { try { JB.audio.pause(); JB.audio.src = ""; } catch (_) {} }
  const host = $("#jukebox");
  if (host) host.hidden = true;
  if ("mediaSession" in navigator) try { navigator.mediaSession.metadata = null; } catch (_) {}
}

// The drawer's player calls this before it starts (mirrors us calling stopSoundtrack).
function jukeboxPause() {
  if (JB.on && JB.audio && !JB.audio.paused) JB.audio.pause();
}

function jbToggle() { JB.on ? jbStop() : jbStart(); }

// ---- the dock ---------------------------------------------------------------
function jbDraw() {
  const host = $("#jukebox");
  if (!host || !JB.on) return;
  const cur = JB.cur;
  const e = cur ? ENRICH[cur.key] : null;
  const trk = cur ? cur.album.tracks[cur.ti] : null;
  const cover = cur
    ? (coverSrc(e, "cover_small") || (cur.album.cover ? cImg(cur.album.cover) : ""))
    : "";
  const composers = (e && e.composers || []).slice(0, 2).join(" · ");
  const playing = JB.audio && !JB.audio.paused;
  const comps = JB.browse ? jbComposers() : [];
  host.innerHTML = `
    ${JB.browse ? `<div class="jb-browse">
      <button class="jb-dial${JB.composer ? "" : " on"}" data-jb-dial="">Everything ·
        ${jbPoolCountAll()} soundtracks</button>
      ${comps.map((c) => `<button class="jb-dial${JB.composer === c.name ? " on" : ""}"
        data-jb-dial="${escapeHtml(c.name)}">${escapeHtml(c.name)} · ${c.total} game${c.total === 1 ? "" : "s"}</button>`).join("")}
      ${comps.length ? "" : `<span class="muted">No composers on file yet.</span>`}
    </div>` : ""}
    <div class="jb-bar">
      <button class="jb-cover" data-jb-open title="Open in library">
        ${cover ? `<img src="${escapeHtml(cover)}" alt="">` : icon("i-music", 22)}
      </button>
      <div class="jb-meta" data-jb-open>
        <b>${trk ? escapeHtml(trk.name || "") : "Tuning…"}</b>
        <span class="muted">${cur ? escapeHtml([cur.row.title, cur.row.platform].filter(Boolean).join(" · ")) : ""}</span>
        ${composers ? `<span class="jb-composer">${icon("i-music", 10)} ${escapeHtml(composers)}</span>` : ""}
        <div class="jb-timebar" data-jb-seek><i id="jbTimeFill"></i></div>
      </div>
      <div class="jb-side">
        <div class="jb-ctl">
          <button data-jb-prev title="Previous">${icon("i-skip-back", 16)}</button>
          <button data-jb-play title="Play/pause">${icon(playing ? "i-pause" : "i-play", 18)}</button>
          <button data-jb-next title="Next">${icon("i-skip-fwd", 16)}</button>
          <button data-jb-dial-toggle class="${JB.composer ? "on" : ""}"
            title="${JB.composer ? `Playing: ${escapeHtml(JB.composer)}` : "By composer"}">${icon("i-filter", 15)}</button>
          <button data-jb-close title="Stop the jukebox">${icon("i-close", 15)}</button>
        </div>
        <div class="jb-volume">
          <button data-jb-mute title="Mute">${icon(JB.audio && JB.audio.muted ? "i-muted" : "i-volume", 14)}</button>
          <input type="range" class="jb-vol" data-jb-vol min="0" max="1" step="0.05"
            value="${JB.audio ? JB.audio.volume : 1}" title="Volume">
        </div>
      </div>
    </div>`;
  jbWire(host);
  jbDrawTime();
}

function jbPoolCountAll() {
  const keep = JB.composer;
  JB.composer = null;
  const n = jbPool().length;
  JB.composer = keep;
  return n;
}

function jbDrawTime() {
  const fill = document.getElementById("jbTimeFill");
  if (!fill || !JB.audio) return;
  const d = JB.audio.duration;
  fill.style.width = isFinite(d) && d > 0 ? `${(JB.audio.currentTime / d) * 100}%` : "0";
}

function jbWire(host) {
  host.querySelector("[data-jb-play]").onclick = () => {
    if (!JB.audio) return;
    if (JB.audio.paused) (JB.cur ? JB.audio.play().catch(() => {}) : jbNext(false));
    else JB.audio.pause();
  };
  host.querySelector("[data-jb-next]").onclick = () => jbNext();
  host.querySelector("[data-jb-prev]").onclick = () => jbPrev();
  host.querySelector("[data-jb-close]").onclick = () => jbStop();
  host.querySelector("[data-jb-dial-toggle]").onclick = () => { JB.browse = !JB.browse; jbDraw(); };
  // Volume writes straight to the element — re-rendering the dock mid-drag would
  // yank the slider out from under the pointer.
  const vol = host.querySelector("[data-jb-vol]");
  if (vol) vol.oninput = () => {
    if (!JB.audio) return;
    JB.audio.volume = +vol.value;
    if (JB.audio.muted && +vol.value > 0) { JB.audio.muted = false; jbDraw(); }
    jbVolSave(JB.audio.volume, JB.audio.muted);
  };
  const mute = host.querySelector("[data-jb-mute]");
  if (mute) mute.onclick = () => {
    if (!JB.audio) return;
    JB.audio.muted = !JB.audio.muted;
    jbVolSave(JB.audio.volume, JB.audio.muted);
    jbDraw();
  };
  host.querySelectorAll("[data-jb-dial]").forEach((el) => {
    el.onclick = () => {
      JB.composer = el.dataset.jbDial || null;
      JB.browse = false;
      jbNext();               // retune straight away — that's what a dial does
    };
  });
  host.querySelectorAll("[data-jb-open]").forEach((el) => {
    el.onclick = () => { if (JB.cur) openDrawer(JB.cur.row, "games"); };
  });
  const seek = host.querySelector("[data-jb-seek]");
  if (seek) seek.onclick = (ev) => {
    const d = JB.audio && JB.audio.duration;
    if (!isFinite(d) || !d) return;
    const r = seek.getBoundingClientRect();
    JB.audio.currentTime = ((ev.clientX - r.left) / r.width) * d;
  };
}

// Lock-screen / media-key controls: the whole point of lean-back.
function jbMediaSession(cur, trk) {
  if (!("mediaSession" in navigator)) return;
  try {
    const e = ENRICH[cur.key];
    const art = coverSrc(e, "cover_big");
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trk.name || "",
      artist: [cur.row.title, (e && e.composers || [])[0]].filter(Boolean).join(" — "),
      album: cur.album.name || "",
      artwork: art ? [{ src: art, sizes: "512x512", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => JB.audio && JB.audio.play().catch(() => {}));
    navigator.mediaSession.setActionHandler("pause", () => JB.audio && JB.audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => jbNext());
    navigator.mediaSession.setActionHandler("previoustrack", () => jbPrev());
  } catch (_) { /* media session is a bonus, never a blocker */ }
}
