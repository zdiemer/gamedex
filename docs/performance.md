# Performance diagnostics

Gamedex records browser Web Vitals locally and can capture detailed page/render
traces. There is no analytics service, ingestion endpoint, or transmission of
metrics. The FastAPI server adds request timings and correlation IDs independently.

## Inspect a browser session

Open `/?perf=1` (or `/?tab=games&perf=1`). In DevTools:

```js
gamedexPerf.snapshot()          // JSON-safe snapshot, no DOM objects
gamedexPerf.download()          // save gamedex-performance.json
```

For diagnostics across reloads, set
`sessionStorage.setItem('gamedex.perf', '1')`, then reload. Remove the key and
reload to disable detailed tracing. Navigation may remove `perf` from the URL;
it remains enabled for that document's lifetime.

- **Always collected locally:** LCP, CLS, INP, FCP and TTFB, using the pinned,
  self-hosted web-vitals 5.1.0 library. Each metric includes its rating and
  navigation type. Unsupported/not-yet-observed metrics are absent, not zero.
- **Detailed mode:** named spans for rendering, filtering, sorting, facet counts,
  the completed timeline, collection indexes, recommendation scoring, search,
  and asynchronous shelf loading. Spans include their originating tab and are
  emitted as `gamedex:<tab>:<operation>` User Timing entries in Chrome recordings.
- **Detailed mode:** resource durations, decoded/transfer bytes, Server-Timing,
  and long tasks where supported. Each of the three detailed lists retains at
  most 500 entries. Marks/measures are cleared after recording. Resource URLs
  omit query strings; third-party URLs retain only their origin.

These Web Vitals describe the **document lifecycle**, not independent SPA tabs.
LCP stops updating after interaction; INP and CLS can continue changing, and the
library handles visibility changes and BFCache restoration. An intermediate
snapshot is provisional. Do not label the same document's INP/LCP as the score
of every tab. Use named spans for tab comparisons, and fresh contexts for cold
page comparisons. An asynchronous shelf span includes waiting for its API;
renderAll alone measures only the synchronous dispatch in that case.

## Correlate with server work

Every HTTP response handled by the new middleware carries:

```text
Server-Timing: app;dur=12.34, request;desc="<generated-request-id>"
X-Request-ID: <generated-request-id>
```

`app` measures time until response headers, including queueing and compression
inside the app. It excludes network latency to the browser. Streaming is
preserved. Slow or error responses log route **templates**, method, status,
request ID, header duration and total duration under `gamedex.performance`.
Queries, bodies, cookies and account IDs are not logged. Request IDs are generated
by the server, not trusted from inbound headers.

The default slow threshold is 1,000 ms. Set the server environment variable
`GAMEDEX_SLOW_REQUEST_MS` to change it (`0` logs every request). This uses existing
container logs; no separate deployment or collector is required. Cached responses
can carry the timing/ID of the request that originally populated the cache.
This is request correlation, not cross-service OpenTelemetry propagation.

## Repeat the browser audit

Install the existing browser tooling once:

```sh
tools/mobile-shot/setup.sh
```

For working-tree frontend code against live library data, run these in separate
terminals (or point `GAMEDEX_API` at a development instance):

```sh
kubectl -n games port-forward svc/gamedex 18080:8080
node tools/mobile-shot/serve.js
node tools/performance/audit.cjs
```

The proxy serves local static files and passes API requests to the running app.
It does **not** run local Python changes. To inspect the new server timing in a
browser, use an instance running the new backend. Normal app reads can trigger
its usual lazy enrichment/cache fills; the audit never signs in or edits games.

The runner uses a 390×844 viewport, 4× CPU throttling, unthrottled networking,
blocked service workers, and a 3-second observation window after each navigation.
It visits 18 public views, uses real menu clicks where available, types `mario`
into search, and fails on JavaScript page errors. Output goes to
`/tmp/gamedex-performance`: per-tab snapshots and `summary.json`. The reported
blocking duration is the sum of `max(0, task duration - 50ms)` in the observation
window; it is **not Lighthouse TBT**. An observation window is not an assertion
that all background requests have finished.

```sh
# Cold contexts for each expensive view, plus CPU profiles.
AUDIT_COLD=1 AUDIT_PROFILE=1 \
  AUDIT_TABS=home,games,completed,groups,challenges,recs \
  AUDIT_OUT=/tmp/gamedex-cold node tools/performance/audit.cjs

# Chrome Performance-panel-importable trace of a navigation session.
AUDIT_TRACE=1 AUDIT_OUT=/tmp/gamedex-trace node tools/performance/audit.cjs

# Desktop comparison; AUDIT_URL can also point directly at an updated deployment.
AUDIT_CPU=1 AUDIT_VIEWPORT=1440x900 \
  AUDIT_OUT=/tmp/gamedex-desktop node tools/performance/audit.cjs
```

Other options: `AUDIT_URL`, `AUDIT_SETTLE_MS`, `GAMEDEX_SHOT_HOME`. Chrome traces
and CPU profiles are raw DevTools artifacts and include full request URLs;
the application snapshot is the smaller URL-sanitized report. For release
comparisons use the same machine, data, viewport, CPU/network settings and cache
state, with several repetitions. The development proxy serves uncompressed
static files and bypasses the public CDN, so its timings are not production
network or field-performance measurements.

## Checks

```sh
node tools/tests/performance.cjs
PYTHONPATH=src python3 tools/tests/performance_middleware.py
```

The tests cover bounded buffers, URL query removal, disabled/unsupported browser
features, metric replacement, span cleanup, streaming responses, correlation,
existing Server-Timing preservation, exception propagation and non-HTTP traffic.
The offline smoke-check limitation is recorded in the audit; cached instrumentation
assets alone do not establish that the entire application works offline.
See [the page audit](performance-audit-2026-10-22.md) for the initial measurements
and prioritized opportunities.
