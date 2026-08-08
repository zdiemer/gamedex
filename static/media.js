"use strict";

/* What was actually IN the box.

   The shelf has always shown you the outside of a game. This opens it: the case swings, and the
   thing you'd actually hold comes out — a cartridge with its label, or a disc with its printed
   face — with the instruction booklet behind it.

   THE OBJECT IS A REAL SCAN NOW. ScreenScraper's `support` media is a render of the actual
   medium — the whole cartridge, the whole game card, the whole printed disc — cut out on a
   transparent background. We serve it from /api/shelf/media (see shelf.py media()) and stand it
   up: the scan is the front, a stack of masked silhouettes behind it is the thickness, and a
   plate at the back is the side you'd see if you turned it over. A few millimetres of depth is
   all it takes; the object is a card or a cartridge, not a brick.

   THIS REPLACED THE MODELLED SHELLS. Before the dev key landed, each machine's cartridge was
   MODELLED — six CSS faces per platform, then 24 pre-rendered frames per shell from
   tools/render_carts.py, with a crop of the box art warped into the label well by a homography.
   It was a good likeness and it was still a likeness: a generic SNES cart wearing a piece of the
   Yoshi's Island box, where the real cart has its own label, its own printing, its own "SNS-YI-USA"
   under the Nintendo seal. A photograph of the actual thing beats it outright, so the shells,
   their sprites and their renderer are gone (gamedex 1.58.115).

   What remains synthetic is the DISC, and only when we have no scan: a disc is a generic object —
   a silver circle with the cover masked into it reads as a disc, because that is largely what a
   printed disc is. A cartridge is not generic, so a game with no cartridge scan simply has an
   empty case, and the panel says so.

   Loaded after shelf.js; shares its globals. */

// ---- which object a platform actually is -----------------------------------
/* `kind` decides how the box opens (a bare cartridge slid out of a sleeve; cards and discs were
   in hinged cases), what the object is called, and — for optical only — what the fallback disc
   looks like when no scan exists. The shells' geometry used to live here; it doesn't need to,
   because the scan carries its own shape.

   `mm` is the one measurement that does NOT come out of the scan: the medium's LONG EDGE in
   millimetres. The scan is a picture of an object with no ruler in it, so without this every
   medium is drawn to whatever size its container gives it — and a 35mm DS card comes out nearly
   as wide as the 122mm box it lives in, which is what "the games are too big for their boxes"
   is. Set against the case's own millimetres (shelf.js PX_MM), a Game Boy cartridge fills most
   of its little square box, a Switch card is a stamp in the corner of its case, and a disc is a
   disc. Approximate to a millimetre or two; the point is the RATIO to the box. */
const MEDIA = {
  "NES":                 { kind: "cart", mm: 133 },
  "Nintendo Entertainment System": { kind: "cart", mm: 133 },
  "SNES":                { kind: "cart", mm: 137 },
  "Super Nintendo":      { kind: "cart", mm: 137 },
  "Nintendo 64":         { kind: "cart", mm: 118 },
  "Game Boy":            { kind: "cart", mm: 65 },
  "Game Boy Color":      { kind: "cart", mm: 65 },
  "Game Boy Advance":    { kind: "cart", mm: 57 },
  "Nintendo DS":         { kind: "card", mm: 35 },
  "Nintendo 3DS":        { kind: "card", mm: 35 },
  "New Nintendo 3DS":    { kind: "card", mm: 35 },
  "Nintendo Switch":     { kind: "card", mm: 31 },
  "Nintendo Switch 2":   { kind: "card", mm: 31 },
  "Sega Genesis":        { kind: "cart", mm: 105 },
  "Sega Master System":  { kind: "card", mm: 100 },
  "Game Gear":           { kind: "cart", mm: 70 },
  "Virtual Boy":         { kind: "cart", mm: 100 },
  "Nintendo Virtual Boy":{ kind: "cart", mm: 100 },
  "Atari 2600":          { kind: "cart", mm: 100 },
  "Neo-Geo":             { kind: "cart", mm: 145 },
  "TurboGrafx-16":       { kind: "card", mm: 78 },
  "WonderSwan":          { kind: "cart", mm: 45 },

  // Optical. A CD is 120mm and everyone knows what one looks like, which is what makes the
  // GameCube's 80mm mini-disc worth getting right. `size` and `tint` are the fallback disc's
  // own drawing, used only when there is no scan.
  "PlayStation":         { kind: "disc", mm: 120, size: 150, tint: "#8c8f96" },
  "PlayStation 2":       { kind: "disc", mm: 120, size: 150, tint: "#2b3a6b" },
  "PlayStation 3":       { kind: "disc", mm: 120, size: 150, tint: "#7f8286" },
  "PlayStation 4":       { kind: "disc", mm: 120, size: 150, tint: "#2f6fb5" },
  "PlayStation 5":       { kind: "disc", mm: 120, size: 150, tint: "#2f6fb5" },
  "PlayStation Portable":{ kind: "umd",  mm: 65,  size: 108, tint: "#3a3d45" },
  "PlayStation Vita":    { kind: "card", mm: 28 },
  "Nintendo GameCube":   { kind: "disc", mm: 80,  size: 112, tint: "#6f42a0", mini: true },
  "Nintendo Wii":        { kind: "disc", mm: 120, size: 150, tint: "#dfe3e8" },
  "Nintendo Wii U":      { kind: "disc", mm: 120, size: 150, tint: "#4a86c8" },
  "Xbox":                { kind: "disc", mm: 120, size: 150, tint: "#2e7d32" },
  "Xbox 360":            { kind: "disc", mm: 120, size: 150, tint: "#5aa02c" },
  "Xbox One":            { kind: "disc", mm: 120, size: 150, tint: "#2f6fb5" },
  "Xbox Series X|S":     { kind: "disc", mm: 120, size: 150, tint: "#2f6fb5" },
  "Sega Dreamcast":      { kind: "disc", mm: 120, size: 150, tint: "#d94f2b" },
  "Sega Saturn":         { kind: "disc", mm: 120, size: 150, tint: "#6f8296" },
  "Sega CD":             { kind: "disc", mm: 120, size: 150, tint: "#6f8296" },
  "3DO":                 { kind: "disc", mm: 120, size: 150, tint: "#6f8296" },
  "PC":                  { kind: "disc", mm: 120, size: 150, tint: "#8c8f96" },
};

const mediaFor = (platform) => MEDIA[(platform || "").trim()] || null;

// The scan of the medium itself, keyed by BOX (per region, like the faces) — a Japanese copy's
// cartridge is not the US one's. 404s until the warm crawl reaches that game; every use of it
// below is written so that a missing image costs nothing but itself.
const mediaUrl = (k) => `/api/shelf/media?key=${encodeURIComponent(k)}`;

/* Is there anything actually IN the box?

   Only real things count. A generated disc is a stand-in, not contents — offering "open the box"
   to show one promises something we haven't got. So the button appears for a scan of the medium
   (ScreenScraper), a real printed disc (GameTDB), or the actual manual; and once you're in for
   one of those, the fallback disc may still stand in for the object, with the provenance line
   saying plainly which it is. */
function hasBoxContents(g) {
  const e = (typeof ENRICH !== "undefined" && ENRICH[g.mk]) || {};
  return !!(g.media || e.discArt || e.manualEmbed || e.manualPdf);
}

// The art for the medium, best first.
function mediaArt(g) {
  const e = (typeof ENRICH !== "undefined" && ENRICH[g.mk]) || {};
  return {
    // The medium itself, scanned: cartridge, card or disc, cut out on transparency.
    scan: g.media ? mediaUrl(g.k) : null,
    // A real scan of the printed disc face — GameTDB. Flat art, no shell around it, so it goes
    // onto the fallback disc rather than standing up as an object of its own.
    disc: cImg(e.discArt) || null,
    // And the box art, which is all the fallback disc has when neither of those exists.
    cover: coverSrc(e, "cover_big") || null,
    manual: e.manualEmbed || null,
    manualUrl: e.manualUrl || null,
    // The PDF itself, cached on the PVC — when the Archive item has one we page
    // through our own copy (instant on a repeat open, works offline) instead of
    // booting their BookReader over the network. Falls back to the embed below.
    manualPdf: e.manualPdf || null,
    // How thick the booklet is — a 4-page leaflet and a 64-page JRPG tome are different
    // propositions, and you want to know which before you open it.
    manualPages: e.manualPages || null,
  };
}

/* ---- the object ------------------------------------------------------------

   A scan is flat and the thing it shows is not, so it gets extruded. `--depth` millimetres of
   thickness are built out of SLICES: copies of the object's silhouette, each pushed a little
   further back in Z, each painted a flat plastic colour. They are silhouettes rather than copies
   of the picture because the side of a cartridge is grey plastic, not a smeared repeat of its
   label — and the silhouette comes free from the scan's own alpha, via a mask.

   Depth is deliberately small. These are 2-3mm cards and 15mm cartridges seen from slightly off
   axis; a slab reads as a brick, and the point is only that the object stops being a sticker. */
const OBJ_SLICES = 8;
const OBJ_DEPTH = { cart: 13, card: 7, disc: 4, umd: 9 };   // px at the panel's scale
const OBJ_BASE = 260;                // the element's own size inside a case; see objHtml

/* The two sizes a medium takes INSIDE a case, as scale factors of OBJ_BASE.

   Drawn at a fixed element size and scaled DOWN to its real millimetres, never sized down and
   scaled back up: a 31mm Switch card sized to 40px and then magnified to fill your screen is
   40px of picture stretched, and it looked it.

     seat  the medium's long edge at the shelf's own millimetre scale, which is what makes a Game
           Boy cartridge fill its little box and a Switch card a stamp in its case. Capped at the
           case's shorter side, because whatever it is, it FITTED IN THE BOX — a cap that only
           ever bites on a box we have the wrong height for (the Super Famicom Chrono Trigger
           case is a tall narrow one, the shelf builds it at the SNES height it knows, and a
           137mm cartridge then hangs out of both sides of it).
     out   how big it stands when it comes out: about two-thirds the height of the case, so a
           game card is something you can actually look at — but never smaller than life, and a
           SNES cartridge is already most of its box, so it just slides up. */
function mediaSizing(m, kase) {
  const caseW = (kase && kase.w) || 0, caseH = (kase && kase.h) || 0;
  const fits = caseW && caseH ? Math.min(caseW, caseH) * 0.95 : Infinity;
  const px = Math.min(m.mm || 100, fits) * PX_MM;
  return { seat: px / OBJ_BASE, out: Math.max(px, caseH * PX_MM * 0.68) / OBJ_BASE };
}

/* Re-seat a medium already in a case, after the box has been re-cut to its art (shFitCase). The
   box changes shape when its front lands, and a cartridge sized against the shape it USED to have
   is the wrong size for the one it is now in. */
function mediaResize(root, platform, kase) {
  const m = mediaFor(platform), obj = root && root.querySelector(".md-obj");
  if (!m || !obj) return;
  const s = mediaSizing(m, kase);
  obj.style.setProperty("--seat", s.seat.toFixed(3));
  obj.style.setProperty("--out", s.out.toFixed(3));
}

function objHtml(m, src, kase) {
  const kind = m.kind === "umd" ? "umd" : m.kind === "disc" ? "disc" : "cart";
  const slices = Array.from({ length: OBJ_SLICES }, (_, i) =>
    `<i class="md-slice" style="--i:${i + 1}"></i>`).join("");
  const s = mediaSizing(m, kase);
  // The scan is an <img>, not a background: it decides the object's size (object-fit: contain),
  // and the slices' masks are contain-fitted to the same box, so every layer lines up exactly.
  return `<div class="md-obj ${kind}" style="--scan:url('${escapeHtml(src)}');--depth:${OBJ_DEPTH[kind]}px;--n:${OBJ_SLICES};--base:${OBJ_BASE}px;--seat:${s.seat.toFixed(3)};--out:${s.out.toFixed(3)}">
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

const mediaName = (m, platform) =>
  m.kind === "disc" ? (m.mini ? "GameCube mini-disc" : "Disc")
  : m.kind === "umd" ? "UMD"
  : m.kind === "card" ? "Game card"
  : `${platform} cartridge`;

// The same thing in one lowercase word, for a sentence.
const mediaWord = (m) =>
  m.kind === "disc" ? "disc" : m.kind === "umd" ? "UMD" : m.kind === "card" ? "card" : "cartridge";

/* Which way the box opens is decided by what's in it: a bare cart never lived in a hinged case,
   so retro carts SLIDE OUT of the sleeve; cards (DS, 3DS, Switch) and discs are in hinged cases. */
const opensBy = (platform) => (mediaFor(platform)?.kind === "cart" ? "slide" : "hinge");

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
