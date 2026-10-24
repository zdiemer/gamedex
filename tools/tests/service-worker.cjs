/* Shell installation must be all-or-nothing and active releases immutable. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('static/sw.js','utf8');
function worker({failInstall=false}={}){
 const handlers={},state={skips:0,fetches:0,matches:[],requests:[]};
 const context={URL,Request,Response,Set,console,
  self:{location:{origin:'https://gamedex.test',href:'https://gamedex.test/sw.js'},
   addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:()=>state.skips++,clients:{claim(){}}},
  caches:{open:async name=>({
   addAll:async requests=>{state.requests=requests;if(failInstall)throw Error('Missing runtime asset');},
   match:async url=>{state.matches.push({name,url});return new Response('installed release');},
   put(){throw Error('Active shell must never be rewritten');},
  }),match(){throw Error('Shell must not search older release caches');}},
  fetch:async()=>{state.fetches++;return new Response('next release');},
 };
 vm.runInNewContext(source,context);
 return {handlers,state};
}
(async()=>{
 let pending;
 const failed=worker({failInstall:true});
 failed.handlers.install({waitUntil(p){pending=p;}});
 await assert.rejects(pending,/Missing runtime asset/);
 assert.equal(failed.state.skips,0,'An incomplete shell must not take control');
 const good=worker();good.handlers.install({waitUntil(p){pending=p;}});await pending;
 assert.equal(good.state.skips,1);assert.ok(good.state.requests.length>100);
 assert.ok(good.state.requests.every(r=>r.cache==='reload'));
 for(const pathname of ['/?tab=games','/index.html?tab=themes','/components/controls/pager.js?cachebust=1']){
  good.handlers.fetch({request:new Request('https://gamedex.test'+pathname),respondWith(p){pending=p;}});
  assert.equal(await (await pending).text(),'installed release');
 }
 assert.deepEqual(good.state.matches.map(x=>x.url),[
  'https://gamedex.test/index.html','https://gamedex.test/index.html','https://gamedex.test/components/controls/pager.js']);
 assert.ok(good.state.matches.every(x=>x.name.startsWith('gamedex-shell-')));
 assert.equal(good.state.fetches,0);
 console.log('Service worker: atomic install failure, cache bypass, release isolation and SPA route normalization passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
