# Gamedex — in flight

Working list. Checked = shipped and deployed.

## Done

- [x] **Reviews reader** — 722 reviews / 83,500 words, own tab, full-text search
      with hit highlighting, sort by date/rating/length, expand in place.
- [x] **Launch game (Steam)** — `steam://rungameid/<appid>` on 3,637 owned Steam
      games; a "View on Steam" store link on the rest of the 5,928 we know an
      appid for. IGDB renamed `category` → `external_game_source` (the old name
      silently returns nothing); source 1 = Steam.
- [x] **Data health tab** — 19 checks ported from GamesMaster/GamePicker (14 at
      first; match-confidence, misspelling, sequel-mismatch, incomplete-collection
      and no-priority came later). 58 possible duplicates · 451 completed with no
      date · 724 with no completion time · 1,185 owned with no price · 4
      wishlisted-and-owned · 14 playtimes wildly off HLTB. Rows are clickable; fix
      in Dropbox, they clear on the next poll.
- [x] **Year in review + burn-down** — year picker; 107 completions/yr means the
      13,078-game backlog runs out in ~123 years (2149).
- [x] **Stats: varied charts + imagery** — cumulative area chart, calendar
      heatmap, you-vs-critics scatter (every dot a clickable game), genre radar,
      cover-art poster walls.
- [x] **PWA** — manifest + service worker. Installable; shell is cache-first,
      data is network-first with a cached fallback, covers are cache-first.
- [x] **Collection value over time** — daily snapshot, weekly GameEye re-scrape
      (a cached price is a stale price). First point: $55,837.69 across 1,884
      priced games.

- [x] **Launch: more platforms** — the Notes column picks the storefront (it
      says which copy you own), IGDB supplies the id. 4,001 real launch buttons
      (Steam 3,880 · GOG 121) plus store/app links for Epic, itch, PlayStation,
      Xbox, Google Play and the App Store (iOS works: apps.apple.com/id<appid>).

- [x] **Trailers + artwork** — IGDB's videos and artworks were fetched and never
      shown. Click-to-play trailers, artworks folded into the gallery, and the
      hero backdrop now prefers key art over a screenshot.
- [x] **Steam extras** — Deck compatibility (Valve), ProtonDB tier, SteamSpy
      owners/reviews, achievement rates. Keyed on the appid: cannot mismatch.
      New facets: Steam Deck, ProtonDB, Steam reviews.
- [x] **speedrun.com + StrategyWiki** — world records and walkthrough links.

- [x] **Recommendations** — "because you liked …" from IGDB's similar_games
      (stored since day one, never used), IDF-weighted and filtered for
      relatedness. Plus a predicted rating: ridge regression trained in-browser
      on your 1,707 rated games. MAE 9.7pts vs 10.8 for quoting Metacritic.

- [x] **The metadata we were already paying for, again** — six sources were storing
      fields nobody ever read. The arcade cabinet's own shortplay VIDEO (every
      machine had one). VNDB's synopsis — the only description a visual novel IGDB
      never matched has. GameEye's Manual-only and Box-only prices, which are what
      the gap between loose and CIB is actually made of. Co-Optimus's prose on what
      the co-op is LIKE. The link to the record RUN, not just the leaderboard. The
      rarest achievement's NAME (we printed "rarest 0.4%" and never said of what).
      And `manuals` + `gametdb` were never returned by /api/enrichment/detail at
      all, so the booklet's page count and the printed disc face were unreachable.
      New "In the box" drawer section; GameTDB box fronts and VGChartz box scans
      now fill the cover chain and the Shelf, so a disc IGDB never matched gets a
      real, region-correct box instead of a grey slab.

- [x] **PCGamingWiki + Wikidata** — the two free, bulk, EXACT-join sources. Neither
      does any per-game fetching and neither can be the wrong game.
      *PCGamingWiki* joins on the Steam appid via MediaWiki's Cargo API: ultrawide,
      4K, HDR, ray tracing, D3D/OpenGL/Vulkan, 64-bit, controller, surround. The
      whole joined table comes down 500 rows at a time (~100 calls), cached on the
      PVC. New **Ultrawide** facet. Its `Special:` pages are Cloudflare-walled but
      `api.php` isn't, and the field names are NOT guessable — `Field_of_view_FOV`,
      `Anti_aliasing_AA` and `Availability.DRM` don't exist. Every name in the
      module was verified live.
      *Wikidata* joins on the IGDB **slug** (P5794 stores `chrono-trigger`, which is
      already sitting in each record's `url`) and brings what nothing else here has:
      the composer, the director, a Wikipedia article, a MobyGames id. Four narrow
      SPARQL queries merged locally, ~21s, 37,925 slugs — one query with four
      OPTIONALs is the obvious way to write it and it times out. New **Composer**
      facet, so the collection can be filtered by who scored it.

## Next

- [ ] **Recommend games you DON'T own** — three commits. Everything here recommends
      out of the backlog, which can only ever re-rank what you already bought. The
      sheet is 4% of IGDB; the other 96% is where a recommendation has to come from.
  - [x] **1. The catalogue** (`src/catalogue.py`, `GET /api/catalogue`) — IGDB's whole
        games table on the PVC: **369,802 games in 7 minutes, 76 MB**. Weekly full
        sweep + a daily `updated_at` pass; the weekly one earns its keep by being the
        only thing that can see a DELETION. Two passes, because only **34,247** of the
        264,542 covered main games have ANY rating — the model's best features are the
        two outside opinions, so for the other 231,000 it would hand back your global
        mean and call it a recommendation. Payload is **2.23 MB gzipped**, interned +
        columnar. The endpoint is sheet-unaware on purpose: a pure function of the
        crawl, so `?g=<gen>` is immutable and the SW keeps it for a day.
  - [x] **2. A second model** — `predict.js` now fits two: `full` (**8.82**) for a sheet
        row, `igdb` (**9.21**) for a catalogue game, same rated completions, same 5-fold
        CV, each under its own handicap. Reusing one model and defaulting the absent
        features is not neutral — `developer`/`igdbDev` correlate 0.775 and ridge splits
        weight across them, so the naive path under-predicts **every** catalogue game by
        0.70 pts (9.56, bias -0.70 vs 9.21, bias 0.00). The twin is fitted lazily: it is
        +181ms and the grid's Predicted facet calls tasteModel() on every visit.
        Three things fell out of measuring it:
        - **IGDB's player score was null on 98.8% of the library** — the field was in the
          record, in the light map and read by the model, but only games matched *after*
          it was added ever got one, and nothing went back for the rest. IGDB has one for
          61% of the library. `backfill_critic` now fetches it alongside the critic
          aggregate (same query, same ids, same ~30 calls) at CRITIC_VERSION=2. Worth
          **0.45 pts** to the catalogue model, which otherwise has no player signal at all.
        - **GameFAQs reads him better than IGDB's community** (r 0.580 vs 0.560 head to
          head), so predPlayers asks it first. Without that, the backfill would have cost
          the full model 0.12 pts by swapping 79% of rows onto the weaker signal.
        - **Keywords earn their 14% of the payload after all.** Dropping them costs the
          catalogue model 0.072 pts — the largest of any vocabulary it has, ahead of
          publisher (0.058) and developer (0.052). In the full model they were worth 0.03;
          with the sheet columns gone they stop echoing and start carrying. Perspective
          (-0.001) and engine (-0.004) are worth nothing and stay only as facets.
  - [x] **2b. Weight the outside opinions by vote count** — a 95% from two voters and a 95%
        from five thousand were the same fact to the model. Each outside opinion is now
        shrunk toward its own source's mean by `(n·v + k·mean)/(n + k)` — the same formula
        the file already used for group averages, pointed at votes instead of games.
        VOTE_K=5 sits in the middle of a flat 3–10 optimum. Worth 0.11 to the catalogue
        model (9.21 → 9.10) and 0.03 to the full one, better in **every** vote bucket
        (<10: 12.34 → 12.23 · 10-99: 8.35 → 8.15 · >=100: 6.98 → 6.95). It can't rescue a
        two-vote game — there's no information in two votes — but it stops the model
        *following* one, which is what decides the top of a ranking. `confidence` now
        counts evidence rather than signals, weighting each opinion by `n/(n+VOTE_K)`, the
        exact fraction the shrinkage believed, and the drawer prints the count beside the
        score. 2 voters saying 95% now predicts 68.7 where 5,000 saying 95% predicts 77.4.
        Shipping it needed three fields that were stored and never served: `userRatingCount`
        and VNDB's `vnVotes` (light maps), and `user_rating_count` (catalogue payload).
        A source with no published count (Metacritic, the sheet's GameFAQs column) isn't
        shrunk — we can't judge what we can't see. `playerVerdict()` collapsed the value /
        source / count chains into one, because three parallel walks of the same fallback
        list drift and that label has already been wrong twice.
  - [x] **3. The tab + the Pick facet** — `recs.js`: 25,494 games IGDB knows that the sheet
        doesn't, ranked by the catalogue model and crossed with `recommend.py`'s new
        catalogue arm for a "because you liked…" reason. Quotes its OWN 9.1, not the
        backlog model's. Dismissals ride in `prefs`. Pick's pool grows to the same games
        behind an "In the sheet" field that `applyPreset` seeds with *On the sheet* in
        every preset — visible and deletable, not a hidden default — so Pick is unchanged
        until you widen it (13,086 → 38,580). A catalogue game's card has no drawer and no
        launch button; it links to IGDB and says so. The join is on `igdbId`, in the
        browser, wired into `loadAllEnrichment`'s invalidation block. Three real bugs fell
        out of driving it in a browser:
        - **The model was fitted before enrichment existed, and never refitted.** Live and
          pre-existing: `resetTaste()` ran only at boot, *before* the first render. Landing
          on Home — the default — paints a shelf that calls `tasteModel()` at once, so the
          model kept for the whole session had learned **zero IGDB tags**. Measured on the
          live site: land on Home → 0 tags; land on Stats → 3,722. It hid because the
          sheet's columns cover for it on a backlog game (8.93 vs 8.88); it is fatal for a
          catalogue game, which has no columns — 25k rows all scored at the global mean.
        - **IGDB publishes 8,394 ratings with zero voters** (24.5% of the scoreable set) —
          "East vs. West" is rated 20% by nobody. A missing IGDB count is a zero, not an
          unknown, so `catPlayerVotes` reads `?? 0`; `?? null` meant "can't judge, don't
          shrink" and let a quarter of the catalogue through at face value.
        - **The working cited factors that didn't factor** — a fully-shrunk zero-vote score
          still drew a bar saying "IGDB players (0) gave it 70".
  - [ ] **Recommendations: worth a look later** — the tab ranks 25k games on open (~1s,
        cached per enrichment epoch); if the catalogue grows a lot, chunk it. And the model
        is trained on games he CHOSE to buy, so asking it about a game he didn't choose is
        a different question than the one it learned — the top of the list is sane
        (Divinity, Ōkami, Journey) but that premise is worth revisiting once there's a
        dismissal history to measure against.

- [ ] **RetroAchievements** — the next source to add, and the shape is ideal:
      `GetGameList` is a BULK endpoint returning every game for a console in one
      call, with achievement counts AND ROM hashes. ~30 calls, not 14k. The hashes
      could join exactly against the NAS index / RomM rather than by title. Free,
      needs an API key from the account panel. 428 owned games are on RA platforms.
- [ ] **MobyGames** — the staff credits (who MADE a game), which nothing here has.
      Wikidata now hands us 33,902 MobyGames ids for free, so the matching is
      already done. Non-commercial limit is 720/hr (1 per 5s) → ~20h backfill;
      free access is by application.
- [ ] **PriceCharting** — only if paying. Bulk CSV price guide incl. UPC/barcode is
      gated to their top tier. Complements GameEye (adds barcode + graded prices).
- [ ] **OpenCritic** — skip. Behind RapidAPI, and Metacritic + IGDB's critic
      aggregate + GameRankings already cover critic scores.

- [ ] **Match confidence for SECONDARY sources** — HLTB, Metacritic, GameEye, VNDB,
      VGChartz, speedrun and guides all compute MatchValidator.match_score and then
      drop it on the floor; only the primary IGDB match persists a score (now shown
      in Health). Recording theirs means a `score` column per source table and a
      re-match of everything already cached — ~14k games x 7 sources of rate-limited
      scraping — so it can't be backfilled cheaply. Cheap half-step: store it for
      new/refreshed matches, and show "not recorded" for the rest.

- [ ] **Launch: RomM** — BLOCKED. We do not actually run RomM: `games/romm/` is a
      chart with no Helm release and no pod, and its README lists manual NAS/SMB
      prerequisites that were never done. Deep-linking emulated titles needs the
      instance up first (and then a lookup by name — RomM isn't an IGDB storefront,
      so there's no id to build a URI from).
- [ ] **Launch: EA / Ubisoft / Battle.net** — not currently possible: IGDB has no
      external_game_source for any of them, so there's no offer/app id to build a
      URI from. Would need another source (or hand-maintained ids).

## Bugs (fixed)

- [x] **The PWA had no offline cache for sixteen releases** — `sw.js` still listed
      `./reviews.js` in `SHELL_URLS`, and that file was deleted back in 1.11.4 when
      the Reviews tab was folded into the timeline. `cache.addAll()` is atomic, so
      one 404 rejected the whole batch, the install handler threw, and the service
      worker never cached anything. Silent, because online everything still worked.
      `shelf.js` was missing from the list too. Now each URL is cached on its own,
      so a stale entry can never take the whole cache down again.
- [x] Permanent loading skeleton on a game with no metadata — fixed by `NO_MATCH`:
      "still looking" and "looked, found nothing" are now distinguishable, so a row
      that will never have a cover settles instead of shimmering forever.
- [x] `gametdb.py` logged `console` in an exception handler, but the parameter is
      `dump` — a malformed dump raised NameError *from inside the error handler*,
      turning a warning into a crash that killed the whole refresh.
- [x] `manuals.py` had a loop whose entire body was `continue`, so the page count was
      always None; `pdf`, `pages` and `collections` were computed and never persisted.
      The booklet now carries its page count and a direct PDF link.
- [x] Home page image flicker — the hero rotation and the enrichment poller both
      called `renderHome()`, rebuilding every `<img>`. Hero redraws alone now.
- [x] Home hero unpageable on mobile — added swipe + arrows, bigger dots.
- [x] Review covers stayed placeholders — the tab renders before enrichment
      lands and `patchEnrichedCells` only touches the grid/table.
- [x] Health "no metadata" reported all 14,747 games — results were cached
      before the enrichment map arrived.

## Notes

- Deploy = bump the tag in Chart.yaml/values.yaml (and `sw.js`'s VERSION, which
  keys the cache), `docker build/push`, `bash upgrade.sh`.
