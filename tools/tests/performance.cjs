const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/performance.js', 'utf8');
function setup(enabled, supported = true) {
  const callbacks = {}, vitals = {}, marks = new Set();
  let now = 0;
  const context = {
    URL, URLSearchParams, Date, JSON, Blob, setTimeout,
    location: { search: enabled ? '?perf=1' : '', href: 'https://example.com/', origin: 'https://example.com' },
    sessionStorage: { getItem() { throw new Error('storage denied'); } },
    performance: {
      now: () => ++now, timeOrigin: 1, getEntriesByType: () => [],
      mark: id => marks.add(id), measure() {}, clearMarks: id => marks.delete(id), clearMeasures() {},
    },
    webVitals: Object.fromEntries(['CLS', 'FCP', 'INP', 'LCP', 'TTFB'].map(n => [`on${n}`, cb => { vitals[n] = cb; }])),
  };
  if (supported) context.PerformanceObserver = class {
    constructor(cb) { this.cb = cb; }
    observe({ type }) { callbacks[type] = entries => this.cb({ getEntries: () => entries }); }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { perf: context.gamedexPerf, callbacks, vitals, marks };
}
const { perf, callbacks, vitals, marks } = setup(true);
perf.page('games');
for (let i = 0; i < 550; i++) { const end = perf.start('render'); end(); end(); }
assert.equal(perf.snapshot().spans.length, 500);
assert.equal(marks.size, 0);
assert.equal(perf.snapshot().spans[0].page, 'games');
callbacks.resource([{ name: 'https://example.com/api/detail?secret=foo', initiatorType: 'fetch', startTime: 1, duration: 2, responseStart: 2, serverTiming: [] }]);
assert.equal(perf.snapshot().resources[0].name, '/api/detail');
assert.ok(!JSON.stringify(perf.snapshot()).includes('secret'));
vitals.CLS({ value: 0.12, rating: 'needs-improvement', id: 'one', navigationType: 'navigate' });
vitals.CLS({ value: 0.18, rating: 'needs-improvement', id: 'one', navigationType: 'navigate' });
assert.equal(perf.snapshot().vitals.CLS.value, 0.18);
const copy = perf.snapshot(); copy.spans.length = 0;
assert.equal(perf.snapshot().spans.length, 500);
const disabled = setup(false);
disabled.perf.start('test')();
assert.equal(disabled.perf.snapshot().spans.length, 0);
assert.deepEqual(Object.keys(disabled.callbacks), []);
assert.doesNotThrow(() => setup(true, false));
console.log('performance diagnostics: passed');
