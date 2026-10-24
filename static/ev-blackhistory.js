"use strict";

/* Black History Month — a curated studio spotlight.

   Race is not metadata and must never be inferred from a developer's name, country or a
   game's subject. This event matches only an explicit list of companies that publicly
   appear in the Black Game Developers directory, plus studios named in public Black
   creator spotlights and their own studio pages.

   Sources:
     https://www.blackgamedevs.com/
     https://news.xbox.com/en-us/2024/02/01/xbox-and-gameheads-amplifying-black-voices-in-gaming/
     https://news.xbox.com/en-us/2025/02/03/black-history-month-2025/
*/

const BHM_STUDIO_NAMES = [
  "Afroes",
  "Algitt Studios",
  "Algorythmic Studios",
  "Brainchild Studios",
  "Burgos Games",
  "Decoy Games",
  "Duckbridge",
  "DVNC Tech",
  "Edible Entertainment",
  "Endless Fluff",
  "FeryFamy",
  "GN Games",
  "Gnovahex Computing",
  "Grand Scheme Games",
  "Hughes Who Technologies Studio",
  "Iron Reaver Games",
  "Junub Games",
  "KIRO'O Games",
  "Kola Studios",
  "Legeci Studios",
  "Leti Arts",
  "Lucky Shot Media",
  "MABManZ",
  "MerjTek",
  "Miscellaneum Studios",
  "More Fire Games",
  "NITETIME Studios",
  "Noohkema Interactive",
  "Notion Games",
  "Nyabingi Studio",
  "OMC Games",
  "One Man Left Studios",
  "PawByte",
  "PolyKnight Games",
  "Quadron Studios",
  "Revelation Interactive",
  "Stormy Nights",
  "SwordSharp",
  "Waking Oni",
  "Whim Independent Studios",
  "White Guardian Studios",
  // Newer studios and creators documented in the linked spotlights or studio pages.
  "3-Fold Games",
  "Aerial_Knight",
  "Brass Lion Entertainment",
  "Glow Up Games",
  "NuChallenger",
  "Nyamakop",
  "Silver Rain Games",
  "Strange Scaffold",
  "Studio Zevere",
  "Surgent Studios",
  "Veritable Joy Studios",
  "Weathered Sweater",
];

const bhmNorm = (value) => String(value || "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]/g, "");

const BHM_STUDIOS = new Map(BHM_STUDIO_NAMES.map((name) => [bhmNorm(name), name]));

function bhmStudios(row) {
  const values = typeof unifiedDevVals === "function"
    ? unifiedDevVals(row)
    : [row.developer];
  return [...new Set(values.map((name) => BHM_STUDIOS.get(bhmNorm(name))).filter(Boolean))];
}

const bhmRows = () => evPool("blackhistory", (row) => bhmStudios(row).length > 0);
function bhmStats() {
  const rows = bhmRows();
  return {
    rows,
    studios: new Set(rows.flatMap(bhmStudios)).size,
    done: rows.filter((row) => row.completed).length,
    ready: rows.filter((row) => !row.completed && row.playable === "Yes").length,
  };
}

evRegister({
  id: "blackhistory",
  name: "Black History Month",
  icon: "i-globe",
  structure: "Spotlight",
  priority: 80,
  window: { from: [2, 1], to: [2, 28] },
  core: { from: [2, 1], to: [2, 28] },
  active: (d) => evFebruaryActive("blackhistory", d),
  cta: "Meet the makers",
  blurb: "games from Black developers and Black-led studios",
  offSeason: "February draws one of two events each year. This spotlight stays open when Two-Player February gets the banner.",
  skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:52px;--ev-dw:800;--ev-ls:.01em;" +
        "--ev-deco:#f5c542;--ev-fg:#fff5d6;--ev-fg-2:#d8caa8;--ev-edge:rgba(245,197,66,.34);" +
        "--ev-edge-hi:rgba(245,197,66,.7);--ev-glow:rgba(245,197,66,.3);--ev-t1:#fff8df;" +
        "--ev-t2:#f5c542;--ev-t3:#d94a3a;--ev-on-cta:#160d06;--ev-k:#f5c542;" +
        "--ev-art:radial-gradient(100% 150% at 88% 115%,rgba(16,132,77,.42),transparent 58%)," +
        "radial-gradient(90% 130% at 5% -20%,rgba(207,49,44,.34),transparent 60%)," +
        "linear-gradient(140deg,#100907,#1b1009 68%,#102016)",
  deco: [
    { i: "i-globe", x: 86, y: 67, s: 48, r: -5, lift: 13 },
    { i: "i-book", x: 70, y: 25, s: 30, r: 7, lift: 11, d: 90 },
    { i: "i-pad", x: 45, y: 20, s: 25, r: -8, lift: 14, d: 30 },
    { i: "i-star", x: 70, y: 83, s: 24, lift: 9, d: 150, o: .72 },
    { i: "i-sparkle", x: 48, y: 84, s: 18, lift: 8, d: 220, o: .62 },
    { i: "i-trophy", x: 94, y: 27, s: 21, r: 8, lift: 11, d: 180, o: .62 },
  ],
  blank: () => ({}),
  merge: () => false,
  eyebrow: () => "February's yearly draw",
  pitch: () => {
    const { rows, studios, done, ready } = bhmStats();
    if (!rows.length) return "A shelf-wide spotlight on games by Black developers.";
    return `${rows.length.toLocaleString()} games from ${studios.toLocaleString()} studios. ${done.toLocaleString()} finished; ${ready.toLocaleString()} ready to play.`;
  },
  meter: () => {
    const { rows, done, ready } = bhmStats();
    return {
      pct: rows.length ? Math.round((done / rows.length) * 100) : 0,
      text: `${done.toLocaleString()} finished · ${ready.toLocaleString()} ready to play`,
    };
  },
  render: bhmRender,
  reset: () => {},
});
