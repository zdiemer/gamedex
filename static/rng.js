"use strict";

/* ---- RNG: three games, one roll ----------------------------------------
   The regular picker answers "what do I play tonight" with one game. This mode
   answers the other question people actually ask a random picker: give me a
   SHAPE for the next stretch. Three slots, rolled together:

     * one modern AAA game    (2006 or later, big-budget)
     * one modern indie game  (2006 or later, small)
     * one retro game         (before 2006)

   It shares the tab but not its controls. The criteria builder, the "start from"
   preset, the time budget and the saved pickers all belong to the single pick and
   are not rendered here; this mode rolls the whole backlog, split three ways, under
   four house rules the general picker deliberately doesn't have (see rngAllowed),
   plus the "playable on the go" knob when you turn it on (see rngToGoOk).
   Which means what the three slot counts say is exactly what it rolls from.

   A slot can also be PINNED to a game you're already playing, in which case it doesn't
   roll at all and the roll button says so (see the pins section below). Three slots is
   a shape for the next stretch, and most of the time one or two of those lanes are
   already filled by a playthrough in progress.

   Loaded straight after pick.js, whose globals it shares (pickState, pickPool,
   pickRollTile, pickAnimOn, DATA, ENRICH, openDrawer, …). challenges.js loads
   later in index.html, so the one thing borrowed from it — CH_TEXT_GENRES — is
   read behind a typeof guard, the way pick.js reads isCandidate. */

const RNG_SLOTS = [
  { id: "aaa",   label: "Modern AAA",   icon: "i-trophy",  tint: "var(--accent)",
    hint: "Big-budget, 2006 or later" },
  { id: "indie", label: "Modern indie", icon: "i-star",    tint: "var(--accent-2)",
    hint: "Small team, 2006 or later" },
  { id: "retro", label: "Retro",        icon: "i-clock",   tint: "var(--warn)",
    hint: "Released before 2006" },
];
const rngSlot = (id) => RNG_SLOTS.find((s) => s.id === id);
// toGo: the "playable on the go" knob (see rngToGoOk). Off by default, and it rides in
// the URL like the mode does, so a link carries the roll you were actually looking at.
const rngState = { picks: { aaa: null, indie: null, retro: null }, toGo: false };

/* The modern/retro line. Not eraTags' "Retro (pre-2000)": that bucket is about the
   century, and this one is about the hardware — 2006 is the 360/PS3/Wii line, so
   the PS2 and GameCube shelves count as retro here. The two deliberately disagree,
   which is why this is its own constant and not a reuse of that facet. */
const RNG_RETRO_BEFORE = 2006;

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

/* How many people IGDB has seen play it. AAA is a budget, and no field records a budget,
   but reach is downstream of one: the flagships are the games thousands of people rated.
   Elden Ring 2206, Mario Odyssey 1836, Ghost of Tsushima 1074, Helldivers II 297. Against
   Roguebook at 12 and Murasame Castle at 10.

   40 is where the boundary reads right — Forspoken, Hyrule Warriors: Definitive Edition,
   Twisted Metal and Tearaway Unfolded sit just inside it, MudRunner and Tropico 3 just
   outside. Not criticCount, which looked like the same signal and isn't: IGDB's critic
   aggregate is sparse and arbitrary (LocoCycle has 10, Zelda: Tears of the Kingdom has 6),
   so gating on it let games nobody has played in on the strength of ten reviews. */
const RNG_AAA_MIN_AUDIENCE = 40;
const rngAudience = (r) => (ENRICH[r._k] || {}).userRatingCount || 0;

/* AAA or indie, in the order the evidence actually settles it.

   A major publisher is NECESSARY but not SUFFICIENT, which is the whole correction here:
   these companies publish flagships and they also publish two-hour eShop re-releases, and
   the old rule called both AAA. So the majors list picks out who could fund a big game,
   and the audience threshold asks whether this particular one was.

   Indie evidence outranks the major, because a big publisher DISTRIBUTING a small game
   doesn't make the game big. Stardew Valley ships with 505 Games on the box and was
   landing in AAA on that alone; Terraria, Subnautica, Fez, Spelunky, Prison Architect and
   Mark of the Ninja all did the same through 505, Microsoft Studios or Paradox. The two
   overrides between them move 35 games and every one belongs on the indie side.

   Everything else is indie by default, so the old "indie signals" (self-published, an
   itch.io release, an indie keyword) are gone: they all resolved to the fallback anyway,
   and only the two that can beat a major still change an answer. */
function rngTier(r) {
  const pubs = unifiedPubVals(r).map(normCompany).filter(Boolean);
  if (pubs.some(rngIsIndieLabel)) return "indie";
  if (unifiedGenreVals(r).includes("Indie")) return "indie";
  return (pubs.some(rngIsMajor) && rngAudience(r) >= RNG_AAA_MIN_AUDIENCE) ? "aaa" : "indie";
}

/* Which of the three a game belongs to, era first: before 2006 is retro whoever published
   it, and the tier only decides the modern half. null when nothing knows the year — that
   game has no slot (see rngPools), and the pin menus put it under "other" rather than
   guessing which lane it fills. */
const rngSlotOf = (r) => {
  const y = rngYear(r);
  return !y ? null : (y < RNG_RETRO_BEFORE ? "retro" : rngTier(r));
};

/* ---- the house rules ----------------------------------------------------
   pickPool() has already answered "is it in the backlog" and "is it playable"
   (pickEligible drops completed games and anything Playable isn't Yes for). These
   are the extra ones this mode asks for. */

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

/* ---- playable on the go -------------------------------------------------
   A knob, not a rule: off by default, and when it's on all three slots narrow to games
   you could actually start on a train. Three questions, because "portable" means three
   different things depending on what the game runs on.

   1. A PC game has to be Deck-playable, and we take Valve's own word for it: the deck
      rating (steamx.py, via Valve's compatibility endpoint) has to say Verified or
      Playable. Unsupported is out, and so is no rating at all — which is also how
      non-Steam PC games are excluded, since no Steam appid means no rating, and that
      was the simplification asked for. It leaves ~2,400 of the 3,880 PC games in.

   2. Every other platform is a question about the HARDWARE, and the honest list is the
      short one: what you can't take with you. Handhelds are portable by definition, and
      a Deck emulates everything up to the PS2/GameCube/Wii/Wii U era, so the exclusions
      are the home consoles too recent to emulate plus a handful of set-top oddities.
      An unlisted platform stays, which is the right default for a library with 145 of
      them and a long tail of one-game machines.

   3. Two genres are out however they run: VR needs a headset, and point-and-click wants
      a mouse and a table. Both are sheet/IGDB facts, so neither needs inference. */
const RNG_PC_PLATFORMS = new Set(["pc", "mac os", "linux"]);
const RNG_DECK_OK = new Set(["Verified", "Playable"]);
const RNG_NOT_PORTABLE = new Set([
  // Home consoles with no practical Deck emulation.
  "PlayStation 3", "PlayStation 4", "PlayStation 5", "PlayStation Network",
  "Xbox", "Xbox 360", "Xbox One", "Xbox Series X|S",
  // Needs a headset and a room (the VR rule below catches most of these anyway).
  "Oculus Quest",
  // Not a machine you carry, whatever else it is.
  "DVD Player", "Pioneer LaserActive", "Nuon", "Action Max", "Dedicated Console",
  "Amazon Fire TV", "Sega Pico", "Zeebo", "Mainframe",
]);

function rngToGoOk(r) {
  if (r.vr) return false;
  if (unifiedGenreVals(r).includes("Point-and-Click")) return false;
  const plat = String(r.platform || "");
  if (RNG_PC_PLATFORMS.has(plat.toLowerCase()))
    return RNG_DECK_OK.has((ENRICH[r._k] || {}).deck);
  return !RNG_NOT_PORTABLE.has(plat);
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
  !r.dlc && rngPriorityOk(r) && rngLanguageOk(r) && rngSeriesOk(r)
  && (!rngState.toGo || rngToGoOk(r));

/* ---- pinned slots: the playthrough you already started -------------------
   Three slots is a shape for the next stretch — a modern one, an indie one and a retro
   one on the go at once — and a shape you're halfway into already. So a slot can be
   pinned to a game, and a pinned slot doesn't roll: "Roll all three" becomes "Roll the
   other two", the pinned game stays exactly where it is, and its pool drops out of the
   count the roll quotes, because none of it is reachable.

   Only a game the sheet marks Playing can be pinned. That column is where "what am I
   actually playing" already lives, and this mode has no business inventing a second
   answer to it — Up Next and On Hold are the other two things it says, and a slot held
   by a game you've shelved is a slot that never rolls again.

   The pins live in prefs (extras.js, server-backed with a localStorage mirror) rather
   than in the tab's URL: a pin is a fact about the next few weeks, not about the link
   you shared, and it has to be the same on the phone and on the desktop. Stored as
   [{slot, key}] — the row's match key, never the row, because every sheet reload builds
   new row objects and a held one would go stale the first time the data refreshed. */
const rngIsPlaying = (r) => r.playingStatus === "Playing" && !r.completed;

// Pinnable games: the sheet's own Playing list, in title order so the menus are stable
// between renders. Deliberately NOT filtered by pickEligible or the house rules — you're
// playing it, which settles every question those rules ask.
const rngPlayingRows = () =>
  ((DATA.sheets.games || {}).rows || [])
    .filter((r) => r.title && rngIsPlaying(r))
    .sort((a, b) => String(a.title).localeCompare(String(b.title)));

const rngPinList = () => (typeof prefsLocal === "function" ? prefsLocal("pins") : []);

/* slot -> match key. A pin naming a slot that doesn't exist is dropped rather than kept:
   the three slots are a fixed set, and a stale entry from an older shape must not hold a
   column that can no longer be reached. */
function rngPinKeys() {
  const out = { aaa: null, indie: null, retro: null };
  for (const p of rngPinList()) if (p && p.key && p.slot in out) out[p.slot] = p.key;
  return out;
}
const rngPinSig = () => {
  const k = rngPinKeys();
  return RNG_SLOTS.map((s) => k[s.id] || "-").join(",");
};
const rngIsPinned = (slotId) => !!rngPinKeys()[slotId];
const rngFreeSlots = () => RNG_SLOTS.filter((s) => !rngIsPinned(s.id));

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

/* Write a pin (or clear one with key = null). A game can only hold one slot, so pinning
   it somewhere new MOVES it rather than leaving the old lane stuck on a game that is
   also showing two columns over. */
function rngPin(slotId, key) {
  const rest = rngPinList().filter((p) => p && p.slot !== slotId && p.key !== key);
  prefsSave("pins", key ? [...rest, { slot: slotId, key }] : rest);
  renderPicker();
}

/* Resolve every pin against the sheet, and drop the ones that no longer hold up: the game
   was removed, or finished, or the Playing flag came off it. A pin is a claim about what
   you're playing, so when the sheet stops saying that, the slot goes back to rolling —
   the alternative is a lane silently held forever by a game you finished in March.

   Returns nothing; it writes rngState.picks for the pinned slots, which is what puts the
   pinned game on screen through the same card, patch and drawer paths as a rolled one. */
function rngSyncPins() {
  const keys = rngPinKeys();
  const stale = [];
  for (const s of RNG_SLOTS) {
    const k = keys[s.id];
    if (!k) continue;
    const row = rngRowByKey(k);
    if (row && rngIsPlaying(row)) rngState.picks[s.id] = row;
    else stale.push(k);
  }
  // One write for however many went stale, and only when something actually did — this
  // runs on every render, and an unconditional save would be a PUT per repaint.
  if (stale.length) prefsSave("pins", rngPinList().filter((p) => p && !stale.includes(p.key)));
}

/* ---- the three pools ----------------------------------------------------
   Straight off pickEligible() (the backlog, playable, unfinished) rather than
   pickPool(): RNG mode shows no criteria builder, no preset and no saved pickers, so
   there is nothing on screen that could be narrowing this. A filter left behind on the
   other mode silently shrinking a roll you can't see the criteria for is worse than
   not offering the filter at all — the slots' own rules are the whole story here.

   Keyed on _enrichEpoch, the counter every other memo in this app uses (filters.js owns
   it; catalogue, recs, relations, similar and challenges all key off it). Nearly every
   rule here reads enrichment — the tier reads publishers, the language and series rules
   read genres and franchises, the on-the-go knob reads the Deck rating — so the pools
   really do change as batches land.

   This was keyed on ENRICH_COMPLETE, which is a boolean that is already true when the
   bulk map is still filling in, so the cache never invalidated: the counts on screen
   were computed against whatever enrichment happened to have arrived by the first paint,
   and were out by about a thousand games. */
let _rngPools = null, _rngPoolsFor = null, _rngPoolsEpoch = null, _rngPoolsToGo = null,
    _rngPoolsPins = null;
function rngPools() {
  const pins = rngPinSig();
  if (_rngPools && _rngPoolsFor === DATA && _rngPoolsEpoch === _enrichEpoch
      && _rngPoolsToGo === rngState.toGo && _rngPoolsPins === pins) return _rngPools;
  const pinned = new Set(Object.values(rngPinKeys()).filter(Boolean));
  const out = { aaa: [], indie: [], retro: [] };
  for (const r of pickEligible()) {
    if (!rngAllowed(r)) continue;
    // A pinned game is spoken for, and it can be pinned to a slot other than the one it
    // classifies into — so it comes out of ALL three pools rather than just its own, or
    // a free slot could roll the game already sitting two columns over.
    if (pinned.has(r._k)) continue;
    // No release year, no slot: a game that can't say which side of 2006 it's on
    // would have to be guessed into one, and a guess is not a rule.
    const id = rngSlotOf(r);
    if (id) out[id].push(r);
  }
  _rngPoolsFor = DATA; _rngPoolsEpoch = _enrichEpoch; _rngPoolsToGo = rngState.toGo;
  _rngPoolsPins = pins;
  return (_rngPools = out);
}

/* ---- the roll -----------------------------------------------------------
   Owned physical copies get three times the tickets in the two modern slots; everything
   else (a digital copy, or a game that's playable without being owned) gets one. Not
   "physical, or digital only if there are no physical" — with a shelf this size that
   rule means a digital game is never picked at all, and "prefer" doesn't mean never.
   The retro slot rolls flat: a retro shelf is physical almost by definition, so
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

// Re-rolling a slot and getting the same game back reads as a broken button, so the
// game on screen sits out its own re-roll whenever there's anything else to land on.
function rngRoll(slotId) {
  // A pinned slot is not a slot that rolls. Guarded here rather than only at the two call
  // sites so nothing added later can roll one out from under you by accident.
  if (rngIsPinned(slotId)) return rngState.picks[slotId];
  const pool = rngPools()[slotId] || [];
  const prev = rngState.picks[slotId];
  const from = (prev && pool.length > 1) ? pool.filter((r) => r !== prev) : pool;
  return (rngState.picks[slotId] = from.length ? rngWeightedPick(from, rngWeightOf(slotId)) : null);
}
const rngHasPicks = () => RNG_SLOTS.some((s) => rngState.picks[s.id]);

/* A pick only survives while it's still in its slot. A sheet reload can finish a game,
   sell it, or move its year across the 2006 line — showing it anyway would be the
   picker telling you it picked something the slot doesn't contain.

   Pins go first and are then left alone: a pinned game is held by your say-so rather than
   by the pool, it isn't IN the pool (rngPools drops it), and the rules the pool applies —
   priority, series order, the on-the-go knob — are about choosing a game, not about one
   you're already playing. */
function rngPrune() {
  rngSyncPins();
  const pools = rngPools();
  for (const s of RNG_SLOTS) {
    if (rngIsPinned(s.id)) continue;
    const p = rngState.picks[s.id];
    if (p && !pools[s.id].includes(p)) rngState.picks[s.id] = null;
  }
}

/* Turning the knob is a change to the pool, not to the picks: whatever still qualifies
   stays on screen (rngPrune drops the rest), so switching it on tells you which of the
   three you could have taken with you rather than silently re-rolling all of them. */
function rngSetToGo(on) {
  if (rngState.toGo === on) return;
  rngState.toGo = on;
  renderPicker();
}

/* What the roll button does, said out loud. It stops being "all three" the moment a slot
   is pinned, and a button that still promised three while rolling one would be the tab
   describing a different roll than the one it performs. */
function rngRollLabel() {
  const free = rngFreeSlots();
  if (!free.length) return "All three slots are pinned";
  const again = free.some((s) => rngState.picks[s.id]);
  if (free.length === 1) return again ? "Roll the free slot again" : "Roll the free slot";
  if (free.length === 2) return again ? "Roll the other two again" : "Roll the other two";
  return again ? "Roll all three again" : "Roll all three";
}

function rngRollAll(roll) {
  if (rngLoading()) return;
  const pools = rngPools();
  const free = rngFreeSlots();
  if (!free.length) return;                  // everything is pinned; nothing to roll
  for (const s of free) rngRoll(s.id);
  if (roll && free.some((s) => rngState.picks[s.id]) && pickAnimOn() && !pickReduced())
    playRngRoll(pools);
  else renderPicker();
}

function rngRollOne(slotId, roll) {
  if (rngLoading() || rngIsPinned(slotId)) return;
  const pool = rngPools()[slotId] || [];
  rngRoll(slotId);
  const host = document.querySelector(`#pickResult .rng-slot[data-slot="${slotId}"]`);
  if (roll && rngState.picks[slotId] && host && pickAnimOn() && !pickReduced())
    playRngSlotRoll(host, rngSlot(slotId), rngState.picks[slotId], pool);
  else renderPicker();
}

/* Has the data these slots are DECIDED by actually arrived? Which slot a game lands in
   reads its publishers, its genres and IGDB's rating count, and its era reads IGDB's
   first release year — all of it in the bulk enrichment map. Before that map lands the
   answer to every slot is zero, and a slot that says "Nothing in your library fits this
   slot" while it is still reading is not empty, it is lying. So the tab shimmers instead,
   and loadAllEnrichment re-renders it on arrival (panels.js).

   ENRICH_READY, not ENRICH_COMPLETE: complete means the SERVER has finished backfilling
   every source, which can be false for hours; ready means the map is here, which is when
   these answers stop moving. It is also set in a finally block, so a failed fetch releases
   the skeleton rather than shimmering forever. */
const rngLoading = () =>
  typeof ENRICH_ENABLED !== "undefined" && ENRICH_ENABLED && !ENRICH_READY;

/* ---- the cards ----------------------------------------------------------
   Three columns, each one an eyebrow saying which slot it is, the REAL grid card
   (so the hover trailer works here exactly as it does in the listings), and the
   two things you'd do next: roll this one again, or go and read about it.

   A pinned column is the same card with the roll taken out of it: the count in the
   eyebrow says "Pinned" instead of a pool it can't reach, the chip row says you're
   playing it, and Re-roll becomes Unpin. */
function rngSlotHtml(slot, pool) {
  const row = rngState.picks[slot.id];
  const pinned = rngIsPinned(slot.id);
  const head = `<div class="rng-head">
      <span class="rng-eye">${icon(slot.icon, 12)} ${escapeHtml(slot.label)}</span>
      ${pinned
        ? `<span class="rng-n pinned" title="Pinned to a game you're playing — this slot doesn't roll">${icon("i-pin", 11)} Pinned</span>`
        : `<span class="rng-n" title="Games in this slot's pool">${pool.length.toLocaleString()}</span>`}
    </div>`;
  const box = (inner, cls = "") =>
    `<div class="rng-slot${cls}" data-slot="${slot.id}" style="--slot: ${slot.tint}">${head}${inner}</div>`;

  if (!row) {
    return box(`<div class="rng-blank">
        <span class="rng-blank-ico">${icon(pool.length ? "i-dice" : "i-alert", 24)}</span>
        <p>${pool.length ? "Roll to fill this slot." : "Nothing in your library fits this slot."}</p>
        <span class="rng-hint">${escapeHtml(slot.hint)}</span>
        ${rngPinMenuHtml(slot.id)}
      </div>`, " rng-off");
  }

  const rec = igdbRecOf(row);
  const cs = coverSrc(rec, "cover_big");
  const pend = coverPending(row);
  const pixel = coverIsPixelArt(rec, cs) ? " pixel" : "";
  const cover = cs
    ? `<img class="card-cover${pixel}" src="${escapeHtml(cs)}" alt="">`
    : `<div class="card-cover ph${pend ? " skel" : ""}">${pend ? "" : icon("i-library", 26)}</div>`;
  const cstat = collectionStatus(row);
  const cls = "card" + (cstat === "partial" ? " partial"
    : (cstat === "complete" || rowCompleted(row)) ? " done" : "");
  const card = `<div class="${cls}" data-rngcard="${slot.id}">${cover}${vrBadgeHtml(row)}<div class="card-body">${cardBodyHtml(row)}</div></div>`;

  const copy = rngCopyChip(row);
  const time = rngTimeChip(row);

  /* Pin, on the card in front of you, but only when the sheet already calls this one
     Playing — the button can't make that true, and a pin that didn't mean "in progress"
     would be a second, quieter status column nobody maintains. Everything else you might
     want to pin is in the menu below, which lists the rest of the Playing games. */
  const acts = pinned
    ? `<button class="rng-open" data-unpin="${slot.id}">${icon("i-pin", 13)} Unpin</button>
       <button class="rng-open" data-open="${slot.id}">Details</button>`
    : `<button class="rng-re" data-reroll="${slot.id}">${icon("i-refresh", 13)} Re-roll</button>
       ${rngIsPlaying(row)
         ? `<button class="rng-open" data-pinnow="${slot.id}" title="Hold this slot: it stops rolling until you unpin it">${icon("i-pin", 13)} Pin</button>`
         : ""}
       <button class="rng-open" data-open="${slot.id}">Details</button>`;

  return box(`<div class="rng-art">${card}</div>
    <div class="rng-body">
      <h3 title="${escapeHtml(String(row.title))}">${escapeHtml(String(row.title))}</h3>
      <div class="rng-chips">${pinned ? rngPlayingChip() : ""}${copy}${time}${rngChipsHtml(row)}</div>
      <div class="rng-acts">${acts}</div>
      ${pinned ? "" : rngPinMenuHtml(slot.id)}
    </div>`, pinned ? " rng-pinned" : "");
}

const rngPlayingChip = () =>
  `<span class="rng-copy playing">${icon("i-play", 11)} Now playing</span>`;

/* The other way in: every game the sheet marks Playing, so a lane can be filled by a
   playthrough that started long before this tab rolled anything.

   Two groups, because which slot a game fits is inferred (rngSlotOf) and inference gets
   things wrong — the ones this slot would have rolled come first, and the rest are still
   listed rather than hidden. Pinning from a slot pins to THAT slot whatever the classifier
   thought, because the three lanes are yours to shape and a game with no known year would
   otherwise be pinnable nowhere at all. */
function rngPinMenuHtml(slotId) {
  const rows = rngPlayingRows().filter((r) => !Object.values(rngPinKeys()).includes(r._k));
  if (!rows.length) return "";
  const opt = (r) => `<option value="${escapeHtml(String(r._k))}">${escapeHtml(String(r.title))}${
    r.platform ? ` · ${escapeHtml(String(r.platform))}` : ""}</option>`;
  const fits = rows.filter((r) => rngSlotOf(r) === slotId);
  const rest = rows.filter((r) => rngSlotOf(r) !== slotId);
  return `<div class="rng-pinsel">
      <select data-pin="${slotId}" aria-label="Pin a game you're playing to this slot">
        <option value="">Pin a game you're playing…</option>
        ${fits.length ? `<optgroup label="Fits this slot">${fits.map(opt).join("")}</optgroup>` : ""}
        ${rest.length ? `<optgroup label="Other games you're playing">${rest.map(opt).join("")}</optgroup>` : ""}
      </select>
    </div>`;
}

/* The copy you'd actually reach for. Physical is the one thing this mode weights the roll
   on, so the card says whether that's what won rather than leaving you to open the drawer,
   and a game that's playable without being owned has to say so too, or the badge would
   call an emulated ROM "Digital" and read as a copy you have. */
function rngCopyChip(row) {
  if (!row.owned)
    return `<span class="rng-copy none">${icon("i-alert", 11)} ${row.wishlisted ? "Wishlisted" : "Not owned"}</span>`;
  return rngOwnedPhysical(row)
    ? `<span class="rng-copy phys">${icon("i-package", 11)} On the shelf</span>`
    : `<span class="rng-copy">${icon("i-play", 11)} Digital</span>`;
}

/* How long it takes to beat. It's the question that decides whether tonight's pick is
   tonight's pick, and it was a click away in the drawer. playtimeOf is the same chain the
   rest of the app uses (HowLongToBeat, then VNDB for visual novels, then the sheet's own
   estimate), and the chip stays off the card entirely when nothing knows: a blank clock
   reads as "zero hours", which is worse than not saying. It arrives with enrichment, so
   rngPatch re-renders this row rather than leaving a card that never learns. */
function rngTimeChip(row) {
  const hrs = playtimeOf(row);
  return hrs != null
    ? `<span class="chip rng-time" title="How long to beat">${icon("i-clock", 11)} ${escapeHtml(fmtHours(hrs))}</span>`
    : "";
}

const rngChipsHtml = (row) => [row.platform, rngYear(row) || null, row.genre]
  .filter((x) => x != null && x !== "")
  .map((x) => `<span class="chip">${escapeHtml(String(x))}</span>`).join("");

// A slot mid-load: the same box, the same eyebrow, and a shimmer where the count, the
// cover and the title will be. Shaped like the card it becomes, so nothing jumps.
function rngSkeletonHtml(slot) {
  return `<div class="rng-slot loading" data-slot="${slot.id}" style="--slot: ${slot.tint}">
    <div class="rng-head">
      <span class="rng-eye">${icon(slot.icon, 12)} ${escapeHtml(slot.label)}</span>
      <span class="rng-n skel"></span>
    </div>
    <div class="rng-art"><div class="rng-skel-art skel"></div></div>
    <div class="rng-body">
      <div class="skel skel-line"></div>
      <div class="skel skel-line short"></div>
    </div>
  </div>`;
}

/* What a roll can actually reach: the free slots' pools. A pinned slot's pool is real
   enough, but nothing in it can be rolled while the pin holds, so counting it would quote
   a number the button can't deliver. */
function rngPoolCount() {
  const pools = rngPools();
  return rngFreeSlots().reduce((n, s) => n + pools[s.id].length, 0);
}

function rngResultHtml() {
  if (rngLoading())
    return `<div class="rng-grid">${RNG_SLOTS.map(rngSkeletonHtml).join("")}</div>`;
  const pools = rngPools();
  const total = RNG_SLOTS.reduce((n, s) => n + pools[s.id].length, 0);
  // An empty library empties the grid — unless a slot is pinned, in which case there IS
  // something to show and hiding it would lose the card holding the pin.
  if (!total && rngFreeSlots().length === RNG_SLOTS.length) {
    return `<div class="pick-empty">Nothing in your library clears all three slots with these criteria.</div>`;
  }
  return `<div class="rng-grid">${RNG_SLOTS.map((s) => rngSlotHtml(s, pools[s.id])).join("")}</div>`;
}

/* An enrichment batch landed and real cards are already on screen. Update what moved
   instead of rebuilding the grid.

   Rebuilding is what the autoplay tour cannot survive: preview.js walks the .card elements
   and holds the one it is playing, so replacing those nodes mid-tour strands it and the
   tour stops partway through the three. A backfill poll every 45 seconds was doing exactly
   that. So the .card stays put and only its contents change — the counts, a cover that has
   just arrived, the score badges in the body, and the chip row, which carries the time to
   beat and therefore only fills in once HowLongToBeat has answered. */
function rngPatch() {
  const host = $("#pickResult");
  if (!host) return;
  const pools = rngPools();
  for (const s of RNG_SLOTS) {
    const el = host.querySelector(`.rng-slot[data-slot="${s.id}"]`);
    if (!el) continue;
    const pinned = rngIsPinned(s.id);
    // A pinned slot's eyebrow says "Pinned", not a count — leave it alone rather than
    // overwriting the badge with the pool it isn't rolling from.
    const n = pinned ? null : el.querySelector(".rng-n");
    if (n) n.textContent = pools[s.id].length.toLocaleString();
    const row = rngState.picks[s.id];
    if (!row) continue;
    const rec = igdbRecOf(row);
    const cs = coverSrc(rec, "cover_big");
    // A placeholder that can stop being one. Swapped in place so the .card around it,
    // which is what the tour is holding, is the same node it was.
    const ph = el.querySelector(".rng-art .card-cover.ph");
    if (cs && ph) {
      const img = document.createElement("img");
      img.className = "card-cover" + (coverIsPixelArt(rec, cs) ? " pixel" : "");
      img.alt = "";
      img.src = cs;
      ph.replaceWith(img);
    }
    const body = el.querySelector(".rng-art .card-body");
    if (body) body.innerHTML = cardBodyHtml(row);
    const chips = el.querySelector(".rng-chips");
    if (chips) chips.innerHTML = (pinned ? rngPlayingChip() : "")
      + rngCopyChip(row) + rngTimeChip(row) + rngChipsHtml(row);
  }
  const total = rngPoolCount();
  const c = document.querySelector("#picker .pick-count");
  if (c) c.textContent = `${total.toLocaleString()} game${total === 1 ? "" : "s"} in pool`;
}

function wireRngResult() {
  const host = $("#pickResult");
  if (!host || rngLoading()) return;
  host.querySelectorAll("[data-rngcard]").forEach((el) => {
    const row = rngState.picks[el.dataset.rngcard];
    if (!row) return;
    wirePreviewFor(el, row);                      // same hover trailer as the listings
    el.onclick = () => openDrawer(row, "games");
  });
  host.querySelectorAll("[data-reroll]").forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); rngRollOne(el.dataset.reroll, true); nav(); };
  });
  host.querySelectorAll("[data-open]").forEach((el) => {
    const row = rngState.picks[el.dataset.open];
    if (row) el.onclick = (e) => { e.stopPropagation(); openDrawer(row, "games"); };
  });
  /* Pinning. All three go through rngPin, which writes the pref and re-renders — no nav()
     with them, because a pin isn't in the URL (it's a pref, see the pins section) and
     pushing a history entry for one would make Back a button that unpins nothing. */
  host.querySelectorAll("[data-pinnow]").forEach((el) => {
    const row = rngState.picks[el.dataset.pinnow];
    if (row) el.onclick = (e) => { e.stopPropagation(); rngPin(el.dataset.pinnow, row._k); };
  });
  host.querySelectorAll("[data-unpin]").forEach((el) => {
    el.onclick = (e) => { e.stopPropagation(); rngPin(el.dataset.unpin, null); };
  });
  host.querySelectorAll("[data-pin]").forEach((el) => {
    el.onclick = (e) => e.stopPropagation();          // the card underneath opens a drawer
    el.onchange = (e) => { e.stopPropagation(); if (el.value) rngPin(el.dataset.pin, el.value); };
  });
  // Same reason pick.js asks: the card composes launchHtml-adjacent fields the bulk
  // enrichment map drops, and postEnrich re-renders when the per-game record lands.
  const picks = RNG_SLOTS.map((s) => rngState.picks[s.id]).filter(Boolean);
  if (picks.length && typeof maybeEnrich === "function") maybeEnrich(picks);
}

/* ---- the reveal ---------------------------------------------------------
   Three vertical reels of covers spinning at once and locking left to right, a beat
   apart, each with a flash on its frame as it stops. The single-game roll is a die
   over one horizontal reel; this is a slot machine, because three-at-once is the
   whole point of the mode and one die can't say it. Reduced motion and the roll
   toggle skip it exactly as they do there.

   A roll token guards against a second click (or a criteria change) landing an old
   roll on top of new state, and the per-slot re-roll spins one column in place while
   the other two cards sit still. */
/* Fourteen tiles, landing on the eleventh. It was 26 and the reels were unwatchable:
   three of them meant 78 covers requested at once, which on a cold cache is enough
   network and decode work to visibly stutter the spin, and 21 tiles of travel in 1.7s
   is roughly two and a half times the single roll's speed — fast enough that the reel
   read as a blur with a cut rather than as something slowing down. Fourteen each puts
   the tile count back level with the one-game roll and halves the distance. */
const RNG_REEL_N = 14, RNG_REEL_LAND = 10;
const RNG_REEL_BASE = 1500, RNG_REEL_STAGGER = 400, RNG_REEL_TAIL = 340;
let _rngRollN = 0;

function rngReelHtml(pool, picked) {
  const others = pool.filter((r) => r !== picked);
  const draw = () => (others.length ? others[Math.floor(Math.random() * others.length)] : picked);
  const seq = Array.from({ length: RNG_REEL_N }, (_, i) => (i === RNG_REEL_LAND ? picked : draw()));
  return `<div class="rng-reel-mask">
      <div class="rng-reel">${seq.map((r, i) => pickRollTile(r, i === RNG_REEL_LAND)).join("")}</div>
      <div class="rng-reel-hi"></div>
    </div>`;
}

// Spin one column that has already been painted into `mask`. Resolves nothing and
// returns nothing: the caller owns what happens when the reels have all stopped.
function rngSpin(mask, dur) {
  const reel = mask.querySelector(".rng-reel");
  const win = reel.children[RNG_REEL_LAND];
  if (!win) return;
  // offsetTop folds in the gaps, so the winner centres without a hard-coded tile height.
  const target = win.offsetTop - mask.clientHeight / 2 + win.offsetHeight / 2;
  reel.animate([
    { transform: "translateY(0)", filter: "blur(0)" },
    { transform: `translateY(${-target * 0.36}px)`, filter: "blur(6px)", offset: .42 },
    { transform: `translateY(${-target}px)`, filter: "blur(0)" },
  ], { duration: dur, easing: "cubic-bezier(.16,.8,.18,1)", fill: "forwards" });
}

/* A column stops: light its frame and put the winner's NAME under it. `.named` is what
   makes that readable — the resting style is a small letterspaced caps label, which is
   right for "Rolling…" and turns a game title into an unreadable stripe. */
function rngLockSlot(el, picked) {
  el.classList.add("locked");
  const hi = el.querySelector(".rng-reel-hi");
  if (hi) hi.classList.add("lit");
  const w = el.querySelector(".rng-word");
  if (w) { w.textContent = picked.title; w.classList.add("named"); }
}

// The picker rebuilds wholesale when a roll lands, so the cards are fresh nodes —
// reach for them after the render, not for the detached ones the reels were in.
function rngLandCards(ids) {
  renderPicker();
  ids.forEach((id) => {
    const el = document.querySelector(`#pickResult .rng-slot[data-slot="${id}"]`);
    if (el) el.classList.add("rng-landed");
  });
}

function playRngRoll(pools) {
  const host = $("#pickResult");
  if (!host) { renderPicker(); return; }
  const my = ++_rngRollN;
  // A pinned column doesn't spin: it keeps its card while the free ones roll beside it,
  // which is the whole picture the mode is drawing — two lanes being decided, one already
  // under way. It's rendered by the same rngSlotHtml the landed grid uses, so nothing in
  // that column moves when the roll finishes.
  const live = RNG_SLOTS.filter((s) => !rngIsPinned(s.id) && rngState.picks[s.id]);
  const last = RNG_REEL_BASE + RNG_REEL_STAGGER * (live.length - 1);

  host.innerHTML = `<div class="rng-grid">${RNG_SLOTS.map((s) => {
    if (rngIsPinned(s.id)) return rngSlotHtml(s, pools[s.id]);
    const picked = rngState.picks[s.id];
    const head = `<div class="rng-head"><span class="rng-eye">${icon(s.icon, 12)} ${escapeHtml(s.label)}</span></div>`;
    const body = picked
      ? rngReelHtml(pools[s.id], picked)
      : `<div class="rng-blank"><span class="rng-blank-ico">${icon("i-alert", 24)}</span><p>Nothing fits.</p></div>`;
    return `<div class="rng-slot spinning" data-slot="${s.id}" style="--slot: ${s.tint}">
        ${head}${body}<div class="rng-word">${picked ? "Rolling…" : "—"}</div>
      </div>`;
  }).join("")}</div>`;

  pickWireRollTiles(host);
  // The pinned cards were just painted as real cards; give them their real behaviour
  // (cover trailer, drawer, Unpin) rather than leaving them inert until the reels stop.
  wireRngResult();
  live.forEach((s, i) => {
    const el = host.querySelector(`.rng-slot[data-slot="${s.id}"]`);
    const dur = RNG_REEL_BASE + RNG_REEL_STAGGER * i;
    rngSpin(el.querySelector(".rng-reel-mask"), dur);
    setTimeout(() => {
      if (_rngRollN !== my) return;
      rngLockSlot(el, rngState.picks[s.id]);
    }, dur - 40);
  });

  setTimeout(() => {
    if (_rngRollN !== my || activeTab !== "pick") return;
    rngLandCards(live.map((s) => s.id));
  }, last + RNG_REEL_TAIL);
}

function playRngSlotRoll(el, slot, picked, pool) {
  const my = ++_rngRollN;
  const dur = RNG_REEL_BASE;
  el.classList.add("spinning");
  el.querySelector(".rng-art")?.remove();
  el.querySelector(".rng-body")?.remove();
  el.insertAdjacentHTML("beforeend", rngReelHtml(pool, picked) + `<div class="rng-word">Rolling…</div>`);
  pickWireRollTiles(el);
  rngSpin(el.querySelector(".rng-reel-mask"), dur);
  setTimeout(() => {
    if (_rngRollN !== my) return;
    rngLockSlot(el, picked);
  }, dur - 40);
  setTimeout(() => {
    if (_rngRollN !== my || activeTab !== "pick") return;
    rngLandCards([slot.id]);
  }, dur + RNG_REEL_TAIL);
}
