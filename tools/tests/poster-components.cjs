const { readAppSource } = require('./app-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = vm.createContext({
 window: {addEventListener() {}},
 ENRICH: {test:{cover:'cover".jpg',pixel:true}},
 coverSrc: e => e?.cover || '', coverIsPixelArt: e => !!e?.pixel,
});
for (const file of ['core','components','components/poster-card','table']) vm.runInContext(readAppSource(`static/${file}.js`,'utf8'),ctx);
ctx.row = {_k:'test',title:'<Game>',platform:'A&B',releaseYear:2026,vr:true};
const run = code => vm.runInContext(code,ctx);
let html = run('posterCardHtml(row, {note:"<em>Recommended</em>",attrs:\'data-game="1"\'})');
assert.match(html,/type="button"/);
assert.match(html,/card-cover pixel/);
assert.match(html,/cover&quot;\.jpg/);
assert.match(html,/vr-badge/);
assert.match(html,/&lt;Game&gt;/);
assert.match(html,/A&amp;B · 2026/);
assert.match(html,/<em>Recommended<\/em>/);
assert.match(html,/data-game="1"/);
ctx.row = {game:'Fallback'};
assert.match(run('posterCardHtml(row)'),/Fallback/);
html = run('posterContentHtml(row, "body", {pending:true})');
assert.match(html,/card-cover ph skel/);
assert.doesNotMatch(html,/#i-library/);
assert.match(run('posterContentHtml(row, "body")'),/#i-library/);
assert.match(run('posterSummaryHtml(row,{afterHtml:\'<div class="s-chips">Owned</div>\'})'),/s-chips/);
assert.doesNotMatch(readAppSource('static/search.js','utf8'),/class="card-cover/);
console.log('Shared posters preserve covers, skeletons, VR, escaped metadata, and feature content.');
// Picker/randomizer pass their resolved record and retain eager cover loading.
html=run('posterContentHtml(row,"body",{enrichment:{cover:"fallback.jpg",pixel:true},eager:true})');
assert.match(html,/card-cover pixel/);
assert.match(html,/fallback.jpg/);
assert.doesNotMatch(html,/loading="lazy"/);
ctx.collectionStatus=()=> 'partial'; ctx.rowCompleted=()=>true;
assert.equal(run('posterClassName(row)'), 'card partial');
ctx.collectionStatus=()=> 'complete'; ctx.rowCompleted=()=>false;
assert.equal(run('posterClassName(row)'), 'card done');
ctx.collectionStatus=()=>null;
assert.equal(run('posterClassName(row)'), 'card');
ctx.rowCompleted=()=>true;
assert.equal(run('posterClassName(row)'), 'card done');
