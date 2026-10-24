/* Public primitive contract, consumer compatibility, and offline/load wiring.
   Run from the repository root: node tools/tests/components.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({});
for (const file of ['core', 'components', 'hero']) {
  vm.runInContext(fs.readFileSync(`static/${file}.js`, 'utf8'), ctx);
}
const run = (code) => vm.runInContext(code, ctx);
const unsafe = '<img src=x onerror="alert(1)">&\'';
ctx.unsafe = unsafe;
for (const code of ['chipHtml(unsafe)', 'chips([unsafe])', 'buttonHtml(unsafe)', 'emptyState(unsafe, unsafe, unsafe)']) {
  const html = run(code);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&quot;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&#39;'));
}
assert.equal(run('chipHtml(2026)'), '<span class="chip">2026</span>');
assert.equal(run('chips([])'), '');
assert.equal(run('chips(null)'), '');
assert.equal(run('chipHtml("RPG", {facet:"genre"})'), '<span class="chip facet-link" data-fk="genre" data-fv="RPG">RPG</span>');
assert.ok(run('chipHtml("RPG", {facet:unsafe})').includes('data-fk="&lt;img'));
assert.equal(run('buttonHtml("Save", {disabled:true, variant:"ghost"})'), '<button type="button" class="btn ghost" disabled>Save</button>');
assert.ok(!run('buttonHtml("Save", {disabled:false})').includes(' disabled'));
assert.ok(run('buttonHtml("Save", {id:unsafe, title:unsafe})').includes('id="&lt;img'));
assert.throws(() => run('buttonHtml("Save", {variant:"unsupported"})'), /Unknown button variant/);
assert.throws(() => run('buttonHtml("Save", {variant:"toString"})'), /Unknown button variant/);
assert.ok(run('emptyState("Title", "Hint", "Clear")').includes('id="emptyAction"'));
assert.ok(run('emptyState("Title", "Hint", "Clear", {actionId:"resetSearch"})').includes('id="resetSearch"'));
assert.ok(!run('emptyState("Title", "Hint")').includes('<button'));
// Existing tag overflow and facet hooks survive the shared renderer migration.
const tags = run('tagChipsHtml(Array.from({length:14}, (_,i)=>({x:`Tag ${i}`,fk:"genre"})))');
assert.ok(tags.includes('collapsed'));
assert.ok(tags.includes('+2 more'));
assert.equal((tags.match(/data-fk="genre"/g) || []).length, 14);
const html = fs.readFileSync('static/index.html', 'utf8');
assert.ok(html.indexOf('src="core.js"') < html.indexOf('src="components.js"'));
assert.ok(html.indexOf('src="components.js"') < html.indexOf('src="enrich.js"'));
const sw = fs.readFileSync('static/sw.js', 'utf8');
for (const [, file] of html.matchAll(/<script defer src="([^"]+)"/g)) {
  assert.ok(sw.includes(`"./${file}"`), `${file} must be available offline`);
  assert.ok(fs.existsSync(`static/${file}`));
}
assert.ok(!fs.readFileSync('static/enrich.js', 'utf8').includes('const chips ='));
assert.ok(!fs.readFileSync('static/preview.js', 'utf8').includes('function emptyState('));
console.log('Component escaping, variants, existing consumers, load order, and offline assets passed.');

// Even a previously cached admin response must never bypass server auth.
let fetchHandler;
const requests = [];
const swContext = vm.createContext({
  URL, self: {location:{origin:'https://gamedex.test'}, addEventListener(name, fn) {
    if (name === 'fetch') fetchHandler = fn;
  }},
  fetch(request, options) { requests.push({request, options}); return Promise.resolve({ok:true}); },
  caches: {match() { throw Error('Gallery must not read caches'); }, open() { throw Error('Gallery must not write caches'); }},
});
vm.runInContext(sw, swContext);
for (const path of ['components.html', 'components-gallery.js', '%63omponents.html']) {
  let handled = false;
  fetchHandler({request:{url:`https://gamedex.test/${path}`,method:'GET'}, respondWith() {handled = true;}});
  assert.ok(handled);
  assert.equal(requests.at(-1).options.cache, 'no-store');
  assert.ok(!sw.match(new RegExp(`"\\./${path.replaceAll('.', '\\.') }"`)), 'Gallery must not be precached');
}
console.log('Admin gallery bypasses all service-worker caches.');
