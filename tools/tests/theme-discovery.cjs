const { readAppSource } = require('./app-source.cjs');
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rows = [];
for (let i = 0; i < 5; i++) rows.push({ _k: `rare-done-${i}`, genre: "Rhythm", completed: true, playable: "Yes" });
for (let i = 0; i < 6; i++) rows.push({ _k: `familiar-done-${i}`, genre: "Action", completed: true, playable: "Yes" });
rows.push(
  { _k: "rare-great", genre: "Rhythm", completed: false, playable: "Yes" },
  { _k: "rare-weak", genre: "Rhythm", completed: false, playable: "Yes" },
  { _k: "familiar-great", genre: "Action", completed: false, playable: "Yes" },
  { _k: "score-attack", completed: false, playable: "Yes" },
  { _k: "rogue-only", completed: false, playable: "Yes" },
  { _k: "score-reset", completed: false, playable: "Yes" },
  { _k: "cult", completed: false, playable: "Yes", releaseYear: 2005 },
  { _k: "too-famous", completed: false, playable: "Yes", releaseYear: 2005 },
  { _k: "too-reviewed", completed: false, playable: "Yes", releaseYear: 2005 },
  { _k: "too-new", completed: false, playable: "Yes", releaseYear: 2025 },
);
const enrichment = {
  "score-attack": { igdbId: 1, keywords: ["score attack"] },
  "rogue-only": { igdbId: 2, keywords: ["roguelike"] },
  "score-reset": { igdbId: 3, keywords: ["high score", "procedural generation"] },
  cult: { igdbId: 4, year: 2005, userRating: .86, userRatingCount: 44, criticCount: 2 },
  "too-famous": { igdbId: 5, year: 2005, userRating: .90, userRatingCount: 151, criticCount: 2 },
  "too-reviewed": { igdbId: 6, year: 2005, userRating: .90, userRatingCount: 44, criticCount: 4 },
  "too-new": { igdbId: 7, year: 2025, userRating: .90, userRatingCount: 44, criticCount: 2 },
};
const scores = { "rare-great": .80, "rare-weak": .79, "familiar-great": .95 };
const context = vm.createContext({
  TAB_RESET: {},
  sessionStorage: { getItem: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  _enrichEpoch: 0,
  DATA: { sheets: { games: { rows } } },
  ENRICH: enrichment,
  criticOf: (row) => scores[row._k] ?? null,
});
const read = (name) => readAppSource(path.join(__dirname, "../../static", name), "utf8");
vm.runInContext(read("events.js"), context);
vm.runInContext(read("themes.js"), context);
const match = (theme, key) => vm.runInContext(
  `THM_BY_ID.${theme}.match(DATA.sheets.games.rows.find((r) => r._k === "${key}"))`, context);

assert.equal(match("comfortzone", "rare-great"), true, "five completed in a genre is still unfamiliar");
assert.equal(match("comfortzone", "rare-weak"), false, "comfort-zone picks still need an 80% critic score");
assert.equal(match("comfortzone", "familiar-great"), false, "six completed games makes the primary genre familiar");
assert.equal(match("onemorerun", "score-attack"), true, "explicit score attack qualifies");
assert.equal(match("onemorerun", "rogue-only"), false, "a generic roguelike tag alone does not qualify");
assert.equal(match("onemorerun", "score-reset"), true, "high score plus a run-reset signal qualifies");
assert.equal(match("cultclassics", "cult"), true, "older, loved, lightly covered game qualifies");
assert.equal(match("cultclassics", "too-famous"), false, "large audiences stay out of the cult pool");
assert.equal(match("cultclassics", "too-reviewed"), false, "broad critic coverage stays out");
assert.equal(match("cultclassics", "too-new"), false, "games under ten years old are not classics yet");

function themeCase(theme, title, metadata, expected, message) {
  const key = `new-theme-${rows.length}`;
  rows.push({ _k: key, title, completed: false, playable: "Yes" });
  enrichment[key] = metadata;
  assert.equal(match(theme, key), expected, message);
  return rows[rows.length - 1];
}
for (const title of ["A Short Hike", "Lil Gator Game", "TOEM"]) {
  themeCase("wholesome", title, {}, true, `${title} qualifies even without enrichment`);
}
themeCase("wholesome", "Unknown gentle game", { igdbId: 8, keywords: ["Wholesome"] }, true,
  "explicit IGDB mood tags qualify case-insensitively");
themeCase("wholesome", "Unknown cosy game", { igdbId: 9, keywords: ["cosy"] }, true,
  "British cozy spelling qualifies");
themeCase("wholesome", "Cute combat", { igdbId: 10, keywords: ["cute", "casual", "family friendly"] }, false,
  "broad cute/family tags do not imply wholesome");
themeCase("wholesome", "Cozy horror", { igdbId: 11, keywords: ["cozy"], themes: ["Horror"] }, false,
  "horror themes veto cozy tags");
themeCase("wholesome", "Cozy horror keywords", { igdbId: 12, keywords: ["wholesome", "psychological horror"] }, false,
  "horror keywords also veto wholesome tags");
themeCase("wholesome", "Unknown fallback", { keywords: ["wholesome"] }, false,
  "non-IGDB free text is not trusted");
themeCase("wholesome", "A Short Hike: Unrelated Sequel", {}, false,
  "curated titles are exact matches, not prefixes");
const tunic = themeCase("zeldalikes", "TUNIC", {}, true, "TUNIC fills a known tag gap");
themeCase("zeldalikes", "Death’s Door", {}, true, "curly apostrophes preserve exact title matches");
themeCase("zeldalikes", "Sheet alias", { igdbId: 13, name: "Ōkami HD" }, true,
  "canonical metadata names can resolve sheet aliases");
themeCase("zeldalikes", "Unknown adventure", { igdbId: 14, keywords: ["Zelda-like"] }, true,
  "explicit Zelda-like tags generalize beyond curated titles");
themeCase("zeldalikes", "Super Smash Bros. Ultimate", { igdbId: 15, keywords: ["zelda", "the legend of zelda"] }, false,
  "Zelda references do not imply Zelda-like gameplay");
themeCase("zeldalikes", "Generic dungeon game", { igdbId: 16, genres: ["Adventure"], keywords: ["dungeon crawler"] }, false,
  "broad adventures and dungeon crawlers stay out");
themeCase("zeldalikes", "Unknown fallback", { keywords: ["zelda-like"] }, false,
  "Zelda-like keywords also require IGDB provenance");
tunic.completed = true;
const unplayable = themeCase("zeldalikes", "Hob", {}, true, "Hob fills a known tag gap");
unplayable.playable = "No";
const pool = JSON.parse(vm.runInContext("JSON.stringify(thmPool(THM_BY_ID.zeldalikes).map(r => r._k))", context));
assert.ok(!pool.includes(tunic._k) && !pool.includes(unplayable._k),
  "new theme slates retain completed and unplayable exclusions");
for (const title of ["Deus Ex", "Dishonored", "System Shock 2", "Thief II: The Metal Age"]) {
  themeCase("immersivesims", title, {}, true, `${title} qualifies despite missing tags`);
}
themeCase("immersivesims", "Prey", { igdbId: 19531, year: 2017 }, true, "Arkane's Prey qualifies");
themeCase("immersivesims", "Prey", { igdbId: 546, year: 2006 }, false, "Prey 2006 is a different game");
themeCase("immersivesims", "Prey", { year: 2017 }, true, "a known year disambiguates Prey without an IGDB ID");
themeCase("immersivesims", "Prey", {}, false, "an ambiguous title without a year is not guessed");
themeCase("immersivesims", "Inkonbini", { igdbId: 294592, keywords: ["immersive sim"] }, false,
  "a noisy immersive-sim tag does not override the editorial selection");
themeCase("immersivesims", "Deus Ex: Unrelated Spin-off", {}, false, "franchise prefixes do not qualify");
for (const title of ["Katamari Damacy", "Donut County", "Jazzpunk", "Thank Goodness You’re Here!"]) {
  themeCase("weirdlittle", title, {}, true, `${title} is a curated playful oddity`);
}
themeCase("weirdlittle", "Sheet alias", { igdbId: 24415, name: "Jazzpunk: Director's Cut" }, true,
  "curated editions resolve through canonical names");
themeCase("weirdlittle", "Unrelated surreal epic", { igdbId: 20, keywords: ["surreal", "comedy"], genres: ["Indie"] }, false,
  "surreal, comedy and indie tags alone do not imply a weird little game");
themeCase("weirdlittle", "Donut County: Unrelated Sequel", {}, false, "weird-game selections also match exactly");
for (const title of ["Return of the Obra Dinn", "Paradise Killer", "The Forgotten City", "Phoenix Wright: Ace Attorney Trilogy"]) {
  themeCase("detective", title, {}, true, `${title} fills a detective metadata gap`);
}
themeCase("detective", "New private-eye adventure", { igdbId: 21, keywords: ["Private Detective"], genres: ["Point-and-click"] }, true,
  "detective tags plus point-and-click gameplay qualify");
themeCase("detective", "New investigative puzzle", { igdbId: 22, keywords: ["detective", "investigation"], genres: ["Puzzle"] }, true,
  "detective, investigation and puzzle evidence qualify together");
themeCase("detective", "New deduction game", { igdbId: 23, keywords: ["deductive reasoning"] }, true,
  "an explicit deduction mechanic qualifies");
themeCase("detective", "Batman action game", { igdbId: 24, keywords: ["detective", "investigation"], genres: ["Puzzle", "Hack and slash/Beat 'em up"] }, false,
  "action gameplay is not admitted by detective character tags");
themeCase("detective", "Dancing mystery spin-off", { igdbId: 25, keywords: ["detective", "investigation"], genres: ["Music"] }, false,
  "a mystery setting does not make a music game investigative");
themeCase("detective", "Generic mystery", { igdbId: 26, keywords: ["mystery"], genres: ["Puzzle"] }, false,
  "mystery alone does not qualify");
themeCase("detective", "Fallback detective", { keywords: ["detective"], genres: ["Point-and-click"] }, false,
  "detective metadata also requires IGDB provenance");
for (const [theme, title] of [["immersivesims", "Arx Fatalis"], ["weirdlittle", "Wattam"], ["detective", "Her Story"]]) {
  const finished = themeCase(theme, title, {}, true, `${title} belongs to its theme`);
  finished.completed = true;
  const unavailable = themeCase(theme, title, {}, true, `${title} also matches before eligibility filtering`);
  unavailable.playable = "Unknown";
  const eligible = JSON.parse(vm.runInContext(`JSON.stringify(thmPool(THM_BY_ID.${theme}).map(r => r._k))`, context));
  assert.ok(!eligible.includes(finished._k) && !eligible.includes(unavailable._k),
    `${theme} excludes completed games and unknown playability from rolls`);
}
assert.equal(vm.runInContext("THEMES.length", context), 30, "theme catalog contains 30 themes");

console.log("Discovery themes: comfort, repeat-session, cult-classic, wholesome, Zelda-like, immersive, weird and detective boundaries passed");
