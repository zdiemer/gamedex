# Gamedex — papercut cleanup

Site-wide polish pass. Checked = shipped. Each item notes the files it touches
and any decisions made along the way.

## Shipped in 1.58.14

- [x] **2. Attract mobile "next" stays purple** — `:hover` gated behind `@media
      (hover: hover)`; touch gets a brief `:active` flash instead. `style.css`.
- [x] **3. Attract: only the cover / title opens the drawer** — moved the click off the
      whole stage onto `.attract-cover` + the title. `attract.js` + `.attract-open` CSS.
- [x] **4. Attract: swipe left/right to page** — horizontal touch-swipe on `#attractStages`
      calls `attractNext(±1)`; ignores taps and vertical scrolls. `attract.js`.
- [x] **5. Hero cover opens the drawer** — the "now playing"/continue-playing hero box art
      now carries `data-hk` and opens details on click. `home.js` + cursor/hover CSS.
- [x] **6. Hero pager overlap on mobile** — `.h-hero-inner` gets `padding-inline: 24px` so
      the always-visible arrows sit in the gutter. `style.css`.
- [x] **7. Dropped "Picked for you"** — redundant with "You'd probably love"; removed the
      section + its suggestion-rules machinery + the `#hPickMore` wiring. `home.js`.
- [x] **8. Picross streak lapses correctly** — added `pxCurrentStreak()`; a stored streak
      only reads live if the last solve was today/yesterday, else 0. `picross.js`.
- [x] **11. Negative facets** — `BOOL_NEGATABLE` (`vr`/`dlc`/`wishlisted`) resolves every
      row to Yes or No, so the sidebar offers a real "No". Yes sorts first. `launch.js`,
      `filters.js`.
- [x] **12. Account info logged-in-only** — gated `/api/wishlist`, `/api/mine/all`,
      `/api/mine/detail`, `/api/shot` to return an empty shell for anon (`app.py`);
      hid the Wishlist tab + deep-link + palette entry and skip the personal fetches for
      anon (`index.html`, `chrome.js`, `app.js`). NOTE: the sheet's own `Wishlisted`
      facet on All Games is still public (it's spreadsheet data via `/api/data`) — left
      as-is since it isn't platform-sync data; revisit if that should be hidden too.

## Shipped in 1.58.15

- [x] **1. Redesigned the top-bar toggles** — the hover no longer tilts the square 45°;
      it lifts (`translateY` + soft shadow) and picks up the accent. Refresh spins the
      icon, not the whole button. `style.css`.
- [x] **3b. Attract cursor fix** (follow-up) — dropped `cursor: pointer` from
      `.attract-stage`; only `.attract-open` (cover/title) shows a pointer now, so the
      trailer/backdrop reads as non-clickable on desktop. `style.css`.
- [x] **7b. "You'd probably love" promoted** (follow-up) — now the lead section under the
      hero, rendered in the larger `.h-picks` grid the old "Picked for you" used (12 daily
      picks). `home.js`.
- [x] **9. Collapse long tag lists** — the drawer's Tags row is now one combined, capped
      list (`TAG_CAP=12`); the keyword tail folds behind a "+N more" chip that expands
      in place. `hero.js`, `chrome.js`, `style.css`. (Wiring fix in 1.58.16: the helper
      was defined but not called, so the fold didn't happen until then.)
- [x] **10. Equal cards per row** — `applyGridColumns` measures the natural (widest-fit)
      column count live and reduces it to the one that best fills the last row, so every
      row holds the same number of cards; re-balances on resize. `table.js`.

## Shipped in 1.58.17

- [x] **18. Screenshot-only games in carousel + hover** — the light map now carries up to
      4 screenshot ids for trailer-less games (`_light_shots`, derived from stored data,
      no re-enrichment). `startShotPreview` cross-fades them over the cover (1.6s each) on
      hover AND in the autoplay tour, using the same `.previewing`/`.playing` contract as
      the trailer. `tourEligible` now includes screenshot games. `enrich.py`, `preview.js`,
      `style.css`. NEEDS VISUAL CHECK (the fade look).
- [x] **19. Store-button hover** (new) — `View on <store>` (a `.btn.ghost`) hovered to
      accent-on-accent (invisible text) because it never overrode the generic `.btn:hover`
      background; gave ghost's hover an explicit surface so the label stays readable, like
      Play/Run. `style.css`.

## Shipped in 1.58.18

- [x] **20. Durable listing tiles** — an enrichment backfill polls every 45s; it used to
      full-`renderAll()` (rebuild every tile, restart hover/tour) whenever you filtered/sorted
      on the map. Now `enrichListChanged()` gates that: unless the filtered SET changed (or an
      enriched sort reordered the page), the covers patch in place. `app.js`, `panels.js`.
- [x] **22. Health tab owner-only** (new) — hidden nav button + deep-link guard, like Wishlist;
      the palette already skips hidden tabs. `index.html`, `chrome.js`, `app.js`.

## Shipped in 1.58.19

- [x] **17. Recommend → full sheet-backed tab** (user chose full scope) — synthetic
      `DATA.sheets.recs` (recs.js) mirroring the Wishlist catalogue-row pattern: rows are
      catalogue games seeded into ENRICH under a `rec:` key, so the shared facet sidebar,
      search, grid/table, sort (default "best of both"), pager, in-app drawers (`_wlOnly`+
      `_igdbId` → detail-by-id), hover/autoplay previews and Estimated Time all work. Per-
      page `/api/wishlist/meta` fetch fills trailer/HLTB/platform. Predicted badge on cards
      + a "Recommended for you" drawer block with dismiss. `recs.js`, `app.js`, `core.js`,
      `table.js`, `drawer.js`, `chrome.js`, `panels.js`, `style.css`. Verified locally:
      tab machinery, gating, and shared rendering all clean; no JS errors. Recs full render
      needs the prod catalogue to eyeball.
      - [x] Attract mode excludes Recommend games (they aren't games you own). `attract.js`.
- [x] **23. Snappier hover** (new) — preview dwell 550ms → 280ms. `preview.js`.

## Shipped in 1.58.21

- [x] **24. Per-page skeletons** — Home now boots into a hero-+-shelves skeleton instead of
      the All Games card grid (peeks the URL tab before data lands). `enrich.js`, `style.css`.
- [x] **25. Smooth cover fade-in** — each poster cover fades in as it decodes (one delegated
      capture-phase load/error listener adds `.loaded`) instead of the whole page flashing in
      at once. `+ decoding="async"` for off-thread decode. `enrich.js`, `style.css`, `table.js`,
      `preview.js`, `home.js`.
- [x] **25b. The O(seconds) image block (user's hypothesis, confirmed)** — `/api/enrichment/all`
      was **~3s server-side every call** (it JSON-parses all ~14.7k records) and held a
      connection that long, starving the cover loads. Now cached and keyed on the DB's
      `total_changes`, so it regenerates only when enrichment actually changes (1.19s→0.16s
      measured). Client also fetches it at `priority:"low"` so images win the connection race.
      Note: the page's own covers already came from the fast page-scoped `maybeEnrich` POST
      (0.12s), and cache hits carry `immutable, max-age=1yr` (repeat loads are instant).
      `src/enrich.py`, `panels.js`.

## Shipped in 1.58.22 / 1.58.23

- [x] **25b (cont.). The enrichment endpoint is fast now** — `/api/enrichment/all` was ~3.4s
      on EVERY call. 1.58.21 cached the built dict (didn't help — serialisation dominated and
      a live backfill invalidated it every request). 1.58.22 bounded the light-map cache by a
      20s TTL and moved the ~3s JSON parse OUTSIDE the DB lock (so it stops blocking the fast
      per-page `get_light`). 1.58.23 caches the finished GZIP BYTES of the whole response,
      returned pre-encoded. Measured on prod: **3.4s → ~0.08s** on repeat calls.
- [x] **26. Prices only on Wishlist** (new) — a wishlisted-and-owned game shares its row with
      the library, leaking its stamped `_wlPrice` badge onto All Games. Gated to the Wishlist
      tab. `table.js`.

## Shipped in 1.58.24 (bugs found while you were testing + two new items)

- [x] **Manual cover flashed then vanished (regression)** — the faster enrichment endpoint
      changed the load ordering and exposed it: `postEnrich` (page-scoped map) did `ENRICH[k]=v`
      (a REPLACE), wiping the `uploadCover` that `loadUploads` had just stamped; and
      `patchEnrichedCells` only swapped placeholder→img so a newly-set upload never replaced an
      already-shown IGDB cover. Fix: `postEnrich` MERGES (like loadAllEnrichment), and
      patchEnrichedCells reconciles the cover when `coverSrc` changes. `enrich.js`, `preview.js`.
- [x] **27. Dynamic address bar title** (new) — was permanently "Gamedex"; now "All Games ·
      Gamedex", "Chrono Trigger · Gamedex" (open game), "Gamedex" on Home. `app.js`, `drawer.js`.
- [x] **28. Home hero cover didn't refresh after enrichment** — the hero cover carries data-hk
      but isn't a `.card`, so `patchHomeCovers` skipped it and the first game's box art only
      appeared after paging the carousel. Now refreshes via `renderHero` (guarded so a genuinely
      cover-less game doesn't re-render every poll). `home.js`.
- [x] **Recs hover showed only trailers, never screenshots** — `/api/wishlist/meta`
      (`games_light`) didn't return screenshots, so a trailer-less rec/wishlist card had nothing
      to fade. Added `screenshots.image_id` → a `shots` field (trailer-less only), merged into
      the rec/wishlist ENRICH seeds. `igdb.py`, `recs.js`, `wishlist.js`.
- [x] **Recs did full-page redraws** — `loadRecsMeta` and the enrichment-poll handler both
      `renderAll()`'d; the covers are stable catalogue art and the hover reads video/shots live,
      so both now `patchEnrichedCells()` in place. `recs.js`, `panels.js`.

## Code-health cleanups (tracked, NOT started — do not work on these yet)

- [ ] **Extract the rate limiter out of `igdb.py`** into its own module — it's a general
      concern, not IGDB-specific.
- [ ] **Extract the IGDB API out of `/api/wishlist`** into a general-purpose service used by
      BOTH Wishlist and Recommend (`games_light` / `/api/wishlist/meta` are currently
      wishlist-named but recs reuses them). Rectify this coupling in general.

## Shipped in 1.58.25 (shelf, verified with local screenshots)

- [x] **15. Black outline on box fronts/backs** — the `::before` "moulded rim" drew
      `inset 0 0 0 3px rgba(0,0,0,.30)` ~4px inside the edge, a blurred black frame sitting over
      the art. Dropped the black; kept only a hairline plastic-lip highlight. Verified: art now
      goes clean to the edge (before/after screenshots). `style.css`.
- [x] **14. See-through hinge** — the interior walls were only `d-8px` deep and inset 3px, so
      the open box had seams you saw the shelf through. Ran them full depth. (1.58.26 fixed the
      regression this caused: the full-depth `w-l` landed on the spine plane and its black front
      covered the real spine when open. Now `.f-left` (the spine itself) is double-sided while
      open — real scan outside, closes the box inside — and `w-l` is inset 2px to line the inside
      in black. Verified: outer spine shows the scan, inside is clean black, no see-through.)
      `style.css`.
- [x] **Shut the box before putting it back** (your nit) — `shelfClose` now drops `.open` and
      lets the hinge swing shut before sliding the box home, instead of putting a gaping box
      back. `shelf.js`.

## Shipped in 1.58.30

- [x] **Timeline: floating jump-rail** (your follow-up) — you wanted the jump-nav "always
      available (floating menu) so that during scroll it's possible to bounce," not a strip that
      scrolls away. Rebuilt it as a `position:fixed` vertical rail pinned to the right edge of
      the viewport, vertically centred, always on screen. Click a chip to jump; the active bucket
      lights up and the rail scrolls internally to keep it in view. `position:fixed` sidesteps the
      mobile-sticky problem (body `overflow:auto` but html actually scrolls). Mobile rail narrowed
      to 60px with the timeline padded clear of it (verified no overlap). `timeline.js`, `style.css`.
- [x] **Timeline: covers sometimes not clickable** (bug) — a cover that filled in AFTER first
      paint went dead: `patchTimelineCovers` swapped the placeholder for a fresh `<img>` that had
      neither the `.tl-open` class nor a click handler. Fixed by (a) keeping `.tl-open` on the
      patched img and (b) switching entry clicks to event delegation on the host, so clickability
      keys off the class and survives any later DOM swap. Verified locally (cover click opens the
      drawer). `timeline.js`.

## Shipped in 1.58.29

- [x] **Timeline: sort → buckets** (new) — the timeline was hardcoded to date→year and ignored
      the sort. It now buckets by the active sort: Date → years, Title → A–Z (diacritics
      stripped so "Ōkami" sits under O), Platform → each platform, Rating → bands (90–100%…),
      Playtime → time bands, etc. The sort dropdown shows in timeline view now (that's why
      sorting there did nothing before). `timeline.js`, `table.js`.
- [x] **Timeline: jump-nav** (new) — a sticky, horizontally-scrollable strip of the bucket
      labels; click to jump to a section, and the active bucket lights up + scrolls into view as
      you scroll (IntersectionObserver against the real scroll container). Desktop sticky
      verified; on mobile it scrolls with the content like the app's other headers do (the
      mobile layout lets the topbar/tabs scroll away too) — confirm on a real device.
      `timeline.js`, `style.css`.

## Shipped in 1.58.28

- [x] **Drop the "Default" sort option everywhere** (new) — All Games already named its default
      (Release Date); Completed / On Order / Wishlist / Recommend still had a vague "Default"
      menu item. Removed it — the menu now selects the tab's real default (Completed → Date,
      On Order → Ordered Date, Wishlist → Added Date, Recommend → "Best match"). Added a
      `recScore` sort-only column so Recommend's "best of both" default has a menu entry, a
      `DEFAULT_SORT.wishlist` (newest wish first), and picking a tab's default column restores
      the default (keeping special comparators like Release Date's). `preview.js`, `chrome.js`,
      `table.js`, `recs.js`.

## Shipped in 1.58.27

- [x] **21. Shelf perf, round 2** — profiled (2,044 spines / 31 boards): layout was cheap, the
      cost was paint/compositing. Two fixes: `content-visibility:auto` on the boards so the ~29
      off-screen ones skip rendering entirely (reserved `padding-top` so the paint containment
      doesn't clip the hover lift; the tooltip stays within the board), and removed the outer
      10px-blur drop shadow that painted a halo above every one of ~2,000 spines (the planks
      already separate the rows). Worst-case scroll frame ~30ms → ~18-26ms on a fast box; a
      bigger relative win on a weak GPU. `style.css`.

## Image loading — for you to verify on real prod

The port-forward timing wasn't representative (kubectl serialises requests). The real fixes,
verified server-side: `/api/enrichment/all` 3.4s→0.08s; the big map fetched at `priority:low`
so covers win the ~6 connection slots; the per-page `get_light` (0.12s, the source of the
VISIBLE covers) no longer blocked behind the big build; cover images fade in as they decode
(`decoding="async"`), and cache hits are `immutable, max-age=1yr` + SW cache-first (repeat
loads instant). If covers still feel slow on real prod, the next suspect is the cold PVC image
fetch on a first-ever view.

## Recommend page (`recs.js`)

- [ ] **17. Bring in-line with other listing pages** — synthetic sheet, full game detail
      drawers, IGDB metadata on cards, autoplay carousel, maybe HLTB.

## Shelf (`shelf.js`)

- [x] **13. Perf on low-spec** (1.58.16) — real spine scans load lazily via the
      IntersectionObserver as they near the viewport, not ~2,000 decodes up front.
- [x] **16. Mobile tap-then-bounce** (1.58.16) — a height-only resize (URL bar) no longer
      rebuilds the shelf and closes the just-opened box.
- [ ] **14. Invisible inner hinge** — opening a box exposes the outside view through the
      hinge. NEEDS VISUAL DIAGNOSIS (3D CSS).
- [ ] **15. Black outline on box fronts/backs** — likely the model bleeding through
      behind the art. NEEDS VISUAL DIAGNOSIS (3D CSS).

## Notes

- Deploy = bump the tag in Chart.yaml/values.yaml (and `sw.js`'s VERSION), docker
  build/push, `bash upgrade.sh`. Version bump touches four files incl. sw.js.
