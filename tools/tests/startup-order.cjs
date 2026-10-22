const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/chrome.js', 'utf8');
const start = source.lastIndexOf('document.addEventListener("DOMContentLoaded"');
assert.ok(start >= 0, 'startup must wait for deferred scripts');
assert.doesNotMatch(source.slice(0, start), /^load\(\)/m, 'no eager startup remains');
let callback, options, calls = 0;
const context = {
  document: { addEventListener(event, fn, opts) { assert.equal(event, 'DOMContentLoaded'); callback = fn; options = opts; } },
  load() { calls++; assert.equal(typeof context.resetCollections, 'function'); return Promise.resolve(); },
};
vm.runInNewContext(source.slice(start), context);
assert.equal(calls, 0, 'warm responses cannot trigger startup before dependent scripts');
context.resetCollections = () => {};
callback();
assert.equal(calls, 1);
assert.equal(options.once, true);
console.log('Startup waits for deferred script dependencies before loading data.');

const html = fs.readFileSync('static/index.html', 'utf8');
const headBoot = html.match(/<script>([\s\S]*?)<\/script>/)[1];
for (const tab of ['home', 'games', 'recs']) {
  const requests = [];
  const ctx = {
    URLSearchParams, location: { search: `?tab=${tab}` }, window: {},
    document: { documentElement: { setAttribute() {} } },
    fetch(url, options) { requests.push({url, options}); return Promise.resolve(null); },
  };
  vm.runInNewContext(headBoot, ctx);
  assert.equal(requests.filter(r => r.url === 'api/enrichment/all').length, tab === 'recs' ? 1 : 0);
  assert.equal(requests.filter(r => r.url === 'api/data').length, 1);
  if (tab === 'recs') assert.equal(requests.at(-1).options.priority, 'low');
}
console.log('Only Recommendations prefetches the full map during startup.');
