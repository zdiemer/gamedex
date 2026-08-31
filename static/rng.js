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

// Year from whichever field the sheet has: the games sheet carries releaseYear and
// releaseDate, the completed sheet only `release`. 0 means nobody knows.
const rngYear = (r) => {
  const y = +r.releaseYear;
  if (y) return y;
  const d = r.releaseDate || r.release;
  return typeof d === "string" ? (+d.slice(0, 4) || 0) : 0;
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

/* Everything short of a named publisher that says "small". Checked only AFTER the
   majors, deliberately: "the developer is also the publisher" is true of Nintendo
   and Rockstar as well as of a one-person studio, and it only means indie when
   nobody big is on the box. */
function rngIndieSignals(r, pubs) {
  if (pubs.some(rngIsIndieLabel)) return true;
  if (unifiedGenreVals(r).includes("Indie")) return true;
  const e = ENRICH[r._k] || {};
  if ((e.keywords || []).some((k) => /\bindie\b/i.test(String(k)))) return true;
  const devs = new Set(unifiedDevVals(r).map(normCompany));
  if (pubs.length && devs.size && pubs.some((p) => p && devs.has(p))) return true;
  // Shops that only carry small games.
  if (r.digitalPlatform === "itch.io" || String(r.platform || "").startsWith("Playdate")) return true;
  return false;
}

function rngTier(r) {
  const pubs = unifiedPubVals(r).map(normCompany).filter(Boolean);
  if (pubs.some(rngIsMajor)) return "aaa";
  if (rngIndieSignals(r, pubs)) return "indie";
  /* Nobody big is on the box and nothing here says "small" either. That's the long
     tail — one-person studios, tiny labels, storefront-only releases — so it goes to
     indie, and AAA stays the high-precision slot: a game is in it because a publisher
     with a budget put it there, not because nothing ruled it out.

     This was a scale test (a Metacritic score meant AAA) and it was badly wrong:
     metacriticOf falls through to a GameRankings dump, so four out of five games in
     the library have a "score" and the AAA slot filled up with obscure AA JRPGs. */
  return "indie";
}

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
   foreign — a shmup doesn't care what language it's in.

   Stricter than challenges.js's is_playable_by_language in two ways, both on purpose:
   Partial counts as untranslated (a half-patched JRPG is exactly the trap), and the
   genre test reads the UNIFIED genres (sheet + IGDB) rather than the sheet's single
   genre cell. A false exclusion here costs one game out of thousands; a false
   inclusion costs you the evening. */
const RNG_UNREADABLE = new Set(["None", "Partial"]);
function rngLanguageOk(r) {
  if (!RNG_UNREADABLE.has(r.english)) return true;
  if (typeof CH_TEXT_GENRES === "undefined") return true;
  const g = new Set(unifiedGenreVals(r));
  for (const t of CH_TEXT_GENRES) if (g.has(t)) return false;
  return true;
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
   finished (including games long since off the shelf). Memoised per DATA, so a
   reloaded spreadsheet rebuilds it. */
let _rngSeries = null, _rngSeriesFor = null;
function rngSeriesIndex() {
  if (_rngSeries && _rngSeriesFor === DATA) return _rngSeries;
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
  _rngSeriesFor = DATA;
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

/* ---- the three pools ----------------------------------------------------
   Straight off pickEligible() (the backlog, playable, unfinished) rather than
   pickPool(): RNG mode shows no criteria builder, no preset and no saved pickers, so
   there is nothing on screen that could be narrowing this. A filter left behind on the
   other mode silently shrinking a roll you can't see the criteria for is worse than
   not offering the filter at all — the slots' own rules are the whole story here.

   Recomputed when the sheet reloads or the last enrichment source lands: rngTier reads
   publishers and genres that only exist once IGDB has answered, so a pool cached across
   that would be sorting games by what we knew before the data arrived. */
let _rngPools = null, _rngPoolsFor = null, _rngPoolsDone = null, _rngPoolsToGo = null;
function rngPools() {
  if (_rngPools && _rngPoolsFor === DATA && _rngPoolsDone === ENRICH_COMPLETE
      && _rngPoolsToGo === rngState.toGo) return _rngPools;
  const out = { aaa: [], indie: [], retro: [] };
  for (const r of pickEligible()) {
    if (!rngAllowed(r)) continue;
    const y = rngYear(r);
    // No release year, no slot: a game that can't say which side of 2006 it's on
    // would have to be guessed into one, and a guess is not a rule.
    if (!y) continue;
    if (y < RNG_RETRO_BEFORE) out.retro.push(r);
    else out[rngTier(r)].push(r);
  }
  _rngPoolsFor = DATA; _rngPoolsDone = ENRICH_COMPLETE; _rngPoolsToGo = rngState.toGo;
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
  const pool = rngPools()[slotId] || [];
  const prev = rngState.picks[slotId];
  const from = (prev && pool.length > 1) ? pool.filter((r) => r !== prev) : pool;
  return (rngState.picks[slotId] = from.length ? rngWeightedPick(from, rngWeightOf(slotId)) : null);
}
const rngHasPicks = () => RNG_SLOTS.some((s) => rngState.picks[s.id]);

/* A pick only survives while it's still in its slot. A sheet reload can finish a game,
   sell it, or move its year across the 2006 line — showing it anyway would be the
   picker telling you it picked something the slot doesn't contain. */
function rngPrune() {
  const pools = rngPools();
  for (const s of RNG_SLOTS) {
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

function rngRollAll(roll) {
  const pools = rngPools();
  for (const s of RNG_SLOTS) rngRoll(s.id);
  if (roll && rngHasPicks() && pickAnimOn() && !pickReduced()) playRngRoll(pools);
  else renderPicker();
}

function rngRollOne(slotId, roll) {
  const pool = rngPools()[slotId] || [];
  rngRoll(slotId);
  const host = document.querySelector(`#pickResult .rng-slot[data-slot="${slotId}"]`);
  if (roll && rngState.picks[slotId] && host && pickAnimOn() && !pickReduced())
    playRngSlotRoll(host, rngSlot(slotId), rngState.picks[slotId], pool);
  else renderPicker();
}

/* ---- the cards ----------------------------------------------------------
   Three columns, each one an eyebrow saying which slot it is, the REAL grid card
   (so the hover trailer works here exactly as it does in the listings), and the
   two things you'd do next: roll this one again, or go and read about it. */
function rngSlotHtml(slot, pool) {
  const row = rngState.picks[slot.id];
  const head = `<div class="rng-head">
      <span class="rng-eye">${icon(slot.icon, 12)} ${escapeHtml(slot.label)}</span>
      <span class="rng-n" title="Games in this slot's pool">${pool.length.toLocaleString()}</span>
    </div>`;
  const box = (inner, cls = "") =>
    `<div class="rng-slot${cls}" data-slot="${slot.id}" style="--slot: ${slot.tint}">${head}${inner}</div>`;

  if (!row) {
    return box(`<div class="rng-blank">
        <span class="rng-blank-ico">${icon(pool.length ? "i-dice" : "i-alert", 24)}</span>
        <p>${pool.length ? "Roll to fill this slot." : "Nothing in your library fits this slot."}</p>
        <span class="rng-hint">${escapeHtml(slot.hint)}</span>
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

  /* The copy you'd actually reach for. Physical is the one thing this mode weights the
     roll on, so the card says whether that's what won rather than leaving you to open the
     drawer — and a game that's playable without being owned has to say so too, or the
     badge would call an emulated ROM "Digital" and read as a copy you have. */
  const copy = !row.owned
    ? `<span class="rng-copy none">${icon("i-alert", 11)} ${row.wishlisted ? "Wishlisted" : "Not owned"}</span>`
    : rngOwnedPhysical(row)
      ? `<span class="rng-copy phys">${icon("i-package", 11)} On the shelf</span>`
      : `<span class="rng-copy">${icon("i-play", 11)} Digital</span>`;
  const chips = [row.platform, rngYear(row) || null, row.genre]
    .filter((x) => x != null && x !== "")
    .map((x) => `<span class="chip">${escapeHtml(String(x))}</span>`).join("");

  return box(`<div class="rng-art">${card}</div>
    <div class="rng-body">
      <h3 title="${escapeHtml(String(row.title))}">${escapeHtml(String(row.title))}</h3>
      <div class="rng-chips">${copy}${chips}</div>
      <div class="rng-acts">
        <button class="rng-re" data-reroll="${slot.id}">${icon("i-refresh", 13)} Re-roll</button>
        <button class="rng-open" data-open="${slot.id}">Details</button>
      </div>
    </div>`);
}

function rngResultHtml() {
  const pools = rngPools();
  const total = RNG_SLOTS.reduce((n, s) => n + pools[s.id].length, 0);
  if (!total) {
    return `<div class="pick-empty">Nothing in your library clears all three slots with these criteria.</div>`;
  }
  return `<div class="rng-grid">${RNG_SLOTS.map((s) => rngSlotHtml(s, pools[s.id])).join("")}</div>`;
}

function wireRngResult() {
  const host = $("#pickResult");
  if (!host) return;
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
  const live = RNG_SLOTS.filter((s) => rngState.picks[s.id]);
  const last = RNG_REEL_BASE + RNG_REEL_STAGGER * (live.length - 1);

  host.innerHTML = `<div class="rng-grid">${RNG_SLOTS.map((s) => {
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
