/* Requires the local preview proxy: discovery must work without running the generator. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
 const folder=fs.mkdtempSync(path.resolve('static/components/test-discovery-'));
 const component=path.join(folder,'new-card.js');
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage({serviceWorkers:'block'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=(process.env.GAMEDEX_UI_URL||'http://127.0.0.1:18091')+'/components.html';
  async function reload(){
   await page.goto(url);
   await page.waitForFunction(()=>document.body.dataset.libraryReady==='true');
   await page.locator('#librarySearch').fill('AutoDiscoveredCard');
  }
  await reload();
  assert.equal(await page.locator('#componentList [data-entry]').count(),0);
  fs.writeFileSync(component,'export const AutoDiscoveredCard = () => "<article>New component</article>";\nthrow new Error("Discovery must not execute this module");\n');
  await reload();
  assert.equal(await page.locator('#componentList [data-entry]').count(),1);
  await page.locator('#componentList [data-entry]').click();
  await page.waitForFunction(()=>document.querySelector('#componentSource').textContent.includes('AutoDiscoveredCard'));
  assert.match(await page.locator('#componentFullSource').getAttribute('href'),/components\/test-discovery-.*\/new-card.js/);
  const source=fs.readFileSync(component,'utf8');
  const contract=`/**
 * @component Original contract for the discovered card.
 * @param {string} text - Plain title.
 * @returns {string} Card markup.
 * @requires No globals.
 * @events Caller owns actions.
 * @cleanup No listeners are allocated.
 * @escaping <img src=x onerror="window.contractExecuted=true"> is documentation text.
 * @example
 * window.contractExecuted = true;
 * <script>window.contractExecuted = true;</script>
 */
`;
  fs.writeFileSync(component,contract+source);
  await reload();
  await page.locator('#componentList [data-entry]').click();
  assert.match(await page.locator('#componentContract').textContent(),/Original contract/);
  assert.match(await page.locator('#componentContract').textContent(),/Caller owns actions/);
  assert.equal(await page.locator('#componentContract img, #componentContract script').count(),0);
  assert.equal(await page.evaluate(()=>window.contractExecuted),undefined);
  assert.match(await page.locator('#componentContract pre').textContent(),/window.contractExecuted = true/);
  fs.writeFileSync(component,(contract+source).replace('Original contract','Updated contract'));
  await reload();
  await page.locator('#componentList [data-entry]').click();
  assert.match(await page.locator('#componentContract').textContent(),/Updated contract/);
  // Matching curated examples inherit the same extracted contract as source entries.
  await page.evaluate(()=>selectEntry('dialogs'));
  assert.match(await page.locator('#componentContract').textContent(),/close\(\)/);
  assert.equal(await page.locator('#componentContract dt').count(),6);
  await page.evaluate(()=>selectEntry('theme'));
  assert.match(await page.locator('#componentContract').textContent(),/No component contract documented/);
  assert.equal(await page.locator('#componentContract dt').count(),0);
  fs.writeFileSync(component,source);
  await reload();
  await page.locator('#componentList [data-entry]').click();
  assert.match(await page.locator('#componentContract').textContent(),/No component contract documented/);
  fs.unlinkSync(component);
  await reload();
  assert.equal(await page.locator('#componentList [data-entry]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Live discovery and contracts: refresh, examples, safe text rendering, missing-contract fallback, removal and no execution passed.');
 } finally {
  fs.rmSync(folder,{recursive:true,force:true});
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
