# Gamedex — in flight

Two external sources left to add; everything else has shipped.

- [ ] **RetroAchievements** — the next source to add, and the shape is ideal:
      `GetGameList` is a BULK endpoint returning every game for a console in one
      call, with achievement counts AND ROM hashes. ~30 calls, not 14k. The hashes
      could join exactly against the NAS index / RomM rather than by title. Free,
      needs an API key from the account panel. 428 owned games are on RA platforms.
- [ ] **MobyGames** — the staff credits (who MADE a game), which nothing here has.
      Wikidata now hands us 33,902 MobyGames ids for free, so the matching is
      already done. Non-commercial limit is 720/hr (1 per 5s) → ~20h backfill;
      free access is by application.
