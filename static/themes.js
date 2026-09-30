"use strict";

/* Themes — the evergreen half of the board.

   The eleven seasonal events all answer the same question: what should I play IN OCTOBER.
   That is the whole point of a window, and it is also the whole limitation — nine months of
   the year the collection has nothing to say about the thing I actually want, which is "give
   me five cyberpunk games and get out of the way".

   So a theme is a seasonal event with the date taken out. Same four pieces, minus the one:

     a POOL     a predicate over the collection, built to the Spooktober rule — match on
                what a game IS (a keyword, a perspective, a theme, a year), never on a noun
                that appears in it.
     a SLATE    N games rolled out of that pool. Pin the ones you mean to keep, roll again,
                and the pinned ones stay put while the rest turn over.
     a RUN      the slate plus its history: when you started, how many times you rolled,
                what got finished. Finish the run and it goes to the record; the next one
                starts empty.
     a BANNER   Home, priority 35 — under every seasonal event and under Endangered, because
                a theme has all year and October does not. It only appears while a run is
                actually open.

   Completion is NOT a checkbox, and there is no tick button on this page at all. A slate
   game is done when the SHEET says it is done, the same way challenges.js derives everything
   from the Completed columns. Anything else is a second place to record the same fact and so
   a second place to be wrong: finish a game on the couch, mark it on the sheet like always,
   and two screens now disagree until you remember to come back here. So a run fills itself
   in as you play, and nothing is ever marked twice.

   ONE registry entry, not eight. Eight entries would be eight tabs, eight banner
   contenders and eight rows on the preview board, to express what is really one page with
   a dial on it — the Class of 'XX argument, at n=8. The entry WEARS the active theme: its
   skin, deco, title and pitch are all read at render time, and themesRender swaps them
   before it paints. That is the one liberty this file takes with the framework, and it is
   the reason a theme can have its own poster without its own tab.

   Naming, because it will come up: "theme" is already two things in this app — IGDB's theme
   facet (__igdb_theme, Science fiction / Horror / Open world) and the light/dark setting.
   This is neither, and one of the eight is literally built out of the first one. */

/* ---- the themes ------------------------------------------------------------
   Adding one is adding an object. That is the entire extension mechanism, and it is why
   `match` gets to be a plain function rather than a row in a schema.

   Every `note` is the honest version of its own predicate. A pool you cannot see the shape
   of is a pool you cannot trust, and "obscure" in particular is a claim about missing data
   rather than about games, so it says so. */

const thmEn = (r) => evEnrich(r) || {};
// All four of these are only trustworthy behind an igdbId: a fallback match (IGN, GameSpot,
// Steam) fills the same arrays with free text, which is why unifiedGenreVals ignores it too.
const thmIgdb = (r, field) => {
  const e = thmEn(r);
  return e.igdbId ? (e[field] || []).map((v) => String(v).toLowerCase()) : [];
};
// Only the two vocabularies a theme here actually reads. The other three IGDB arrays
// (themes, genres, gameModes) are one thmIgdb call away when a theme wants them — and
// evHasMode already exists for the last of those.
const thmKw = (r) => thmIgdb(r, "keywords");
const thmPersp = (r) => thmIgdb(r, "perspectives");
const thmAny = (list, ...want) => want.some((w) => list.includes(w));

/* The year the GAME came out, not the year the copy on the shelf did. The sheet's
   releaseYear dates the edition you own — The Mysterious Murasame Castle is 2014 on it,
   because that is when the 3DS Virtual Console sold it to you — and IGDB's `year` is
   first_release_date, which is 1986. A retro theme that used the sheet's column would put
   every Virtual Console purchase in the modern era and lose the actual 1986 games. Parsed
   out of a string because releaseYear also holds "Early Access". */
function thmYear(r) {
  const y = thmEn(r).year;
  if (y) return +y;
  const m = /^\s*(\d{4})/.exec(String(r.releaseYear || r.releaseDate || ""));
  return m ? +m[1] : null;
}

const THEMES = [
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    blurb: "neon, chrome and a bad future",
    icon: "i-bolt",
    n: 5,
    /* One keyword, which is not where this started. Three wider rungs were written, run
       against the shelf, and thrown away for saying things that are not true:
         dystopian AND science fiction  +42, and they were Fallout, Half-Life 2, Metro, four
                                        Command & Conquers and three Dawn of Wars. Dystopian
                                        is a mood sci-fi wears; it is its own theme below,
                                        where those games are exactly right.
         cybernetics                    +10, half of them The Binding of Isaac, Xenonauts,
                                        X-COM: Terror from the Deep and Bulletstorm. It tags
                                        anything containing a cyborg.
         cyberspace / transhumanism     +0 and +2, and the two were a comedy platformer.
       So the honest pool is the games IGDB itself calls cyberpunk, and it is 137 deep. */
    note: "IGDB's cyberpunk keyword, on its own. Three wider rungs were tried and removed — " +
          "each of them let in games that merely contain a cyborg or a bad government.",
    match: (r) => thmKw(r).includes("cyberpunk"),
    skin: "--ev-disp:'Orbitron',var(--display);--ev-size:40px;--ev-dw:900;--ev-ls:.06em;" +
          "--ev-deco:#f472b6;--ev-fg:#fde7f6;--ev-fg-2:#c9a8c6;--ev-edge:rgba(244,114,182,.34);" +
          "--ev-edge-hi:rgba(244,114,182,.8);--ev-glow:rgba(244,114,182,.4);--ev-t1:#fff0fa;" +
          "--ev-t2:#22d3ee;--ev-t3:#f472b6;--ev-on-cta:#21041a;--ev-k:#22d3ee;" +
          "--ev-art:radial-gradient(110% 150% at 84% 118%,rgba(244,114,182,.3),transparent 56%)," +
          "radial-gradient(90% 130% at 4% -18%,rgba(34,211,238,.24),transparent 58%)," +
          "linear-gradient(145deg,#07040d,#120821 68%,#05121c)",
    deco: [
      { i: "i-bolt", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-server", x: 70, y: 22, s: 26, r: 6, lift: 11, d: 80 },
      { i: "i-plug", x: 24, y: 20, s: 24, r: -12, lift: 13, d: 40 },
      { i: "i-nosignal", x: 47, y: 84, s: 20, r: 8, lift: 8, d: 200, o: .55 },
      { i: "i-bolt", x: 60, y: 12, s: 16, r: -8, lift: 15, d: 240, o: .5 },
    ],
  },
  {
    id: "vr",
    name: "Virtual Reality",
    blurb: "the headset games, which the shelf hides",
    icon: "i-vr",
    n: 4,
    note: "IGDB's Virtual Reality perspective — a real field it has always had — plus any " +
          "row whose platform names a headset. Four rather than five: VR is an evening's " +
          "commitment even when the game is short.",
    match: (r) => thmPersp(r).includes("virtual reality")
      || /oculus|meta quest|\bquest\b|vive|valve index|psvr|playstation vr|\bvr\b/i.test(String(r.platform || "")),
    skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:52px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#818cf8;--ev-fg:#eef0ff;--ev-fg-2:#a9b0d8;--ev-edge:rgba(129,140,248,.34);" +
          "--ev-edge-hi:rgba(129,140,248,.78);--ev-glow:rgba(129,140,248,.36);--ev-t1:#f4f5ff;" +
          "--ev-t2:#a5b4fc;--ev-t3:#818cf8;--ev-on-cta:#0d0f2b;--ev-k:#a5b4fc;" +
          "--ev-art:radial-gradient(120% 150% at 82% 120%,rgba(129,140,248,.3),transparent 56%)," +
          "radial-gradient(80% 120% at 8% -16%,rgba(56,189,248,.2),transparent 60%)," +
          "linear-gradient(150deg,#06060f,#0d0e22 70%,#0a1220)",
    deco: [
      { i: "i-vr", x: 85, y: 66, s: 48, lift: 12 },
      { i: "i-globe", x: 70, y: 22, s: 26, r: 0, lift: 11, d: 90 },
      { i: "i-pad", x: 24, y: 20, s: 24, r: -10, lift: 13, d: 40 },
      { i: "i-vr", x: 48, y: 84, s: 18, r: 7, lift: 8, d: 210, o: .5 },
    ],
  },
  {
    id: "obscure",
    name: "Obscure",
    blurb: "games nobody wrote about",
    icon: "i-nosignal",
    n: 5,
    note: "Two or fewer IGDB user ratings AND two or fewer critic scores. This is a claim " +
          "about the ABSENCE of data, so it only counts games IGDB actually matched — " +
          "otherwise every row the enricher failed on would look like a lost classic.",
    match: (r) => {
      const e = thmEn(r);
      if (!e.igdbId) return false;
      return (e.userRatingCount || 0) <= 2 && (e.criticCount || 0) <= 2;
    },
    skin: "--ev-disp:'Special Elite',var(--display);--ev-size:42px;--ev-dw:400;--ev-ls:.01em;" +
          "--ev-deco:#a8a29e;--ev-fg:#f2efe9;--ev-fg-2:#b8b2a8;--ev-edge:rgba(168,162,158,.3);" +
          "--ev-edge-hi:rgba(214,211,209,.6);--ev-glow:rgba(168,162,158,.22);--ev-t1:#faf8f4;" +
          "--ev-t2:#d6d3d1;--ev-t3:#a8a29e;--ev-on-cta:#1c1a17;--ev-k:#d6d3d1;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(168,162,158,.2),transparent 58%)," +
          "radial-gradient(80% 120% at 6% -14%,rgba(120,113,108,.24),transparent 60%)," +
          "linear-gradient(150deg,#0d0c0b,#171512 72%,#121110)",
    deco: [
      { i: "i-nosignal", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-box", x: 70, y: 24, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-search", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-box", x: 47, y: 84, s: 18, r: 12, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "retro",
    name: "Before 2006",
    blurb: "the era that ended when the Wii arrived",
    icon: "i-crt",
    n: 5,
    note: "IGDB's first release date, not the sheet's — so a Virtual Console or Mini " +
          "purchase is dated by the game (1986) rather than by the copy you own (2014). " +
          "2006 because that is where your shelf's generation line actually falls.",
    match: (r) => { const y = thmYear(r); return y != null && y < 2006; },
    skin: "--ev-disp:'Press Start 2P',var(--display);--ev-size:24px;--ev-dw:400;--ev-ls:0;" +
          "--ev-deco:#4ade80;--ev-fg:#e8ffe9;--ev-fg-2:#9fc7a6;--ev-edge:rgba(74,222,128,.32);" +
          "--ev-edge-hi:rgba(74,222,128,.72);--ev-glow:rgba(74,222,128,.3);--ev-t1:#f2fff3;" +
          "--ev-t2:#86efac;--ev-t3:#4ade80;--ev-on-cta:#052113;--ev-k:#86efac;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(74,222,128,.22),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(250,204,21,.16),transparent 60%)," +
          "linear-gradient(150deg,#060a07,#0b1410 70%,#08110c)",
    deco: [
      { i: "i-crt", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-cartridge", x: 70, y: 22, s: 26, r: 8, lift: 11, d: 80 },
      { i: "i-stick", x: 24, y: 20, s: 24, r: -12, lift: 13, d: 40 },
      { i: "i-disc", x: 47, y: 84, s: 20, r: 0, lift: 8, d: 200, o: .55 },
      { i: "i-cartridge", x: 60, y: 12, s: 16, r: -6, lift: 15, d: 240, o: .5 },
    ],
  },
  {
    id: "metroidvania",
    name: "Metroidvania",
    blurb: "one map, opened a door at a time",
    icon: "i-door",
    n: 5,
    note: "IGDB's metroidvania keyword, which is the rare case where the finest vocabulary " +
          "is also the right one: the form has a name and the people tagging games use it.",
    match: (r) => thmAny(thmKw(r), "metroidvania", "metroid-vania"),
    skin: "--ev-disp:'Anton',var(--display);--ev-size:48px;--ev-dw:400;--ev-ls:.01em;" +
          "--ev-deco:#38bdf8;--ev-fg:#e8f7ff;--ev-fg-2:#9db9cc;--ev-edge:rgba(56,189,248,.32);" +
          "--ev-edge-hi:rgba(56,189,248,.74);--ev-glow:rgba(56,189,248,.32);--ev-t1:#f0fbff;" +
          "--ev-t2:#7dd3fc;--ev-t3:#38bdf8;--ev-on-cta:#04202b;--ev-k:#7dd3fc;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(56,189,248,.26),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(167,139,250,.2),transparent 60%)," +
          "linear-gradient(150deg,#05080d,#0a1119 70%,#0b1020)",
    deco: [
      { i: "i-door", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-layers", x: 70, y: 22, s: 26, r: -6, lift: 11, d: 90 },
      { i: "i-target", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-door", x: 47, y: 84, s: 18, r: 6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "afterend",
    name: "After the End",
    blurb: "the world already fell over",
    icon: "i-alert",
    n: 5,
    note: "IGDB's post-apocalyptic keyword. Deliberately not the Survival theme, which is " +
          "twice the size and mostly crafting games with a hunger bar.",
    match: (r) => thmAny(thmKw(r), "post-apocalyptic", "post-apocalypse", "apocalyptic"),
    skin: "--ev-disp:'Graduate',var(--display);--ev-size:40px;--ev-dw:400;--ev-ls:.04em;" +
          "--ev-deco:#fb923c;--ev-fg:#fff1e3;--ev-fg-2:#c8ab92;--ev-edge:rgba(251,146,60,.3);" +
          "--ev-edge-hi:rgba(251,146,60,.72);--ev-glow:rgba(251,146,60,.3);--ev-t1:#fff6ec;" +
          "--ev-t2:#fdba74;--ev-t3:#fb923c;--ev-on-cta:#231003;--ev-k:#fdba74;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,146,60,.24),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(120,113,108,.26),transparent 60%)," +
          "linear-gradient(150deg,#0c0806,#171009 70%,#120d0a)",
    deco: [
      { i: "i-alert", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-ban", x: 70, y: 24, s: 24, r: -8, lift: 10, d: 90 },
      { i: "i-leaf", x: 24, y: 20, s: 24, r: 18, lift: 13, d: 40 },
      { i: "i-nosignal", x: 47, y: 84, s: 18, r: 8, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "roguelike",
    name: "Roguelike",
    blurb: "a run, then another run",
    icon: "i-dice",
    n: 4,
    note: "IGDB's roguelike / roguelite keywords. Four, not five: these are the games you " +
          "keep rather than the games you finish, and a slate of five never closes.",
    match: (r) => thmAny(thmKw(r), "roguelike", "roguelite", "rogue-like", "rogue-lite"),
    skin: "--ev-disp:'Caveat',var(--display);--ev-size:62px;--ev-dw:700;--ev-ls:0;" +
          "--ev-deco:#facc15;--ev-fg:#fffbe8;--ev-fg-2:#c9bd8e;--ev-edge:rgba(250,204,21,.3);" +
          "--ev-edge-hi:rgba(250,204,21,.7);--ev-glow:rgba(250,204,21,.3);--ev-t1:#fffdf0;" +
          "--ev-t2:#fde047;--ev-t3:#facc15;--ev-on-cta:#231d02;--ev-k:#fde047;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(250,204,21,.22),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(239,68,68,.18),transparent 60%)," +
          "linear-gradient(150deg,#0a0906,#14110a 70%,#100d08)",
    deco: [
      { i: "i-dice", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-refresh", x: 70, y: 22, s: 26, r: 10, lift: 11, d: 80 },
      { i: "i-bolt", x: 24, y: 20, s: 22, r: -10, lift: 13, d: 40 },
      { i: "i-dice", x: 47, y: 84, s: 18, r: 14, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "dystopia",
    name: "Dystopia",
    blurb: "somebody is in charge and it isn't you",
    icon: "i-ban",
    n: 5,
    note: "IGDB's dystopian keyword on its own — the rung Cyberpunk threw out, which is " +
          "exactly right here: Orwell, NORCO, Black the Fall, the Oddworlds, the Syndicates, " +
          "Half-Life 2. A theme that was a false positive somewhere else is not a bad " +
          "predicate, it was a predicate in the wrong place.",
    match: (r) => thmKw(r).includes("dystopian"),
    skin: "--ev-disp:'Saira Stencil One',var(--display);--ev-size:42px;--ev-dw:400;--ev-ls:.02em;" +
          "--ev-deco:#f87171;--ev-fg:#f6eaea;--ev-fg-2:#b9a4a4;--ev-edge:rgba(248,113,113,.3);" +
          "--ev-edge-hi:rgba(248,113,113,.7);--ev-glow:rgba(248,113,113,.28);--ev-t1:#fdf3f3;" +
          "--ev-t2:#fca5a5;--ev-t3:#f87171;--ev-on-cta:#260a0a;--ev-k:#fca5a5;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(248,113,113,.2),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(100,116,139,.24),transparent 60%)," +
          "linear-gradient(150deg,#08090b,#121316 70%,#15100f)",
    deco: [
      { i: "i-ban", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-lock", x: 70, y: 22, s: 26, r: 0, lift: 10, d: 90 },
      { i: "i-server", x: 24, y: 20, s: 22, r: -8, lift: 13, d: 40 },
      { i: "i-user", x: 47, y: 84, s: 18, r: 6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "bad",
    name: "Bad Games",
    plural: "bad games",          // the name is already a plural noun; see thmNoun
    blurb: "the ones the reviews warned you about",
    icon: "i-trash",
    n: 5,
    /* The only theme here that is an OPINION, so it wants more evidence than the keyword
       themes do, and it wants the evidence to agree. Three rungs and a veto:

         Metacritic <= 54          the strongest signal and the widest (8,248 rows carry a
                                   metascore). 54 is the bottom half of Metacritic's "mixed",
                                   not the top of it — this should be unarguable, not a
                                   theme about games that were merely fine.
         IGDB critics <= 55%,      the fallback for games Metacritic never covered. FIVE
           at least 5 of them      critics, not three: at three, a 0.50 average put Ghost
                                   Trick: Phantom Detective — an 83 on Metacritic — in the
                                   pool, which is how you learn a three-critic mean is noise.
         IGDB players <= 55%,      the same idea from the crowd, at 30 votes.
           at least 30 votes

       And the veto: a metascore of 70 or better disqualifies a game no matter what the
       other two say. That is Ghostwire: Tokyo (75, but 0.37 from 39 IGDB players) and
       Project Warlock (74, 0.43 from 32) — a game with a real critical consensus behind it
       is not a bad game because a small crowd on one site disliked it.

       Note every comparison guards for null FIRST. `null <= 54` is TRUE in JavaScript, so
       an unguarded threshold quietly matches every unrated game on the shelf — which, on a
       "bad games" pool, means 14,000 games you own are bad. */
    note: "Metacritic 54 or below; failing that, IGDB's critics under 55% with at least five " +
          "of them, or its players under 55% with at least thirty. A metascore of 70+ vetoes " +
          "all of that — one small crowd's dislike does not outvote a real consensus.",
    match: (r) => {
      const e = thmEn(r);
      if (!e.igdbId) return false;
      const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
      const m = num(e.metascore), c = num(e.criticRating), u = num(e.userRating);
      if (m != null && m >= 70) return false;
      return (m != null && m <= 54)
        || (c != null && c <= .55 && (e.criticCount || 0) >= 5)
        || (u != null && u <= .55 && (e.userRatingCount || 0) >= 30);
    },
    skin: "--ev-size:46px;--ev-dw:800;--ev-ls:-.01em;" +
          "--ev-deco:#fb923c;--ev-fg:#fdf0e6;--ev-fg-2:#c3a894;--ev-edge:rgba(251,146,60,.32);" +
          "--ev-edge-hi:rgba(251,146,60,.75);--ev-glow:rgba(251,146,60,.3);--ev-t1:#fff6ec;" +
          "--ev-t2:#fdba74;--ev-t3:#fb923c;--ev-on-cta:#2a1405;--ev-k:#fdba74;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,146,60,.24),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(120,53,15,.3),transparent 60%)," +
          "linear-gradient(150deg,#0b0805,#171009 70%,#120c08)",
    deco: [
      { i: "i-trash", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-review", x: 70, y: 22, s: 26, r: -8, lift: 10, d: 90 },
      { i: "i-alert", x: 24, y: 20, s: 22, r: 8, lift: 13, d: 40 },
      { i: "i-trend", x: 47, y: 84, s: 18, r: 14, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "essential",
    name: "Essential",
    blurb: "acclaimed, and you said you'd get to them",
    icon: "i-star",
    n: 3,
    /* The only theme built out of BOTH opinions: the world's and yours. Universal acclaim is
       Metacritic's own term and its own line — 90 and up, not 85, not "well reviewed" — and
       the priority column is the sheet's five-step scale, of which this takes the top two
       (Must Play, Will Play; the rest are Want to Play, Might Play, Will Not Play).

       Metacritic decides whenever it has an opinion, and IGDB's critics stand in only when
       it does not. That ordering matters: a plain union let Fallout: New Vegas (84) and
       Alien: Isolation (79) in through IGDB's softer aggregate, and a theme that means
       "universal acclaim" cannot contain a 79.

       Two scales, not one, and they are not the same scale — the enrichment's `metascore` is
       0-100 and the sheet's own metacriticRating column is 0-1. Reading the second without
       multiplying it silently matches nothing at all, since no row is ever >= 90 of 1.

       Three rather than five: 66 games deep and every one of them is a headliner. A slate of
       five Essentials is not a shortlist, it is a year. */
    note: "Metacritic 90 or better — their line for universal acclaim, not a softer one — on " +
          "a game you marked Must Play or Will Play. IGDB's critics stand in at 90% only for " +
          "games Metacritic never scored, never to overrule a score it did give.",
    match: (r) => {
      const e = thmEn(r);
      if (!e.igdbId) return false;
      const p = String(r.priority || "").trim();
      if (p !== "Must Play" && p !== "Will Play") return false;
      const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
      // metascore is 0-100; the sheet's own column is 0-1. Same number, different scale.
      const sheet = num(r.metacriticRating);
      const m = num(e.metascore) ?? (sheet != null ? sheet * 100 : null);
      if (m != null) return m >= 90;
      const c = num(e.criticRating);
      return c != null && c >= .90 && (e.criticCount || 0) >= 5;
    },
    skin: "--ev-size:58px;--ev-dw:800;--ev-ls:-.025em;" +
          "--ev-deco:#fbbf24;--ev-fg:#fdf6e3;--ev-fg-2:#c8b894;--ev-edge:rgba(251,191,36,.32);" +
          "--ev-edge-hi:rgba(251,191,36,.78);--ev-glow:rgba(251,191,36,.32);--ev-t1:#fffaf0;" +
          "--ev-t2:#fcd34d;--ev-t3:#fbbf24;--ev-on-cta:#291c02;--ev-k:#fcd34d;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,191,36,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(120,113,108,.26),transparent 60%)," +
          "linear-gradient(150deg,#0a0906,#16130c 70%,#111009)",
    deco: [
      { i: "i-star", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-trophy", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-ribbon", x: 24, y: 20, s: 22, r: 8, lift: 13, d: 40 },
      { i: "i-sparkle", x: 47, y: 84, s: 18, r: 0, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "soulslike",
    name: "Souls-like",
    blurb: "you will be asked to try again",
    icon: "i-flame",
    n: 3,
    note: "IGDB spells it soulslike, one word — the hyphenated and spaced variants match " +
          "nothing, and soulsborne matches nothing either. Three rather than five, because " +
          "the shortest game in this pool is still forty hours of dying.",
    match: (r) => thmKw(r).includes("soulslike"),
    skin: "--ev-size:44px;--ev-dw:800;--ev-ls:.12em;" +
          "--ev-deco:#d97706;--ev-fg:#f3ece1;--ev-fg-2:#b0a18c;--ev-edge:rgba(217,119,6,.3);" +
          "--ev-edge-hi:rgba(245,158,11,.72);--ev-glow:rgba(217,119,6,.26);--ev-t1:#faf5ec;" +
          "--ev-t2:#f59e0b;--ev-t3:#d97706;--ev-on-cta:#1d1204;--ev-k:#f59e0b;" +
          "--ev-art:radial-gradient(100% 140% at 84% 122%,rgba(217,119,6,.22),transparent 54%)," +
          "radial-gradient(90% 130% at 8% -16%,rgba(68,64,60,.4),transparent 62%)," +
          "linear-gradient(150deg,#080807,#14110d 70%,#0d0c0a)",
    deco: [
      { i: "i-flame", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-hourglass", x: 70, y: 22, s: 26, r: 4, lift: 10, d: 90 },
      { i: "i-heart", x: 24, y: 20, s: 22, r: -8, lift: 13, d: 40 },
      { i: "i-flame", x: 47, y: 84, s: 17, r: 10, lift: 8, d: 200, o: .45 },
    ],
  },
  {
    id: "lovecraft",
    name: "Lovecraft",
    plural: "Lovecraftian games",
    blurb: "something old, and it has noticed you",
    icon: "i-spider",
    n: 5,
    /* One keyword again, for the Cyberpunk reason. `cosmic horror` looked like a free
       widening and added four: Loop//Error, The Chant, Wildermyth and Aliens: Colonial
       Marines. Two of those are simply not Lovecraft, and a theme that contains Colonial
       Marines is a theme about tentacles in the abstract. `cthulhu mythos`, `lovecraft` and
       `eldritch` are not keywords IGDB uses at all — each matched zero. */
    note: "IGDB's lovecraftian keyword, alone. cosmic horror was tried and dropped: it added " +
          "four games, two of which were Wildermyth and Aliens: Colonial Marines.",
    match: (r) => thmKw(r).includes("lovecraftian"),
    skin: "--ev-disp:'Creepster',var(--display);--ev-size:52px;--ev-dw:400;--ev-ls:.03em;" +
          "--ev-deco:#4ade80;--ev-fg:#e7f5ea;--ev-fg-2:#93ad9b;--ev-edge:rgba(74,222,128,.26);" +
          "--ev-edge-hi:rgba(74,222,128,.66);--ev-glow:rgba(74,222,128,.26);--ev-t1:#f0fbf3;" +
          "--ev-t2:#86efac;--ev-t3:#4ade80;--ev-on-cta:#04180c;--ev-k:#86efac;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(74,222,128,.2),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(13,74,58,.42),transparent 60%)," +
          "linear-gradient(150deg,#050807,#0a1310 70%,#07100d)",
    deco: [
      { i: "i-spider", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-moon", x: 70, y: 22, s: 26, r: 0, lift: 10, d: 90 },
      { i: "i-book", x: 24, y: 20, s: 22, r: -10, lift: 13, d: 40 },
      { i: "i-bat", x: 47, y: 84, s: 18, r: 12, lift: 8, d: 200, o: .5 },
    ],
  },
];

const THM_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/* "137 cyberpunk games on the sheet" — the theme's name as a plural noun. Most names are
   adjectives and take "games" after them, but a few already end in one ("Bad Games" read as
   "559 bad games games"), so a theme can spell its own out. */
const thmNoun = (t) => t.plural || t.name.toLowerCase() + " games";

/* Slate bounds. The floor is 1 — "just tell me one cyberpunk game to play" is a legitimate
   use of this page, and forcing three onto someone who wanted one is a worse answer than no
   answer. The ceiling is two limits at once: a flat 24, and the theme's own pool, because a
   slate of 20 drawn from a pool of 12 is eight slots that can never fill and a completion
   bar that can never reach the end. 24 is a judgement call, not a law: past it a slate stops
   being a commitment you can hold in your head and turns back into a backlog, which is what
   the rest of the app already is. */
const THM_MIN = 1, THM_MAX = 24;
const thmCap = (t) => Math.max(THM_MIN, Math.min(THM_MAX, thmPool(t).length || THM_MAX));

/* ---- pools ----------------------------------------------------------------
   Two counts per theme, and they answer different questions. The POOL is what a roll can
   reach — owned and unfinished, the same test every event's shortlist uses. The BREADTH is
   every game the theme matches at all, owned or not, finished or not, and it is the number
   worth putting on the page: "37 of the 401 cyberpunk games on the sheet are yours and
   unplayed" says something that either number alone does not. */
const thmPool = (t) => evPool("thm-" + t.id, (r) => evOwnedUnfinished(r) && t.match(r));
const thmBreadth = (t) => evPool("thmall-" + t.id, (r) => t.match(r));

/* ---- state ----------------------------------------------------------------
     open   which theme's page you were last on. A pref rather than a URL param, because
            every other event keeps its dial in state too (Class of 'XX, the Galaxy scope)
            and a theme is a place you return to, not a link you send.
     runs   one OPEN run per theme, at most. { n, slate, pinned, done, rolls, started }
     past   finished runs per theme, newest first, capped — the record, which is the only
            reason any of this is stored rather than recomputed. */
const THM_PAST_CAP = 12;

const thmState = () => {
  const st = evState("themes");
  if (!st.runs || typeof st.runs !== "object") st.runs = {};
  if (!st.past || typeof st.past !== "object") st.past = {};
  if (!st.open || !THM_BY_ID[st.open]) st.open = THEMES[0].id;
  return st;
};
const thmTheme = () => THM_BY_ID[thmState().open] || THEMES[0];

const thmBlankRun = (t) => ({
  // No `done` list: completion is read off the sheet, never stored here. See thmIsDone.
  n: t.n, slate: new Array(t.n).fill(null), pinned: [], rolls: 0, started: null,
});

// The open run, created on demand. An empty slate IS a run — it just hasn't been rolled.
function thmRun(t) {
  const st = thmState();
  let run = st.runs[t.id];
  if (!run || !Array.isArray(run.slate)) { run = st.runs[t.id] = thmBlankRun(t); }
  if (!Array.isArray(run.pinned)) run.pinned = [];
  if (!run.n) run.n = run.slate.length || t.n;
  while (run.slate.length < run.n) run.slate.push(null);
  return run;
}

/* Done, and where "done" comes from: the sheet, and only the sheet. The Completed column is
   the one place this app has ever recorded a finished game, and a second place to say so is
   a second place to be wrong — a page-local tick drifts from the sheet the moment you finish
   something anywhere else, and then two screens disagree about the same game. So there is no
   tick button. Finish it, mark it on the sheet as you always would, and the slate catches up
   on the next load with nothing asked of you here.

   (`run.done` survives in old saved state and in the past[] snapshots, where it means
   something different and still true: what WAS finished when that run closed.) */
const thmSheetDone = (key) => { const r = evRow(key); return !!(r && r.completed); };
const thmIsDone = (run, key) => thmSheetDone(key);
const thmDoneCount = (run) => run.slate.filter((k) => thmIsDone(run, k)).length;
const thmFilled = (run) => run.slate.filter(Boolean).length;
const thmComplete = (run) => thmFilled(run) === run.n && thmDoneCount(run) === run.n;
const thmActive = (run) => thmFilled(run) > 0;

const thmPinned = (run, key) => !!key && run.pinned.includes(key);

/* A roll fills every slot that is not pinned and not already done. Pinned and done are the
   two kinds of "I have decided about this one", and a dice button that could throw either
   away would be a dice button nobody presses twice. */
function thmRoll(t, only) {
  const run = thmRun(t);
  const pool = thmPool(t);
  const keep = run.slate.map((k) => (k && (thmPinned(run, k) || thmIsDone(run, k)) ? k : null));
  // Slots to fill, in order — a single-slot reroll is the same operation with one index.
  const slots = only == null
    ? keep.map((k, i) => (k ? -1 : i)).filter((i) => i >= 0)
    : (keep[only] ? [] : [only]);
  if (!slots.length) {
    showToast(only == null ? "Every slot is pinned or finished" : "That one is pinned");
    return;
  }
  const draw = evDraw(pool, slots.length, keep.filter(Boolean));
  if (!draw.length) {
    showToast(`Nothing left in the ${t.name} pool that isn't already on the slate`);
    return;
  }
  const next = only == null ? keep : run.slate.slice();
  slots.forEach((i, j) => { next[i] = draw[j] ? evKey(draw[j]) : (only == null ? null : next[i]); });
  run.slate = next;
  run.rolls = (run.rolls || 0) + 1;
  if (!run.started) run.started = evISO();
  // A game rolled away is not a game you pinned. Keeps `pinned` from accumulating keys that
  // haven't been on the slate for six rolls.
  run.pinned = run.pinned.filter((k) => run.slate.includes(k));
  evSave();
}

function thmTogglePin(t, key) {
  const run = thmRun(t);
  const i = run.pinned.indexOf(key);
  if (i >= 0) run.pinned.splice(i, 1); else run.pinned.push(key);
  evSave();
}

function thmSet(t, slot, key) {
  const run = thmRun(t);
  // One game, one slot: putting a game that is already on the slate into a new slot MOVES
  // it, and the slot it left takes whatever was in the destination (hearthSet's rule).
  const at = run.slate.indexOf(key);
  if (at >= 0 && at !== slot) run.slate[at] = run.slate[slot];
  run.slate[slot] = key;
  if (!run.started) run.started = evISO();
  evSave();
}

function thmDrop(t, slot) {
  const run = thmRun(t);
  const key = run.slate[slot];
  run.slate[slot] = null;
  run.pinned = run.pinned.filter((k) => k !== key);
  evSave();
}

/* Resizing a run keeps the decisions and drops the filler. Shrinking pulls the pinned and
   finished games to the front rather than slicing them off the end, because "5, actually
   make it 3" means "fewer games", never "lose the two I pinned". */
function thmResize(t, n) {
  const run = thmRun(t);
  // Round first and only fall back on genuine junk — `+n || t.n` sent a legitimate 0 to the
  // theme's default instead of to the floor of 1.
  n = Math.round(+n);
  if (!Number.isFinite(n)) n = t.n;
  n = Math.max(THM_MIN, Math.min(thmCap(t), n));
  if (n === run.n) return;
  if (n < run.slate.length) {
    const keep = run.slate.filter((k) => k && (thmPinned(run, k) || thmIsDone(run, k)));
    if (keep.length > n) { showToast(`${keep.length} are pinned or finished — unpin one first`); return; }
    const rest = run.slate.filter((k) => k && !keep.includes(k));
    run.slate = keep.concat(rest).slice(0, n);
  }
  run.n = n;
  while (run.slate.length < n) run.slate.push(null);
  evSave();
}

// Close the run and keep it. The slate is snapshotted with its verdicts because the sheet
// will keep changing under it and the record should say what was true when it closed.
function thmFinish(t) {
  const st = thmState();
  const run = thmRun(t);
  if (!thmActive(run)) return;
  const entry = {
    slate: run.slate.filter(Boolean),
    done: run.slate.filter((k) => thmIsDone(run, k)),
    rolls: run.rolls || 0,
    started: run.started || null,
    finished: evISO(),
  };
  if (!Array.isArray(st.past[t.id])) st.past[t.id] = [];
  st.past[t.id].unshift(entry);
  st.past[t.id] = st.past[t.id].slice(0, THM_PAST_CAP);
  st.runs[t.id] = thmBlankRun(t);
  st.runs[t.id].n = run.n;
  st.runs[t.id].slate = new Array(run.n).fill(null);
  evSave();
}

function thmOpen(id) {
  if (!THM_BY_ID[id]) return;
  const st = thmState();
  st.open = id;
  evSave();
}

/* ---- the page ------------------------------------------------------------- */

function thmSlotHtml(t, run, slot) {
  const key = run.slate[slot];
  const row = key ? evRow(key) : null;
  if (!row) {
    return `<div class="ev-slot empty">
      <button class="ev-slot-add" data-thmpick="${slot}" aria-label="Choose a game for slot ${slot + 1}">
        ${icon(t.icon, 24)}<span>Pick one</span>
      </button></div>`;
  }
  const done = thmIsDone(run, key);
  const pinned = thmPinned(run, key);
  return `<div class="ev-slot thm-slot${done ? " done" : ""}${pinned ? " pinned" : ""}">
    ${evTileHtml(row, { sub: `${row.platform || ""}${row.estimatedTime ? " · " + evHours(row.estimatedTime) : ""}` })}
    ${done ? `<span class="thm-done-tag">${icon("i-check", 12)} Finished</span>` : ""}
    <!-- Four actions under a tile that is 166px wide at its narrowest, so they are all
         icon-only and the row is a four-column grid rather than a flex line: an equal
         fraction each, no intrinsic width to overflow, identical on a phone and a desktop.
         None of them is a completion tick — that is the sheet's to say, not this page's. -->
    <span class="ev-slot-acts thm-acts">
      <button class="ev-pin" data-thmpin="${escapeHtml(key)}" aria-pressed="${pinned}"
        aria-label="${pinned ? "Pinned" : "Pin it"}"
        title="${pinned ? "Pinned — a roll leaves it alone" : "Pin it so a roll leaves it alone"}"
        >${icon("i-pin", 13)}</button>
      <button class="ev-swap" data-thmreroll="${slot}" aria-label="Roll this slot again"
        title="Roll just this one again">${icon("i-dice", 13)}</button>
      <button class="ev-swap" data-thmpick="${slot}" aria-label="Choose this one by hand"
        title="Pick this slot by hand">${icon("i-search", 13)}</button>
      <button class="ev-x" data-thmdrop="${slot}" aria-label="Clear the slot"
        title="Empty the slot">${icon("i-close", 13)}</button>
    </span>
  </div>`;
}

function thmPastHtml(t) {
  const past = thmState().past[t.id] || [];
  if (!past.length) return "";
  return `<section class="ev-panel wide">
    <h3>The record</h3>
    <p class="ev-p">${evPlural(past.length, "closed run", "closed runs")} of ${escapeHtml(t.name)}.
      Snapshotted as they closed, so the sheet moving on afterwards doesn't rewrite them.</p>
    <div class="thm-past">${past.map((p) => `<div class="thm-run">
      <div class="thm-run-h">
        <b>${p.done.length} of ${p.slate.length}</b>
        <span class="m">${escapeHtml(p.started || "?")} → ${escapeHtml(p.finished || "?")}${
          p.rolls ? ` · ${evPlural(p.rolls, "roll", "rolls")}` : ""}</span>
      </div>
      <div class="ev-row-tiles">${p.slate.map((k) => {
        const row = evRow(k);
        return row ? evTileHtml(row, {
          cls: p.done.includes(k) ? "thm-was-done" : "",
          sub: p.done.includes(k) ? "finished" : "not this time",
        }) : "";
      }).join("")}</div>
    </div>`).join("")}</div>
  </section>`;
}

function thmRailHtml(t) {
  return `<div class="ev-rungs thm-rail">${THEMES.map((x) => {
    const run = thmState().runs[x.id];
    /* The denominator is the SLATE SIZE, not how many slots happen to be filled — same
       number the page header and the meter use. Counting filled slots here was the one
       place three views of one run disagreed: "2 of 3 done" on the rail beside "2 of 8
       done" on the page, for the same run with five empty slots. */
    const n = run && Array.isArray(run.slate) ? run.n : 0;
    const done = run && Array.isArray(run.slate)
      ? run.slate.filter((k) => thmIsDone(run, k)).length : 0;
    return `<button class="ev-rung${x.id === t.id ? " on" : ""}" data-thmgo="${x.id}"
        title="${escapeHtml(x.blurb)}">
      ${icon(x.icon, 15)}<b>${escapeHtml(x.name)}</b>
      <i>${n ? `${done} of ${n} done` : `${thmPool(x).length.toLocaleString()} to roll`}</i>
    </button>`;
  }).join("")}</div>`;
}

function thmRender(host) {
  const ev = EV.byId.themes;
  const t = thmTheme();
  const run = thmRun(t);
  const pool = thmPool(t);
  const breadth = thmBreadth(t);
  const mine = breadth.filter((r) => r.owned).length;
  const done = thmDoneCount(run);
  const cap = thmCap(t);
  const gap = run.n - thmFilled(run);
  const repaint = () => { thmRender(host); evWireTiles(host); };

  /* The registry entry wears the active theme (see the header). Both of these have to be
     set before evHeroHtml reads them, and the HOST style has to be set here rather than
     left to evRenderPage — that one ran before the theme was known. */
  ev.skin = t.skin;
  ev.deco = t.deco;
  host.setAttribute("style", t.skin);

  const used = new Map(run.slate.filter(Boolean).map((k) => [k, "On the slate"]));

  host.innerHTML = evHeroHtml(ev, {
    acts: `<button class="btn" id="thmRoll">${icon("i-dice", 15)} ${
      thmActive(run) ? "Roll the open slots" : `Roll ${run.n}`}</button>
      <span class="ev-target thm-size" title="Anywhere from ${THM_MIN} to ${cap}${
        cap < THM_MAX ? ` — ${t.name} only has ${pool.length} left to roll from` : ""}">Slate of
        <button class="thm-step" data-thmn="${run.n - 1}" aria-label="One game fewer"
          ${run.n <= THM_MIN ? "disabled" : ""}>−</button>
        <b>${run.n}</b>
        <button class="thm-step" data-thmn="${run.n + 1}" aria-label="One game more"
          ${run.n >= cap ? "disabled" : ""}>+</button>
        ${run.n === 1 ? "game" : "games"}</span>
      ${thmActive(run) ? `<button class="btn ghost" id="thmFinish">${
        thmComplete(run) ? "Close it out" : "Finish the run"}</button>` : ""}`,
    note: `${pool.length.toLocaleString()} to roll from — ${breadth.length.toLocaleString()} ${
      escapeHtml(thmNoun(t))} on the sheet, ${mine.toLocaleString()} of them yours.`,
  }) + `<div class="ev-wrap">
    ${thmRailHtml(t)}
    <section class="ev-panel wide">
      <!-- One sentence of counting, in the order you'd ask it: how big is the slate, how
           much of it is behind you, how much of it isn't filled yet. The last part only
           appears when there IS a gap, which is the number that used to go missing — a
           slate of 8 with 3 games on it read as "0 of 8 done" and looked broken. -->
      <h3>The slate · ${evPlural(run.n, "game", "games")}${
        thmActive(run) ? ` · ${done} finished` : ""}${gap ? ` · ${gap} still empty` : ""}</h3>
      <p class="ev-p">${thmActive(run)
        ? `Pin what you mean to keep and roll again — a roll only touches the open slots.
           ${thmComplete(run) ? "That is the whole slate finished; close it out and the record keeps it."
             : "Nothing to tick off: a game marks itself finished here when the sheet says it is."}`
        : `Roll ${run.n} out of the pool, or fill a slot by hand. Nothing here expires and
           nothing is scheduled — that is the difference between a theme and a season.`}</p>
      <div class="ev-mantel thm-mantel">${
        Array.from({ length: run.n }, (_, i) => thmSlotHtml(t, run, i)).join("")}</div>
      ${run.rolls ? `<p class="thm-meta">${evPlural(run.rolls, "roll", "rolls")} since ${
        escapeHtml(run.started || "—")}.</p>` : ""}
    </section>
    <p class="thm-note">${escapeHtml(t.note)}</p>
    ${thmPastHtml(t)}
    ${evPickerHtml(used)}
  </div>`;

  host.querySelectorAll("[data-thmgo]").forEach((el) => {
    el.onclick = () => { thmOpen(el.dataset.thmgo); evPickerClose(); repaint(); };
  });
  const roll = document.getElementById("thmRoll");
  if (roll) roll.onclick = () => { thmRoll(t); repaint(); };
  host.querySelectorAll("[data-thmreroll]").forEach((el) => {
    el.onclick = () => { thmRoll(t, +el.dataset.thmreroll); repaint(); };
  });
  host.querySelectorAll("[data-thmpin]").forEach((el) => {
    el.onclick = () => { thmTogglePin(t, el.dataset.thmpin); repaint(); };
  });
  host.querySelectorAll("[data-thmdrop]").forEach((el) => {
    el.onclick = () => { thmDrop(t, +el.dataset.thmdrop); repaint(); };
  });
  host.querySelectorAll("[data-thmpick]").forEach((el) => {
    el.onclick = () => {
      const slot = +el.dataset.thmpick;
      evPickerOpen({
        slot, pool, title: `${t.name}, slot ${slot + 1}`, repaint,
        onPick: (key) => { thmSet(t, slot, key); evPickerClose(); repaint(); },
      });
    };
  });
  host.querySelectorAll("[data-thmn]").forEach((el) => {
    el.onclick = () => { thmResize(t, el.dataset.thmn); repaint(); };
  });
  evWirePicker(host, repaint, used);
  if (typeof maybeEnrich === "function") {
    maybeEnrich(run.slate.filter(Boolean).map(evRow).filter(Boolean).concat(pool.slice(0, 40)));
  }
}

/* ---- the banner ------------------------------------------------------------
   Its own, rather than evBannerHtml's, for one reason: the banner has to wear the ACTIVE
   theme's skin, and evBannerHtml reads ev.skin off the registry entry — which is only
   correct after a page render has set it. A banner that depended on the page having been
   opened first would be right most of the time and wrong on a cold load, which is worse. */
function thmBannerHtml() {
  const ev = EV.byId.themes;
  const t = thmTheme();
  const run = thmRun(t);
  const m = ev.meter();
  return `<section class="ev-banner" data-ev="themes" style="${t.skin}" role="button" tabindex="0"
      aria-label="${escapeHtml(t.name)}: ${escapeHtml(t.blurb)}">
    <div class="ev-deco-wrap">${evDecoHtml(t.deco)}</div>
    <div class="ev-banner-in">
      <span class="h-eyebrow ev-eyebrow">Theme · no season, no deadline</span>
      <h2 class="ev-title">${escapeHtml(t.name)}</h2>
      <p class="ev-pitch">${escapeHtml(ev.pitch())}</p>
      <span class="ev-cta">${escapeHtml(thmComplete(run) ? "Close it out" : "Back to the slate")} →</span>
      ${evMeterHtml(m)}
    </div>
  </section>`;
}

evRegister({
  id: "themes",
  name: "Themes",
  icon: "i-theme",
  structure: "Slate",
  // Under every season and under Endangered. A theme has all year; October does not, and
  // the one banner slot should go to whichever of them is running out of time.
  priority: 35,
  window: null,
  core: null,
  cta: "Open the board",
  blurb: "a slate of games on a theme, rolled and pinned",
  // Neutral, and only ever seen on the preview board before a theme has been opened —
  // every real render swaps in the active theme's own (thmRender, thmBannerHtml).
  skin: "--ev-disp:var(--display);--ev-size:44px;--ev-dw:800;--ev-ls:.01em;" +
        "--ev-deco:#a78bfa;--ev-fg:#f1ecff;--ev-fg-2:#aba3c9;--ev-edge:rgba(167,139,250,.3);" +
        "--ev-edge-hi:rgba(167,139,250,.72);--ev-glow:rgba(167,139,250,.32);--ev-t1:#f7f4ff;" +
        "--ev-t2:#c4b5fd;--ev-t3:#a78bfa;--ev-on-cta:#120a26;--ev-k:#c4b5fd;" +
        "--ev-art:linear-gradient(150deg,#07060d,#0d0a18 70%,#0a0a16)",
  deco: [{ i: "i-theme", x: 86, y: 66, s: 44, lift: 12 }],
  bannerHtml: thmBannerHtml,
  blank: () => ({ runs: {}, past: {}, open: THEMES[0].id }),
  /* Merging two devices, per theme rather than per file. The rules, and why:
       slate   fill gaps, never overwrite — a slot you filled here is a decision.
       pinned  union, then narrowed to what is actually on the slate.
       done    nothing to merge — both devices read it off the same sheet.
       past    the longer record wins outright; runs are appended whole and a half-merged
               history is worse than either device's copy of it.
       open    left alone: which theme this browser is looking at is this browser's business. */
  merge: (mine, theirs) => {
    let changed = false;
    if (!mine.runs) { mine.runs = {}; changed = true; }
    if (!mine.past) { mine.past = {}; changed = true; }
    for (const [id, t] of Object.entries(theirs.runs || {})) {
      const m = mine.runs[id];
      if (!m) { mine.runs[id] = t; changed = true; continue; }
      (t.slate || []).forEach((k, i) => {
        if (k && !m.slate[i] && !m.slate.includes(k)) { m.slate[i] = k; changed = true; }
      });
      for (const k of t.pinned || []) {
        if (m.slate.includes(k) && !m.pinned.includes(k)) { m.pinned.push(k); changed = true; }
      }
      if ((t.rolls || 0) > (m.rolls || 0)) { m.rolls = t.rolls; changed = true; }
      if (t.started && (!m.started || t.started < m.started)) { m.started = t.started; changed = true; }
    }
    for (const [id, list] of Object.entries(theirs.past || {})) {
      if (Array.isArray(list) && list.length > (mine.past[id] || []).length) {
        mine.past[id] = list; changed = true;
      }
    }
    return changed;
  },
  // The tab says "Themes"; the poster says which one. Same trick as Class of 'XX, whose
  // name is a different year every January.
  title: () => thmTheme().name,
  eyebrow: () => "Theme · no season, no deadline",
  pitch: () => {
    const t = thmTheme();
    const run = thmRun(t);
    const filled = thmFilled(run), done = thmDoneCount(run);
    if (!filled) return `${thmPool(t).length.toLocaleString()} ${thmNoun(t)} on your shelf, unplayed. Roll ${run.n} of them.`;
    if (thmComplete(run)) return `${t.blurb} — and the whole slate is finished. Close it out and roll another.`;
    if (!done) return `${evPlural(filled, "game", "games")} on the slate: ${t.blurb}. Nothing finished yet, and nothing is asking you to hurry.`;
    // Against run.n, not against `filled`, and the meter agrees: the slate size is the
    // commitment, so an empty slot is a slot still to play rather than one that doesn't count.
    return `${done} of ${run.n} finished. ${t.blurb.charAt(0).toUpperCase()}${t.blurb.slice(1)}.`;
  },
  meter: () => {
    const t = thmTheme();
    const run = thmRun(t);
    const filled = thmFilled(run);
    if (!filled) return { pct: null, text: `an empty slate, and ${thmPool(t).length.toLocaleString()} to draw from` };
    return { pct: Math.round((thmDoneCount(run) / run.n) * 100),
             text: `${thmDoneCount(run)} of ${run.n} done · ${evPlural(run.rolls || 0, "roll", "rolls")}` };
  },
  /* Always eligible for the banner, but only while a run is open. A theme with an empty
     slate has nothing to report, and the whole reason an always-on event can share the year
     with nine seasons is that it stays quiet when it has nothing to say (Endangered's rule). */
  live: () => thmActive(thmRun(thmTheme())),
  render: thmRender,
  reset: () => { EVP.slot = null; EVP.q = ""; EVP.all = false; },
});
