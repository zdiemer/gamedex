const { readAppSource } = require('./app-source.cjs');
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const read = (name) => readAppSource(path.join(__dirname, "../../static", name), "utf8");

/* The landing page's two pieces of logic: which finished games it lists, and how the view
   rides in the URL so Back and the Home banner land where they should. */
const done = (key, title, dateCompleted, genre = "Stealth Action") =>
  ({ _k: key, title, platform: "PC", genre, completed: true, playable: "Yes", dateCompleted });
const rows = [
  done("old", "Old Sneaker", "2025-01-02"),
  done("new", "New Sneaker", "2026-11-01"),
  done("mid", "Mid Sneaker", "2026-06-15"),
  done("dup-a", "Twice Listed", "2026-10-01"),
  done("dup-b", "Twice Listed", "2026-09-01"),
  done("plain", "No Theme At All", "2026-11-05", "Racing"),
  done("undated", "Undated Sneaker", ""),
  { _k: "open", title: "Unfinished Sneaker", platform: "PC", genre: "Stealth Action", completed: false, playable: "Yes" },
];
const storage = new Map([["gamedex.events", JSON.stringify({ v: 1, ev: { themes: {
  open: "cyberpunk", runs: { stealth: { n: 2, slate: ["mid", null], pinned: [], rolls: 1, started: "2026-06-01" } },
} } })]]);
const context = vm.createContext({
  TAB_RESET: {}, activeTab: "other", IS_ADMIN: true, URLSearchParams,
  sessionStorage: { getItem: () => null },
  localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  _enrichEpoch: 0, DATA: { sheets: { games: { rows } } }, ENRICH: {}, criticOf: () => null,
  // App globals some theme predicates read; empty answers are fine for these rows.
  playtimeOf: () => null, unifiedGenreVals: (r) => [r.genre], unifiedDevVals: () => [], unifiedFranchiseVals: () => [],
});
vm.runInContext(read("events.js"), context);
vm.runInContext(read("themes.js"), context);

const recent = JSON.parse(vm.runInContext(`JSON.stringify(thmRecentFinished().map((x) =>
  ({ k: x.row._k, from: x.from, first: x.themes[0].id })))`, context));
assert.deepEqual(recent.map((x) => x.k), ["new", "dup-a", "mid", "old"],
  "newest first; unthemed, undated, unfinished and repeat titles are left out");
assert.equal(recent.find((x) => x.k === "mid").from, "stealth", "a game rolled onto a slate is marked");
assert.equal(recent.find((x) => x.k === "mid").first, "stealth", "the slate it came off is its first theme");
assert.equal(recent.find((x) => x.k === "new").from, null, "a game never slated still counts toward its theme");
assert.equal(vm.runInContext("thmRecentFinished(2).length", context), 2, "the list honours its limit");

const urlFor = (id) => vm.runInContext(`(() => { THM_VIEW.id = ${JSON.stringify(id)};
  const p = new URLSearchParams(); EV.byId.themes.urlState.write(p); return p.toString(); })()`, context);
assert.equal(urlFor(null), "", "the landing page needs no parameter");
assert.equal(urlFor("stealth"), "th=stealth", "a theme page carries its id");
const readUrl = (qs) => JSON.parse(vm.runInContext(`(() => {
  EV.byId.themes.urlState.read(new URLSearchParams(${JSON.stringify(qs)}));
  return JSON.stringify([THM_VIEW.id, evState("themes").open]); })()`, context));
assert.deepEqual(readUrl("th=giantrobots"), ["giantrobots", "giantrobots"], "a theme link opens that theme");
assert.deepEqual(readUrl("th=nonsense"), [null, "giantrobots"], "an unknown theme falls back to the landing page");
assert.deepEqual(readUrl(""), [null, "giantrobots"], "no parameter is the landing page and keeps the open theme");

vm.runInContext("THM_VIEW.id = 'stealth'; EV.byId.themes.reset()", context);
assert.equal(vm.runInContext("THM_VIEW.id", context), null, "a deliberate visit to the tab starts on the landing page");
vm.runInContext("EV.byId.themes.bannerOpen()", context);
assert.equal(vm.runInContext("THM_VIEW.id", context), "giantrobots", "the Home banner opens the slate it advertises");
assert.equal(vm.runInContext("evName(EV.byId.themes)", context), "Giant Robots", "a theme page is titled by its theme");
vm.runInContext("THM_VIEW.id = null", context);
assert.equal(vm.runInContext("evName(EV.byId.themes)", context), "Themes", "the landing page is titled Themes");

console.log("Theme landing: recent finishes, slate marking, URL view state, reset and banner entry passed");
