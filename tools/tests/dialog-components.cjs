/* Browser regression test. Requires Playwright (tools/mobile-shot/setup.sh).
   Run with GAMEDEX_UI_URL pointing to a local static server. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto(`${process.env.GAMEDEX_UI_URL || 'http://127.0.0.1:18091'}/components.html`);
  await page.waitForFunction(() => document.body.dataset.libraryReady === 'true');
  await page.evaluate(() => selectEntry('dialogs'));
  // Exercise the actual compatibility wrappers without booting API-backed app chrome.
  const chrome = fs.readFileSync('static/chrome.js','utf8');
  const edits = fs.readFileSync('static/edits.js','utf8');
  await page.addScriptTag({content: chrome.slice(chrome.indexOf('let authDialog ='),chrome.indexOf('function openLoginDialog()'))});
  await page.addScriptTag({content: 'const esc = value => escapeHtml(String(value));\n'+edits.slice(edits.indexOf('let editDialog ='),edits.indexOf('// Distinct values'))});
  for (const width of [390,1280]) {
   await page.setViewportSize({width,height:900});
   for (const theme of ['light','dark']) {
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await page.click('#demoPrompt');
    await page.locator('#npInput').fill('  Favorites  ');
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#feedback').textContent==='Saved: Favorites');
    await page.click('#demoPrompt');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>document.querySelector('#feedback').textContent==='Prompt cancelled.');
    assert.equal(await page.locator('#demoPrompt').evaluate(el=>el===document.activeElement),true);
    await page.click('#demoConfirm');
    await page.click('[data-np="cancel"]');
    await page.waitForFunction(()=>document.querySelector('#feedback').textContent==='Confirmation cancelled.');
    await page.click('#demoConfirm');
    await page.click('[data-np="ok"]');
    await page.waitForFunction(()=>document.querySelector('#feedback').textContent==='Demo confirmed.');
    await page.click('#demoModal');
    await page.locator('.ce-x').click();
    assert.equal(await page.locator('.ce-scrim').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
  }
  const state = await page.evaluate(async () => {
   let locks=0, escaped=0, closed=0;
   const listeners=new Set();
   const add=document.addEventListener, remove=document.removeEventListener;
   document.addEventListener=function(type,fn,options) {
    if(type==='keydown' && options===true) listeners.add(fn);
    return add.call(this,type,fn,options);
   };
   document.removeEventListener=function(type,fn,options) {
    if(type==='keydown' && options===true) listeners.delete(fn);
    return remove.call(this,type,fn,options);
   };
   window.syncScrollLock = ()=>locks++;
   const underlay = ()=>escaped++;
   window.addEventListener('keydown',underlay);
   openAuthModal('<h3>First account dialog</h3>');
   openAuthModal('<h3>Replacement account dialog</h3>');
   editsModal('First edit','content');
   const edit=editsModal('Replacement edit','<button id="editAction">Action</button>');
   const before=uiDialogStack.length;
   edit.host.querySelector('#editAction').focus();
   const pending=uiConfirm({title:'Nested question'});
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
   const result=await pending;
   const afterNested=uiDialogStack.length;
   const restored=document.activeElement.id;
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
   const afterEdit=uiDialogStack.length;
   closeAuthModal();
   const dialog=openUiDialog({html:'<h3>Test</h3>',onClose:()=>closed++});
   dialog.host.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
   dialog.close();
   window.removeEventListener('keydown',underlay);
   document.addEventListener=add; document.removeEventListener=remove;
   return {before,result,afterNested,afterEdit,restored,escaped,closed,locks,left:uiDialogStack.length,listeners:listeners.size};
  });
  assert.equal(state.before,2); assert.equal(state.result,false);
  assert.equal(state.afterNested,2); assert.equal(state.afterEdit,1);
  assert.equal(state.restored,'editAction'); assert.equal(state.escaped,0);
  assert.equal(state.listeners,0); assert.equal(state.closed,1); assert.equal(state.left,0); assert.ok(state.locks>0);
  assert.deepEqual(errors,[]);
  console.log('Dialogs: responsive themes, result APIs, replacement, nested Escape, focus restoration, backdrop, idempotent cleanup passed.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
