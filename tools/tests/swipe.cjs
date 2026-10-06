const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const prefs = {
  swiped: [2],
  dismissed: [3],
  swipeSettings: [{
    minYear: 2000, maxYear: 2020, minScore: 75, confidence: "fair",
    genres: ["RPG"], platforms: ["PC"],
  }],
};
const rows = [
  { id: 1, year: 2010, score: .82, confidence: .8, genres: ["RPG"], platforms: ["PC"] },
  { id: 2, year: 2012, score: .84, confidence: .9, genres: ["RPG"], platforms: ["PC"] },
  { id: 3, year: 2014, score: .86, confidence: .9, genres: ["RPG"], platforms: ["PC"] },
  { id: 4, year: 1999, score: .90, confidence: .9, genres: ["RPG"], platforms: ["PC"] },
  { id: 5, year: 2015, score: .90, confidence: .9, genres: ["Action"], platforms: ["PC"] },
  { id: 6, year: 2015, score: .90, confidence: .9, genres: ["RPG"], platforms: ["PS5"] },
  { id: 7, year: 2015, score: .70, confidence: .9, genres: ["RPG"], platforms: ["PC"] },
  { id: 8, year: 2015, score: .90, confidence: .4, genres: ["RPG"], platforms: ["PC"] },
].map((x) => ({
  row: { igdbId: x.id, _igdb: { year: x.year, genres: x.genres, platforms: x.platforms } },
  p: { score: x.score, confidence: x.confidence },
}));
const context = vm.createContext({
  document: { addEventListener() {} },
  prefsLocal: (key) => prefs[key] || [],
  prefsSave: (key, value) => { prefs[key] = value; },
  recsRanked: () => rows,
  _enrichEpoch: 1,
});
vm.runInContext(fs.readFileSync("static/swipe.js", "utf8"), context);
const ids = () => JSON.parse(vm.runInContext("JSON.stringify(swipeDeck().map(x => x.row.igdbId))", context));

assert.deepEqual(ids(), [1], "history and every deck setting filter the candidate pool");
assert.equal(vm.runInContext("swipeSettingsCount()", context), 5, "active setting groups are counted");
vm.runInContext("swipeRemember(1)", context);
assert.deepEqual(JSON.parse(JSON.stringify(prefs.swiped)), [2, 1], "a want or pass is remembered");
assert.deepEqual(ids(), [], "remembered games disappear immediately");
vm.runInContext("swipeForget(1)", context);
assert.deepEqual(ids(), [1], "undo restores the game to the same filtered deck");
console.log("Swipe: persistent history and deck filters passed");

const cardRec = { row: { igdbId: 77, _igdb: { cover: "cover", year: 2020, genres: ["RPG"], platforms: ["PC"] } },
  p: { score: .8, confidence: .8 }, because: null };
const cardContext = vm.createContext({
  cardRec,
  document: { addEventListener() {} },
  prefsLocal: () => [], prefsSave() {}, recsRanked: () => [cardRec], _enrichEpoch: 1,
  recRow: () => ({ _igdbId: 77, title: "A Game", predicted: .8, confidence: "High" }),
  RECS_META: { 77: { summary: "Summary", release: "2020", platforms: ["PC"], sheetPlatforms: ["PC"] } },
  DATA: { sheets: { games: { rows: [{ platform: "PC" }] } } },
  IMG: () => "/cover.jpg", ratingClass: () => "great", escapeHtml: (value) => String(value), icon: () => "",
});
vm.runInContext(fs.readFileSync("static/swipe.js", "utf8"), cardContext);
const cardHtml = vm.runInContext("swipeCardHtml(cardRec)", cardContext);
assert.match(cardHtml, /data-sw-art/, "the art is an explicit details target");
assert.doesNotMatch(cardHtml, /Picked from the shape of your ratings|class="sw-why"/, "generic rating-shape copy is omitted");
assert.match(fs.readFileSync("static/swipe.js", "utf8"), /art\.onclick[\s\S]*openDrawer/, "clicking art opens the detail drawer");
console.log("Swipe: box art opens details and generic rationale is removed");

const loadingHost = { innerHTML: "" };
const loadingContext = vm.createContext({
  document: { addEventListener() {} },
  $: (selector) => selector === "#swipe" ? loadingHost : null,
  IS_ADMIN: true,
  ENRICH_ENABLED: true,
  ENRICH_READY: false,
  ENRICH_WAITING: false,
  icon: () => "",
  escapeHtml: (value) => String(value),
});
vm.runInContext(fs.readFileSync("static/swipe.js", "utf8"), loadingContext);
vm.runInContext("renderSwipe()", loadingContext);
assert.match(loadingHost.innerHTML, /Checking your library/, "the deck waits for ownership ids before showing a card");
assert.equal(loadingContext.ENRICH_WAITING, true, "the enrichment loader knows Swipe is waiting");
console.log("Swipe: first card waits for the ownership map");

const catalogueContext = vm.createContext({
  DATA: { sheets: { games: { rows: [
    { _k: "trackedgame|pc|2020", releaseYear: 2020, owned: false },
    { _k: "uniquegame|pc|", owned: false },
  ] } } },
  ENRICH: {}, NO_MATCH: new Set(), _enrichEpoch: 1,
  resetRecs() {}, resetSwipe() {},
});
vm.runInContext(fs.readFileSync("static/catalogue.js", "utf8"), catalogueContext);
vm.runInContext(`CAT = [
  {igdbId:42, _norm:"trackedgame", _parent:null, _vparent:null, releaseYear:2020,
    _igdb:{year:2020, gameModes:[]}},
  {igdbId:43, _norm:"trackedgame", _parent:null, _vparent:null, releaseYear:2021,
    _igdb:{year:2021, gameModes:[]}},
  {igdbId:44, _norm:"uniquegame", _parent:null, _vparent:null, releaseYear:2018,
    _igdb:{year:2018, gameModes:[]}},
  {igdbId:45, _norm:"freshgame", _parent:null, _vparent:null, releaseYear:2020,
    _igdb:{year:2020, gameModes:[]}}
]`, catalogueContext);
const freshIds = JSON.parse(vm.runInContext("JSON.stringify(catFresh().map(x => x.igdbId))", catalogueContext));
assert.deepEqual(freshIds, [43, 45], "tracked-only rows are excluded before IGDB enrichment lands");
console.log("Swipe: tracked-only sheet rows stay out of the deck");

(async () => {
  const source = fs.readFileSync("static/panels.js", "utf8");
  const loader = source.slice(source.indexOf("let allTimer = null;"));
  let renders = 0;
  const panelContext = vm.createContext({
    ENRICH_ENABLED: true, ENRICH: {}, NO_MATCH: new Set(), ENRICH_READY: false,
    ENRICH_WAITING: false, _enrichEpoch: 0, activeTab: "swipe",
    fetch: async () => ({ json: async () => ({ items: { owned: { igdbId: 338105 } } }) }),
    resetDerived() {}, renderSwipe() { renders++; }, renderAll() {},
    updateEnrichStatus() {}, clearTimeout, setTimeout,
  });
  vm.runInContext(loader, panelContext);
  await vm.runInContext("loadAllEnrichment()", panelContext);
  assert.equal(renders, 1, "Swipe rerenders when owned IGDB ids arrive");
  assert.equal(panelContext.ENRICH.owned.igdbId, 338105, "the ownership map contains Kirby Air Riders");
  console.log("Swipe: ownership-map arrival rebuilds the deck");
})().catch((error) => { console.error(error); process.exitCode = 1; });

(async () => {
  const storage = new Map([["gamedex.swiped", "[1,2]"]]);
  const writes = [];
  const prefContext = vm.createContext({
    document: { addEventListener() {} },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    fetch: async (url, options) => {
      if (options && options.method === "PUT") {
        writes.push(JSON.parse(options.body));
        return { ok: true, text: async () => "" };
      }
      return { ok: true, json: async () => ({ prefs: { swiped: [] } }) };
    },
    $: () => null,
    console,
    activeTab: "other",
    IS_ADMIN: true,
    SPECIAL_TABS: [],
    tabState: {},
  });
  vm.runInContext(fs.readFileSync("static/extras.js", "utf8"), prefContext);
  await vm.runInContext("loadPrefs()", prefContext);
  assert.deepEqual(JSON.parse(storage.get("gamedex.swiped")), [], "a cleared server pref beats stale local history");
  assert.equal(writes.length, 0, "stale local history is not uploaded after a server-side clear");
  console.log("Prefs sync: cleared server values remain cleared");
})().catch((error) => { console.error(error); process.exitCode = 1; });
