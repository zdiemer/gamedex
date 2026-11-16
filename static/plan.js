"use strict";

/* ---- Plan: the queue, in three lanes -----------------------------------
   Pick answers "what do I play tonight" and RNG answers "what shape should the next
   stretch have". Neither answers the one left over: what am I playing AFTER this. That
   is a list, it is kept by hand, and until now it was kept in my head.

   So Plan is three ordered queues — the same three lanes the RNG mode rolls, because a
   plan that disagreed with the roller about what "retro" means would be two vocabularies
   for one shelf (see PLAN_TRACKS). You put games in them in the order you mean to play
   them, and the page's whole job is to show you, while you choose, the things that make
   one candidate worth more than another:

     * how many CHALLENGE BUCKETS beating it would clear (challenges.js, chWouldClear),
       and the scarcest one by name — "nothing else in your library clears this" is the
       line that decides a queue.
     * which THEME SLATES it is already on (themes.js), because a game that is on a slate
       is a game you have already told this app you mean to play.
     * what the sheet already says about it: Playing, Up Next, On Hold, started, finished.

   Nothing here is a second copy of a fact the sheet owns. Completion is read off the
   Completed column exactly as challenges.js and themes.js read it — there is no tick
   button on this page — and the status chips are the sheet's own Status cell. The ONLY
   thing Plan stores is the order, which is the one thing nothing else records.

   Loaded after rng.js (for the lane definitions and the row index) and after
   challenges.js and themes.js, whose signals it reads behind typeof guards the way
   rng.js reads CH_TEXT_GENRES. UI lives in components/discovery/plan.js. */

/* ---- the three lanes ----------------------------------------------------
   RNG_SLOTS, not a second list. Modern AAA / Modern indie / Retro is a judgement about
   this collection (the hardware-generation line, the publisher lists, the indie evidence)
   and it took rng.js 200 lines to get right; a plan that classified games its own way
   would put a game in "Retro" here and "Modern indie" one tab over.

   A lane is also an ASSIGNMENT, not only a classification: planAdd defaults to the lane
   a game classifies into, and planSetTrack lets you overrule it. The classifier is
   inference and inference is wrong sometimes; the queue is yours. */
const planTracks = () => RNG_SLOTS;
const planTrack = (id) => planTracks().find((t) => t.id === id) || null;
const planTrackIds = () => planTracks().map((t) => t.id);

/* Which lane a game falls in, over the WHOLE sheet rather than over a pool. rngSlotOf
   returns null for an undated game on hardware with no generation (a PC game nobody has
   a year for), which is the one way the three lanes can fail to be exhaustive — so that
   null is carried through rather than guessed away, and planCoverage puts the count on
   the page. Across the current sheet it is zero: every such row has a year from the
   sheet or from IGDB. If that ever changes, the page
   says so and the games are listed, because a lane you can assign by hand is a better
   answer than a lane assigned by a coin toss. */
const planTrackOf = (r) => rngSlotOf(r);

/* ---- what's in the queue -------------------------------------------------
   Stored in prefs (extras.js: server-backed, localStorage mirror) as [{track, key}] in
   play order — the row's match key, never the row, for rng.js's reason: every sheet
   reload builds new row objects and a held one goes stale the first time the data
   refreshes. A plan is also the same plan on the phone and on the desktop, which rules
   out localStorage on its own.

   One flat list rather than three, so a single array write moves a game between lanes
   without the two halves of that move being able to land out of order. */
const PLAN_MAX = 300;          // entries in all, about 12KB against the 256KB pref cap
const PLAN_MAX_TRACK = 50;     // per lane: past this it is a backlog again, not a plan

const planList = () => (typeof prefsLocal === "function" ? prefsLocal("plan") : []);
const planSaveList = (list) => prefsSave("plan", list.slice(0, PLAN_MAX));

// Every key anywhere in the plan. The candidate lists subtract this, so a game can't be
// offered for a lane it is already sitting in two columns over.
const planKeys = () => new Set(planList().map((p) => p && p.key).filter(Boolean));
const planHas = (key) => !!key && planKeys().has(key);

/* The plan, resolved against the sheet and repaired on read.

   Two repairs, and both have to happen here rather than only on write: an entry naming a
   lane that no longer exists (the three ids are a fixed set, and a stale one would hold a
   game in a column nothing renders), and an entry whose game has left the sheet. Dropped
   rather than kept, and written back once if anything actually went — this runs on every
   render, so an unconditional save would be a PUT per repaint.

   A FINISHED game is not stale and is not dropped. Finishing something you planned is the
   point; the row stays, wearing the sheet's own answer, until you clear it (planClearDone).
   Same reading of the Completed column as thmIsDone and chBeaten: this page records no
   completion of its own. */
function planEntries() {
  const list = planList();
  const ids = new Set(planTrackIds());
  const out = [], stale = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || !p.key || !ids.has(p.track) || seen.has(p.key)) { if (p) stale.push(p); continue; }
    const row = rngRowByKey(p.key);
    if (!row) { stale.push(p); continue; }
    seen.add(p.key);
    out.push({ track: p.track, key: p.key, row });
  }
  if (stale.length) planSaveList(out.map(({ track, key }) => ({ track, key })));
  return out;
}

// One lane's queue, in play order.
const planQueue = (trackId) => planEntries().filter((e) => e.track === trackId);

/* Beaten, by either sheet's reckoning. chBeaten makes the join across the Games and
   Finished Games sheets, which is the honest test; without challenges.js loaded the
   Completed flag is all there is, and it is what every other page here reads. */
const planDone = (row) => (typeof chBeaten === "function" ? chBeaten(row) : !!(row && row.completed));
const planStarted = (row) => !!(row && (row.dateStarted || row.playingStatus));

// The next thing to play in a lane: the first entry that isn't finished. What the lane's
// eyebrow points at, and the reason the order is worth keeping at all.
const planNext = (trackId) => planQueue(trackId).find((e) => !planDone(e.row)) || null;

/* ---- editing the queue --------------------------------------------------
   Every one of these writes the pref and re-renders. None of them calls nav(): a plan is
   a pref rather than a URL param (the same call rng.js's pins make), and pushing a
   history entry per reorder would make Back a button that un-shuffles your list one step
   at a time. */

/* Add to the end of a lane, defaulting to the lane the game classifies into. A game
   already in the plan MOVES rather than being added twice — which is also how a game
   gets from one lane to another, so planSetTrack is this function under another name. */
function planAdd(key, trackId) {
  if (!key) return;
  const row = rngRowByKey(key);
  const track = trackId || (row && planTrackOf(row)) || planTrackIds()[0];
  if (!planTrack(track)) return;
  const rest = planList().filter((p) => p && p.key !== key);
  if (rest.filter((p) => p.track === track).length >= PLAN_MAX_TRACK) {
    if (typeof showToast === "function")
      showToast(`That lane holds ${PLAN_MAX_TRACK} games — finish or drop one first`, "i-alert");
    return;
  }
  planSaveList([...rest, { track, key }]);
  renderPlan();
}

const planSetTrack = (key, trackId) => planAdd(key, trackId);

function planRemove(key) {
  planSaveList(planList().filter((p) => p && p.key !== key));
  renderPlan();
}

/* Move one game up or down WITHIN its lane. The stored list is flat and interleaved, so
   the swap is done on the lane's own order and the lane is then written back in place of
   its old entries — which keeps the other two lanes exactly as they were, including
   their positions in the flat array. Swapping the flat neighbours instead would have
   moved a game past a game in a different lane, i.e. nowhere at all. */
function planMove(key, delta) {
  const list = planList().filter((p) => p && p.key);
  const me = list.find((p) => p.key === key);
  if (!me) return;
  const lane = list.filter((p) => p.track === me.track);
  const i = lane.findIndex((p) => p.key === key);
  const j = i + delta;
  if (j < 0 || j >= lane.length) return;
  [lane[i], lane[j]] = [lane[j], lane[i]];
  // Rebuild the flat list by handing each slot of this lane its new occupant in order.
  const feed = lane[Symbol.iterator]();
  planSaveList(list.map((p) => (p.track === me.track ? feed.next().value : p)));
  renderPlan();
}

// Clear the finished games out of a lane (or out of the whole plan with no lane given).
// A press, because the alternative is a queue that silently forgets what you achieved.
function planClearDone(trackId) {
  const gone = new Set(planEntries()
    .filter((e) => planDone(e.row) && (!trackId || e.track === trackId))
    .map((e) => e.key));
  if (!gone.size) return;
  planSaveList(planList().filter((p) => p && !gone.has(p.key)));
  renderPlan();
}

/* ---- the signals you choose on -------------------------------------------
   The whole reason this page exists rather than being a notes app. Three questions about
   a candidate, all of them answered by data that already lives somewhere in this app and
   none of them answered twice. */

/* Theme slates this game is on, by theme name.

   Read straight out of the saved event state rather than through thmRun(), deliberately:
   thmRun REPAIRS and CREATES a run on demand (it widens n, prunes orphan pins, writes a
   blank run for a theme you've never opened), and a read on a render path has no business
   writing state for all 40-odd themes just to ask whether a key is in a list. */
function planThemeHits(key) {
  if (!key || typeof THEMES === "undefined" || typeof evState !== "function") return [];
  const runs = (evState("themes") || {}).runs || {};
  const out = [];
  for (const t of THEMES) {
    const run = runs[t.id];
    if (run && Array.isArray(run.slate) && run.slate.includes(key)) out.push(t.name);
  }
  return out;
}

/* Challenge buckets beating this game would clear, and the scarcest of them.

   chWouldClear's own sort already puts the scarcest bucket first (fewest other unplayed
   candidates, then the challenge nearest its finish), so `top` is just its head — the
   ranking judgement stays in challenges.js, where it is explained. `only` is the line
   worth reading: nothing else in the library can clear that bucket.

   Memoised per row like chClearCount is, and for the same reason: the candidate sort asks
   most of the pool this question and a comparison sort asks each row many times over.
   Dropped when enrichment moves, since unified genres, franchises and developers all feed
   the bucket maps. */
let _planClear = new WeakMap(), _planClearEpoch = -1;
function planClears(row) {
  if (typeof chWouldClear !== "function") return { buckets: 0, challenges: 0, top: null, only: false };
  if (_planClearEpoch !== _enrichEpoch) { _planClearEpoch = _enrichEpoch; _planClear = new WeakMap(); }
  const hit = _planClear.get(row);
  if (hit) return hit;
  const hits = chWouldClear(row);
  const v = {
    buckets: hits.length,
    challenges: new Set(hits.map((h) => h.c.id)).size,
    top: hits.length ? { key: hits[0].key, name: hits[0].c.name, rivals: hits[0].rivals } : null,
    only: hits.some((h) => !h.rivals),
  };
  _planClear.set(row, v);
  return v;
}

// How crowded this game's scarcest bucket is: the number of OTHER unplayed candidates
// that could clear it too. Infinity when it clears nothing, so "scarcest first" puts the
// games that clear nothing last instead of mixing them in.
const planRivals = (row) => {
  const top = planClears(row).top;
  return top ? top.rivals : Infinity;
};

/* Everything the cards and rows show about one game, in one call so a renderer never has
   to know which module each answer came from. `clears` is the expensive one and is left
   out unless asked for — the queues are short and always want it, the candidate list has
   thousands of rows and only wants it for the page on screen (or when you sort by it). */
function planSignals(row, { clears = true } = {}) {
  return {
    row,
    done: planDone(row),
    started: planStarted(row),
    status: String((row && row.playingStatus) || ""),
    themes: planThemeHits(row && row._k),
    clears: clears ? planClears(row) : null,
  };
}

/* ---- choosing: the candidate pool ---------------------------------------
   pickEligible() is the backlog, playable and unfinished — the same floor the picker and
   the roller stand on. Two of RNG's four house rules are kept and two are dropped, and
   the difference is the difference between rolling and choosing:

     KEPT  — "Will Not Play" priority, and DLC. Neither is a game you queue: the first you
             have already ruled out by hand, and the second needs the game it expands.
     DROPPED — the series-order rule and the language rule. Those exist because a ROLL
             cannot explain itself: handed Dragon Age 2 at random you'd have to work out
             why. Choosing is the opposite — you can see the game, and a plan is exactly
             where "I'm going to play the first one, then this" gets written down. Hiding
             38 half-translated JRPGs and every unfinished-prequel sequel from a list you
             are reading with your eyes open would be the tab deciding for you. */
const planAllowed = (r) => !r.dlc && rngPriorityOk(r);

/* ---- state and the URL --------------------------------------------------
   The ORDER is a pref; everything on this line is a view, so it rides in the URL and a
   link carries the list you were actually looking at. `track` is which lane's chooser is
   open, null for none — the queues are always all three on screen.

   `page` is deliberately not in the URL: it is a position in a list that the filter and
   the sort both rewrite, and a link to page 7 of a list someone else's library doesn't
   have is a link to nothing. */
const planState = { track: null, q: "", sort: "fit", filter: "all", page: 1 };

const PLAN_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "upnext", label: "Up next & on hold", hint: "What the sheet's Status cell already says you meant to play" },
  { id: "clears", label: "Clears a bucket", hint: "Beating it knocks out at least one unclaimed challenge bucket" },
  { id: "only", label: "Only game that clears", hint: "A bucket no other unplayed game in the library can clear" },
  { id: "slate", label: "On a theme slate", hint: "Already rolled onto one of the Themes slates" },
];
const PLAN_SORTS = [
  { id: "fit", label: "Priority" },
  { id: "clears", label: "Buckets cleared" },
  { id: "short", label: "Shortest first" },
  { id: "newest", label: "Newest first" },
  { id: "title", label: "A–Z" },
];
// The two that have to ask every candidate what it would clear. Named so the UI can say
// so before you press it, rather than appearing to hang.
const PLAN_HEAVY = new Set(["clears", "only"]);
const planIsHeavy = () => PLAN_HEAVY.has(planState.filter) || planState.sort === "clears";

const PLAN_STATUS_PLANNED = new Set(["Up Next", "On Hold"]);

/* The lane's candidates: eligible, allowed, in this lane, not already planned, matching
   the search box and the filter, in the chosen order.

   Memoised on everything that can change the answer — the sheet, the enrichment epoch,
   the plan itself, and the three controls — because the candidate list is re-derived on
   every render and the heavy filters walk every challenge over every row. */
let _planCand = null, _planCandSig = null, _planCandFor = null;
// The fallback order for a sort id nothing recognises: by name, which is the only order
// that needs no data at all.
const planCmpTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""));
/* A lane's pool before the search box, filter and sort touch it: eligible, allowed, in
   this lane, not already planned. Its own memo because it is the expensive part —
   deciding a lane runs rngTier over every unfinished game in the sheet, which is most of
   what a keystroke cost when the whole list was rebuilt per query. Nothing typed changes
   it; only the sheet, enrichment, and the plan itself do. Each row carries its search
   text, lowercased once, so a keystroke is a substring test per row and nothing more. */
let _planBase = new Map(), _planBaseSig = null;
function planLanePool(trackId) {
  const planned = planKeys();
  const sig = [_enrichEpoch, [...planned].sort().join("\u001e")].join("\u001f");
  if (_planBaseSig !== sig || _planBase.for !== DATA) {
    _planBase = new Map(); _planBase.for = DATA; _planBaseSig = sig;
  }
  let pool = _planBase.get(trackId);
  if (!pool) {
    pool = pickEligible()
      .filter((r) => planAllowed(r) && !planned.has(r._k) && planTrackOf(r) === trackId)
      .map((r) => ({ r, text: `${r.title || ""}\u0000${r.platform || ""}`.toLowerCase() }));
    _planBase.set(trackId, pool);
  }
  return pool;
}

function planCandidates(trackId) {
  const sig = [trackId, planState.q, planState.filter, planState.sort,
    _enrichEpoch, planList().length, planKeys().size].join("\u001f");
  if (_planCand && _planCandSig === sig && _planCandFor === DATA) return _planCand;
  const q = planState.q.trim().toLowerCase();
  let rows = planLanePool(trackId)
    .filter((e) => !q || e.text.includes(q))
    .map((e) => e.r);
  rows = rows.filter((r) => {
    switch (planState.filter) {
      case "upnext": return PLAN_STATUS_PLANNED.has(String(r.playingStatus || ""));
      case "clears": return planClears(r).buckets > 0;
      case "only": return planClears(r).only;
      case "slate": return planThemeHits(r._k).length > 0;
      default: return true;
    }
  });
  const title = (r) => String(r.title || "");
  const rating = (r) => (typeof combinedRating === "function" ? combinedRating(r) : null);
  const cmp = {
    // Your own ranking of the backlog first, then what everyone thinks of it. The default,
    // because it is the only sort that costs nothing and still reads as a shortlist.
    fit: (a, b) => priorityRank(b.priority) - priorityRank(a.priority)
      || (rating(b) ?? -1) - (rating(a) ?? -1) || title(a).localeCompare(title(b)),
    /* Most buckets first, then the scarcest bucket — two games that each clear one are
       not equal if nothing else in the library can clear one of them. A game that clears
       nothing has no scarcest bucket, so it sorts as infinitely crowded rather than as
       NaN, which a comparator must never return. */
    clears: (a, b) => planClears(b).buckets - planClears(a).buckets
      || planRivals(a) - planRivals(b)
      || title(a).localeCompare(title(b)),
    // A game with no known length sinks rather than sorting as zero hours — "unknown" is
    // not "short", and an unknown at the top of a "shortest first" list is a lie.
    short: (a, b) => (playtimeOf(a) ?? Infinity) - (playtimeOf(b) ?? Infinity)
      || title(a).localeCompare(title(b)),
    newest: (a, b) => rngYear(b) - rngYear(a) || title(a).localeCompare(title(b)),
    title: (a, b) => title(a).localeCompare(title(b)),
  }[planState.sort] || planCmpTitle;
  rows.sort(cmp);
  _planCandFor = DATA; _planCandSig = sig;
  return (_planCand = rows);
}

/* ---- are the three lanes exhaustive? ------------------------------------
   The claim the page makes out loud, with the arithmetic beside it. Every row on the
   games sheet is counted into exactly one lane, or into `unplaced` when the era line
   cannot be drawn for it (planTrackOf). unplaced is listed, not
   swallowed: a lane is assignable by hand, so a game that cannot be classified is still
   a game you can queue.

   Keyed on the sheet and the enrichment epoch, like every other count in this app: the
   era reads IGDB's first release year and the tier reads its publishers and genres, so
   this genuinely moves as batches land. */
let _planCov = null, _planCovFor = null, _planCovEpoch = null;
function planCoverage() {
  if (_planCov && _planCovFor === DATA && _planCovEpoch === _enrichEpoch) return _planCov;
  const out = { total: 0, by: {}, unplaced: [] };
  for (const id of planTrackIds()) out.by[id] = 0;
  for (const r of ((DATA.sheets.games || {}).rows || [])) {
    if (!r.title) continue;
    out.total++;
    const id = planTrackOf(r);
    if (id && id in out.by) out.by[id]++;
    else out.unplaced.push(r);
  }
  _planCovFor = DATA; _planCovEpoch = _enrichEpoch;
  return (_planCov = out);
}

const planStateFromURL = (p) => {
  const t = p.get("pt");
  planState.track = planTrack(t) ? t : null;
  planState.q = p.get("pq") || "";
  planState.sort = PLAN_SORTS.some((s) => s.id === p.get("psort")) ? p.get("psort") : "fit";
  planState.filter = PLAN_FILTERS.some((f) => f.id === p.get("pf")) ? p.get("pf") : "all";
  planState.page = 1;
};

const planStateToURL = (p) => {
  if (planState.track) p.set("pt", planState.track);
  if (planState.q) p.set("pq", planState.q);
  if (planState.sort !== "fit") p.set("psort", planState.sort);
  if (planState.filter !== "all") p.set("pf", planState.filter);
};

/* Open or close a lane's chooser. Opening one closes the others: three candidate lists at
   once is three thousand-row lists at once, and the choice being made is about one lane.

   Every open starts clean — search, filter, sort and page all reset. They are one set of
   controls on one chooser, and a chooser belongs to its lane: "zelda" typed into Modern
   indie, or "Clears a bucket" picked there, is a question about that lane, and carrying it
   into Retro answered a question nobody asked of Retro. Closing resets too, so coming back
   to the same lane later starts from the whole list rather than from where you left off. */
function planOpen(trackId) {
  planState.track = planState.track === trackId ? null : trackId;
  planState.q = ""; planState.filter = "all"; planState.sort = "fit"; planState.page = 1;
  renderPlan();
  nav();
}

/* Typing repaints the results and nothing else (renderPlanResults), and REPLACES the URL
   rather than pushing one: a history entry per keystroke made Back a key that deleted the
   last letter. The query still rides in the link, so a shared or reloaded URL keeps it. */
function planSetQuery(q) {
  if (planState.q === q) return;
  planState.q = q;
  planState.page = 1;
  renderPlanResults();
  syncURL(false);
}

function planSetSort(id) {
  if (!PLAN_SORTS.some((s) => s.id === id) || planState.sort === id) return;
  planState.sort = id;
  planState.page = 1;
  renderPlan();
  nav();
}

function planSetFilter(id) {
  if (!PLAN_FILTERS.some((f) => f.id === id) || planState.filter === id) return;
  planState.filter = id;
  planState.page = 1;
  renderPlan();
  nav();
}

/* Mid-load, for rng.js's reason restated: which lane a game falls in reads IGDB's first
   release year, its publishers and its genres, and what it would clear reads the
   unified genres and franchises — all of it in the bulk enrichment map. Before that map
   lands every lane is empty, and three empty lanes saying "nothing here" while the app is
   still reading is not an empty plan, it is a lie. So the page shimmers instead, and
   loadAllEnrichment re-renders it on arrival (panels.js). */
const planLoading = () =>
  typeof ENRICH_ENABLED !== "undefined" && ENRICH_ENABLED && !ENRICH_READY;

/* ---- enrichment arriving --------------------------------------------------
   Two hooks, for the two ways the map lands.

   The BULK map releases the skeleton (panels.js): before it there are no lanes, because
   the era line reads IGDB's first release year.

   A per-game BATCH (enrich.js) fills in a cover and a time to beat. Those arrive every
   couple of seconds while the library backfills, and re-rendering on each one would
   repaint the tab on a loop — so, like pick.js's pickShowsKey, it only repaints when the
   batch actually touched something on screen.

   And never a FULL repaint while you are typing in the chooser's search box: that would
   replace the input mid-word. The results region is repainted instead, which is where a
   batch for a candidate on screen lands anyway; the queues catch up on the next render. */
const planShowsKey = (k) => {
  if (activeTab !== "plan" || !k) return false;
  return !!document.querySelector(`#plan [data-pk="${CSS.escape(k)}"]`);
};

function planEnrichLanded() {
  if (activeTab !== "plan") return;
  const el = document.activeElement;
  if (el && el.id === "planQ") { renderPlanResults(); return; }
  renderPlan();
}

/* Landing state (core.js): a deliberate click on Plan opens all three queues with no
   chooser and no filter. The QUEUES are not reset — they're the pref, and the whole point
   of the tab. Only the view is. */
TAB_RESET.plan = () => {
  planState.track = null; planState.q = ""; planState.sort = "fit";
  planState.filter = "all"; planState.page = 1;
};
