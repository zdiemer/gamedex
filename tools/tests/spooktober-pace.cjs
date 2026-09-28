/* Spooktober's pace: spans, packing, eviction and pins.

   The calendar arithmetic is the part of that file worth a test — every other piece of it is
   markup or a fetch. A shelf of twenty games at 2h, 4h, ... 40h makes every span predictable
   (at 2h a night, "Game N" books exactly N nights), so a packing bug shows up as a number
   rather than as a month that merely looks wrong. */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rows = Array.from({ length: 20 }, (_, i) => ({
  _k: `g${i + 1}`, title: `Game ${i + 1}`, genre: 'Survival Horror', hours: (i + 1) * 2,
}));

const storage = new Map();
const context = vm.createContext({
  TAB_RESET: {}, activeTab: 'other', IS_ADMIN: false, console,
  localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
  DATA: { sheets: { games: { rows } } },
  ENRICH: {}, _enrichEpoch: 1,
  playtimeOf: (r) => r.hours,
  groupByGame: (r) => r,
  rowsByK: () => ({ completed: new Set() }),
  combinedRating: () => 0,
  escapeHtml: (s) => String(s), icon: () => '', fmtHours: (h) => `${h}h`,
  posterCardHtml: () => '', coverSrc: () => '', searchField: () => '', maybeEnrich: () => {},
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../static/spooktober.js'), 'utf8'), context);

const run = (src) => vm.runInContext(src, context);
// Anything structural comes back through JSON: an array built inside the vm has the vm's
// Array prototype, and deepEqual compares prototypes before it compares contents.
const val = (src) => JSON.parse(vm.runInContext(`JSON.stringify(${src})`, context));
const runs = () => val('spookRuns().map((r) => [r.start, r.end, r.key])');
const allNights = () => val('spookNights().map(([d]) => d)');
const emptyNights = () => val('spookNights().filter(([, r]) => !r).map(([d]) => d)');

// ---- the default is the calendar as it shipped ----------------------------
assert.equal(run('spookHpd()'), 0, 'one game per night until a pace is set');
run(`spookRoll(${JSON.stringify(allNights())})`);
assert.equal(run('spookGames()'), 20, 'twenty games in the pool fill twenty nights');
assert.ok(runs().every(([s, e]) => s === e), 'no pace means no run is longer than a night');
assert.equal(run('spookMisfits().length'), 0, 'nothing can mismatch a pace that is not set');

// ---- spans -----------------------------------------------------------------
run('spookSetHpd(2)');
assert.equal(run('spookHpd()'), 2);
assert.equal(run("spookSpan(spookRowFor('g10'))"), 10, '20h at 2h a night is ten nights');
assert.equal(run("spookSpan(spookRowFor('g1'))"), 1, '2h at 2h a night is one night');
run('spookSetHpd(3)');
assert.equal(run("spookSpan(spookRowFor('g1'))"), 1, 'a short game never books less than a night');
assert.equal(run("spookSpan(spookRowFor('g2'))"), 2, '4h at 3h a night rounds up to two');
run('spookSetHpd(2)');
// Not capped at the month: the dice use the true length to decide what fits.
assert.equal(run("spookSetHpd(1), spookSpan(spookRowFor('g20'))"), 40, '40h at 1h a night is 40 nights');
run('spookSetHpd(2)');
// A game nobody has timed books one night rather than a guess.
rows.push({ _k: 'gx', title: 'Untimed', genre: 'Survival Horror', hours: null });
run('_spookPool = null, _spookIdx = null');
assert.equal(run("spookSpan(spookRowFor('gx'))"), 1, 'untimed games book one night');

// ---- changing the pace leaves the calendar alone ---------------------------
assert.equal(run('spookGames()'), 20, 'the month the old pace built is still there');
assert.equal(run('spookMisfits().length'), 19, 'and every run but the 2h one now says so');

// ---- re-pack ---------------------------------------------------------------
const packed = val('spookRepack()');
assert.equal(run('spookMisfits().length'), 0, 're-pack lays every run at its true length');
assert.ok(packed.games >= 1 && packed.games + packed.dropped === 20, 'every game is kept or dropped');
assert.ok(run('spookFilled()') <= 31, 'a re-pack never runs past the month');
for (const [start, end, key] of runs()) {
  assert.equal(end - start + 1, run(`spookSpan(spookRowFor(${JSON.stringify(key)}))`),
    `${key} holds exactly the nights it needs`);
}

// ---- packing ---------------------------------------------------------------
run('spookClearAll()');
const rolled = val(`spookRoll(${JSON.stringify(allNights())})`);
assert.equal(rolled.nights, run('spookFilled()'), 'the roll reports the nights it took');
assert.equal(rolled.games, run('spookGames()'), 'and the games it placed');
assert.ok(rolled.games > 1 && rolled.games < 20, 'a paced month is a handful of games, not 31');
for (const [start, end, key] of runs()) {
  assert.equal(end - start + 1, run(`spookSpan(spookRowFor(${JSON.stringify(key)}))`),
    'the packer never clips a game to make it fit');
}
// Nothing is placed twice, and nothing overlaps.
const keys = runs().map(([, , k]) => k);
assert.equal(new Set(keys).size, keys.length, 'a game holds one run');

// ---- placing by hand -------------------------------------------------------
run("spookClearAll(); spookSet(1, 'g10')");                 // 20h / 2h = nights 1–10
assert.deepEqual(runs(), [[1, 10, 'g10']]);
run("spookSet(5, 'g3')");                                    // 6h = 3 nights, over the middle
assert.deepEqual(runs(), [[5, 7, 'g3']], 'a run you land on is evicted whole, not split');
run("spookSet(20, 'g3')");                                   // the same game again, further on
assert.deepEqual(runs(), [[20, 22, 'g3']], 'assigning a game that is already placed moves it');
run("spookSet(29, 'g20')");                                  // 40h = 20 nights, clipped
assert.deepEqual(runs().at(-1), [29, 31, 'g20'], 'a game placed against the end is clipped at the 31st');

// ---- pins ------------------------------------------------------------------
run('spookClearAll()');
run(`spookRoll(${JSON.stringify(allNights())})`);
const first = runs()[0];
run(`spookPin(${first[0]}, true)`);
const loose = [];
for (const [start, end] of runs()) {
  if (start === first[0]) continue;
  for (let d = start; d <= end; d++) loose.push(d);
}
run(`spookRoll(${JSON.stringify(loose)})`);
assert.deepEqual(runs()[0], first, 'a pinned run survives a re-roll unchanged');
run('spookPin(2, true); spookSave()');
assert.deepEqual(val('spookPins()'), [first[0]], 'a pin in the middle of a run is dropped on save');
run(`spookClearDay(${first[0] + 1})`);
assert.ok(!runs().some(([s]) => s === first[0]), 'clearing any night of a run clears the run');
assert.deepEqual(val('spookPins()'), [], 'and takes its pin with it');

// ---- the file on disk ------------------------------------------------------
const saved = JSON.parse(storage.get('gamedex.spooktober'));
assert.equal(saved.v, 3);
assert.equal(saved.hpd, 2, 'the pace is saved beside the calendar, not per year');
// A v2 file — the shape every browser is holding today — reads back with no pace set.
run("SPOOK.cal = null");
storage.set('gamedex.spooktober', JSON.stringify({ v: 2, cal: { 2026: { 1: 'g1' } }, pins: { 2026: [1] } }));
assert.equal(run('spookHpd()'), 0, 'a v2 file migrates to one game per night');
assert.deepEqual(runs(), [[1, 1, 'g1']], 'and keeps its calendar');

// ---- an empty month --------------------------------------------------------
run('spookSetHpd(4); spookClearAll()');
assert.deepEqual(val('spookRoll([])'), { games: 0, nights: 0 }, 'rolling nothing does nothing');
run('spookSetHpd(1)');
run(`spookSet(31, 'g20')`);                                  // 40 nights, one left
assert.deepEqual(runs(), [[31, 31, 'g20']]);
assert.equal(emptyNights().length, 30);

console.log('Spooktober pace: spans, packing, eviction, clipping and pins checked');
