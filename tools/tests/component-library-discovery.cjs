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
  fs.unlinkSync(component);
  await reload();
  assert.equal(await page.locator('#componentList [data-entry]').count(),0);
  assert.deepEqual(errors,[]);
  console.log('New component appears with source on reload, disappears after removal, and is never executed during discovery.');
 } finally {
  fs.rmSync(folder,{recursive:true,force:true});
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
