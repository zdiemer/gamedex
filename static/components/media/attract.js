"use strict";

// UI components for attract.js. Feature state and orchestration remain in that module.

function openAttract() {
  if (attractOn || !DATA) return;
  attractPool = attractBuildPool();
  if (!attractPool.length) return;
  attractOn = true;
  attractPaused = false;
  attractIdx = -1;
  // Nothing should be playing behind the overlay: stop the tour AND any hover.
  if (typeof tourStop === "function") tourStop();
  if (typeof stopPreview === "function") stopPreview();
  $("#attractStages").innerHTML = "";
  attractStage = null;
  $("#attract-overlay").hidden = false;
  document.addEventListener("keydown", attractKey, true);
  syncScrollLock();
  attractApplyMuteBtn();
  attractAcquireWake();                                  // keep the screen awake (esp. mobile)
  attractRequestFullscreen();                            // desktop AND mobile; no-ops on iPhone
  if (attractDesktop()) {                                // idle-hide is mouse-only
    document.addEventListener("mousemove", attractPoke, true);
    attractPoke();                                       // arm the idle-hide countdown
  }
  attractNext(1);
}

function closeAttract() {
  if (!attractOn) return;
  attractOn = false;
  attractPaused = false;
  clearTimeout(attractTimer); attractTimer = null;
  attractDiscardPreload();
  document.removeEventListener("keydown", attractKey, true);
  const host = $("#attractStages");
  if (host) {
    host.querySelectorAll(".attract-stage").forEach(attractTeardownStage);
    host.innerHTML = "";
  }
  attractStage = null;
  attractClearProgress();
  document.removeEventListener("mousemove", attractPoke, true);
  clearTimeout(attractIdleTimer); attractIdleTimer = null;
  $("#attract-overlay").classList.remove("attract-idle", "attract-behind");
  attractExitFullscreen();
  attractReleaseWake();
  $("#attract-overlay").hidden = true;
  syncScrollLock();
  if (typeof tourKick === "function") tourKick();   // let Home's ambient tour resume
}

// revealAt: when this stage is due to take the screen (Date.now() ms), or 0 for "now". A
// nonzero one marks a preroll — it stays silent and unclickable until attractRevealPre, and
// its trailer uses the lead to get itself picture-clean before anyone sees it.
function attractBuildStage(entry, revealAt) {
  const { row, sheetKey } = entry;
  const k = row._k;
  const e = ENRICH[k] || {};
  const cs = coverSrc(e, "cover_big");

  const stage = document.createElement("div");
  stage.className = "attract-stage" + (revealAt ? " attract-pre" : "");
  stage._loop = null; stage._watch = null; stage._frame = null; stage._shotLoop = null;
  stage._dead = false; stage._videoLive = false; stage._detail = null; stage._k = k;
  stage._volRamp = null; stage._vol = 0; stage._pre = !!revealAt;

  const bg = document.createElement("div");
  bg.className = "attract-bg";
  const scrim = document.createElement("div");
  scrim.className = "attract-scrim";
  const info = document.createElement("div");
  info.className = "attract-info";

  const bits = [row.platform, row.releaseYear || row.releaseDate || row.release, row.genre]
    .filter((x) => x != null && x !== "")
    .map((x) => `<span>${escapeHtml(String(x))}</span>`).join("");
  info.innerHTML =
    (cs ? `<img class="attract-cover" src="${escapeHtml(cs)}" alt="">` : "") +
    `<div class="attract-txt">
       <h1>${escapeHtml(attractTitle(entry))}</h1>
       <div class="attract-meta">${bits}</div>
       <div class="attract-genres"></div>
       <p class="attract-summary"></p>
     </div>`;

  stage.appendChild(bg);
  stage.appendChild(scrim);
  stage.appendChild(info);
  stage._bg = bg; stage._scrim = scrim;

  // Only the box art and the title open the game's drawer. The rest of the stage is left
  // inert so a stray tap on the backdrop does nothing, and a horizontal drag is free to
  // swipe to the next game (attractWireSwipe). Stepping into the drawer pauses the run;
  // closeDrawer's attractResume hook picks it back up.
  const openThis = (ev) => { ev.stopPropagation(); attractPause(); openDrawer(row, sheetKey); };
  info.querySelectorAll(".attract-cover, .attract-txt h1").forEach((el) => {
    el.classList.add("attract-open");
    el.addEventListener("click", openThis);
  });

  // The BACKDROP is always the game's own imagery — the cover right away, upgraded to
  // a cross-fading screenshot slideshow once the detail lands. A trailer, when we have
  // one, is a separate layer that fades in OVER this only if it genuinely plays. So a
  // device that blocks YouTube (or a dead trailer) just shows the screenshots — no
  // stretched box art, no black rectangle.
  attractShowArt(bg, cs, true);
  if (k) attractFetchDetail(k).then((d) => {
    if (!d || stage._dead) return;
    stage._detail = d;
    attractFillDetail(stage, row, d);
    if (!stage._videoLive) attractShowBackdrop(stage, d, cs);
  });

  if (e.video && !YT_BLOCKED && WANTS_MOTION) attractPlayVideo(stage, e.video, cs, revealAt);

  return stage;
}

// A slow Ken-Burns pan+zoom, each image in a RANDOM direction so consecutive shots
// don't all drift the same way. The end point and duration ride on CSS vars.
function attractArtImg(src, motion) {
  const img = document.createElement("img");
  img.className = "attract-art" + (motion && WANTS_MOTION ? " kb" : "");
  // DS / 3DS dual-screen shots (and any portrait image) are TALLER than they are wide, so
  // cover-fit crops them to a horizontal band and the landscape zoom barely reveals them.
  // Tag them so the CSS pans VERTICALLY instead — sweeping the top screen down to the bottom.
  img.addEventListener("load", () => {
    if (img.naturalHeight > img.naturalWidth * 1.05) img.classList.add("tall");
  });
  img.src = src;
  if (motion && WANTS_MOTION) {
    // Desktop/landscape: zoom + drift toward a random point.
    img.style.setProperty("--kb-x", (Math.random() * 10 - 5).toFixed(1) + "%");
    img.style.setProperty("--kb-y", (Math.random() * 10 - 5).toFixed(1) + "%");
    img.style.setProperty("--kb-s", (1.16 + Math.random() * 0.12).toFixed(3));
    img.style.setProperty("--kb-dur", (16 + Math.random() * 8).toFixed(1) + "s");
    // Portrait (phones): a landscape screenshot overflows the sides under cover-fit,
    // so pan across it horizontally — a fixed random direction per screenshot (see CSS).
    const l2r = Math.random() < 0.5;
    img.style.setProperty("--pan-from", l2r ? "12%" : "88%");
    img.style.setProperty("--pan-to", l2r ? "88%" : "12%");
    img.style.setProperty("--pan-dur", (22 + Math.random() * 10).toFixed(1) + "s");
  }
  return img;
}

// A single blurred, dimmed backdrop image (optionally panning).
function attractShowArt(bg, src, motion) {
  if (!src) { bg.innerHTML = ""; bg.classList.add("attract-bg-empty"); return; }
  bg.classList.remove("attract-bg-empty");
  bg.innerHTML = "";
  bg.appendChild(attractArtImg(src, motion));
}

// how long each screenshot holds before the next fades in
// Cross-fade through several screenshots for the length of the game's turn. New layers
// fade in over the old (which is dropped after the fade), so at most two are ever live.
function attractRunShots(stage, bg, shots) {
  if (stage._shotLoop) { clearInterval(stage._shotLoop); stage._shotLoop = null; }
  bg.classList.remove("attract-bg-empty");
  bg.innerHTML = "";
  let i = 0, cur = null;
  const show = (idx) => {
    const img = attractArtImg(shots[idx], true);
    img.style.opacity = "0";
    bg.appendChild(img);
    void img.offsetWidth;                     // commit opacity:0 so the fade-in runs
    img.style.opacity = "";                   // → stylesheet's 1, transitions in
    const old = cur; cur = img;
    if (old) setTimeout(() => old.remove(), 950);
  };
  show(0);
  stage._shotLoop = setInterval(() => { i = (i + 1) % shots.length; show(i); }, ATTRACT_SHOT_MS);
}

// The trailer as a full-bleed layer OVER the screenshot backdrop. Same clean-embed
// trick as the hover preview (no start/loop params — seek + loop over the IFrame API,
// so YouTube draws no chrome). It stays invisible until it truly starts, so a blocked
// or dead trailer never shows — the screenshots behind it carry the screen. If it does
// start, it stops the slideshow (no point cross-fading behind an opaque video).
function attractPlayVideo(stage, vid, cs, revealAt) {
  const wrap = document.createElement("div");
  wrap.className = "attract-video";
  const frame = document.createElement("iframe");
  frame.className = "attract-frame";
  frame.src = ytSrc(vid, {
    autoplay: "1", mute: "1", controls: "0", disablekb: "1", iv_load_policy: "3", fs: "0",
  });
  frame.allow = "autoplay; encrypted-media";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  wrap.appendChild(frame);
  stage.insertBefore(wrap, stage._scrim);   // above the backdrop, below scrim + details
  stage._frame = frame;

  let duration = 0, clip = null;
  stage._watch = ytWatch(frame,
    () => { wrap.remove(); stage._frame = null; attractVideoFailed(stage, cs); },
    () => {
      stage._videoLive = true;
      if (stage._shotLoop) { clearInterval(stage._shotLoop); stage._shotLoop = null; }
      ytNoCaptions(frame);          // before the wrap fades in — nobody wants subtitles here
      wrap.classList.add("on");
      // Start silent, then ease the audio up (only audible once unmuted). The visual
      // itself already cross-fades via CSS; this gives the sound the same soft entrance.
      ytCmd(frame, "setVolume", [0]); stage._vol = 0;
      // A stage still in preroll stays silent whatever the mute setting says: it's playing
      // invisibly over the game you're watching, and the point is that you can't tell.
      // attractRevealPre brings it up when the stage actually takes the screen.
      if (attractMuted || stage._pre) ytCmd(frame, "mute");
      else attractRampVolume(stage, 100, ATTRACT_AUDIO_FADE);
    },
    (info) => {
      if (info.duration) duration = info.duration;
      if (!clip && duration) {
        clip = previewClip(vid, duration);
        // Straight to the clip normally. In preroll, start it EARLIER by exactly the lead,
        // so the playhead arrives AT clip.start just as the stage fades in: the reveal looks
        // identical either way, and nothing has to seek at swap time — a seek there would be
        // one more chance for the player to draw the bezel on a stage you can see.
        const lead = revealAt ? Math.max(0, revealAt - Date.now()) / 1000 : 0;
        ytCmd(frame, "seekTo", [Math.max(1, clip.start - lead), true]);
        stage._loop = setInterval(() => ytCmd(frame, "seekTo", [clip.start, true]), clip.len * 1000);
      }
    });
}

function attractFillDetail(stage, row, d) {
  const g = stage.querySelector(".attract-genres");
  if (g) {
    const curated = (typeof curatedGenres === "function") ? curatedGenres(row) : [];
    const genres = [...new Set([...curated, ...(d.genres || []).map((x) => String(canonGenre(x)))])].slice(0, 4);
    g.innerHTML = genres.map((x) => `<span class="attract-genre">${escapeHtml(x)}</span>`).join("");
  }
  const s = stage.querySelector(".attract-summary");
  if (s) s.textContent = d.summary || d.storyline || "";   // textContent → no escaping needed
  if (d.rating != null) {
    const meta = stage.querySelector(".attract-meta");
    if (meta && !meta.querySelector(".attract-rating")) {
      const b = document.createElement("span");
      b.className = "attract-rating " + ratingClass(d.rating);
      b.textContent = Math.round(d.rating * 100) + " / 100";
      meta.appendChild(b);
    }
  }
}

function attractApplyMuteBtn() {
  const b = $("#attractMute");
  if (!b) return;
  b.innerHTML = icon(attractMuted ? "i-muted" : "i-volume", 20);
  b.setAttribute("aria-label", attractMuted ? "Unmute" : "Mute");
}
