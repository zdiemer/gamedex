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
const pickState = { filter: null, preset: "backlog", picked: null, mode: "one" };
/* Two ways to answer "what do I play". "one" is this file: a single game out of the
   pool. "rng" is rng.js: three at once, one modern AAA, one modern indie, one retro,
   over the same pool and the same criteria builder. The mode is which RESULT you get,
   not a second set of state — everything above the result area is shared. */
const pickModeRng = () => pickState.mode === "rng";
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

/* On a phone the builder, the preset/time selects and the saved pickers all live in a
   bottom sheet ("Build the pool"), opened from the Criteria pill in the pool bar — so the
   picked game owns the screen and every control has one named home. On desktop the sheet
   wrapper dissolves (display: contents) and everything sits inline exactly as it always
   has. This remembers whether the sheet is up, so the re-render every edit causes paints
   it back open instead of dropping it mid-build. */
let pickSheetOpen = false;
let _sheetReturnFocus = null;

// Same breakpoint the stylesheet uses: below it the sheet is a real modal, above it the
// wrapper is display:contents and must not claim to be one — so the dialog role comes and
// goes with the width (renderPicker re-asserts it after every repaint) rather than living
// in the markup, where desktop screen readers would announce a dialog that has no box.
const pickSheetMedia = matchMedia("(max-width: 760px)");
function pickSheetA11y() {
  const sh = $("#pickSheet");
  if (!sh) return;
  if (pickSheetMedia.matches) {
    sh.setAttribute("role", "dialog");
    sh.setAttribute("aria-modal", "true");
    sh.setAttribute("aria-label", "Build the pool");
  } else {
    sh.removeAttribute("role");
    sh.removeAttribute("aria-modal");
    sh.removeAttribute("aria-label");
  }
}
pickSheetMedia.addEventListener("change", pickSheetA11y);

function pickSheetSet(open) {
  const was = pickSheetOpen;
  pickSheetOpen = open;
  const sh = $("#pickSheet");
  if (!sh) return;
  // A class flip, not a re-render: the slide animation should play on the tap that asked
  // for it, and never on the wholesale repaints that edits inside the sheet cause.
  sh.classList.toggle("open", open);
  const bk = $("#pickShBack");
  if (bk) bk.hidden = !open;
  const btn = $("#pickCrit");
  if (btn) btn.setAttribute("aria-expanded", String(open));
  // Closing walks away from any half-built criterion, exactly like clicking elsewhere.
  if (!open && pickPop.path !== null) dismissPickPop();
  // The page behind the sheet holds still (drawer.js owns the lock, and knows a desktop
  // "sheet" has no box to lock for).
  if (typeof syncScrollLock === "function") syncScrollLock();
  // Modal focus discipline, phones only: in on open, back to the Criteria pill (or
  // whoever opened it) on close.
  if (!pickSheetMedia.matches || open === was) return;
  if (open) {
    _sheetReturnFocus = document.activeElement;
    // Two frames out, not now: the sheet's visibility transition is still at its hidden
    // starting value on this tick, and focus() refuses an unrendered element.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (pickSheetOpen) ($("#pickSheet .pick-shclose") || $("#pickSheet"))?.focus();
    }));
  } else {
    const rf = _sheetReturnFocus;
    _sheetReturnFocus = null;
    if (rf && rf.isConnected) rf.focus({ preventScroll: true });
  }
}
// chrome.js's Escape chain asks this before the drawer: true means "I closed something".
// One layer per press: an open criterion popover first, then the sheet itself.
function pickSheetDismiss() {
  if (activeTab !== "pick" || !pickSheetOpen || !$("#pickSheet")) return false;
  if (pickPop.path !== null) dismissPickPop();
  else pickSheetSet(false);
  return true;
}
// Tab stays inside the open sheet: it's a modal on a phone, and the page behind it is
// scroll-locked but still in the tab order. Escape needs nothing here — the popover's
// keydown handles its own, and chrome.js's chain ends at pickSheetDismiss above.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || !pickSheetOpen || !pickSheetMedia.matches) return;
  const sh = $("#pickSheet");
  if (!sh) return;
  const f = [...sh.querySelectorAll("button, a[href], input, select, [tabindex]:not([tabindex='-1'])")]
    .filter((el) => !el.hidden && !el.disabled && el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (!sh.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
// How many criterion chips the tree holds, for the Criteria pill's badge — a group is its
// kids, a criterion is one, so it reads the same at any nesting depth the builder does.
function pickCritCount(node) {
  if (!node) return 0;
  return node.kids ? node.kids.reduce((n, k) => n + pickCritCount(k), 0) : (node.key ? 1 : 0);
}

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

/* What Pick is allowed to offer you: the backlog. Pick answers "what do I play tonight",
 * so it draws only from games on your sheet — a game you don't own can't be tonight's answer.
 *
 * Not the unplayable, and not the unknowns. "Playable" is tri-state on the sheet — Yes, No,
 * Unknown — and a picker that lands on a game you can't start (no console for it any more,
 * region-locked, disc rot) has answered the wrong question. Unknown goes too: it doesn't
 * mean "probably fine", it means nobody has checked, and being sent to go and check is not
 * a pick. It's the rule challenges.js already plays by, and the one health.js has been
 * telling people the picker follows. */
const pickEligible = () =>
  ((DATA.sheets.games || {}).rows || []).filter((r) => !r.completed && r.title && r.playable === "Yes");

// The pool is the backlog, so a Completed facet would offer one value ("No") — and
// pickEligible has already answered Playable, so that one would offer "Yes".
const PICK_SKIP_FIELDS = new Set(["completed", "playable"]);
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
       it allows low-priority and unreleased games — so a bucket handed over from
       Challenges has to be able to say "and it would really count". */
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
/* Which games the picker is showing right now: one in single mode, up to three in RNG.
   enrich.js re-renders this tab when an enrichment batch lands, and it needs to know
   whether the batch touched anything on screen — every batch used to repaint the tab,
   including the whole-library background poll, which meant the cards redrew every 2.5
   seconds for as long as the library was still resolving and a roll in progress got
   wiped out from under itself. */
/* What the result area was last built for. The cards carry a pop-in animation, and an
   enrichment repaint rebuilds the same games' DOM — which replayed that pop every time a
   source landed, so the picker looked like it was redrawing itself on a loop. The class
   that carries the animation is now only put on when these are actually different games
   from the ones that were on screen a moment ago. */
let _pickDrawnFor = "";
const pickResultKey = () => (pickModeRng()
  ? RNG_SLOTS.map((sl) => (rngState.picks[sl.id] || {})._k || "-").join(",")
  : ((pickState.picked || {})._k || "-"));

/* An enrichment batch landed. What the picker does about it depends on the mode and on
   whether anything on screen is actually waiting for it.

   `mine` is true when the batch carried a game the picker is showing, false for the
   whole-library backfill poll.

   The rule that matters: do NOT rebuild unless something on screen is waiting. A rebuild
   replaces the .card nodes, and preview.js's autoplay tour holds the card it is playing —
   rebuild them mid-tour and the tour stops partway through. The 45-second backfill poll
   was doing that on every tick. */
function pickEnrichLanded(mine) {
  if (!pickModeRng()) {
    // The single pick composes launchHtml, which reads this game's `stores` — a field the
    // whole-library map drops on purpose. Only the game's own batch can supply it, and
    // only a re-render puts the button on the card.
    if (mine) renderPicker();
    return;
  }
  // RNG's cards carry no launch button, so nothing here needs the DOM rebuilt — except a
  // skeleton, which is waiting for exactly this batch in order to become real cards.
  if ($("#pickResult .rng-slot.loading")) renderPicker();
  else rngPatch();
}

const pickShowsKey = (k) => (pickModeRng()
  ? RNG_SLOTS.some((sl) => (rngState.picks[sl.id] || {})._k === k)
  : !!(pickState.picked && pickState.picked._k === k));

function pickGame(roll) {
  // The single-game entry point, and the two outside callers (Home's "pick another",
  // the challenge hand-off) mean a single game — so asking for one IS asking for this
  // mode, rather than quietly rolling three because that's where the tab was left.
  pickState.mode = "one";
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
   default preset, no time budget, no roll. */
const PICK_DEFAULT_PRESET = "backlog";
const pickDefaultTree = () =>
  pickGroup("and", presetById(PICK_DEFAULT_PRESET).build());
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
  pickState.filter = pickGroup("and", p.build());
  pickState.filter.kids.forEach(snapPresetVals);
  pickState.picked = null;
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
  pop.style.position = ""; pop.style.top = ""; pop.style.bottom = "";
  pop.style.left = "0px";                    // measure from the anchored position…
  pop.style.maxHeight = "";
  pop.classList.remove("up");
  const c = chip.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  // Below if it fits, above if above fits better, and capped to the room it actually has
  // either way — it scrolls inside itself, which beats scrolling off-screen.
  const below = vh - c.bottom - PICK_POP_GAP - PICK_POP_EDGE;
  const above = c.top - PICK_POP_GAP - PICK_POP_EDGE;
  const up = pop.offsetHeight > below && above > below;

  /* In the phone sheet the builder scrolls inside .pick-shbody, whose scrollport would
     clip the pop to a sliver. Going fixed escapes the clip — the OPEN sheet carries no
     transform, so the viewport is the containing block — and the pop spills out of the
     sheet, free to take whatever the screen has below (or above) the chip. The sheet
     still scrolls under it, so it re-anchors on every scroll tick. */
  const sc = pop.closest(".pick-shbody");
  if (sc && sc.clientHeight) {
    pop.style.position = "fixed";
    pop.style.left = `${Math.round(Math.min(Math.max(c.left, PICK_POP_EDGE), vw - PICK_POP_EDGE - pop.offsetWidth))}px`;
    pop.style.top = up ? "auto" : `${Math.round(c.bottom + PICK_POP_GAP)}px`;
    pop.style.bottom = up ? `${Math.round(vh - c.top + PICK_POP_GAP)}px` : "auto";
    pop.classList.toggle("up", up);
    pop.style.maxHeight = `${Math.max(PICK_POP_MIN_H, Math.floor(up ? above : below))}px`;
    sc.onscroll = positionPickPop;
    return;
  }

  // Sideways: slide it back in, right edge first — a popover pushed off the left is
  // worse than one whose left edge stops at the margin.
  let left = 0;
  if (c.left + pop.offsetWidth > vw - PICK_POP_EDGE) left = vw - PICK_POP_EDGE - pop.offsetWidth - c.left;
  if (c.left + left < PICK_POP_EDGE) left = PICK_POP_EDGE - c.left;
  pop.style.left = `${Math.round(left)}px`;
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

/* The mode switch and the animation toggle are the only two controls both templates
   render, so they're the only two that get wired in both. Leaving the phone sheet open
   across a mode change would strand a modal over a tab that no longer has one. */
function wirePickModes(host) {
  host.querySelectorAll(".pick-mode").forEach((el) => {
    el.onclick = () => {
      if (pickState.mode === el.dataset.mode) return;
      pickState.mode = el.dataset.mode;
      closePickPop();
      pickSheetSet(false);
      renderPicker();
      nav();
    };
  });
}
function wirePickAnim() {
  const anim = $("#pickAnim");
  if (!anim) return;
  anim.onchange = (e) => {
    if (e.target.checked) localStorage.removeItem(PICK_ANIM_KEY);
    else localStorage.setItem(PICK_ANIM_KEY, "0");
  };
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

/* Where a keyboard is on the desk, opening the pop drops focus into its search field so
   you can just type. On a touch screen that same focus summons the software keyboard over
   the very popover it would search, so there the container takes the focus instead —
   tapping the field still works. */
function focusPickPop() {
  const q = $("#pkPopSearch");
  if (q && matchMedia("(hover: hover)").matches) { q.focus(); return; }
  $(pkb.sel + " .pk-pop")?.focus({ preventScroll: true });
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
      focusPickPop();
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
    if (act === "refield") { openPickPop(path, "field"); pkb.repaint(); focusPickPop(); return; }
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
TAB_RESET.pick = () => {
  closePickPop();
  pickSheetOpen = false;
  // The flag alone isn't enough: the sheet holds the page scroll-locked while its .open
  // class stands, and nothing repaints #picker between leaving the tab and the next
  // visit. Drop the class and tell the lock, or the page stays pinned under a sheet
  // that is no longer showing.
  $("#pickSheet")?.classList.remove("open");
  if (typeof syncScrollLock === "function") syncScrollLock();
  applyPreset(PICK_DEFAULT_PRESET);
};
