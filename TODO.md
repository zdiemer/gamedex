# Gamedex — in flight

Three external sources left to add, plus the two things the criteria-builder
rework left hand-written; then the feature backlog, then the 2026-07-18
codebase audit.

- [ ] **RetroAchievements** — the next source to add, and the shape is ideal:
      `GetGameList` is a BULK endpoint returning every game for a console in one
      call, with achievement counts AND ROM hashes. ~30 calls, not 14k. The hashes
      could join exactly against the NAS index / RomM rather than by title. Free,
      needs an API key from the account panel. 428 owned games are on RA platforms.
- [ ] **MobyGames** — the staff credits (who MADE a game), which nothing here has.
      Wikidata now hands us 33,902 MobyGames ids for free, so the matching is
      already done. Non-commercial limit is 720/hr (1 per 5s) → ~20h backfill;
      free access is by application.
- [ ] **ScreenScraper — replace shelf cover art** — the box-scan database:
      per-region full box scans plus separate front/spine/back faces, keyed by
      ROM hash or name, which is exactly the art the shelf fakes today from
      flat covers. Free account required; quotas are per-day with thread
      limits, so it's a slow backfill like the others. Would supersede the
      GameTDB/covers-resolved patchwork for shelf rendering, and the same
      scans feed the editor's box-art slots (see the rewrite's editing item).
- [ ] **Decompose `isCandidate` into criteria** — the challenge pool
      (`challenges.js:64`) is five hardcoded conditions: not completed, priority
      above Will Not Play, `playable === "Yes"`, not an untranslated game in a
      text-heavy genre (`CH_TEXT_GENRES`), and actually released. Every one of
      those is a filter the builder could already express, so it should BE the
      tree rather than a predicate the tree can't see — a challenge could then
      widen or narrow its own pool instead of inheriting one. It would also
      retire the `Challenge candidate is Yes` chip that "pick me one" has to
      carry (`pick.js:270`), which exists only because Pick's pool is looser than
      `isCandidate` and there was no way to say the difference in criteria.
      Watch the priority rule: `priorityRank` returns 0 for a blank, and the test
      is `> 1`, so a game with no priority set is silently NOT a candidate today.
      Decomposing makes that visible, and probably wants deciding rather than
      reproducing.
- [ ] **Decompose Subplatform into composable filters** — the last hand-written
      grouper (`platformCompletionId`, `challenges.js:143`). It branches over
      platform, digitalPlatform, the notes-derived facts (storefront,
      subscription, accessory), releaseRegion, format, vr, dlc and mameRomset —
      so most of it is a composite of fields that already exist, plus a handful
      of genuinely bespoke rules (Famicom, Super Famicom, Bootleg, MAME/non-MAME,
      the VR and DLC splits). Needs a "combine fields" transform and the
      notes-derived facts exposed as fields. Only worth doing if the composite
      reproduces those rules exactly: One Per Platform is 297 buckets today, and
      an approximation silently rewrites a challenge that has been walked 547
      times.

## Features

### Fun / interactive (brainstorm 2026-07-24 — Galaxy built; these are the runners-up)

- [ ] **Guess-the-Game — daily + endless quiz suite.** One engine, several modes,
      each cut from assets already cached: zoomed cover, blurred screenshot that
      de-blurs on wrong guesses, IGDB `summary` with the title/franchise starred
      out, **your own review prose with the game name censored** (a mode nobody
      else can build), "name that soundtrack" from a KHInsider clip, and a
      **Higher-or-Lower** on Metacritic / SteamSpy `owners` / HLTB / release year /
      VGChartz `units`. Server picks a daily seed the way Picross does; streaks reuse
      the same cross-device store. Highest fun-per-effort; slots next to Picross.
- [ ] **Soundtrack Jukebox.** Promote the per-game KHInsider tracklist (today only
      inside one drawer) to a lean-back **shuffle radio across every matched OST** —
      an audio sibling to Attract mode. Feeds the "name that tune" quiz mode, and a
      **composer view** finally surfaces Wikidata `composers` (captured, almost never
      shown): "you own 14 Nobuo Uematsu games". Near-zero new data.
- [ ] **Rank-your-GOAT bracket.** A 32/64-game single-elim bracket seeded from the
      collection or a facet ("best JRPG", "best thing I finished in 2024"). Vote down
      to a **personal all-time ranking** + shareable result. Pick says what to *play*;
      nothing says what you *love most*. Needs only titles + covers.
- [ ] **"On this day" + animated bar-chart race.** Two cheap wins from the date
      columns: an **anniversary feed** (finished / bought / released on today's date
      across years) and a **bar-chart race** of most-owned platform/genre/franchise
      animating year by year — the Year-in-Review burn-down made kinetic and shareable.
- [ ] **Taste Fingerprint.** `predict.js` already learns per-genre/dev/franchise
      coefficients and `reviews.js` learns sentiment words; neither is shown. Surface
      it as a **"what your collection says about you"** readout: "You're a 12-point
      JRPG optimist. Your blind spot is shooters. You write 3× more words about games
      you love." Re-presents model internals already computed.

### The big rewrite and the utilities

- [ ] **The rewrite: wrap IGDB, DB as source of truth** — the sheet stops
      being the canonical copy and the *game* stops being a spreadsheet row:
      the canonical entity is the IGDB record, and personal data (ownership,
      status, playtime, rating, notes) becomes annotations keyed on `igdbId`.
      Games IGDB doesn't know (keitai, bootlegs, the NO_MATCH tail) become
      custom rows in the same table shape, own id range. Scope:
      - **The catalogue mirror is already the wrap.** `catalogue.py`'s 369k-row
        weekly sync gets promoted from recommendation pool to the games table.
        Title matching moves from a runtime process to an add-time act —
        confirmed once, then a foreign key — which retires the fuzzy matcher's
        continuous re-joining and most of the reasons twelve normalizers exist
        (see audit). The enrichment DB already holds the confirmed
        matchKey→igdbId joins, so migration is "promote what the matcher
        decided, hand-triage the NO_MATCH tail into custom entries" — the
        Health tab is the triage UI. Platform sync joins move to IGDB's
        `external_games` (Steam appid → igdbId) and drop another matcher.
        Secondary sources key on igdbId; the id-joined ones (PCGW, Wikidata)
        already prove the pattern.
      - **Serve the catalogue, ship the collection.** Browsing/searching all
        369k games must be server-side (SQLite FTS5); don't build that engine
        for the *owned* set. The ~15k-row collection payload stays shipped in
        full — Pick's criteria compiler, challenges, groupings, stats and
        predict all run over it in client memory, and a server rewrite of
        those means compiling the criteria tree to SQL for no size win.
        Hybrid: personal data local-first + offline, universal data queried.
        The SPA/PWA and the no-build frontend stay; the recs tab's 2.2 MB
        catalogue download becomes a query. Offline stays read-only.
      - **Real user accounts are in scope.** Every annotation table is
        per-user from day one; the shared tables are the IGDB wrap and the
        enrichment caches (one crawl serves everyone — that's the point of
        wrapping). What accounts drag in: real auth (registration, sessions,
        reset — or lean on OAuth and skip passwords), a privacy model where
        today everything is public-read (per-user visibility: public profile /
        link-only / private, decided per user not per deploy), per-user
        platform credentials (accounts.py + the linked-platforms dialog are
        the single-user seed of this) with provider rate limiters becoming
        global queues shared across users, and migrating the things that are
        secretly already per-user state: prefs, dismissed recs, the wishlist.
        Today's site becomes "user #1's public profile".
      - **DB: start SQLite on the PVC** (WAL mode), alongside enrichment/
        catalogue — a single replica on one node carries a small community
        fine. Accounts weaken the "Postgres buys nothing" claim, but the
        right time to pay that cost is when a second replica or real write
        concurrency demands it; keep the schema portable (no SQLite-isms in
        anger) so the move is mechanical. The price of DB-as-truth is losing
        "pod restart self-heals from Dropbox" — backups become mandatory:
        Litestream, or a nightly export back to Dropbox (the old source of
        truth demoted to backup format).
      - **The editor is the hard part.** The spreadsheet is a genuinely good
        bulk editor; per-row forms won't replace 40-column mass edits. Not
        done without a grid editor or an xlsx export→edit→import round-trip
        as the escape hatch. `parse.py` survives as the importer.
      - **Full inline editing + game creation.** Past the quick-log verbs,
        the drawer grows real per-field editing: title, release date,
        description, and every art slot — full box scan, front/spine/back
        faces, cover-art-only — each replaceable inline (upload or pick from
        a source, e.g. ScreenScraper's scans). Sits on the annotation model:
        edits to universal fields are per-user overrides layered on the IGDB
        record, not mutations of the shared wrap. And a create-game flow for
        titles IGDB doesn't have — the NO_MATCH/keitai/bootleg tail stops
        being a migration-time triage artifact and becomes a first-class
        "add a game" form that mints a custom row (own id range) with the
        same editable fields.
      - **Phasing:** (1) staged-edits overlay — quick-log ("mark finished",
        "set status", "log hours") writes to a side table and overlays the
        served rows, sheet still truth, zero risk, admin-only; (2) igdbId-
        anchored migration, DB becomes truth, poller retired to import-on-
        demand — schema is per-user from here even though there's one user;
        (3) editing UI grows from the quick-log verbs outward; (4) accounts
        open up: auth, visibility settings, per-user platform linking —
        today's site becomes user #1's public profile; (5) catalogue
        browse/search goes server-side, which accounts also force (every
        new user starts with an empty collection and finds games by
        searching the catalogue, not their own shelf).
- [ ] **Outbound notifications + iCal feed** — the data already knows an On
      Order title releases tomorrow, a wishlist deal crossed its threshold, a
      platform sync is failing; nothing pushes. An iCal feed of release dates
      (calendar apps do the reminding for free) plus an ntfy/webhook daily
      digest. Cheap: the server already has every date and price.
- [ ] **Play-session history from sync deltas** — platform_sync overwrites
      playtime totals; snapshot them per sync instead (the value-history loop
      is the exact pattern, `enrich.py:312`). Derived sessions buy a real
      "played this week" rail on Home, monthly hours, and a Year in Review
      that knows about games you play but never finish — the sheet only ever
      sees completions.
- [ ] **Per-game permalinks with OG tags** — the site is public but a link
      can't point at a game. A `?g=<key>` deep link that opens the drawer,
      with the server stamping title/cover OG meta on that route for crawlers
      (a shim, not SSR). Subsumes the audit nit about the hardcoded
      "14,752 games catalogued" meta description.
- [ ] **UPC barcode scan** — store mode for "do I own this?": BarcodeDetector
      API + camera → UPC → owned/wishlisted/not. The search-first version of
      store mode already exists; this is the hands-free upgrade. Blocked on a
      UPC→game source (PriceCharting has one; IGDB doesn't) — evaluate
      alongside the RetroAchievements/MobyGames source work.
- [ ] Low priority: **collection export** — one-click CSV/JSON dump of the
      joined view (sheet + enrichment + current values) for insurance/backup/
      portability. Trivial endpoint; value history makes it a valuation
      document.

## Audit — things that already bite

Drift between copies that has become (or is about to become) a live bug.

- [ ] **GameTDB region folders contradict between src and tools** —
      `src/gametdb.py:58` maps Japanese art to `"JA"`; `tools/gametdb_covers.py:51`
      maps it to `"JP"`. One of them 404s on every Japanese cover. The tool
      rebuilds the whole client (URL template, region map, title norm) instead of
      importing `src.gametdb`; make it import and the contradiction dies.
- [ ] **`patchGroupCovers` was never wired** — `groups.js:379` exists to fill
      group-card art when enrichment lands after first paint, but the
      enrichment-changed path (`enrich.js:152` → `patchEnrichedCells`,
      `preview.js:434`) only touches `#grid`/`#tbody`. Group covers genuinely
      don't fill in today. Wire it or decide it's unneeded and delete.
- [ ] **`chResetGroupCols` is never called** — `challenges.js:1054`. `chReset`
      (`challenges.js:268`, run on every data reload) clears `_chTopDevs`/
      `_chPct`/`_chHist` but not `_chGroupCols`, whose cached columns close over
      stale field objects. Fold it into `chReset`.
- [ ] **Notes parsing exists twice, with mismatched keys** — `src/notes.py`
      derives digitalPlatform/subscription/etc. and `parse.py:380` stamps them
      onto every served row; `challenges.js:74-127` re-derives the same facts
      from raw `r.notes` with its own hand-synced CH_* vocabularies (and calls
      them `mediaFormat`/`accessory` where the server says `physicalMedia`/
      `requiredAccessory`). Read the row fields, delete the JS copy. This is
      also the "notes-derived facts exposed as fields" prerequisite of the
      Subplatform item above.
- [ ] **The two JS meta batch-loaders drifted** — `wishlist.js:43` repolls
      pending ids (40×3s); `recs.js:174` doesn't, so a rec whose meta was
      pending stays empty forever. One `fetchGamesMeta(ids, {batchSize, repoll})`
      in data.js; callers keep only cache-merge and repaint.
- [ ] **JS roman-numeral folding disagrees with itself and the server** —
      `health.js:29` caps at xiii (FF XIV/XV silently unfold), `filters.js:42`
      uses different single-letter rules, Python (`match_validator.py:240`) goes
      to 20. Part of the normalization consolidation below.

## Audit — performance

The backend is mostly already right (in-memory store, batched IGDB, cached
gzip on enrichment/all). What's left:

- [ ] **`/api/data` re-encodes + re-gzips the full sheet per page load** —
      `app.py:933-948`: jsonable_encoder over ~14.7k rows, json.dumps, then
      level-9 gzip, every request, for a body that's a pure function of
      `(sourceHash, change_count)`. `/api/enrichment/all` had the same disease
      and was fixed with a pre-gzipped byte cache (`app.py:964-968`); give
      `/api/data` the identical treatment. Likely 0.5-2s of server CPU per boot.
- [ ] **No ETag/304 on the multi-MB endpoints** — `/api/data` and
      `/api/enrichment/all` have a perfect cheap version token and never emit
      it; the client re-downloads several MB on every visit even when nothing
      changed. `ETag: <sourceHash>-<changeCount>`, honor If-None-Match, fall
      back to the SW-cached copy on 304. Pairs with the byte cache above.
- [ ] **Every deploy evicts the service worker's image/data cache** —
      `sw.js:14-16` versions BOTH caches; activate deletes the rest. At the
      current multiple-bumps-a-day cadence, all cover art and the offline
      last-good data re-download per release. Version only the SHELL cache;
      the data/image bytes are URL-keyed and immutable (the code's own comment
      says so).
- [ ] **Facet sidebar recount is ~30 unmemoized full-collection scans per
      repaint** — `filters.js:244-291` calls `rowFacetItems`
      (`launch.js:494-517`) per row per facet column, rebuilding Sets and
      running the `curatedGenres` regex (`data.js:269-281`) each time — order
      of 400-800k facet-item computations per paint, on every debounced
      keystroke, facet click, and 45s enrichment poll. Memoize per (row, col)
      in a WeakMap invalidated by `_enrichEpoch` (the `_genreHay` pattern at
      `filters.js:129` already does this).
- [ ] **Typo matching runs edit-distance DP against every non-matching row per
      keystroke** — `filters.js:79-107`. Gate it: only run the fuzzy pass when
      literal matches are scarce (< ~20 results).
- [ ] **GZipMiddleware at compresslevel=9** — `app.py:919`. Level 6 is 2-3x
      faster for ~1-2% size; the hand-rolled enrichment cache already chose 6.
      Also `/api/catalogue` caches its JSON string (`app.py:1203`) but re-gzips
      the ~6.3MB body per request — cache the gzipped bytes.
- [ ] **`/api/gamerankings` re-joins the archive against ~16k rows per
      request** — `app.py:816` → `gamerankings.py:56-66`, 4 regexes per title
      per row, pure function of sourceHash. Cache on hash.
- [ ] **Boot ships 40 parse-blocking script tags** — `index.html:290-346`, no
      `defer`. Order is preserved with defer; cheap win for first visits and
      the (frequent) post-deploy reloads.
- [ ] **Backfill dependency queues busy-cycle** — `enrich.py:868-893`: blocked
      keys pop/probe/requeue at 20 probes/s per source under the shared
      `_db_lock`. Park them in a deque and re-drain when `_save_igdb` lands
      matches (a Condition already exists). One-time-per-library cost only.

## Audit — modularization

- [ ] **Title normalization has ~12 independent implementations** — canonical:
      `MatchValidator.normalize` (`match_validator.py:265`). Hand-rolled
      approximations: `gametdb.py:62`, `manuals.py:95`, `khinsider.py:76`,
      `gamerankings.py:27` + its admitted verbatim twin `tools/gamerankings.py:62`,
      `tools/nas_index.py:100` (the most capable variant, unavailable to the
      rest), `tools/gametdb_covers.py:65`; JS ports: `health.js:23`,
      `relations.js:71`, `challenges.js:183`, `timeline.js:62`. One Python
      `textnorm` module with named strictness levels; on the JS side either one
      shared normalizer in core.js or serve the server-computed key
      (`catalogue.js:26` already documents that as the right pattern).
- [ ] **`BaseUserClient` for the seven platform clients** — steam/psn/xbox/
      epic/gog/itch/nintendo share an implicit protocol with pasted no-op stubs
      and a byte-identical `download()` — except `nintendo_user.py:188` drifted
      to add a User-Agent the other six lack. Base class with default stubs,
      `download()`, and the token-cache/`_get` shape.
- [ ] **Co-Optimus platform list is hand-copied in three places** —
      `cooptimus.py:56` (truth), `enrich.py:177`, `static/data.js:19`. Python:
      `set(cooptimus.PLATFORMS)`; JS: ride an existing payload.
- [ ] **18 `_UA` constants in two deliberate families, with wording drift** —
      honest-bot UA in ~8 files (`speedrun.py:25` and `shelf.py:577` already
      drifted), browser-impersonation UA pasted in ~10. Two constants in
      `constants.py` (`BOT_UA`, `BROWSER_UA`) plus an `HTTP_TIMEOUT` default —
      per-call timeouts currently range 20/25/30/60/120 ad hoc.
- [ ] **Region-preference tables ×4 in cover land, mutually contradictory** —
      `tools/resolve_covers.py:121` ranks unknown-region near-best,
      `tools/coverproject_index.py:116` ranks it dead-last;
      `tools/gametdb_covers.py:53` and `src/gametdb.py:59` have their own. One
      canonical table in src/, parameterized by sheet region, imported by tools.
- [ ] **`manuals.py`/`khinsider.py` share a pasted text-cleanup block** —
      `_norm` identical, `_REGION_PAREN` and `_strip_furniture` drifted in ways
      each would want from the other. Shared stripper taking `_FURNITURE` (the
      legitimately different part) as data.
- [ ] **Platform-name alias folding re-derived per feature table** —
      `shelf.js:77`, `shelf.py:169`, `launch.js:49`, `media.js:80`,
      `challenges.js:137` each fold aliases their own way while
      `constants.py:6` `PLATFORM_NAMES` sits unused by the UI. One
      `platformKey()` (or serve the canonical key per row); per-table data
      stays, alias rows go.
- [ ] Minor: identical month arrays in `challenges.js:629` and `stats.js:393`
      → core.js, next to `fmtDate`.

## Audit — consistency

- [ ] **Two API error envelopes** — 15 routes raise `HTTPException`
      (`{"detail"}`), 15 return `JSONResponse({"error"})`, and the JS has to
      know which endpoint speaks which (`chrome.js:679` reads `.detail`,
      `chrome.js:708` reads `.error`). Standardize on HTTPException/detail and
      one frontend accessor.
- [ ] **No shared `fetchJSON`** — ~45 call sites hand-roll fetch/ok/json with
      divergent semantics: some check `r.ok` (`mine.js:107`), some parse
      unconditionally so a 500 page becomes a parse throw (`stats.js:150`,
      `catalogue.js:59`, `picross.js:59`). One helper in core.js.
- [ ] **API URL prefix drift** — `shelf.js` and half of `launch.js` use
      absolute `/api/...`, the other ~40 sites relative `api/...` —
      `launch.js:140` vs `launch.js:215` proves it's drift, not policy. Pick
      relative, normalize.
- [ ] **enrich.js: 17 cryptic per-source cache globals + hand-written
      fan-outs** — `enrich.js:88-107` (`HLTBC, MCC, GEC, …`), 17-line fill
      chain at `panels.js:552`, hand-listed invalidation at `panels.js:530` and
      builder concat at `panels.js:471`. The backend already solved this with a
      uniform source interface iterated in `enrich.py:251` — mirror it: one
      registry keyed by wire key, loops for fill/invalidate/render. Would make
      RetroAchievements/MobyGames one-entry additions.
- [ ] **Chart colors ignore the theme tokens** — `charts.js:27` hardcodes
      good/warn/bad hexes that disagree with `--good/--warn/--bad`
      (`style.css:42-47`) and ignore the light theme; `stats.js:11` still keeps
      the 12-hue rotating palette that charts.js's own header says it replaced.
      Read the CSS custom properties; port stats.js to the charts.js scheme.
- [ ] **Small-batch cleanup** (one sitting): `typeof x === "function"` guards
      only for genuinely optional modules, bare calls otherwise (~25 guards,
      most guarding load-order that's guaranteed); `"use strict"` in shelf.js
      (the only file without it); mutable per-tab state named `xxxState` not
      `ALL_CAPS` (`SHELF`/`MINE`/`CAT` vs `statsState`/`healthState`);
      `log = logging.getLogger("gamedex.app")` in app.py (the only module
      without a bound logger); move the two import-time `os.environ` reads
      (`enrich.py:215`, `gamerankings.py:23`) into the app.py config seam;
      rename `GameTdb`/`PcGamingWiki`/`Wikidata` to `*Client` and standardize
      `self._limiter` (vs `_rl`, `_lim`); type hints on the older source
      clients' `match`/`override_from_url` (the wire-format contract).

## Audit — dead code and structure

- [ ] **~385 lines of dead CSS** — whole selector families with zero
      references: `pw-*` (old predict widget), the old `rec-*` card layout, the
      old `rev-*` reviews list, `igdb-head/side`, `col-member*`, plus stragglers
      (`card-collection`, `combinebtn`, `mine-rows`, `chb-del`,
      `ch-bucket-done`, `rl-b-*`, `ln-dot`, `s-big`, `h-top` — eyeball the last
      two short names before deleting).
- [ ] **Seven dead JS functions from the groupings rework** —
      `chPlaytimeBucket`/`chRatingBucket`/`chPriceBucket`/`chPercentileBucket`
      (`challenges.js:193-239`), `tlYearOf` (`timeline.js:41`), `viewOf`
      (`core.js:41`), `openGroup` (`groups.js:403`). No dynamic dispatch exists
      in the codebase; safe deletes.
- [ ] **Dead Python** — `match_validator.py:65,74,432` (port residue from
      GamesMaster), `accounts.py:71` `user_count`, `shelf.py:407` `has_upload`.
- [ ] **`static/_sprite.html` is a stale drifted duplicate** — 37 symbols vs
      index.html's 47, referenced by nothing, ships in the image. Delete, or
      make it the generator with a build step; today it's a trap.
- [ ] **Remove `/api/wishlist/meta` alias** — `app.py:610`, self-described
      one-release grace shim dated 2026-07-17; no caller left.
- [ ] **Re-run `tools/resolve_covers.py` when many new physical games land** —
      `data/covers-resolved.json` is baked into the image and drifts slowly
      with the library (new boxes get no real-scan wrap until it's re-run).
      Deliberate low-churn manual step; noted here so it isn't forgotten.
- [ ] **Split `enrich.py` (1,100-line god class)** — Enricher mixes SQLite
      persistence, queue/worker orchestration, the value-history loop, and
      ~410 lines of version-stamped one-shot backfills. Mechanical split:
      `enrich_store.py`, `enrich_backfills.py`, Enricher keeps the queue.
- [ ] **Split `pick.js`** — the criteria engine (field registry, compile,
      decode, builder UI, ~44-535 + 775+) is shared infrastructure that
      challenges.js drives via `PKB`; the dice-roll/presets/tab UI is Pick's
      own. `criteria.js` + `pick.js`; the existing `typeof chGroupCol` guards
      mark the seam.
- [ ] Lower priority: `chrome.js` is nav + command palette + modal primitives
      + admin auth in one file (`cmdk.js` and `auth.js` lift out ~170 lines
      each); Picross daily-puzzle selection lives in `app.py:827-893` while
      `src/picross.py` exists — move it.
