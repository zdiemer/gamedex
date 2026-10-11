const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = vm.createContext({
  TAB_RESET: {},
  sessionStorage: { getItem: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  _enrichEpoch: 0,
  DATA: { sheets: { games: { rows: [] } } },
  ENRICH: {},
});

const read = (name) => fs.readFileSync(path.join(__dirname, "../../static", name), "utf8");
vm.runInContext(read("events.js"), context);
vm.runInContext(read("ev-blackhistory.js"), context);

const pick = (year) => vm.runInContext(
  `evFebruaryPick(new Date(${year}, 1, 14))`, context);
assert.equal(pick(2026), "blackhistory", "2026 launches the Black History Month event");
assert.deepEqual(new Set(Array.from({ length: 12 }, (_, i) => pick(2024 + i))),
  new Set(["blackhistory", "twoplayer"]), "the stable draw reaches both events");

for (let year = 2024; year <= 2035; year++) {
  const live = vm.runInContext(`(() => {
    const d = new Date(${year}, 1, 14);
    const window = { from: [2, 1], to: [2, 28] };
    return ["blackhistory", "twoplayer"].filter((id) =>
      evBannerOn({ window, active: (at) => evFebruaryActive(id, at) }, d));
  })()`, context);
  assert.equal(live.length, 1, `${year} has exactly one February event`);
  assert.equal(live[0], pick(year));
}
assert.equal(vm.runInContext(`evBannerOn({
  window: { from: [2, 1], to: [2, 28] },
  active: (d) => evFebruaryActive("blackhistory", d),
}, new Date(2026, 2, 1))`, context), false, "the draw does not extend outside February");

context.DATA.sheets.games.rows = [
  { _k: "burgos", title: "Neko Ghost, Jump!", developer: "Burgos Games" },
  { _k: "kiroo", title: "Aurion", developer: "Kiro’o Games" },
  { _k: "unknown", title: "Unknown", developer: "Example Studio" },
];
assert.deepEqual(JSON.parse(vm.runInContext(
  `JSON.stringify(bhmRows().map((row) => row._k))`, context)),
["burgos", "kiroo"], "only explicitly curated studios enter the spotlight");

console.log("February events: stable yearly draw, exclusive banner, and curated studio checks passed");
