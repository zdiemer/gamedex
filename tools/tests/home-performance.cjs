/* Behavior checks for deferred Home work and reusable date labels. No browser needed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let instant = Date.parse('2026-10-22T23:59:59Z'), dates = 0;
class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); dates++; }
  static now() { return instant; }
}
const timers = [], observers = [];
const slot = { isConnected: true, innerHTML: '', removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [] };
const context = {
  TAB_RESET: {}, DATA: { sheets: { games: { rows: [] } } }, _enrichEpoch: 0,
  activeTab: 'home', Date: ClockDate,
  document: { getElementById: id => id === 'hChalSlot' ? slot : {} },
  matchMedia: () => ({ matches: false }),
  setTimeout: fn => { timers.push(fn); },
  IntersectionObserver: class {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe(el) { this.el = el; }
    disconnect() { this.disconnected = true; }
  },
};
context.window = context;
vm.createContext(context);
for (const name of ['challenges', 'home']) vm.runInContext(fs.readFileSync(`static/${name}.js`, 'utf8'), context);
const run = code => vm.runInContext(code, context);
assert.equal(run('chToday()'), '2026-10-22');
const before = dates;
for (let i = 0; i < 1000; i++) run('chToday()');
assert.equal(dates, before, 'candidate checks reuse the UTC day');
context.priorityRank = () => 3;
context.candidate = { playable: 'Yes', releaseDate: '2026-10-23' };
assert.equal(run('isCandidate(candidate)'), false);
instant += 2000;
assert.equal(run('isCandidate(candidate)'), true, 'a game becomes eligible on its release day');
assert.equal(run('chToday()'), '2026-10-23', 'midnight refreshes eligibility');
instant -= 86400000;
assert.equal(run('chToday()'), '2026-10-22', 'clock corrections also invalidate');
assert.equal(run('chMonth("2024-02-01")'), 'February, 2024');
assert.equal(run('chMonth("2024-02-29")'), 'February, 2024');
assert.equal(run('_chMonths.size'), 1, 'different days share a month key');
assert.equal(run('chMonth("2025-02-01")'), 'February, 2025');
assert.equal(run('chMonth(null)'), null);
assert.equal(run('chMonth("invalid")'), 'Invalid Date, NaN');
// Challenge eligibility results cannot survive a date or enrichment change.
run('var computes = 0; var sample = {}; _computeChallenge = () => ({ n: ++computes });');
assert.equal(run('computeChallenge(sample).n'), 1);
assert.equal(run('computeChallenge(sample).n'), 1);
instant += 86400000;
assert.equal(run('computeChallenge(sample).n'), 2);
context._enrichEpoch++;
assert.equal(run('computeChallenge(sample).n'), 3);
run('chReset()');
assert.equal(run('computeChallenge(sample).n'), 4);

// Stub the expensive calculation; exercise the real scheduling/cancellation path.
run('CHALLENGES.splice(0, CHALLENGES.length, { id: "a" }, { id: "b" }); var completed = []; computeChallenge = c => { completed.push(c.id); return c; }; challengeSpotlight = results => results.map(c => c.id).join(",");');
async function tick() { const fn = timers.shift(); if (fn) fn(); await Promise.resolve(); }
(async () => {
  run('scheduleHomeChallenges()');
  assert.equal(run('completed.length'), 0, 'offscreen slot does no challenge work');
  const old = observers.at(-1);
  run('scheduleHomeChallenges()');
  const current = observers.at(-1);
  old.cb([{ isIntersecting: true }]);
  assert.equal(current.disconnected, false, 'stale observer cannot cancel the new one');
  current.cb([{ isIntersecting: true }]);
  await tick();
  assert.equal(run('completed.join(",")'), 'a', 'one challenge per task');
  context.activeTab = 'games'; run('cancelHomeChallenges()');
  await tick();
  assert.equal(slot.innerHTML, '', 'leaving Home cancels the pending update');
  assert.equal(run('completed.join(",")'), 'a');
  context.activeTab = 'home'; run('completed = []; scheduleHomeChallenges()');
  observers.at(-1).cb([{ isIntersecting: true }]);
  await tick(); context._enrichEpoch++; await tick();
  assert.equal(slot.innerHTML, '', 'mixed enrichment epochs never publish');
  observers.at(-1).cb([{ isIntersecting: true }]);
  await tick(); await tick();
  assert.equal(slot.innerHTML, 'a,b', 'visible slot eventually renders complete results');
  // Recommendation joins preserve the first matching row and see replacement data.
  context.RECS = [{ key: 'one' }];
  context.DATA.sheets.games.rows = [{ _k: 'one', title: 'First' }, { _k: 'one', title: 'Second' }];
  run('dailyStable = pool => pool');
  assert.equal(run('recShelfRows()[0].row.title'), 'First');
  context.DATA.sheets.games.rows = [{ _k: 'one', title: 'Updated' }];
  assert.equal(run('recShelfRows()[0].row.title'), 'Updated');
  // A late hero response must not replace controls or overwrite a newer selection.
  const responses = [], images = [], patches = [];
  context.ENRICH_ENABLED = true; context.DETAIL = {};
  context.IMG = id => '/shot/' + id;
  context.Image = class { set src(url) { images.push(url); } };
  context.fetch = () => new Promise(resolve => responses.push(resolve));
  context.document.querySelector = () => ({
    style: { setProperty: (...args) => patches.push(args) },
    querySelector: () => ({ classList: { add() {} } }),
  });
  const game = { _k: 'a', title: 'A', playingStatus: 'Playing', dateStarted: '2026-01-01' };
  context.DATA.sheets.games.rows = [game]; context.playing = [game];
  const pending = run('loadHeroShot(playing)');
  run('loadHeroShot(playing)');
  assert.equal(responses.length, 1, 'boot and render share one hero request');
  context.DATA.sheets.games.rows = [{ ...game, _k: 'b' }];
  responses.shift()({ ok: true, json: async () => ({ status: 'matched', detail: { screenshots: ['old'] } }) });
  await pending;
  assert.equal(patches.length, 0, 'old response cannot paint the newly selected game');
  context.playing = context.DATA.sheets.games.rows;
  const next = run('loadHeroShot(playing)');
  responses.shift()({ ok: true, json: async () => ({ status: 'matched', detail: { screenshots: ['new'] } }) });
  await next;
  assert.deepEqual(patches, [['--shot', "url('/shot/new')"]]);
  assert.deepEqual(images, ['/shot/old', '/shot/new']);
  console.log('Home: date rollover, stable month labels, deferred work, cancellation, epoch restart and joins passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
