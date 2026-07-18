"use strict";

/* "One per X" challenges — ported from zdiemer/GamePicker
   (src/game_selectors/progress/challenge_selectors.py).

   The rules, restated: each challenge slices the collection into buckets (one
   per platform, per genre, per letter of the alphabet, …). A bucket is CLEARED
   by any game in it you've finished, so progress is derived entirely from the
   sheet's Completed columns — there's nothing to tick off by hand. What's left
   to do is every bucket in the candidate pool that hasn't been cleared yet.

   These run over the WHOLE completed library. There's no start date: instead of
   a line drawn across your history, the history is replayed (see chReplay) —
   every completion handed, in order, to the bucket it clears. Clear the last
   bucket you can still reach and that PATH closes, the slate resets and the next
   one opens. So a challenge is never over, `timesCompleted` is a count rather
   than a number kept by hand, and every path you've already walked is a thing
   you can go and look at.

   Loaded after app.js and shares its globals (DATA, ENRICH, openDrawer, …). */

// showAll: which bucket ("todo"/"done") is expanded past its cap, or null for none. It
// was only ever an undeclared property assigned from three places — the object's shape
// should be readable from its declaration.
const chState = { open: null, showAll: null };

const chRows = () => ((DATA.sheets.games || {}).rows || []).filter((r) => r.title);
const chMean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- ported scoring & eligibility ---------------------------------------

// ExcelGame.combined_rating: the mean of my own score (falling back to
// priority/5) and the mean of the external scores.
// Memoised per row: the percentile bands rate every game in the library, and the
// candidate sort rates them again on every comparison. Keyed off the row object,
// so a reloaded sheet brings new rows and the old answers fall out on their own.
const _chCR = new WeakMap();
function combinedRating(r) {
  const hit = _chCR.get(r);
  if (hit !== undefined) return hit;          // a rated-at-null game is still an answer
  const others = [r.metacriticRating, r.gamefaqsUserRating].filter((v) => v != null);
  const mine = r.rating != null ? r.rating : (r.priority != null ? priorityRank(r.priority) / 5 : null);
  const parts = [];
  if (mine != null && !isNaN(mine)) parts.push(mine);
  if (others.length) parts.push(chMean(others));
  const v = parts.length ? chMean(parts) : null;
  _chCR.set(r, v);
  return v;
}

// ExcelFilter.is_playable_by_language: an untranslated game in a text-heavy
// genre isn't really playable, whatever the Playable column says.
const CH_TEXT_GENRES = new Set([
  "Action RPG", "Adventure", "Card Game", "Computer RPG", "Dungeon Crawler", "Strategy RPG",
  "Turn-Based RPG", "Visual Novel", "Action Adventure", "Turn-Based Strategy",
  "Turn-Based Tactics", "Strategy", "MMORPG", "Real-Time Tactics", "Roguelike", "Simulation",
  "Survival Horror", "Text Adventure", "Trivia",
]);

const chToday = () => new Date().toISOString().slice(0, 10);

// ExcelFilter's unplayed-candidate pool: not low priority, playable, playable
// in a language I read, unplayed, and actually out.
function isCandidate(r) {
  if (r.completed) return false;
  // Priority is a label now ("Might Play"), so Number() would be NaN and this
  // would reject every game in the library.
  if (!(priorityRank(r.priority) > 1)) return false;
  if (r.playable !== "Yes") return false;
  if (r.english === "None" && CH_TEXT_GENRES.has(r.genre)) return false;
  return !!r.releaseDate && r.releaseDate <= chToday();
}

// ---- Notes-derived fields ------------------------------------------------
// The sheet has no columns for storefront, subscription, limited-print run or
// required accessory — ExcelGame.__process_notes infers them all from the Notes
// cell, matching it against these closed vocabularies. Ported as-is, including
// the ordering: the first vocabulary that matches wins and the rest are skipped.

const CH_DIGITAL_PLATFORMS = new Set([
  "32-bit iOS", "Abandonware", "Amazon", "Battle.net", "Desura", "DRM Free", "Epic Games Store",
  "Freeware", "GOG", "Green Man Gaming", "Humble Bundle", "itch.io", "Johren", "Legacy Games",
  "Mojang", "Net Yaroze", "Nintendo 3DS Ambassador Program", "Oculus", "Origin", "Other",
  "Pirated", "Playdate", "Playdate Catalog", "Playdate Season 1", "Playdate Season 2",
  "Square Enix", "Steam", "Super NES Classic Edition", "Twitch", "uPlay", "Virtual Console",
  "Xbox Live Indie Games",
]);
const CH_SUBSCRIPTIONS = new Set([
  "Apple Arcade", "Games with Gold", "Netflix Games", "Nintendo Switch Online", "OnLive",
  "PlayStation Plus", "Stadia Pro", "Viveport", "Xbox Game Pass",
]);
const CH_LIMITED_PRINT = new Set([
  "Fangamer", "Hard Copy Games", "iam8bit", "Limited Rare Games", "Limited Run Games",
  "PixelHeart", "Play-Asia Exclusive", "Special Reserve Games", "Strictly Limited Games",
  "Super Rare Games",
]);
const CH_MEDIA_FORMATS = new Set(["LaserDisc"]);
const CH_ACCESSORIES = new Set([
  "Adventure Player", "Nintendo Power", "Starpath Supercharger", "Super Scope",
]);

const _chNotes = new WeakMap();
function chNoteFacts(r) {
  let f = _chNotes.get(r);
  if (f) return f;
  f = { notes: r.notes || null };
  const n = f.notes;
  if (n) {
    if (CH_DIGITAL_PLATFORMS.has(n)) f.digitalPlatform = n;
    else if (CH_SUBSCRIPTIONS.has(n)) f.subscription = n;
    else if (n === "Delisted") f.delisted = true;
    else if (CH_LIMITED_PRINT.has(n)) f.limitedPrint = n;
    else {
      // "Limited Run Games - Foo Edition": the company is stripped off and the
      // remainder falls through to the checks below.
      if (n.startsWith("Limited Run Games")) {
        f.limitedPrint = "Limited Run Games";
        f.notes = n.replace("Limited Run Games", "").replace(" - ", "").trim();
      }
      const rest = f.notes;
      if (CH_MEDIA_FORMATS.has(rest)) f.mediaFormat = rest;
      else if (CH_ACCESSORIES.has(rest)) f.accessory = rest;
    }
  }
  _chNotes.set(r, f);
  return f;
}

// ---- bucket keys ---------------------------------------------------------

// get_platform_completion_id: the platform, split by every distinction that
// makes a playthrough feel like a different box — Famicom vs NES, XBLA vs disc,
// Steam vs GOG, MAME vs not. Branch order is load-bearing (a Steam game is
// "PC (Steam)", never "PC"), so it follows the source exactly.
const CH_STOREFRONT = {
  "Xbox": "Digital", "Xbox 360": "XBLA", "Xbox One": "Digital", "Xbox Series X|S": "Digital",
  "PlayStation 3": "PSN", "PlayStation 4": "PSN", "PlayStation 5": "PSN",
  "PlayStation Vita": "PSN", "Nintendo 3DS": "eShop", "New Nintendo 3DS": "eShop",
  "Nintendo Wii U": "eShop", "Nintendo Switch": "eShop", "Nintendo Switch 2": "eShop",
};
const CH_VR_SPLIT = new Set(["PlayStation 4", "PlayStation 5"]);

function platformCompletionId(r) {
  const p = r.platform;
  if (!p) return null;
  const f = chNoteFacts(r);
  const notes = f.notes;

  // PC storefronts and Playdate sub-platforms.
  if (f.digitalPlatform) {
    return `${p} (${f.digitalPlatform})${r.vr ? " (VR)" : ""}${r.dlc ? " (DLC)" : ""}`;
  }
  if (r.dlc) return `${p} (DLC)`;
  if (p === "Arcade") {
    if (notes) return `${p} (${notes})`;                      // LaserDisc, Naomi, Triforce…
    return `${p} (${r.mameRomset ? "MAME" : "Non-MAME"})`;
  }
  if (p === "NES" && r.releaseRegion === "Japan") return `${p} (Famicom)`;
  if ((p === "NES" || p === "Game Boy Color") && notes === "Bootleg") return `${p} (Bootleg)`;
  if (p === "SNES" && r.releaseRegion === "Japan" && !f.accessory) return `${p} (Super Famicom)`;
  if (f.subscription) return `${p}${r.vr ? " (VR)" : ""} (${f.subscription})`;

  const store = CH_STOREFRONT[p];
  if (store) {
    const vr = r.vr && CH_VR_SPLIT.has(p) ? " (VR)" : "";
    if (r.format === "Physical" || r.format === "Both") {
      return `${p}${vr} (${r.releaseRegion || "Unknown"} Retail)`;
    }
    if (r.format === "Digital") return `${p}${vr} (${store})`;
    return `${p}${vr} (Emulation)`;
  }
  if (f.accessory) return `${p} (${f.accessory})`;            // Nintendo Power, Super Scope…
  if (p === "PlayStation Portable") {
    if (r.format === "Physical" || r.format === "Both") return `${p} (${r.releaseRegion || "Unknown"} Retail)`;
    if (r.format === "Digital") return `${p} (PSN)`;
    return `${p} (Emulation)`;
  }
  if (!r.owned && p !== "PC" && p !== "Browser") return `${p} (Emulation)`;
  return p;
}

// ExcelGame.normal_title, far enough to get the first character right.
function chFirstLetter(r) {
  const t = String(r.title).toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^0-9a-z\s]/g, "").trim();
  const c = t[0];
  if (!c) return "?";
  return /[a-z]/.test(c) ? c.toUpperCase() : /[0-9]/.test(c) ? "#" : "?";
}

function chPlaytimeBucket(r) {
  const t = r.completed ? r.completionTime : r.estimatedTime;
  if (t == null) return "No Playtime";
  if (t < 1) return "Under 1 Hour";
  const h = Math.floor(t);
  return `${h} Hour${h !== 1 ? "s" : ""}`;
}

// Memoised by date string: toLocaleDateString is expensive enough to dominate the
// whole Challenges page when it runs over every purchase date in the library, and
// fourteen thousand dates only land in a couple of hundred distinct months.
const _chMonths = new Map();
const chMonth = (iso) => {
  if (!iso) return null;
  let m = _chMonths.get(iso);
  if (m === undefined) {
    const d = new Date(iso + "T00:00:00");
    m = `${d.toLocaleDateString("en-US", { month: "long" })}, ${d.getFullYear()}`;
    _chMonths.set(iso, m);
  }
  return m;
};

function chRatingBucket(r) {
  const cr = combinedRating(r);
  return cr == null ? null : `${Math.floor(cr * 10) * 10}%`;
}

function chPriceBucket(r) {
  const p = Math.trunc(r.purchasePrice || 0);
  return p > 0 ? `$${p}.00` : "Free";
}

// numpy.percentile with linear interpolation, over every game's combined rating.
let _chPct = null;
function chPercentiles() {
  if (_chPct) return _chPct;
  const vals = chRows().map(combinedRating).filter((v) => v != null).sort((a, b) => a - b);
  const q = (p) => {
    if (!vals.length) return 0;
    const idx = (vals.length - 1) * (p / 100), lo = Math.floor(idx), hi = Math.ceil(idx);
    return vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
  };
  return (_chPct = { p1: q(1), p5: q(5), p10: q(10), p25: q(25), med: q(50), p75: q(75), p90: q(90), p95: q(95), p99: q(99) });
}
const chPctStr = (v) => (v * 100).toFixed(2) + "%";
const chPercentileBucket = (r) => chPercentileOf(combinedRating(r));
// Takes the RATING, not the row: the "percentile bands" transform is handed a value.
function chPercentileOf(cr) {
  if (cr == null) return null;
  const P = chPercentiles();
  if (cr < P.p1) return `1st (<${chPctStr(P.p1)})`;
  if (cr < P.p5) return `1-5th (${chPctStr(P.p1)}-${chPctStr(P.p5)})`;
  if (cr < P.p10) return `5-10th (${chPctStr(P.p5)}-${chPctStr(P.p10)})`;
  if (cr < P.p25) return `10-25th (${chPctStr(P.p10)}-${chPctStr(P.p25)})`;
  if (cr < P.med) return `25-49th (${chPctStr(P.p25)}-${chPctStr(P.med)})`;
  if (cr < P.p75) return `50-74th (${chPctStr(P.med)}-${chPctStr(P.p75)})`;
  if (cr < P.p90) return `75-89th (${chPctStr(P.p75)}-${chPctStr(P.p90)})`;
  if (cr < P.p95) return `90-94th (${chPctStr(P.p90)}-${chPctStr(P.p95)})`;
  if (cr < P.p99) return `95-98th (${chPctStr(P.p95)}-${chPctStr(P.p99)})`;
  return `99th (>=${chPctStr(P.p99)})`;
}

// The 50 developers with the most games in the collection — counted over the UNIFIED
// developer values (sheet + IGDB), so a studio you only know through IGDB can make the
// list. Cached, and reset when enrichment lands (chReset).
let _chTopDevs = null;
function chTopDevelopers() {
  if (_chTopDevs) return _chTopDevs;
  const counts = new Map();
  for (const r of chRows()) for (const d of unifiedDevVals(r)) counts.set(d, (counts.get(d) || 0) + 1);
  return (_chTopDevs = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map((e) => e[0])));
}
// Called when the sheet reloads (app.js, panels.js): every cache here is derived from
// rows that just changed underneath it.
const chReset = () => { _chTopDevs = null; _chPct = null; _chHist = null; };

const CH_FRANCHISE_CONTENDERS = new Set([
  "Final Fantasy", "Final Fantasy Tactics", "Chocobo", "Mana", "SaGa", "Dragon Quest",
  "Megami Tensei", "Red Faction", "Castlevania", "Kirby", "Command & Conquer",
  "The Elder Scrolls", "Splinter Cell", "Alone in the Dark", "Silent Hill", "The Darkness",
  "Resident Evil", "Turok", "The Witcher", "Halo", "Infamous", "Uncharted", "Dead Island",
  "Dead Rising", "Deus Ex", "Metal Gear", "King's Field", "Armored Core", "Shadow Tower",
  "Echo Night", "Lost Kingdoms", "Otogi", "Souls", "Yakuza", "Ys", "Xeno", "Far Cry",
  "Metroid", "Call of Duty", "Ace Attorney", "Professor Layton", "Advance Wars",
  "Assassin's Creed", "Star Ocean", "Fire Emblem", "Tales", "Shining", "Phantasy Star",
  "The Legend of Heroes", "Suikoden", "Breath of Fire", "Wild Arms", "Arc the Lad", "Grandia",
  "Hyperdimension Neptunia", "Ar tonelico", "Final Fantasy Crystal Chronicles", "Atelier",
  "Kingdom Hearts", "Lunar", "Disgaea", "Etrian Odyssey", "Ogre Battle", "Picross",
  "Genkai Tokki", "Parasite Eve", "Summon Night", "Mario RPG", "Mario & Luigi", "Paper Mario",
  "Mario", "The Legend of Zelda", "Sonic the Hedgehog", "Pikmin", "Mega Man", "Mega Man X",
  "Mega Man Zero", "Mega Man Battle Network", "Mega Man Legends", "Pokémon", "Pokémon Ranger",
  "Pokémon Mystery Dungeon", "Jak and Daxter", "Ratchet & Clank", "Resistance", "Spyro",
  "Crash Bandicoot", "Sly Cooper", "Killzone", "Chibi-Robo", "Grand Theft Auto", "Doom",
]);

// ---- the challenges ------------------------------------------------------
// group:   game -> bucket key (null = not in this challenge)
// domain:  which games the challenge is about at all (default: everything)
// pool:    which games count as "still to do" (default: unplayed candidates)
// clear:   which completions can clear a bucket (default: same as domain)
// keySort: how to order buckets in the detail view (default: biggest first)
const CHALLENGES = [
  {
    id: "platform", icon: "i-dice", name: "One Per Platform",
    blurb: "Beat a game on every platform — counting the splits that actually feel different: Famicom apart from NES, XBLA apart from disc, MAME apart from the rest.",
    groupBy: "__g_subplatform",
  },
  {
    id: "genre", icon: "i-library", name: "One Per Genre",
    blurb: "Beat a game in every genre in the collection, from visual novels to twin-stick shooters.",
    // Unified genres: one beat legitimately clears every genre that game carries (sheet
    // + IGDB + the umbrellas it rolls up into).
    groupBy: "genre",
  },
  {
    id: "year", icon: "i-calendar", name: "One Per Year",
    blurb: "Beat a game from every release year the collection covers.",
    groupBy: "releaseYear",
    keySort: (k) => -Number(k),
  },
  {
    id: "letter", icon: "i-list", name: "One Per Letter",
    blurb: "Beat a game starting with every letter of the alphabet (leading articles dropped, so The Last of Us is an L).",
    groupBy: "__g_title|letter",
    keySort: (k) => k,
  },
  {
    id: "region", icon: "i-target", name: "One Per Region",
    blurb: "Beat a game released in every region the collection reaches.",
    groupBy: "releaseRegion",
  },
  {
    id: "playtime", icon: "i-clock", name: "One Per Playtime",
    blurb: "Beat a game of every length, hour by hour — a 3-hour game, a 4-hour game, and so on up.",
    groupBy: "__g_playtime|unit",
    keySort: (k) => (k === "No Playtime" ? 1e9 : k === "Under 1 Hour" ? -1 : parseInt(k, 10)),
  },
  {
    id: "rating", icon: "i-star", name: "One Per Rating",
    blurb: "Beat a game in every 10% band of combined rating — the great, the mediocre and the truly dire.",
    groupBy: "__g_rating|band10",
    keySort: (k) => -parseInt(k, 10),
  },
  {
    id: "percentile", icon: "i-trend", name: "One Per Percentile",
    blurb: "Beat a game from every percentile band of the collection's rating distribution, from the bottom 1% to the top.",
    groupBy: "__g_rating|pct",
    keySort: (k) => -parseFloat(k),
  },
  {
    id: "length", icon: "i-sort", name: "One Per Title Length",
    blurb: "Beat a game of every title length, counted in characters with the spaces taken out.",
    groupBy: "__g_title|len",
    keySort: (k) => Number(k),
  },
  {
    id: "developer", icon: "i-package", name: "One Per Top Developer",
    blurb: "Beat a game by each of the 50 developers best represented in the collection.",
    // Unified devs: a game counts for every top studio it's credited to (sheet or IGDB);
    // the groupMany filter keeps the buckets to top-50 studios only.
    // "The top 50" limits which buckets exist; that's a filter on the challenge, not a
    // reshaping of the developer column, so it goes back to being a domain predicate.
    domain: (r) => unifiedDevVals(r).some((d) => chTopDevelopers().has(d)),
    groupMany: (r) => unifiedDevVals(r).filter((d) => chTopDevelopers().has(d)),
    pickBy: "developer",
  },
  {
    id: "franchise", icon: "i-trophy", name: "One Per Franchise Contender",
    blurb: "Beat a game from every franchise on the shortlist — the series worth actually playing through.",
    domain: (r) => unifiedFranchiseVals(r).some((f) => CH_FRANCHISE_CONTENDERS.has(f)),
    groupMany: (r) => unifiedFranchiseVals(r).filter((f) => CH_FRANCHISE_CONTENDERS.has(f)),
    pickBy: "franchise",
  },
  {
    id: "added", icon: "i-plus", name: "One Per Added Date",
    blurb: "Beat a game added to the sheet in every month it's been kept — clearing the backlog a vintage at a time.",
    groupBy: "dateAdded|month",
    keySort: (k, rows) => rows[0].dateAdded, sortDesc: true,
  },
  {
    id: "purchased", icon: "i-package", name: "One Per Purchase Date",
    blurb: "Beat a game bought in every month I've been buying them.",
    groupBy: "datePurchased|month",
    keySort: (k, rows) => rows[0].datePurchased, sortDesc: true,
  },
  {
    id: "price", icon: "i-trend", name: "One Per Purchase Price",
    blurb: "Beat a game bought at every whole-dollar price point.",
    groupBy: "purchasePrice|unit",
    keySort: (k) => parseFloat(String(k).replace("$", "")) || 0,
  },
  {
    id: "limitedprint", icon: "i-package", name: "One Per Limited Print",
    blurb: "Beat a game from every limited-print label — Limited Run, iam8bit, Super Rare and the rest of the boutique pressings.",
    groupBy: "limitedPrint",
  },
  {
    id: "translation", icon: "🈳", name: "One Per Fan Translation",
    blurb: "Beat a fan-translated game on every platform — the imports that only exist in English thanks to someone's weekend.",
    domain: (r) => r.english === "Full" && !r.owned,
    clear: (r) => r.english === "Full",
    group: (r) => {
      const p = platformCompletionId(r);
      return p ? `${p} (${r.english === "Full" ? "Translated" : "Untranslated"})` : null;
    },
  },
  {
    id: "unplayable", icon: "i-alert", name: "One Per Platform (Unplayable)",
    blurb: "The stubborn half of the platform challenge: the games marked unplayable — no dump, no hardware, no way in — one per platform.",
    pool: (r) => r.playable !== "Yes" && !r.completed,
    clear: () => true,
    universe: (r) => r.playable !== "Yes",   // only platforms that HAVE unplayable games
    groupBy: "__g_subplatform",
  },
];

// ---- computation ---------------------------------------------------------

/* The completed library in the order it happened, shared by every challenge.

   Undated completions come FIRST. Around a quarter of the finished games carry no
   date, and dropping them would be the worst of the options: the app would tell you
   to go and beat a PS1 game to clear a bucket you cleared in 2011 and can't prove.
   They're games you know you finished but not when, so the one place they can
   honestly go is before the record starts: prehistory. They clear their buckets
   first, and everything with a date is measured after.

   Their order WITHIN the batch is the sheet's, which is arbitrary — but they have
   no order of their own to respect, so any stable one will do, and it only decides
   which of two undated games gets the credit for a bucket they both sit in. */
let _chHist = null;
function chHistory() {
  if (_chHist) return _chHist;
  const done = chRows().filter((r) => r.completed);
  const dated = done.filter((r) => r.dateCompleted)
    .sort((a, b) => (a.dateCompleted < b.dateCompleted ? -1 : a.dateCompleted > b.dateCompleted ? 1 : 0));
  return (_chHist = [...done.filter((r) => !r.dateCompleted), ...dated]);
}

/* A challenge groups a game into one bucket, EXCEPT where the facet is itself
   multi-valued (IGDB themes, game modes): beating one game with three themes
   legitimately clears three buckets.

   Memoised per row for the life of one computeChallenge: finding the buckets is the
   expensive half of the work (unifiedGenreVals normalises and folds every genre a
   game carries) and each row is asked two or three times over — once to size the
   universe, once for the candidate pool, once more in the replay if it's finished. */
function chGroupsOf(c) {
  // groupBy names a shared column (chGroupables) — the same one Pick can filter on, which
  // is what lets a bucket become a single criterion. group/groupMany stay for the two
  // challenges whose bucketing is genuinely bespoke.
  const col = c.groupBy ? chGroupCol(c.groupBy) : null;
  const raw = col
    ? (r) => chFacetVals(r, col)
    : c.groupMany
    ? (r) => (c.groupMany(r) || []).filter((k) => k != null && k !== "").map(String)
    : (r) => { const k = c.group(r); return k == null || k === "" ? [] : [String(k)]; };
  const memo = new WeakMap();
  return (r) => {
    let g = memo.get(r);
    if (!g) memo.set(r, (g = raw(r)));
    return g;
  };
}

const chNewPath = () => ({ cleared: new Map(), games: 0, hits: 0, first: null, closer: null });

/* Replay the history into paths.

   A path is one full lap of the challenge: clear every bucket you can still reach
   and it closes, the slate wipes, the next one opens on your next completion. That
   IS the reset that used to be done by hand — moving `start` forward and adding one
   to `timesCompleted` — so replaying it recovers the same answer without anyone
   having to remember. (It was checked against them: the derived paths landed on the
   dates One Per Percentile had pinned by hand, and counted the laps it claimed.)

   "Every bucket you can still REACH" is the load-bearing part, and it's `poolKeys`:
   the buckets that still hold an unplayed candidate. A bucket whose games you have
   all already finished can't be cleared again, so it must not be allowed to hold a
   path open forever — and a path that can never close is a challenge that can never
   be completed. This is judged against today's pool, which is a small anachronism
   for a path walked in 2019 (a game bought since could have cleared a bucket that
   was empty at the time), and the alternative — reconstructing what the library held
   on every day of its life — buys precision nobody would ever see.

   Closing is DEFERRED to the next completion, rather than done the instant the last
   bucket falls: finish the challenge and it should read Complete!, not snap to 0% of
   a lap you haven't started. The next game you beat is what opens the next path. */
function chReplay(c, groupsOf, universeKeys, poolKeys) {
  const clear = c.clear || c.domain || (() => true);
  const paths = [];
  let cur = chNewPath();

  for (const r of chHistory()) {
    if (cur.closer) { paths.push(cur); cur = chNewPath(); }
    cur.games++;
    if (!cur.first) cur.first = r;
    if (clear(r)) {
      for (const k of groupsOf(r)) {
        if (!universeKeys.has(k)) continue;
        const list = cur.cleared.get(k);
        // Already cleared this path: the bucket doesn't fall twice, but the game was
        // still beaten here, and the timeline says so ("31 more beaten in this bucket").
        if (list) { list.push(r); continue; }
        cur.cleared.set(k, [r]);
        if (poolKeys.has(k)) cur.hits++;
      }
    }
    // A challenge with nothing left to reach can't close a path — without this guard
    // it would close one per completion, forever.
    if (poolKeys.size && cur.hits === poolKeys.size) cur.closer = r;
  }
  return { paths, cur };
}

function computeChallenge(c) {
  const rows = chRows();
  const domain = c.domain || (() => true);
  const clear = c.clear || domain;
  const pool = c.pool || isCandidate;
  const universe = c.universe || clear;
  const groupsOf = chGroupsOf(c);

  // The buckets this challenge is even about. Without this, a completion could
  // "clear" a bucket outside the challenge — beating a game on PC would count
  // toward the Unplayable challenge even though PC has no unplayable games.
  const universeKeys = new Set();
  for (const r of rows) {
    if (!universe(r)) continue;
    for (const k of groupsOf(r)) universeKeys.add(k);
  }

  // Every bucket still holding an unplayed candidate, and the candidates in it.
  const candidates = new Map();  // key -> candidate rows, best-rated first
  for (const r of rows) {
    if (!domain(r) || !pool(r)) continue;
    for (const k of groupsOf(r)) {
      if (!candidates.has(k)) candidates.set(k, []);
      candidates.get(k).push(r);
    }
  }
  for (const list of candidates.values()) {
    list.sort((a, b) => (combinedRating(b) ?? 0) - (combinedRating(a) ?? 0));
  }

  const { paths, cur } = chReplay(c, groupsOf, universeKeys, new Set(candidates.keys()));

  // Remaining: every bucket in the pool this path hasn't cleared yet.
  const remaining = new Map();
  for (const [k, list] of candidates) if (!cur.cleared.has(k)) remaining.set(k, list);

  const total = cur.cleared.size + remaining.size;
  return {
    c, paths, remaining, total,
    cleared: cur.cleared,       // key -> rows, in the order the buckets fell
    pathFrom: cur.first ? cur.first.dateCompleted || null : null,
    completedThisPath: cur.games,
    pct: total ? cur.cleared.size / total : 0,
  };
}

// Order buckets for display: the challenge's own key order, else biggest first.
function chSortBuckets(res, map) {
  const entries = [...map.entries()];
  const ks = res.c.keySort;
  entries.sort((a, b) => {
    if (ks) {
      const x = ks(a[0], a[1]), y = ks(b[0], b[1]);
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      return res.c.sortDesc ? -cmp : cmp;
    }
    return b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0]));
  });
  return entries;
}

// ---- rendering -----------------------------------------------------------

function chRing(pct, size = 54) {
  const r = size / 2 - 4, circ = 2 * Math.PI * r;
  return `<svg class="ch-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ch-ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ch-ring-fg"
      stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(1)}"/>
    <text x="50%" y="50%" class="ch-ring-txt">${Math.round(pct * 100)}%</text></svg>`;
}

// Which lap you're on. A challenge nobody has finished yet has no laps to count and
// is simply running over the whole library, which is what "all time" says.
const chPathLabel = (res) => (res.paths.length ? `path ${res.paths.length + 1}` : "all time");

function chCardHtml(res) {
  const { c, cleared, remaining, total } = res;
  const done = total > 0 && remaining.size === 0;
  const times = res.paths.length
    ? `<span class="ch-badge">✓ cleared ${res.paths.length}×</span>` : "";
  return `<button class="ch-card${done ? " ch-done" : ""}" data-ch="${c.id}">
    <div class="ch-card-top">
      <span class="ch-icon">${glyph(c.icon, 20)}</span>
      ${chRing(res.pct)}
    </div>
    <h3>${escapeHtml(c.name)}</h3>
    <div class="ch-count"><b>${cleared.size}</b> of ${total} cleared</div>
    <div class="ch-bar"><span style="width:${(res.pct * 100).toFixed(1)}%"></span></div>
    <div class="ch-foot">
      <span>${remaining.size ? `${remaining.size} to go` : "Complete!"}</span>
      <span class="muted">${escapeHtml(chPathLabel(res))}</span>
    </div>
    ${times}</button>`;
}

// A candidate/clearing game as a compact chip.
function chGameChip(row, note) {
  const cs = coverSrc(ENRICH[row._k], "cover_small");
  const art = cs ? `<img src="${cs}" alt="" loading="lazy">` : `<span class="ch-chip-ph">${icon("i-library", 16)}</span>`;
  const cr = combinedRating(row);
  const sub = [row.platform, row.releaseYear].filter(Boolean).map(String).map(escapeHtml).join(" · ");
  const meta = note
    ? `<span class="ch-chip-note">${escapeHtml(note)}</span>`
    : (cr != null ? `<span class="ch-chip-score ${ratingClass(cr)}">${Math.round(cr * 100)}%</span>` : "");
  return `<button class="ch-chip" data-gk="${escapeHtml(String(row._k || ""))}" data-gt="${escapeHtml(String(row.title))}" data-gp="${escapeHtml(String(row.platform || ""))}">
    ${art}<span class="ch-chip-txt"><b>${escapeHtml(String(row.title))}</b><span class="muted">${sub}</span></span>${meta}</button>`;
}

/* The cleared buckets, as a wrapping horizontal timeline.

   A challenge is a race against yourself, and the interesting thing about a cleared bucket
   isn't WHICH bucket it was — it's WHEN it fell, and next to what. As a list of cards that
   ordering was invisible: you got the challenge's own bucket order (A, B, C… / 1994, 1995…)
   and a date printed on each card, which is a table pretending to be history.

   So: oldest first, one cover per bucket, on a rail. The line is drawn per NODE rather than
   across the container, because a line drawn across the container cannot wrap — each node's
   rail segment reaches half the gap either side, so the segments meet and read as one
   continuous line within a row, and every row starts its own. */
const CH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2024-10-20" -> "Oct 24". Parsed off the string, not through Date: these are plain
// calendar days out of the sheet and constructing a Date would drag a timezone into it
// (and can hand you the previous evening).
function chShortDate(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${CH_MONTHS[+m[2] - 1] || ""} ${m[1].slice(2)}`;
}

// An undated completion has a place in the story but not a date to print. It gets said
// out loud rather than left blank, because a blank reads as a bug.
const CH_UNDATED = "undated";
const chWhen = (row) => (row.dateCompleted ? chShortDate(row.dateCompleted) : CH_UNDATED);
const chWhenLong = (row) => (row.dateCompleted ? fmtDate(row.dateCompleted) : "an unrecorded date");

// The cleared map is built by the replay in the order the buckets actually fell, so its
// own insertion order IS the timeline — there's nothing to sort.
function chTimelineHtml(cleared) {
  const nodes = [...cleared.entries()]
    // the clearing list is in path order, so [0] is the game that actually cleared it
    .map(([key, rows]) => ({ key, row: rows[0], also: rows.length - 1 }))
    .filter((n) => n.row);
  if (!nodes.length) return "";

  return `<div class="chtl">` + nodes.map(({ key, row, also }) => {
    // The SAME listing card as the grid and Home — a game is a game wherever you meet it.
    // The bucket it cleared and the date it fell are the note, because that is the one thing
    // that's true here and nowhere else. The rail, the dot and nothing else are ours.
    // The note is the bucket and the day it fell — nothing else. "+31 more" (the other games
    // beaten in that bucket since) ran the note to three lines and swallowed the cover it was
    // sitting on, for a number nobody came here to read. It lives in the tooltip.
    const tip = `${row.title} — cleared ${key} on ${chWhenLong(row)}`
      + (also ? ` (${also} more beaten in this bucket since)` : "");
    const card = posterCardHtml(row, {
      cls: "chtl-card",
      note: `<b>${escapeHtml(String(key))}</b> · ${escapeHtml(chWhen(row))}`,
      attrs: `title="${escapeHtml(tip)}"
              data-gk="${escapeHtml(String(row._k || ""))}"
              data-gt="${escapeHtml(String(row.title))}"
              data-gp="${escapeHtml(String(row.platform || ""))}"`,
    });
    return `<div class="chtl-node"><span class="chtl-dot"></span>${card}</div>`;
  }).join("") + `</div>`;
}

// "Oct 24 to Jul 26" — the stretch a path covers. The undated batch is prehistory, so a
// path that opens in it opens "before records began".
function chSpanText(nodes) {
  if (!nodes.length) return "";
  const from = nodes[0].dateCompleted ? chShortDate(nodes[0].dateCompleted) : "before records began";
  const to = chWhen(nodes[nodes.length - 1]);
  return to === CH_UNDATED ? from : `${from} to ${to}`;
}

function chClearedTimeline(res) {
  const rail = chTimelineHtml(res.cleared);
  if (!rail) return `<div class="ch-empty">Nothing cleared yet.</div>`;
  const firsts = [...res.cleared.values()].map((rows) => rows[0]);
  return `<p class="ch-hint">Oldest first — ${escapeHtml(chSpanText(firsts))}.
    Tap a cover for the game that cleared it.</p>${rail}`;
}

/* The paths already walked.

   `timesCompleted` used to be a number typed into the challenge and shown as a badge, and
   a badge is where it ended: you cleared this thing three times and all you got was a 3.
   The replay knows every game that cleared every bucket on every lap, so the count opens
   up into the routes themselves — collapsed by default, because the live path is what you
   came for and the history is what you go looking for. */
function chPathsHtml(res) {
  if (!res.paths.length) return "";
  const html = res.paths.map((p, i) => {
    const firsts = [...p.cleared.values()].map((rows) => rows[0]);
    // No closing date here: a path ends the moment its last bucket falls, so the date
    // would be the one chSpanText already printed on the end of the span.
    return `<details class="ch-path">
      <summary>
        <span class="ch-path-n">Path ${i + 1}</span>
        <span class="ch-path-span">${escapeHtml(chSpanText(firsts))}</span>
        <span class="muted">${p.cleared.size} bucket${p.cleared.size !== 1 ? "s" : ""} ·
          ${p.games.toLocaleString()} game${p.games !== 1 ? "s" : ""} beaten</span>
        <span class="ch-path-done">✓ cleared</span>
      </summary>
      ${chTimelineHtml(p.cleared)}
    </details>`;
  }).reverse().join("");   // most recent first — Path 1 is the deepest history
  return `<h2 class="ch-sec">Paths already walked <span class="muted">${res.paths.length}</span></h2>
    <p class="ch-hint">Every time the last bucket fell the slate wiped and a new path opened.
      These are the routes you took — open one for the games that cleared it.</p>
    <div class="ch-paths">${html}</div>`;
}

const CH_BUCKETS_SHOWN = 40;   // buckets rendered before "show all"

// The buckets still to clear. Only ever "todo" now — cleared ones are a timeline, because
// they have a date and these don't, which is the whole reason the two can't share a shape.
const CH_CANDIDATES_SHOWN = 5;

/* The criteria that describe one unbeaten bucket, as a Pick tree — the whole point of
   promoting the groupers. The bucket key IS a value of the challenge's groupBy column, so
   pinning that column to it reproduces the bucket exactly rather than approximately.

   Three criteria come along for the ride, because Pick's pool is deliberately wider than a
   challenge's: it offers catalogue games you don't own, and it doesn't care about priority
   or release date the way isCandidate does. Without them the roll can hand back a game that
   wouldn't actually clear anything.

   null when the challenge can't be expressed: a bespoke grouper (One Per Fan Translation),
   or a pool Pick can't reach at all (One Per Platform (Unplayable) is by definition games
   Pick considers unplayable). Better no link than a link that lies. */
function chPickCriteria(c, key) {
  /* pickBy covers the challenges whose BUCKETS are a filtered subset — One Per Top
     Developer groups by the top fifty, so it can't just group by the developer column
     without inventing four thousand more buckets. Pinning that column to one bucket key
     is still exact, though: every game credited to that studio is the bucket. */
  const field = c.pickBy || c.groupBy;
  if (!field || c.pool || !pickFieldByKey(field)) return null;
  const kids = [
    pickCond("__pk_sheet", [PICK_ON_SHEET]),
    pickCond("__pk_candidate", ["Yes"]),
    pickCond(field, [String(key)]),
  ];
  // A custom challenge's own criteria are already a tree — fold its top-level kids in
  // rather than nesting a redundant AND inside an AND.
  if (c.custom && c.custom.fb) {
    const t = pickDecode(c.custom.fb);
    if (t && t.op === "and" && !t.not) kids.push(...t.kids);
    else if (t) kids.push(t);
  }
  return pickGroup("and", kids);
}

// Hand a bucket to the Pick tab and roll it.
function chPickFromBucket(c, key) {
  const tree = chPickCriteria(c, key);
  if (!tree) return;
  goTab("pick", () => {
    pickState.filter = tree;
    pickState.preset = "";          // it's a tree now, so the dropdown reads "Custom filter"
    pickState.picked = null;
  });
  pickGame(true);                   // roll straight away — you asked for a game, not a form
}

function chBucketList(res, map) {
  const entries = chSortBuckets(res, map);
  if (!entries.length) {
    return `<div class="ch-empty">Nothing left — challenge complete!</div>`;
  }
  const show = chState.showAll === "todo" ? entries : entries.slice(0, CH_BUCKETS_SHOWN);
  const html = show.map(([key, rows]) => {
    const games = rows.slice(0, CH_CANDIDATES_SHOWN).map((r) => chGameChip(r)).join("");
    const extra = rows.length > CH_CANDIDATES_SHOWN
      ? `<span class="ch-more">+${rows.length - CH_CANDIDATES_SHOWN} more</span>` : "";
    const canPick = !!chPickCriteria(res.c, key);
    return `<div class="ch-bucket">
      <div class="ch-bucket-head"><h4>${escapeHtml(String(key))}</h4>
        <span class="muted">${rows.length} candidate${rows.length !== 1 ? "s" : ""}</span>
        ${canPick ? `<button class="ch-pickone" data-pickbk="${escapeHtml(String(key))}"
          title="Roll one of these in the Pick tab">${icon("i-dice", 13)} Pick me one</button>` : ""}</div>
      <div class="ch-chips">${games}${extra}</div></div>`;
  }).join("");
  const rest = entries.length - show.length;
  const more = rest > 0
    ? `<button class="ch-showall" data-showall="todo">Show all ${entries.length}</button>` : "";
  return html + more;
}

function renderChallenges() {
  const host = $("#challenges");
  if (!DATA) return;

  if (chEditor.open) {
    host.innerHTML = chEditorHtml();
    wireEditor(host);
    host.scrollTop = 0;
    return;
  }

  const all = chAll();
  if (!chState.open) {
    const results = all.map(computeChallenge);
    const totalCleared = results.reduce((a, r) => a + r.cleared.size, 0);
    const totalBuckets = results.reduce((a, r) => a + r.total, 0);
    const finished = results.filter((r) => r.total && !r.remaining.size).length;
    const walked = results.reduce((a, r) => a + r.paths.length, 0);
    host.innerHTML =
      `<div class="ch-hero">
         <h1>Challenges</h1>
         <p>One game per platform, per genre, per year, per letter… Progress is read straight from the sheet, over everything you've ever finished: a bucket clears the day you beat something in it, and clearing the last one you can reach starts the whole challenge over.</p>
         <div class="ch-hero-stats">
           <span><b>${all.length}</b> challenges</span>
           <span><b>${totalCleared.toLocaleString()}</b> buckets cleared</span>
           <span><b>${(totalBuckets - totalCleared).toLocaleString()}</b> to go</span>
           ${finished ? `<span><b>${finished}</b> finished</span>` : ""}
           ${walked ? `<span><b>${walked.toLocaleString()}</b> paths walked</span>` : ""}
         </div>
       </div>
       <div class="ch-grid">${results.map(chCardHtml).join("")}
         <button class="ch-card ch-new" id="chNew">
           <span class="ch-new-plus">＋</span>
           <b>New challenge</b>
           <span class="muted">One per anything you can filter by — themes, storefronts, developers, Steam Deck rating.</span>
         </button>
       </div>`;
    for (const el of host.querySelectorAll(".ch-card[data-ch]")) {
      el.onclick = () => { chState.open = el.dataset.ch; chState.showAll = null; renderChallenges(); nav(); };
    }
    $("#chNew").onclick = () => chOpenEditor(null);
    return;
  }

  const c = all.find((x) => x.id === chState.open) || all[0];
  const res = computeChallenge(c);
  const times = res.paths.length
    ? `<span class="ch-badge">✓ cleared ${res.paths.length}× already</span>` : "";
  // When this path opened. One running from the undated prehistory hasn't got a date to
  // show: on a challenge nobody has finished, that's every game you've ever beaten
  // ("all time"); on a later path it means the batch it opened in.
  const from = res.pathFrom ? fmtDate(res.pathFrom)
    : (res.paths.length ? "Prehistory" : "All time");
  host.innerHTML =
    `<div class="ch-detail">
       <button class="ch-back" id="chBack">← All challenges</button>
       ${c.custom ? `<button class="btn ghost ch-edit" id="chEdit">✎ Edit challenge</button>` : ""}
       <div class="ch-detail-head">
         <span class="ch-icon big">${glyph(c.icon, 30)}</span>
         <div>
           <h1>${escapeHtml(c.name)}</h1>
           <p>${escapeHtml(c.blurb)}</p>
           ${times}
         </div>
         ${chRing(res.pct, 92)}
       </div>
       <div class="ch-bar big"><span style="width:${(res.pct * 100).toFixed(1)}%"></span></div>
       <div class="ch-stats">
         <div><b>${res.cleared.size}</b><span>cleared</span></div>
         <div><b>${res.remaining.size}</b><span>remaining</span></div>
         <div><b>${res.total}</b><span>total</span></div>
         <div><b>${escapeHtml(from)}</b><span>${res.paths.length ? "path opened" : "counting from"}</span></div>
         <div><b>${res.completedThisPath.toLocaleString()}</b><span>games beaten ${res.paths.length ? "this path" : "overall"}</span></div>
       </div>
       <h2 class="ch-sec">Still to do <span class="muted">${res.remaining.size}</span></h2>
       <p class="ch-hint">Top-rated candidates for each, five shown. Tap any game for details.</p>
       <div class="ch-buckets">${chBucketList(res, res.remaining)}</div>
       <h2 class="ch-sec">Cleared <span class="muted">${res.cleared.size}</span></h2>
       ${chClearedTimeline(res)}
       ${chPathsHtml(res)}
     </div>`;

  $("#chBack").onclick = () => { chState.open = null; chState.showAll = null; renderChallenges(); nav(); };
  const edit = $("#chEdit");
  if (edit) edit.onclick = () => chOpenEditor(c.custom);
  for (const el of host.querySelectorAll(".ch-pickone")) {
    el.onclick = (e) => { e.stopPropagation(); chPickFromBucket(res.c, el.dataset.pickbk); };
  }
  for (const el of host.querySelectorAll(".ch-showall")) {
    el.onclick = () => { chState.showAll = el.dataset.showall; renderChallenges(); };
  }
  /* Indexed once, not scanned per card: the walked paths can put hundreds of covers on
     this page, and a .find() apiece is that many passes over all 14k rows. The unit
     separator joins the three fields because it can't occur inside any of them — a
     space could, and _k "a b" + title "c" would collide with _k "a" + title "b c". */
  const byCard = new Map();
  for (const r of chRows()) {
    // First one wins, exactly as the .find() this replaces did: two rows CAN agree on all
    // three (the same game owned twice, physical and digital), and the second must not
    // quietly displace the first.
    const k = `${r._k || ""}\u001f${r.title}\u001f${r.platform || ""}`;
    if (!byCard.has(k)) byCard.set(k, r);
  }
  for (const el of host.querySelectorAll(".ch-chip, .chtl-card")) {
    const row = byCard.get(`${el.dataset.gk}\u001f${el.dataset.gt}\u001f${el.dataset.gp}`);
    if (!row) continue;
    el.onclick = () => openDrawer(row, "games");
    // It's the grid's card, so it gets the grid's hover-to-play trailer too. Anything less
    // and it would only LOOK like the same card.
    if (el.classList.contains("chtl-card")) wirePreviewFor(el, row);
  }
  host.scrollIntoView({ block: "start" });
}

/* ===========================================================================
   CUSTOM CHALLENGES

   The built-ins are hand-written because each encodes a judgement — which
   platform splits "count" as different, which franchises are contenders. But the
   machinery underneath is general: a challenge is a way of grouping games into
   buckets, plus a domain saying which games are in play. Both of those are things
   the facet system already knows how to compute for any column, including the
   enrichment-derived ones (IGDB theme, game mode, Steam Deck status).

   So a custom challenge is: group by a facet, optionally filter by other facets.
   It then runs through exactly the same computeChallenge as the built-ins — same
   clearing rules, same candidate pool, same progress, same replayed paths.

   Stored in localStorage: gamedex has no accounts, and this is a personal goal
   rather than shared data. Same place the saved views live.
   =========================================================================== */

const CH_CUSTOM_KEY = "gamedex.challenges";

const chLoadCustom = () => {
  try { return JSON.parse(localStorage.getItem(CH_CUSTOM_KEY) || "[]"); }
  catch (_) { return []; }
};
// Write-through to the server (see extras.js); localStorage stays as the offline
// mirror, so a challenge built on the desktop shows up on the phone.
const chStoreCustom = (list) => prefsSave("challenges", list.slice(0, 40));

// Facets you can group a challenge by. Straight from the games sheet's own facet
/* ---- grouping: a field, plus a transform ---------------------------------

   A challenge is "one per SOMETHING", and that something is nearly always an ordinary
   field put through an ordinary reshaping: a date by month, a rating in 10% bands, a
   title by its first letter, an amount rounded to whole units. Those were twelve
   hand-written groupers until now — which meant the only bucketings that existed were
   the ones someone had already thought of, and the builder could only offer a list.

   So a grouper is composed instead: {field, transform}, serialised as "field|transform"
   ("platform" on its own means the field as it comes). The builder shows two selects and
   the second is filled from the first field's type, so what you can group by is however
   many fields there are times however many transforms fit them, not twelve.

   Being a plain key that resolves to a facet column matters twice over: computeChallenge
   groups by it, and "pick me one" pins it as a Pick criterion — the bucket reproduces
   exactly because it's the same column answering both times. */

const CH_TITLE_KEYS = new Set(["title", "game", "__g_title"]);
const CH_NUMERIC = new Set(["rating", "money", "hours", "int", "number", "year"]);
const chIsoOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

const CH_TRANSFORMS = [
  { id: "", label: "each value", fits: () => true, apply: (vals) => vals },
  { id: "letter", label: "first letter", fits: (c) => c.type === "text" || !c.type,
    // A title's first letter is not its first character: leading articles, diacritics and
    // punctuation all come off first, or "The Last of Us" files under T and "Ōkami" under Ō.
    apply: (vals, r, c) => (CH_TITLE_KEYS.has(c.key)
      ? [chFirstLetter(r)]
      : vals.map((v) => (String(v)[0] || "?").toUpperCase())) },
  { id: "len", label: "length in characters", fits: (c) => c.type === "text",
    apply: (vals) => vals.map((v) => String(v).replace(/ /g, "").length) },
  { id: "year", label: "by year", fits: (c) => c.type === "date",
    apply: (vals) => vals.map((v) => (chIsoOf(v) || "").slice(0, 4)) },
  { id: "month", label: "by month", fits: (c) => c.type === "date",
    apply: (vals) => vals.map((v) => chMonth(chIsoOf(v))) },
  { id: "unit", label: "whole units", fits: (c) => CH_NUMERIC.has(c.type),
    apply: (vals, r, c) => vals.map((v) => chWholeUnit(v, c)) },
  { id: "band10", label: "10% bands", fits: (c) => c.type === "rating",
    apply: (vals) => vals.map((v) => (v == null ? null : `${Math.floor(chPct01(v) * 10) * 10}%`)) },
  { id: "pct", label: "percentile bands", fits: (c) => c.type === "rating",
    apply: (vals) => vals.map((v) => (v == null ? null : chPercentileOf(chPct01(v)))) },
];
const chTransformById = (id) => CH_TRANSFORMS.find((t) => t.id === (id || ""));
// Ratings live as 0-1 in some columns and 0-100 in others; the bands want one scale.
const chPct01 = (v) => (Number(v) > 1 ? Number(v) / 100 : Number(v));
function chWholeUnit(v, col) {
  // Hours are the one unit where "unknown" is a bucket rather than a gap — One Per Playtime
  // has always had a rung for the games whose length nobody has measured.
  if (v == null || v === "") return col.type === "hours" ? "No Playtime" : null;
  const n = Math.trunc(Number(v));
  if (!isFinite(n)) return col.type === "hours" ? "No Playtime" : null;
  if (col.type === "money") return n > 0 ? `$${n}.00` : "Free";
  if (col.type === "hours") return n < 1 ? "Under 1 Hour" : `${n} Hour${n !== 1 ? "s" : ""}`;
  return String(n);
}

/* The one grouping that ISN'T a field and a transform. It splits a platform by the things
   that make owning it feel different — Famicom apart from NES, MAME apart from the rest of
   Arcade, a retail disc apart from the same game on a storefront, VR and DLC apart again —
   which is hand-written knowledge about a dozen platforms, not a reshaping of a column.
   Named rather than composed, and named neutrally: it is a sub-platform, not a challenge. */
const CH_NAMED_GROUPERS = [
  { key: "__g_subplatform", label: "Subplatform", getVals: (r) => [platformCompletionId(r)] },
  // The playtime a challenge means is "how long is this game for me": what it took if it's
  // finished, what it's projected to take if it isn't. Neither column alone says that.
  { key: "__g_playtime", label: "Playtime (actual or estimated)", type: "hours",
    getVals: (r) => [r.completed ? r.completionTime : r.estimatedTime] },
  { key: "__g_rating", label: "Rating (critics + players)", type: "rating",
    getVals: (r) => [combinedRating(r)] },
  { key: "__g_title", label: "Title", type: "text", getVals: (r) => [r.title] },
];

// Every field a grouping can start from: the sheet's facets, the virtual ones, and the
// named few above that no column carries.
function chGroupFields() {
  const cols = [...((DATA.sheets.games || {}).columns || []).filter((c) => c.facet)];
  const igdb = typeof igdbFacetCols === "function" ? igdbFacetCols("games") : [];
  const extra = typeof extraFacetCols === "function" ? extraFacetCols("games") : [];
  const dated = ((DATA.sheets.games || {}).columns || []).filter((c) => c.type === "date" || c.type === "money");
  const named = CH_NAMED_GROUPERS.map((g) => ({ ...g, facet: true, virtual: true, enriched: false, kind: "fn" }));
  const seen = new Set();
  const all = [...named, ...cols, ...dated, ...igdb, ...extra].filter((c) => !seen.has(c.key) && seen.add(c.key));
  /* Alphabetical. This is a flat select of forty-odd fields and the order it had was the
     order the four sources were concatenated in — meaningless to anyone reading it, and
     unsearchable in a <select> where you can only type-ahead by first letter. */
  return all.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }));
}
const chGroupFieldByKey = (k) => chGroupFields().find((c) => c.key === k);
// Which reshapings make sense for a field — what the builder's second select offers.
const chTransformsFor = (col) => (col ? CH_TRANSFORMS.filter((t) => t.fits(col)) : []);

/* "field|transform" -> a facet column that yields the bucket keys. Cached per key so the
   same resolved column is handed to computeChallenge and to compilePick, and rowFacetItems
   memoises against it. */
const _chGroupCols = new Map();
function chGroupCol(key) {
  if (!key) return null;
  if (_chGroupCols.has(key)) return _chGroupCols.get(key);
  const [fk, tid] = String(key).split("|");
  const base = chGroupFieldByKey(fk);
  const tf = chTransformById(tid);
  if (!base || !tf) { _chGroupCols.set(key, null); return null; }
  const raw = (r) => (base.kind === "fn" ? (base.getVals(r) || []) : rowFacetItems(r, base).map((i) => i.raw));
  const col = {
    key, label: base.label + (tf.id ? ` · ${tf.label}` : ""),
    type: "text", facet: true, virtual: true, enriched: false, grouper: true, kind: "fn",
    getVals: (r) => (tf.apply(raw(r), r, base) || []).filter((v) => v != null && v !== "").map(String),
  };
  _chGroupCols.set(key, col);
  return col;
}
const chResetGroupCols = () => _chGroupCols.clear();

// Resolving a grouping key is chGroupCol's job now (field|transform); this stays as the
// name the rest of the file already calls.
const chColByKey = (key) => chGroupCol(key);

// The values a row falls into for a facet — reuses the grid's own accessor, so a
// multi-valued facet (themes) yields several buckets and a plain one yields one.
function chFacetVals(row, col) {
  if (!col) return [];
  return (typeof rowFacetItems === "function" ? rowFacetItems(row, col) : []).map((i) => i.key);
}

/* A stored definition -> a challenge object computeChallenge understands.

   A challenge IS a saved query with a group-by, so the domain is a Pick tree (def.fb, the
   same packed format ?fb= and saved pickers carry) compiled by Pick's own compiler. There
   is no second filter language any more: what the builder can say, a challenge can say,
   including the nesting and negation the old flat AND-of-ORs couldn't. */
function chFromCustom(def) {
  const tree = typeof pickDecode === "function" ? pickDecode(def.fb || "") : null;
  const match = tree && typeof compilePick === "function" ? compilePick(tree) : () => true;
  return {
    id: def.id,
    icon: def.icon || "i-target",
    name: def.name || "Custom challenge",
    blurb: chCustomBlurb(def),
    custom: def,
    groupBy: def.groupBy,
    domain: match,
  };
}

function chCustomBlurb(def) {
  const g = chColByKey(def.groupBy);
  const gl = g ? g.label : def.groupBy;
  // describePicker takes any node, so a challenge and a saved picker describe their
  // criteria in the same words — one summariser, not two.
  const desc = (typeof describePicker === "function" && def.fb)
    ? describePicker(pickDecode(def.fb)) : "";
  return `Beat one game per ${gl}${desc ? `, limited to ${desc}` : ""}.`;
}

// Built-ins first, then yours.
const chAll = () => [...CHALLENGES, ...chLoadCustom().map(chFromCustom)];

// ---- the builder ---------------------------------------------------------

const chEditor = { open: false, def: null };

const chBlankDef = () => ({
  id: "custom-" + Math.random().toString(36).slice(2, 9),
  name: "", icon: "i-target", groupBy: "platform",
  // The criteria, as the same packed tree a ?fb= link and a saved picker carry.
  fb: "",
});

/* The editor drives the Pick builder (pick.js) over its own tree rather than pickState's.
   repaint re-renders the whole tab, which is how every other structural edit in this file
   already works; there's no URL to sync, since an unsaved draft isn't a place. */
let chEditTree = null;
const CH_BUILDER = {
  sel: "#chbBuilder",
  // A challenge is over the whole library, not Pick's backlog — the same builder, but the
  // empty state can't say the same thing.
  emptyHint: "every game in the collection counts",
  root: () => (chEditTree ||= pickGroup()),
  // A challenge is about the WHOLE library — games you've finished are what clear its
  // buckets — so the value counts come from every row, not Pick's backlog-only pool.
  pool: () => chRows(),
  changed: () => {},
  repaint: () => renderChallenges(),
  sync: () => {},
};

function chEditorHtml() {
  const d = chEditor.def;
  const [gfk, gtid] = String(d.groupBy || "").split("|");
  const fields = chGroupFields();
  const base = chGroupFieldByKey(gfk) || fields[0];
  const transforms = chTransformsFor(base);
  const opt = (v, label, sel) => `<option value="${escapeHtml(v)}"${v === sel ? " selected" : ""}>${escapeHtml(label)}</option>`;

  pkbUse(CH_BUILDER);
  return `<div class="chb">
    <div class="chb-head">
      <h2>${d._editing ? "Edit" : "New"} challenge</h2>
      <button class="chb-close" id="chbClose">✕</button>
    </div>
    <label class="chb-row"><span>Name</span>
      <input id="chbName" type="text" value="${escapeHtml(d.name)}" placeholder="One per Steam Deck rating…" maxlength="60">
    </label>
    <label class="chb-row"><span>Icon</span>
      <input id="chbIcon" type="text" value="${escapeHtml(d.icon)}" maxlength="4" style="width:64px">
    </label>
    <div class="chb-row"><span>One per…</span>
      <div class="chb-group">
        <select id="chbGroup">${fields.map((c) => opt(c.key, c.label, base.key)).join("")}</select>
        ${transforms.length > 1
          ? `<select id="chbGroupT">${transforms.map((t) => opt(t.id, t.label, gtid || "")).join("")}</select>`
          : ""}
        <em>Every game you've ever finished counts, the same rule the built-ins use.
          Clear the last bucket you can reach and the challenge starts over.</em>
      </div>
    </div>
    <div class="chb-row chb-filters">
      <span>Only these games</span>
      <div>
        <div class="pick-builder" id="chbBuilder">${pickGroupHtml(CH_BUILDER.root(), [])}</div>
        <em class="muted">Leave it empty and every game is in play. Same criteria builder as
          the Pick tab — so it nests, and any criterion can be negated.</em>
      </div>
    </div>
    <div class="chb-preview" id="chbPreview"></div>
    <div class="chb-actions">
      ${d._editing ? `<button class="btn danger" id="chbDelete">Delete</button>` : ""}
      <span class="spacer"></span>
      <button class="btn ghost" id="chbCancel">Cancel</button>
      <button class="btn launch" id="chbSave">Save challenge</button>
    </div>
  </div>`;
}

// field + transform -> the stored "field|transform" key (bare field when it's untransformed).
function chSetGroupBy(fieldKey, tid) {
  const base = chGroupFieldByKey(fieldKey);
  const fits = chTransformsFor(base).some((t) => t.id === (tid || ""));
  chEditor.def.groupBy = fieldKey + (tid && fits ? "|" + tid : "");
}

// Live preview: how many buckets would this challenge actually have?
function chPreview() {
  const host = $("#chbPreview");
  if (!host) return;
  try {
    const draft = { ...chEditor.def, fb: pickEncode(pickPruned(chEditTree || pickGroup())) };
    const res = computeChallenge(chFromCustom(draft));
    const walked = res.paths.length
      ? ` · <b>${res.paths.length}</b> path${res.paths.length !== 1 ? "s" : ""} you've already walked`
      : "";
    host.innerHTML = res.total
      ? `<b>${res.total}</b> buckets · <b>${res.cleared.size}</b> already cleared by past completions · <b>${res.remaining.size}</b> to go${walked}`
      : `<span class="muted">No buckets — that combination of facet and filters matches nothing.</span>`;
  } catch (e) {
    host.innerHTML = `<span class="muted">Can't evaluate that yet.</span>`;
  }
}

function wireEditor(host) {
  const d = chEditor.def;
  const close = () => { chEditor.open = false; chEditor.def = null; chEditTree = null; renderChallenges(); };
  $("#chbClose").onclick = close;
  $("#chbCancel").onclick = close;
  $("#chbName").oninput = (e) => { d.name = e.target.value; };
  $("#chbIcon").oninput = (e) => { d.icon = e.target.value; };
  // Changing the field re-renders: the transforms on offer come from its type, so the
  // second select's options change with it.
  $("#chbGroup").onchange = (e) => { chSetGroupBy(e.target.value, ""); renderChallenges(); };
  const gt = $("#chbGroupT");
  if (gt) gt.onchange = (e) => { chSetGroupBy(String(d.groupBy).split("|")[0], e.target.value); chPreview(); };

  // The Pick tab's builder, pointed at this draft's tree (pick.js).
  pkbUse(CH_BUILDER);
  wirePickBuilder();

  $("#chbSave").onclick = () => {
    if (!d.name.trim()) { $("#chbName").focus(); return; }
    const list = chLoadCustom();
    const i = list.findIndex((x) => x.id === d.id);
    const clean = { id: d.id, name: d.name.trim(), icon: d.icon || "i-target",
                    groupBy: d.groupBy, fb: pickEncode(pickPruned(chEditTree || pickGroup())) };
    if (i >= 0) list[i] = clean; else list.push(clean);
    chStoreCustom(list);
    chEditor.open = false; chEditor.def = null; chEditTree = null;
    showToast(`Challenge "${clean.name}" saved`);
    renderChallenges();
  };
  const del = $("#chbDelete");
  if (del) del.onclick = () => {
    chStoreCustom(chLoadCustom().filter((x) => x.id !== d.id));
    chEditor.open = false; chEditor.def = null; chEditTree = null;
    showToast("Challenge deleted");
    renderChallenges();
  };
  chPreview();
}

function chOpenEditor(def) {
  chEditor.open = true;
  chEditTree = def && def.fb ? pickDecode(def.fb) : pickGroup();
  chEditor.def = def ? { ...def, _editing: true } : chBlankDef();
  renderChallenges();
}

// Landing state (core.js). chEditor especially: the builder used to survive EVERY
// navigation, so any return to the tab — even a ?ch= deep link — reopened the half-filled
// form instead of the challenge you asked for (renderChallenges early-returns on it).
TAB_RESET.challenges = () => {
  chState.open = null; chState.showAll = null;
  chEditor.open = false; chEditor.def = null;
};
