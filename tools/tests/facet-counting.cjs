/* Counts must match the independent per-column definition, including grouping. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let ticks = 0, calls = 0;
const context = {
  matchMedia: () => ({addEventListener() {}}),
  performance: {now: () => ++ticks},
  cachedGameId: row => row.id,
  rowFacetItems: (row, col) => { calls++; return (row[col.key] || []).map(key => ({key})); },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/filters.js', 'utf8'), context);
const cols = ['platform', 'genre', 'owned'].map(key => ({key}));
const rows = Array.from({length: 300}, (_, i) => ({
  id: i % 7 ? Math.floor(i / 3) : null,
  platform: [String(i % 3)], genre: ['a', String(i % 5)], owned: [String(i % 2)],
}));
for (const grouping of [false, true]) {
  for (const selections of [[], [[cols[0], new Set(['1'])]], [[cols[0], new Set(['1'])], [cols[1], new Set(['2'])]], [[cols[2], new Set(['missing'])]]]) {
    context.input = {rows, cols, selections, grouping};
    const iterator = vm.runInContext('countFacetRows(input.rows, input.cols, input.selections, input.grouping)', context);
    let next, yields = 0;
    do {next = iterator.next(); if (!next.done) yields++;} while (!next.done);
    assert.ok(yields > 0, 'large counts yield to input');
    for (const col of cols) {
      const expected = new Map(), seen = new Map();
      for (const row of rows) {
        if (!selections.every(([other, selected]) => other.key === col.key || (row[other.key] || []).some(v => selected.has(v)))) continue;
        for (const value of row[col.key] || []) {
          const ids = seen.get(value) || new Set(); seen.set(value, ids);
          const id = row.id || row;
          if (grouping && ids.has(id)) continue;
          ids.add(id); expected.set(value, (expected.get(value) || 0) + 1);
        }
      }
      assert.equal(JSON.stringify([...next.value.get(col.key)]), JSON.stringify([...expected]));
    }
  }
}
let busy = false;
context.$ = () => ({style: {}, classList: {contains: () => false}, removeAttribute: () => {busy = false;}});
context.tabState = {games: {}}; context.activeTab = 'games';
context.matchMedia = () => ({matches: true});
context.clearTimeout = () => {};
context.setTimeout = () => {throw new Error('closed mobile panel must not schedule work');};
const before = calls;
vm.runInContext('renderFacets()', context);
assert.equal(calls, before);
console.log('Facet counts match reference: selected facets, zero results, grouped copies, yielding, closed mobile panel.');
