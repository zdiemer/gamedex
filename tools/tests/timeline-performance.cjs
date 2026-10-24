const { readAppSource } = require('./app-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const jobs = [], observers = [];
let slots = [];
const host = {
  hidden:false,
  set innerHTML(html) {
    this.html = html;
    slots = [...html.matchAll(/data-tbatch="(\d+)"/g)].map(m => ({
      dataset:{tbatch:m[1]}, innerHTML:'', loaded:false, contains:()=>false,
      classList:{add(){slots[+m[1]].loaded=true;}}, querySelectorAll:()=>[],
    }));
  },
  querySelector: selector => slots[+(selector.match(/data-tbatch="(\d+)"/) || [])[1]] || null,
  querySelectorAll: selector => selector.startsWith('.tl-batch') ? slots.filter(s=>!s.loaded) : [],
};
const context = {
  activeTab:'completed', $:()=>host, ENRICH:{}, document:{activeElement:null},
  scheduler:{postTask:fn=>jobs.push(fn)},
  IntersectionObserver:class {
    constructor(callback){this.callback=callback;observers.push(this);}
    observe(){} unobserve(){} disconnect(){this.disconnected=true;}
  },
  effectiveSort:()=>[{key:'date',type:'date',dir:'desc'}],
  cmpBy:(a,b)=>b.date.localeCompare(a.date),
  coverSrc:()=>'', escapeHtml:String, icon:()=>'', ratingClass:()=>'', fmtHours:String,
  emptyState:()=>'<p>Nothing to show</p>',
};
context.window=context;
vm.createContext(context);
vm.runInContext(readAppSource('static/timeline.js','utf8'),context);
const run = s=>vm.runInContext(s,context);
for(const value of ['2024-02-29','2025-01-01','2025-99-99','unknown','']) {
  context.date=value;
  const expected=/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value+'T00:00:00').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : value;
  assert.equal(run('tlDate(date)'),expected);
}
context.rows=Array.from({length:30},(_,i)=>({_k:String(i),game:'Game '+i,date:'2025-01-01',notes:'A review'}));
run('renderTimeline(rows)');
assert.equal(slots.length,3);
assert.equal(slots[0].loaded,true);
assert.equal(slots[1].innerHTML,'','offscreen entries are not built');
const observer=observers.at(-1);
observer.callback([{isIntersecting:true,target:slots[1]}]);
assert.equal(slots[1].innerHTML,'','intersection work yields before rendering');
jobs.shift()();
assert.ok(slots[1].innerHTML.includes('data-ti="12"'));
assert.ok(slots[1].innerHTML.includes('data-ti="23"'));
observer.callback([{isIntersecting:true,target:slots[2]}]);
run('renderTimeline([])');
while(jobs.length)jobs.shift()();
assert.equal(host.html,'<p>Nothing to show</p>','old queued work cannot replace empty filtered state');
assert.equal(observer.disconnected,true);
run('renderTimeline(rows); disposeTimeline()');
assert.equal(observers.at(-1).disconnected,true,'leaving a view disconnects loaders');
console.log('Timeline: date formatting, deferred batches, row indices, stale work and observer cleanup passed.');
