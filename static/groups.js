"use strict";

/* Groupings — the collection cut along whichever axis you care about.

   Series started as a page per franchise: every game in release order, what you
   own, what you've beaten, how far through you are, and the obvious next one to
   play. Nothing about that view is really ABOUT franchises, though — it works for
   any set of games that belong together. So it's now one machine with a choice of
   axis, and "Series" is simply the franchise axis.

   Three levels: pick an axis → an index of groups → the group itself.

   Loaded after app.js; shares its globals (DATA, ENRICH, openDrawer, …). */

const groupState = { kind: null, open: null, q: "", sort: "size" };

const grRows = () => ((DATA.sheets.games || {}).rows || []).filter((r) => r.title);

/* Developer / publisher / franchise / genre are MULTI-valued now: the sheet's one
   value per row is joined with IGDB's many (unified*Vals), so a game files under every
   studio, publisher, franchise, and genre either source knows — a co-developer only
   IGDB lists gets its own shelf, and the umbrella genres (Platformer, RPG) become
   groups the granular sheet genres roll up into. Platform stays single. */
// The IGDB list-valued fields, straight off the enrichment map.
const igdbVals = (r, field) => (ENRICH[r._k] || {})[field] || [];

const GROUPINGS = [
  { id: "series", label: "Series", icon: "i-timeline", vals: (r) => unifiedFranchiseVals(r),
    units: "franchises", blurb: "Franchises in release order. How far through Castlevania are you?" },
  { id: "developer", label: "Developers", icon: "i-edit", vals: (r) => unifiedDevVals(r),
    units: "studios", blurb: "Every studio you own something by, and what you never got around to." },
  { id: "publisher", label: "Publishers", icon: "i-package", vals: (r) => unifiedPubVals(r),
    units: "publishers", blurb: "Grouped by who published it, not who made it." },
  { id: "genre", label: "Genres", icon: "i-target", vals: (r) => unifiedGenreVals(r),
    units: "genres", blurb: "What you actually play, as opposed to what you buy." },
  { id: "platform", label: "Platforms", icon: "i-dice", vals: (r) => (r.platform ? [r.platform] : []),
    units: "platforms", blurb: "A shelf per machine, with how much of it you've completed." },
  // IGDB knows these about nearly everything and the app has never asked. A perspective is
  // the one axis a genre can't express — plenty of games are "Action" and the only real
  // difference is where the camera sits.
  { id: "keyword", label: "Keywords", icon: "i-star", vals: (r) => igdbVals(r, "keywords"),
    units: "keywords", blurb: "IGDB's finest-grained tags (metroidvania, soulslike, cozy, story rich)." },
  { id: "perspective", label: "Perspective", icon: "i-target", vals: (r) => igdbVals(r, "perspectives"),
    units: "perspectives", blurb: "Where the camera sits (first person, side view, isometric). It's the one thing genre doesn't tell you." },
  { id: "engine", label: "Engines", icon: "i-package", vals: (r) => igdbVals(r, "engines"),
    units: "engines", blurb: "What it was built in, so everything you own running on Unreal, or on Godot." },
];
const grouping = (id) => GROUPINGS.find((g) => g.id === id);

const MIN_GROUP = 2;      // one game is not a grouping

let _grIndex = {}, _grMembers = {};
const resetGroups = () => { _grIndex = {}; _grMembers = {}; };

// The landing tiles need membership and completion counts, not release sorting,
// history joins, critics, or a next-game recommendation for every group.
function groupMembers(kind) {
  if (_grMembers[kind]) return _grMembers[kind];
  const g = grouping(kind);
  if (!g) return [];
  const m = new Map();
  for (const r of grRows()) {
    for (const name of g.vals(r)) {
      if (!name) continue;
      let entry = m.get(name);
      if (!entry) m.set(name, entry = { name, games: [], done: 0, owned: 0 });
      entry.games.push(r);
      if (r.completed) entry.done++;
      if (r.owned) entry.owned++;
    }
  }
  return (_grMembers[kind] = [...m.values()].map(entry => ({
    ...entry, size: entry.games.length, pct: entry.done / entry.games.length,
  })));
}

function groupIndex(kind) {
  const perf = typeof gamedexPerf !== "undefined" ? gamedexPerf : null;
  const end = perf ? perf.start("groupIndex", activeTab) : () => {};
  try { return _groupIndex(kind); } finally { end(); }
}

function _groupIndex(kind) {
  if (_grIndex[kind]) return _grIndex[kind];
  return (_grIndex[kind] = groupMembers(kind).map(member => {
    let ordered = null, stats = null, next = null;
    const entry = { name: member.name, size: member.size, done: member.done,
      owned: member.owned, pct: member.pct,
      get games() {
        if (!ordered) ordered = member.games.slice().sort((a, b) =>
          String(a.releaseDate || a.releaseYear || "").localeCompare(String(b.releaseDate || b.releaseYear || "")));
        return ordered;
      },
    };
    // Sorting by size/progress/name does no detail work. Rating/hours sorts ask
    // for statistics; only an opened group asks for play-next relations.
    for (const key of ["avgRating", "nRated", "avgCritic", "played", "left", "spent", "y0", "y1"]) {
      Object.defineProperty(entry, key, { enumerable: true, get() {
        if (!stats) stats = groupAggregates(entry.games);
        return stats[key];
      }});
    }
    for (const key of ["next", "skipped", "allPlayed"]) {
      Object.defineProperty(entry, key, { enumerable: true, get() {
        if (!next) next = groupNext(entry.games);
        return next[key];
      }});
    }
    return entry;
  }));
}

function groupNext(games) {
  /* What to play next: the earliest unfinished game you can actually play — and NOT one
     you have already played some other way. Release order alone offered Final Fantasy II
     on the NES to someone who beat it on the PSP: a different row, a different IGDB id,
     an unticked Completed box, and the same game. relations.js walks IGDB's port /
     remaster / remake / edition graph for that, and its bundle contents for the games you
     met inside a compilation (alreadyPlayed), so the pick skips everything you have
     already finished in some form and lands on the first game here that is genuinely new. */
  const alt = (x) => (typeof alreadyPlayed === "function" ? alreadyPlayed(x) : null);
  const unfinished = games.filter((x) => !x.completed);
  const fresh = unfinished.filter((x) => !alt(x));
  const next = fresh.find((x) => (typeof isCandidate === "function" ? isCandidate(x) : x.owned))
    || fresh[0];
  // The one it stepped OVER, so the page can say why. Only worth naming when it really is
  // earlier than the pick — a later skip isn't what the eye was going to ask about, and
  // with no pick at all the "nothing new left" line below says it better.
  const passed = unfinished.find((x) => alt(x));
  const skipped = next && passed && games.indexOf(passed) < games.indexOf(next)
    ? { game: passed, played: alt(passed) } : null;   // played: {game, how} from alreadyPlayed

  return { next, skipped, allPlayed: !next && unfinished.length > 0 };
}

function groupAggregates(games) {
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const rated = games.map((x) => x.rating).filter((v) => v != null);
  const crits = games.map((x) => (typeof criticOf === "function" ? criticOf(x) : null))
    .filter((v) => v != null);
  const played = games.reduce((s, x) => s + (playedHoursOf(x) ?? 0), 0);
  const left = games.filter((x) => !x.completed).reduce((s, x) => {
    const t = typeof playtimeOf === "function" ? playtimeOf(x) : null;
    return s + (t != null ? t : 0);
  }, 0);
  const spent = games.reduce((s, x) => s + (x.purchasePrice ? +x.purchasePrice : 0), 0);
  const yrs = games.map((x) => +x.releaseYear).filter((y) => y > 1900);

  return {
    avgRating: mean(rated), nRated: rated.length, avgCritic: mean(crits),
    played, left, spent,
    y0: yrs.length ? Math.min(...yrs) : null,
    y1: yrs.length ? Math.max(...yrs) : null,
  };
}

const grGroups = (kind) => groupIndex(kind).filter((s) => s.size >= MIN_GROUP);

const GROUP_SORTS = {
  size: { label: "Most games", cmp: (a, b) => b.size - a.size },
  progress: { label: "Closest to done", cmp: (a, b) => (b.pct - a.pct) || (b.done - a.done) },
  done: { label: "Most completed", cmp: (a, b) => b.done - a.done },
  name: { label: "A–Z", cmp: (a, b) => a.name.localeCompare(b.name) },
  untouched: { label: "Never started", cmp: (a, b) => (a.pct - b.pct) || (b.size - a.size) },
  // Now that a group carries its own numbers, they're worth sorting on: which studio do
  // I actually rate highest, which series has eaten the most of my life.
  rating: { label: "Best rated", cmp: (a, b) => (b.avgRating ?? -1) - (a.avgRating ?? -1) },
  played: { label: "Most played", cmp: (a, b) => (b.played || 0) - (a.played || 0) },
};

// ---- cards ---------------------------------------------------------------

// The best of a group, by your own reckoning: the highest-rated game in it that you actually
// FINISHED. Not the highest-rated one you own — a 95 you never played says nothing about the
// group, and half the point of a grouping is remembering why you liked it.
function groupBest(s) {
  let best = null;
  for (const g of s.games) {
    if (!g.completed || g.rating == null) continue;
    if (!best || g.rating > best.rating) best = g;
  }
  return best;
}

/* The hours a finished game ACTUALLY took.

   Not on the row you'd expect: All Games' `completionTime` is blank for most rows, and the
   real number lives on the Completed sheet as `playTime`. historyOf() already joins the two
   sheets on the match key for exactly this reason — Groupings just never asked it, so it
   read a mostly-empty column, found nothing, and fell back to an HowLongToBeat estimate for
   games that had a real time recorded all along. The group's "You've played" total was
   undercounting for the same reason. */
function playedHoursOf(g) {
  if (!g.completed) return null;
  const t = typeof historyOf === "function" ? historyOf(g).playTime : g.completionTime;
  return t != null && t !== "" ? +t : null;
}

// A row's name, whichever sheet it came from — the Completed sheet calls it `game`.
const altName = (r) => String((r && (r.title || r.game)) || "");

/* Why a game counts as played when its own row says otherwise, as a sentence. The two
   cases are genuinely different claims and saying them the same way would blur both: one
   is a copy of the game, the other is a box the game was in. */
function altWhy(o) {
  const name = escapeHtml(altName(o.game));
  const on = o.game.platform ? ` on ${escapeHtml(String(o.game.platform))}` : "";
  return o.how === "bundle" ? `you played it in ${name}${on}` : `you beat ${name}${on}`;
}

function wireGroupCards(host) {
  host.querySelectorAll("[data-fr]").forEach((el) => {
    el.onclick = () => { groupState.open = el.dataset.fr; renderGroups(); nav(); };
  });
}

// Open a grouping from anywhere (a chip in the drawer, the command palette).
function openGroup(kind, name) {
  goTab("groups", () => {
    groupState.kind = kind;
    groupState.open = name || null;
  });
}

// Landing state (core.js): back to the axis menu, with the find box and sort as found.
TAB_RESET.groups = () => {
  groupState.kind = null; groupState.open = null;
  groupState.q = ""; groupState.sort = "size";
};
