"use strict";

/* Your reviews — a Stats section that reads your own writing back to you.

   745 of the completed rows carry a long-form write-up in `notes`; nothing else in the
   app looks at them in aggregate. This turns that ~85k words into four panels: how much
   you've written, the words that ride along with your best and worst scores, the fact
   that you write more about games you love, and the reviews whose PROSE doesn't match the
   NUMBER you gave — a glowing paragraph on a 5/10, or a gripe-fest on a game you scored 100.

   Self-contained: no server, no bundled lexicon. "Sentiment" is learned from your own
   ratings (the words you reach for when you rate high vs low), which is why the mismatch
   pass uses LEAVE-ONE-OUT — a review's own rating must not colour the words it's judged by,
   or every review would look like it agrees with itself. Loaded after app.js + charts.js,
   so statPanel/statCard/barsH/barsV/gameLink/foldText/escapeHtml are all in scope. */

const RV_MIN_REVIEWS = 40;   // below this it's a novelty, not a dataset
const RV_WORD_MIN = 8;       // a word needs this many reviews behind it to earn a polarity
const RV_LIFT_MIN = 12;      // and this many for the descriptive high/low-score lists

// A plain stopword list — function words plus the vocabulary EVERY game review uses
// ("game", "play"), which would otherwise dominate every panel while saying nothing.
const RV_STOP = new Set((
  "the a an and or but of to in on at for with is was are be been being it its this that " +
  "these those i you he she they we me my your our their his her them there here as so if " +
  "then than too very just about into over out up down not no nor only own same s t can " +
  "will would could should did does do done have has had having what which who whom whose " +
  "when where why how all any both each few more most other some such off again further " +
  "once because while during before after above below between through against " +
  "game games play played playing plays player gameplay title game's im ive dont didnt cant " +
  "one two get got go going get gets im really lot pretty thing things able bit way well good " +
  "much many also still even though although get like feel felt makes make made time"
).split(/\s+/));

const rvTokens = (s) =>
  foldText(s).replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !RV_STOP.has(w));
