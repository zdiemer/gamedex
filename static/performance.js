"use strict";

/* Local diagnostics, no collector, cookies or persisted user data. The pinned
   web-vitals library handles metric lifecycle (including BFCache/hidden pages).
   Detailed spans are enabled with ?perf=1 or sessionStorage['gamedex.perf']='1'. */
(() => {
  const detailed = new URLSearchParams(location.search).get("perf") === "1"
    || (() => { try { return sessionStorage.getItem("gamedex.perf") === "1"; } catch { return false; } })();
  const limit = 500;
  const spans = [], tasks = [], resources = [];
  const vitals = {};
  let page = "boot", sequence = 0;
  const push = (list, item) => { list.push(item); if (list.length > limit) list.shift(); };
  const round = (n) => Math.round(n * 100) / 100;
  // Never retain query strings (search terms, game keys, external image URLs).
  const resourceName = (url) => {
    try { const u = new URL(url, location.href); return u.origin === location.origin ? u.pathname : u.origin; }
    catch { return "unknown"; }
  };
  const observers = [];
  function observe(type, callback) {
    if (!window.PerformanceObserver) return;
    try {
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe({ type, buffered: true });
      observers.push(observer);
    } catch { /* Unsupported metrics remain absent, never a misleading zero. */ }
  }
  window.gamedexPerf = {
    detailed,
    page(name) { page = name; },
    start(name, tab = page) {
      if (!detailed) return () => {};
      const start = performance.now(), id = `gamedex:${name}:${++sequence}`;
      performance.mark(id);
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        const duration = performance.now() - start;
        const label = `gamedex:${tab}:${name}`;
        performance.measure(label, id);
        // DevTools records these even after clearing the live timeline buffer.
        performance.clearMarks(id);
        performance.clearMeasures(label);
        push(spans, { name, page: tab, startTime: round(start), duration: round(duration) });
      };
    },
    snapshot() {
      const nav = performance.getEntriesByType("navigation")[0];
      return JSON.parse(JSON.stringify({
        schema: 1, detailed, page, timeOrigin: performance.timeOrigin,
        capturedAt: new Date().toISOString(), vitals,
        navigation: nav ? {
          type: nav.type, ttfb: round(nav.responseStart - nav.startTime),
          domContentLoaded: round(nav.domContentLoadedEventEnd), load: round(nav.loadEventEnd),
          transferSize: nav.transferSize, decodedBodySize: nav.decodedBodySize,
        } : null,
        spans, longTasks: tasks, resources,
      }));
    },
    download() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.snapshot(), null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "gamedex-performance.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
  if (window.webVitals) {
    for (const name of ["CLS", "FCP", "INP", "LCP", "TTFB"]) {
      window.webVitals[`on${name}`]((metric) => {
        vitals[name] = { value: metric.value, rating: metric.rating, id: metric.id,
          navigationType: metric.navigationType };
      }, { reportAllChanges: true });
    }
  }
  if (detailed) {
    observe("longtask", (entries) => entries.forEach((e) => push(tasks, {
      startTime: round(e.startTime), duration: round(e.duration),
    })));
    observe("resource", (entries) => entries.forEach((e) => push(resources, {
      name: resourceName(e.name), type: e.initiatorType,
      startTime: round(e.startTime), duration: round(e.duration),
      ttfb: round(e.responseStart ? e.responseStart - e.startTime : 0),
      transferSize: e.transferSize, decodedBodySize: e.decodedBodySize,
      serverTiming: (e.serverTiming || []).map((t) => ({ name: t.name, duration: t.duration, description: t.description })),
    })));
  }
})();
