const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function check(script, load, read, remote, local, expected = { '1': 'local-game', '2': 'phone-game' }) {
  for (const failure of ['network', 'http', 'json', 'signed-out']) {
    const storage = new Map([[local.key, JSON.stringify(local.value)]]);
    let calls = 0;
    const writes = [];
    let recover = false;
    const context = vm.createContext({
      TAB_RESET: {}, activeTab: 'other', IS_ADMIN: failure !== 'signed-out',
      sessionStorage: { getItem: () => null },
      localStorage: {
        getItem: key => storage.get(key),
        setItem: (key, value) => storage.set(key, value),
      },
      fetch: async (url, options) => {
        if (options?.method === 'PUT') {
          writes.push(JSON.parse(options.body));
          return { ok: true };
        }
        calls++;
        if (!recover && failure === 'network') throw new Error('offline');
        return {
          ok: recover || failure !== 'http', status: 503,
          json: async () => {
            if (!recover && failure === 'json') throw new Error('invalid JSON');
            return { prefs: remote };
          },
        };
      },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../static', script), 'utf8'), context);
    await vm.runInContext(`${load}()`, context);
    assert.equal(calls, failure === 'signed-out' ? 0 : 1);
    recover = true;
    context.IS_ADMIN = true;
    await Promise.all([
      vm.runInContext(`${load}()`, context),
      vm.runInContext(`${load}()`, context),
    ]);
    assert.equal(calls, failure === 'signed-out' ? 1 : 2, 'deduplicate concurrent retries');
    assert.deepEqual(JSON.parse(vm.runInContext(`JSON.stringify(${read})`, context)),
      expected, `${script}: ${failure}`);
    if (script === 'spooktober.js') {
      assert.equal(writes.length, 1, 'upload recovered local picks');
      assert.deepEqual(writes[0].cal[2026], expected);
    }
    await vm.runInContext(`${load}()`, context);
    assert.equal(calls, failure === 'signed-out' ? 1 : 2, 'successful loads remain cached');
  }
}

(async () => {
  await check('spooktober.js', 'spookLoadPrefs', 'spookFile().cal[2026]',
    { spooktober: { v: 2, cal: { 2026: { 2: 'phone-game' } }, pins: {} } },
    { key: 'gamedex.spooktober', value: { 2026: { 1: 'local-game' } } });
  const phoneCalendar = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [i + 1, `game-${i + 1}`]));
  await check('spooktober.js', 'spookLoadPrefs', 'spookFile().cal[2026]',
    { spooktober: { v: 2, cal: { 2026: {} }, pins: { 2026: [] } } },
    { key: 'gamedex.spooktober', value: { v: 2, cal: { 2026: phoneCalendar }, pins: {} } }, phoneCalendar);
  await check('events.js', 'evLoadPrefs', 'evFile().ev.hearth',
    { events: { v: 1, ev: { hearth: { 2: 'phone-game' } } } },
    { key: 'gamedex.events', value: { v: 1, ev: { hearth: { 1: 'local-game' } } } });
  console.log('Event prefs: retry, auth, deduplication, migration and merge checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
