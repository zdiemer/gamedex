"use strict";

/* Themes — the evergreen half of the board.

   The twelve seasonal events all answer the same question: what should I play IN OCTOBER.
   That is the whole point of a window, and it is also the whole limitation — nine months of
   the year the collection has nothing to say about the thing I actually want, which is "give
   me five cyberpunk games and get out of the way".

   So a theme is a seasonal event with the date taken out. Same four pieces, minus the one:

     a POOL     a predicate over the collection, built to the Spooktober rule — match on
                what a game IS (a keyword, a perspective, a theme, a year), never on a noun
                that appears in it.
     a SLATE    N games rolled out of that pool. Pin the ones you mean to keep, roll again,
                and the pinned ones stay put while the rest turn over.
     a RUN      the slate plus when you started it and how many times you rolled. It has no
                end: there is nothing to close, nothing archived, and no history of past
                runs — a slate turns over as you roll it and that is the whole lifecycle.
     a BANNER   Home, priority 35 — under every seasonal event and under Endangered, because
                a theme has all year and October does not. It only appears while a run is
                actually open.

   Completion is NOT a checkbox, and there is no tick button on this page at all. A slate
   game is done when the SHEET says it is done, the same way challenges.js derives everything
   from the Completed columns. Anything else is a second place to record the same fact and so
   a second place to be wrong: finish a game on the couch, mark it on the sheet like always,
   and two screens now disagree until you remember to come back here. So a run fills itself
   in as you play, and nothing is ever marked twice.

   ONE registry entry, not one per theme. Separate entries would make separate tabs,
   banner contenders and preview-board rows for what is really one page with a dial on it —
   the Class of 'XX argument at collection scale. The entry WEARS the active theme: its
   skin, deco, title and pitch are all read at render time, and themesRender swaps them
   before it paints. That is the one liberty this file takes with the framework, and it is
   the reason a theme can have its own poster without its own tab.

   Naming, because it will come up: "theme" is already two things in this app — IGDB's theme
   facet (__igdb_theme, Science fiction / Horror / Open world) and the light/dark setting.
   This is neither, and several of these are built out of the first one. */

/* ---- the themes ------------------------------------------------------------
   Adding one is adding an object. That is the entire extension mechanism, and it is why
   `match` gets to be a plain function rather than a row in a schema.

   Every `note` is the honest version of its own predicate. A pool you cannot see the shape
   of is a pool you cannot trust, and "obscure" in particular is a claim about missing data
   rather than about games, so it says so. */

const thmEn = (r) => evEnrich(r) || {};
// All four of these are only trustworthy behind an igdbId: a fallback match (IGN, GameSpot,
// Steam) fills the same arrays with free text, which is why unifiedGenreVals ignores it too.
const thmIgdb = (r, field) => {
  const e = thmEn(r);
  return e.igdbId ? (e[field] || []).map((v) => String(v).toLowerCase()) : [];
};
// Only the two vocabularies a theme here actually reads. The other three IGDB arrays
// (themes, genres, gameModes) are one thmIgdb call away when a theme wants them — and
// evHasMode already exists for the last of those.
const thmKw = (r) => thmIgdb(r, "keywords");
const thmPersp = (r) => thmIgdb(r, "perspectives");
const thmAny = (list, ...want) => want.some((w) => list.includes(w));

/* Explicit mood/genre tags are sparse even on the games that define these requests.
   Exact titles fill known gaps; never match a loose noun or a whole franchise (which
   would admit spin-offs). Check the IGDB name too for sheet aliases and punctuation. */
const THM_WHOLESOME_TITLES = new Set([
  "a short hike", "lil gator game", "toem", "toem 2", "alba: a wildlife adventure",
  "little kitty, big city", "chicory: a colorful tale", "sable",
]);
const THM_ZELDALIKE_TITLES = new Set([
  "tunic", "death's door", "hob", "ittle dew", "ittle dew 2", "ittle dew 2+",
  "blossom tales 2: the minotaur prince", "oceanhorn: monster of uncharted seas",
  "oceanhorn 2: knights of the lost realm", "the swords of ditto",
  "the swords of ditto: mormo's curse", "okami", "okami hd", "ōkami", "ōkami hd",
]);
// These two editorial categories cannot be inferred from "immersive", "surreal" or
// "indie". Exact selections cover the wider family, including systemic relatives
// for immersive sims and surreal/experimental games as well as comedy for weird games.
const THM_IMMERSIVE_TITLES = new Set([
  "deus ex", "deus ex: game of the year edition", "deus ex: invisible war",
  "deus ex: human revolution", "deus ex: human revolution - director's cut",
  "deus ex: mankind divided", "dishonored", "dishonored: definitive edition",
  "dishonored 2", "dishonored: death of the outsider", "system shock",
  "system shock: enhanced edition", "system shock 2", "system shock 2: 25th anniversary remaster",
  "thief: the dark project", "thief gold", "thief ii: the metal age", "thief: deadly shadows",
  "arx fatalis", "ultima underworld: the stygian abyss", "ultima underworld ii: labyrinth of worlds",
  "gloomwood", "ctrl alt ego", "shadows of doubt", "cruelty squad", "weird west",
  "deathloop", "blood west", "dark messiah of might and magic",
  "deus ex: human revolution - the missing link", "deus ex: the missing link",
  "prey: mooncrash", "e.y.e: divine cybermancy", "streets of rogue",
  "vampire: the masquerade - bloodlines", "the original strife: veteran edition",
  "bioshock", "bioshock remastered", "bioshock 2", "bioshock 2 remastered",
  "bioshock 2: minerva's den", "bioshock 2: minerva's den remastered",
  "hitman: blood money", "hitman", "hitman 2", "hitman 3",
  "hitman world of assassination", "hitman: world of assassination",
  "hitman world of assassination: signature edition",
  "hitman: world of assassination - signature edition",
  "gloomwood: early access", "filcher", "neon struct", "skin deep", "fallen aces",
  "fortunes run", "monomyth", "peripeteia", "brigand: oaxaca", "consortium",
  "consortium remastered", "consortium: the tower", "underworld ascendant", "teardown",
]);
const THM_WEIRD_TITLES = new Set([
  "katamari damacy", "katamari damacy reroll", "we love katamari",
  "we love katamari reroll + royal reverie", "beautiful katamari", "katamari forever",
  "me & my katamari", "touch my katamari", "donut county", "jazzpunk", "jazzpunk: director's cut",
  "wattam", "chuchel", "plug & play", "frog fractions", "frog fractions: game of the decade edition",
  "pikuniku", "octodad: dadliest catch", "untitled goose game", "what the golf?",
  "thank goodness you're here!", "later alligator", "little inferno", "trombone champ",
  "the procession to calvary", "tiny and big: grandpa's leftovers",
  // Surreal worlds, peculiar everyday rituals and handmade experiments.
  "hylics", "hylics 2", "off", "space funeral", "moon: remix rpg adventure",
  "chulip", "chibi-robo!", "chibi-robo!: park patrol", "doshin the giant",
  "cubivore: survival of the fittest", "incredible crisis", "seaman", "mister mosquito",
  "stretch panic", "muscle march", "noby noby boy", "locoroco", "locoroco 2",
  "locoroco remastered", "locoroco 2 remastered", "locoroco midnight carnival",
  "samorost", "samorost 1", "samorost 2", "samorost 3", "botanicula", "creaks", "happy game",
  "pilgrims", "machinarium",
  "kids", "everything", "mountain", "the beginner's guide",
  "the stanley parable", "the stanley parable: ultra deluxe", "accounting", "accounting+",
  "dr. langeskov, the tiger, and the terribly cursed emerald: a whirlwind heist",
  "hypnospace outlaw", "broken reality", "sludge life", "sludge life 2",
  "sludge life: the big mud sessions", "off-peak", "the norwood suite",
  "tales from off-peak city vol. 1", "betrayal at club low", "psychopomp",
  "psychopomp gold", "post void", "no thing", "no-thing",
  "puss!", "orbo's odyssey", "mouthole", "blippo+", "about an elf",
  "eastern mind: the lost souls of tong nou", "cookie's bustle",
  "tiny terry's turbo trip", "dropsy", "paradigm", "journey of a roach",
  "west of loathing", "shadows over loathing", "the many pieces of mr. coo",
  "frog detective 1: the haunted island", "the haunted island, a frog detective game",
  "frog detective 2: the case of the invisible wizard", "frog detective 3: corruption at cowboy county",
  "frog detective: the entire mystery", "goat simulator", "goat simulator 3",
  "i am bread", "i am fish", "surgeon simulator 2013", "surgeon simulator: experience reality",
  "potatoman seeks the troof", "turnip boy commits tax evasion", "turnip boy robs a bank",
  "what the bat?", "what the car?", "duck simulator 2", "frog fractions 2",
]);
const THM_DETECTIVE_TITLES = new Set([
  "return of the obra dinn", "the case of the golden idol", "the rise of the golden idol",
  "paradise killer", "the forgotten city", "her story", "the roottrees are dead",
  "disco elysium", "disco elysium: the final cut", "shadows of doubt", "l.a. noire",
  "tangle tower", "detective grimoire: secret of the swamp", "hypnospace outlaw",
  "the painscreek killings", "the operator", "duck detective: the secret salami",
  "duck detective: the ghost of glamping", "the darkside detective",
  "frog detective 1: the haunted island", "the haunted island, a frog detective game",
  "frog detective 2: the case of the invisible wizard", "frog detective 3: corruption at cowboy county",
  "frog detective: the entire mystery", "phoenix wright: ace attorney",
  "phoenix wright: ace attorney - justice for all", "phoenix wright: ace attorney - trials and tribulations",
  "phoenix wright: ace attorney - dual destinies", "phoenix wright: ace attorney - spirit of justice",
  "phoenix wright: ace attorney trilogy", "apollo justice: ace attorney", "apollo justice: ace attorney trilogy",
  "ace attorney investigations: miles edgeworth", "ace attorney investigations 2: prosecutor's gambit",
  "ace attorney investigations collection", "the great ace attorney chronicles",
  "the great ace attorney: adventures", "the great ace attorney 2: resolve",
]);
// These selections describe a game's central activity, not a passing story element.
// Keep editions explicit so unrelated sequels, compilations and spin-offs stay out.
const THM_KNOWLEDGE_TITLES = new Set([
  "outer wilds", "outer wilds: echoes of the eye", "outer wilds: archaeologist edition",
  "tunic", "the witness", "animal well", "chants of sennaar", "heaven's vault",
  "fez", "taiji", "antichamber", "manifold garden", "baba is you", "void stranger",
  "environmental station alpha", "la-mulana", "la-mulana 2", "la-mulana 1 & 2: hidden treasures edition",
  "toki tori 2", "toki tori 2+", "a monster's expedition", "stephen's sausage roll",
  "can of wormholes", "leap year", "understand", "lingo", "sensorium",
  "return of the obra dinn", "the case of the golden idol", "the rise of the golden idol",
  "the roottrees are dead", "the forgotten city",
  "myst", "myst: masterpiece edition", "realmyst", "realmyst: masterpiece edition",
  "myst iii: exile", "myst iv: revelation", "myst v: end of ages",
  "riven", "riven: the sequel to myst", "obduction", "quern: undying thoughts",
]);
const THM_TIME_TITLES = new Set([
  "deathloop", "minit", "braid", "braid: anniversary edition", "ghost trick: phantom detective",
  "superhot", "superhot vr", "superhot: mind control delete", "timeshift", "timelie",
  "quantum break", "quantum conundrum", "singularity", "iron danger", "induction",
  "the entropy centre", "eternal threads", "arise: a simple story", "last day of june",
  "life is strange", "life is strange remastered", "life is strange: double exposure",
  "blinx: the time sweeper", "blinx 2: masters of time and space", "blades of time",
  "prince of persia: the sands of time", "prince of persia: warrior within",
  "prince of persia: the two thrones", "prince of persia: the forgotten sands",
  "timespinner", "cogen: sword of rewind",
  "lysfanga: the time shift warrior", "aeternoblade", "aeternoblade ii",
  "aeternoblade ii: director's rewind", "chronos twins", "chronos twins dx", "chronovolt",
  "outer wilds", "outer wilds: echoes of the eye", "outer wilds: archaeologist edition",
  "returnal", "the forgotten city", "twelve minutes", "gnosia", "the sexy brutale",
  "the legend of zelda: majora's mask", "the legend of zelda: majora's mask 3d",
  "radiant historia", "radiant historia: perfect chronology", "chrono trigger",
  "chrono cross", "chrono cross: the radical dreamers edition", "time hollow",
  "day of the tentacle", "day of the tentacle remastered", "the silent age",
  "9 hours, 9 persons, 9 doors", "nine hours, nine persons, nine doors",
  "zero escape: virtue's last reward", "zero escape: zero time dilemma",
  "zero escape: the nonary games", "a guidebook of babel", "echoshift",
]);
const THM_SPACE_TITLES = new Set([
  "alien: isolation", "alien: isolation - the collection", "dead space", "dead space 2",
  "dead space 3", "dead space: extraction", "prey", "prey: mooncrash", "the swapper",
  "outer wilds", "outer wilds: echoes of the eye", "outer wilds: archaeologist edition",
  "no man's sky", "astroneer", "subnautica", "subnautica: below zero",
  "system shock", "system shock: enhanced edition", "system shock 2",
  "system shock 2: 25th anniversary remaster", "returnal", "scars above",
  "the turing test", "observation", "tacoma", "deliver us the moon", "deliver us mars",
  "adr1ft", "event[0]", "void bastards", "duskers", "ftl: faster than light",
  "oxygen not included", "breathedge", "the planet crafter", "journey to the savage planet",
  "revenge of the savage planet", "lifeless planet", "lifeless planet: premier edition",
  "planet alpha", "planet of the eyes", "planet of lana", "planet of lana ii: children of the leaf",
  "the solus project", "the signal from tölva", "the signal from tolva",
  "exo one", "in other waters", "starbound", "mouthwashing",
  "metroid", "metroid: zero mission", "metroid ii: return of samus", "metroid: samus returns",
  "super metroid", "metroid fusion", "metroid dread", "metroid: other m",
  "metroid prime", "metroid prime remastered", "metroid prime 2: echoes",
  "metroid prime 3: corruption", "metroid prime 4: beyond", "metroid prime: trilogy",
  "metroid prime hunters",
]);
const THM_MACHINE_TITLES = new Set([
  "factorio", "factorio: space age", "satisfactory", "opus magnum", "infinifactory",
  "spacechem", "tis-100", "shenzhen i/o", "exapunks", "molek-syntez", "last call bbs",
  "human resource machine", "7 billion humans", "seven billion humans",
  "dyson sphere program", "shapez", "shapez 2", "mindustry", "builderment",
  "autonauts", "autonauts vs piratebots", "automachef", "big pharma", "good company",
  "production line", "little big workshop", "the signal state", "linkito", "retro gadgets",
  "nova lands", "oddsparks: an automation adventure", "station to station", "while true: learn()",
  "besiege", "poly bridge", "poly bridge 2", "poly bridge 3", "bridge constructor portal",
  "contraption maker", "the incredible machine", "the incredible machine 2",
  "the incredible machine 3", "the incredible machine: even more contraptions",
  "return of the incredible machine: contraptions", "the even more incredible machine",
  "crazy machines", "crazy machines 2", "crazy machines 3", "fantastic contraption",
  "scrap mechanic", "screw drivers", "carnage heart", "carnage heart exa",
  "replicube", "manufactoria", "manufactoria 2022", "neon noodles", "word factori",
  "alan's automaton workshop", "nandgame", "turing complete",
]);
const THM_RHYTHM_TITLES = new Set([
  "rez", "rez hd", "rez infinite", "thumper", "hi-fi rush", "sayonara wild hearts",
  "ape out", "child of eden", "beat saber", "pistol whip", "metal: hellsinger",
  "bpm: bullets per minute", "crypt of the necrodancer",
  "cadence of hyrule: crypt of the necrodancer featuring the legend of zelda",
  "everhood", "everhood 2", "just shapes & beats", "sound shapes", "rhythm doctor",
  "a dance of fire and ice", "rhythm heaven", "rhythm heaven fever", "rhythm heaven megamix",
  "rhythm tengoku", "rhythm paradise", "beat the beat: rhythm paradise",
  "parappa the rapper", "parappa the rapper 2", "um jammer lammy", "gitaroo man",
  "gitaroo man lives!", "elite beat agents", "osu! tatakae! ouendan", "moero! nekketsu rhythm damashii osu! tatakae! ouendan 2",
  "patapon", "patapon 2", "patapon 3", "patapon 1+2 replay", "patapon remastered",
  "patapon 2 remastered", "lumines", "lumines remastered", "lumines ii",
  "lumines live!", "lumines supernova", "lumines: electronic symphony",
  "tetris effect", "tetris effect: connected", "trombone champ", "melatonin",
]);
// Audited metadata mistakes: a musical platformer and an adventure with a music minigame.
const THM_RHYTHM_EXCLUSIONS = new Set(["tempo", "athena: awakening from the ordinary life"]);
/* One hand on a phone is two claims at once, and the pool has to make both.

   REACH. The sheet's platform is the copy you own, and most of them are not on the phone
   at all. Delta covers Nintendo's handhelds and home consoles up to the N64, Sega's 8- and
   16-bit machines and the PlayStation; RomM plays the rest of the ROM library in Safari
   through EmulatorJS, minus the folders it can only stream from the Webstation container
   (launch.js keeps that list — GameCube, Wii, PS2, Dreamcast, 3DS and friends are out).
   Add the games that are already native (iOS) or already a web page (Browser) and that is
   the list below. A PC, Switch or PS5 row is not a one-handed game, it is a different room.

   INPUT. One thumb can only be in one place at a time, so the test is that nothing ever
   needs two inputs at once or an input at a particular moment: the sheet's own untimed
   genres (turn-based and tactics RPGs, visual novels, card and board games, text
   adventures, point-and-click, hidden object), IGDB's equivalents when no real-time genre
   sits beside them, and the one-input phone shapes — runners, match-3, idlers. The curated
   titles are the ones no genre can reach: a stylus game whose real controller is a finger
   (Picross, Layton, Scribblenauts, Ace Attorney), a touch-native iOS game filed under
   Puzzle or Adventure, and the handful built for portrait thumb play (Downwell, Poinpy).

   Timed turn-based combat is the one audited hole: Mario & Luigi, Paper Mario, Super Mario
   RPG and The Legend of Dragoon all turn a menu choice into a button you have to hit on
   the frame, which is exactly what a thumb reaching across the glass cannot do. */
const THM_ONEHAND_PLATFORMS = new Set([
  "ios", "browser",
  "nes", "famicom disk system", "snes", "nintendo 64", "game boy", "game boy color",
  "game boy advance", "nintendo ds", "nintendo dsi", "dsiware",
  "sega genesis", "sega master system", "sega game gear", "sega sg-1000", "sega cd",
  "sega 32x", "sega saturn", "playstation", "playstation portable", "arcade",
  "neo-geo", "neo-geo pocket", "neo-geo pocket color", "turbografx-16", "turbografx-cd",
  "wonderswan", "wonderswan color", "virtual boy",
  "atari 2600", "atari 7800", "atari lynx",
]);
// The sheet's own genre vocabulary, which already splits untimed Puzzle from Puzzle Action.
const THM_ONEHAND_GENRES = new Set([
  "turn-based rpg", "strategy rpg", "turn-based tactics", "turn-based strategy", "4x",
  "visual novel", "card game", "board game", "text adventure", "point-and-click",
  "hidden object", "trivia", "runner",
]);
const THM_ONEHAND_IGDB = new Set([
  "visual novel", "point-and-click", "card & board game", "turn-based strategy (tbs)",
]);
// IGDB hands a game several genres at once, and any of these means a hand on each side.
const THM_ONEHAND_REALTIME = new Set([
  "shooter", "platform", "fighting", "racing", "arcade", "music", "sport", "pinball",
  "hack and slash/beat 'em up", "real time strategy (rts)",
]);
const THM_ONEHAND_TITLES = new Set([
  "monument valley", "monument valley 2", "monument valley 3",
  "the room", "the room two", "the room three", "the room: old sins",
  "hitman go", "lara croft go", "deus ex go", "grindstone", "you must build a boat",
  "picture cross towns", "pixel puzzle collection", "hatsune miku logic paint",
  "layton brothers: mystery room", "a monster's expedition", "10000000", "possessions.",
  "naya's quest", "shardlands", "spider: the secret of bryce manor",
  "lego builder's journey", "dream of pixels", "creaks", "no-one has to die",
  "device 6", "florence", "pilgrims", "samorost", "assemble with care", "mosaic",
  "takeshi and hiroshi", "neo cab", "next stop nowhere", "jenny leclue: detectivu",
  "tangle tower", "guildlings", "the collage atlas", "the get out kids", "moida mansion",
  "twelve minutes", "pocket boss", "sweetxheart", "dragon's lair", "the act",
  "discovery tour: medieval baghdad", "beyond a steel sky", "oxenfree ii: lost signals",
  "frog fractions", "candy box 2", "terra nil", "the tower: assassin's creed",
  "animal crossing: pocket camp complete", "plants vs. zombies 2",
  "crystal defenders: vanguard storm", "ridiculous fishing", "what the golf?",
  "game dev story", "dungeon village", "epic astro story", "grand prix story",
  "hot springs story", "mega mall story", "oh! edo towns", "pocket league story",
  "pocket stables", "venture towns", "cafeteria nipponica", "tv studio story",
  "jetpack joyride", "punch quest", "super mario run", "rayman jungle run",
  "rayman fiesta run", "downwell", "poinpy", "gibbon: beyond the trees",
  "picross ds", "picross 3d", "picross 2", "mario's picross", "mario no super picross",
  "picross np vol. 1", "picross np vol. 2", "picross np vol. 3", "picross np vol. 4",
  "picross np vol. 5", "picross np vol. 6", "picross np vol. 7", "picross np vol. 8",
  "polarium", "pac-pix", "magnetica", "soul bubbles", "peggle: dual shot",
  "scribblenauts", "super scribblenauts", "scribblenauts remix", "it's mr. pants",
  "nupa: numeric paint puzzle", "picture puzzle", "logic puzzle rainbow town",
  "professor layton and the curious village", "professor layton and the diabolical box",
  "professor layton and the unwound future", "professor layton and the last specter",
  "hotel dusk: room 215", "last window: the secret of cape west",
  "phoenix wright: ace attorney", "apollo justice: ace attorney",
  "ghost trick: phantom detective",
]);
const THM_ONEHAND_EXCLUSIONS = new Set([
  "mario & luigi: superstar saga", "mario & luigi: partners in time",
  "mario & luigi: bowser's inside story", "paper mario",
  "super mario rpg: legend of the seven stars", "the legend of dragoon",
]);
/* Four more by what you DO for most of the game, each with the same refusal as the rest:
   a stealth section, a shop menu, one robot boss or a live-action cutscene is a game that
   contains the thing, not a game that is the thing.

   Stealth trusts the sheet's own Stealth Action genre; IGDB's stealth theme is far too
   generous on its own (it tags Metro 2033 and Mafia II), so it only counts on a tactics
   game, where it means Commandos rather than one optional sneaking level. */
const THM_STEALTH_TACTICS = new Set(["real-time tactics", "turn-based tactics"]);
const THM_STEALTH_TITLES = new Set([
  "mark of the ninja", "mark of the ninja: remastered", "invisible, inc.", "gunpoint",
  "monaco: what's yours is mine", "heat signature", "republique", "hitman go",
  "desperados iii", "shadow gambit: the cursed crew", "commandos: behind enemy lines",
  "commandos 2: men of courage", "tenchu 2: birth of the stealth assassins",
]);
/* Management is the sheet's Simulation genre AND a running-the-place signal from IGDB.
   The farm-and-village life sims carry the same management tag for their shipping bin, so
   their series are set aside: there the business is the backdrop, not the game. */
const THM_MANAGE_KEYWORDS = ["management", "city builder", "tycoon", "colony simulator",
  "base management", "store management", "dungeon management"];
const THM_MANAGE_LIFE_SIMS = ["harvest moon", "story of seasons", "rune factory", "animal crossing"];
const THM_MANAGE_EXCLUSIONS = new Set(["stardew valley", "my time at portia", "snowrunner"]);
/* Giant robots: IGDB's mecha keyword, the franchises that are mecha by definition (every
   Gundam game pilots a mobile suit; every BattleTech one a 'Mech), and exact titles for
   the series IGDB leaves untagged. Evangelion is not on the franchise list — half of its
   games are dating sims about the pilots. */
const THM_MECHA_FRANCHISES = ["gundam", "sd gundam", "super robot wars", "battletech",
  "front mission", "macross", "zoids", "zone of the enders"];
const THM_MECHA_TITLES = new Set([
  "armored core", "armored core: project phantasma", "armored core: master of arena",
  "armored core 2", "armored core 2: another age", "armored core 3", "silent line: armored core",
  "armored core: nexus", "armored core: nine breaker", "armored core: formula front",
  "armored core: last raven", "armored core 4", "armored core: for answer", "armored core v",
  "armored core: verdict day", "armored core vi: fires of rubicon",
  "titanfall", "titanfall 2", "steel battalion", "steel battalion: line of contact",
  "steel battalion: heavy armor", "gungriffon", "gungriffon ii", "gungriffon blaze",
  "virtual on: cyber troopers", "cyberbots: full metal madness", "tech romancer",
  "daemon x machina", "brigador: up-armored edition", "carnage heart", "carnage heart exa",
  "ring of red", "metal wolf chaos", "hardcore mecha", "assault suits valken 2",
  "armored hunter gunhound ex", "rigs: mechanized combat league", "murakumo: renegade mech pursuit",
  "mechassault", "mechassault 2: lone wolf", "mechwarrior 4: vengeance", "mechwarrior 4: mercenaries",
  "mechcommander", "mechcommander 2", "mech platoon", "mechstermination force",
]);
/* FMV: the sheet's FMV genre, or IGDB's full-motion-video tags on the kinds of game that
   are built out of footage (adventure, rail shooter, puzzle, visual novel). A live-action
   cutscene tag does not count, and the audited misses are games whose "video" is a CG
   backdrop or anime. */
const THM_FMV_GENRES = new Set(["adventure", "rail shooter", "puzzle", "visual novel", "fmv"]);
const THM_FMV_EXCLUSIONS = new Set([
  "child of eden", "fantavision", "resident evil: the darkside chronicles", "steins;gate elite",
  "dispatch",
]);
const thmKnownTitle = (r, titles) => [r.title, thmEn(r).name].some((title) =>
  titles.has(String(title || "").trim().toLowerCase().replace(/[’‘]/g, "'")));
const thmOneHanded = (r) => {
  if (!THM_ONEHAND_PLATFORMS.has(String(r.platform || "").trim().toLowerCase())) return false;
  if (thmKnownTitle(r, THM_ONEHAND_EXCLUSIONS)) return false;
  if (thmKnownTitle(r, THM_ONEHAND_TITLES)) return true;
  if (THM_ONEHAND_GENRES.has(String(r.genre || "").trim().toLowerCase())) return true;
  const genres = thmIgdb(r, "genres");
  if (genres.some((g) => THM_ONEHAND_IGDB.has(g)) && !genres.some((g) => THM_ONEHAND_REALTIME.has(g))) return true;
  return thmAny(thmKw(r), "endless runner", "match 3", "match three", "idle game", "clicker", "incremental");
};
const thmStealth = (r) => {
  const genre = String(r.genre || "").trim().toLowerCase();
  return genre === "stealth action" || thmKnownTitle(r, THM_STEALTH_TITLES) ||
    (THM_STEALTH_TACTICS.has(genre) && thmIgdb(r, "themes").includes("stealth"));
};
const thmManage = (r) => {
  if (String(r.genre || "").trim().toLowerCase() !== "simulation") return false;
  if (thmKnownTitle(r, THM_MANAGE_EXCLUSIONS) ||
      thmIgdb(r, "franchises").some((f) => THM_MANAGE_LIFE_SIMS.includes(f))) return false;
  return thmAny(thmKw(r), ...THM_MANAGE_KEYWORDS) || thmIgdb(r, "themes").includes("business");
};
const thmMecha = (r) => thmKnownTitle(r, THM_MECHA_TITLES) || thmKw(r).includes("mecha") ||
  thmIgdb(r, "franchises").some((f) => THM_MECHA_FRANCHISES.includes(f));
const thmFmv = (r) => {
  if (thmKnownTitle(r, THM_FMV_EXCLUSIONS)) return false;
  const genre = String(r.genre || "").trim().toLowerCase();
  return genre === "fmv" ||
    (THM_FMV_GENRES.has(genre) && thmAny(thmKw(r), "full motion video", "fmv", "live action"));
};
const thmWholesome = (r) => {
  const k = thmKw(r);
  // Cozy horror is still horror; a cozy tag alone must not override that evidence.
  if ([...thmIgdb(r, "themes"), ...k].some((tag) => /\bhorror\b/.test(tag))) return false;
  return thmAny(k, "wholesome", "cozy", "cosy", "cozy adventure") ||
    thmKnownTitle(r, THM_WHOLESOME_TITLES);
};
const thmZeldalike = (r) => thmAny(thmKw(r), "zelda-like", "zelda like", "zeldalike") ||
  thmKnownTitle(r, THM_ZELDALIKE_TITLES);
const thmImmersive = (r) => {
  const e = thmEn(r);
  // The feature-phone BioShock is a separate 2D adaptation, not the systemic FPS.
  if (+e.igdbId === 152660 || (/^(brew|j2me)$/i.test(String(r.platform || "")) &&
    thmKnownTitle(r, new Set(["bioshock"])))) return false;
  if (thmKnownTitle(r, THM_IMMERSIVE_TITLES)) return true;
  // Arkane's Prey, not the unrelated 2006 shooter. Unknown editions fail closed.
  return +e.igdbId === 19531 || (!e.igdbId && thmYear(r) === 2017 &&
    String(r.title || "").trim().toLowerCase() === "prey");
};
const thmWeird = (r) => thmKnownTitle(r, THM_WEIRD_TITLES) ||
  // The anti-RPG's rerelease is named just Moon in IGDB; Moon (2009) is a DS shooter.
  +thmEn(r).igdbId === 188135;
const thmKnowledge = (r) => thmKnownTitle(r, THM_KNOWLEDGE_TITLES) ||
  thmAny(thmKw(r), "metroidbrainia", "knowledge-based progression", "knowledge based progression");
const thmTime = (r) => thmKnownTitle(r, THM_TIME_TITLES) ||
  thmAny(thmKw(r), "time loop", "time-loop", "time loops");
const thmMachines = (r) => thmKnownTitle(r, THM_MACHINE_TITLES) ||
  thmAny(thmKw(r), "factory automation", "automation puzzle", "programming puzzle", "engineering puzzle");
const thmRhythm = (r) => !thmKnownTitle(r, THM_RHYTHM_EXCLUSIONS) && (thmKnownTitle(r, THM_RHYTHM_TITLES) ||
  String(r.genre || "").trim().toLowerCase() === "rhythm" ||
  (thmIgdb(r, "genres").includes("music") && thmAny(thmKw(r), "rhythm game", "rhythm")));
const thmDetective = (r) => {
  if (thmKnownTitle(r, THM_DETECTIVE_TITLES)) return true;
  const k = thmKw(r), genres = thmIgdb(r, "genres");
  // A detective character or a mystery subplot does not establish investigation gameplay.
  if (thmAny(genres, "shooter", "fighting", "hack and slash/beat 'em up", "platform", "music")) return false;
  if (thmAny(k, "detective investigation", "deductive reasoning")) return true;
  return thmAny(k, "detective", "private detective") &&
    (genres.includes("point-and-click") ||
      (thmAny(k, "investigation", "investigations") && thmAny(genres, "puzzle", "visual novel")));
};

/* “Young” is deliberately conservative: the youngest general-audience tier from each
   ratings board, and no inference when a rating is absent. Playing together is equally
   literal. Co-Optimus must report two people on one machine, or IGDB must explicitly say
   split screen; generic multiplayer and online-only co-op do not count. */
const THM_FAMILY_RATINGS = new Set([
  "ESRB EC", "ESRB E", "PEGI 3", "PEGI 7", "CERO A",
  "USK 0", "USK 6", "GRAC ALL", "CLASS_IND L", "ACB G",
]);
const thmFamilyPlay = (r) => {
  const e = thmEn(r);
  return THM_FAMILY_RATINGS.has(e.ageRating) &&
    ((+e.coopLocal || 0) > 1 || thmIgdb(r, "gameModes").includes("split screen"));
};

/* Comfort is measured from the sheet rather than guessed from genre labels. Primary genres
   are narrow enough to say something useful ("Rhythm", not IGDB's umbrella "Music"), and
   the cache follows the current rows array so a data refresh naturally rebuilds it. */
let thmGenreRows = null, thmGenreDone = null, thmGenreEpoch = -1;
function thmCompletedGenres() {
  const rows = evRows();
  const epoch = typeof _enrichEpoch === "number" ? _enrichEpoch : 0;
  if (rows === thmGenreRows && thmGenreEpoch === epoch && thmGenreDone) return thmGenreDone;
  const counts = new Map();
  rows.forEach((r) => {
    const genre = String(r.genre || "").trim();
    if (r.completed && genre) counts.set(genre, (counts.get(genre) || 0) + 1);
  });
  thmGenreRows = rows;
  thmGenreEpoch = epoch;
  thmGenreDone = counts;
  return counts;
}
const thmOutsideComfort = (r) => {
  const genre = String(r.genre || "").trim();
  const score = criticOf(r);
  return !!genre && (thmCompletedGenres().get(genre) || 0) <= 5 && score != null && score >= .80;
};

/* A repeatable session needs stronger evidence than merely being a roguelike or having a
   score. Explicit score-attack/endless modes qualify directly; otherwise both a score chase
   and a run-reset signal must be present. */
const thmOneMoreRun = (r) => {
  const k = thmKw(r);
  if (thmAny(k, "score attack", "endless mode", "endless waves")) return true;
  return k.includes("high score") && thmAny(k, "roguelike", "roguelite", "rogue-like",
    "rogue-lite", "procedural generation", "procedurally generated", "permadeath");
};

const thmCultClassic = (r) => {
  const e = thmEn(r);
  if (!e.igdbId) return false;
  const year = thmYear(r);
  const voters = +e.userRatingCount || 0;
  return year != null && year <= new Date().getFullYear() - 10 &&
    e.userRating != null && e.userRating >= .82 && voters >= 20 && voters <= 150 &&
    (+e.criticCount || 0) <= 3;
};

/* The year the GAME came out, not the year the copy on the shelf did. The sheet's
   releaseYear dates the edition you own — The Mysterious Murasame Castle is 2014 on it,
   because that is when the 3DS Virtual Console sold it to you — and IGDB's `year` is
   first_release_date, which is 1986. A retro theme that used the sheet's column would put
   every Virtual Console purchase in the modern era and lose the actual 1986 games. Parsed
   out of a string because releaseYear also holds "Early Access". */
function thmYear(r) {
  const y = thmEn(r).year;
  if (y) return +y;
  const m = /^\s*(\d{4})/.exec(String(r.releaseYear || r.releaseDate || ""));
  return m ? +m[1] : null;
}

/* Uniqueness is relative to the full Gamedex list, before playability/completion
   filtering. Count games, not copies, and rebuild when metadata or rows change. */
const THM_ONLY_PLATFORM_MIN = 100, THM_ONLY_POPULAR_MIN = 10;
let thmOnlyCache = null;
function thmOnlyReasons() {
  const rows = evRows();
  const epoch = typeof _enrichEpoch === "number" ? _enrichEpoch : 0;
  if (thmOnlyCache && thmOnlyCache.rows === rows && thmOnlyCache.epoch === epoch) {
    return thmOnlyCache.reasons;
  }
  const platforms = new Map(), global = new Map(), entries = [];
  const add = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const row of rows) {
    if (!row.title || !String(row.platform || "").trim()) continue;
    const id = (typeof cachedGameId === "function" && cachedGameId(row)) ||
      "title:" + row.title.trim().toLowerCase().replace(/\s+/g, " ");
    const platform = row.platform.trim().toLowerCase();
    if (!platforms.has(platform)) platforms.set(platform, { games: new Set(), categories: new Map() });
    const p = platforms.get(platform);
    p.games.add(id);
    const categories = [];
    for (const [kind, vals] of [
      ["genre", unifiedGenreVals(row)],
      ["developer", unifiedDevVals(row)],
      ["franchise", unifiedFranchiseVals(row)],
    ]) {
      for (const raw of vals) {
        const name = String(raw || "").trim();
        if (!name || /^(unknown|n\/a|none|unspecified)$/i.test(name)) continue;
        const key = kind + ":" + name.toLowerCase();
        add(global, key, id);
        add(p.categories, key, id);
        categories.push({ kind, key, name });
      }
    }
    entries.push({ row, platform, categories });
  }
  const reasons = new Map();
  for (const { row, platform, categories } of entries) {
    const p = platforms.get(platform);
    if (p.games.size < THM_ONLY_PLATFORM_MIN) continue;
    const hits = categories.filter(({ kind, key }) => p.categories.get(key).size === 1 &&
      (kind === "genre" || global.get(key).size >= THM_ONLY_POPULAR_MIN));
    if (hits.length) reasons.set(row._k, hits.map(({ kind, name }) =>
      kind === "genre" ? `Only ${name} game` :
        kind === "developer" ? `Only game by ${name}` : `Only ${name} franchise game`));
  }
  thmOnlyCache = { rows, epoch, reasons };
  return reasons;
}

const THEMES = [
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    blurb: "neon, chrome and a bad future",
    icon: "i-bolt",
    n: 5,
    /* One keyword, which is not where this started. Three wider rungs were written, run
       against the shelf, and thrown away for saying things that are not true:
         dystopian AND science fiction  +42, and they were Fallout, Half-Life 2, Metro, four
                                        Command & Conquers and three Dawn of Wars. Dystopian
                                        is a mood sci-fi wears; it is its own theme below,
                                        where those games are exactly right.
         cybernetics                    +10, half of them The Binding of Isaac, Xenonauts,
                                        X-COM: Terror from the Deep and Bulletstorm. It tags
                                        anything containing a cyborg.
         cyberspace / transhumanism     +0 and +2, and the two were a comedy platformer.
       So the honest pool is the games IGDB itself calls cyberpunk, and it is 137 deep. */
    note: "IGDB's cyberpunk keyword, on its own. Three wider rungs were tried and removed — " +
          "each of them let in games that merely contain a cyborg or a bad government.",
    match: (r) => thmKw(r).includes("cyberpunk"),
    skin: "--ev-disp:'Orbitron',var(--display);--ev-size:40px;--ev-dw:900;--ev-ls:.06em;" +
          "--ev-deco:#f472b6;--ev-fg:#fde7f6;--ev-fg-2:#c9a8c6;--ev-edge:rgba(244,114,182,.34);" +
          "--ev-edge-hi:rgba(244,114,182,.8);--ev-glow:rgba(244,114,182,.4);--ev-t1:#fff0fa;" +
          "--ev-t2:#22d3ee;--ev-t3:#f472b6;--ev-on-cta:#21041a;--ev-k:#22d3ee;" +
          "--ev-art:radial-gradient(110% 150% at 84% 118%,rgba(244,114,182,.3),transparent 56%)," +
          "radial-gradient(90% 130% at 4% -18%,rgba(34,211,238,.24),transparent 58%)," +
          "linear-gradient(145deg,#07040d,#120821 68%,#05121c)",
    deco: [
      { i: "i-bolt", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-server", x: 70, y: 22, s: 26, r: 6, lift: 11, d: 80 },
      { i: "i-plug", x: 24, y: 20, s: 24, r: -12, lift: 13, d: 40 },
      { i: "i-nosignal", x: 47, y: 84, s: 20, r: 8, lift: 8, d: 200, o: .55 },
      { i: "i-bolt", x: 60, y: 12, s: 16, r: -8, lift: 15, d: 240, o: .5 },
    ],
  },
  {
    id: "vr",
    name: "Virtual Reality",
    blurb: "the headset games, which the shelf hides",
    icon: "i-vr",
    n: 4,
    note: "IGDB's Virtual Reality perspective — a real field it has always had — plus any " +
          "row whose platform names a headset. Four rather than five: VR is an evening's " +
          "commitment even when the game is short.",
    match: (r) => thmPersp(r).includes("virtual reality")
      || /oculus|meta quest|\bquest\b|vive|valve index|psvr|playstation vr|\bvr\b/i.test(String(r.platform || "")),
    skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:52px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#818cf8;--ev-fg:#eef0ff;--ev-fg-2:#a9b0d8;--ev-edge:rgba(129,140,248,.34);" +
          "--ev-edge-hi:rgba(129,140,248,.78);--ev-glow:rgba(129,140,248,.36);--ev-t1:#f4f5ff;" +
          "--ev-t2:#a5b4fc;--ev-t3:#818cf8;--ev-on-cta:#0d0f2b;--ev-k:#a5b4fc;" +
          "--ev-art:radial-gradient(120% 150% at 82% 120%,rgba(129,140,248,.3),transparent 56%)," +
          "radial-gradient(80% 120% at 8% -16%,rgba(56,189,248,.2),transparent 60%)," +
          "linear-gradient(150deg,#06060f,#0d0e22 70%,#0a1220)",
    deco: [
      { i: "i-vr", x: 85, y: 66, s: 48, lift: 12 },
      { i: "i-globe", x: 70, y: 22, s: 26, r: 0, lift: 11, d: 90 },
      { i: "i-pad", x: 24, y: 20, s: 24, r: -10, lift: 13, d: 40 },
      { i: "i-vr", x: 48, y: 84, s: 18, r: 7, lift: 8, d: 210, o: .5 },
    ],
  },
  {
    id: "obscure",
    name: "Obscure",
    blurb: "games nobody wrote about",
    icon: "i-nosignal",
    n: 5,
    note: "Two or fewer IGDB user ratings AND two or fewer critic scores. This is a claim " +
          "about the ABSENCE of data, so it only counts games IGDB actually matched — " +
          "otherwise every row the enricher failed on would look like a lost classic.",
    match: (r) => {
      const e = thmEn(r);
      if (!e.igdbId) return false;
      return (e.userRatingCount || 0) <= 2 && (e.criticCount || 0) <= 2;
    },
    skin: "--ev-disp:'Special Elite',var(--display);--ev-size:42px;--ev-dw:400;--ev-ls:.01em;" +
          "--ev-deco:#a8a29e;--ev-fg:#f2efe9;--ev-fg-2:#b8b2a8;--ev-edge:rgba(168,162,158,.3);" +
          "--ev-edge-hi:rgba(214,211,209,.6);--ev-glow:rgba(168,162,158,.22);--ev-t1:#faf8f4;" +
          "--ev-t2:#d6d3d1;--ev-t3:#a8a29e;--ev-on-cta:#1c1a17;--ev-k:#d6d3d1;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(168,162,158,.2),transparent 58%)," +
          "radial-gradient(80% 120% at 6% -14%,rgba(120,113,108,.24),transparent 60%)," +
          "linear-gradient(150deg,#0d0c0b,#171512 72%,#121110)",
    deco: [
      { i: "i-nosignal", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-box", x: 70, y: 24, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-search", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-box", x: 47, y: 84, s: 18, r: 12, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "retro",
    name: "Before 2006",
    blurb: "the era that ended when the Wii arrived",
    icon: "i-crt",
    n: 5,
    note: "IGDB's first release date, not the sheet's — so a Virtual Console or Mini " +
          "purchase is dated by the game (1986) rather than by the copy you own (2014). " +
          "2006 because that is where your shelf's generation line actually falls.",
    match: (r) => { const y = thmYear(r); return y != null && y < 2006; },
    skin: "--ev-disp:'Press Start 2P',var(--display);--ev-size:24px;--ev-dw:400;--ev-ls:0;" +
          "--ev-deco:#4ade80;--ev-fg:#e8ffe9;--ev-fg-2:#9fc7a6;--ev-edge:rgba(74,222,128,.32);" +
          "--ev-edge-hi:rgba(74,222,128,.72);--ev-glow:rgba(74,222,128,.3);--ev-t1:#f2fff3;" +
          "--ev-t2:#86efac;--ev-t3:#4ade80;--ev-on-cta:#052113;--ev-k:#86efac;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(74,222,128,.22),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(250,204,21,.16),transparent 60%)," +
          "linear-gradient(150deg,#060a07,#0b1410 70%,#08110c)",
    deco: [
      { i: "i-crt", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-cartridge", x: 70, y: 22, s: 26, r: 8, lift: 11, d: 80 },
      { i: "i-stick", x: 24, y: 20, s: 24, r: -12, lift: 13, d: 40 },
      { i: "i-disc", x: 47, y: 84, s: 20, r: 0, lift: 8, d: 200, o: .55 },
      { i: "i-cartridge", x: 60, y: 12, s: 16, r: -6, lift: 15, d: 240, o: .5 },
    ],
  },
  {
    id: "metroidvania",
    name: "Metroidvania",
    blurb: "one map, opened a door at a time",
    icon: "i-door",
    n: 5,
    note: "IGDB's metroidvania keyword, which is the rare case where the finest vocabulary " +
          "is also the right one: the form has a name and the people tagging games use it.",
    match: (r) => thmAny(thmKw(r), "metroidvania", "metroid-vania"),
    skin: "--ev-disp:'Anton',var(--display);--ev-size:48px;--ev-dw:400;--ev-ls:.01em;" +
          "--ev-deco:#38bdf8;--ev-fg:#e8f7ff;--ev-fg-2:#9db9cc;--ev-edge:rgba(56,189,248,.32);" +
          "--ev-edge-hi:rgba(56,189,248,.74);--ev-glow:rgba(56,189,248,.32);--ev-t1:#f0fbff;" +
          "--ev-t2:#7dd3fc;--ev-t3:#38bdf8;--ev-on-cta:#04202b;--ev-k:#7dd3fc;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(56,189,248,.26),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(167,139,250,.2),transparent 60%)," +
          "linear-gradient(150deg,#05080d,#0a1119 70%,#0b1020)",
    deco: [
      { i: "i-door", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-layers", x: 70, y: 22, s: 26, r: -6, lift: 11, d: 90 },
      { i: "i-target", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-door", x: 47, y: 84, s: 18, r: 6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "afterend",
    name: "After the End",
    blurb: "the world already fell over",
    icon: "i-alert",
    n: 5,
    note: "IGDB's post-apocalyptic keyword. Deliberately not the Survival theme, which is " +
          "twice the size and mostly crafting games with a hunger bar.",
    match: (r) => thmAny(thmKw(r), "post-apocalyptic", "post-apocalypse", "apocalyptic"),
    skin: "--ev-disp:'Graduate',var(--display);--ev-size:40px;--ev-dw:400;--ev-ls:.04em;" +
          "--ev-deco:#fb923c;--ev-fg:#fff1e3;--ev-fg-2:#c8ab92;--ev-edge:rgba(251,146,60,.3);" +
          "--ev-edge-hi:rgba(251,146,60,.72);--ev-glow:rgba(251,146,60,.3);--ev-t1:#fff6ec;" +
          "--ev-t2:#fdba74;--ev-t3:#fb923c;--ev-on-cta:#231003;--ev-k:#fdba74;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,146,60,.24),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(120,113,108,.26),transparent 60%)," +
          "linear-gradient(150deg,#0c0806,#171009 70%,#120d0a)",
    deco: [
      { i: "i-alert", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-ban", x: 70, y: 24, s: 24, r: -8, lift: 10, d: 90 },
      { i: "i-leaf", x: 24, y: 20, s: 24, r: 18, lift: 13, d: 40 },
      { i: "i-nosignal", x: 47, y: 84, s: 18, r: 8, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "roguelike",
    name: "Roguelike",
    blurb: "a run, then another run",
    icon: "i-dice",
    n: 4,
    note: "IGDB's roguelike / roguelite keywords. Four, not five: these are the games you " +
          "keep rather than the games you finish, and a slate of five never closes.",
    match: (r) => thmAny(thmKw(r), "roguelike", "roguelite", "rogue-like", "rogue-lite"),
    skin: "--ev-disp:'Caveat',var(--display);--ev-size:62px;--ev-dw:700;--ev-ls:0;" +
          "--ev-deco:#facc15;--ev-fg:#fffbe8;--ev-fg-2:#c9bd8e;--ev-edge:rgba(250,204,21,.3);" +
          "--ev-edge-hi:rgba(250,204,21,.7);--ev-glow:rgba(250,204,21,.3);--ev-t1:#fffdf0;" +
          "--ev-t2:#fde047;--ev-t3:#facc15;--ev-on-cta:#231d02;--ev-k:#fde047;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(250,204,21,.22),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(239,68,68,.18),transparent 60%)," +
          "linear-gradient(150deg,#0a0906,#14110a 70%,#100d08)",
    deco: [
      { i: "i-dice", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-refresh", x: 70, y: 22, s: 26, r: 10, lift: 11, d: 80 },
      { i: "i-bolt", x: 24, y: 20, s: 22, r: -10, lift: 13, d: 40 },
      { i: "i-dice", x: 47, y: 84, s: 18, r: 14, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "dystopia",
    name: "Dystopia",
    blurb: "somebody is in charge and it isn't you",
    icon: "i-ban",
    n: 5,
    note: "IGDB's dystopian keyword on its own — the rung Cyberpunk threw out, which is " +
          "exactly right here: Orwell, NORCO, Black the Fall, the Oddworlds, the Syndicates, " +
          "Half-Life 2. A theme that was a false positive somewhere else is not a bad " +
          "predicate, it was a predicate in the wrong place.",
    match: (r) => thmKw(r).includes("dystopian"),
    skin: "--ev-disp:'Saira Stencil One',var(--display);--ev-size:42px;--ev-dw:400;--ev-ls:.02em;" +
          "--ev-deco:#f87171;--ev-fg:#f6eaea;--ev-fg-2:#b9a4a4;--ev-edge:rgba(248,113,113,.3);" +
          "--ev-edge-hi:rgba(248,113,113,.7);--ev-glow:rgba(248,113,113,.28);--ev-t1:#fdf3f3;" +
          "--ev-t2:#fca5a5;--ev-t3:#f87171;--ev-on-cta:#260a0a;--ev-k:#fca5a5;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(248,113,113,.2),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(100,116,139,.24),transparent 60%)," +
          "linear-gradient(150deg,#08090b,#121316 70%,#15100f)",
    deco: [
      { i: "i-ban", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-lock", x: 70, y: 22, s: 26, r: 0, lift: 10, d: 90 },
      { i: "i-server", x: 24, y: 20, s: 22, r: -8, lift: 13, d: 40 },
      { i: "i-user", x: 47, y: 84, s: 18, r: 6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "bad",
    name: "Bad Games",
    plural: "bad games",          // the name is already a plural noun; see thmNoun
    blurb: "the ones the reviews warned you about",
    icon: "i-trash",
    n: 5,
    /* The only theme here that is an OPINION, so it wants more evidence than the keyword
       themes do, and it wants the evidence to agree. Three rungs and a veto:

         Metacritic <= 54          the strongest signal and the widest (8,248 rows carry a
                                   metascore). 54 is the bottom half of Metacritic's "mixed",
                                   not the top of it — this should be unarguable, not a
                                   theme about games that were merely fine.
         IGDB critics <= 55%,      the fallback for games Metacritic never covered. FIVE
           at least 5 of them      critics, not three: at three, a 0.50 average put Ghost
                                   Trick: Phantom Detective — an 83 on Metacritic — in the
                                   pool, which is how you learn a three-critic mean is noise.
         IGDB players <= 55%,      the same idea from the crowd, at 30 votes.
           at least 30 votes

       And the veto: a metascore of 70 or better disqualifies a game no matter what the
       other two say. That is Ghostwire: Tokyo (75, but 0.37 from 39 IGDB players) and
       Project Warlock (74, 0.43 from 32) — a game with a real critical consensus behind it
       is not a bad game because a small crowd on one site disliked it.

       Note every comparison guards for null FIRST. `null <= 54` is TRUE in JavaScript, so
       an unguarded threshold quietly matches every unrated game on the shelf — which, on a
       "bad games" pool, means 14,000 games you own are bad. */
    note: "Metacritic 54 or below; failing that, IGDB's critics under 55% with at least five " +
          "of them, or its players under 55% with at least thirty. A metascore of 70+ vetoes " +
          "all of that — one small crowd's dislike does not outvote a real consensus.",
    match: (r) => {
      const e = thmEn(r);
      if (!e.igdbId) return false;
      const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
      const m = num(e.metascore), c = num(e.criticRating), u = num(e.userRating);
      if (m != null && m >= 70) return false;
      return (m != null && m <= 54)
        || (c != null && c <= .55 && (e.criticCount || 0) >= 5)
        || (u != null && u <= .55 && (e.userRatingCount || 0) >= 30);
    },
    skin: "--ev-size:46px;--ev-dw:800;--ev-ls:-.01em;" +
          "--ev-deco:#fb923c;--ev-fg:#fdf0e6;--ev-fg-2:#c3a894;--ev-edge:rgba(251,146,60,.32);" +
          "--ev-edge-hi:rgba(251,146,60,.75);--ev-glow:rgba(251,146,60,.3);--ev-t1:#fff6ec;" +
          "--ev-t2:#fdba74;--ev-t3:#fb923c;--ev-on-cta:#2a1405;--ev-k:#fdba74;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,146,60,.24),transparent 56%)," +
          "radial-gradient(80% 120% at 6% -16%,rgba(120,53,15,.3),transparent 60%)," +
          "linear-gradient(150deg,#0b0805,#171009 70%,#120c08)",
    deco: [
      { i: "i-trash", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-review", x: 70, y: 22, s: 26, r: -8, lift: 10, d: 90 },
      { i: "i-alert", x: 24, y: 20, s: 22, r: 8, lift: 13, d: 40 },
      { i: "i-trend", x: 47, y: 84, s: 18, r: 14, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "essential",
    name: "Essential",
    blurb: "acclaimed, and you said you'd get to them",
    icon: "i-star",
    n: 3,
    /* The only theme built out of BOTH opinions: the world's and yours. Universal acclaim is
       Metacritic's own term and its own line — 90 and up, not 85, not "well reviewed" — and
       the priority column is the sheet's five-step scale, of which this takes the top two
       (Must Play, Will Play; the rest are Want to Play, Might Play, Will Not Play).

       Metacritic decides whenever it has an opinion, and IGDB's critics stand in only when
       it does not. That ordering matters: a plain union let Fallout: New Vegas (84) and
       Alien: Isolation (79) in through IGDB's softer aggregate, and a theme that means
       "universal acclaim" cannot contain a 79.

       Two scales, not one, and they are not the same scale — the enrichment's `metascore` is
       0-100 and the sheet's own metacriticRating column is 0-1. Reading the second without
       multiplying it silently matches nothing at all, since no row is ever >= 90 of 1.

       Three rather than five: 66 games deep and every one of them is a headliner. A slate of
       five Essentials is not a shortlist, it is a year. */
    note: "Metacritic 90 or better — their line for universal acclaim, not a softer one — on " +
          "a game you marked Must Play or Will Play. IGDB's critics stand in at 90% only for " +
          "games Metacritic never scored, never to overrule a score it did give.",
    match: (r) => {
      const e = thmEn(r);
      if (!e.igdbId) return false;
      const p = String(r.priority || "").trim();
      if (p !== "Must Play" && p !== "Will Play") return false;
      const num = (v) => (v == null || v === "" || isNaN(+v) ? null : +v);
      // metascore is 0-100; the sheet's own column is 0-1. Same number, different scale.
      const sheet = num(r.metacriticRating);
      const m = num(e.metascore) ?? (sheet != null ? sheet * 100 : null);
      if (m != null) return m >= 90;
      const c = num(e.criticRating);
      return c != null && c >= .90 && (e.criticCount || 0) >= 5;
    },
    skin: "--ev-size:58px;--ev-dw:800;--ev-ls:-.025em;" +
          "--ev-deco:#fbbf24;--ev-fg:#fdf6e3;--ev-fg-2:#c8b894;--ev-edge:rgba(251,191,36,.32);" +
          "--ev-edge-hi:rgba(251,191,36,.78);--ev-glow:rgba(251,191,36,.32);--ev-t1:#fffaf0;" +
          "--ev-t2:#fcd34d;--ev-t3:#fbbf24;--ev-on-cta:#291c02;--ev-k:#fcd34d;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,191,36,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(120,113,108,.26),transparent 60%)," +
          "linear-gradient(150deg,#0a0906,#16130c 70%,#111009)",
    deco: [
      { i: "i-star", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-trophy", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-ribbon", x: 24, y: 20, s: 22, r: 8, lift: 13, d: 40 },
      { i: "i-sparkle", x: 47, y: 84, s: 18, r: 0, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "shortgems",
    name: "Short Gems",
    plural: "short gems",        // the name is already a plural noun; see thmNoun
    blurb: "an evening each, and all of them good",
    icon: "i-hourglass",
    n: 5,
    /* The one theme whose pool is about LENGTH, so it borrows both halves rather than
       inventing either. Three hours is U3_MAX — Under Three's own line (ev-underthree.js) —
       and the hours come from playtimeOf (data.js: HLTB main→best, then VNDB, then the
       sheet's estimate). Two definitions of "short" in one app is one too many, and the
       second one to be written is the one that would look wrong.

       Under Three is still a different page, which is why this is not a duplicate of it: it
       counts HOURS cleared over one summer across every short game you own, good or not.
       This is five short games that are also GOOD, all year.

       The line is 85, not 90. Essential already owns 90-and-up, and 80 is not a shortlist of
       gems — it is the short half of the sheet, at 238 in the pool against 86 at 85.

       Unknown length is not short: playtimeOf answers null for a game nothing has timed, and
       `null <= 3` is TRUE in JavaScript, so the guard comes first. (Same null trap the bad
       games pool documents, and pick.js's budget rule for the same reason.)

       THE LADDER GUARD, which is the only interesting rung here. HLTB's main-story number for
       a fighter, a racer or a sports game times one arcade ladder, not the game: SoulCalibur
       is 0.85h, Tekken 3 1.96h, Virtua Fighter 4 0.7h, and at 98, 96 and 94 on Metacritic all
       three would outrank everything else in the pool. They are not short games, they are
       endless games with a short ladder in them, so IGDB's Fighting, Racing and Sport genres
       are out — 36 of them at breadth, 34 in the pool. It costs two honest matches to do it:
       despelote (89, tagged Sport) and Super Catboy (90, tagged Fighting), both of which
       really are an evening. HLTB's allStyles would separate the two cases properly —
       despelote is 2.02 there against a 1.90 main, SoulCalibur 4.08 against 0.85 — but the
       enricher stores that field without putting it in the light record, so it is one line of
       enrich.py away rather than available here.

       And DLC is out, which is five games and the easiest call in the file: a two-hour
       expansion is short because it is an add-on, not because it is a small whole game. */
    note: "Three hours or less — the same line Under Three draws, from the same playtime " +
          "(HLTB, then VNDB, then the sheet) — on a game whose critic score is 85 or better, " +
          "or failing any critic score, IGDB's players at 85% with thirty votes behind them. " +
          "Not DLC, and not fighting, racing or sports games: HLTB's main story for those " +
          "times one arcade ladder, which is why Tekken 3 looks like a two-hour game.",
    match: (r) => {
      // Null first. An unguarded bound makes every untimed game on the shelf a short one.
      const t = playtimeOf(r);
      if (t == null || !(+t > 0) || +t > U3_MAX) return false;
      if (r.dlc) return false;
      if (thmAny(thmIgdb(r, "genres"), "fighting", "racing", "sport")) return false;
      // criticOf is the app's one critic score (Metacritic → the sheet → IGDB → GameRankings),
      // so this lights up the 90s games nothing else scored. Players stand in only when it
      // has no answer at all, and then only behind a crowd worth believing.
      const c = criticOf(r);
      if (c != null) return c >= .85;
      const e = thmEn(r);
      return e.userRating != null && e.userRating >= .85 && (e.userRatingCount || 0) >= 30;
    },
    skin: "--ev-size:54px;--ev-dw:800;--ev-ls:-.02em;" +
          "--ev-deco:#2dd4bf;--ev-fg:#e6fbf7;--ev-fg-2:#93bdb6;--ev-edge:rgba(45,212,191,.32);" +
          "--ev-edge-hi:rgba(45,212,191,.76);--ev-glow:rgba(45,212,191,.3);--ev-t1:#f0fdfa;" +
          "--ev-t2:#a5f3fc;--ev-t3:#2dd4bf;--ev-on-cta:#03201d;--ev-k:#a5f3fc;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(45,212,191,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(165,243,252,.16),transparent 60%)," +
          "linear-gradient(150deg,#040908,#0a1716 70%,#07100f)",
    deco: [
      { i: "i-hourglass", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-sparkle", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-watch", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-star", x: 47, y: 84, s: 17, r: 0, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "soulslike",
    name: "Souls-like",
    blurb: "you will be asked to try again",
    icon: "i-flame",
    n: 3,
    note: "IGDB spells it soulslike, one word — the hyphenated and spaced variants match " +
          "nothing, and soulsborne matches nothing either. Three rather than five, because " +
          "the shortest game in this pool is still forty hours of dying.",
    match: (r) => thmKw(r).includes("soulslike"),
    skin: "--ev-size:44px;--ev-dw:800;--ev-ls:.12em;" +
          "--ev-deco:#d97706;--ev-fg:#f3ece1;--ev-fg-2:#b0a18c;--ev-edge:rgba(217,119,6,.3);" +
          "--ev-edge-hi:rgba(245,158,11,.72);--ev-glow:rgba(217,119,6,.26);--ev-t1:#faf5ec;" +
          "--ev-t2:#f59e0b;--ev-t3:#d97706;--ev-on-cta:#1d1204;--ev-k:#f59e0b;" +
          "--ev-art:radial-gradient(100% 140% at 84% 122%,rgba(217,119,6,.22),transparent 54%)," +
          "radial-gradient(90% 130% at 8% -16%,rgba(68,64,60,.4),transparent 62%)," +
          "linear-gradient(150deg,#080807,#14110d 70%,#0d0c0a)",
    deco: [
      { i: "i-flame", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-hourglass", x: 70, y: 22, s: 26, r: 4, lift: 10, d: 90 },
      { i: "i-heart", x: 24, y: 20, s: 22, r: -8, lift: 13, d: 40 },
      { i: "i-flame", x: 47, y: 84, s: 17, r: 10, lift: 8, d: 200, o: .45 },
    ],
  },
  {
    id: "lovecraft",
    name: "Lovecraft",
    plural: "Lovecraftian games",
    blurb: "something old, and it has noticed you",
    icon: "i-spider",
    n: 5,
    /* One keyword again, for the Cyberpunk reason. `cosmic horror` looked like a free
       widening and added four: Loop//Error, The Chant, Wildermyth and Aliens: Colonial
       Marines. Two of those are simply not Lovecraft, and a theme that contains Colonial
       Marines is a theme about tentacles in the abstract. `cthulhu mythos`, `lovecraft` and
       `eldritch` are not keywords IGDB uses at all — each matched zero. */
    note: "IGDB's lovecraftian keyword, alone. cosmic horror was tried and dropped: it added " +
          "four games, two of which were Wildermyth and Aliens: Colonial Marines.",
    match: (r) => thmKw(r).includes("lovecraftian"),
    skin: "--ev-disp:'Creepster',var(--display);--ev-size:52px;--ev-dw:400;--ev-ls:.03em;" +
          "--ev-deco:#4ade80;--ev-fg:#e7f5ea;--ev-fg-2:#93ad9b;--ev-edge:rgba(74,222,128,.26);" +
          "--ev-edge-hi:rgba(74,222,128,.66);--ev-glow:rgba(74,222,128,.26);--ev-t1:#f0fbf3;" +
          "--ev-t2:#86efac;--ev-t3:#4ade80;--ev-on-cta:#04180c;--ev-k:#86efac;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(74,222,128,.2),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(13,74,58,.42),transparent 60%)," +
          "linear-gradient(150deg,#050807,#0a1310 70%,#07100d)",
    deco: [
      { i: "i-spider", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-moon", x: 70, y: 22, s: 26, r: 0, lift: 10, d: 90 },
      { i: "i-book", x: 24, y: 20, s: 22, r: -10, lift: 13, d: 40 },
      { i: "i-bat", x: 47, y: 84, s: 18, r: 12, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "funny",
    name: "Funny Games",
    plural: "funny games",
    blurb: "written to make you laugh, not to make you tense",
    icon: "i-sparkle",
    n: 5,
    /* The keywords, NOT IGDB's comedy theme — and the difference is 644 games. The theme
       means "has jokes in it", which is true of New Super Mario Bros. U, Super Meat Boy and
       Ratchet & Clank, and none of those is what you want when you want something funny. The
       humour keywords mean the comedy is the point: Baldi's Basics, Blippo+, despelote,
       Pizza Possum, Thirsty Suitors, Shadows Over Loathing.

       Requiring BOTH was tried (84 games) and is worse, not better — it drops Baldi's
       Basics, despelote and Thirsty Suitors for the crime of not also carrying a theme tag.
       One good signal beats two signals ANDed together when the second one is noise. */
    note: "IGDB's humour keywords — humor, comedy, parody, satire, slapstick. Deliberately " +
          "not its comedy THEME, which is 759 games on this shelf and includes Super Meat Boy: " +
          "that tag means a game has jokes in it, not that a game is a comedy.",
    match: (r) => thmAny(thmKw(r), "humor", "humour", "comedy", "parody", "satire", "funny", "slapstick"),
    skin: "--ev-disp:'Pacifico',var(--display);--ev-size:46px;--ev-dw:400;--ev-ls:0;" +
          "--ev-deco:#fb7185;--ev-fg:#fdeef2;--ev-fg-2:#c69fae;--ev-edge:rgba(251,113,133,.32);" +
          "--ev-edge-hi:rgba(251,113,133,.78);--ev-glow:rgba(251,113,133,.34);--ev-t1:#fff5f7;" +
          "--ev-t2:#fde047;--ev-t3:#fb7185;--ev-on-cta:#2a0710;--ev-k:#fda4af;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,113,133,.26),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(253,224,71,.18),transparent 60%)," +
          "linear-gradient(150deg,#0b0609,#180b14 70%,#120a10)",
    deco: [
      { i: "i-sparkle", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-mug", x: 70, y: 22, s: 26, r: 8, lift: 10, d: 90 },
      { i: "i-pennant", x: 24, y: 20, s: 22, r: -12, lift: 13, d: 40 },
      { i: "i-heart", x: 47, y: 84, s: 18, r: 10, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "bullethell",
    name: "Bullet Hell",
    blurb: "the screen is mostly projectile",
    icon: "i-target",
    n: 5,
    /* Strictly the `bullet hell` keyword. `shmup` would add 23 and they are good games —
       Gradius Origins, Truxton Extreme, CYGNI — but a shmup is not a bullet hell, it is the
       family bullet hell belongs to, and a theme named for the narrow thing should hold the
       narrow thing. `scrolling shooter` and `vertical scrolling` add five each and bring
       Metal Slug Anthology, which is a run-and-gun. `danmaku` matches nothing at all. */
    note: "IGDB's bullet hell keyword, alone. shmup would add 23 more (Gradius, Truxton, " +
          "CYGNI) but a shmup is the family, not the thing — say the word and they can join.",
    match: (r) => thmKw(r).includes("bullet hell"),
    skin: "--ev-size:44px;--ev-dw:800;--ev-ls:.04em;" +
          "--ev-deco:#e879f9;--ev-fg:#fbeafe;--ev-fg-2:#bb9ac4;--ev-edge:rgba(232,121,249,.32);" +
          "--ev-edge-hi:rgba(232,121,249,.8);--ev-glow:rgba(232,121,249,.4);--ev-t1:#fdf2ff;" +
          "--ev-t2:#f0abfc;--ev-t3:#e879f9;--ev-on-cta:#230429;--ev-k:#f0abfc;" +
          "--ev-art:radial-gradient(70% 90% at 50% 112%,rgba(232,121,249,.34),transparent 54%)," +
          "radial-gradient(90% 130% at 10% -18%,rgba(129,140,248,.2),transparent 60%)," +
          "linear-gradient(150deg,#06040a,#120618 70%,#0a0612)",
    deco: [
      { i: "i-target", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-sparkle", x: 70, y: 20, s: 22, r: 0, lift: 11, d: 70 },
      { i: "i-bolt", x: 24, y: 22, s: 20, r: -10, lift: 13, d: 40 },
      { i: "i-target", x: 47, y: 84, s: 16, r: 0, lift: 8, d: 200, o: .45 },
    ],
  },
  {
    id: "boomer",
    name: "Boomer Shooter",
    plural: "boomer shooters",
    blurb: "no reloading, no regenerating, no cover",
    icon: "i-disc",
    n: 5,
    /* Two rungs, because the keyword alone is fifteen games — a pool you would exhaust in
       three runs. The second rung is the one place a theme here reads `engines`, and it is
       the right field for exactly this genre: a game shipping on GZDoom, id Tech 1-3, Build
       or Quake in 2024 is making a deliberate statement about what it is. It also catches
       the originals that the term was coined about — Return to Castle Wolfenstein, Medal of
       Honor: Allied Assault, the Jedi Knights, the first Call of Duty.

       The engine rung is ANDed with the shooter genre, which costs three games and is worth
       it: id Tech 2 also ran Anachronox, an RPG. Modern id Tech (4 through 8 — Doom Eternal,
       Indiana Jones) is deliberately not in the pattern; those are the engine's descendants,
       not the style's. */
    note: "IGDB's boomer shooter keyword, plus any shooter built on GZDoom, id Tech 1-3, " +
          "Build or Quake — the engines are the tell. id Tech 4 and up are excluded on " +
          "purpose: Doom Eternal is the engine's descendant, not the style's.",
    match: (r) => {
      if (thmKw(r).includes("boomer shooter")) return true;
      const retro = /^(gzdoom|zdoom|doom engine|id tech [123]|build|quake|darkplaces|eduke32|raze)/;
      return thmIgdb(r, "engines").some((x) => retro.test(x))
        && thmIgdb(r, "genres").includes("shooter");
    },
    skin: "--ev-size:40px;--ev-dw:800;--ev-ls:.14em;" +
          "--ev-deco:#dc2626;--ev-fg:#f4e9e4;--ev-fg-2:#b09288;--ev-edge:rgba(220,38,38,.34);" +
          "--ev-edge-hi:rgba(239,68,68,.76);--ev-glow:rgba(220,38,38,.3);--ev-t1:#fbf0ea;" +
          "--ev-t2:#84cc16;--ev-t3:#dc2626;--ev-on-cta:#1f0605;--ev-k:#84cc16;" +
          "--ev-art:radial-gradient(100% 140% at 84% 122%,rgba(220,38,38,.26),transparent 54%)," +
          "radial-gradient(90% 130% at 8% -16%,rgba(132,204,22,.14),transparent 60%)," +
          "linear-gradient(150deg,#070605,#140b09 70%,#0d0908)",
    deco: [
      { i: "i-disc", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-crt", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-target", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-bolt", x: 47, y: 84, s: 18, r: -8, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "highscore",
    name: "High Score",
    plural: "high-score games",
    blurb: "it ends when you lose, not when you win",
    icon: "i-coin",
    n: 5,
    note: "IGDB's high score keyword — games built around a number going up rather than a " +
          "story running out. There is nothing to finish here, which makes the slate's own " +
          "idea of finished a bit funny: the sheet decides, same as everywhere else.",
    match: (r) => thmKw(r).includes("high score"),
    // Shares Press Start 2P with Before 2006 on purpose — a scoreboard face is a scoreboard
    // face, and the two posters are never on screen together. Different palette does the work.
    skin: "--ev-disp:'Press Start 2P',var(--display);--ev-size:22px;--ev-dw:400;--ev-ls:0;" +
          "--ev-deco:#38bdf8;--ev-fg:#e8f6ff;--ev-fg-2:#93b2c6;--ev-edge:rgba(56,189,248,.32);" +
          "--ev-edge-hi:rgba(56,189,248,.78);--ev-glow:rgba(56,189,248,.34);--ev-t1:#f2fbff;" +
          "--ev-t2:#fde047;--ev-t3:#38bdf8;--ev-on-cta:#041622;--ev-k:#fde047;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(56,189,248,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(253,224,71,.16),transparent 60%)," +
          "linear-gradient(150deg,#04070b,#0a1119 70%,#060d14)",
    deco: [
      { i: "i-coin", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-trophy", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-stats", x: 24, y: 20, s: 22, r: 8, lift: 13, d: 40 },
      { i: "i-coin", x: 47, y: 84, s: 17, r: 12, lift: 8, d: 200, o: .45 },
    ],
  },
  {
    id: "licensed",
    name: "Licensed",
    plural: "licensed games",
    blurb: "somebody else's characters, under contract",
    icon: "i-tag",
    n: 5,
    /* IGDB has 24 keywords starting "based on", and the line between them matters. IN: the
       adaptations — movie, anime, comics, TV show, book, manga, cartoons, toy, brand, board
       and card game, tabletop RPG. OUT, deliberately:
         public domain work   the opposite of licensed. Nobody signed anything for Dracula.
         true story / real people   history is not a rights holder.
         licensed soundtrack / licensed cars / licensed music   an asset inside the game, not
                              the game being an adaptation of something. GT's cars are
                              licensed; Gran Turismo is not a licensed game.
         unlicensed game      literally the inverse, and it would be a fine theme of its own. */
    note: "IGDB's licensed game keyword plus its \"based on\" family — movie, anime, comics, " +
          "TV, book, manga, toy, brand, tabletop. Not public-domain works (nobody signed " +
          "anything for Dracula) and not licensed soundtracks, which are an asset, not an " +
          "adaptation.",
    match: (r) => thmKw(r).some((k) => k === "licensed game"
      || /^based on - (movie|anime|comics|tv show|book|manga|cartoons|toy|brand|board game|card game|tabletop rpg|web show)/.test(k)),
    skin: "--ev-size:50px;--ev-dw:800;--ev-ls:-.02em;" +
          "--ev-deco:#60a5fa;--ev-fg:#eaf1fd;--ev-fg-2:#9fb0c9;--ev-edge:rgba(96,165,250,.3);" +
          "--ev-edge-hi:rgba(96,165,250,.74);--ev-glow:rgba(96,165,250,.3);--ev-t1:#f3f8ff;" +
          "--ev-t2:#93c5fd;--ev-t3:#60a5fa;--ev-on-cta:#06152b;--ev-k:#93c5fd;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(96,165,250,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(148,163,184,.2),transparent 60%)," +
          "linear-gradient(150deg,#05070b,#0c1220 70%,#080d16)",
    deco: [
      { i: "i-tag", x: 86, y: 66, s: 44, lift: 11 },
      { i: "i-receipt", x: 70, y: 22, s: 26, r: -8, lift: 10, d: 90 },
      { i: "i-review", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-star", x: 47, y: 84, s: 18, r: 0, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "typing",
    name: "Typing",
    plural: "typing games",
    blurb: "the keyboard is the controller",
    icon: "i-command",
    n: 3,
    /* A BROAD TITLE MATCH, and it is worth saying why rather than
       hiding it. The Spooktober rule exists because a noun in a title is usually a coincidence
       — "space" catches Samorost, "dead" catches Dead Cells. The word "typing" is not like
       that. It was run against all 14,916 rows and caught eleven games: Typing Farmer, Keys of
       Fury, Glyphica, Needy Streamer Overload: Typing of the Net, Nanotale, Epistory, The
       Typing of the Dead, Learn with Pokémon, both Mario Teaches Typings, Isekat. Eleven out
       of eleven are typing games. A rule with no false positives on the whole collection is
       not the rule the Spooktober rule was written against.

       It still is not enough on its own, because the best ones in the genre do not say it:
       The Textorcist, Cryptmaster, Type:Rider and Icarus Proudbottom are a hand-list, which
       is honest as long as it is visible. IGDB's `typing` keyword is the third rung and the
       only one that generalises — it is also how Buddy Simulator 1984 and Boltgun's Words of
       Vengeance DLC get in, both correctly.

       Three to a slate: there are twenty of these in the entire collection. */
    note: "Three rungs, and one of them breaks this file's own rule: IGDB's typing keyword, " +
          "a hand-list of four that never say it (Textorcist, Cryptmaster, Type:Rider, Icarus " +
          "Proudbottom), and \"typing\" in the title — which across 14,916 rows catches eleven " +
          "games and all eleven are typing games.",
    match: (r) => {
      const k = thmKw(r);
      if (k.includes("typing") || k.includes("keyboard game")) return true;
      const title = String(r.title || "");
      return /\btyping\b|\btyper\b/i.test(title)
        || /^(the textorcist|cryptmaster|type:rider|icarus proudbottom)/i.test(title);
    },
    // A system monospace stack: no webfont to download, and nothing else says KEYBOARD faster.
    skin: "--ev-disp:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
          "--ev-size:40px;--ev-dw:700;--ev-ls:-.02em;" +
          "--ev-deco:#34d399;--ev-fg:#e6f6ef;--ev-fg-2:#92b3a6;--ev-edge:rgba(52,211,153,.3);" +
          "--ev-edge-hi:rgba(52,211,153,.72);--ev-glow:rgba(52,211,153,.28);--ev-t1:#f0fcf7;" +
          "--ev-t2:#6ee7b7;--ev-t3:#34d399;--ev-on-cta:#042015;--ev-k:#6ee7b7;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(52,211,153,.2),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(30,41,59,.5),transparent 60%)," +
          "linear-gradient(150deg,#050807,#0b1512 70%,#070f0c)",
    deco: [
      { i: "i-command", x: 86, y: 66, s: 42, lift: 12 },
      { i: "i-pad", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-book", x: 24, y: 20, s: 22, r: 8, lift: 13, d: 40 },
      { i: "i-bolt", x: 47, y: 84, s: 17, r: 10, lift: 8, d: 200, o: .45 },
    ],
  },
  {
    id: "ports",
    name: "Ports",
    plural: "ports and alternate versions",
    blurb: "another version of something you already beat",
    icon: "i-combine",
    n: 5,
    /* This is the inverse of the guard that keeps Groups from recommending the same game
       twice. relations.js joins IGDB's ports, remasters, remakes and expanded editions into
       version families — including links through editions that are not on the sheet — and
       alreadyPlayed names the finished row in that family. That makes the rule symmetric:
       beat a remake and the original enters the pool; beat the original and its remake does.

       Bundle claims are deliberately out. alreadyPlayed also knows that finishing a
       compilation can mean finishing a game inside it, but that is not another version of
       the game and would turn this into a broader replay theme. */
    note: "An unfinished port, remaster, remake, expanded edition or original whose version " +
          "family contains a game you already finished. The link can run either way — beat " +
          "the remake and the original counts too. Games only played inside a compilation " +
          "are excluded: that is a bundle, not another version.",
    match: (r) => {
      const played = typeof alreadyPlayed === "function" ? alreadyPlayed(r) : null;
      return !!played && played.how === "version";
    },
    skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:56px;--ev-dw:800;--ev-ls:.04em;" +
          "--ev-deco:#22d3ee;--ev-fg:#e8faff;--ev-fg-2:#96bac3;--ev-edge:rgba(34,211,238,.32);" +
          "--ev-edge-hi:rgba(34,211,238,.78);--ev-glow:rgba(34,211,238,.34);--ev-t1:#f0fcff;" +
          "--ev-t2:#fbbf24;--ev-t3:#22d3ee;--ev-on-cta:#042128;--ev-k:#fbbf24;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(34,211,238,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(251,191,36,.18),transparent 60%)," +
          "linear-gradient(150deg,#04090b,#08171b 70%,#0b1015)",
    deco: [
      { i: "i-combine", x: 86, y: 66, s: 44, lift: 12 },
      { i: "i-layers", x: 70, y: 22, s: 26, r: -6, lift: 10, d: 90 },
      { i: "i-refresh", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-disc", x: 47, y: 84, s: 18, r: -8, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "family",
    name: "Family Game Night",
    plural: "family co-play games",
    blurb: "same room, two players, rated for younger kids",
    icon: "i-heart",
    n: 5,
    note: "An official youngest-audience rating (ESRB EC/E, PEGI 3/7, CERO A, USK 0/6, " +
          "GRAC ALL, ClassInd L or ACB G) AND same-room play: Co-Optimus reports two or " +
          "more local players, or IGDB explicitly says split screen. Unrated games, E10+, " +
          "online-only co-op and generic multiplayer are excluded.",
    match: thmFamilyPlay,
    skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:50px;--ev-dw:800;--ev-ls:.02em;" +
          "--ev-deco:#fbbf24;--ev-fg:#fff7df;--ev-fg-2:#d8c9ad;--ev-edge:rgba(251,191,36,.34);" +
          "--ev-edge-hi:rgba(251,191,36,.78);--ev-glow:rgba(251,191,36,.35);--ev-t1:#fffaf0;" +
          "--ev-t2:#60a5fa;--ev-t3:#fb7185;--ev-on-cta:#211304;--ev-k:#fbbf24;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(96,165,250,.3),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(251,113,133,.25),transparent 60%)," +
          "linear-gradient(150deg,#0b0b16,#15142a 70%,#111c30)",
    deco: [
      { i: "i-pad", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-heart", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-star", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-dice", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
      { i: "i-heart", x: 58, y: 12, s: 15, r: 8, lift: 15, d: 250, o: .5 },
    ],
  },
  {
    id: "wholesome",
    name: "Wholesome Games",
    plural: "wholesome games",
    blurb: "small adventures, kind hearts, your own pace",
    icon: "i-leaf",
    n: 5,
    note: "IGDB's wholesome, cozy, cosy or cozy adventure keywords, plus an exact-title " +
          "list for gaps in those tags: A Short Hike, Lil Gator Game, TOEM, TOEM 2, " +
          "Alba: A Wildlife Adventure, Little Kitty, Big City, Chicory: A Colorful Tale " +
          "and Sable. IGDB horror themes and keywords are excluded; cute, casual or " +
          "family-friendly tags alone do not qualify.",
    match: thmWholesome,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#86efac;--ev-fg:#f0fdf4;--ev-fg-2:#b0cdb9;--ev-edge:rgba(134,239,172,.32);" +
          "--ev-edge-hi:rgba(134,239,172,.78);--ev-glow:rgba(134,239,172,.3);--ev-t1:#f0fdf4;" +
          "--ev-t2:#fde68a;--ev-t3:#86efac;--ev-on-cta:#102517;--ev-k:#fde68a;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(134,239,172,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(253,230,138,.18),transparent 60%)," +
          "linear-gradient(150deg,#09120c,#14281c 70%,#182115)",
    deco: [
      { i: "i-leaf", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-sun", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-heart", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-tree", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "zeldalikes",
    name: "Zelda-likes",
    plural: "Zelda-likes",
    blurb: "curious paths, clever puzzles, one more dungeon",
    icon: "i-door",
    n: 5,
    note: "IGDB's Zelda-like keywords, plus exact-title gaps: TUNIC, Death's Door, Hob, " +
          "Ittle Dew, Ittle Dew 2/2+, Blossom Tales 2, Oceanhorn: Monster of Uncharted Seas, " +
          "Oceanhorn 2, The Swords of Ditto (including Mormo's Curse) and Okami/Okami HD. " +
          "Generic adventure, dungeon-crawler and Zelda-reference tags do not qualify; " +
          "franchise membership alone does not include Zelda games or their spin-offs.",
    match: thmZeldalike,
    skin: "--ev-disp:Georgia,serif;--ev-size:48px;--ev-dw:700;--ev-ls:.02em;" +
          "--ev-deco:#fcd34d;--ev-fg:#fff9e6;--ev-fg-2:#c9c4a4;--ev-edge:rgba(252,211,77,.34);" +
          "--ev-edge-hi:rgba(252,211,77,.8);--ev-glow:rgba(252,211,77,.32);--ev-t1:#fff9e6;" +
          "--ev-t2:#6ee7b7;--ev-t3:#fcd34d;--ev-on-cta:#18210a;--ev-k:#fcd34d;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(252,211,77,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(110,231,183,.2),transparent 60%)," +
          "linear-gradient(150deg,#080f0c,#10251c 70%,#1c210d)",
    deco: [
      { i: "i-door", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-globe", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-sparkle", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-coin", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "immersivesims",
    name: "Immersive Sims",
    plural: "immersive sims",
    blurb: "one problem, a dozen ways through",
    icon: "i-bracket",
    n: 5,
    note: "Immersive sims and close systemic relatives: classics such as Deus Ex, Thief, " +
          "System Shock and Prey (2017), newer games such as Deathloop and Blood West, " +
          "and flexible sandboxes such as Streets of Rogue and selected Hitman games. " +
          "Also includes BioShock, Dark Messiah and Vampire: The Masquerade – Bloodlines. " +
          "An editorial selection of exact titles and editions; broad immersive/simulation " +
          "tags alone do not qualify. The unrelated Prey (2006) is excluded.",
    match: thmImmersive,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#67e8f9;--ev-fg:#ecfeff;--ev-fg-2:#a6c6cc;--ev-edge:rgba(103,232,249,.32);" +
          "--ev-edge-hi:rgba(103,232,249,.78);--ev-glow:rgba(103,232,249,.3);--ev-t1:#ecfeff;" +
          "--ev-t2:#a5b4fc;--ev-t3:#67e8f9;--ev-on-cta:#08212a;--ev-k:#a5b4fc;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(103,232,249,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(165,180,252,.2),transparent 60%)," +
          "linear-gradient(150deg,#080f16,#10252b 70%,#14172b)",
    deco: [
      { i: "i-bracket", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-door", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-bolt", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-layers", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "weirdlittle",
    name: "Weird Little Games",
    plural: "weird little games",
    blurb: "a strange idea, taken delightfully far",
    icon: "i-dice",
    n: 5,
    note: "An editorial selection of playful oddities, surreal worlds and experimental " +
          "games: Katamari, Chulip, Hylics, Samorost, Hypnospace Outlaw, Sludge Life, " +
          "The Stanley Parable, Frog Detective and many more. Spans absurd comedy, " +
          "strange simulations and unsettling handmade adventures. Exact selected titles " +
          "and editions only; surreal, indie or comedy tags alone do not qualify. " +
          "Little describes the spirit, not a playtime limit.",
    match: thmWeird,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:-.02em;" +
          "--ev-deco:#f0abfc;--ev-fg:#fdf4ff;--ev-fg-2:#cbb4d1;--ev-edge:rgba(240,171,252,.32);" +
          "--ev-edge-hi:rgba(240,171,252,.78);--ev-glow:rgba(240,171,252,.3);--ev-t1:#fdf4ff;" +
          "--ev-t2:#bef264;--ev-t3:#f0abfc;--ev-on-cta:#27102d;--ev-k:#f0abfc;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(240,171,252,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(190,242,100,.18),transparent 60%)," +
          "linear-gradient(150deg,#140b18,#29162d 70%,#182414)",
    deco: [
      { i: "i-dice", x: 86, y: 66, s: 46, r: 15, lift: 12 },
      { i: "i-sparkle", x: 70, y: 22, s: 27, r: -12, lift: 11, d: 90 },
      { i: "i-globe", x: 24, y: 20, s: 23, r: 22, lift: 13, d: 40 },
      { i: "i-star", x: 47, y: 84, s: 19, r: -18, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "detective",
    name: "Detective Games",
    plural: "detective games",
    blurb: "follow the clues, question the obvious",
    icon: "i-search",
    n: 5,
    note: "IGDB detective/private-detective keywords, backed by either point-and-click " +
          "gameplay or both investigation keywords and puzzle/visual-novel gameplay. Explicit detective " +
          "investigation or deductive reasoning also qualifies. These tag matches exclude " +
          "shooters, fighting, hack-and-slash, platform and music games. A curated list fills " +
          "gaps for Obra Dinn, Golden Idol, Ace Attorney, Frog Detective, Paradise Killer, " +
          "The Forgotten City, Her Story, Disco Elysium and other investigation-led games. " +
          "Mystery settings and detective characters alone are not enough.",
    match: thmDetective,
    skin: "--ev-disp:Georgia,serif;--ev-size:46px;--ev-dw:700;--ev-ls:.01em;" +
          "--ev-deco:#fdba74;--ev-fg:#fff7ed;--ev-fg-2:#cbbba6;--ev-edge:rgba(253,186,116,.32);" +
          "--ev-edge-hi:rgba(253,186,116,.78);--ev-glow:rgba(253,186,116,.3);--ev-t1:#fff7ed;" +
          "--ev-t2:#fde68a;--ev-t3:#fdba74;--ev-on-cta:#281a0c;--ev-k:#fdba74;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(253,186,116,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(253,230,138,.14),transparent 60%)," +
          "linear-gradient(150deg,#100e0b,#282018 70%,#171b20)",
    deco: [
      { i: "i-search", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-book", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-watch", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-pin", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "knowledge",
    name: "Knowledge Is Progress",
    plural: "knowledge-driven games",
    blurb: "the breakthrough is understanding",
    icon: "i-book",
    n: 5,
    note: "Games about learning hidden rules, reading a world or language, and putting clues " +
          "together: Outer Wilds, Tunic, The Witness, Animal Well, Chants of Sennaar and more. " +
          "Includes observation-led adventures and deduction puzzles alongside pure knowledge " +
          "gates. Matches selected titles or explicit knowledge-progression tags; a generic " +
          "puzzle or exploration tag is not enough.",
    match: thmKnowledge,
    skin: "--ev-disp:Georgia,serif;--ev-size:42px;--ev-dw:700;--ev-ls:.01em;" +
          "--ev-deco:#fcd34d;--ev-fg:#fff9e6;--ev-fg-2:#c9c4a4;--ev-edge:rgba(252,211,77,.34);" +
          "--ev-edge-hi:rgba(252,211,77,.8);--ev-glow:rgba(252,211,77,.32);--ev-t1:#fff9e6;" +
          "--ev-t2:#5eead4;--ev-t3:#fcd34d;--ev-on-cta:#18210a;--ev-k:#fcd34d;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(252,211,77,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(94,234,212,.2),transparent 60%)," +
          "linear-gradient(150deg,#080f0c,#10251c 70%,#1c210d)",
    deco: [
      { i: "i-book", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-search", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-sparkle", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-door", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "timetrouble",
    name: "Time Trouble",
    plural: "time-bending games",
    blurb: "rewind, repeat, change what happens next",
    icon: "i-clock",
    n: 5,
    note: "Time loops, rewinds, and timelines that drive the game: Deathloop, Minit, Braid, " +
          "Superhot, Ghost Trick, Radiant Historia and more. Matches selected time-driven " +
          "adventures or an explicit IGDB time-loop tag. Generic time-travel and time-manipulation " +
          "tags alone do not qualify, nor does an ordinary racing rewind or puzzle undo.",
    match: thmTime,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#67e8f9;--ev-fg:#ecfeff;--ev-fg-2:#a6c6cc;--ev-edge:rgba(103,232,249,.32);" +
          "--ev-edge-hi:rgba(103,232,249,.78);--ev-glow:rgba(103,232,249,.3);--ev-t1:#ecfeff;" +
          "--ev-t2:#f9a8d4;--ev-t3:#67e8f9;--ev-on-cta:#08212a;--ev-k:#f9a8d4;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(103,232,249,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(249,168,212,.2),transparent 60%)," +
          "linear-gradient(150deg,#080f16,#10252b 70%,#29102a)",
    deco: [
      { i: "i-clock", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-refresh", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-skip-back", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-timeline", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "lostinspace",
    name: "Lost in Space",
    plural: "space-isolation games",
    blurb: "far from home, beyond the familiar",
    icon: "i-moon",
    n: 5,
    note: "A curated selection of unfamiliar planets, isolated crews and abandoned stations: " +
          "Alien: Isolation, Dead Space, Prey, The Swapper, Metroid, Subnautica and more. " +
          "Includes lonely exploration as well as survival and horror. Matches exact selected " +
          "titles and editions; a science-fiction setting, spaceship or space-combat tag alone " +
          "does not qualify.",
    match: (r) => thmKnownTitle(r, THM_SPACE_TITLES),
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:.02em;" +
          "--ev-deco:#a5b4fc;--ev-fg:#eef2ff;--ev-fg-2:#b0b9d3;--ev-edge:rgba(165,180,252,.32);" +
          "--ev-edge-hi:rgba(165,180,252,.78);--ev-glow:rgba(165,180,252,.3);--ev-t1:#eef2ff;" +
          "--ev-t2:#7dd3fc;--ev-t3:#a5b4fc;--ev-on-cta:#10132a;--ev-k:#7dd3fc;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(165,180,252,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(125,211,252,.14),transparent 60%)," +
          "linear-gradient(150deg,#040712,#10152c 70%,#18112c)",
    deco: [
      { i: "i-moon", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-globe", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-star", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-sparkle", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "machines",
    name: "Beautiful Machines",
    plural: "machine-building games",
    blurb: "build it, tune it, watch it work",
    icon: "i-bracket",
    n: 5,
    note: "Factories, contraptions, circuits and programs you build and refine: Factorio, " +
          "Satisfactory, Opus Magnum, Infinifactory, SpaceChem, Besiege and more. Matches " +
          "selected titles or explicit factory-automation, automation-puzzle, programming-puzzle " +
          "or engineering-puzzle tags. Generic crafting, factory settings and automation tags " +
          "alone do not qualify.",
    match: thmMachines,
    skin: "--ev-disp:var(--display);--ev-size:44px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#fdba74;--ev-fg:#fff4e8;--ev-fg-2:#d3bba2;--ev-edge:rgba(253,186,116,.34);" +
          "--ev-edge-hi:rgba(253,186,116,.8);--ev-glow:rgba(253,186,116,.32);--ev-t1:#fff4e8;" +
          "--ev-t2:#a3e635;--ev-t3:#fdba74;--ev-on-cta:#241606;--ev-k:#a3e635;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(253,186,116,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(163,230,53,.18),transparent 60%)," +
          "linear-gradient(150deg,#100d07,#271d10 70%,#14200b)",
    deco: [
      { i: "i-bracket", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-layers", x: 70, y: 22, s: 27, r: -7, lift: 11, d: 90 },
      { i: "i-bolt", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-refresh", x: 47, y: 84, s: 19, r: -8, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "rhythmflow",
    name: "Rhythm & Flow",
    plural: "rhythm and flow games",
    blurb: "find the beat, let movement become music",
    icon: "i-music",
    n: 5,
    note: "Rhythm games and musical movement: Rez, Thumper, Hi-Fi Rush, Sayonara Wild Hearts " +
          "and more. Uses the sheet's Rhythm genre, IGDB Music games with explicit rhythm tags, " +
          "and selected music-driven games such as Ape Out and Tetris Effect. A good soundtrack, " +
          "a music tag or an incidental rhythm minigame alone does not qualify; known " +
          "miscategorizations are excluded.",
    match: thmRhythm,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:-.02em;" +
          "--ev-deco:#f0abfc;--ev-fg:#fdf4ff;--ev-fg-2:#cbb4d1;--ev-edge:rgba(240,171,252,.32);" +
          "--ev-edge-hi:rgba(240,171,252,.78);--ev-glow:rgba(240,171,252,.3);--ev-t1:#fdf4ff;" +
          "--ev-t2:#fdba74;--ev-t3:#f0abfc;--ev-on-cta:#27102d;--ev-k:#fdba74;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(240,171,252,.24),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(253,186,116,.18),transparent 60%)," +
          "linear-gradient(150deg,#140b18,#29162d 70%,#28140a)",
    deco: [
      { i: "i-music", x: 86, y: 66, s: 46, r: 15, lift: 12 },
      { i: "i-volume", x: 70, y: 22, s: 27, r: -12, lift: 11, d: 90 },
      { i: "i-disc", x: 24, y: 20, s: 23, r: 22, lift: 13, d: 40 },
      { i: "i-bolt", x: 47, y: 84, s: 19, r: -18, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "onehanded",
    name: "One-Handed",
    plural: "one-handed games",
    blurb: "the phone in one hand, one thumb on the glass",
    icon: "i-phone",
    n: 5,
    note: "Games this phone can actually run — native iOS, a Browser game, a system Delta " +
          "emulates, or a RomM folder EmulatorJS plays in Safari (its streaming-only folders, " +
          "PC, Switch and the modern consoles are out) — crossed with input one thumb can " +
          "reach: the sheet's untimed genres (turn-based and tactics RPGs, visual novels, card " +
          "and board games, text adventures, point-and-click, hidden object), IGDB's equivalents " +
          "with no real-time genre beside them, runners, match-3 and idlers, and selected " +
          "stylus, touch-native and portrait titles. Anything needing two inputs at once or an " +
          "input on cue stays out, including audited timed-turn-based combat.",
    match: thmOneHanded,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:-.01em;" +
          "--ev-deco:#5eead4;--ev-fg:#ecfffb;--ev-fg-2:#a7c4bf;--ev-edge:rgba(94,234,212,.32);" +
          "--ev-edge-hi:rgba(94,234,212,.78);--ev-glow:rgba(94,234,212,.3);--ev-t1:#ecfffb;" +
          "--ev-t2:#c4b5fd;--ev-t3:#5eead4;--ev-on-cta:#042420;--ev-k:#c4b5fd;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(94,234,212,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(196,181,253,.18),transparent 60%)," +
          "linear-gradient(150deg,#05100e,#0c2420 70%,#161231)",
    deco: [
      { i: "i-phone", x: 86, y: 66, s: 46, r: -4, lift: 12 },
      { i: "i-target", x: 70, y: 22, s: 25, r: 8, lift: 11, d: 90 },
      { i: "i-cartridge", x: 24, y: 20, s: 23, r: -10, lift: 13, d: 40 },
      { i: "i-web", x: 47, y: 84, s: 19, r: 6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "stealth",
    name: "Unseen",
    plural: "stealth games",
    blurb: "nobody saw a thing",
    icon: "i-eye",
    n: 5,
    note: "The sheet's Stealth Action genre — Metal Gear, Splinter Cell, Hitman, Thief, Tenchu " +
          "— plus tactics games IGDB files under stealth (Commandos, Shadow Tactics) and selected " +
          "sneaking games filed elsewhere, like Mark of the Ninja, Invisible, Inc. and Gunpoint. " +
          "IGDB's stealth theme alone does not qualify: it marks any game with a sneaking level.",
    match: thmStealth,
    skin: "--ev-disp:var(--display);--ev-size:46px;--ev-dw:800;--ev-ls:.04em;" +
          "--ev-deco:#cbd5e1;--ev-fg:#f1f5f9;--ev-fg-2:#a0abb9;--ev-edge:rgba(203,213,225,.32);" +
          "--ev-edge-hi:rgba(203,213,225,.78);--ev-glow:rgba(203,213,225,.3);--ev-t1:#f1f5f9;" +
          "--ev-t2:#86efac;--ev-t3:#cbd5e1;--ev-on-cta:#0b1220;--ev-k:#86efac;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(203,213,225,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(134,239,172,.18),transparent 60%)," +
          "linear-gradient(150deg,#03060a,#0b1322 70%,#08140f)",
    deco: [
      { i: "i-eye", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-moon", x: 70, y: 22, s: 26, r: -8, lift: 11, d: 90 },
      { i: "i-lock", x: 24, y: 20, s: 22, r: 10, lift: 13, d: 40 },
      { i: "i-door", x: 47, y: 84, s: 19, r: -6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "buildmanage",
    name: "Build & Manage",
    plural: "management sims",
    blurb: "run the place, grow the numbers",
    icon: "i-trend",
    n: 5,
    note: "Simulation games about running something — a city, a colony, a shop, a studio, a " +
          "dungeon: Cities: Skylines, Two Point, Kairosoft, Prison Architect and more. Needs the " +
          "sheet's Simulation genre plus an IGDB management, city-builder, tycoon or colony tag or " +
          "business theme. Farm and village life sims (Harvest Moon, Story of Seasons, Rune " +
          "Factory, Animal Crossing, Stardew) are left out: their shop is backdrop, not the game.",
    match: thmManage,
    skin: "--ev-disp:var(--display);--ev-size:44px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#fde047;--ev-fg:#fefce8;--ev-fg-2:#cfc9a2;--ev-edge:rgba(253,224,71,.32);" +
          "--ev-edge-hi:rgba(253,224,71,.78);--ev-glow:rgba(253,224,71,.3);--ev-t1:#fefce8;" +
          "--ev-t2:#60a5fa;--ev-t3:#fde047;--ev-on-cta:#221d03;--ev-k:#60a5fa;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(253,224,71,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(96,165,250,.18),transparent 60%)," +
          "linear-gradient(150deg,#0c0b05,#1f1c0b 70%,#0b1527)",
    deco: [
      { i: "i-trend", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-coin", x: 70, y: 22, s: 26, r: -8, lift: 11, d: 90 },
      { i: "i-home", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-stats", x: 47, y: 84, s: 19, r: -6, lift: 8, d: 200, o: .55 },
    ],
  },
  {
    id: "giantrobots",
    name: "Giant Robots",
    plural: "giant-robot games",
    blurb: "get in the robot",
    icon: "i-robot",
    n: 5,
    note: "Games where you pilot, build or command mecha: Armored Core, MechWarrior, Front Mission, " +
          "Gundam, Super Robot Wars, Zone of the Enders, Titanfall and more. Matches IGDB's mecha " +
          "keyword, the Gundam, Super Robot Wars, BattleTech, Front Mission, Macross, Zoids and " +
          "Zone of the Enders franchises, and selected series IGDB leaves untagged. A robot enemy " +
          "or a generic robot tag does not qualify; Evangelion's dating sims are out.",
    match: thmMecha,
    skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:54px;--ev-dw:800;--ev-ls:.03em;" +
          "--ev-deco:#f97316;--ev-fg:#fff3ea;--ev-fg-2:#cdb3a1;--ev-edge:rgba(249,115,22,.32);" +
          "--ev-edge-hi:rgba(249,115,22,.78);--ev-glow:rgba(249,115,22,.3);--ev-t1:#fff3ea;" +
          "--ev-t2:#e2e8f0;--ev-t3:#f97316;--ev-on-cta:#2a1203;--ev-k:#e2e8f0;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(249,115,22,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(226,232,240,.18),transparent 60%)," +
          "linear-gradient(150deg,#0d0906,#24170d 70%,#121722)",
    deco: [
      { i: "i-robot", x: 86, y: 66, s: 46, r: -4, lift: 12 },
      { i: "i-bolt", x: 70, y: 22, s: 26, r: -10, lift: 11, d: 90 },
      { i: "i-target", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-server", x: 47, y: 84, s: 18, r: -6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "fullmotion",
    name: "Full Motion Video",
    plural: "FMV games",
    blurb: "real actors, real footage, real cheese",
    icon: "i-play",
    n: 5,
    note: "Games built out of filmed footage: Night Trap, The 7th Guest, Phantasmagoria, Tex Murphy, " +
          "Her Story, Late Shift and more. The sheet's FMV genre, or IGDB's full-motion-video tags on " +
          "an adventure, rail shooter, puzzle or visual novel. A live-action cutscene does not " +
          "qualify, and games whose \"video\" is CG or anime are audited out.",
    match: thmFmv,
    skin: "--ev-disp:Georgia,serif;--ev-size:44px;--ev-dw:700;--ev-ls:.01em;" +
          "--ev-deco:#f43f5e;--ev-fg:#fff1f3;--ev-fg-2:#d1a9b1;--ev-edge:rgba(244,63,94,.32);" +
          "--ev-edge-hi:rgba(244,63,94,.78);--ev-glow:rgba(244,63,94,.3);--ev-t1:#fff1f3;" +
          "--ev-t2:#fcd34d;--ev-t3:#f43f5e;--ev-on-cta:#2a0610;--ev-k:#fcd34d;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(244,63,94,.22),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(252,211,77,.18),transparent 60%)," +
          "linear-gradient(150deg,#0e0507,#22090f 70%,#1d1608)",
    deco: [
      { i: "i-play", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-disc", x: 70, y: 22, s: 26, r: -8, lift: 11, d: 90 },
      { i: "i-crt", x: 24, y: 20, s: 23, r: 8, lift: 13, d: 40 },
      { i: "i-star", x: 47, y: 84, s: 18, r: -6, lift: 8, d: 200, o: .5 },
    ],
  },
  {
    id: "comfortzone",
    name: "Outside the Comfort Zone",
    blurb: "a great game from somewhere you rarely go",
    icon: "i-globe",
    n: 5,
    note: "A critic score of 80% or better from a primary sheet genre in which you have " +
          "finished five games or fewer. The sheet's specific primary genre is used instead " +
          "of broad IGDB umbrellas, and a missing score never counts as a recommendation.",
    match: thmOutsideComfort,
    skin: "--ev-disp:'Big Shoulders Display',var(--display);--ev-size:48px;--ev-dw:800;--ev-ls:.015em;" +
          "--ev-deco:#fb923c;--ev-fg:#fff4e8;--ev-fg-2:#cfb29b;--ev-edge:rgba(251,146,60,.34);" +
          "--ev-edge-hi:rgba(251,146,60,.8);--ev-glow:rgba(251,146,60,.34);--ev-t1:#fff8f1;" +
          "--ev-t2:#67e8f9;--ev-t3:#fb923c;--ev-on-cta:#241006;--ev-k:#67e8f9;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(251,146,60,.28),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(103,232,249,.2),transparent 60%)," +
          "linear-gradient(150deg,#0b0705,#1a100a 70%,#08151a)",
    deco: [
      { i: "i-globe", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-target", x: 70, y: 22, s: 26, r: -7, lift: 11, d: 90 },
      { i: "i-star", x: 24, y: 20, s: 22, r: 9, lift: 13, d: 40 },
      { i: "i-globe", x: 47, y: 84, s: 18, r: -10, lift: 8, d: 210, o: .5 },
    ],
  },
  {
    id: "onemorerun",
    name: "One More Run",
    blurb: "quick reset, unfinished business",
    icon: "i-refresh",
    n: 4,
    note: "Games IGDB explicitly marks for score attack, endless mode or endless waves, " +
          "plus games that have both a high-score chase and a run-reset signal such as " +
          "roguelike, procedural generation or permadeath. A broad roguelike tag alone is " +
          "not enough: this pool is about repeatable sessions.",
    match: thmOneMoreRun,
    skin: "--ev-disp:'Press Start 2P',var(--display);--ev-size:22px;--ev-dw:400;--ev-ls:0;" +
          "--ev-deco:#a3e635;--ev-fg:#f4ffe6;--ev-fg-2:#afc494;--ev-edge:rgba(163,230,53,.34);" +
          "--ev-edge-hi:rgba(163,230,53,.8);--ev-glow:rgba(163,230,53,.34);--ev-t1:#f8ffed;" +
          "--ev-t2:#f472b6;--ev-t3:#a3e635;--ev-on-cta:#142004;--ev-k:#f472b6;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(163,230,53,.25),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(244,114,182,.22),transparent 60%)," +
          "linear-gradient(150deg,#070a04,#101807 70%,#180a13)",
    deco: [
      { i: "i-refresh", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-dice", x: 70, y: 22, s: 26, r: 8, lift: 11, d: 90 },
      { i: "i-coin", x: 24, y: 20, s: 22, r: -8, lift: 13, d: 40 },
      { i: "i-bolt", x: 47, y: 84, s: 18, r: 10, lift: 8, d: 210, o: .5 },
    ],
  },
  {
    id: "cultclassics",
    name: "Cult Classics",
    plural: "cult classics",
    blurb: "small audience, fierce affection",
    icon: "i-flame",
    n: 5,
    note: "At least ten years old, rated 82% or better by IGDB users, with 20–150 user " +
          "ratings and no more than three critic scores. That requires a real audience but " +
          "keeps it small, and separates beloved outsiders from merely obscure games with " +
          "too little evidence to judge.",
    match: thmCultClassic,
    skin: "--ev-disp:'Special Elite',var(--display);--ev-size:43px;--ev-dw:400;--ev-ls:.01em;" +
          "--ev-deco:#e879f9;--ev-fg:#fcecff;--ev-fg-2:#c6a8c8;--ev-edge:rgba(232,121,249,.34);" +
          "--ev-edge-hi:rgba(232,121,249,.78);--ev-glow:rgba(232,121,249,.32);--ev-t1:#fff2ff;" +
          "--ev-t2:#fbbf24;--ev-t3:#e879f9;--ev-on-cta:#220823;--ev-k:#fbbf24;" +
          "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(232,121,249,.25),transparent 56%)," +
          "radial-gradient(85% 125% at 6% -16%,rgba(251,191,36,.18),transparent 60%)," +
          "linear-gradient(150deg,#0a060b,#180d19 70%,#161006)",
    deco: [
      { i: "i-flame", x: 86, y: 66, s: 46, lift: 12 },
      { i: "i-star", x: 70, y: 22, s: 26, r: -7, lift: 11, d: 90 },
      { i: "i-disc", x: 24, y: 20, s: 22, r: 9, lift: 13, d: 40 },
      { i: "i-ribbon", x: 47, y: 84, s: 18, r: -8, lift: 8, d: 210, o: .5 },
    ],
  },
  {
    id: "oneandonly",
    name: "One and Only",
    plural: "one-and-only games",
    blurb: "the lone representative on a well-stocked platform",
    icon: "i-star",
    n: 5,
    note: "The only listed game in a genre, by a developer, or in a franchise on its platform. " +
          "Counts the full Gamedex list, including finished, unowned and unplayable games, " +
          "not every release ever published. Platforms need at least 100 distinct games; " +
          "developers and franchises need at least 10 distinct games across the list. " +
          "Uses known sheet and enrichment categories; missing metadata can affect uniqueness.",
    match: (r) => thmOnlyReasons().has(r._k),
    reason: (r) => (thmOnlyReasons().get(r._k) || []).join(" · "),
    skin: "--ev-disp:var(--display);--ev-size:44px;--ev-dw:800;--ev-ls:.01em;" +
          "--ev-deco:#fbbf24;--ev-fg:#fff7db;--ev-fg-2:#c8bd99;--ev-edge:rgba(251,191,36,.3);" +
          "--ev-edge-hi:rgba(251,191,36,.75);--ev-glow:rgba(251,191,36,.3);--ev-t1:#fff9e6;" +
          "--ev-t2:#fcd34d;--ev-t3:#fbbf24;--ev-on-cta:#211805;--ev-k:#fcd34d;" +
          "--ev-art:radial-gradient(ellipse at 80% 20%,#423312,transparent 65%)," +
          "linear-gradient(150deg,#100e08,#211a0c)",
    deco: [{ i: "i-star", x: 84, y: 50, s: 64, lift: 10 }],
  },
];

const THM_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/* "137 cyberpunk games on the sheet" — the theme's name as a plural noun. Most names are
   adjectives and take "games" after them, but a few already end in one ("Bad Games" read as
   "559 bad games games"), so a theme can spell its own out. */
const thmNoun = (t) => t.plural || t.name.toLowerCase() + " games";

/* Slate bounds. The floor is 1 — "just tell me one cyberpunk game to play" is a legitimate
   use of this page, and forcing three onto someone who wanted one is a worse answer than no
   answer. The ceiling is two limits at once: a flat 24, and the theme's own pool, because a
   slate of 20 drawn from a pool of 12 is eight slots that can never fill and a completion
   bar that can never reach the end. 24 is a judgement call, not a law: past it a slate stops
   being a commitment you can hold in your head and turns back into a backlog, which is what
   the rest of the app already is. */
const THM_MIN = 1, THM_MAX = 24;
const thmCap = (t) => Math.max(THM_MIN, Math.min(THM_MAX, thmPool(t).length || THM_MAX));

/* ---- pools ----------------------------------------------------------------
   Two counts per theme, and they answer different questions. The POOL is what a roll can
   reach. The BREADTH is every game the theme matches at all, owned or not, finished or not,
   and it is the number worth putting on the page: "37 of the 401 cyberpunk games on the
   sheet are yours and unplayed" says something that either number alone does not.

   OWNERSHIP IS NOT THE POOL'S TEST, and this is the one place themes depart from
   evOwnedUnfinished — every seasonal event uses it, and for a season that is right, because
   a calendar with a game you'd have to buy first is a calendar you cannot keep. A theme has
   all year. "Give me five cyberpunk games" is a question about the genre, not about the
   shelf, and answering it out of 6,660 owned rows while 6,197 playable unowned ones sit in
   the same spreadsheet was answering a narrower question than the one being asked.

   PLAYABLE IS, and it is the sheet's tri-state: Yes, No, Unknown, and only Yes gets in.
   That is pick.js's rule, for pick.js's reason — a slate game you cannot start (no console
   for it any more, region-locked, disc rot) has answered the wrong question, and Unknown
   does not mean "probably fine", it means nobody has checked, and being sent to go and
   check is not a slate. Applied to the owned games too rather than only to the new ones,
   because one pool with one test beats two: it costs 20 rows across the whole sheet, all of
   them games this page should never have been offering. */
const thmEligible = (r) => !r.completed && r.playable === "Yes";
const thmPool = (t) => evPool("thm-" + t.id, (r) => thmEligible(r) && t.match(r));
const thmBreadth = (t) => evPool("thmall-" + t.id, (r) => t.match(r));

/* ---- state ----------------------------------------------------------------
     open   which theme's page you were last on. A pref rather than a URL param, because
            every other event keeps its dial in state too (Class of 'XX, for example)
            and a theme is a place you return to, not a link you send.
     runs   one run per theme, at most. { n, slate, pinned, rolls, started, updated }

   There used to be a `past` here too — closed runs per theme, newest first, snapshotted with
   their verdicts — and a "Finish the run" button that filed them. Both are gone, because the
   premise under them was wrong: completion lives on the sheet, this page only reads it, and
   so a closed run was a frozen copy of a number the sheet already keeps better. Archiving it
   bought nothing and asked for a press. A slate now just turns over as you roll it, and the
   only end a run has is you rolling the last slot. (Old saved state may still carry `past`;
   nothing reads it, and leaving it alone is cheaper than migrating it away.) */
const thmState = () => {
  const st = evState("themes");
  if (!st.runs || typeof st.runs !== "object") st.runs = {};
  if (!st.open || !THM_BY_ID[st.open]) st.open = THEMES[0].id;
  return st;
};
const thmTheme = () => THM_BY_ID[thmState().open] || THEMES[0];

const thmBlankRun = (t) => ({
  // No `done` list: completion is read off the sheet, never stored here. See thmIsDone.
  n: t.n, slate: new Array(t.n).fill(null), pinned: [], rolls: 0, started: null, updated: null,
});

const thmTouch = (run) => { run.updated = Date.now(); };

// The open run, created on demand. An empty slate IS a run — it just hasn't been rolled.
function thmRun(t) {
  const st = thmState();
  let run = st.runs[t.id];
  if (!run || !Array.isArray(run.slate)) { run = st.runs[t.id] = thmBlankRun(t); }
  if (!Array.isArray(run.pinned)) run.pinned = [];
  if (!run.n) run.n = run.slate.length || t.n;
  while (run.slate.length < run.n) run.slate.push(null);
  /* The invariant, repaired on read rather than only on write: the slate is exactly run.n
     long. A saved cyberpunk run broke it — n of 5 against a slate of 15 — and a slate longer
     than its own dial is the worst failure this page has: the page renders run.n slots, so
     the ten games past the fifth existed without being drawn. They counted as filled, they
     counted as pinned, they blocked every resize with a toast naming a number you could not
     see, and they left a roll with no open slot to fill.
     The games win over the dial. A slate entry is a decision — a roll, or a pick by hand —
     and n is a number you nudged with a button, so the repair widens n to fit the games
     rather than slicing the games to fit n. Only past the hard ceiling is anything dropped,
     and then it is the tail, which is the only part nothing can have decided about. */
  if (run.slate.length > run.n) {
    run.n = Math.min(run.slate.length, THM_MAX);
    if (run.slate.length > run.n) run.slate = run.slate.slice(0, run.n);
  }
  // A pin is a decision about a game on the slate; a key that has left the slate has no slot
  // to leave alone. thmRoll already prunes on its way out — thmSet, which can overwrite a
  // slot's occupant outright, did not, and the orphans it left were invisible but counted.
  if (run.pinned.some((k) => !run.slate.includes(k))) {
    run.pinned = run.pinned.filter((k) => run.slate.includes(k));
  }
  return run;
}

/* Done, and where "done" comes from: the sheet, and only the sheet. The Completed column is
   the one place this app has ever recorded a finished game, and a second place to say so is
   a second place to be wrong — a page-local tick drifts from the sheet the moment you finish
   something anywhere else, and then two screens disagree about the same game. So there is no
   tick button. Finish it, mark it on the sheet as you always would, and the slate catches up
   on the next load with nothing asked of you here.

   (`run.done` survives in old saved state, written back when a tick button existed. Nothing
   reads it; thmIsDone ignores the run it is handed and asks the sheet.) */
const thmSheetDone = (key) => { const r = evRow(key); return !!(r && r.completed); };
const thmIsDone = (run, key) => thmSheetDone(key);
const thmDoneCount = (run) => run.slate.filter((k) => thmIsDone(run, k)).length;
const thmFilled = (run) => run.slate.filter(Boolean).length;
const thmComplete = (run) => thmFilled(run) === run.n && thmDoneCount(run) === run.n;
const thmActive = (run) => thmFilled(run) > 0;

const thmPinned = (run, key) => !!key && run.pinned.includes(key);

/* A roll fills every slot that is not pinned and not already done. Pinned and done are the
   two kinds of "I have decided about this one", and a dice button that could throw either
   away would be a dice button nobody presses twice. */
function thmRoll(t, only) {
  const run = thmRun(t);
  const pool = thmPool(t);
  const keep = run.slate.map((k) => (k && (thmPinned(run, k) || thmIsDone(run, k)) ? k : null));
  // Slots to fill, in order — a single-slot reroll is the same operation with one index.
  let slots = only == null
    ? keep.map((k, i) => (k ? -1 : i)).filter((i) => i >= 0)
    : (keep[only] ? [] : [only]);
  /* Nothing open, and the reason is that you finished them: roll the finished ones away. This
     is what used to be "Finish the run", and it is the whole lifecycle a run needs — a done
     game is not a pending decision, it is recorded on the sheet, and the pool excludes it, so
     it cannot come back. Without this a completed slate was a dead end: every slot blocked by
     its own success, and the only way out was emptying five slots by hand. Pins still win —
     if you pinned a finished game it stays, and Unpin all is in the hero. */
  if (only == null && !slots.length) {
    const spent = keep.map((k, i) => (k && !thmPinned(run, k) ? i : -1)).filter((i) => i >= 0);
    if (spent.length) { spent.forEach((i) => { keep[i] = null; }); slots = spent; }
  }
  if (!slots.length) {
    showToast(only == null ? "Every slot is pinned or finished" : "That one is pinned");
    return;
  }
  const draw = evDraw(pool, slots.length, keep.filter(Boolean));
  if (!draw.length) {
    showToast(`Nothing left in the ${t.name} pool that isn't already on the slate`);
    return;
  }
  const next = only == null ? keep : run.slate.slice();
  slots.forEach((i, j) => { next[i] = draw[j] ? evKey(draw[j]) : (only == null ? null : next[i]); });
  run.slate = next;
  run.rolls = (run.rolls || 0) + 1;
  if (!run.started) run.started = evISO();
  // A game rolled away is not a game you pinned. Keeps `pinned` from accumulating keys that
  // haven't been on the slate for six rolls.
  run.pinned = run.pinned.filter((k) => run.slate.includes(k));
  thmTouch(run);
  evSave();
}

function thmTogglePin(t, key) {
  const run = thmRun(t);
  const i = run.pinned.indexOf(key);
  if (i >= 0) run.pinned.splice(i, 1); else run.pinned.push(key);
  thmTouch(run);
  evSave();
}

/* Unpin the lot. Pinning is per-tile and unpinning was too, which is fine for the one game
   you changed your mind about and useless for the state this exists to get out of: every slot
   pinned, so a roll has nothing to turn over and shrinking the slate is refused. One button
   beats fifteen presses, and it is the only control here that can unstick a run. */
function thmClearPins(t) {
  const run = thmRun(t);
  if (!run.pinned.length) return 0;
  const n = run.pinned.length;
  run.pinned = [];
  thmTouch(run);
  evSave();
  return n;
}

function thmSet(t, slot, key) {
  const run = thmRun(t);
  // One game, one slot: putting a game that is already on the slate into a new slot MOVES
  // it, and the slot it left takes whatever was in the destination (hearthSet's rule).
  const at = run.slate.indexOf(key);
  if (at >= 0 && at !== slot) run.slate[at] = run.slate[slot];
  run.slate[slot] = key;
  if (!run.started) run.started = evISO();
  thmTouch(run);
  evSave();
}

function thmDrop(t, slot) {
  const run = thmRun(t);
  const key = run.slate[slot];
  run.slate[slot] = null;
  run.pinned = run.pinned.filter((k) => k !== key);
  thmTouch(run);
  evSave();
}

/* Resizing a run keeps the decisions and drops the filler. Shrinking pulls the pinned and
   finished games to the front rather than slicing them off the end, because "5, actually
   make it 3" means "fewer games", never "lose the two I pinned". */
function thmResize(t, n) {
  const run = thmRun(t);
  // Round first and only fall back on genuine junk — `+n || t.n` sent a legitimate 0 to the
  // theme's default instead of to the floor of 1.
  n = Math.round(+n);
  if (!Number.isFinite(n)) n = t.n;
  n = Math.max(THM_MIN, Math.min(thmCap(t), n));
  if (n === run.n) return;
  if (n < run.slate.length) {
    const keep = run.slate.filter((k) => k && (thmPinned(run, k) || thmIsDone(run, k)));
    if (keep.length > n) { showToast(`${keep.length} are pinned or finished — unpin one first`); return; }
    const rest = run.slate.filter((k) => k && !keep.includes(k));
    run.slate = keep.concat(rest).slice(0, n);
  }
  run.n = n;
  while (run.slate.length < n) run.slate.push(null);
  thmTouch(run);
  evSave();
}

function thmOpen(id) {
  if (!THM_BY_ID[id]) return;
  const st = thmState();
  st.open = id;
  evSave();
}

const THM_BROWSER = { open: false, q: "", dialog: null };

/* Which page of the tab is showing: null is the landing page (every theme, plus what you
   finished lately), an id is that theme's slate. It is a view, not a preference — `open`
   remembers the theme you last played, this says whether you are looking at it — so it
   lives in the URL (?th=) where Back can undo it, and a deliberate visit to the tab
   starts on the landing page. The Home banner skips straight to the slate it advertises. */
const THM_VIEW = { id: null };

function thmGo(id) {
  THM_VIEW.id = THM_BY_ID[id] ? id : null;
  if (THM_VIEW.id) thmOpen(THM_VIEW.id);
  evPickerClose();
  evRenderPage("themes");
  nav();
  if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
}

/* Recently finished, across every theme. A finished game counts toward each theme that
   matches it — the same predicate its pool used — whether or not it was ever rolled onto a
   slate, because finishing a cyberpunk game is finishing a cyberpunk game. The slates are
   marked anyway: a game you rolled and then played is the page doing its job. Newest
   completion date first; rows without one have no place in a "recent" list. */
const THM_RECENT_MAX = 12;
function thmRecentFinished(limit = THM_RECENT_MAX) {
  const slated = new Map();
  for (const [id, run] of Object.entries(thmState().runs)) {
    if (!THM_BY_ID[id] || !Array.isArray(run.slate)) continue;
    for (const k of run.slate) if (k && !slated.has(k)) slated.set(k, id);
  }
  const done = evRows()
    .filter((r) => r.title && r.completed && /^\d{4}-\d{2}-\d{2}$/.test(String(r.dateCompleted || "")))
    .sort((a, b) => String(b.dateCompleted).localeCompare(String(a.dateCompleted)));
  const out = [], seen = new Set();
  for (const row of done) {
    if (out.length >= limit) break;
    const title = String(row.title).trim().toLowerCase();
    if (seen.has(title)) continue;
    const themes = THEMES.filter((t) => t.match(row));
    if (!themes.length) continue;
    seen.add(title);
    const from = slated.get(evKey(row));
    // The slate it came off leads the list, so the first link is the one that rolled it.
    if (from) themes.sort((a, b) => (b.id === from) - (a.id === from));
    out.push({ row, themes, from: from || null });
  }
  return out;
}
const THM_SYNC_MS = 15000;
let THM_SYNC_TIMER = null;

function thmScheduleSync() {
  if (typeof setTimeout !== "function") return;
  if (THM_SYNC_TIMER) clearTimeout(THM_SYNC_TIMER);
  THM_SYNC_TIMER = setTimeout(async () => {
    THM_SYNC_TIMER = null;
    if (typeof activeTab === "undefined" || activeTab !== "themes") return;
    await evLoadPrefs(true);
    if (activeTab === "themes" && !THM_SYNC_TIMER) thmScheduleSync();
  }, THM_SYNC_MS);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const refreshThemes = () => {
    if (typeof activeTab !== "undefined" && activeTab === "themes") evLoadPrefs(true);
  };
  window.addEventListener("focus", refreshThemes);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshThemes();
  });
}

function thmChoiceMeta(t) {
  const run = thmState().runs[t.id];
  if (!run || !Array.isArray(run.slate) || !run.slate.some(Boolean)) {
    return `${thmPool(t).length.toLocaleString()} to roll`;
  }
  return `${run.slate.filter((k) => thmIsDone(run, k)).length} of ${run.n} done`;
}

/* The registry entry's own look, kept apart from it because thmRender overwrites the
   entry's skin with whichever theme is open. The landing page belongs to no theme. */
const THM_HOME_SKIN = "--ev-disp:var(--display);--ev-size:44px;--ev-dw:800;--ev-ls:.01em;" +
  "--ev-deco:#a78bfa;--ev-fg:#f1ecff;--ev-fg-2:#aba3c9;--ev-edge:rgba(167,139,250,.3);" +
  "--ev-edge-hi:rgba(167,139,250,.72);--ev-glow:rgba(167,139,250,.32);--ev-t1:#f7f4ff;" +
  "--ev-t2:#c4b5fd;--ev-t3:#a78bfa;--ev-on-cta:#120a26;--ev-k:#c4b5fd;" +
  "--ev-art:radial-gradient(110% 150% at 84% 120%,rgba(167,139,250,.24),transparent 56%)," +
  "radial-gradient(85% 125% at 6% -16%,rgba(94,234,212,.14),transparent 60%)," +
  "linear-gradient(150deg,#07060d,#0d0a18 70%,#0a0a16)";
const THM_HOME_DECO = [
  { i: "i-theme", x: 86, y: 66, s: 46, lift: 12 },
  { i: "i-grid", x: 92, y: 26, s: 25, r: -8, lift: 11, d: 90 },
  { i: "i-dice", x: 72, y: 88, s: 22, r: 10, lift: 13, d: 40 },
  { i: "i-check", x: 47, y: 84, s: 18, r: -6, lift: 8, d: 200, o: .5 },
];

evRegister({
  id: "themes",
  name: "Themes",
  icon: "i-theme",
  structure: "Slate",
  // Under every season and under Endangered. A theme has all year; October does not, and
  // the one banner slot should go to whichever of them is running out of time.
  priority: 35,
  window: null,
  core: null,
  cta: "Open the board",
  blurb: "a slate of games on a theme, rolled and pinned",
  // Neutral: the preview board shows it before a theme has been opened, and the landing page
  // wears it for good. A theme's page swaps in that theme's own (thmRender, thmBannerHtml).
  skin: THM_HOME_SKIN,
  deco: THM_HOME_DECO,
  bannerHtml: thmBannerHtml,
  bannerOpen: () => { THM_VIEW.id = thmTheme().id; },
  urlState: {
    read: (p) => {
      const id = p.get("th");
      THM_VIEW.id = THM_BY_ID[id] ? id : null;
      // Following a link to a theme makes it the open one, without a save: `open` is
      // local to this browser and the next real change will write it.
      if (THM_VIEW.id) thmState().open = THM_VIEW.id;
    },
    write: (p) => { if (THM_VIEW.id) p.set("th", THM_VIEW.id); },
  },
  blank: () => ({ runs: {}, open: THEMES[0].id }),
  /* A slate and its pins are one decision, so sync them as one run. Every mutation stamps
     `updated`; the newer device wins the whole run, which also lets an unpin propagate.
     Legacy runs use roll count and then the server as their migration tie-break. `open`
     stays local: which theme this browser is viewing is this browser's business. */
  merge: (mine, theirs) => {
    let changed = false;
    if (!mine.runs) { mine.runs = {}; changed = true; }
    for (const [id, t] of Object.entries(theirs.runs || {})) {
      const m = mine.runs[id];
      if (!m) { mine.runs[id] = t; changed = true; continue; }
      const mineAt = Number(m.updated) || 0;
      const theirsAt = Number(t.updated) || 0;
      let takeTheirs;
      if (mineAt || theirsAt) {
        // A tie is possible when roll and pin happen in one millisecond. The server copy is
        // the end of the ordered save queue, so it is the complete one in that case.
        takeTheirs = theirsAt >= mineAt;
      } else {
        // Migration for runs saved before `updated` existed. A roll advances freshness;
        // with equal rolls the server is the only shared copy and wins the ambiguity.
        const mineRolls = +m.rolls || 0, theirRolls = +t.rolls || 0;
        takeTheirs = theirRolls >= mineRolls;
      }
      if (takeTheirs && JSON.stringify(m) !== JSON.stringify(t)) {
        mine.runs[id] = t;
        changed = true;
      }
    }
    return changed;
  },
  // The tab says "Themes"; the poster says which one. Same trick as Class of 'XX, whose
  // name is a different year every January.
  title: () => (THM_VIEW.id ? thmTheme().name : "Themes"),
  eyebrow: () => "Theme · no season, no deadline",
  pitch: () => {
    const t = thmTheme();
    const run = thmRun(t);
    const filled = thmFilled(run), done = thmDoneCount(run);
    // Not "on your shelf" any more — the pool is every playable one you haven't finished,
    // and some of them you don't own (thmEligible).
    if (!filled) return `${thmPool(t).length.toLocaleString()} ${thmNoun(t)} you could play, unfinished. Roll ${run.n} of them.`;
    if (thmComplete(run)) return `${t.blurb} — and the whole slate is finished. Roll it again for the next ${run.n}.`;
    if (!done) return `${evPlural(filled, "game", "games")} on the slate: ${t.blurb}. Nothing finished yet, and nothing is asking you to hurry.`;
    // Against run.n, not against `filled`, and the meter agrees: the slate size is the
    // commitment, so an empty slot is a slot still to play rather than one that doesn't count.
    return `${done} of ${run.n} finished. ${t.blurb.charAt(0).toUpperCase()}${t.blurb.slice(1)}.`;
  },
  meter: () => {
    const t = thmTheme();
    const run = thmRun(t);
    const filled = thmFilled(run);
    if (!filled) return { pct: null, text: `an empty slate, and ${thmPool(t).length.toLocaleString()} to draw from` };
    return { pct: Math.round((thmDoneCount(run) / run.n) * 100),
             text: `${thmDoneCount(run)} of ${run.n} done · ${evPlural(run.rolls || 0, "roll", "rolls")}` };
  },
  /* Always eligible for the banner, but only while a run is open. A theme with an empty
     slate has nothing to report, and the whole reason an always-on event can share the year
     with nine seasons is that it stays quiet when it has nothing to say (Endangered's rule). */
  live: () => thmActive(thmRun(thmTheme())),
  render: (host) => (THM_VIEW.id ? thmRender(host) : thmLandingRender(host)),
  reset: () => {
    THM_VIEW.id = null;
    EVP.slot = null; EVP.q = ""; EVP.all = false;
    THM_BROWSER.dialog?.close();
    THM_BROWSER.open = false; THM_BROWSER.q = "";
    if (THM_SYNC_TIMER) { clearTimeout(THM_SYNC_TIMER); THM_SYNC_TIMER = null; }
  },
});
