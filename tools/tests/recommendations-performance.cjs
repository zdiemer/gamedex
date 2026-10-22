const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const jobs=[], prefs={dismissed:[]};
let ticks=0, scored=0, published=0;
const pool=Array.from({length:300},(_,i)=>({igdbId:i+1,title:'Game '+i,_igdb:{year:2000,genres:['RPG'],userRatingCount:10}}));
const context={
 DATA:{sheets:{games:{rows:[]},completed:{rows:[{rating:.8},{rating:.9}]}}},
 CAT:pool,RECS:{catalogue:[{igdbId:1,score:2,because:['Favorite']}]},_enrichEpoch:1,
 PRED_CACHE:new WeakMap(),ENRICH:{},activeTab:'recs',MIN_HISTORY:2,
 ENRICH_ENABLED:true,ENRICH_READY:true,ENRICH_WAITING:false,
 prefsLocal:key=>prefs[key]||[],prefsSave:(key,value)=>{prefs[key]=value;},
 catFresh:()=>context.CAT.filter(r=>!r.owned),catEnabled:()=>true,
 tasteModel:()=>({ok:true,igdb:{}}),
 predictedCached:row=>{if(!context.PRED_CACHE.has(row)){scored++;context.PRED_CACHE.set(row,{score:row.igdbId/1000,confidence:.8});}return context.PRED_CACHE.get(row);},
 performance:{now:()=>++ticks},scheduler:{postTask:fn=>jobs.push(fn)},setTimeout:fn=>jobs.push(fn),
 resetSearchCache(){},applyDrawerFromURL(){published++;},
 $:()=>({innerHTML:'',querySelector:()=>null}),icon:()=>'',
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('static/recs.js','utf8'),context);
const run=code=>vm.runInContext(code,context);
context.renderAll=()=>{if(context.activeTab==='recs')context.buildRecsSheet(false);};
const flush=()=>{let n=0;while(jobs.length){assert.ok(n++<10000,'work must terminate');jobs.shift()();}};
assert.equal(run('buildRecsSheet(false)'),false);
assert.equal(context.DATA.sheets.recs,undefined,'no partial sheet is published');
const pending=jobs.length;run('buildRecsSheet(false)');assert.equal(jobs.length,pending,'renders share one job');
flush();assert.equal(context.DATA.sheets.recs.rows.length,300);assert.equal(scored,300);assert.equal(published,1);
assert.equal(context.DATA.sheets.recs.rows[0].recScore,.001*1.1);
const sheet=context.DATA.sheets.recs;
assert.equal(run('buildRecsSheet(false)'),true);assert.equal(jobs.length,0);
run('recsDismiss(1)');assert.equal(context.DATA.sheets.recs,sheet,'keep previous sheet until replacement is complete');
flush();assert.equal(scored,300,'dismissal reuses predictions');assert.equal(context.DATA.sheets.recs.rows.length,299);
run('recsUndismissAll()');flush();assert.equal(context.DATA.sheets.recs.rows.length,300);
const before=context.DATA.sheets.recs;
run('buildRecsSheet(true)');context.activeTab='home';flush();assert.equal(context.DATA.sheets.recs,before,'navigation cancels publication');
context.activeTab='recs';run('buildRecsSheet(false)');flush();
run('resetRecs(); buildRecsSheet(false)');jobs.shift()();
context.RECS={catalogue:[{igdbId:1,score:3,because:['New favorite']}]};flush();
assert.equal(context.DATA.sheets.recs.rows[0].because,'New favorite','late recommendation votes invalidate in-flight work');
assert.equal(scored,300,'new votes reuse model predictions');
run('resetRecs(); buildRecsSheet(false)');jobs.shift()();
context.CAT=pool.slice(1);context._enrichEpoch++;context.PRED_CACHE=new WeakMap();
run('resetRecs()');flush();
assert.equal(context.DATA.sheets.recs.rows.length,299);
assert.ok(context.DATA.sheets.recs.rows.every(r=>r._igdbId!==1),'new catalogue/ownership excludes stale candidates');
assert.equal(scored,599,'model invalidation recomputes scores');
let released=0;context.ENRICH_BATCH_DONE=()=>released++;
context.ENRICH_READY=false;
assert.equal(run('recsReady()'),false);assert.equal(context.ENRICH_WAITING,true,'enrichment finally handler can release the gate');
assert.equal(released,1,'opening recommendations releases the delayed enrichment fetch');
console.log('Recommendations: atomic publication, batching, cache reuse, dismiss/undo, cancellation, votes, catalogue/model invalidation and enrichment gate passed.');
