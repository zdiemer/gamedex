"use strict";

/* ---- the three tracks: classifier, pins and the roll pool ----------------
   This was the Pick tab's RNG mode, which rolled three games at once. That mode is gone;
   the Plan tab took over its job, one track at a time (plan.js). What is left here is the
   machinery both of them stood on, and Plan still does:

     * the three tracks and which one a game belongs to:
         - modern AAA    (PS4 / Switch / Xbox One generation onward, big-budget)
         - modern indie  (PS4 / Switch / Xbox One generation onward, small)
         - retro         (PS3 / 360 / Wii U / 3DS / Vita and everything before)
     * the house rules a ROLL applies on top of the backlog (see rngAllowed)
     * the "now playing" pins: one game per track that you are already playing
     * each track's roll pool and the weighted draw from it

   No UI lives here. Loaded straight after pick.js, whose pickEligible it reads.
   challenges.js loads later in index.html, so the one thing borrowed from it —
   CH_TEXT_GENRES — is read behind a typeof guard, the way pick.js reads isCandidate. */

const RNG_SLOTS = [
  { id: "aaa",   label: "Modern AAA",   icon: "i-trophy",  tint: "var(--accent)",
    hint: "Big-budget, PS4 / Switch / Xbox One era onward" },
  { id: "indie", label: "Modern indie", icon: "i-star",    tint: "var(--accent-2)",
    hint: "Small team, PS4 / Switch / Xbox One era onward" },
  { id: "retro", label: "Retro",        icon: "i-clock",   tint: "var(--warn)",
    hint: "PS3 / 360 / Wii U / 3DS / Vita and older" },
];

/* ---- the modern/retro line ------------------------------------------------
   Drawn by HARDWARE GENERATION, not by year. Modern is the PS4 / Switch / Xbox One
   generation and everything after it; the PS3, 360, Wii and Wii U, and their handhelds
   (DS, 3DS, PSP, Vita), are retro along with everything older. A 2014 3DS game is a
   retro game, and a year line can't say that: it would need to know which shelf the
   cartridge sits on, which is what the platform column already says.

   Three kinds of platform, and only one of them needs a year:

     MODERN   the list below. Modern, unless the row is a RE-RELEASE of a game that
              predates the generation — a 1992 Game Boy game on Nintendo Switch Online is
              still a 1992 game, by the same "when the game came out, not your copy" rule
              rngYear explains.
     OPEN     hardware with no generation: PC, phones, the browser, arcade boards, the
              new homebrew handhelds. A 2010 PC game and a 2020 PC game sit on the same
              shelf, so these fall back to the year, with the line where the PS4 and
              Xbox One arrived (late 2013, so a 2014 release is the first modern year).
     anything else — every other console and handheld on the sheet, 140-odd of them,
              is retro hardware. Listing the retro ones would be the long list; listing
              the modern ones is eight names. That includes Evercade, which is new
              hardware that only plays re-releases of old games. */
const RNG_MODERN_PLATFORMS = new Set([
  "PlayStation 4", "PlayStation 5", "Xbox One", "Xbox Series X|S",
  "Nintendo Switch", "Nintendo Switch 2",
  // Same generation, by date and by hardware: a streaming console and a standalone headset.
  "Google Stadia", "Oculus Quest",
]);
const RNG_OPEN_PLATFORMS = new Set([
  "PC", "Mac OS", "Linux", "Browser", "Arcade", "Dedicated Console",
  "iOS", "Android", "iPod", "tvOS", "watchOS", "Amazon Fire TV", "Ouya", "Windows Phone",
  "Playdate", "Arduboy", "Thumby", "Thumby Color",
]);
const RNG_MODERN_FROM = 2014;

/* When the GAME came out, which is not always when your copy did. The sheet dates the
   copy — The Mysterious Murasame Castle sits on the sheet as a 2014 Nintendo 3DS row,
   because that's the Virtual Console release you own — and dating a 1986 Famicom Disk
   System game to 2014 put it in the modern slots. IGDB's first_release_date knows the
   difference, so the earlier of the two wins.

   Earlier, not "IGDB always": a remake is its own IGDB entry with its own date (RE4 2023
   is 2023, not 2005), and a row that matched the wrong entry can only ever pull the date
   backwards, never forwards. Measured over a 900-game sample it moves 1.1% of modern
   games to retro, every one of them a genuine re-release — Zero Wing on PC, Sonic 2 on
   XBLA, Super 3D Noah's Ark. */
const rngSheetYear = (r) => {
  const y = +r.releaseYear;
  if (y) return y;
  const d = r.releaseDate || r.release;
  return typeof d === "string" ? (+d.slice(0, 4) || 0) : 0;
};
const rngYear = (r) => {
  const sheet = rngSheetYear(r);
  const igdb = +((ENRICH[r._k] || {}).year) || 0;
  if (!sheet) return igdb;
  return igdb && igdb < sheet ? igdb : sheet;
};

/* ---- AAA or indie -------------------------------------------------------
   There is no column for this and there is no clean external field for it either,
   so it's inferred, in a fixed order, most-certain evidence first.

   The publisher lists are stems matched against normCompany() output, and a stem
   matches a publisher that IS it or STARTS WITH it plus a space — so "Nintendo"
   catches "Nintendo of America" and "Sega" catches "Sega of America" without a
   dozen near-duplicate entries. Whole words only: "ea" must not swallow "Easy
   Games", which a plain startsWith would. */
const RNG_MAJORS = [
  "nintendo", "sony", "sony interactive entertainment", "sony computer entertainment",
  "microsoft", "xbox game studios", "microsoft game studios", "microsoft studios",
  "bethesda softworks", "zenimax", "id software",
  "electronic arts", "ea", "ea sports", "ea games", "origin systems",
  "ubisoft", "activision", "activision blizzard", "blizzard entertainment",
  "take two interactive", "rockstar games", "2k", "2k games", "2k sports",
  "square enix", "square", "squaresoft", "enix", "eidos", "eidos interactive",
  "capcom", "konami", "bandai namco", "namco", "namco bandai", "bandai",
  "sega", "atlus", "koei tecmo", "koei", "tecmo",
  "warner bros", "wb games", "thq", "thq nordic", "deep silver",
  "cd projekt", "epic games", "valve", "riot games", "amazon games",
  "disney interactive", "lucasarts", "lucasfilm games",
  "atari", "infogrames", "midway", "midway games", "acclaim", "acclaim entertainment",
  "codemasters", "sierra", "sierra on line", "vivendi", "vivendi games",
  "snk", "snk playmore", "taito", "hudson soft", "irem", "jaleco", "data east",
  "mattel electronics", "coleco", "activision publishing",
  // Not household names, but they fund retail console games with real budgets, which
  // is what the slot is for. Left out of this list they land in the fallback below and
  // a Nacon racing game gets called indie, which it plainly isn't.
  "larian studios", "fromsoftware", "from software", "bungie", "paradox interactive",
  "focus entertainment", "focus home interactive", "nacon", "bigben interactive",
  "plaion", "koch media", "505 games", "kalypso media", "gearbox publishing",
  "private division", "krafton", "nexon", "ncsoft", "hoyoverse", "mihoyo",
  "netease games",
  /* Deliberately NOT here: the niche-JRPG localisers (NIS America, Aksys, XSEED,
     Idea Factory International, Spike Chunsoft, Marvelous). They put out retail
     discs, but a Compile Heart game in a slot labelled "Modern AAA" reads as a bug —
     small-team Japanese games belong on the other side of the line. */
].map(normCompany);

/* Publishers whose whole business is small games. A game here is indie even when
   nothing else about it says so — a Devolver game with a Metacritic score and a
   million sales is still an indie game, and the scale fallback below would
   otherwise call it AAA. */
const RNG_INDIE_LABELS = [
  "devolver digital", "annapurna interactive", "team17", "raw fury", "tinybuild",
  "chucklefish", "curve games", "curve digital", "humble games", "humble bundle",
  "adult swim games", "finji", "playism", "nicalis", "digerati", "fellow traveller",
  "akupara games", "whitethorn games", "serenity forge", "playdigious", "coffee stain",
  "no more robots", "armor games", "thunderful", "ysbryd games", "dangen entertainment",
  "freedom games", "top hat studios", "graffiti games", "neon doctrine", "panic",
  "yacht club games", "playtonic friends", "skybound games", "application systems",
  "the quantum astrophysicists guild", "hypetrain digital", "way down deep",
].map(normCompany);

const rngStemHit = (list, name) =>
  list.some((stem) => name === stem || name.startsWith(stem + " "));
const rngIsMajor = (name) => rngStemHit(RNG_MAJORS, name);
const rngIsIndieLabel = (name) => rngStemHit(RNG_INDIE_LABELS, name);

/* AAA or indie, in the order the evidence actually settles it.

   Indie evidence first, and it outranks everything: a big publisher DISTRIBUTING a small
   game doesn't make the game big. Stardew Valley ships with 505 Games on the box,
   Terraria, Subnautica, Fez, Spelunky, Prison Architect and Mark of the Ninja came out
   through 505, Microsoft Studios or Paradox, and every one of them is indie. The two
   signals are an indie label (RNG_INDIE_LABELS) and IGDB's own Indie genre; sampled at
   random, nearly everything they claim is right.

   Then a major publisher, and that is enough on its own. It used to need an audience too
   — 40 IGDB ratings, later scaled by age — on the theory that majors also put out two-hour
   eShop re-releases that shouldn't count. In practice the bar mostly measured IGDB, not
   budgets: ratings pile onto a game's original entry, so a remaster, a collection, a port
   or a VR spin-off has a fraction of them. StarCraft: Remastered had 37, The Ico & Shadow
   of the Colossus Collection 18, Assassin's Creed Nexus VR 8, and all three were filed as
   indie. Of a random 70 of the 2,096 games the bar was holding back, fewer than five were
   arguably small, and none was independent: Sonic Generations, Dynasty Warriors 8, Tales
   of Symphonia, Wild Hearts, Kirby's Return to Dream Land Deluxe. "Indie" is a claim about
   who made a game, and a Nintendo game made by Nintendo isn't one however few people rated
   it.

   Everything else is indie by default — the publishers nobody listed either way. */
function rngTier(r) {
  const pubs = unifiedPubVals(r).map(normCompany).filter(Boolean);
  if (pubs.some(rngIsIndieLabel)) return "indie";
  if (unifiedGenreVals(r).includes("Indie")) return "indie";
  return pubs.some(rngIsMajor) ? "aaa" : "indie";
}

/* Modern or retro, by the line above. null only when the platform has no generation AND
   nothing knows the year — a console row needs no year to know which shelf it is on. */
function rngIsRetro(r) {
  const plat = String(r.platform || "");
  const y = rngYear(r);
  // A re-release, not just an early date: the game predates the generation AND your copy
  // came out later than the game did. Killzone: Shadow Fall and NBA 2K14 are PS4 launch
  // games dated 2013, copy and game alike, and are modern; Final Fantasy X/X-2 HD on PS4
  // is a 2013 game in a 2015 copy, and is not.
  if (RNG_MODERN_PLATFORMS.has(plat)) return !!y && y < RNG_MODERN_FROM && y < rngSheetYear(r);
  if (RNG_OPEN_PLATFORMS.has(plat) || !plat) return y ? y < RNG_MODERN_FROM : null;
  return true;
}

/* Which of the three a game belongs to, era first: retro is retro whoever published it,
   and the tier only decides the modern half. null when the era can't be decided (an
   undated game on generationless hardware) — that game has no slot (see rngPools), and
   the pin menus put it under "other" rather than guessing which lane it fills. */
const rngSlotOf = (r) => {
  const retro = rngIsRetro(r);
  return retro == null ? null : (retro ? "retro" : rngTier(r));
};

/* ---- the house rules ----------------------------------------------------
   pickEligible() has already answered "is it in the backlog" and "is it playable"
   (it drops completed games and anything Playable isn't Yes for). These are the extra
   ones a roll asks for, because a roll can't explain itself: handed Dragon Age 2 at
   random you would have to work out why. Plan's hand-picked chooser keeps only two of
   them (planAllowed) for exactly that reason. */

// Priority 1 on the sheet is "Will Not Play". A blank priority is rank 0 and stays
// in: it means nobody has ranked the game, not that it was ranked bottom.
const rngPriorityOk = (r) => priorityRank(r.priority) !== 1;

/* Playable without reading the original language. English is tri-state on the sheet
   (None / Partial / Full; blank means it was English to begin with) and a text-heavy
   genre is the part that makes an untranslated game unplayable rather than merely
   foreign — a shmup doesn't care what language it's in. A full translation is a
   translation: those never reach the genre test at all.

   Partial counts as unreadable, which is the one place this is stricter than
   challenges.js's is_playable_by_language. A half-patched JRPG is exactly the trap,
   and the 38 games it costs are 14 Turn-Based RPGs, 6 Action RPGs and 2 visual novels.

   The genre, though, is the SHEET's own cell and not the unified sheet+IGDB set. IGDB
   hangs a broad "Adventure" or "Strategy" on plenty of games that are nothing of the
   sort, so reading the union quietly excluded Bomberman GB 3, Itadaki Street DS and
   Densetsu no Stafy — a puzzle game, a board game and a platformer, none of which
   needs a word of Japanese. The sheet's genre is one deliberate value per game, which
   is the right vocabulary for a question about how much text a game puts on screen. */
const RNG_UNREADABLE = new Set(["None", "Partial"]);
function rngLanguageOk(r) {
  if (!RNG_UNREADABLE.has(r.english)) return true;
  if (typeof CH_TEXT_GENRES === "undefined") return true;
  return !CH_TEXT_GENRES.has(r.genre);
}

/* Genres where the story is the game, so entry N assumes entry N-1. Everything else
   is a series you can walk into: nobody needs Mario Kart 7 to understand Mario Kart 8,
   and blocking every numbered sequel would empty the pool for no reason. */
const RNG_STORY_GENRES = new Set([
  "RPG", "Action RPG", "Computer RPG", "Turn-Based RPG", "Strategy RPG", "MMORPG",
  "Dungeon Crawler", "Adventure", "Action Adventure", "Visual Novel",
  "Point-and-Click", "Text Adventure", "Survival Horror",
]);
const rngIsStoryGame = (r) => unifiedGenreVals(r).some((g) => RNG_STORY_GENRES.has(g));

/* franchise -> every entry we know of, as {year, done}. Built from BOTH sheets: the
   games sheet knows what's sitting unplayed, the completed sheet knows what's been
   finished (including games long since off the shelf).

   Keyed on _enrichEpoch as well as DATA, because unifiedFranchiseVals reads IGDB's
   franchises on top of the sheet's column — so this index genuinely changes as
   enrichment lands, and one built early knows about far fewer series than it should. */
let _rngSeries = null, _rngSeriesFor = null, _rngSeriesEpoch = null;
function rngSeriesIndex() {
  if (_rngSeries && _rngSeriesFor === DATA && _rngSeriesEpoch === _enrichEpoch) return _rngSeries;
  const m = new Map();
  const add = (r, done) => {
    const y = rngYear(r);
    if (!y) return;                       // an entry with no year can't be "the one before"
    for (const f of unifiedFranchiseVals(r)) {
      let l = m.get(f);
      if (!l) m.set(f, l = []);
      l.push({ y, done });
    }
  };
  for (const r of ((DATA.sheets.games || {}).rows || [])) if (r.title) add(r, !!r.completed);
  for (const r of ((DATA.sheets.completed || {}).rows || [])) add(r, true);
  _rngSeriesFor = DATA; _rngSeriesEpoch = _enrichEpoch;
  return (_rngSeries = m);
}

/* "Don't hand me Dragon Age 2 when Origins is still shrink-wrapped." An earlier
   entry of the same franchise that you own and haven't finished IS the prerequisite,
   so the game waits its turn.

   Only what's in the library counts. A prequel you don't own can't be a thing you
   were going to play first, and treating "IGDB says the series started in 1997" as a
   blocker would rule out every series you joined late. Same-year entries don't block
   either: two games shipped in one year aren't in an order. */
/* A compilation IS the earlier entries, so "an earlier entry is unfinished" says
   nothing about it — Mass Effect Legendary Edition contains Mass Effect 1, and the
   Ace Attorney Trilogy is where the series starts. The sheet's own Compilation genre
   catches most of them; the title pattern catches the rest, because a bundle is one
   of the few things games reliably announce in their name. */
const RNG_COMPILATION = /\b(collection|trilogy|anthology|compilation|bundle|legacy edition|legendary edition|complete edition)\b/i;
const rngIsCompilation = (r) =>
  RNG_COMPILATION.test(String(r.title || "")) || unifiedGenreVals(r).includes("Compilation");

function rngSeriesOk(r) {
  if (!rngIsStoryGame(r) || rngIsCompilation(r)) return true;
  const y = rngYear(r);
  if (!y) return true;
  const idx = rngSeriesIndex();
  for (const f of unifiedFranchiseVals(r)) {
    const l = idx.get(f);
    if (l && l.some((e) => e.y < y && !e.done)) return false;
  }
  return true;
}

/* DLC is the same rule wearing a different hat: an expansion needs the game it
   expands, which is a prerequisite by definition. It's a sheet column, so this one
   needs no inference.

   Ownership is deliberately NOT a rule. Playable is the sheet's own answer to "can I
   actually start this", and it says Yes to plenty of games that aren't on the shelf —
   emulated, on the NAS, in a subscription. Requiring `owned` on top of it threw away
   half the library to answer a question Playable had already answered. Owning a
   physical copy still counts for something, but as odds (rngWeightOf), not as a gate. */
const rngAllowed = (r) =>
  !r.dlc && rngPriorityOk(r) && rngLanguageOk(r) && rngSeriesOk(r);

/* ---- now playing: the playthrough you already started --------------------
   Each track can be pinned to the game you're playing in it right now. Plan shows that
   game at the head of the track, above the queue — it is what the queue comes AFTER.

   Only a game the sheet marks Playing can be pinned. That column is where "what am I
   actually playing" already lives, and this has no business inventing a second answer
   to it — Up Next and On Hold are the other two things it says, and a track held by a
   game you've shelved would say "now playing" about something you aren't.


   The pins live in prefs (extras.js, server-backed with a localStorage mirror) rather
   than in the tab's URL: a pin is a fact about the next few weeks, not about the link
   you shared, and it has to be the same on the phone and on the desktop. Stored as
   [{slot, key}] — the row's match key, never the row, because every sheet reload builds
   new row objects and a held one would go stale the first time the data refreshed.
   `slot` is the track id; the pref predates Plan and keeps its old field name so the
   pins already saved carry straight over. */
const rngIsPlaying = (r) => r.playingStatus === "Playing" && !r.completed;

// Pinnable games: the sheet's own Playing list, in title order so the menus are stable
// between renders. Deliberately NOT filtered by pickEligible or the house rules — you're
// playing it, which settles every question those rules ask.
const rngPlayingRows = () =>
  ((DATA.sheets.games || {}).rows || [])
    .filter((r) => r.title && rngIsPlaying(r))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));

const rngPinList = () => (typeof prefsLocal === "function" ? prefsLocal("pins") : []);

/* track -> match key. A pin naming a track that doesn't exist is dropped rather than
   kept: the three tracks are a fixed set, and a stale entry from an older shape must not
   hold a lane that can no longer be reached. */
function rngPinKeys() {
  const out = { aaa: null, indie: null, retro: null };
  for (const p of rngPinList()) if (p && p.key && p.slot in out) out[p.slot] = p.key;
  return out;
}
const rngPinSig = () => {
  const k = rngPinKeys();
  return RNG_SLOTS.map((s) => k[s.id] || "-").join(",");
};

// Match key -> row, over the games sheet. Rebuilt when the sheet is, which is the only
// thing that can change the answer (a pin is resolved on every render).
let _rngByKey = null, _rngByKeyFor = null;
function rngRowByKey(k) {
  if (!_rngByKey || _rngByKeyFor !== DATA) {
    _rngByKey = new Map();
    for (const r of ((DATA.sheets.games || {}).rows || [])) if (r._k) _rngByKey.set(r._k, r);
    _rngByKeyFor = DATA;
  }
  return _rngByKey.get(k) || null;
}

/* Write a pin (or clear one with key = null). A game can only hold one track, so pinning
   it somewhere new MOVES it rather than leaving the old track showing a game that is also
   showing two lanes over. The caller re-renders. */
function rngPin(slotId, key) {
  const rest = rngPinList().filter((p) => p && p.slot !== slotId && p.key !== key);
  prefsSave("pins", key ? [...rest, { slot: slotId, key }] : rest);
}

/* Resolve every pin against the sheet, and drop the ones that no longer hold up: the game
   was removed, or finished, or the Playing flag came off it. A pin is a claim about what
   you're playing, so when the sheet stops saying that, the track stops saying it too —
   the alternative is a lane forever headed by a game you finished in March.

   Returns track -> row (null where nothing is pinned). One write for however many went
   stale, and only when something actually did — this runs on every render, and an
   unconditional save would be a PUT per repaint. */
function rngPinnedRows() {
  const keys = rngPinKeys();
  const out = { aaa: null, indie: null, retro: null };
  const stale = [];
  for (const s of RNG_SLOTS) {
    const k = keys[s.id];
    if (!k) continue;
    const row = rngRowByKey(k);
    if (row && rngIsPlaying(row)) out[s.id] = row;
    else stale.push(k);
  }
  if (stale.length) prefsSave("pins", rngPinList().filter((p) => p && !stale.includes(p.key)));
  return out;
}

/* ---- the three pools ----------------------------------------------------
   Straight off pickEligible() (the backlog, playable, unfinished) rather than
   pickPool(): a roll here has no criteria builder on screen, and a filter left behind on
   the Pick tab silently shrinking a roll you can't see the criteria for is worse than
   not offering the filter at all — the house rules are the whole story.

   Keyed on _enrichEpoch, the counter every other memo in this app uses (filters.js owns
   it). Nearly every rule here reads enrichment — the tier reads publishers, the language
   and series rules read genres and franchises — so the pools really do change as
   batches land. */
let _rngPools = null, _rngPoolsFor = null, _rngPoolsEpoch = null, _rngPoolsPins = null;
function rngPools() {
  const pins = rngPinSig();
  if (_rngPools && _rngPoolsFor === DATA && _rngPoolsEpoch === _enrichEpoch
      && _rngPoolsPins === pins) return _rngPools;
  const pinned = new Set(Object.values(rngPinKeys()).filter(Boolean));
  const out = { aaa: [], indie: [], retro: [] };
  for (const r of pickEligible()) {
    if (!rngAllowed(r)) continue;
    // A pinned game is spoken for, and it can be pinned to a track other than the one it
    // classifies into — so it comes out of ALL three pools rather than just its own.
    if (pinned.has(r._k)) continue;
    // No era, no track: a game that can't say which side of the generation line it's on
    // would have to be guessed into one, and a guess is not a rule.
    const id = rngSlotOf(r);
    if (id) out[id].push(r);
  }
  _rngPoolsFor = DATA; _rngPoolsEpoch = _enrichEpoch; _rngPoolsPins = pins;
  return (_rngPools = out);
}

/* ---- the draw -----------------------------------------------------------
   Owned physical copies get three times the tickets in the two modern tracks; everything
   else (a digital copy, or a game that's playable without being owned) gets one. Not
   "physical, or digital only if there are no physical" — with a shelf this size that
   rule means a digital game is never picked at all, and "prefer" doesn't mean never.
   The retro track rolls flat: a retro shelf is physical almost by definition, so
   weighting it would only add noise. */
const RNG_PHYS_WEIGHT = 3;
const rngOwnedPhysical = (r) => !!r.owned && /physical/i.test(String(r.format || ""));
const rngWeightOf = (slotId) => (slotId === "retro"
  ? () => 1
  : (r) => (rngOwnedPhysical(r) ? RNG_PHYS_WEIGHT : 1));

function rngWeightedPick(pool, weight) {
  let total = 0;
  for (const r of pool) total += weight(r);
  let x = Math.random() * total;
  for (const r of pool) {
    x -= weight(r);
    if (x < 0) return r;
  }
  return pool[pool.length - 1];          // float drift only; the loop normally returns
}
