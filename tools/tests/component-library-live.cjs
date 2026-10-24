/* Optional integration check against the working-tree static/API proxy.
   GAMEDEX_UI_URL=http://127.0.0.1:18092 node tools/tests/component-library-live.cjs
   Uses read-only game listing/detail requests; requires a nonempty library. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  assert.ok(process.env.GAMEDEX_UI_URL, 'Set GAMEDEX_UI_URL to the static/API proxy origin');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Prevent the integration check from writing to the real library.
    await context.route('**/api/**', route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${process.env.GAMEDEX_UI_URL}/components.html`);
    await page.waitForFunction(() => document.body.dataset.libraryReady === 'true');
    for (const [id, selector] of [['live-drawer-live', '#drawer'], ['live-game-table', '#tablewrap']]) {
      await page.evaluate(id => selectEntry(id), id);
      await page.click('#previewLive');
      const frame = await (await page.waitForSelector('#componentPreview iframe')).contentFrame();
      await frame.waitForSelector(`${selector}.library-highlight`, { timeout: 60000 });
      await page.evaluate(() => selectEntry('search'));
      assert.equal(await page.locator('#componentPreview iframe').count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log('Live drawer and table previews wait for app startup and unload on selection changes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
