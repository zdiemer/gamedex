# Live performance audit — 2026-10-22

Release **v1.87.0**, application commit **6d5f03c**, is deployed at
[games.diemer.codes](https://games.diemer.codes/) and
[games.zachd.duckdns.org](https://games.zachd.duckdns.org/).
Helm revision 593 rolled out successfully, and both hosts returned healthy API
responses with the new Server-Timing and request-ID headers. The pod reports image
digest `sha256:f96e2c2ee95fc72c0e5539ea6b9f6be0d2891f31207bfbde3cfe089122d210b3`.
[Release CI passed](https://github.com/zdiemer/gamedex/actions/runs/39731642844).

**Tackle Home's main-thread work and hidden facet counting first.** The live site
reproduces the local audit's major bottlenecks. Home is still slow with warm backend
caches; moving the same synchronous work one animation frame later has not removed
the stall. Desktop layout stability is another concrete issue.

## Scope and method

All measurements below use the public HTTPS endpoint, its real backend and CDN,
without the development proxy. Chromium 149.0.7827.55, anonymous account, unthrottled
network from the workspace, no production data edits or sign-in.

- 18 public views at 390×844 with 4× CPU throttling, service workers blocked,
  and 5-second observation windows. This is a phone-sized desktop browser,
  not a physical phone.
- The same 18 views at 1440×900 with 1× CPU and otherwise matching settings.
- Three additional fresh Home visits with mobile/touch emulation, 390×844,
  4× CPU, service workers enabled, 6-second observation windows and CPU profiles.
  Backend caches were warm/shared, not reset between visits.

All 39 completed view observations had zero application JavaScript page errors.
There were third-party request cancellations during navigation/hover previews,
including YouTube requests; these are recorded separately from application errors.
An initial desktop attempt hit a bug in the audit-only layout-shift reporter on a
text node; the reporter was corrected and that run discarded and repeated.

These are lab observations, **not field p75s or guaranteed speedup estimates**.
Only Home has repeated-load measurements. The navigation runs share a document,
so their LCP/INP/CLS values are document-level metrics, not scores for every SPA tab.
Admin-only views, full gameplay, every Stats subsection and deep drawer flows are
outside this audit. Image timing and shared-cache invalidation can vary between runs.

[Compact measurements](performance-live-audit-2026-10-22.json) and
[runner instructions](performance.md) are checked in. Raw trace/profile artifacts
remain in `/tmp/gamedex-live-mobile`, `/tmp/gamedex-live-desktop` and
`/tmp/gamedex-live-home-{1,2,3}` in the audit workspace.

## Home: the main page

| Run | LCP | Synchronous render | Longest task | CLS |
|---|---:|---:|---:|---:|
| Phone-sized navigation run | 5.32 s | 857 ms | 2,219 ms | 0.016 |
| Desktop navigation run | 2.58 s | 213 ms | 573 ms | 0.192 |
| Touch Home 1, workers enabled | 4.01 s | 716 ms | 2,006 ms | 0.016 |
| Touch Home 2, workers enabled | 3.80 s | 771 ms | 1,975 ms | 0 |
| Touch Home 3, workers enabled | 3.68 s | 742 ms | 1,910 ms | 0 |

The repeated touch-run median LCP was **3.80 seconds**. The measured LCP element
in every Home run was `div.h-hero-bg.on`: the large hero background. Warm caches
help, but do not eliminate roughly two seconds of blocking client work.

The second touch-run CPU profile sampled about 262 ms in `chToday`, 259 ms in
`chMonth`, 205 ms in `_computeChallenge`, and 194 ms in `hRows` (self time).
These are sampled attribution values, not savings that can be added together.
`fillChallengeSpotlight` computes all challenges to show three below-fold cards.
`chToday` creates an ISO date per candidate; `chMonth` caches full dates while
formatting a month label. The source supports small targeted improvements before
considering a large frontend rewrite.

The desktop CLS event was recorded around 237 ms, affecting `section.results`,
`span.field.field-top` and a text node. These are affected nodes, not proof of
which code caused the shift. Reserve stable initial header/content geometry and
check font swapping and initial shell changes with a before/after trace.

## Page comparison

Milliseconds; render is the maximum `renderAll` span, and task is the longest
main-thread task in that page's observation window. Network waits, deferred
callbacks and layout can occur outside the render span. Parent/child spans overlap.

| View | Phone-sized render | Phone-sized task | Desktop render | Desktop task |
|---|---:|---:|---:|---:|
| Home | 857 | 2,219 | 213 | 573 |
| My Games | 609 | 4,199 | 188 | 1,253 |
| Completed | 617 | 1,311 | 237 | 302 |
| On Order | 135 | 198 | 28 | 0 |
| Collections | 2,267 | 2,321 | 443 | 449 |
| Stats | 59 | 92 | 14 | 0 |
| Pick | 13 | 0 | 3 | 0 |
| Recommendations | 1,060 | 1,251 | 262 | 328 |
| Translation Watch | 74 | 118 | 15 | 0 |
| Challenges | 1,601 | 1,647 | 317 | 327 |
| Themes | 153 | 193 | 40 | 0 |
| Shelf | 3 | 82 | 1 | 0 |
| Daily | 5 | 0 | 1 | 0 |
| Dexle | 8 | 0 | 2 | 0 |
| Hilo | 6 | 0 | 2 | 0 |
| Picross | 10 | 0 | 2 | 0 |
| Search | 3 | 510 | 1 | 142 |
| Spooktober | 8 | 96 | 2 | 0 |

Games' facet pass alone took **4,181 ms** in the phone-sized run and **1,238 ms**
on desktop. The mobile sidebar was closed. Shelf's synchronous dispatch is small
because its own render span includes asynchronous fetching; the table is not a
claim that the whole shelf loads in 1–3 ms. Search likewise does most of its work
after the initial empty render. Initial game screens were cheap, but full gameplay
was not exercised.

Observed document INP reached 2,328 ms in the phone-sized navigation session and
464 ms on desktop. The Collections interaction coincided with the mobile maximum.

## Backend versus browser

The new server timing separates request handling from the browser's total resource
duration. The first post-deploy Home visit showed:

| Resource | Browser duration | App time | Decoded body |
|---|---:|---:|---:|
| `/api/data` | 852 ms | 682 ms | 8.15 MB |
| `/api/covers` | 1,408 ms | 1,333 ms | 1.39 MB |
| `/api/recommendations` | 1,532 ms | 1,498 ms | 0.10 MB |
| `/api/enrichment/all` | 559 ms | 394 ms | 17.20 MB |

The covers/recommendations request IDs matched the new slow-request logs. On the
second touch visit, data and covers app time dropped to 0.84 and 0.27 ms, while
Home still had a 1,975 ms task. Recommendations took 2,252 ms as a browser resource
but only 95 ms inside the app: the large difference is not evidence of a slow
recommendation handler on that visit. It includes browser/network scheduling.

Caches can rebuild again: a later desktop covers request took 1,363 ms in the
app, and one touch run's full enrichment request took 1,407 ms. Those two routes
share a response lock and a 20-second cache TTL when their version changes.
Investigate invalidation and snapshot generation, not just compression settings.

Home loaded 61 same-origin scripts with approximately **566 KB transferred**
(including resource-timing overhead). The earlier local audit's approximately
1.5 MB script figure was decoded/uncompressed size; it is not the live transfer
size. The entire library and enrichment map still impose much larger decoded
payloads and client processing.

## Recommended work, in order

1. **Reduce Home/Challenges computation.** Compute today's date once per batch;
   reuse a month formatter and year/month cache; avoid repeated full-library
   filtering in `hRows`. Build only summary data for Home's three challenge cards,
   and schedule/chunk it when needed rather than running a multi-second task just
   after first paint. Preserve midnight, preview-date and enrichment invalidation.
   Recheck the Home hero's paint and maximum task; target LCP below 2.5 s and no
   multi-second tasks under the same test conditions.

2. **Stop calculating invisible facets, then chunk visible counting.** Defer the
   mobile sidebar until opened, keep a dirty state for changes, and yield/cancel
   between count batches. Desktop also needs chunking: 1.24 seconds is too long
   even without CPU throttling. Verify selected counts, grouping, keyboard focus
   and navigation cancellation. Merely postponing the same task is insufficient.

3. **Stabilize and shorten Home's initial display path.** Fix the observed desktop
   shell shift (target CLS below 0.1), and make the hero screenshot discoverable
   before a late detail fetch. Consider a smaller above-fold cover projection and
   prebuilt cover snapshots so the whole-library cover map does not gate boot.
   Confirm the precise shift cause from layout/filmstrip evidence before changing
   fonts or layout wholesale. These complement the CPU work in item 1.

4. **Make Collections overview cheap.** It eagerly builds rich indexes for all
   eight grouping types to render overview tiles. Compute counts/top examples
   first and detailed history, ordering and next-game choices only for the opened
   grouping. Measured render: 2.27 seconds phone-sized / 443 ms desktop.

5. **Reduce Completed timeline DOM and forced layout.** Render year sections
   progressively or virtualize them while preserving jump-to-day and keyboard
   navigation. Batch geometry reads and reuse date formatters. Its longest task
   was 1.31 seconds phone-sized / 302 ms desktop.

6. **Chunk recommendation scoring, then search.** Recommendations rendered for
   1.06 seconds phone-sized, plus 633 ms of facets; search produced a 510 ms task.
   Preserve model/data invalidation and relevance/grouping semantics. A worker is
   an option after separating pure calculations from DOM/global state; it is not
   needed to begin with cancellable batches.

Feature-script lazy loading remains worthwhile, especially on slower networks,
but the measured CPU stalls offer more direct initial targets than a bundler
migration. The initial Pick and daily-game screens are lower priority based on
these observations.

## Separate reliability finding: offline reload

An additional live-site check registered the worker, confirmed both instrumentation
scripts in its cache, completed a controlled online visit, and confirmed cached
`/api/data`. Reloading with Playwright's network switched offline then displayed
`Error: Failed to fetch` and did not finish loading the library. The new diagnostics
still initialized, and there were no JavaScript page errors. The earlier local
comparison reproduced the same behavior on the pre-instrumentation baseline.

Treat this as a separate PWA reliability investigation: inspect request/response
`Vary` handling and the worker's cache fallback, then verify in a normal browser's
airplane mode before assigning a production root cause. The three enabled-worker
Home runs above were **online** tests, not offline success claims.
