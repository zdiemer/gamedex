/* Render-path check for static/edits.js.

   The write surfaces are ~500 lines of template literal, and the failure mode they
   have is not a wrong pixel: `escapeHtml` calls `.replace` on its argument, so
   handing it a number throws, and a throw part-way through building innerHTML
   leaves the skeleton that was there before it on screen FOREVER. It reads as a
   hang rather than an error — which is exactly how the IGDB search shipped in
   1.75.0 (`r.year` is a number).

   Half the values on these screens are numbers off the API — a release year, a
   price, a rating, an IGDB id — so this renders all three surfaces with
   API-shaped data, numbers as numbers, and fails if anything throws or if a
   value doesn't make it into the markup.

   The DOM is a stub, not jsdom (no npm in this pod). Elements record what is
   assigned to their innerHTML and return the SAME stub for a given selector, so
   the test can read back what each surface rendered and can pre-seed the handful
   of properties the code reads before it writes (an input's value, the node lists
   it wires handlers onto). That is enough to execute every template literal,
   which is the whole point.

   Run:  node tools/tests/edits-render.cjs
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let PRESEED = {};

function makeEl(sel = '') {
  const el = {
    sel, innerHTML: '', textContent: '', value: '', hidden: false, disabled: false,
    checked: false, open: false, dataset: {}, children: [], _kids: new Map(), _all: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c) { el.children.push(c); return c; },
    removeChild() {}, remove() {}, focus() {}, blur() {},
    setAttribute() {}, getAttribute: () => null, closest: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector(s) {
      if (!el._kids.has(s)) {
        const kid = makeEl(s);
        Object.assign(kid, PRESEED[s] || {});
        el._kids.set(s, kid);
      }
      return el._kids.get(s);
    },
    querySelectorAll(s) { return el._all[s] || []; },
  };
  Object.assign(el, PRESEED[sel] || {});
  return el;
}

function makeDoc() {
  const body = makeEl('body');
  const doc = {
    body, created: [],
    createElement(tag) { const e = makeEl(tag); e.tag = tag; doc.created.push(e); return e; },
    querySelector(s) { return body.querySelector(s); },
    querySelectorAll(s) { return body.querySelectorAll(s); },
    addEventListener() {}, removeEventListener() {},
    documentElement: makeEl('html'),
  };
  return doc;
}

// Numbers as numbers, exactly as /api/data serves them.
const SHEET = {
  meta: { edits: { fields: 2, conflicts: 1, orphans: 0, added: 1 } },
  sheets: {
    games: {
      columns: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'platform', label: 'Platform', type: 'text' },
        { key: 'rating', label: 'Rating', type: 'rating' },
        { key: 'playingStatus', label: 'Playing Status', type: 'text' },
        { key: 'purchasePrice', label: 'Purchase Price', type: 'money' },
        { key: 'completionTime', label: 'Completion Time', type: 'hours' },
      ],
      rows: [
        { _k: 'k1', title: 'Chrono Trigger', platform: 'SNES', releaseYear: 1995,
          genre: 'RPG', format: 'Cartridge', condition: 'Complete', releaseRegion: 'NA',
          rating: 0.95, purchasePrice: 120.5, franchise: 'Chrono',
          publisher: 'Square', developer: 'Square' },
        { _k: 'k2', title: 'Wall World', platform: 'PC', releaseYear: 2023 },
        { _rowId: 'add:abc', _added: true, _k: 'k3', title: 'Tempest 2000',
          platform: 'Atari Jaguar', releaseYear: 1994 },
      ],
    },
    completed: { columns: [{ key: 'game', label: 'Game', type: 'text' }], rows: [] },
    onOrder: { columns: [], rows: [] },
  },
};

function load(extra = {}) {
  const document = makeDoc();
  const ctx = vm.createContext({
    document, window: {}, console, setTimeout, clearTimeout, Promise,
    Math, Date, JSON, String, Number, Boolean, Object, Array, Set, Map,
    isFinite, parseInt, encodeURIComponent,
    // The globals edits.js shares with the rest of static/ (core.js, enrich.js).
    escapeHtml: (s) => s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    icon: (id, size) => `<svg data-i="${id}" width="${size || 16}"></svg>`,
    fmtDate: (iso) => String(iso),
    fmtCell: (v) => (v === null || v === undefined ? '—' : String(v)),
    IMG: (id, size) => (id ? `/api/img?u=${id}-${size}` : ''),
    IS_ADMIN: true, drawerSheet: 'games',
    showToast: () => {}, renderAll: () => {}, syncScrollLock: () => {},
    setNav: () => {}, openDrawer: () => {}, closeDrawer: () => {}, confirm: () => true,
    DATA: JSON.parse(JSON.stringify(SHEET)),
    ...extra,
  });
  vm.runInContext(fs.readFileSync(
    path.join(__dirname, '../../static/edits.js'), 'utf8'), ctx);
  return { ctx, document };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const ok = (s) => process.stdout.write(`  ok   ${s}\n`);

(async () => {
  // ---- 1. the drawer's quick-log strip ----------------------------------
  {
    PRESEED = {};
    const { ctx } = load();
    const quick = vm.runInContext('editsQuickHtml', ctx);
    const html = quick({
      _k: 'k1', title: 'Chrono Trigger', platform: 'SNES', releaseYear: 1995,
      rating: 0.95, completionTime: 24.5, owned: true, completed: false,
      dateStarted: '2026-01-02', priority: 'Must Play', _edited: ['rating'],
    });
    assert.ok(html.includes('Quick log'), 'renders the strip');
    assert.ok(html.includes('95'), 'numeric rating rendered as a percent');
    assert.ok(html.includes('24.5'), 'numeric hours rendered');
    assert.ok(html.includes('ql-dot'), 'the staged-value dot marks the edited cell');
    assert.ok(html.includes('data-ql-toggle="owned"'), 'the owned toggle is there');
    ok('quick log renders with a numeric rating and hours');

    assert.ok(quick({ _k: 'k2', title: 'X', platform: 'PC' }).includes('Quick log'));
    ok('quick log renders for a row with nothing filled in');

    assert.equal(quick({ _k: 'k', _collection: true }), '');
    assert.equal(quick({ _k: 'k', _wlOnly: true }), '');
    assert.equal(quick({ title: 'no key' }), '');
    assert.ok(quick({ _k: 'k', _members: [1, 2] }).includes('Open a single copy'));
    ok('quick log is gated off grouped / wishlist / collection / keyless rows');

    const staged = quick({ _k: 'k3', title: 'Tempest 2000', platform: 'Atari Jaguar',
                           _rowId: 'add:abc', _added: true });
    assert.ok(staged.includes('data-ql-unadd="add:abc"'), 'staged rows offer a discard');
    ok('quick log on a staged row offers to discard it');
  }

  // ---- 2. "Add a game" — the result list and the form ------------------
  {
    // The exact shape /api/igdb/search returns. `year` and `igdbId` are numbers and
    // `status` is null for a released game: this is the payload that shipped broken.
    const payload = {
      query: 'wall world 2',
      results: [{
        igdbId: 325123, name: 'Wall World 2', url: 'https://www.igdb.com/games/wall-world-2',
        cover: 'co7abc', year: 2025, status: 'Early Access', summary: 'Mine, fight, repeat.',
        platforms: [{ igdb: 'PC (Microsoft Windows)', sheet: 'PC' },
                    { igdb: 'Nintendo Switch', sheet: 'Nintendo Switch' }],
        fields: { title: 'Wall World 2', releaseDate: '2025-06-11', releaseYear: 2025,
                  genre: 'Indie', publisher: 'Alawar', developer: 'Alawar' },
      }, {
        // Everything optional missing, including the cover and the platform mapping.
        igdbId: 999, name: 'Wall World', cover: null, year: null, status: null,
        summary: null, platforms: [{ igdb: 'Oculus Quest 2', sheet: null }],
        fields: { title: 'Wall World' },
      }],
    };
    const hits = [makeEl('hit0'), makeEl('hit1')];
    hits[0].dataset = { i: '0' };
    hits[1].dataset = { i: '1' };
    // What the code reads before it writes: the query box's value, and the node
    // list it wires the result clicks onto.
    PRESEED = {
      '#agQ': { value: 'wall world 2' },
      '#agResults': { _all: { '.ed-hit': hits } },
    };
    const posted = [];
    const { ctx } = load({
      fetch: async (url, opts) => {
        if (opts && opts.method === 'POST') {
          posted.push(JSON.parse(opts.body));
          return { ok: true, status: 200, json: async () => ({
            ok: true, rowId: 'add:new1', matchKey: 'wallworld2|pc|2025',
            fields: { title: 'Wall World 2', platform: 'PC', releaseYear: 2025 },
            igdbPinned: true, counts: { fields: 0, conflicts: 0, orphans: 0, added: 1 },
          }) };
        }
        return { ok: true, status: 200, json: async () => payload };
      },
    });

    vm.runInContext('openAddGame', ctx)('wall world 2');
    await flush();

    const scrim = vm.runInContext('document.created', ctx).at(-1);
    const edBody = scrim.querySelector('.ed-body');
    const results = edBody.querySelector('#agResults');
    assert.ok(!results.innerHTML.includes('skel'),
      'THE BUG: the skeleton is still on screen — the result list threw while rendering');
    assert.ok(results.innerHTML.includes('Wall World 2'), 'the hit is listed');
    assert.ok(results.innerHTML.includes('2025'), 'the numeric year is rendered');
    assert.ok(results.innerHTML.includes('Early Access'), 'the release status is rendered');
    assert.ok(results.innerHTML.includes('/api/img?u=co7abc'), 'the cover goes through the proxy');
    assert.ok(results.innerHTML.includes('ed-nocover'), 'the coverless hit gets a placeholder');
    ok('IGDB results render — numeric year, status, cover and a bare candidate');

    // Clicking a hit builds the form, which interpolates numbers of its own.
    assert.equal(typeof hits[0].onclick, 'function', 'the hits got click handlers');
    hits[0].onclick();
    const form = edBody.querySelector('#agForm');
    assert.ok(form.innerHTML.includes('Wall World 2'), 'the form is titled with the pick');
    assert.ok(form.innerHTML.includes('value="2025"'), 'the numeric year reaches the field');
    assert.ok(form.innerHTML.includes('2025-06-11'), 'the release date is prefilled');
    assert.ok(form.innerHTML.includes('Indie'), 'the genre is prefilled from IGDB');
    assert.ok(form.innerHTML.includes('Alawar'), 'publisher/developer are prefilled');
    assert.ok(form.innerHTML.includes('325123'), 'the IGDB id is shown');
    assert.ok(form.innerHTML.includes('<option>Cartridge</option>')
      || form.innerHTML.includes('value="Cartridge"'), "the sheet's own format vocabulary is offered");
    ok('the add form renders with IGDB values prefilled');

    // And the bare candidate, where every optional field is null.
    hits[1].onclick();
    assert.ok(form.innerHTML.includes('Wall World'), 'the bare candidate renders too');
    assert.ok(form.innerHTML.includes('no IGDB match') === false, 'it still has an IGDB id');
    ok('the add form renders a candidate with no year, cover or platform mapping');

    // Saving: the form reads its inputs, so seed the two that matter.
    const platInput = form.querySelector('[name="platform"]');
    platInput.value = 'PC';
    form.querySelector('[name="title"]').value = 'Wall World 2';
    form.querySelector('#agSave').onclick();
    await flush();
    assert.equal(posted.length, 1, 'the add was posted');
    assert.equal(posted[0].platform, 'PC');
    assert.equal(posted[0].igdbId, 999, 'it posts the candidate that is selected');
    ok('saving posts the chosen platform and IGDB id');
  }

  // ---- 3. "Add a game" with no IGDB hits ------------------------------
  {
    PRESEED = { '#agQ': { value: 'zzzznothing' } };
    const { ctx } = load({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ query: 'z', results: [] }) }),
    });
    vm.runInContext('openAddGame', ctx)('zzzznothing');
    await flush();
    const edBody = vm.runInContext('document.created', ctx).at(-1).querySelector('.ed-body');
    const results = edBody.querySelector('#agResults');
    assert.ok(results.innerHTML.includes('add it by hand'), 'offers the manual path');
    assert.ok(!results.innerHTML.includes('skel'), 'the skeleton is cleared');
    ok('an empty IGDB search offers to add the game by hand');
  }

  // ---- 4. a failed search must say so, not sit on the skeleton --------
  {
    PRESEED = { '#agQ': { value: 'anything' } };
    const { ctx } = load({ fetch: async () => { throw new Error('offline'); } });
    vm.runInContext('openAddGame', ctx)('anything');
    await flush();
    const edBody = vm.runInContext('document.created', ctx).at(-1).querySelector('.ed-body');
    assert.ok(edBody.querySelector('#agResults').innerHTML.includes('offline'),
      'the error is shown where the skeleton was');
    ok('a failed search replaces the skeleton with the error');
  }

  // ---- 5. the pending-edits list --------------------------------------
  {
    // Values of every type the sheet has, as the API serves them.
    const pending = {
      counts: { fields: 3, conflicts: 1, orphans: 1, added: 1 },
      fields: [
        { sheet: 'games', matchKey: 'k1', column: 'rating', value: 0.95, base: 0.8,
          state: 'pending', sheetValue: null, sheetCode: null, updatedAt: '2026-10-03T18:00:00+00:00' },
        { sheet: 'games', matchKey: 'k1', column: 'playingStatus', value: 'Playing', base: null,
          state: 'conflict', sheetValue: 'On Hold', sheetCode: '1', updatedAt: '2026-10-03T18:01:00+00:00' },
        { sheet: 'games', matchKey: 'gone', column: 'purchasePrice', value: 40, base: null,
          state: 'orphan', sheetValue: null, sheetCode: null, updatedAt: '2026-10-03T18:02:00+00:00' },
      ],
      added: [{ rowId: 'add:abc', sheet: 'games', igdbId: 1671,
                fields: { title: 'Tempest 2000', platform: 'Atari Jaguar', releaseYear: 1994 },
                createdAt: '2026-10-03T18:03:00+00:00', retiredAt: null }],
    };
    const pendRows = [makeEl('p0'), makeEl('p1'), makeEl('p2')];
    pendRows.forEach((r, i) => { r.dataset = { sheet: 'games', key: pending.fields[i].matchKey,
                                               col: pending.fields[i].column }; });
    const addedRows = [makeEl('a0')];
    addedRows[0].dataset = { row: 'add:abc' };
    PRESEED = { '.ed-body': { _all: {
      '.ed-pend[data-col]': pendRows, '.ed-pend[data-row]': addedRows } } };
    const { ctx } = load({
      fetch: async () => ({ ok: true, status: 200, json: async () => pending }),
    });
    vm.runInContext('openPendingEdits', ctx)();
    await flush();
    const edBody = vm.runInContext('document.created', ctx).at(-1).querySelector('.ed-body');
    const h = edBody.innerHTML;
    assert.ok(!h.includes('Loading…'), 'the loading line was replaced');
    assert.ok(h.includes('Conflicts'), 'the conflict section renders');
    assert.ok(h.includes('On Hold'), "the sheet's conflicting value is shown");
    assert.ok(h.includes('0.95'), 'a numeric staged value renders');
    assert.ok(h.includes('40'), 'a numeric orphaned value renders');
    assert.ok(h.includes('type <b>1</b>'), 'the Excel code to type is shown');
    assert.ok(h.includes('Chrono Trigger'), 'the row is named from the dataset');
    assert.ok(h.includes('Orphans'), 'the orphan section renders');
    assert.ok(h.includes('Tempest 2000') && h.includes('IGDB 1671'), 'the added row renders');
    ok('the pending list renders conflicts, orphans, numbers and added rows');

    assert.equal(typeof pendRows[0].querySelector('[data-drop]').onclick, 'function');
    assert.equal(typeof pendRows[1].querySelector('[data-keep]').onclick, 'function');
    assert.equal(typeof addedRows[0].querySelector('[data-unadd]').onclick, 'function');
    ok('the pending list wires its discard / keep-mine / unadd actions');
  }

  // ---- 6. nothing staged ----------------------------------------------
  {
    PRESEED = {};
    const { ctx } = load({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({
        counts: { fields: 0, conflicts: 0, orphans: 0, added: 0 }, fields: [], added: [] }) }),
    });
    vm.runInContext('openPendingEdits', ctx)();
    await flush();
    const edBody = vm.runInContext('document.created', ctx).at(-1).querySelector('.ed-body');
    assert.ok(edBody.innerHTML.includes('Nothing staged'), 'says so plainly');
    ok('an empty pending list says everything matches the spreadsheet');
  }

  process.stdout.write('\nall render checks passed\n');
})().catch((err) => {
  process.stdout.write(`\nFAILED: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
