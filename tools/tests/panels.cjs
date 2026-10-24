/* One panel renderer must preserve source availability, fallback and escaping rules. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { readAppSource } = require('./app-source.cjs');
const context = vm.createContext({
 drawerRow:null, ADBC:{}, COOPC:{}, GEC:{}, GDC:{}, PCGWC:{}, MANC:{}, GTDBC:{},
 VGC:{}, SRC:{}, SXC:{}, THC:{}, VNC:{}, WDC:{},
 quantityFromNotes:()=>1, criticOf:()=>null,
});
for(const file of ['core.js','components/panels/panel.js','components/panels/sources.js'])
 vm.runInContext(readAppSource('static/'+file,'utf8'),context);
const run=code=>vm.runInContext(code,context);
assert.equal(run('panelHtml(null)'), '');
assert.equal(run('panelHtml({bodyHtml:"<b>Score</b>"})'),'<div class="hltb"><b>Score</b></div>');
assert.throws(()=>run('sourcePanelHtml("unknown", "absent")'),/Unknown panel/);
for(const source of run('Object.keys(SOURCE_PANEL_DATA)'))
 assert.equal(run('sourcePanelHtml('+JSON.stringify(source)+', '+(source==='hltb'?'null':'"absent"')+')'),'',source+' hides absent data');
context.drawerRow={estimatedTime:0};
assert.match(run('sourcePanelHtml("hltb",null)'),/Estimated \(from sheet\).*0m/);
context.GEC.demo={priceLoose:0,url:'https://example.com/?q="<unsafe>'};
assert.match(run('sourcePanelHtml("gameye","demo")'),/\$0\.00/);
assert.doesNotMatch(run('sourcePanelHtml("gameye","demo")'),/<unsafe>/);
context.VNC.demo={description:'<script>unsafe</script>'};
assert.match(run('sourcePanelHtml("vndb","demo")'),/&lt;script&gt;/);
assert.doesNotMatch(run('sourcePanelHtml("vndb","demo")'),/<script>/);
context.unsafeClass='"><unsafe>';
assert.match(run('panelRowHtml({labelHtml:"Label",valueHtml:"Value",valueClass:unsafeClass})'),/&quot;&gt;&lt;unsafe&gt;/);
console.log('Generic panel: all source variants, missing data, zero values, fallback and escaping passed.');
// Feature classes and data hooks remain attributes even with hostile values.
context.unsafe='"\'><unsafe>&';
const feature=run('panelHtml({className:unsafe, data:{"wl-appids":unsafe}, headingHtml:"Heading", bodyHtml:"Body"})');
assert.match(feature,/data-wl-appids="&quot;&#39;&gt;&lt;unsafe&gt;&amp;"/);
assert.doesNotMatch(feature,/<unsafe>/);
assert.throws(()=>run('panelHtml({data:{"x onclick":"bad"}})'),/Invalid panel data key/);
