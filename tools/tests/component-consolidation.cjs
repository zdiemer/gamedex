/* Read-only browser integration against the working-tree static/API proxy.
   Uses local fixtures for panels, posters and manuals; see tools/mobile-shot. */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
 try {
  const page = await browser.newPage({serviceWorkers:'block'});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route => {
   if(new URL(route.request().url()).pathname==='/api/me') return route.fulfill({json:{authenticated:true,username:'Admin'}});
   return ['GET','HEAD'].includes(route.request().method()) ? route.continue() : route.abort();
  });
  const base=process.env.GAMEDEX_UI_URL || 'http://127.0.0.1:18091';
  await page.goto(base+'/components.html');
  await page.waitForFunction(()=>document.body.dataset.libraryReady==='true');
  for(const width of [390,1280]) {
   await page.setViewportSize({width,height:900});
   for(const theme of ['light','dark']) {
    await page.evaluate(theme=>{setTheme(theme);selectEntry('pager');},theme);
    const input=page.locator('#demoPager input');
    assert.equal(await page.locator('#demoPager button').first().isDisabled(),true);
    await page.locator('#demoPager button').nth(2).click(); assert.equal(await input.inputValue(),'2');
    await input.fill('999'); await input.press('Enter'); assert.equal(await input.inputValue(),'12');
    assert.equal(await page.locator('#demoPager button').last().isDisabled(),true);
    await input.fill('0'); await input.press('Tab'); assert.equal(await input.inputValue(),'1');
    await input.fill(''); await input.press('Enter'); assert.equal(await input.inputValue(),'1');
   }
  }
  assert.equal(await page.evaluate(()=>{
   let changes=0;
   const host=createPager({page:1,pages:10,onChange:()=>changes++});
   const input=host.querySelector('input'); input.value='4';
   input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); input.dispatchEvent(new FocusEvent('blur'));
   createPager({page:1,pages:1,host,onChange:()=>changes++});
   return changes===1 && host.children.length===0;
  }),true);

  await page.goto(base+'/?tab=themes');
  await page.waitForSelector('#thmBrowseOpen',{timeout:60000});
  for(const width of [390,1280]) {
   await page.setViewportSize({width,height:900});
   for(const theme of ['light','dark']) {
    await page.evaluate(theme=>applyTheme(theme),theme);
    await page.click('#thmBrowseOpen');
    assert.equal(await page.evaluate(()=>uiDialogStack.length),1);
    assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('modal-open')),true);
    await page.locator('#thmBrowseSearch').fill('cult');
    const count=await page.locator('[data-thmgo]:visible').count(); assert.ok(count>0 && count<25);
    await page.evaluate(()=>evRenderPage('themes'));
    assert.equal(await page.locator('#thmBrowseSearch').inputValue(),'cult');
    assert.equal(await page.locator('[data-thmgo]:visible').count(),count);
    assert.equal(await page.evaluate(()=>uiDialogStack.length),1);
    await page.evaluate(()=>{void uiConfirm({title:'Nested confirmation'});evRenderPage('themes');});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#thmBrowserScrim').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#thmBrowserScrim').count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'thmBrowseOpen');
    assert.equal(await page.evaluate(()=>uiDialogStack.length),0);
    assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('modal-open')),false);
    // Actual cover editor and manual viewer share nesting, cleanup and scroll lock.
    await page.evaluate(()=>{
     document.getElementById('thmBrowseOpen').focus();
     openCoverEditor({key:'test',platform:'PC',title:'Test <game>'});
     document.getElementById('ceCancel').focus();
     window.savedMediaArt=mediaArt;
     mediaArt=()=>({manual:'about:blank',manualUrl:'https://archive.org/'});
     openManual({t:'Test <manual>'}); mediaArt=window.savedMediaArt;
    });
    assert.equal(await page.locator('.md-book').getAttribute('aria-modal'),'true');
    assert.equal(await page.locator('.ce').getAttribute('aria-modal'),'true');
    await page.locator('#mdClose').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'ceCancel');
    assert.equal(await page.evaluate(()=>uiDialogStack.length),1);
    assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('modal-open')),true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ce-scrim').count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'thmBrowseOpen');
    assert.equal(await page.evaluate(()=>uiDialogStack.length),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
  }
  await page.click('#thmBrowseOpen');
  await page.locator('#thmBrowserScrim').dispatchEvent('click');
  assert.equal(await page.locator('#thmBrowserScrim').count(),0);
  await page.click('#thmBrowseOpen');
  await page.locator('[data-thmgo="cultclassics"]').click();
  assert.equal(await page.evaluate(()=>thmTheme().id),'cultclassics');
  assert.equal(await page.evaluate(()=>uiDialogStack.length),0);
  await page.click('#thmBrowseOpen');
  await page.evaluate(()=>goTab('games'));
  assert.equal(await page.evaluate(()=>uiDialogStack.length),0);
  assert.equal(await page.locator('#thmBrowserScrim').count(),0);
  await page.waitForSelector('#pager input');
  await page.locator('#pager button').nth(2).click();
  assert.equal(await page.locator('#pager input').inputValue(),'2');
  assert.equal(await page.evaluate(()=>tabState.games.page),2);
  await page.locator('#pager input').fill('1'); await page.locator('#pager input').press('Enter');
  assert.equal(await page.evaluate(()=>tabState.games.page),1);
  await page.evaluate(()=>goTab('search',()=>{GLOBAL_SEARCH.q='a';}));
  await page.waitForSelector('#searchpage .pager input');
  await page.locator('#searchpage .pager button').nth(2).click();
  assert.equal(await page.locator('#searchpage .pager input').inputValue(),'2');
  assert.equal(await page.evaluate(()=>_searchPage),2);
  assert.equal(await page.evaluate(()=>GLOBAL_SEARCH.q),'a');
  const posters=await page.evaluate(()=>{
   const row=DATA.sheets.games.rows.find(row=>coverSrc(igdbRecOf(row),'cover_big'));
   const slot=RNG_SLOTS[0], previous=rngState.picks[slot.id]; rngState.picks[slot.id]=row;
   const host=document.createElement('div');
   host.innerHTML=pickCard(row)+rngSlotHtml(slot,[row]);
   rngState.picks[slot.id]=previous;
   return {covers:[...host.querySelectorAll('.card-cover')].map(el=>el.getAttribute('src')),
    expected:coverSrc(igdbRecOf(row),'cover_big'),
    classes:[...host.querySelectorAll('.card')].map(el=>el.className),expectedClass:posterClassName(row),
    picker:!!host.querySelector('#pickGameCard'),randomizer:!!host.querySelector('[data-rngcard]'),
    lazy:host.querySelectorAll('.card-cover[loading="lazy"]').length};
  });
  assert.deepEqual(posters.covers,[posters.expected,posters.expected]);
  assert.deepEqual(posters.classes,[posters.expectedClass,posters.expectedClass]);
  assert.ok(posters.picker && posters.randomizer);assert.equal(posters.lazy,0);
  // Check all eight feature panel roots, data hooks and escaped body text.
  const panels=await page.evaluate(()=>{
   KHC.test={name:'Album',url:'https://example.com',tracks:[{name:'Track'}]};
   const parts=[mineAchHtml('steam',{achievements:[{name:'Trophy',unlocked:true}]}),
    mineShotsHtml('steam',{screenshots:[{url:'icon.svg',caption:'Shot'}]}),
    mineReviewHtml('steam',{review:{text:'<review>',recommended:true}}),soundtrackHtml('test'),
    recsDrawerHtml({_recOnly:true,_igdbId:42,predicted:.8}),
    wishlistDealHtml({_wlAppIds:{steam:42}}),wishlistMapHtml({_wlOnly:true,_wlAppIds:{steam:'"<42>'}}),
    twDrawerHtml({_twOnly:true,_tw:{title:'Game',patchTitle:'<Patch>',authors:['<Author>'],sources:[]}})];
   const host=document.createElement('div');host.innerHTML=parts.join('');
   return {classes:[...host.children].map(el=>el.className),headings:host.querySelectorAll('.hltb-head').length,
    key:host.querySelector('[data-ost-key]').dataset.ostKey,
    appids:JSON.parse(host.querySelector('[data-wl-appids]').dataset.wlAppids),
    escaped:!host.querySelector('review, patch, author'),text:host.textContent};
  });
  assert.deepEqual(panels.classes,['hltb mine-ach','hltb mine-shots-sect','hltb mine-rev','hltb ost','hltb rec-drawer','hltb wl-deal','hltb wl-map','hltb tw-drawer']);
  assert.equal(panels.headings,8);assert.equal(panels.key,'test');assert.equal(panels.appids.steam,'"<42>');
  assert.ok(panels.escaped);assert.match(panels.text,/<review>/);assert.match(panels.text,/<Author>/);
  await page.evaluate(()=>goTab('themes'));
  await page.click('#thmBrowseOpen');
  await page.evaluate(()=>goTab('games'));
  await page.goBack();
  await page.waitForFunction(()=>activeTab==='themes');
  assert.equal(await page.evaluate(()=>uiDialogStack.length),0);
  assert.equal(await page.locator('#thmBrowserScrim').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Consolidation: pager boundaries, listing state, eight panels, specialized dialogs, theme refresh/navigation, nesting and focus passed at phone/desktop in both themes.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
