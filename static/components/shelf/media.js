"use strict";

// UI components for media.js. Feature state and orchestration remain in that module.

function objHtml(m, src, kase) {
  const kind = m.kind === "umd" ? "umd" : m.kind === "disc" ? "disc" : "cart";
  const seat = mediaSizing(m, kase).seat;
  const cdepth = objDepth(m, seat);
  // One count for both places the object is drawn, taken from whichever is thicker there — the
  // panel keeps OBJ_DEPTH (it is tuned, and it is the view that looks right), the case gets the
  // real millimetres.
  const n = objSlices(Math.max(OBJ_DEPTH[kind], cdepth));
  const slices = Array.from({ length: n }, (_, i) =>
    `<i class="md-slice" style="--i:${i + 1}"></i>`).join("");
  // The scan is an <img>, not a background: it decides the object's size (object-fit: contain),
  // and the slices' masks are contain-fitted to the same box, so every layer lines up exactly.
  return `<div class="md-obj ${kind}" style="--scan:url('${escapeHtml(src)}');--depth:${OBJ_DEPTH[kind]}px;--cdepth:${cdepth.toFixed(2)}px;--n:${n};--base:${OBJ_BASE}px;--seat:${seat.toFixed(3)}">
    <i class="md-plate"></i>${slices}
    <img class="md-face" src="${escapeHtml(src)}" alt="" draggable="false">
  </div>`;
}

/* The fallback disc, for an optical game with no scan of its own: the cover masked into a ring,
   with a clear hub and a rainbow read side. Not a cheat — a printed disc largely IS the cover in
   a circle — but the panel says it's derived. */
function discHtml(m, art) {
  const face = art.disc || art.cover;
  const kind = m.kind === "umd" ? "md-umd" : "md-disc";
  return `<div class="${kind}${m.mini ? " mini" : ""}"
    style="--ms:${m.size}px;--tint:${m.tint}${face ? `;--face:url('${escapeHtml(face)}')` : ""}">
    ${m.kind === "umd"
      // The UMD is a flat card with nothing behind it, so its sheen can stay a blended child.
      // A DISC cannot afford one — it has a read side to show, and blending flattens the 3D it
      // needs to hide behind the label. Its rainbow lives in its own background (see .md-disc).
      ? `<span class="md-sheen"></span><span class="md-umd-shell"></span>`
      : `<span class="md-hub"></span><span class="md-under"></span>`}
  </div>`;
}

/* The model, whatever it turns out to be: the scan if we have one, else a fallback disc for an
   optical game, else nothing at all — because a cartridge we haven't scanned is a cartridge we
   would have to invent. */
function mediaModelHtml(g) {
  const m = mediaFor(g.p);
  if (!m) return "";
  const art = mediaArt(g);
  // The box's fitted width when it has one — see shFitCase; the table's, until then.
  if (art.scan) return objHtml(m, art.scan, { w: g.fitW ?? g.case?.w, h: g.case?.h });
  return (m.kind === "disc" || m.kind === "umd") ? discHtml(m, art) : "";
}

/* The panel that appears when you open a box. */
function mediaPanelHtml(g) {
  const m = mediaFor(g.p);
  const art = mediaArt(g);
  if (!m && !art.manual && !art.manualPdf) return "";

  const model = mediaModelHtml(g);

  // Say where the object came from. A derived disc is a guess and shouldn't pretend otherwise.
  const provenance = !m ? ""
    : art.scan ? `<span class="md-src real">Real ${mediaWord(m)} scan · ScreenScraper</span>`
    : art.disc ? `<span class="md-src real">Real disc scan · GameTDB</span>`
    : model ? `<span class="md-src derived">Disc face from the box art</span>`
    : `<span class="md-src none">No scan of the ${mediaWord(m)} yet</span>`;

  // No stage at all for a platform with no physical medium (a PC game with a manual): an empty
  // case is only worth drawing where there is something that should have been in it.
  return `<div class="md-panel" id="mdPanel">
    ${!m ? "" : `<div class="md-stage${model ? "" : " empty"}">${model || `<span class="md-nothing">Empty case</span>`}</div>`}
    <div class="md-side">
      ${m ? `<div class="md-what">${escapeHtml(mediaName(m, g.p))}</div>${provenance}` : ""}
      ${art.manual || art.manualPdf
        ? `<button class="sh-btn primary" id="mdManual">${icon("i-review", 14)} Read the manual</button>
           <span class="md-src">Internet Archive${art.manualPages ? ` · ${art.manualPages} pages` : ""}</span>`
        : `<span class="md-src none">No manual found</span>`}
    </div>
  </div>`;
}

/* The manual itself. The Internet Archive's BookReader pages, zooms and searches a scan already —
   building a PDF viewer to re-render something they already render would be daft. */
function openManual(g) {
  const art = mediaArt(g);
  if (!art.manual && !art.manualPdf) return;
  // Prefer our PVC-cached PDF in the browser's own viewer: a booklet opened before
  // comes off local disk in a blink. Only when the Archive item has no PDF do we
  // fall back to their BookReader embed (which boots over the network every time).
  const pdf = art.manualPdf ? cManual(art.manualPdf) : "";
  const src = pdf ? `${pdf}#view=FitH` : art.manual;
  const say = pdf ? "Loading the booklet…" : "Fetching the booklet from the Internet Archive…";
  const host = document.createElement("div");
  host.className = "md-scrim";
  host.innerHTML = `
    <div class="md-book" role="dialog" aria-label="Manual for ${escapeHtml(g.t)}">
      <div class="md-book-bar">
        <b>${escapeHtml(g.t)}</b>
        <span class="muted">Instruction booklet · Internet Archive</span>
        <a class="sh-btn" href="${escapeHtml(art.manualUrl)}" target="_blank" rel="noopener">Open at the Archive ↗</a>
        <button class="sh-btn" id="mdClose">Close</button>
      </div>
      <div class="md-book-body">
        <div class="md-skel" aria-hidden="true">
          <div class="md-skel-page"><i></i><i></i><i></i><i></i><i></i></div>
          <div class="md-skel-page"><i></i><i></i><i></i><i></i><i></i></div>
          <span class="md-skel-say">${say}</span>
        </div>
        <iframe src="${escapeHtml(src)}" allowfullscreen frameborder="0"></iframe>
      </div>
    </div>`;
  document.body.appendChild(host);
  /* The Archive's BookReader takes a few seconds to boot, and until it does the iframe is a blank
     white rectangle that reads as broken. Hold a pair of skeleton pages over it until it loads —
     and drop them on `load` whether or not it succeeded, so a failure shows the reader's own error
     rather than a shimmer that never ends. */
  const frame = host.querySelector("iframe");
  const skel = host.querySelector(".md-skel");
  frame.addEventListener("load", () => skel.classList.add("gone"), { once: true });
  setTimeout(() => skel.classList.add("gone"), 12000);      // never shimmer forever
  syncScrollLock?.();
  const close = () => { host.remove(); syncScrollLock?.(); };
  host.querySelector("#mdClose").onclick = close;
  host.addEventListener("click", (e) => { if (e.target === host) close(); });
}
