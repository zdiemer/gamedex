const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rows = [];
const add = (title, platform, extra = {}) => {
  const row = { _k: `${title}|${platform}`, title, platform, genre: 'Common', playable: 'Yes', ...extra };
  rows.push(row);
  return row;
};
for (let i = 0; i < 100; i++) add(`Game ${i}`, 'Large');
for (let i = 0; i < 99; i++) add(`Small ${i}`, 'Small');
rows[0].genre = 'Rhythm';
rows[1].developer = 'Popular';
rows[2].franchise = 'Famous';
rows[3].developer = 'Obscure';
rows[4].genre = 'Contested';
rows[5].genre = 'Contested'; rows[5].completed = true; rows[5].playable = 'No';
rows[6].genre = 'Unknown';
rows[100].genre = 'Rare';
for (let i = 0; i < 9; i++) add(`Other ${i}`, 'Other', { developer: 'Popular', franchise: 'Famous' });
// Regional/physical copies must neither destroy uniqueness nor inflate popularity.
add('Game 0', 'Large', { _k: 'duplicate', genre: 'Rhythm' });
for (let i = 0; i < 12; i++) add('Game 3', 'Large', { _k: `copy-${i}`, developer: 'Obscure' });
const context = vm.createContext({
  TAB_RESET: {}, sessionStorage: { getItem: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  _enrichEpoch: 0, DATA: { sheets: { games: { rows } } }, ENRICH: {},
  unifiedGenreVals: r => [r.genre], unifiedDevVals: r => [r.developer],
  unifiedFranchiseVals: r => [r.franchise],
});
for (const file of ['events.js', 'themes.js']) vm.runInContext(
  fs.readFileSync(path.join(__dirname, '../../static', file), 'utf8'), context);
const match = row => { context.row = row; return vm.runInContext('THM_BY_ID.oneandonly.match(row)', context); };
assert.equal(match(rows[0]), true, '100 distinct platform games qualifies; copies count once');
assert.equal(match(rows[1]), true, 'developer with ten distinct games qualifies');
assert.equal(match(rows[2]), true, 'franchise with ten distinct games qualifies');
assert.equal(match(rows[3]), false, 'copies do not make an obscure studio popular');
assert.equal(match(rows[4]), false, 'completed and unplayable competitors still count');
assert.equal(match(rows[6]), false, 'unknown category is not evidence');
assert.equal(match(rows[100]), false, '99-game platform is too small');
rows[7].genre = 'Rhythm';
vm.runInContext('_enrichEpoch++', context);
assert.equal(match(rows[0]), false, 'metadata refresh invalidates uniqueness');
context.DATA.sheets.games.rows = rows.filter(r => r !== rows[7]);
assert.equal(match(rows[1]), false, 'row replacement rebuilds platform size below 100');
console.log('One and Only: size, popularity, copies, competitors, and invalidation passed');
