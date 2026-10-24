"use strict";

// Thumby/Thumby Color: TinyCircuits' list is the only place these exist.
function thumbyHtml(key) {
  const t = THC[key];
  if (!t) return "";
  const art = [["Title", t.titleImage], ["Icon", t.icon]].filter(([, u]) => u)
    .map(([l, u]) => `<figure class="adb-art"><img class="pixel" loading="lazy" src="${escapeHtml(cImg(u))}" alt="${l}"><figcaption>${l}</figcaption></figure>`)
    .join("");
  // Tinymine and Thoom ship no still image at all — only an animated title
  // card. Show it, so they aren't blank.
  const vid = t.video
    ? `<video class="thumby-vid" src="${escapeHtml(t.video)}" autoplay muted loop playsinline></video>` : "";
  return sourcePanelHtml(`${icon("i-target", 15)} ${escapeHtml(t.platform || "Thumby")}`,
    (art ? `<div class="adb-arts">${art}</div>` : "") + vid +
    (t.description ? `<p class="thumby-desc">${escapeHtml(t.description)}</p>` : "") +
    (t.url ? `<a class="hltb-link" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">View on GitHub ↗</a>` : ""));
}
