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
assert.equal(vm.runInContext("THEMES.length", context), 25, "theme catalog contains 25 themes");

console.log("Discovery themes: comfort, repeat-session, and cult-classic boundaries passed");
