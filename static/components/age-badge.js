"use strict";

/* The rating boards' badges — the real artwork, not a lookalike.

   IGDB hands back a string ("ESRB M", "PEGI 18", "CERO Z") which maps straight onto an SVG
   in static/ratings/. These are the official marks: the boards each have a specific, fussy
   geometry (ESRB's split box, PEGI's notched shield, CERO's rounded lozenge) and a redrawn
   approximation reads as slightly wrong in a way that's hard to place but easy to see.

   Vector, so they stay crisp at any size, and they carry their own colours — a PEGI 18 that
   went grey in dark mode would not be a PEGI 18. Boards we have no art for (USK, GRAC, ACB,
   CLASS_IND) fall back to a plain drawn chip rather than a wrong picture. */
const AGE_ART = {
  "ESRB RP": "rp", "ESRB EC": "ec", "ESRB E": "e", "ESRB E10+": "e10",
  "ESRB T": "t", "ESRB M": "m", "ESRB AO": "ao",
};
const ESRB_WORD = {
  RP: "Rating Pending", EC: "Early Childhood", E: "Everyone", "E10+": "Everyone 10+",
  T: "Teen", M: "Mature 17+", AO: "Adults Only",
};

function ageArtSrc(rating) {
  const [board, ...rest] = String(rating || "").trim().split(/\s+/);
  const val = rest.join(" ");
  if (!board || !val) return null;
  if (board === "ESRB") {
    const slug = AGE_ART[`ESRB ${val}`];
    return slug ? `ratings/esrb-${slug}.svg` : null;
  }
  if (board === "PEGI" && ["3", "7", "12", "16", "18"].includes(val)) return `ratings/pegi-${val}.svg`;
  if (board === "CERO" && ["A", "B", "C", "D", "Z"].includes(val)) return `ratings/cero-${val.toLowerCase()}.svg`;
  if (board === "USK" && ["0", "6", "12", "16", "18"].includes(val)) return `ratings/usk-${val}.svg`;
  return null;
}

function ageBadgeHtml(rating) {
  if (!rating) return "";
  const [board, ...rest] = String(rating).trim().split(/\s+/);
  const val = rest.join(" ");
  if (!val) return "";
  const src = ageArtSrc(rating);
  const alt = board === "ESRB" ? `ESRB ${ESRB_WORD[val] || val}` : `${board} ${val}`;
  if (src) {
    return `<img class="age-art ${escapeHtml(board.toLowerCase())}" src="${escapeHtml(src)}"
      alt="${escapeHtml(alt)}" title="${escapeHtml(alt)}" loading="lazy">`;
  }
  // A board we have no artwork for: an honest chip beats a wrong picture.
  return `<span class="age-b gen" title="${escapeHtml(alt)}"><b>${escapeHtml(val)}</b><em>${escapeHtml(board)}</em></span>`;
}
