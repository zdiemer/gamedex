/* Real-browser regression for upgrades from a cached pre-consolidation release.
   Requires Playwright and a read-only API proxy (GAMEDEX_API, default localhost:18080).
   The previous release must exist in git history. No API writes are forwarded. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {execFileSync}=require('node:child_process');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gamedex-upgrade-'));
 const archive=execFileSync('git',['archive','fa105a7','static'],{maxBuffer:32*1024*1024});
 execFileSync('tar',['-x','-C',tmp],{input:archive});
 const old=path.join(tmp,'static'), current=path.resolve('static');
 const [apiHost,apiPort]=(process.env.GAMEDEX_API || 'localhost:18080').split(':');
 let release='old', shellReads=0;
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(req.method!=='GET'){res.writeHead(405);res.end();return;}
   const proxy=http.request({hostname:apiHost,port:apiPort,path:req.url,method:'GET'},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
   proxy.on('error',()=>{res.writeHead(502);res.end();});proxy.end();return;
  }
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  const partial=release==='mixed' && ['components/lists/preview.js','components/lists/table.js'].includes(file);
  const root=release==='new' || release==='future' || partial ? current : old;
  const filename=path.join(root,file);
  if(!filename.startsWith(root+path.sep) || !fs.existsSync(filename)){res.writeHead(404);res.end();return;}
  const type={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.woff2':'font/woff2'}[path.extname(filename)] || 'application/octet-stream';
  res.setHeader('content-type',type);res.setHeader('cache-control','no-store');
  if(release==='future' && /\.(js|css|html)$/.test(file) && file!=='sw.js'){
   shellReads++;res.end(file.endsWith('.js')?'throw Error("Mixed release fetched")':'INVALID FUTURE RELEASE');return;
  }
  res.end(fs.readFileSync(filename));
 });
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?tab=games');
  await page.waitForFunction(()=>navigator.serviceWorker.controller);
  await page.waitForSelector('#pager input');
  // Reproduce the former worker refreshing individual callers ahead of helpers.
  release='mixed';
  await page.evaluate(async()=>{await fetch('components/lists/preview.js');await fetch('components/lists/table.js');});
  await page.waitForFunction(async()=>{const r=await caches.match('components/lists/table.js');return r && (await r.text()).includes('posterClassName(row)');});
  await page.reload();
  await page.waitForFunction(()=>document.body.innerText.includes('posterClassName is not defined'));
  assert.equal(await page.evaluate(()=>typeof createPager),'undefined');
  console.log('Reproduced cached-release startup failure.');
  // New worker must replace the poisoned cache and trigger the existing reload.
  release='new';errors.length=0;
  await page.evaluate(()=>navigator.serviceWorker.getRegistration().then(r=>r.update()));
  await page.waitForFunction(()=>typeof createPager==='function' && typeof posterClassName==='function');
  await page.waitForSelector('#pager input');
  assert.ok(!await page.locator('body').innerText().then(t=>t.includes('Error:')));
  await page.locator('#pager button').nth(2).click();
  assert.equal(await page.locator('#pager input').inputValue(),'2');
  // A subsequent server release cannot rewrite this worker's installed assets.
  release='future';
  await page.goto(origin+'/?tab=games&per=25');await page.waitForSelector('#pager input');
  await page.evaluate(()=>fetch('components/lists/poster-card.js').then(r=>r.text()));
  assert.equal(shellReads,0,'Installed shell must not revalidate individual files');
  await context.setOffline(true);
  await page.goto(origin+'/?tab=games&per=50');await page.waitForSelector('#pager input');
  assert.equal(await page.evaluate(()=>typeof createPager),'function');
  assert.deepEqual(errors,[]);
  console.log('Poisoned-cache recovery, coherent shell, query-route reloads and offline startup passed.');
 }finally{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(tmp,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
