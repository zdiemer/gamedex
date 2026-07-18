# Gamedex — in flight

Two external sources left to add, plus the two things the criteria-builder rework
left hand-written; everything else has shipped.

- [ ] **RetroAchievements** — the next source to add, and the shape is ideal:
      `GetGameList` is a BULK endpoint returning every game for a console in one
      call, with achievement counts AND ROM hashes. ~30 calls, not 14k. The hashes
      could join exactly against the NAS index / RomM rather than by title. Free,
      needs an API key from the account panel. 428 owned games are on RA platforms.
- [ ] **MobyGames** — the staff credits (who MADE a game), which nothing here has.
      Wikidata now hands us 33,902 MobyGames ids for free, so the matching is
      already done. Non-commercial limit is 720/hr (1 per 5s) → ~20h backfill;
      free access is by application.
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
