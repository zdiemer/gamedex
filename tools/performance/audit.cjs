/* Working tree: start tools/mobile-shot/serve.js + its API upstream first.
   Browser setup: tools/mobile-shot/setup.sh. See docs/performance.md.
   No writes to application data. Reports/traces are local files. */
const fs = require('node:fs');
const path = require('node:path');
const work = process.env.GAMEDEX_SHOT_HOME || path.join(process.env.HOME, '.cache/gamedex-shot');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(work, 'ms-playwright');
process.env.LD_LIBRARY_PATH = [path.join(work, 'prefix/usr/lib/x86_64-linux-gnu'), path.join(work, 'prefix/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
process.env.FONTCONFIG_FILE ||= path.join(work, 'fonts.conf');
const { chromium } = require(path.join(work, 'node_modules/playwright'));
const base = process.env.AUDIT_URL || 'http://localhost:18090/';
const out = process.env.AUDIT_OUT || '/tmp/gamedex-performance';
const tabs = (process.env.AUDIT_TABS || 'home,games,completed,onOrder,groups,stats,pick,recs,translations,challenges,themes,shelf,daily,dexle,hilo,picross,search,spooktober').split(',');
const cpu = Number(process.env.AUDIT_CPU || 4);
const settle = Number(process.env.AUDIT_SETTLE_MS || 3000);
const cold = process.env.AUDIT_COLD === '1';
const touch = process.env.AUDIT_TOUCH === '1';
const serviceWorkers = process.env.AUDIT_SERVICE_WORKERS === 'allow' ? 'allow' : 'block';
const trace = process.env.AUDIT_TRACE === '1';
const profile = process.env.AUDIT_PROFILE === '1';
const [width, height] = (process.env.AUDIT_VIEWPORT || '390x844').split('x').map(Number);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  let context, page, cdp, errors, failures;
  async function open(tab) {
    context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch, serviceWorkers });
    page = await context.newPage(); errors = []; failures = {};
    const failure = (url, status) => {
      const parsed = new URL(url);
      const key = `${status} ${parsed.origin === new URL(base).origin ? '' : parsed.origin}${parsed.pathname}`;
      failures[key] = (failures[key] || 0) + 1;
    };
    page.on('response', r => { if (r.status() >= 400) failure(r.url(), r.status()); });
    page.on('requestfailed', r => failure(r.url(), 'failed'));
    await page.addInitScript(() => {
      const label = el => el ? `${(el.tagName || el.nodeName || 'unknown').toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).filter(Boolean).join('.') : ''}` : null;
      window.__auditPaint = { lcp: null, shifts: [] };
      for (const type of ['largest-contentful-paint', 'layout-shift']) {
        try { new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            if (type === 'largest-contentful-paint') window.__auditPaint.lcp = { startTime: e.startTime, size: e.size, element: label(e.element) };
            else if (!e.hadRecentInput) {
              window.__auditPaint.shifts.push({ startTime: e.startTime, value: e.value, elements: (e.sources || []).map(s => label(s.node)) });
              if (window.__auditPaint.shifts.length > 50) window.__auditPaint.shifts.shift();
            }
          }
        }).observe({ type, buffered: true }); } catch {}
      }
    });
    page.on('pageerror', e => errors.push(e.message));
    cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    if (trace) await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,loading,v8.execute', transferMode: 'ReturnAsStream' });
    const url = new URL(base); url.searchParams.set('perf', '1'); url.searchParams.set('tab', tab);
    await page.goto(url.href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => typeof DATA !== 'undefined' && DATA && typeof gamedexPerf !== 'undefined' && gamedexPerf.snapshot().spans.some(s => s.name === 'renderAll'), null, { timeout: 60000 });
  }
  async function close(name) {
    if (profile) {
      const result = await cdp.send('Profiler.stop');
      fs.writeFileSync(path.join(out, `${name}.cpuprofile`), JSON.stringify(result.profile));
    }
    if (trace) {
      const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end');
      const { stream } = await done;
      const fd = fs.openSync(path.join(out, `${name}.trace.json`), 'w');
      try {
        for (;;) {
          const chunk = await cdp.send('IO.read', { handle: stream });
          fs.writeSync(fd, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data);
          if (chunk.eof) break;
        }
      } finally { fs.closeSync(fd); await cdp.send('IO.close', { handle: stream }); }
    }
    await context.close();
  }
  try {
    for (const [index, tab] of tabs.entries()) {
      let since = 0;
      if (cold || index === 0) await open(tab);
      else {
        since = await page.evaluate(() => performance.now());
        // Public navigation uses real clicks so INP sees real interactions. Hidden
        // admin tabs are intentionally excluded; game/search hosts use their functions.
        const button = page.locator(`#tabs button[data-tab="${tab}"]`);
        if (await button.count() && !(await button.evaluate(e => e.hidden))) {
          await page.locator('#navToggle').click();
          await button.click();
        } else await page.evaluate(t => switchTab(t, true), tab);
      }
      if (tab === 'search') await page.locator('#search').fill('mario');
      await page.waitForTimeout(settle);
      // Flush buffered observers before reading their latest values.
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const snapshot = await page.evaluate(() => gamedexPerf.snapshot());
      const spans = snapshot.spans.filter(s => s.startTime >= since);
      const tasks = snapshot.longTasks.filter(s => s.startTime >= since);
      const byName = {};
      for (const s of spans) {
        const key = `${s.page}:${s.name}`;
        const item = byName[key] ||= { calls: 0, total: 0, max: 0 };
        item.calls++; item.total += s.duration; item.max = Math.max(item.max, s.duration);
      }
      for (const s of Object.values(byName)) { s.total = Math.round(s.total); s.max = Math.round(s.max); }
      const result = { tab, since, vitals: snapshot.vitals, spans: byName, longTasks: tasks.length,
        blockingMs: Math.round(tasks.reduce((n, t) => n + Math.max(0, t.duration - 50), 0)),
        maxTaskMs: Math.round(Math.max(0, ...tasks.map(t => t.duration))), errors: [...errors], failures: { ...failures }, paint: await page.evaluate(() => window.__auditPaint) };
      results.push(result);
      fs.writeFileSync(path.join(out, `${tab}.json`), JSON.stringify(snapshot, null, 2));
      console.log(JSON.stringify(result));
      if (errors.length) throw new Error(`Browser errors on ${tab}: ${errors.join('; ')}`);
      if (cold) await close(tab);
    }
    if (!cold) await close('navigation');
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
      base, browser: browser.version(), cpu, viewport: { width, height }, touch, cold, settle,
      serviceWorkers, network: 'unthrottled', results }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
