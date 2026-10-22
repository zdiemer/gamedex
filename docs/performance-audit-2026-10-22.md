# Gamedex performance audit — 2026-10-22

The largest measured opportunity is the facet sidebar: My Games spent **3,885 ms**
building it on the simulated slower CPU, even though the sidebar is closed on
mobile. Collections, Challenges, Recommendations and the Completed timeline also
block the main thread. The daily games are substantially cheaper.

This change adds measurement and a repeatable audit. The improvements below are
recommendations; their savings have not been implemented or measured yet.

## Method and coverage

Working-tree frontend based on `022b830`, using live anonymous library data through
the existing local static/API proxy. Chromium 149.0.7827.55; 390×844 viewport;
4× CPU throttling; unthrottled network; fresh browser context; service workers
blocked. The navigation run opens Home, then visits 17 other views, with a
3-second observation window after each navigation. Public menu transitions use
real clicks; standalone game hosts use `switchTab`; search types `mario`.

A separate run opens six costly pages in fresh contexts and records CPU profiles.
A third run repeats all 18 views at 1440×900 with no CPU throttling. All completed
runs have zero JavaScript page errors. Admin-only Wishlist, Swipe, Health, event
management, authenticated actions and deep drawer interactions were not covered.
Stats coverage is its default overview, not every subsection. Seasonal content is
whatever the server and browser expose on the audit date.

These are single-run lab observations, not production p75s, Lighthouse scores or
before/after optimization claims. The proxy bypasses the public CDN and serves
uncompressed static files. Backend/caches are warm and shared; enrichment arrival
changes work between runs. Cold pages and later SPA visits can therefore differ
substantially. The backend timing middleware is tested locally, but this audit's
API upstream is the existing deployment, without that new middleware.

[Reproduction instructions](performance.md) and the
[compact measurement data](performance-audit-2026-10-22.json) accompany this report.
Raw snapshots/profiles are in `/tmp/gamedex-performance*` in the audit workspace;
`/tmp/gamedex-performance/navigation.trace.json` can be imported into Chrome's
Performance panel. These temporary raw files are not committed.

## Page measurements

Maximum synchronous `renderAll` span and longest observed main-thread task in
each navigation window, in milliseconds. Rendering does not include every later
callback, layout, network wait or image load. Parent/child spans overlap and
must not be summed as independent work.

| View | Render | Longest task | Interpretation |
|---|---:|---:|---|
| Home | 779 | 1,798 | First load and deferred home/challenge work |
| My Games | 472 | 3,898 | Facets alone: 3,885 ms |
| Completed | 577 | 1,181 | Whole-history timeline and layout |
| On Order | 130 | 180 | Lower priority than Games |
| Collections | 1,877 | 1,912 | Eager indexes for all eight groupings |
| Stats overview | 61 | 88 | Modest in this run |
| Pick | 14 | No task ≥50 ms | Initial screen only; random-roll flow not tested |
| Recommendations | 992 | 1,160 | Catalogue scoring plus 630 ms facets |
| Translation Watch | 71 | 79 | Feed/list observed; low priority |
| Challenges | 1,316 | 1,357 | All challenge computations on overview |
| Themes | 126 | 160 | Modest relative to priorities above |
| Shelf | 4 | 91 | Async shelf span: 1,458 ms including fetch |
| Daily | 5 | No task ≥50 ms | Initial page |
| Dexle | 8 | No task ≥50 ms | Initial page, not a full game |
| Hilo | 8 | No task ≥50 ms | Initial page, not a full game |
| Picross | 7 | No task ≥50 ms | Initial page, not a full game |
| Search | 3 | 473 | Expensive work occurs after the initial empty render |
| Spooktober | 8 | No task ≥50 ms | Current seasonal state |

Home's initial navigation snapshot showed FCP 136 ms and LCP 5,648 ms. The same
session later reached observed INP 1,920 ms. These are **document metrics**, not
18 independent Web Vitals scores. Cold Home's separate LCP snapshot was 3,628 ms;
cold Recommendations was 4,144 ms. Intermediate LCP snapshots may still describe
the shell before delayed content paints; treat a tiny number as inconclusive
until the relevant content is visible. CLS/INP are provisional during an active
session, and cold runs without interactions do not produce INP.

The desktop run still recorded 823 ms for Games facets, 350 ms for Collections,
308 ms for Challenges, and 130 ms in `renderSearchResults`. Its observed
document CLS was 0.194, so desktop layout stability also needs a dedicated
shift-attribution pass; this audit does not establish which element caused it.

## Prioritized improvements

1. **Avoid hidden facet work; then break counting into cancellable chunks.**
   `scheduleFacets` delays counting by two frames, but `renderFacets` still runs
   one uninterrupted scan of every facet across the collection. On mobile the
   sidebar is translated offscreen until opened. Do not build it until requested;
   mark counts dirty while hidden and rebuild on open. For visible sidebars,
   yield between columns or row batches, cancel on navigation/filter changes,
   and preserve selected-value counts. Moving the same 3.9-second task later is
   insufficient. Cold Games also did two facet passes totaling 3,237 ms.
   CPU samples identify `rowFacetItems`, deduplication and `cachedGameId` alongside
   the facet loop. Validate both checkbox counts and maximum long-task duration.

2. **Reduce date and challenge computation shared by Home and Challenges.**
   Cold Challenges spent 1,800 ms in its render. CPU samples attributed roughly
   483 ms of self time to `chToday` and 244 ms to `chMonth`; Home also samples
   these heavily. `isCandidate` constructs an ISO date per candidate, and
   `chMonth` caches by full input date while formatting only month/year with a
   newly requested locale formatter. Compute today's date once per calculation
   (refresh across midnight), reuse an `Intl.DateTimeFormat`, and key month labels
   by year/month. Defer detailed challenge histories until opening a challenge;
   Home only needs summary cards. Preserve cache invalidation for enrichment,
   changed preferences, preview dates and new days. Profile self times are sampled,
   not additive promises of savings.

3. **Build lightweight Collections summaries before full indexes.**
   `renderGroupMenu` calls `grGroups` for every grouping, which reaches
   `groupIndex` and computes release ordering, candidates, play history and
   aggregates before someone chooses a grouping. The cold run recorded eight
   index spans totaling 630 ms; the later enriched SPA visit took 1,877 ms.
   Count groups/top examples cheaply for the overview, then compute detailed
   rows for the chosen grouping. Cache summaries against the enrichment epoch.

4. **Limit Completed timeline DOM and layout work.**
   `renderTimeline` generates all completion entries rather than a page/window.
   Cold rendering spent 481 ms in that function. CPU sampling also attributed
   about 355 ms to `updateFade`, whose layout reads can force pending layout;
   that does not mean the small callback's JavaScript itself costs 355 ms.
   Render year sections progressively or virtualize offscreen entries, preserve
   jump-to-day and keyboard navigation, and batch rail geometry reads before
   class writes. Reuse a date formatter instead of repeatedly calling
   `toLocaleDateString` through `fmtDate` for every entry.

5. **Move recommendation scoring off the critical interaction.**
   Cold `recsRanked` took 485 ms inside an 878 ms render; its facets added another
   659 ms. Score in cancellable batches or a worker, keep a stable progress state,
   and avoid reranking for changes unrelated to model inputs. Keep epoch/model
   invalidation intact. Measure ranking separately from DOM rendering and fetch.

6. **Reduce the shared boot payload and dependency chain.**
   Home requested 61 scripts totaling 1,526,762 decoded bytes, plus the shared
   stylesheet. `/api/data` decoded to 8,145,310 bytes and took 1,328 ms in this
   run; `/api/covers` decoded to 1,396,241 bytes and took 2,514 ms. Those durations
   include transport/browser scheduling, not just backend processing. All tabs
   pay for seasonal events and games they may never open. Introduce feature-group
   lazy loading with explicit registration/dependency order, preserving offline
   caching. Consider a smaller boot projection of the sheet and above-the-fold
   cover data; currently boot awaits the whole cover map before restoring the
   requested tab. Verify visible cover quality rather than replacing content
   with placeholders merely to improve a timing number.

7. **Profile and bound search work beyond debouncing.**
   The query's 473 ms task happens after `renderAll` returns. The added
   `renderSearchResults` span now exposes it directly. Preindex normalized search
   fields per data epoch, bound grouping/ranking work, and cancel obsolete query
   work. Preserve relevance, duplicate grouping and ownership semantics. Test a
   longer library and several keystrokes, not only one filled query.

The next validation should repeat the same data and device settings several times,
compare medians and worst tasks, and separately exercise the normal service-worker
path. Production field collection would be a separate decision; the instrumentation
here deliberately keeps browser metrics local.

## Verification and an additional finding

All JavaScript syntax checks, existing Node regression scripts, the new browser
diagnostics unit test, and three middleware tests passed. The diagnostics-off
browser smoke check confirmed no detailed spans and confirmed that both new
scripts enter the service-worker cache.

A full offline reload after a controlled online visit failed with `Error: Failed
to fetch` while loading the library in this local proxy/Playwright setup. The same
steps against an untouched `022b830` static checkout reproduced the failure, with
zero JavaScript page errors in both cases. This is an existing behavior in the
test setup, not a successful offline verification or an instrumentation regression.
Investigate API cache matching/fallback separately, and reproduce against a normal
production browser before attributing it to a production service-worker bug.
