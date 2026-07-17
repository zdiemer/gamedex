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

## Remaining

- [ ] **1. Redesign the top-bar toggles** — dark/light, spreadsheet refresh and
      account hover states look wonky; the square tilts diagonally on hover. Redesign
      so the hover reads cleanly (no diagonal tilt). `chrome.js`, `style.css`.

- [ ] **9. Collapse long tag lists** (drawer) — show the first N tags with an inline "see
      all" button to expand the rest. `drawer.js`.

- [ ] **10. Equal cards per row at every width** — currently 3×13 + 1×11 for 50 games on
      1440p. Ensure the grid always fills rows evenly regardless of viewport.
- [ ] **18. Screenshot-only games in carousel + hover** — games with only screenshots
      (no video) should join the autoplay carousel AND the hover state, fading between
      the game's screenshots (~1–2s each).

## Recommend page (`recs.js`)

- [ ] **17. Bring in-line with other listing pages** — synthetic sheet, full game detail
      drawers, IGDB metadata on cards, autoplay carousel, maybe HLTB.

## Shelf (`shelf.js`)

- [ ] **13. More performant rendering for low-spec machines.**
- [ ] **14. Invisible inner hinge** — opening a box exposes the outside view through the
      hinge.
- [ ] **15. Black outline on box fronts/backs** — likely the model bleeding through
      behind the art.
- [ ] **16. Mobile tap bounces back** — tapping a box brings it forward then it instantly
      returns to the shelf, likely a load/refresh race.

## Notes

- Deploy = bump the tag in Chart.yaml/values.yaml (and `sw.js`'s VERSION), docker
  build/push, `bash upgrade.sh`. Version bump touches four files incl. sw.js.
