"use strict";

/* ---- "Pick my next game" ------------------------------------------------
   This was ~45 hand-written selectors, one per idea, which works right up until
   you want an idea nobody hand-wrote — "co-op, on the Switch, under 10 hours,
   not a shooter". So the selectors are a starting point now rather than the whole
   vocabulary: each one EXPANDS into criteria you can see and edit (see PRESETS),
   and the + button builds the ones nobody thought of.

   A criterion is a facet field plus the values you ticked, which is the same
   shape the sidebar filters have always had — so the builder inherits the grid's
   entire vocabulary for free: sheet columns, IGDB (themes, keywords, perspective),
   and the constructed facets (predicted rating, playtime, sales). See pickFields(). */
const pickState = { filter: null, preset: "backlog", picked: null };
let _completedFranchises = null;
const completedFranchises = () => (_completedFranchises ||=
  new Set(((DATA.sheets.completed || {}).rows || []).flatMap((r) => unifiedFranchiseVals(r))));
const pickYear = () => new Date().getFullYear();

// The month/day you were born. Read from the sheet's own data would be nice, but
// there's nowhere to put it — so it's a setting, remembered per browser.
const BIRTHDAY_KEY = "gamedex.birthday";
const birthday = () => localStorage.getItem(BIRTHDAY_KEY) || "";     // "MM-DD"

// The dice-roll reveal between "Pick for me" and the card. On by default; the
// checkbox in the controls row writes "0" to turn it off, per browser — same
// shape as the birthday and theme settings. Reduced-motion always wins.
const PICK_ANIM_KEY = "gamedex.pickAnim";
const pickAnimOn = () => localStorage.getItem(PICK_ANIM_KEY) !== "0";
const pickReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const alphaOnly = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isPalindrome = (t) => {
  const a = alphaOnly(t);
  return a.length >= 5 && a === [...a].reverse().join("");
};
// "Obscure" = nobody has rated it anywhere. Not bad, not unknown to YOU — unknown
// to everyone, which is a different and more interesting thing.
const isObscure = (r) => {
  const e = ENRICH[r._k] || {};
  return metacriticOf(r) == null && userRatingOf(r) == null && salesOf(r) == null && !e.igdbId;
};

/* ---- the field registry -------------------------------------------------
   Everything the builder can filter on. Most of it is just the Games tab's own
   facets; the rest is defined here because it only makes sense against a backlog
   you're choosing FROM ("never started", "released on my birthday").

   Fields are facet columns, exactly — {key, label, kind, getVals|getVal|buckets} —
   so rowFacetItems() reads them and no second matching path exists. */

// Numeric fields have no list to tick: nobody wants to scroll 300 distinct prices.
// So cut the values the library actually HAS into a few ranges at round numbers.
// Data-derived rather than hard-coded, because a $60 bucket means nothing to a
// collection of $8 eBay lots.
const NICE_STEPS = [1, 2, 2.5, 5, 10];
function niceNum(v) {
  if (!(v > 0)) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const step = NICE_STEPS.find((s) => v / mag <= s) ?? 10;
  return step * mag;
}
function autoBuckets(vals, fmt, n = 5) {
  const xs = vals.filter((v) => typeof v === "number" && isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return [];
  const out = [];
  // Free is a category, not a range — "$0" and "cheap" are different thoughts.
  const hasZero = xs[0] === 0;
  if (hasZero) out.push({ label: "Free", test: (v) => v === 0 });
  const pos = hasZero ? xs.filter((v) => v > 0) : xs;
  if (!pos.length) return out;
  const max = pos[pos.length - 1];
  const above = (v) => (hasZero ? v > 0 : true);
  // Quantile cuts snapped to round numbers. A lumpy distribution can snap two
  // cuts onto the same number, hence the dedupe.
  const cuts = [];
  for (let i = 1; i < n; i++) {
    const c = niceNum(pos[Math.floor((pos.length - 1) * i / n)]);
    if (c > 0 && c < max && !cuts.includes(c)) cuts.push(c);
  }
  if (!cuts.length) return [...out, { label: `${fmt(pos[0])}–${fmt(max)}`, test: above }];
  cuts.forEach((c, i) => {
    const lo = i ? cuts[i - 1] : null;
    out.push(lo == null
      ? { label: `< ${fmt(c)}`, test: (v) => above(v) && v < c }
      : { label: `${fmt(lo)}–${fmt(c)}`, test: (v) => v >= lo && v < c });
  });
  const last = cuts[cuts.length - 1];
  out.push({ label: `${fmt(last)}+`, test: (v) => v >= last });
  return out;
}

/* Dates and eras answer "how long has this been sitting there" / "how old is it",
   and the honest answer overlaps: a game added last week was also added this year.
   These are multi-valued tag fields rather than buckets for exactly that reason —
   tick "Last year" and you get everything inside a year, which is what you meant. */
const DAY_MS = 864e5;
function recencyTags(v) {
  if (!v) return [];
  const t = Date.parse(v);
  if (isNaN(t)) return [];
  const d = (Date.now() - t) / DAY_MS;
  const out = [];
  if (d <= 30) out.push("Last 30 days");
  if (d <= 90) out.push("Last 3 months");
  if (d <= 365) out.push("Last year");
  if (d > 365) out.push("Over a year ago");
  if (d > 365 * 3) out.push("Over 3 years ago");
  return out;
}
function eraTags(r) {
  const y = +r.releaseYear;
  if (!y) return [];
  const now = pickYear(), out = [];
  if (y === now) out.push("This year");
  if (y >= now - 3) out.push("Last 3 years");
  if (y < 2000) out.push("Retro (pre-2000)");
  out.push(y < 1980 ? "Pre-1980" : `${Math.floor(y / 10) * 10}s`);
  return out;
}

// Was it ever picked up, and did it get put down? "Never started" is not a sheet
// column — it's the absence of three of them.
function backlogTags(r) {
  const out = [];
  if (!r.dateStarted && !r.playingStatus) out.push("Never started");
  if (r.dateStarted && !r.completed) out.push("Started but unfinished");
  return out;
}
/* Co-op lived in two places — Co-Optimus' verified numbers under "For the hell of
   it", IGDB's game modes under "Play style" — which meant two answers to one
   question. IGDB's modes are already a facet (Game Mode), so this field is only
   what Co-Optimus knows that IGDB doesn't: how MANY, and how. */
function coopTags(r) {
  const e = ENRICH[r._k] || {};
  const out = [];
  if (e.coopLocal > 1) out.push("Local / couch");
  if (e.coopOnline > 1) out.push("Online");
  if (e.coopSplit) out.push("Split screen");
  if (e.coopCampaign) out.push("Full campaign");
  if (e.coopDropIn) out.push("Drop-in / drop-out");
  return out;
}
function franchiseTags(r) {
  const vals = unifiedFranchiseVals(r);
  if (!vals.length) return [];
  return [vals.some((f) => completedFranchises().has(f)) ? "Continues one I've played" : "New to me"];
}
function titleShapeTags(r) {
  const t = String(r.title || "");
  const out = [];
  if (isPalindrome(t)) out.push("Palindrome");
  if (t.trim().split(/\s+/).length === 1) out.push("One word");
  if (t.length > 45) out.push("Absurdly long");
  return out;
}
function birthdayTags(r) {
  const b = birthday();
  return b && typeof r.releaseDate === "string" && r.releaseDate.slice(5, 10) === b
    ? ["Released on my birthday"] : [];
}

/* "I have 45 minutes." A game qualifies if you could plausibly FINISH it in the time
   you've got — HLTB's main-story number where we have it, the sheet's estimate
   otherwise.

   This was a select sitting outside the builder that quietly ANDed itself onto whatever
   the chips said, which made it the one filter you could not see in the chip row, could
   not negate, and could not put inside an OR. It's a field like any other now; the
   select above the builder is a shortcut that writes it (see pickSetBudget).

   Multi-valued, for the reason the date fields are: a 20-minute game is finishable in
   half an hour AND in an evening, so ticking "2 hours" has to offer it. A bucket ladder
   would file it under exactly one rung and answer a question nobody asked. */
const TIME_BUDGETS = [
  { m: 30, label: "30 minutes" }, { m: 45, label: "45 minutes" }, { m: 60, label: "1 hour" },
  { m: 120, label: "2 hours" }, { m: 300, label: "5 hours" }, { m: 600, label: "10 hours" },
];
// Unknown playtime is not "short" — nothing knows how long it is, so it can't promise to
// fit in your evening and doesn't claim to. (Which also keeps catalogue rows out: a game
// you don't own has no HLTB match and no estimate on the sheet.)
function budgetTags(r) {
  const t = playtimeOf(r);
  return t == null ? [] : TIME_BUDGETS.filter((b) => t <= b.m / 60).map((b) => b.label);
}

/* What Pick is allowed to offer you.
 *
 * The backlog, plus — once the catalogue has been fetched — the 25k games IGDB knows that
 * your sheet doesn't. The "In the sheet" field defaults to "On the sheet" (see
 * PICK_DEFAULT_SHEET), so this pool is a superset that behaves exactly like the old one
 * until you deliberately widen it: Pick still answers "what do I play tonight" out of the
 * box, and a game you don't own can't be tonight's answer.
 *
 * The catalogue half is NOT fetched here. pickEligible() runs on every render and every
 * keystroke in the builder; 2.2MB is not something to trigger from a hot path. renderPicker
 * asks for it once, in the background, and this picks it up when it lands.
 *
 * Not the unplayable, and not the unknowns. "Playable" is tri-state on the sheet — Yes, No,
 * Unknown — and a picker that lands on a game you can't start (no console for it any more,
 * region-locked, disc rot) has answered the wrong question. Unknown goes too: it doesn't
 * mean "probably fine", it means nobody has checked, and being sent to go and check is not
 * a pick. It's the rule challenges.js already plays by, and the one health.js has been
 * telling people the picker follows.
 *
 * Catalogue rows are exempt because the question doesn't reach them: playability is a fact
 * about YOUR copy, and the whole point of a catalogue row is that you don't have one. */
const pickEligible = () => [
  ...((DATA.sheets.games || {}).rows || []).filter((r) => !r.completed && r.title && r.playable === "Yes"),
  ...(typeof catFresh === "function" ? catFresh() : []),
];

// The pool is the backlog, so a Completed facet would offer one value ("No") — and
// pickEligible has already answered Playable, so that one would offer "Yes".
const PICK_SKIP_FIELDS = new Set(["completed", "playable"]);
// The two answers the "In the sheet" field gives. Named once: applyPreset seeds one of
// them into every preset, and a typo would silently seed a criterion nothing matches —
// an empty pool with no error, which is the worst way for this to break.
const PICK_ON_SHEET = "On the sheet";
const PICK_NOT_SHEET = "Not on the sheet";
let _pickCatAsked = false;      // renderPicker fetches the catalogue once, in the background
// Sheet and IGDB facets arrive with no grouping of their own; the builder's field
// list is 40-odd entries and unusable as one flat list.
const PICK_FIELD_GROUP = {
  platform: "The basics", genre: "The basics", franchise: "The basics",
  developer: "The basics", publisher: "The basics", releaseRegion: "The basics",
  releaseYear: "Era", __pk_era: "Era",
  playingStatus: "Status", priority: "Status", __pk_backlog: "Status",
  __playtime: "Time & ratings", __metacritic: "Time & ratings", __userrating: "Time & ratings",
  __predicted: "Time & ratings", __steamrev: "Time & ratings", __sales: "Time & ratings",
  __pk_budget: "Time & ratings",
  __igdb_mode: "Play style", __igdb_persp: "Play style", vr: "Play style", dlc: "Play style",
  english: "Play style", __pk_coop: "Play style",
  __igdb_theme: "The basics", __igdb_kw: "The basics",
  owned: "Ownership & price", format: "Ownership & price", wishlisted: "Ownership & price",
  digitalPlatform: "Ownership & price", subscription: "Ownership & price",
  limitedPrint: "Ownership & price",
};
const pickFieldGroup = (c) => PICK_FIELD_GROUP[c.key] || c.group || "More";
const PICK_GROUP_ORDER = ["The basics", "Status", "Time & ratings", "Play style", "Era",
                          "Ownership & price", "Progress", "For the hell of it", "More"];

function pickExtraFields() {
  const rows = pickEligible();
  return [
    /* On the sheet, or not? Pick-only, and it has to be: on the Games tab every row is on
       the sheet by definition, so this would be a facet with one value and a dead end.
       Here it is the whole point — the pool reaches past the spreadsheet into the IGDB
       catalogue, and this is the line between "play tonight" and "maybe buy this".
       type:"text" with words rather than type:"bool", following __nas and every other
       computed facet: "bool" is reserved for a column the spreadsheet really has, whose
       values are literally "true"/"false" (and which chip rendering special-cases). */
    { key: "__pk_sheet", label: "In the sheet", group: "Status", kind: "fn",
      getVals: (r) => [r._cat ? PICK_NOT_SHEET : PICK_ON_SHEET] },
    { key: "__pk_backlog", label: "Backlog status", kind: "fn", getVals: backlogTags,
      vorder: orderBy(["Never started", "Started but unfinished"]) },
    { key: "__pk_budget", label: "Finishable in", kind: "fn", getVals: budgetTags,
      vorder: orderBy(TIME_BUDGETS.map((b) => b.label)) },
    /* Recency first, then decades newest to oldest, then the two catch-alls. eraTags
       makes decade labels on the fly ("1990s"), so they can't be listed — they're ranked
       by the number in them, which lands them between the head and the tail. */
    { key: "__pk_era", label: "Era", kind: "fn", getVals: eraTags,
      vorder: (k) => {
        if (k === "This year") return 0;
        if (k === "Last 3 years") return 1;
        const d = /^(\d{4})s$/.exec(k);
        if (d) return 500 - Number(d[1]) / 10;
        if (k === "Retro (pre-2000)") return 900;
        if (k === "Pre-1980") return 901;
        return 1e6;
      } },
    { key: "__pk_coop", label: "Co-op (Co-Optimus)", kind: "fn", getVals: coopTags,
      vorder: orderBy(["Local / couch", "Split screen", "Online", "Drop-in / drop-out", "Full campaign"]) },
    { key: "__pk_added", label: "Added", group: "Ownership & price", kind: "fn",
      getVals: (r) => recencyTags(r.dateAdded), vorder: orderBy(["Last 30 days", "Last 3 months", "Last year", "Over a year ago", "Over 3 years ago"]) },
    { key: "__pk_bought", label: "Purchased", group: "Ownership & price", kind: "fn",
      getVals: (r) => recencyTags(r.datePurchased), vorder: orderBy(["Last 30 days", "Last 3 months", "Last year", "Over a year ago", "Over 3 years ago"]) },
    { key: "__pk_price", label: "Purchase price", group: "Ownership & price", kind: "bucket",
      buckets: autoBuckets(rows.map((r) => r.purchasePrice), usd), getVal: (r) => r.purchasePrice },
    { key: "__pk_value", label: "Market value", group: "Ownership & price", kind: "bucket",
      buckets: autoBuckets(rows.map((r) => collectionValueOf(r)), usd), getVal: collectionValueOf },
    { key: "__pk_franchise", label: "Franchise", group: "Progress", kind: "fn", getVals: franchiseTags },
    { key: "__pk_title", label: "Title shape", group: "For the hell of it", kind: "fn", getVals: titleShapeTags },
    { key: "__pk_obscure", label: "Obscurity", group: "For the hell of it", kind: "fn",
      getVals: (r) => (isObscure(r) ? ["Nobody has heard of it"] : []) },
    { key: "__pk_bday", label: "My birthday", group: "For the hell of it", kind: "fn", getVals: birthdayTags },
    /* isCandidate (challenges.js) as a criterion. Pick's pool is deliberately looser —
       it allows low-priority, unreleased and catalogue games you don't own — so a bucket
       handed over from Challenges has to be able to say "and it would really count". */
    { key: "__pk_candidate", label: "Challenge candidate", group: "Progress", kind: "fn",
      getVals: (r) => (typeof isCandidate === "function" && isCandidate(r) ? ["Yes"] : ["No"]) },
    // An empty ladder means the column is empty too — offering it would be a dead end.
  ].filter((f) => f.kind !== "bucket" || f.buckets.length);
}

/* Rebuilt when the sheet reloads or the last enrichment source lands, because the
   auto-bucketed fields read values that only exist once enrichment has answered.
   Not cached harder than that: everything else here is cheap, and a stale field
   list would quietly filter on numbers that no longer exist. */
let _pickFields = null, _pickFieldsFor = null, _pickFieldsDone = null;
function pickFields() {
  if (_pickFields && _pickFieldsFor === DATA && _pickFieldsDone === ENRICH_COMPLETE) return _pickFields;
  _pickFieldsFor = DATA;
  _pickFieldsDone = ENRICH_COMPLETE;
  const all = [...gamesFacetCols().filter((c) => !PICK_SKIP_FIELDS.has(c.key)), ...pickExtraFields()];
  return (_pickFields = all.map((c) => ({ ...c, group: pickFieldGroup(c) })));
}
/* A grouping key ("dateAdded|month") isn't in the field list — groupings are composed on
   demand (challenges.js), so there is no finite list to enumerate. It still has to RESOLVE
   though: "pick me one" hands over a tree whose leaf names one, and compilePick has to be
   able to answer it. Fall through to the composer rather than widening the catalogue, so
   the field picker keeps offering fields and not every field × every transform. */
const pickFieldByKey = (k) =>
  pickFields().find((f) => f.key === k) ||
  (typeof chGroupCol === "function" ? chGroupCol(k) : null);

/* ---- the filter tree ----------------------------------------------------
   A group is {op:"and"|"or", not, kids}; a criterion is {key, vals, not}. Groups
   nest, which is the whole point of having OR at all — "(co-op or multiplayer)
   and under 10 hours" is unsayable with one flat list of ANDs. */
const pickGroup = (op = "and", kids = []) => ({ op, not: false, kids });
const pickCond = (key, vals = []) => ({ key, vals, not: false });
const isPickGroup = (n) => !!n && Array.isArray(n.kids);
/* ---- builder context ----------------------------------------------------
   The builder renders and edits ONE tree. Which tree, where it paints, and what to do
   after an edit are the only things that differ between the Pick tab and the challenge
   editor — so those are the context and everything else is shared. Without this the
   builder reached straight into pickState.filter, which is why a challenge couldn't
   borrow it and grew a second, weaker filter UI of its own.

   Module-level rather than threaded through every handler: only one builder is ever on
   screen (they live on different tabs), and each render sets the context it wants. */
const PICK_TAB_BUILDER = {
  sel: "#pickBuilder",
  emptyHint: "every game in the backlog is in play",
  root: () => pickState.filter,
  // What the value counts in the popover are counted over.
  pool: () => pickEligible(),
  changed: () => pickEdited(),
  repaint: () => renderPicker(),
  sync: (replace) => (replace ? syncURL(false) : nav()),
};
let pkb = PICK_TAB_BUILDER;
const pkbUse = (ctx) => { pkb = ctx || PICK_TAB_BUILDER; };
const pkbHost = () => $(pkb.sel);
// Is a builder actually painted right now? Guards the document-level popover listeners,
// which used to ask "is the Pick tab active" — true of only one of the two builders.
const pkbOnScreen = () => !!pkbHost();
const pickNodeAt = (path) => path.reduce((n, i) => n.kids[i], pkb.root());
const pickPath = (s) => (s ? s.split(".").map(Number) : []);

/* The tree, in a link. Every other bit of URL state here is flat (`f.platform=PS2~GC`)
   and a tree isn't, so it gets JSON — inventing a grammar to save forty characters
   in a string nobody types by hand is not a trade worth making. Short keys only
   because the thing nests. */
const pickPack = (n) => isPickGroup(n)
  ? { o: n.op === "or" ? 1 : 0, n: n.not ? 1 : 0, k: n.kids.map(pickPack) }
  : { f: n.key, v: n.vals || [], n: n.not ? 1 : 0 };
const pickEncode = (n) => JSON.stringify(pickPack(n));
function pickDecode(s) {
  try {
    const un = (x) => x.k
      ? { op: x.o ? "or" : "and", not: !!x.n, kids: x.k.map(un) }
      : { key: x.f, vals: Array.isArray(x.v) ? x.v : [], not: !!x.n };
    const t = un(JSON.parse(s));
    return isPickGroup(t) ? t : pickGroup("and", [t]);
  } catch (_) { return pickGroup(); }        // a mangled link shouldn't blank the tab
}

/* Compiled to a closure tree once per pass rather than walked per row: resolving
   a field by key for each of 14.7k rows is how you make a dice roll feel slow.
   `except` drops one node — that's how a criterion's own value list gets counted
   against everything BUT itself. */
function compilePick(node, except) {
  if (node === except) return () => true;
  if (isPickGroup(node)) {
    const kids = node.kids.map((k) => compilePick(k, except));
    // An empty group is a group you haven't filled in yet, not a wall. (It matters:
    // `some` over nothing is false, so an empty OR would match no games at all.)
    if (!kids.length) return () => true;
    const f = node.op === "or" ? (row) => kids.some((k) => k(row)) : (row) => kids.every((k) => k(row));
    return node.not ? (row) => !f(row) : f;
  }
  const col = pickFieldByKey(node.key);
  if (!col || !node.vals || !node.vals.length) return () => true;   // half-built: no-op
  const want = new Set(node.vals);
  const f = (row) => rowFacetItems(row, col).some((it) => want.has(it.key));
  return node.not ? (row) => !f(row) : f;
}

function pickPool(except) {
  // Seed here rather than trusting renderPicker to have run: compilePick(null) would
  // fall through to the criterion branch and deref `null.key`.
  if (!pickState.filter) pickState.filter = pickGroup();
  return pickEligible().filter(compilePick(pickState.filter, except));
}

// The pool the BUILDER counts its value lists over. Same thing on the Pick tab; on the
// challenge editor it's the whole library, because a challenge is cleared by games you've
// already finished and Pick's pool is backlog-only.
function pkbPool(except) {
  const root = pkb.root() || pickGroup();
  return (pkb.pool ? pkb.pool() : pickEligible()).filter(compilePick(root, except));
}

/* ---- the time budget, as seen by the select -----------------------------
   "I have an hour" is the question people arrive with, so it keeps its own control —
   but the control is a shortcut into the tree, not a second place where state lives.
   It reads the criteria back out and writes them in, and everything downstream only
   ever reads the tree.

   Only un-negated criteria sitting at the top level count. A budget nested inside an OR,
   or turned into "is not", is past what one select can honestly say — so it says "Any
   length" and leaves the chips to speak for themselves. */
const budgetKids = () =>
  pickState.filter.kids.filter((k) => !isPickGroup(k) && k.key === "__pk_budget" && !k.not);
// Two rungs ticked ("30 minutes" or "1 hour") mean the looser one — that IS what the
// union comes to — so the loosest is what the select shows.
function pickBudgetMinutes() {
  const ms = budgetKids().flatMap((k) => k.vals || [])
    .map((v) => (TIME_BUDGETS.find((b) => b.label === v) || {}).m).filter(Boolean);
  return ms.length ? Math.max(...ms) : 0;
}
function pickSetBudget(m) {
  // Rewritten in place, not appended: the select is one control saying one thing, so
  // choosing "2 hours" after "30 minutes" has to MOVE the chip rather than stack a
  // second one next to it and quietly intersect the two.
  const drop = new Set(budgetKids());
  const b = TIME_BUDGETS.find((x) => x.m === m);
  if (!drop.size && !b) return;      // "Any length" over no budget: nothing said, nothing edited
  pickState.filter.kids = pickState.filter.kids.filter((k) => !drop.has(k));
  if (b) pickState.filter.kids.push(pickCond("__pk_budget", [b.label]));
  pickEdited();
}
// Links from when the budget was its own control carry it as its own parameter
// (?mins=45). It's a criterion now, so translate rather than drop it on the floor: the
// link still means what it meant, and what it meant is now something you can see.
function pickAdoptMinutes(m) {
  if (m && TIME_BUDGETS.some((b) => b.m === m) && pickBudgetMinutes() !== m) pickSetBudget(m);
}
function pickGame(roll) {
  const pool = pickPool();
  pickState.picked = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  // The roll is a reveal, not a re-render: play it into the result slot and let it
  // call renderPicker() when the die lands. Anything that makes it not worth the wait —
  // an empty pool, the toggle off, a reduced-motion preference — falls straight through
  // to the instant card, which is also what every non-user caller of pickGame() gets.
  if (roll && pickState.picked && pickAnimOn() && !pickReduced()) playPickRoll(pickState.picked, pool);
  else renderPicker();
}

/* ---- the dice-roll reveal -----------------------------------------------
   A tumbling die over a slot-reel of covers that decelerates onto the winner, then
   hands off to renderPicker() so the real card pops in exactly as it does without the
   animation. It draws into #pickResult and touches nothing else, so the controls above
   it stay live; a roll token guards against a second click (or a preset change) landing
   an old roll on top of a new state. Covers are the real cover_small art — usually
   already cached from the grid — with a placeholder tile where a game has none. */
const PICK_PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// The rotation that brings each face to the camera, so the die lands showing a real value.
const PICK_FACE_ROT = { 1: [0, 0], 2: [0, -90], 3: [0, 180], 4: [0, 90], 5: [-90, 0], 6: [90, 0] };
let _pickRollN = 0;

function pickRollTile(row, win) {
  const rec = igdbRecOf(row);
  const cs = coverSrc(rec, "cover_small");
  const pixel = coverIsPixelArt(rec, cs) ? " pixel" : "";
  const inner = cs
    ? `<img src="${escapeHtml(cs)}" alt=""${pixel ? ` class="pixel"` : ""}>`
    : `<span class="roll-ph">${icon("i-library", 22)}</span>`;
  return `<div class="roll-tile${win ? " win" : ""}">${inner}</div>`;
}

function playPickRoll(picked, pool) {
  const host = $("#pickResult");
  if (!host) { renderPicker(); return; }
  const my = ++_pickRollN;
  const dur = 2100;

  // A strip that lands the winner near (not at) the end, so it scrolls IN rather than
  // starting under the frame. Everything else is drawn from the pool for real covers.
  const N = 44, LAND = 38;
  const others = pool.filter((r) => r !== picked);
  const draw = () => others.length ? others[Math.floor(Math.random() * others.length)] : picked;
  const seq = Array.from({ length: N }, (_, i) => (i === LAND ? picked : draw()));

  const die = [1, 2, 3, 4, 5, 6].map((f) => {
    const on = new Set(PICK_PIPS[f]);
    const pips = Array.from({ length: 9 }, (_, i) => `<i${on.has(i) ? "" : ' class="off"'}></i>`).join("");
    return `<div class="roll-face rf${f}">${pips}</div>`;
  }).join("");

  host.innerHTML = `<div class="pick-roll">
    <div class="roll-reel-mask">
      <div class="roll-reel" id="pickRollReel">${seq.map((r, i) => pickRollTile(r, i === LAND)).join("")}</div>
      <div class="roll-reel-hi" id="pickRollHi"></div>
    </div>
    <div class="roll-die-scene"><div class="roll-die" id="pickRollDie">${die}</div></div>
    <div class="roll-word" id="pickRollWord">Rolling…</div>
  </div>`;

  const reel = $("#pickRollReel");
  const winTile = reel.children[LAND];
  // offsetLeft folds in the gaps, so this centres the winner without hard-coding a tile width.
  const target = winTile.offsetLeft - reel.parentElement.clientWidth / 2 + winTile.offsetWidth / 2;
  reel.animate([
    { transform: "translateX(0)", filter: "blur(0)" },
    { transform: `translateX(${-target * 0.34}px)`, filter: "blur(7px)", offset: .4 },
    { transform: `translateX(${-target}px)`, filter: "blur(0)" },
  ], { duration: dur, easing: "cubic-bezier(.16,.8,.18,1)", fill: "forwards" });

  const [ex, ey] = PICK_FACE_ROT[1 + Math.floor(Math.random() * 6)];
  const spins = 4;
  $("#pickRollDie").animate([
    { transform: "translateZ(-31px) rotateX(0) rotateY(0)" },
    { transform: `translateZ(-31px) rotateX(${ex + 360 * spins}deg) rotateY(${ey + 360 * spins + 180}deg)` },
  ], { duration: dur, easing: "cubic-bezier(.15,.72,.2,1)", fill: "forwards" });

  // Light the frame just before the stop, then swap in the real card.
  setTimeout(() => {
    if (_pickRollN !== my) return;
    const hi = $("#pickRollHi"); if (hi) hi.classList.add("lit");
    const w = $("#pickRollWord"); if (w) w.textContent = "Locked in";
  }, dur * 0.82);
  setTimeout(() => {
    if (_pickRollN !== my || activeTab !== "pick") return;
    renderPicker();                          // rebuilds #picker wholesale, so the card is a fresh
    const card = $("#pickResult .pick-card");  // node — reach for it, not the detached host.
    if (card) card.classList.add("rolled-in");
  }, dur + 160);
}

// Values for a field, counted against the pool as it would be WITHOUT this
// criterion — so ticking a second value tells you what it would ADD, not what
// survived. Same trick the sidebar plays.
function pickFieldValues(field, except) {
  const counts = new Map();
  for (const r of pkbPool(except)) {
    for (const it of rowFacetItems(r, field)) {
      if (!counts.has(it.key)) counts.set(it.key, { n: 0, label: facetLabel(field, it.raw) });
      counts.get(it.key).n++;
    }
  }
  const vals = [...counts.entries()].map(([key, v]) => ({ key, label: v.label, n: v.n }));
  const rank = typeof valueOrderOf === "function" ? valueOrderOf(field) : null;
  if (field.buckets) {                       // ladders have a meaning-order, not a count-order
    const ord = new Map(field.buckets.map((b, i) => [b.label, i]));
    vals.sort((a, b) => (ord.get(a.key) ?? 99) - (ord.get(b.key) ?? 99));
  } else if (rank) {                         // a scale without a bucket list (era, recency…)
    vals.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
  } else if (field.type === "year") {
    vals.sort((a, b) => Number(b.key) - Number(a.key));   // newest first, as everywhere else
  } else {
    /* Alphabetical, where the sidebar uses count. The sidebar is a survey — "what IS my
       collection" — so the biggest bucket leading is the answer to the question. The
       picker is the opposite: you arrive knowing the value you want and need to find it,
       and hunting for "Saturn" down a list ordered by how many Saturn games you own is
       work. The counts stay on the rows; they just stop deciding the order. */
    vals.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined,
                                                      { numeric: true, sensitivity: "base" }));
  }
  return vals;
}

/* ---- presets ------------------------------------------------------------
   The old selectors, rewritten as trees. They're a starting point you can see and
   argue with now: pick "Short & sweet" and the two criteria it means appear as
   chips, so you can widen the playtime or drop the score without starting over.

   Gone from the list, because the builder says them better: the whole "By…" group
   (platform/genre/franchise/developer/publisher are fields — add one), the whole
   Playtime group (the "I have" budget, or the Playtime field), and the Play style
   entries that only ever restated IGDB's Game Mode facet. */
const pkc = (key, ...vals) => pickCond(key, vals);   // a preset criterion, terser
const PRESETS = [
  { id: "backlog", label: "Anything in my backlog", group: "General", build: () => [] },
  // Owned is its own criterion now, so the FIELD is ownership-agnostic — but the
  // preset has always meant "sitting on my shelf, still shrink-wrapped", and a
  // wishlist entry is not that. It says so in chips rather than in a hidden clause.
  { id: "neverstarted", label: "Never started", group: "General", build: () => [pkc("owned", "true"), pkc("__pk_backlog", "Never started")] },
  { id: "unfinished", label: "Started but unfinished", group: "General", build: () => [pkc("__pk_backlog", "Started but unfinished")] },
  { id: "recentadd", label: "Recently added", group: "General", build: () => [pkc("__pk_added", "Last 3 months")] },
  // "How long has this been sitting there" is answered by whichever date exists:
  // the old selector ranked on `datePurchased || dateAdded`, and rows only carry
  // the fields they have — so an OR, or a game bought in 2019 and never given a
  // Date Added drops out of the one preset built to find it.
  { id: "aging", label: "Longest in my backlog", group: "General",
    build: () => [pickGroup("or", [pkc("__pk_added", "Over 3 years ago"), pkc("__pk_bought", "Over 3 years ago")])] },

  { id: "playing", label: "Currently playing", group: "Status", build: () => [pkc("playingStatus", "Playing")] },
  { id: "upnext", label: "Up next", group: "Status", build: () => [pkc("playingStatus", "Up Next")] },
  { id: "onhold", label: "On hold", group: "Status", build: () => [pkc("playingStatus", "On Hold")] },
  { id: "priority", label: "High priority", group: "Status", build: () => [pkc("priority", "Must Play", "Will Play")] },
  { id: "maxpriority", label: "Top priority", group: "Status", build: () => [pkc("priority", "Must Play")] },

  { id: "acclaimed", label: "Critically acclaimed (80+)", group: "Rating", build: () => [pkc("__metacritic", "80–89", "90–100")] },
  { id: "masterpiece", label: "Masterpieces (90+)", group: "Rating", build: () => [pkc("__metacritic", "90–100")] },
  { id: "beloved", label: "Beloved by players (80+)", group: "Rating", build: () => [pkc("__userrating", "80–89", "90–100")] },
  { id: "foryou", label: "Predicted for you (80+)", group: "Rating", build: () => [pkc("__predicted", "80–89", "90–100")] },
  { id: "shortsweet", label: "Short & sweet (< 5h, 80+)", group: "Rating",
    build: () => [pkc("__playtime", "< 2h", "2–5h"), pkc("__metacritic", "80–89", "90–100")] },
  { id: "retrogem", label: "Retro gems (pre-2000, 80+)", group: "Rating",
    build: () => [pkc("__pk_era", "Retro (pre-2000)"), pkc("__metacritic", "80–89", "90–100")] },

  { id: "owned", label: "Owned & unplayed", group: "Ownership & price", build: () => [pkc("owned", "true")] },
  { id: "physical", label: "Physical copies", group: "Ownership & price", build: () => [pkc("owned", "true"), pkc("format", "Physical")] },
  { id: "digital", label: "Digital copies", group: "Ownership & price", build: () => [pkc("owned", "true"), pkc("format", "Digital")] },
  { id: "wishlist", label: "Wishlisted", group: "Ownership & price", build: () => [pkc("wishlisted", "true")] },
  { id: "free", label: "Free games", group: "Ownership & price", build: () => [pkc("owned", "true"), pkc("__pk_price", "Free")] },

  { id: "retro", label: "Retro (before 2000)", group: "Era", build: () => [pkc("__pk_era", "Retro (pre-2000)")] },
  { id: "recent", label: "Recent (last 3 years)", group: "Era", build: () => [pkc("__pk_era", "Last 3 years")] },
  { id: "thisyear", label: "This year's releases", group: "Era", build: () => [pkc("__pk_era", "This year")] },

  { id: "franchise", label: "Continue a franchise I've played", group: "Progress", build: () => [pkc("__pk_franchise", "Continues one I've played")] },

  { id: "birthday", label: "Released on my birthday", group: "For the hell of it", build: () => [pkc("__pk_bday", "Released on my birthday")] },
  { id: "palindrome", label: "Palindrome titles", group: "For the hell of it", build: () => [pkc("__pk_title", "Palindrome")] },
  { id: "longtitle", label: "Absurdly long titles", group: "For the hell of it", build: () => [pkc("__pk_title", "Absurdly long")] },
  { id: "shorttitle", label: "One-word titles", group: "For the hell of it", build: () => [pkc("__pk_title", "One word")] },
  { id: "obscure", label: "Nobody has heard of these", group: "For the hell of it", build: () => [pkc("__pk_obscure", "Nobody has heard of it")] },
  { id: "couch", label: "Co-op on one couch", group: "For the hell of it", build: () => [pkc("__pk_coop", "Local / couch")] },
];
const presetById = (id) => PRESETS.find((p) => p.id === id);

/* A preset names its values by the spelling the sheet is SUPPOSED to use, and some
   columns arrive exactly as they were typed into Excel — Format is not in parse.py's
   _VALUE_LABELS, so "Physical", "physical" and "PHYSICAL" all reach us as-is. The
   old selector lowercased before comparing; a preset naming a literal can't, so it
   would quietly match nothing over a capital letter. Snap each named value onto the
   real facet key instead, which also self-heals if a value gets re-spelled later. */
function snapPresetVals(node) {
  if (isPickGroup(node)) { node.kids.forEach(snapPresetVals); return; }
  const field = pickFieldByKey(node.key);
  if (!field || !node.vals.length) return;
  const real = new Set();
  for (const r of pickEligible()) for (const it of rowFacetItems(r, field)) real.add(it.key);
  if (node.vals.every((v) => real.has(v))) return;           // the usual case
  const byLower = new Map([...real].map((k) => [k.toLowerCase(), k]));
  node.vals = node.vals.map((v) => real.has(v) ? v : (byLower.get(String(v).toLowerCase()) || v));
}
/* ---- reset, and saved pickers -------------------------------------------
   "Reset" has to mean one specific thing, and the thing is this tab's front door: the
   default preset, no time budget, no roll. Deliberately NOT an empty tree — that would
   drop the "On the sheet" chip and hand you 25k games you don't own, which is the one
   move applyPreset is careful never to make by accident. */
const PICK_DEFAULT_PRESET = "backlog";
const pickDefaultTree = () =>
  pickGroup("and", [pkc("__pk_sheet", PICK_ON_SHEET), ...presetById(PICK_DEFAULT_PRESET).build()]);
/* The tree with the half-built bits taken out. A criterion with no values filters nothing
   and dismissPickPop takes it back the moment you walk away, so it isn't a state worth
   reacting to — without this, clicking "+ Criterion" makes Reset and the whole saved bar
   appear for a criterion you haven't chosen anything for yet, and then take themselves away
   again when you don't. It's also what gets saved: nobody wants "choose…" in their picker. */
const pickPruned = (n) => isPickGroup(n)
  ? { ...n, kids: n.kids.map(pickPruned).filter((k) => isPickGroup(k) ? k.kids.length : (k.vals || []).length) }
  : n;
// Compared as trees, not by preset name: build a criterion up and take it apart again and
// you're back at the default, whatever the dropdown has since decided to call it. The name
// is in the test too, so Reset is offered when only the LABEL is off ("Custom filter" over
// a tree that is the default) — resetting puts that right.
const pickIsDefault = () =>
  pickState.preset === PICK_DEFAULT_PRESET &&
  pickEncode(pickPruned(pickState.filter)) === pickEncode(pickDefaultTree());

/* A saved picker is a name and a tree — the same packed tree the ?fb= link carries, so
   there's no second serialization to keep in step. Stored through prefsSave: the server
   when you're signed in, this browser's localStorage when you're not, which is the deal
   saved views and custom challenges already run on.

   PREFS_KEYS is a const in extras.js, which loads AFTER this file — read it at runtime
   (inside these functions) and never at parse time. See the note at extras.js's PREFS_KEYS. */
const savedPickers = () => (typeof prefsLocal === "function" ? prefsLocal("pickers") : []);
const storePickers = (l) => prefsSave("pickers", l.slice(0, 24));

// The criteria in words: the chip row's tooltip, and the name the save prompt suggests.
// Nested groups collapse to a parenthesised summary — a tooltip is not the place to
// re-litigate the tree.
function describePicker(node = pickState.filter) {
  const bits = [];
  for (const k of node.kids || []) {
    if (isPickGroup(k)) { const d = describePicker(k); if (d) bits.push(`(${d})`); continue; }
    const f = pickFieldByKey(k.key);
    if (!f || !(k.vals || []).length) continue;
    bits.push(`${f.label}${k.not ? " ≠ " : ": "}${k.vals.slice(0, 2).join(", ")}${k.vals.length > 2 ? "…" : ""}`);
  }
  return bits.join(" · ");
}

function applyPicker(p) {
  closePickPop();
  pickState.filter = pickDecode(p.fb);
  // A saved picker is a tree, so it lands as one: the dropdown reads "Custom filter"
  // rather than naming a preset this may no longer have anything to do with.
  pickState.preset = "";
  pickState.picked = null;
  renderPicker();
  nav();
}

function applyPreset(id) {
  const p = presetById(id) || PRESETS[0];
  pickState.preset = p.id;
  /* Every preset starts on the sheet. The pool reaches into the IGDB catalogue now (see
     pickEligible), and every preset above was written when it couldn't: "Never started"
     means a game on your shelf you haven't started, not one that isn't in your house, and
     "what can I finish in 90 minutes" is not a question about a game you'd have to go and
     buy first.

     Seeded as a real criterion — visible, deletable, sitting in the chip row like any
     other — rather than as an invisible default. The builder's entire premise is that you
     can see what it's doing and change it; a hidden clause quietly dropping 25k rows is
     precisely the thing it was built to replace. Delete the chip, or add "Not on the
     sheet" beside it, and the catalogue is yours. */
  pickState.filter = pickGroup("and", [pkc("__pk_sheet", PICK_ON_SHEET), ...p.build()]);
  pickState.filter.kids.forEach(snapPresetVals);
  pickState.picked = null;
}

function pickCard(row) {
  // The REAL grid card, not a bespoke one — so the trailer plays on hover here exactly as
  // it does in the listings (renderPicker hands it to wirePreviewFor).
  // igdbRecOf, not ENRICH[_k]: a catalogue row carries its record inline and has no match
  // key, so it would draw a permanent grey placeholder where its cover ought to be.
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
  const game = `<div class="${cls}" id="pickGameCard">${cover}${vrBadgeHtml(row)}<div class="card-body">${cardBodyHtml(row)}</div></div>`;

  const chips = [row.platform, row.releaseYear, row.genre, row.franchise]
    .filter((x) => x != null && x !== "")
    .map((x) => `<span class="chip">${escapeHtml(String(x))}</span>`).join("");
  // launchHtml, not rommHtml: it composes BOTH — "Play now" via RomM and the storefront the
  // copy you own actually came from. The pick is a game you're deciding whether to play right
  // now, so the way to start playing it belongs on the card, not one click away in the drawer.
  const play = typeof launchHtml === "function" ? launchHtml(row) : "";

  // Only promise a trailer when there is one.
  const hint = rec.video ? `<span class="pick-hint">Hover for the trailer</span>` : "";
  /* A game that isn't on the sheet has no drawer to open: the drawer fetches its detail by
     match key, and there is no match key for a row the spreadsheet has never had. Send it
     to IGDB instead — and say so plainly on the card, because "here is a game you could
     play tonight" and "here is a game you'd have to go and buy" are different answers and
     the eyebrow is where you read which one you got. */
  const eyebrow = row._cat
    ? `${icon("i-sparkle", 13)} Not on your sheet`
    : `${icon("i-dice", 13)} Your pick`;
  const details = row._cat
    ? `<a class="pick-open" href="${escapeHtml(rec.url || "#")}" target="_blank" rel="noopener">View on IGDB ↗</a>`
    : `<button class="pick-open" id="pickOpen">Full details</button>`;
  return `<div class="pick-card">
    <div class="pick-art">${game}${hint}</div>
    <div class="pick-info">
      <div class="pick-eyebrow">${eyebrow}</div>
      <h2>${escapeHtml(String(row.title))}</h2>
      <div class="pick-chips">${chips}</div>
      ${heroStatsHtml(row)}
      ${predictWhyHtml(row)}
      <div class="pick-actions">
        <button class="pick-reroll" id="pickReroll">${icon("i-dice", 15)} Re-roll</button>
        ${details}
        ${play}
      </div>
    </div>
  </div>`;
}

/* ---- the builder UI -----------------------------------------------------
   One popover does both jobs: pick a field, then tick its values. It's anchored
   as a CHILD of the chip that opened it rather than positioned against the
   viewport — there's no popover machinery in this app to borrow, and a child that
   scrolls with its anchor needs none. */
const pickPop = { path: null, mode: null, q: "", all: false };
const PICK_POP_CAP = 12;                    // before "show all" — the sidebar's trick

/* A group's and/or/not, as one thing you read rather than two you combine. It was a
   NOT toggle beside an and/or select, which meant an un-negated group still rendered
   the word "NOT" next to "Match any of" — greyed out, but the sentence read as though
   the negation were on. A group has only three states worth saying out loud, so say
   them: the select IS the negation. */
const GROUP_MODES = [
  { v: "all", label: "Match all of", op: "and", not: false },
  { v: "any", label: "Match any of", op: "or", not: false },
  { v: "none", label: "Match none of", op: "or", not: true },   // NOT(a or b) — "neither"
  { v: "notall", label: "Don’t match all of", op: "and", not: true },
];
const groupMode = (n) =>
  GROUP_MODES.find((m) => m.op === n.op && m.not === !!n.not) || GROUP_MODES[0];

const closePickPop = () => { pickPop.path = null; pickPop.mode = null; pickPop.q = ""; };
function openPickPop(path, mode) {
  pickPop.path = path.join(".");
  pickPop.mode = mode;
  pickPop.q = "";
  pickPop.all = false;
}

/* Closing a popover is not the same as cancelling out of one, and this only ever did the
   first. Abandon a half-built criterion — click away while it still says "choose…" — and
   the chip stayed behind: a filter that filters nothing, which you then have to notice
   and delete by hand. Leaving IS the cancel. No values, no criterion, however it came to
   have none (the same goes for "Clear" and then walking away).

   Deliberately not a nav(): the empty criterion never meant anything, so putting it in
   the history to walk back to would be offering an undo of nothing. syncURL(false) keeps
   the link honest without minting an entry. */
function dismissPickPop() {
  const at = pickPop.path;
  closePickPop();
  if (at !== null) {
    const path = pickPath(at);
    let n = null;
    try { n = pickNodeAt(path); } catch (_) { /* the tree moved under it */ }
    if (path.length && n && !isPickGroup(n) && !(n.vals || []).length) {
      pickNodeAt(path.slice(0, -1)).kids.splice(path[path.length - 1], 1);
      pkb.sync(true);
    }
  }
  pkb.repaint();
}

/* The popover is a child of its chip, which buys it anchoring and scrolling-with-its-anchor
   for nothing. What it doesn't buy is a guarantee that 268px hanging off the chip's left
   edge is on the screen — and on a phone, for any chip on the right half, it isn't.

   The old answer was to stop anchoring below 760px and dock it to the bottom of the screen
   as a sheet, which put the list of platforms an inch from the bottom bezel while the chip
   it belonged to sat up by the header — two things that are one thought, rendered as far
   apart as the viewport allows. So: keep the anchor, and push it back inside the edge it
   would have crossed, which is what you wanted the sheet to do in the first place.

   Measured after paint rather than computed, because the height depends on how many values
   the field turned out to have, and the width on the viewport. */
const PICK_POP_GAP = 6, PICK_POP_EDGE = 10, PICK_POP_MIN_H = 150;
function positionPickPop() {
  const pop = $(pkb.sel + " .pk-pop");
  const chip = pop && pop.closest(".pk-chip");
  if (!chip) return;
  pop.style.left = "0px";                    // measure from the anchored position…
  pop.style.maxHeight = "";
  pop.classList.remove("up");
  const c = chip.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;

  // Sideways: slide it back in, right edge first — a popover pushed off the left is
  // worse than one whose left edge stops at the margin.
  let left = 0;
  if (c.left + pop.offsetWidth > vw - PICK_POP_EDGE) left = vw - PICK_POP_EDGE - pop.offsetWidth - c.left;
  if (c.left + left < PICK_POP_EDGE) left = PICK_POP_EDGE - c.left;
  pop.style.left = `${Math.round(left)}px`;

  // Vertically: below if it fits, above if above fits better, and capped to the room it
  // actually has either way — it scrolls inside itself, which beats scrolling off-screen.
  const below = vh - c.bottom - PICK_POP_GAP - PICK_POP_EDGE;
  const above = c.top - PICK_POP_GAP - PICK_POP_EDGE;
  const up = pop.offsetHeight > below && above > below;
  pop.classList.toggle("up", up);
  pop.style.maxHeight = `${Math.max(PICK_POP_MIN_H, Math.floor(up ? above : below))}px`;
}
// Any edit means the tree is no longer what the preset said it was. Saying so
// keeps the dropdown honest rather than leaving it pointing at a shape you've
// since taken apart.
function pickEdited() {
  pickState.preset = "";
  pickState.picked = null;
}

/* The open popover's value list, held across keystrokes. Counting means a pass over
   the whole backlog plus a facet pass per row, and typing in the filter box CAN'T
   change a count — it only hides rows — so recomputing per keystroke was scanning
   the collection eight times to spell "nintendo". renderPicker clears it whenever
   the pool actually moves. */
let _pkVals = null;

function pickValueRowsHtml(node, field) {
  const all = _pkVals || (_pkVals = pickFieldValues(field, node));
  const q = pickPop.q.toLowerCase();
  const vals = q ? all.filter((v) => v.label.toLowerCase().includes(q)) : all;
  if (!vals.length) return `<p class="pk-pop-empty">Nothing here matches the rest of your filter.</p>`;
  const shown = pickPop.all ? vals : vals.slice(0, PICK_POP_CAP);
  const on = new Set(node.vals || []);
  return shown.map((v) => `<label class="facet-opt${on.has(v.key) ? " checked" : ""}">
      <input type="checkbox" data-v="${escapeHtml(v.key)}"${on.has(v.key) ? " checked" : ""}>
      <span class="lbl">${escapeHtml(v.label)}</span><span class="cnt">${v.n.toLocaleString()}</span>
    </label>`).join("") +
    (vals.length > shown.length
      ? `<button class="facet-more" id="pkPopMore">Show ${(vals.length - shown.length).toLocaleString()} more…</button>`
      : "");
}

function pickPopHtml(path) {
  const node = pickNodeAt(path);
  const field = pickFieldByKey(node.key);
  if (pickPop.mode === "field") {
    const q = pickPop.q.toLowerCase();
    const hits = pickFields().filter((f) => !q || f.label.toLowerCase().includes(q));
    /* Groups keep their hand-written order (PICK_GROUP_ORDER is a rough "how likely are
       you to reach for this"), but WITHIN a group the fields were in catalogue order —
       whatever sequence the sheet's columns, then IGDB's, then the computed ones happened
       to arrive in. That's insertion order pretending to be a ranking. Alphabetical: the
       list is for finding a field you already have in mind. Counts order the VALUES, where
       "how many games" is real information; a field name has no such thing. */
    const groups = PICK_GROUP_ORDER
      .map((g) => [g, hits.filter((f) => f.group === g)
        .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { sensitivity: "base" }))])
      .filter(([, fs]) => fs.length);
    return `<div class="pk-pop" tabindex="-1" data-path="${path.join(".")}">
      ${searchField("pkPopSearch", "Find a field…", pickPop.q, "field-facet")}
      <div class="pk-pop-list" id="pkPopList">${groups.map(([g, fs]) =>
        `<div class="pk-pop-grp">${escapeHtml(g)}</div>` +
        fs.map((f) => `<button class="pk-pop-field${f.key === node.key ? " on" : ""}" data-f="${escapeHtml(f.key)}">${escapeHtml(f.label)}</button>`).join("")
      ).join("") || `<p class="pk-pop-empty">No field by that name.</p>`}</div>
    </div>`;
  }
  if (!field) return "";
  // The birthday isn't in the sheet and there's nowhere to put it, so the one
  // field that needs a setting carries it.
  const bday = field.key === "__pk_bday"
    ? `<label class="pk-pop-set">My birthday
         <input id="pkBday" type="date" value="${birthday() ? `2000-${birthday()}` : ""}" title="Only the month and day are used">
       </label>` : "";
  const many = (field.buckets || []).length === 0;
  return `<div class="pk-pop" tabindex="-1" data-path="${path.join(".")}">
    <div class="pk-pop-head">
      <button class="pk-pop-refield" data-act="refield" data-path="${path.join(".")}">${escapeHtml(field.label)} <span class="chev">▾</span></button>
      <button class="pk-pop-clear" data-act="clear" data-path="${path.join(".")}">Clear</button>
    </div>
    ${bday}
    ${many ? searchField("pkPopSearch", "Filter values…", pickPop.q, "field-facet") : ""}
    <div class="pk-pop-list" id="pkPopList">${pickValueRowsHtml(node, field)}</div>
  </div>`;
}

function pickCondHtml(node, path) {
  const p = path.join(".");
  const field = pickFieldByKey(node.key);
  const vals = node.vals || [];
  const shown = vals.slice(0, 2).map((v) => (field && field.type === "bool") ? (v === "true" ? "Yes" : "No") : v);
  // A field can genuinely vanish — an old ?fb= link, or an auto-bucketed one whose
  // ladder came back empty (no priced games, nothing to bucket). compilePick treats
  // that as a no-op, so the chip must not sit there in a filter's clothing claiming
  // to narrow anything: name it, blame it, and let it be removed.
  const text = !field ? "field unavailable"
    : vals.length ? shown.join(", ") + (vals.length > 2 ? ` +${vals.length - 2}` : "")
    : "choose…";
  return `<div class="pk-chip${node.not ? " neg" : ""}${field ? "" : " broken"}${vals.length && field ? "" : " todo"}${pickPop.path === p ? " open" : ""}"
    ${field ? "" : `title="Nothing in this collection answers “${escapeHtml(String(node.key))}”, so this criterion is ignored."`}>
    <b class="pk-chip-f">${escapeHtml(field ? field.label : "Unknown field")}</b>
    <button class="pk-chip-not" data-act="not" data-path="${p}"
      title="${node.not ? "Currently excluding these" : "Currently including these"}">${node.not ? "is not" : "is"}</button>
    <button class="pk-chip-v" data-act="${field ? "edit" : "refield"}" data-path="${p}">${escapeHtml(text)}</button>
    <button class="pk-chip-x" data-act="del" data-path="${p}" title="Remove" aria-label="Remove">✕</button>
    ${pickPop.path === p ? pickPopHtml(path) : ""}
  </div>`;
}

function pickGroupHtml(node, path) {
  const p = path.join(".");
  const nested = path.length > 0;
  const kids = node.kids.map((k, i) =>
    (isPickGroup(k) ? pickGroupHtml : pickCondHtml)(k, [...path, i])).join("");
  // "Match all of" one thing is a question nobody asked — the and/or only starts
  // meaning something at two. A nested group keeps its bar regardless: that's where
  // its remove button lives.
  const showOp = node.kids.length > 1;
  const mode = groupMode(node);
  // "Don't match all of" is unreachable from this select (De Morgan says it's
  // "any of (not…, not…)", which reads better) — but a hand-edited ?fb= link can
  // still say it, and a select that can't show the state it's in would lie.
  const modes = GROUP_MODES.filter((m) => m.v !== "notall" || mode.v === "notall");
  const bar = (nested || showOp)
    ? `<div class="pkg-bar">
        ${showOp ? `<select class="pkg-op" data-act="op" data-path="${p}" title="How these criteria combine">
          ${modes.map((m) => `<option value="${m.v}"${m.v === mode.v ? " selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
        </select>` : ""}
        ${nested ? `<button class="pkg-x" data-act="gdel" data-path="${p}" title="Remove this group" aria-label="Remove group">✕</button>` : ""}
      </div>`
    : "";
  return `<div class="pkg${nested ? " nested" : ""}${node.not ? " neg" : ""}">
    ${bar}
    ${!node.kids.length && !nested ? `<p class="pkg-empty">No criteria yet. ${pkb.emptyHint || "every game in the backlog is in play"}.</p>` : ""}
    <div class="pkg-kids">
      ${kids}
      <button class="pk-add" data-act="add" data-path="${p}" title="Add a criterion">${icon("i-plus", 12)} Criterion</button>
      <button class="pk-add ghost" data-act="gadd" data-path="${p}" title="Add a nested group">${icon("i-plus", 12)} Group</button>
    </div>
  </div>`;
}

function renderPicker() {
  pkbUse(PICK_TAB_BUILDER);   // the challenge editor borrows the builder; take it back
  const host = $("#picker");
  _pkVals = null;                  // the pool may have moved; recount on demand
  if (!pickState.filter) applyPreset(pickState.preset || "backlog");
  // A popover is pinned to a path, and the tree underneath it can move (a preset
  // replaces it wholesale, a chip two along gets removed). Re-check the path still
  // lands on a criterion rather than painting against a node that isn't there.
  if (pickPop.path !== null) {
    let n = null;
    try { n = pickNodeAt(pickPath(pickPop.path)); } catch (_) { /* path went stale */ }
    if (!n || isPickGroup(n)) closePickPop();
  }
  /* Ask for the catalogue once, here, and never from pickEligible() — that runs on every
     render and every keystroke in the builder, and this is a 2.2MB fetch. The tab is fully
     usable without it (the pool is the backlog, which is what the default filter asks for
     anyway); when it lands, the "In the sheet" field gains its second value and the pool
     quietly grows. Nothing waits. */
  if (typeof ensureCatalogue === "function" && !CAT && !_pickCatAsked) {
    _pickCatAsked = true;
    ensureCatalogue().then(() => { if (activeTab === "pick") renderPicker(); });
  }
  const pool = pickPool();
  const mins = pickBudgetMinutes();
  const groups = {};
  PRESETS.forEach((s) => { (groups[s.group] = groups[s.group] || []).push(s); });
  const opts = Object.entries(groups).map(([g, ss]) =>
    `<optgroup label="${escapeHtml(g)}">${ss.map((s) =>
      `<option value="${s.id}"${s.id === pickState.preset ? " selected" : ""}>${escapeHtml(s.label)}</option>`).join("")}</optgroup>`).join("");

  const saved = savedPickers();
  const isDef = pickIsDefault();
  /* A preset already has a name, and it's a better one than you'd type — so there's
     nothing to save until you've said something the preset doesn't. That moment has a
     name already too: pickEdited() empties pickState.preset as soon as you change
     anything it said, which is exactly when the dropdown starts reading "Custom filter". */
  const saveable = !pickState.preset;

  host.innerHTML = `
    <div class="pick-controls">
      <label>Start from <select id="pickPreset">
        ${pickState.preset ? "" : `<option value="" selected>Custom filter</option>`}${opts}
      </select></label>
      <label class="pick-time">I have
        <select id="pickTime">
          <option value="0"${mins ? "" : " selected"}>Any length</option>
          ${TIME_BUDGETS.map((b) =>
            `<option value="${b.m}"${b.m === mins ? " selected" : ""}>${escapeHtml(b.label)}</option>`).join("")}
        </select>
      </label>
      <button id="pickBtn" class="pick-btn">${icon("i-dice", 16)} Pick for me</button>
      <span class="pick-count">${pool.length.toLocaleString()} game${pool.length === 1 ? "" : "s"} in pool</span>
      ${isDef ? "" : `<button id="pickReset" class="pick-reset" title="Back to the default filter">Reset</button>`}
      <label class="pick-anim" title="Play a dice-roll animation when picking a game">
        <input type="checkbox" id="pickAnim"${pickAnimOn() ? " checked" : ""}> Roll animation
      </label>
    </div>
    ${saved.length || saveable ? `<div class="pick-saved">
      ${saved.map((p, i) => `<button class="view-chip" data-pi="${i}" title="${escapeHtml(p.desc || "")}">
          ${escapeHtml(p.name)}<span class="view-x" data-px="${i}" title="Forget this picker">✕</span>
        </button>`).join("")}
      ${saveable ? `<button class="view-save" id="pickSave">＋ Save this picker</button>` : ""}
    </div>` : ""}
    <div class="pick-builder" id="pickBuilder">${pickGroupHtml(pickState.filter, [])}</div>
    <div class="pick-result" id="pickResult">${pickState.picked && pool.includes(pickState.picked)
      ? pickCard(pickState.picked)
      : `<div class="pick-empty">${pool.length ? "Hit “Pick for me” to roll a game." : "Nothing matches this filter."}</div>`}</div>`;

  // "Custom filter" is a readout of where you've ended up, not a thing you can
  // choose — selecting it should leave the tree you built alone.
  $("#pickPreset").onchange = (e) => {
    if (!e.target.value) return;
    closePickPop(); applyPreset(e.target.value); renderPicker(); nav();
  };
  // Writes a criterion rather than a second kind of state — so it shows up as a chip you
  // can negate, widen, or drag into an OR, and the dropdown says "Custom filter" because
  // by then that is exactly what it is.
  $("#pickTime").onchange = (e) => { closePickPop(); pickSetBudget(+e.target.value); renderPicker(); nav(); };
  $("#pickBtn").onclick = () => { pickGame(true); nav(); };
  const anim = $("#pickAnim");
  if (anim) anim.onchange = (e) => {
    if (e.target.checked) localStorage.removeItem(PICK_ANIM_KEY);
    else localStorage.setItem(PICK_ANIM_KEY, "0");
  };
  const reset = $("#pickReset");
  if (reset) reset.onclick = () => { closePickPop(); applyPreset(PICK_DEFAULT_PRESET); renderPicker(); nav(); };
  wirePickSaved();
  wirePickBuilder();
  positionPickPop();

  const game = host.querySelector("#pickGameCard");
  if (game) {
    // Same card component as the listings, so it gets the same hover trailer.
    wirePreviewFor(game, pickState.picked);
    // A catalogue game has no drawer (no match key, nothing to fetch) — its card is a
    // link to IGDB instead, so leave the click alone rather than open an empty panel.
    if (!pickState.picked._cat) game.onclick = () => openDrawer(pickState.picked, "games");
    $("#pickReroll").onclick = (e) => { e.stopPropagation(); pickGame(true); nav(); };
    const open = $("#pickOpen");
    if (open && open.tagName === "BUTTON") open.onclick = () => openDrawer(pickState.picked, "games");
  }
}

/* The saved-picker chips: apply on click, forget on ✕, name the current tree on save.
   Modelled on the saved-views bar down to the class names (extras.js), because it's the
   same idea — a name for a filter you'd otherwise rebuild by hand — and two bars that do
   the same thing should look like they do. Views skip this tab by design (SPECIAL_TABS),
   so there's no second bar here to collide with. */
function wirePickSaved() {
  document.querySelectorAll("#picker .pick-saved [data-pi]").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.px !== undefined) return;      // the ✕ has its own job
      const p = savedPickers()[+el.dataset.pi];
      if (p) applyPicker(p);
    };
  });
  document.querySelectorAll("#picker .pick-saved [data-px]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const list = savedPickers();
      list.splice(+el.dataset.px, 1);
      storePickers(list);
      renderPicker();
    };
  });
  const save = $("#pickSave");
  /* Saving from here saves a PICKER. Grouping is a challenge idea and lives only in the
     challenge editor, which runs this same builder for its criteria. */
  if (save) save.onclick = async () => {
    const name = await uiPrompt({ title: "Name this picker", value: describePicker().slice(0, 40) || "My picker", placeholder: "My picker" });
    if (!name) return;
    const list = savedPickers();
    list.unshift({ name: name.slice(0, 40), fb: pickEncode(pickPruned(pickState.filter)), desc: describePicker() });
    storePickers(list);
    renderPicker();
  };
}

// Repaint just the popover's option rows. Rebuilding the picker on every keystroke
// would destroy the input the keystrokes are going into — the same trap the facet
// sidebar documents at renderFacets. Focus is the caller's business: what should hold it
// afterwards depends on what caused the repaint, and only the caller knows that.
function pickPopRepaint() {
  const list = $("#pkPopList");
  if (!list || !pickPop.path) return;
  const path = pickPath(pickPop.path);
  const node = pickNodeAt(path);
  if (pickPop.mode === "field") {
    const wrap = list.closest(".pk-pop");
    wrap.outerHTML = pickPopHtml(path);
  } else {
    list.innerHTML = pickValueRowsHtml(node, pickFieldByKey(node.key));
  }
  wirePickBuilder();
  positionPickPop();          // "show all" just changed how tall this is
}

/* ---- the keyboard -------------------------------------------------------
   The builder was mouse-only. You could Tab onto a chip and open it — they're buttons,
   that much came free — and then the popover had you: no way to reach a value, and no way
   out but a click somewhere else.

   Roving focus, recomputed from the DOM each time, rather than a remembered index: every
   keystroke in the search box rebuilds the list from HTML, so anything held per-element
   would be thrown away with the element. */
const pkPopItems = () =>
  [...document.querySelectorAll(`${pkb.sel} .pk-pop-field, ${pkb.sel} .facet-opt input, ${pkb.sel} .facet-more`)];

// renderPicker() rebuilds the whole tab from HTML, so whatever had focus is gone by the
// time it returns — fine for a mouse, fatal for a keyboard: ticking a value would drop you
// onto the body and the next arrow key would go nowhere. Re-find the row by its VALUE,
// since the element that had it no longer exists.
function pickRefocusValue(v) {
  const el = document.querySelector(`${pkb.sel} .pk-pop input[data-v="${CSS.escape(v)}"]`);
  if (el) el.focus();
}

function pickPopKeydown(e) {
  if (!document.querySelector(pkb.sel + " .pk-pop")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    const at = pickPop.path;
    dismissPickPop();                    // Escape cancels, exactly as clicking away does
    // Land back on the chip you came from — or, if cancelling just removed it, on the
    // button that would make another one.
    ($(`${pkb.sel} .pk-chip-v[data-path="${at}"]`) || $(pkb.sel + " .pk-add"))?.focus();
    return;
  }
  const items = pkPopItems();
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const d = e.key === "ArrowDown" ? 1 : -1;
    // From the search box or the popover itself (i === -1), Down means "into the list"
    // and Up means "the end of it".
    items[i < 0 ? (d > 0 ? 0 : items.length - 1) : (i + d + items.length) % items.length].focus();
    return;
  }
  if (e.key === "Enter") {
    // Enter from the search box takes the obvious thing: the first hit. On a row, it takes
    // that row — a checkbox does nothing on Enter otherwise, which reads as a dead key.
    const t = i < 0 ? items[0] : items[i];
    if (!t) return;
    e.preventDefault();
    t.click();
  }
}

function wirePickBuilder() {
  const host = pkbHost();
  if (!host) return;

  host.onclick = (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || !host.contains(b)) return;
    const path = pickPath(b.dataset.path);
    const act = b.dataset.act;
    if (act === "op") return;                       // a <select>, handled below
    e.stopPropagation();
    if (act === "add") {
      // A criterion with no field yet is a criterion you're mid-way through
      // choosing — park it in the tree and open the field list on it.
      const g = pickNodeAt(path);
      g.kids.push(pickCond(pickFields()[0].key, []));
      // No pickEdited() yet, deliberately. Nothing has been chosen: an empty criterion
      // filters nothing, and dismissPickPop takes it away again if you walk off. Calling
      // it here would rename a preset you haven't actually edited to "Custom filter" —
      // and leave it renamed after the criterion you abandoned was gone.
      openPickPop([...path, g.kids.length - 1], "field");
      pkb.repaint();
      $("#pkPopSearch")?.focus();
      return;
    }
    if (act === "gadd") { pickNodeAt(path).kids.push(pickGroup("or")); pkb.changed(); pkb.repaint(); pkb.sync(); return; }
    if (act === "gdel" || act === "del") {
      closePickPop();
      pickNodeAt(path.slice(0, -1)).kids.splice(path[path.length - 1], 1);
      pkb.changed(); pkb.repaint(); pkb.sync(); return;
    }
    if (act === "not") {
      const n = pickNodeAt(path);
      n.not = !n.not; pkb.changed(); pkb.repaint(); pkb.sync(); return;
    }
    if (act === "edit") {
      const p = path.join(".");
      if (pickPop.path === p && pickPop.mode === "values") dismissPickPop();
      else {
        openPickPop(path, "values");
        pkb.repaint();
        // The popover itself, not its search box: focus has to land inside for Escape and
        // the arrows to reach it, but focusing a real input here would throw up the
        // keyboard on a phone every time you glance at a field's values.
        $(pkb.sel + " .pk-pop")?.focus();
      }
      return;
    }
    if (act === "refield") { openPickPop(path, "field"); pkb.repaint(); $("#pkPopSearch")?.focus(); return; }
    if (act === "clear") {
      pickNodeAt(path).vals = [];
      pkb.changed(); pkb.repaint(); return;
    }
  };
  host.onchange = (e) => {
    const s = e.target.closest("[data-act='op']");
    if (!s) return;
    const m = GROUP_MODES.find((x) => x.v === s.value) || GROUP_MODES[0];
    const n = pickNodeAt(pickPath(s.dataset.path));
    n.op = m.op; n.not = m.not;
    pkb.changed(); pkb.repaint(); pkb.sync();
  };
  host.onkeydown = pickPopKeydown;

  const pop = host.querySelector(".pk-pop");
  if (!pop) return;
  const path = pickPath(pop.dataset.path);
  const node = pickNodeAt(path);

  // No stopPropagation here, however tempting: the popover lives INSIDE the builder host,
  // so swallowing its clicks would starve the delegated handler above and the
  // popover's own head buttons (change field, Clear) would quietly do nothing. The
  // outside-click listener already exempts anything inside .pk-pop.
  const q = $("#pkPopSearch");
  if (q) q.oninput = (ev) => {
    pickPop.q = ev.target.value; pickPop.all = false;
    pickPopRepaint();
    // The box was just rebuilt from HTML and the caret went with it. Put both back, or
    // the second keystroke lands somewhere else — or nowhere.
    const q2 = $("#pkPopSearch");
    if (q2) { q2.focus(); q2.setSelectionRange(q2.value.length, q2.value.length); }
  };
  const more = $("#pkPopMore");
  if (more) more.onclick = () => {
    pickPop.all = true;
    pickPopRepaint();
    // Land on the first row it just revealed: the button that was under the cursor has
    // been repainted out of existence, and focus would otherwise fall to the body.
    pkPopItems()[PICK_POP_CAP]?.focus();
  };

  pop.querySelectorAll(".pk-pop-field").forEach((el) => {
    el.onclick = () => {
      // Swapping the field on a criterion that HAD values throws them away — that's an
      // edit, and the preset it came from can no longer claim to describe this. Naming the
      // field of a brand-new empty one throws away nothing, so it isn't one yet: it's a
      // criterion mid-build, which dismissPickPop is still free to take back whole.
      if ((node.vals || []).length) pkb.changed();
      node.key = el.dataset.f;
      node.vals = [];                              // values belong to the old field
      pickPop.mode = "values"; pickPop.q = ""; pickPop.all = false;
      // No nav() either: a criterion with no values yet is not a state the Back button
      // should have to return anyone to. Ticking the first value is what makes it one.
      pkb.repaint();
      $(pkb.sel + " .pk-pop")?.focus();
    };
  });
  pop.querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.onchange = () => {
      const v = el.dataset.v;
      const on = new Set(node.vals || []);
      on.has(v) ? on.delete(v) : on.add(v);
      node.vals = [...on];
      pkb.changed();
      // Repaint the whole picker (the pool count moved) but keep the popover open,
      // so ticking three platforms is three clicks and not three re-opens.
      pkb.repaint(); pkb.sync();
      pickRefocusValue(v);
    };
  });
  const bd = $("#pkBday");
  if (bd) bd.onchange = (ev) => {
    const v = ev.target.value;                     // yyyy-mm-dd; only MM-DD is used
    if (v) localStorage.setItem(BIRTHDAY_KEY, v.slice(5, 10));
    else localStorage.removeItem(BIRTHDAY_KEY);
    pickState.picked = null;
    pkb.repaint();
  };
}

/* Click anywhere else and the popover goes away — the one behaviour every popover needs
   and this app has never had to implement before.

   "Anywhere else" has to be decided in the CAPTURE phase, before any of the popover's own
   handlers have run. They repaint from inside the click they're handling — "Show 40 more"
   rewrites the very list its button sits in — so by the time the event bubbles up here,
   e.target has been detached and has no ancestors left to match: closest() reports the
   click as outside, and the popover is thrown away a moment after doing exactly what it
   was asked. That was the whole of "Show more just closes the selector". Ask while the DOM
   is still the one that was clicked, and it can't lie. */
let _pkClickedInside = false;
const pkInsidePop = (el) =>
  !!(el && el.closest && (el.closest(".pk-pop") || el.closest("[data-act='edit']") ||
     el.closest("[data-act='add']") || el.closest("[data-act='refield']")));
document.addEventListener("click", (e) => { _pkClickedInside = pkInsidePop(e.target); }, true);
document.addEventListener("click", () => {
  // Not "are we on Pick" any more — the same builder runs inside the challenge editor,
  // and its popover needs the same click-away.
  if (!pickPop.path || !pkbOnScreen() || _pkClickedInside) return;
  dismissPickPop();
});

// Landing state (core.js). applyPreset rebuilds filter+preset together and clears the
// rolled game — hand-assigning either one leaves the two disagreeing about what's shown.
TAB_RESET.pick = () => { closePickPop(); applyPreset(PICK_DEFAULT_PRESET); };
