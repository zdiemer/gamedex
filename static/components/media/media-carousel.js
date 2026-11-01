"use strict";

// ---- media carousel + lightbox ------------------------------------------
// Slides are trailers and stills. A trailer autoplays (muted) as soon as it's
// the visible slide — it's the first thing you see when you open a game.
let media = [], shotIds = [], shotIdx = 0, lbIdx = 0;
/**
 * @component Wire a drawer carousel of trailers, screenshots and artwork.
 * @param {HTMLElement} el - Root containing .shots with .shot-view, .shot-count and .shot-cap; prev/next controls are optional.
 * @param {Array<Object>|null} items - Ordered entries: {kind:"video",id,name} or {kind:"image",id,art?}; videos autoplay muted.
 * @returns {undefined} Installs navigation/click handlers and displays the first item; no carousel or no items returns early.
 * @requires media/shotIds/shotIdx shared globals; YT_BLOCKED, ytSrc, ytWatch, ytFallback, IMG, escapeHtml, openShotSet; .shots styles.
 * @events Previous/next cycle slides. Image clicks open the still-only lightbox. This uses shared carousel state; it is intended for the single active drawer.
 * @cleanup Remove/replace the carousel subtree to stop embedded playback. No disposer is returned; callers should not mount concurrent independent carousels.
 * @escaping Caption text is escaped and image URLs use DOM properties. Items must contain validated media IDs understood by IMG/ytSrc.
 * @example
 * wireCarousel(drawer, [{ kind: "image", id: screenshotId }]);
 */
function wireCarousel(el, items) {
  const wrap = el.querySelector(".shots");
  media = items || [];
  // Lightbox = stills only. Entries are {igdb} image ids here; personal
  // screenshots hand in {url} entries via openShotSet — one lightbox for both.
  // The carousel keeps ITS OWN set and re-points the lightbox at it on every
  // click, so opening the personal gallery in between can't hijack these stills.
  const stills = media.filter((m) => m.kind === "image").map((m) => ({ igdb: m.id }));
  shotIds = stills;
  if (!wrap || !media.length) return;
  const view = wrap.querySelector(".shot-view");
  const count = wrap.querySelector(".shot-count");
  const cap = wrap.querySelector(".shot-cap");

  const show = (i) => {
    shotIdx = (i + media.length) % media.length;
    const m = media[shotIdx];
    view.innerHTML = "";
    if (m.kind === "video") {
      if (YT_BLOCKED) { view.appendChild(ytFallback(m)); }
      else {
        const frame = document.createElement("iframe");
        frame.className = "shot-video";
        // muted: a browser will refuse to autoplay with sound, and it would be
        // rude anyway. Controls are on, so it can be unmuted.
        frame.src = ytSrc(m.id, { autoplay: "1", mute: "1" });
        frame.allow = "accelerometer; autoplay; encrypted-media; picture-in-picture";
        frame.allowFullscreen = true;
        frame.title = m.name;
        view.appendChild(frame);
        // If it never plays (YouTube's bot wall, or embedding disabled), swap in
        // a thumbnail that opens the video on YouTube — where the user can
        // actually sign in, or just watch it.
        ytWatch(frame, () => {
          if (frame.isConnected) frame.replaceWith(ytFallback(m));
        });
      }
    } else {
      const img = document.createElement("img");
      img.className = "shot-img";
      img.loading = "lazy";
      img.alt = "";
      img.src = IMG(m.id, m.art ? "1080p" : "screenshot_med");
      img.onclick = () => openShotSet(stills, stills.findIndex((s) => s.igdb === m.id));
      view.appendChild(img);
    }
    count.textContent = `${shotIdx + 1} / ${media.length}`;
    // A video always carries a link out to YouTube — the embed can be walled by
    // YouTube's per-device bot check (not something we can talk our way past), and a
    // walled iframe with no way to click through is worse than no video.
    if (m.kind === "video")
      cap.innerHTML = `${escapeHtml(m.name)} · <a href="https://www.youtube.com/watch?v=${escapeHtml(m.id)}" target="_blank" rel="noopener">Watch on YouTube ↗</a>`;
    else cap.textContent = m.art ? "Artwork" : "";
  };

  const prev = wrap.querySelector(".prev"), next = wrap.querySelector(".next");
  if (prev) prev.onclick = (e) => { e.stopPropagation(); show(shotIdx - 1); };
  if (next) next.onclick = (e) => { e.stopPropagation(); show(shotIdx + 1); };
  show(0);
}
// A clickable poster that opens the trailer on YouTube in a new tab.
function ytFallback(m) {
  const a = document.createElement("a");
  a.className = "shot-fallback";
  a.href = `https://www.youtube.com/watch?v=${m.id}`;
  a.target = "_blank";
  a.rel = "noopener";
  a.innerHTML =
    `<img src="https://i.ytimg.com/vi/${escapeHtml(m.id)}/hqdefault.jpg" alt="">
     <span class="shot-fallback-play">▶</span>
     <span class="shot-fallback-note">YouTube won't play this here. Watch it on YouTube ↗</span>`;
  return a;
}

function lbShow(delta) {
  if (!shotIds.length) return;
  lbIdx = (lbIdx + delta + shotIds.length) % shotIds.length;
  const s = shotIds[lbIdx];
  $("#lbImg").src = s.url || IMG(s.igdb, "screenshot_huge");
  $("#lbCount").textContent = `${lbIdx + 1} / ${shotIds.length}`;
  const multi = shotIds.length > 1;
  $("#lbPrev").hidden = !multi;
  $("#lbNext").hidden = !multi;
}
function openLightbox(i) { lbIdx = i; $("#lightbox").hidden = false; lbShow(0); syncScrollLock(); }
// Point the lightbox at a caller-supplied set of stills ({url} or {igdb} each)
// — how mine.js opens personal screenshots without a second lightbox.
/**
 * @component Open the shared lightbox with caller-provided still images.
 * @param {Array<{url?:string,igdb?:string}>} entries - Nonempty still list; each entry supplies a validated URL or IGDB image ID.
 * @param {number} [i=0] - Nonnegative initial index; navigation wraps through the list.
 * @returns {undefined} Replaces the shared lightbox image set and opens it.
 * @requires openLightbox/lbShow, IMG, $, syncScrollLock; #lightbox, #lbImg, #lbCount, #lbPrev and #lbNext shell elements.
 * @events The app wires lightbox navigation and dismissal; this function only selects and opens the set.
 * @cleanup Call closeLightbox() to dismiss and release the scroll lock. Keep the shared shell mounted; concurrent sets replace one another.
 * @escaping Image URLs are assigned through img.src, not HTML; callers must still supply validated image URLs/IDs.
 * @example
 * openShotSet([{ url: screenshotUrl }], 0);
 */
function openShotSet(entries, i) { shotIds = entries || []; openLightbox(i || 0); }
/**
 * @component Dismiss the shared lightbox and synchronize page scroll locking.
 * @param None.
 * @returns {undefined} Hides #lightbox.
 * @requires $, syncScrollLock and the persistent #lightbox shell.
 * @events Called by app dismissal controls and keyboard handling.
 * @cleanup Safe to call when already hidden; the shared shell stays mounted.
 * @escaping No external text or markup is accepted.
 * @example
 * closeLightbox();
 */
function closeLightbox() { $("#lightbox").hidden = true; syncScrollLock(); }
const lightboxOpen = () => !$("#lightbox").hidden;
