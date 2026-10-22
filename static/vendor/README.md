# Vendored browser dependencies

`web-vitals-5.1.0.iife.js` is the unmodified IIFE build of GoogleChrome/web-vitals
5.1.0, downloaded from https://unpkg.com/web-vitals@5.1.0/dist/web-vitals.iife.js.
It exposes `window.webVitals` without requiring npm or a runtime CDN request.
Apache-2.0 license: `web-vitals-LICENSE.txt` (included).

SHA-256: `8890ec954757ea8e4801f49958afb76e2b8837c47fec5b16598fc20cbd49c220`.

Upstream API/lifecycle documentation: https://github.com/GoogleChrome/web-vitals/tree/v5.1.0

To upgrade, deliberately pin a new version, preserve its license, update the script
in index.html and the service-worker shell/version, and rerun the diagnostics tests
and browser audit. Do not silently replace this file from the latest CDN release.
