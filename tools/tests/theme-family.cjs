const { readAppSource } = require('./app-source.cjs');
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rows = [
  { _k: "safe-local", title: "Safe Local", playable: "Yes", completed: false },
  { _k: "safe-split", title: "Safe Split", playable: "Yes", completed: false },
  { _k: "online-only", title: "Online Only", playable: "Yes", completed: false },
  { _k: "older-rating", title: "Older Rating", playable: "Yes", completed: false },
  { _k: "unrated", title: "Unrated", playable: "Yes", completed: false },
  { _k: "finished", title: "Finished", playable: "Yes", completed: true },
];
const enrichment = {
  "safe-local": { igdbId: 1, ageRating: "ESRB E", coopLocal: 2, gameModes: ["Co-operative"] },
  "safe-split": { igdbId: 2, ageRating: "PEGI 7", gameModes: ["Split screen"] },
  "online-only": { igdbId: 3, ageRating: "ESRB E", coopOnline: 4, gameModes: ["Co-operative"] },
  "older-rating": { igdbId: 4, ageRating: "ESRB E10+", coopLocal: 2, gameModes: ["Split screen"] },
  "unrated": { igdbId: 5, ageRating: null, coopLocal: 2, gameModes: ["Split screen"] },
  "finished": { igdbId: 6, ageRating: "CERO A", coopLocal: 2, gameModes: ["Co-operative"] },
};

const context = vm.createContext({
  TAB_RESET: {},
  sessionStorage: { getItem: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  _enrichEpoch: 0,
  DATA: { sheets: { games: { rows } } },
  ENRICH: enrichment,
});

const read = (name) => readAppSource(path.join(__dirname, "../../static", name), "utf8");
vm.runInContext(read("events.js"), context);
vm.runInContext(read("themes.js"), context);

const matches = (key) => vm.runInContext(
  `THM_BY_ID.family.match(DATA.sheets.games.rows.find((r) => r._k === "${key}"))`, context);
assert.equal(matches("safe-local"), true, "youngest rating plus two local players qualifies");
assert.equal(matches("safe-split"), true, "youngest rating plus explicit split screen qualifies");
assert.equal(matches("online-only"), false, "online-only co-op does not qualify");
assert.equal(matches("older-rating"), false, "E10+ stays outside the young-child pool");
assert.equal(matches("unrated"), false, "missing ratings are never guessed");

assert.deepEqual(JSON.parse(vm.runInContext(
  `JSON.stringify(thmPool(THM_BY_ID.family).map((row) => row._k))`, context)),
["safe-local", "safe-split"], "the roll pool also excludes completed games");

console.log("Family theme: conservative ratings and verified same-room play checks passed");
