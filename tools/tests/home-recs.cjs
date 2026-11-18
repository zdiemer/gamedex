const { readAppSource } = require('./app-source.cjs');
/* Home's rec shelves skip games already beaten in another version: an IGDB version
   family, or a trailing edition suffix (Royal, Remastered…). Same-name reboots survive. */
const vm = require('node:vm'); const assert = require('node:assert/strict');
const ctx = { TAB_RESET: {}, _enrichEpoch: 0, ENRICH: {}, activeTab: 'x', window: {}, document: {} };
ctx.DATA = { sheets: {
  games: { rows: [
    { title: 'Persona 5 Royal', releaseYear: 2019, _k: 'a' },
    { title: 'Doom', releaseYear: 2016, _k: 'b' },
    { title: 'Chrono Trigger', releaseYear: 2008, _k: 'c' },
    { title: 'Hades', releaseYear: 2020, _k: 'd' },
    { title: 'Resident Evil 4', releaseYear: 2023, _k: 'e' },
  ] },
  completed: { rows: [
    { game: 'Persona 5', releaseYear: 2016 }, { game: 'Doom', releaseYear: 1993 },
    { game: 'Chrono Trigger', releaseYear: 2008 },
  ] } } };
vm.createContext(ctx);
for (const f of ['relations', 'challenges', 'home']) vm.runInContext(readAppSource(`static/${f}.js`), ctx);
ctx.alreadyPlayed = (r) => r._k === 'e' ? { how: 'version' } : null;
const got = vm.runInContext('hRows().filter(homePlayedElsewhere).map(r => r.title)', ctx);
assert.deepEqual(got, ['Persona 5 Royal', 'Chrono Trigger', 'Resident Evil 4']);
console.log('ok', got);
