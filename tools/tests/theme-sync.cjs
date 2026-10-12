const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const read = (name) => fs.readFileSync(path.join(__dirname, "../../static", name), "utf8");

function themeContext(local, getRemote) {
  const storage = new Map([["gamedex.events", JSON.stringify(local)]]);
  const context = vm.createContext({
    TAB_RESET: {}, activeTab: "other", IS_ADMIN: true,
    sessionStorage: { getItem: () => null },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    _enrichEpoch: 0,
    DATA: { sheets: { games: { rows: [] } } }, ENRICH: {},
    criticOf: () => null,
    fetch: async () => ({ ok: true, json: async () => ({ prefs: getRemote() }) }),
  });
  vm.runInContext(read("events.js"), context);
  vm.runInContext(read("themes.js"), context);
  return context;
}

(async () => {
  const run = (slate, pinned, rolls, updated) => ({
    n: slate.length, slate, pinned, rolls, started: "2026-10-12", ...(updated ? { updated } : {}),
  });
  const local = { v: 1, ev: { themes: {
    open: "ports", runs: { cyberpunk: run(["desktop-a", "desktop-b"], ["desktop-a"], 1) },
  } } };
  let remote = { events: { v: 1, ev: { themes: {
    open: "cyberpunk", runs: { cyberpunk: run(["phone-a", "phone-b"], ["phone-a", "phone-b"], 2) },
  } } } };
  const context = themeContext(local, () => remote);
  await vm.runInContext("evLoadPrefs()", context);
  assert.deepEqual(JSON.parse(vm.runInContext(
    "JSON.stringify(evState('themes').runs.cyberpunk)", context)),
    run(["phone-a", "phone-b"], ["phone-a", "phone-b"], 2),
    "a newer legacy server roll replaces the stale desktop run, including pins");
  assert.equal(vm.runInContext("evState('themes').open", context), "ports",
    "the open theme remains device-local");

  remote = { events: { v: 1, ev: { themes: {
    open: "cyberpunk", runs: { cyberpunk: run(["fresh-a", "fresh-b"], ["fresh-b"], 3, 200) },
  } } } };
  await vm.runInContext("evLoadPrefs()", context);
  assert.equal(vm.runInContext("evState('themes').runs.cyberpunk.slate[0]", context), "phone-a",
    "a normal second load remains cached");
  await vm.runInContext("evLoadPrefs(true)", context);
  assert.equal(vm.runInContext("evState('themes').runs.cyberpunk.slate[0]", context), "fresh-a",
    "a forced refresh imports a newer phone run");
  assert.deepEqual(JSON.parse(vm.runInContext(
    "JSON.stringify(evState('themes').runs.cyberpunk.pinned)", context)), ["fresh-b"],
    "forced refresh imports pin removals and additions as part of the run");

  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const writes = [];
  const storage = new Map();
  const queueContext = vm.createContext({
    TAB_RESET: {}, activeTab: "other", IS_ADMIN: true,
    sessionStorage: { getItem: () => null },
    localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    fetch: async (url, options) => {
      if (options?.method === "PUT") {
        writes.push(JSON.parse(options.body));
        if (writes.length === 1) await firstGate;
        return { ok: true };
      }
      return { ok: true, json: async () => ({ prefs: {} }) };
    },
  });
  vm.runInContext(read("events.js"), queueContext);
  vm.runInContext("evState('sample').value = 1", queueContext);
  const firstSave = vm.runInContext("evSave()", queueContext);
  vm.runInContext("evState('sample').value = 2", queueContext);
  const secondSave = vm.runInContext("evSave()", queueContext);
  assert.equal(writes.length, 1, "a second save waits behind the in-flight write");
  releaseFirst();
  await Promise.all([firstSave, secondSave]);
  assert.equal(writes.length, 2, "the queued change is flushed after the first write");
  assert.equal(writes[0].ev.sample.value, 1, "the first body is the roll-time state");
  assert.equal(writes[1].ev.sample.value, 2, "the final body is the newer pin-time state");

  console.log("Theme sync: newer-run merge, forced refresh, and ordered saves passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
