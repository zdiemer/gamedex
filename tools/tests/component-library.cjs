/* Browser checks for the catalogue, actual examples, navigation and source inventory.
   Requires Playwright and a local static server; see docs/components.md. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page = await browser.newPage();
  const errors=[], api=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))api.push(r.url());});
  await page.goto(`${process.env.GAMEDEX_UI_URL || 'http://127.0.0.1:18091'}/components.html`);
  await page.waitForFunction(()=>document.body.dataset.libraryReady==='true');
  const entries=await page.evaluate(()=>sampleEntries().map(entry=>entry.id));
  assert.ok(entries.length>=40);
  const extracted=await page.evaluate(()=>sampleEntries().filter(e=>e.file.startsWith('components/')).map(({id,file,symbol})=>({id,file,symbol})));
  assert.ok(extracted.length>=19, 'Extracted examples link to component files');
  for (const entry of extracted) {
   await page.evaluate(id=>selectEntry(id),entry.id);
   assert.equal(await page.locator('#componentFullSource').getAttribute('href'),entry.file);
   assert.ok((await page.locator('#componentOwner').textContent()).includes(entry.file));
   assert.ok((await page.locator('#componentSource').textContent()).includes('function '+entry.symbol+'('),entry.id+' source must show its extracted implementation');
  }
  for(const width of [390,1280]) {
   await page.setViewportSize({width,height:900});
   for(const theme of ['dark','light']) {
    await page.evaluate(theme=>setTheme(theme),theme);
    await page.evaluate(()=>selectEntry('search'));
    const baseline=await page.locator('.library').boundingBox();
    const detailBaseline=await page.locator('.library-detail').boundingBox();
    for(const id of entries) {
     await page.evaluate(id=>selectEntry(id),id);
     const bounds=await page.locator('.library').boundingBox();
     const detail=await page.locator('.library-detail').boundingBox();
     assert.ok(Math.abs(bounds.width-baseline.width)<1 && Math.abs(bounds.x-baseline.x)<1, `${id} must keep catalogue width and position at ${width}`);
     assert.ok(Math.abs(detail.width-detailBaseline.width)<1 && Math.abs(detail.x-detailBaseline.x)<1, `${id} must keep detail width and position at ${width}`);
     assert.equal(await page.locator('.preview-error').count(),0,`${id} must render`);
     assert.ok((await page.locator('#componentPreview').innerHTML()).trim(),`${id} must be populated`);
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${id} must fit ${width}`);
    }
   }
  }
  await page.evaluate(()=>selectEntry('search'));
  await page.locator('#search').fill('Example'); await page.click('#searchClear');
  assert.equal(await page.locator('#search').inputValue(),'');
  await page.evaluate(()=>selectEntry('theme')); await page.click('[data-set-theme="light"]');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.evaluate(()=>selectEntry('autocomplete')); await page.locator('#demoAutocomplete').fill('Adventure');
  assert.equal(await page.locator('.ac-item').count(),2);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.locator('#demoAutocomplete').inputValue(),'Adventure Island');
  await page.locator('#librarySearch').fill('avatar');
  assert.ok(await page.locator('#componentList [data-entry="account"]').count());
  await page.locator('#librarySearch').fill('this-component-does-not-exist');
  assert.match(await page.locator('#componentList').textContent(),/No components match/);
  await page.locator('#librarySearch').fill('');
  await page.locator('#libraryCategory').selectOption('Detail drawer');
  assert.ok(await page.locator('#componentList [data-entry="drawer"]').count());
  assert.equal(await page.locator('#componentList [data-entry="account"]').count(),0);
  const nav=await page.evaluate(()=>{
   const link=templateDocument.querySelector('#navComponents');
   return {tag:link.tagName,tab:link.dataset.tab,hidden:link.closest('#navAdmin').hidden};
  });
  assert.deepEqual(nav,{tag:'BUTTON',tab:'components',hidden:true});
  await page.evaluate(()=>selectEntry('posters'));
  assert.match(await page.locator('#componentSource').textContent(),/function posterCardHtml/);
  assert.equal(await page.evaluate(()=>location.hash),'#posters');
  assert.deepEqual(api,[], 'Isolated examples must not request live data');
  assert.deepEqual(errors,[]);
  // All deferred script files and protected gallery assets must exist.
  const html=fs.readFileSync('static/components.html','utf8');
  for(const [,file] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g))assert.ok(fs.existsSync(`static/${file}`),file);
  // Production admin gating controls the parent of the nav link.
  const chrome=fs.readFileSync('static/chrome.js','utf8');
  const method=chrome.slice(chrome.indexOf('function applyAdminUI()'),chrome.indexOf('let authDialog ='));
  const elements=new Map();
  const get=id=>{if(!elements.has(id))elements.set(id,{hidden:true,innerHTML:'',classList:{add(){},remove(){}},setAttribute(){}});return elements.get(id);};
  const ctx=vm.createContext({$:get,IS_ADMIN:false,ME:{username:'Admin'},icon:()=>''});
  vm.runInContext(method,ctx);
  vm.runInContext('applyAdminUI()',ctx);assert.equal(get('#navAdmin').hidden,true);
  ctx.IS_ADMIN=true;vm.runInContext('applyAdminUI()',ctx);assert.equal(get('#navAdmin').hidden,false);
  ctx.IS_ADMIN=false;vm.runInContext('applyAdminUI()',ctx);assert.equal(get('#navAdmin').hidden,true);
  console.log(`${entries.length} isolated examples passed desktop/phone and light/dark checks; search, filtering, controls, source links, and admin navigation passed.`);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
