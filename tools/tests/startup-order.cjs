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
