const { readAppSource } = require('./app-source.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const rows = [
  {title:'Later', _k:'a', platform:'PC', releaseYear:2005, completed:true, owned:true, rating:0.9, purchasePrice:10},
  {title:'Earlier copy', _k:'b', platform:'PC', releaseYear:2000, owned:true, alt:true},
  {title:'Next', _k:'c', platform:'PC', releaseYear:2002, owned:true},
  {title:'Singleton', _k:'d', platform:'PS', releaseYear:2001},
];
let historyCalls=0, relationCalls=0;
const context = {
  DATA:{sheets:{games:{rows}}}, ENRICH:{}, TAB_RESET:{}, activeTab:'groups',
  unifiedFranchiseVals: () => ['Series'], unifiedDevVals: () => ['Studio', 'Other'],
  unifiedPubVals: () => [], unifiedGenreVals: () => ['Genre'],
  historyOf: () => {historyCalls++;return {playTime:12};},
  alreadyPlayed: r => {relationCalls++;return r.alt ? {game:rows[0],how:'copy'} : null;},
  criticOf: () => 0.8, playtimeOf: () => 5, isCandidate: r => r.owned,
};
vm.createContext(context);
vm.runInContext(readAppSource('static/groups.js','utf8'), context);
const run = code => vm.runInContext(code, context);
const plain = value => JSON.parse(JSON.stringify(value));
assert.deepEqual(plain(run('groupMembers("platform").map(s=>[s.name,s.size,s.done,s.owned])')), [['PC',3,1,3],['PS',1,0,0]]);
run('GROUPINGS.forEach(g=>groupMembers(g.id)); grGroups("platform").sort(GROUP_SORTS.size.cmp)');
assert.equal(historyCalls,0,'overview and size sort do not join play history');
assert.equal(relationCalls,0,'overview and size sort do not build play-next choices');
assert.equal(run('grGroups("platform").length'),1,'singletons stay off the index');
assert.equal(run('groupIndex("platform").length'),2,'singletons remain directly reachable');
assert.deepEqual(plain(run('groupIndex("platform")[0].games.map(r=>r._k)')),['b','c','a']);
assert.equal(run('groupIndex("platform")[0].avgRating'),0.9);
assert.equal(run('groupIndex("platform")[0].played'),12);
assert.equal(run('groupIndex("platform")[0].left'),10);
assert.equal(run('groupIndex("platform")[0].spent'),10);
assert.equal(historyCalls,1,'aggregates are reused');
assert.equal(relationCalls,0,'cards do not evaluate play-next relations');
assert.equal(run('groupIndex("platform")[0].next._k'),'c');
assert.equal(run('groupIndex("platform")[0].skipped.game._k'),'b');
const calls=relationCalls;
run('groupIndex("platform")[0].allPlayed');
assert.equal(relationCalls,calls,'next-game result is reused');
rows.push({title:'New', _k:'e', platform:'PC',completed:true,rating:0.5});
run('resetGroups()');
assert.equal(run('groupMembers("platform")[0].size'),4);
assert.equal(run('groupIndex("platform")[0].avgRating'),0.7);
console.log('Collections: lightweight overview, lazy statistics/play-next, release order, singletons and reset passed.');
