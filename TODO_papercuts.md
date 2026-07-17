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

## Remaining

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
