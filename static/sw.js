/* Service worker.
   Two strategies, because the two kinds of request want opposite things:
   * The app shell (HTML/CSS/JS) is cache-first — it changes only on deploy, and
     serving it from cache is what makes the app open instantly offline.
   * The data (/api/data, /api/enrichment/all) is network-first with a cache
     fallback — you always want today's spreadsheet if the network can give it,
     but yesterday's is far better than an error screen on the train.
   The cache name carries the build version, so a deploy evicts the old shell
   rather than serving stale JS forever. */
const VERSION = "v1.87.17";
const SHELL = `gamedex-shell-${VERSION}`;
const DATA = `gamedex-data-${VERSION}`;
// Keep in sync with the <script> tags in index.html — a file loaded there but
// missing here is simply absent offline. Order does not matter (this is a cache,
// not a load order); index.html owns that.
const SHELL_URLS = [
  "./", "./index.html", "./style.css",
  "./manifest.webmanifest", "./icon.svg", "./vendor/web-vitals-5.1.0.iife.js",
  "./performance.js", "./components/foundations/core.js", "./core.js",
  "./components/controls/primitives.js", "./components/controls/pager.js", "./components/panels/panel.js", "./components/panels/sources.js",
  "./components/media/media-carousel.js", "./components/drawer/drawer-detail.js", "./components/drawer/age-badge.js",
  "./components/admin/mapping-controls.js", "./components/lists/poster-card.js", "./components/controls/dialog.js",
  "./components/admin/component-library.js", "./component-library.js", "./components/feedback/enrich.js",
  "./enrich.js", "./components/account/mine.js", "./mine.js",
  "./components/drawer/hero.js", "./components/drawer/panels.js", "./panels.js",
  "./components/media/soundtrack.js", "./soundtrack.js", "./components/controls/data.js",
  "./data.js", "./components/drawer/launch.js", "./launch.js",
  "./components/lists/filters.js", "./filters.js", "./components/lists/table.js",
  "./table.js", "./components/lists/preview.js", "./preview.js",
  "./components/drawer/drawer.js", "./drawer.js", "./components/events/events.js",
  "./events.js", "./components/navigation/app.js", "./app.js",
  "./components/statistics/stats.js", "./stats.js", "./components/discovery/pick.js",
  "./pick.js", "./components/discovery/rng.js", "./rng.js",
  "./components/navigation/chrome.js", "./chrome.js", "./components/media/attract.js",
  "./attract.js", "./components/navigation/gamepad.js", "./gamepad.js",
  "./components/statistics/charts.js", "./charts.js", "./components/statistics/reviews.js",
  "./reviews.js", "./components/discovery/home.js", "./home.js",
  "./components/events/spooktober.js", "./spooktober.js", "./components/events/ev-classof.js",
  "./ev-classof.js", "./components/events/ev-twoplayer.js", "./ev-twoplayer.js",
  "./components/events/ev-blackhistory.js", "./ev-blackhistory.js", "./components/events/ev-bracket.js",
  "./ev-bracket.js", "./components/events/ev-audit.js", "./ev-audit.js",
  "./components/events/ev-underthree.js", "./ev-underthree.js", "./components/events/ev-nobuy.js",
  "./ev-nobuy.js", "./components/events/ev-hearth.js", "./ev-hearth.js",
  "./components/events/ev-doors.js", "./ev-doors.js", "./components/events/ev-wrapped.js",
  "./ev-wrapped.js", "./components/events/ev-endangered.js", "./ev-endangered.js",
  "./components/events/themes.js", "./themes.js", "./components/admin/health.js",
  "./health.js", "./components/collections/groups.js", "./groups.js",
  "./components/shelf/media.js", "./media.js", "./components/games/picross.js",
  "./picross.js", "./components/games/dexle.js", "./dexle.js",
  "./components/games/hilo.js", "./hilo.js", "./components/media/jukebox.js",
  "./jukebox.js", "./components/navigation/konami.js", "./konami.js",
  "./components/lists/timeline.js", "./timeline.js", "./components/lists/search.js",
  "./search.js", "./components/drawer/relations.js", "./relations.js",
  "./similar.js", "./predict.js", "./catalogue.js",
  "./components/recommendations/recs.js", "./recs.js", "./components/recommendations/swipe.js",
  "./swipe.js", "./components/recommendations/translations.js", "./translations.js",
  "./components/recommendations/wishlist.js", "./wishlist.js", "./components/drawer/extras.js",
  "./extras.js", "./components/shelf/shelf.js", "./shelf.js",
  "./components/collections/collections.js", "./collections.js", "./components/collections/challenges.js",
  "./challenges.js", "./components/admin/edits.js", "./edits.js",
  "./fonts/archivo-800.woff2", "./fonts/plex-sans.woff2", "./fonts/creepster.woff2",
  // One display face per seasonal event. They are only ever requested when a banner uses
  // them, but the shell has to hold them or an event opened offline loses its wordmark —
  // which for a poster is most of the design. Latin subsets, ~260KB for all ten.
  "./fonts/mountains-of-christmas.woff2", "./fonts/caveat.woff2", "./fonts/anton.woff2",
  "./fonts/press-start-2p.woff2", "./fonts/pacifico.woff2", "./fonts/graduate.woff2",
  "./fonts/saira-stencil-one.woff2", "./fonts/special-elite.woff2", "./fonts/orbitron.woff2",
  "./fonts/big-shoulders-display.woff2",
];
// Cache each URL on its own. addAll() is atomic — one 404 rejects the whole
// batch, the install fails, and the app silently has NO offline cache at all.
// That is exactly what happened when reviews.js was deleted in 1.11.4 and this
// list kept asking for it: sixteen releases with a dead service worker and no
// symptom, because online everything still works.
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(SHELL_URLS.map((u) =>
        c.add(u).catch((err) => console.warn("sw: skipped", u, err)))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k !== SHELL && k !== DATA)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Admin gallery is always authorized by the server, including after logout.
  // Decode aliases as well; never consult or populate the offline shell cache.
  if (/\/(components\.html|components-(?:gallery\.(?:js|css)|catalog\.js))$/.test(decodeURIComponent(url.pathname))) {
    e.respondWith(fetch(e.request, { cache: "no-store" }));
    return;
  }
  // Never cache a mutation or a live status poll.
  if (url.pathname.includes("/api/refresh") || url.pathname.includes("/api/enrichment/stats")) return;
  // Server-cached images (/api/img proxy, /api/shelf/face box cuts): the bytes for a
  // given URL never change, so cache-first with no revalidation — one hit on the
  // network, everything after off the device. This MUST precede the generic /api/
  // branch below, which is network-first and would defeat the point. Keeping a
  // browser copy on top of the PVC cache means a repeat view costs neither a CDN
  // fetch nor a round-trip to the pod.
  if (url.pathname.startsWith("/api/img") || url.pathname.startsWith("/api/manual")
      || url.pathname.startsWith("/api/shelf/face")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); }
        return res;
      }))
    );
    return;
  }
  // Data: network first, fall back to the last good copy.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || Response.error()))
    );
    return;
  }
  // Cover art: cache-first, it never changes for a given URL.
  if (/images\.igdb\.com|images\.launchbox-app\.com|t\.vndb\.org|adb\.arcadeitalia\.net/.test(url.host)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => hit))
    );
    return;
  }
  // Shell: cache first, revalidate in the background.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        const net = fetch(e.request).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
