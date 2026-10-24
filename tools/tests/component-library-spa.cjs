/* Real app navigation with read-only API access; local proxy documented in tools/mobile-shot. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page = await browser.newPage({serviceWorkers:'block'});
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.route('**/api/**', route => {
   if (new URL(route.request().url()).pathname === '/api/me')
    return route.fulfill({json:{authenticated:true,username:'Admin'}});
   return route.request().method()==='GET' ? route.continue() : route.abort();
  });
  const base=process.env.GAMEDEX_UI_URL || 'http://127.0.0.1:18092';
  await page.goto(base+'/?tab=components&component=theme');
  await page.waitForFunction(()=>typeof COMPONENT_LIBRARY!=='undefined' && COMPONENT_LIBRARY.frame?.contentDocument?.body?.dataset.libraryReady==='true');
  assert.equal(await page.evaluate(()=>activeTab),'components');
  await page.evaluate(()=>{window.spaDocument=document;window.originalData=DATA;});
  let frame=page.frameLocator('#componentLibrary iframe');
  assert.equal(await frame.locator('#componentTitle').textContent(),'Theme toggle');
  assert.equal(await frame.locator('.library-header').isVisible(),false);
  for (const width of [390,1280]) {
   await page.setViewportSize({width,height:900});
   for (const theme of ['light','dark']) {
    await page.evaluate(theme=>applyTheme(theme),theme);
    await page.waitForFunction(theme=>COMPONENT_LIBRARY.frame.contentDocument.documentElement.dataset.theme===theme,theme);
    assert.ok((await page.locator('#componentLibrary iframe').boundingBox()).height>400);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.click('#navToggle');
    const styles=await page.evaluate(()=> {
     const props=['fontFamily','fontSize','padding','borderRadius'];
     return ['#navComponents','#navAdmin button:not(#navComponents)'].map(sel=>{
      const s=getComputedStyle(document.querySelector(sel));return props.map(p=>s[p]);
     });
    });
    assert.deepEqual(styles[0],styles[1]);
    await page.click('#navClose');
   }
  }
  await frame.locator('[data-set-theme="light"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await frame.locator('[data-entry="search"]').click();
  await page.waitForFunction(()=>!new URL(location).searchParams.has('component'));
  assert.equal(await page.evaluate(()=>DATA===window.originalData),true);
  await page.click('#navToggle');
  await page.locator('#tabs button[data-tab="games"]').click();
  await page.waitForFunction(()=>activeTab==='games');
  assert.equal(await page.locator('#componentLibrary iframe').count(),0);
  await page.goBack();
  await page.waitForFunction(()=>COMPONENT_LIBRARY.frame?.contentDocument?.body?.dataset.libraryReady==='true');
  assert.equal(await page.evaluate(()=>document===window.spaDocument),true);
  await page.goForward();
  await page.waitForFunction(()=>activeTab==='games');
  await page.click('#navToggle');
  await page.click('#navComponents');
  await page.waitForFunction(()=>activeTab==='components');
  assert.equal(await page.evaluate(()=>document===window.spaDocument),true);
  assert.deepEqual(errors,[]);
  await page.route('**/api/me',route=>route.fulfill({json:{authenticated:false}}));
  await page.goto(base+'/?tab=components');
  await page.waitForFunction(()=>typeof activeTab!=='undefined' && activeTab==='home');
  assert.equal(await page.locator('#navAdmin').isVisible(),false);
  assert.equal(await page.locator('#componentLibrary iframe').count(),0);
  console.log('Library SPA navigation, history, themes, layout, fixture isolation and admin gate passed.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
