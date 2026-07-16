"use strict";

/* Predicted rating — what you'd probably score a game you haven't played.

   A ridge regression, trained in the browser on your own rated completions. No library
   and no server: ~1,700 rows and two dozen features is a small matrix solve.

   WHAT IT LOOKS AT

     What you think    your average score for games sharing this franchise / developer /
                       publisher / genre / platform (the sheet's own columns), and the
                       same again over IGDB's MULTI-VALUED tags — a game is rarely one
                       genre, and "Metroidvania, Platformer, Adventure" says more than
                       whichever single word the sheet settled on. Themes and game modes
                       too: you have opinions about horror, and about multiplayer.

     What others think two independent verdicts, each regressed onto YOUR scale: the
                       critics, and GameFAQs' player score. They are not the same signal —
                       critics and players disagree constantly, and the gap between them
                       is itself a feature. The player score matters more than it looks:
                       across the games we actually predict for, critics cover 59% and
                       players cover 87%, so for a quarter of the backlog the players are
                       the ONLY outside opinion there is.

     What kind of game how long it is (HowLongToBeat), how old it is, and how many critics
                       bothered to review it — a decent proxy for how big a release it was.

   WHY IT ISN'T SELF-CONGRATULATORY NONSENSE

   1. SHRINKAGE. "You rated the one Bloodborne you played 100%" is not evidence that you'd
      rate every FromSoftware game 100%. Each group average is pulled toward your global
      mean in proportion to how little data backs it:

          estimate = (sum + k * globalMean) / (n + k)

   2. LEAVE-ONE-OUT, so it can't cheat. Building the training row for a game you finished
      REMOVES that game from its own group averages. Without this the model sees its own
      answer in its own features — "your average Castlevania score" would already contain
      the Castlevania we're asking about — and it would look brilliant and predict nothing.

   3. LEARNED WEIGHTS, not guessed ones — fitted by ridge rather than hand-tuned.

   4. HONEST SCORING. Five-fold cross-validation, with every encoder (the group averages,
      both calibrations, the scaler) rebuilt from the TRAINING fold alone — score a model
      against games whose ratings shaped its own features and it will flatter itself.
      Measured that way it lands near 8.8 points of average error, against 9.8 for the old
      five-feature model, 11.1 for simply quoting the critics, and 12.4 for guessing your
      average every time. (It read 9.2 when this was written and the library was smaller;
      re-measured on 1,709 rated games, and again after IGDB's player score and its VOTE
      COUNT were backfilled onto the library — see backfill_critic — worth 0.09 together.)

      That is about one notch on a scale you record in notches of five, and it is close to
      the practical floor for these features: your ratings have a standard deviation of
      16.5 points, and the best outside signal available correlates 0.64 with you. Things
      that were tried and did NOT beat this, on the same cross-validation: a weight per
      individual tag instead of shrunk group averages (300 free parameters overfits 1,700
      games), gradient-boosted trees, fitting the median instead of the mean, k-nearest
      taste neighbours, and feeding it your own wishlist flags.

   5. TWO MODELS, because there are two kinds of game to ask about. A row on the sheet has
      the sheet's columns and a playtime; a game from the IGDB catalogue — one you do not
      own, and the only kind a recommendation can be about — has neither. Reusing one model
      for both under-predicts every catalogue game by 0.66 points, silently. So `full`
      (8.78 pts) scores the backlog and `igdb` (9.09 pts) scores the catalogue, each fitted
      and cross-validated on the same rated games under its own handicap. See SCOPES.

   Loaded after app.js; shares its globals. */

const PRIOR_K = 3;               // evidence needed before a group average is trusted
const VOTE_K = 5;                // ...and before an outside score is taken at face value
const RIDGE = 0.05;              // regularisation (on standardised features)
const MIN_HISTORY = 60;          // below this we simply don't have enough to say
const CV_FOLDS = 5;

// igdbRecOf() — the record behind a row, sheet or catalogue — lives in enrich.js, beside
// the map it falls back to. Everything from launch.js's facets down needs it too.

// The sheet's single-valued columns.
const PRED_FEATURES = ["franchise", "developer", "publisher", "genre", "platform"];
// IGDB's multi-valued tags. A game carries several of each, and each one gets a vote.
const PRED_MULTI = {
  igdbGenre: (r) => igdbRecOf(r).genres || [],
  igdbTheme: (r) => igdbRecOf(r).themes || [],
  igdbMode: (r) => igdbRecOf(r).gameModes || [],
  igdbDev: (r) => igdbRecOf(r).developers || [],
  igdbPub: (r) => igdbRecOf(r).publishers || [],
  igdbFran: (r) => igdbRecOf(r).franchises || [],
  /* Keywords, perspective and engine. Measured, honestly: worth about 0.03 points on the
     same cross-validation — consistently positive across every seed, but small. They earn
     their place only because the data is already in the payload for the facets; if it cost
     a fetch it would not be worth it. The fine-grained vocabulary I expected to be a big win
     (metroidvania, soulslike) turns out to be mostly saying what genre already said.

     That verdict is for the FULL model, and the restricted one overturns it. Once the
     sheet's developer/publisher/genre columns are gone, keywords stop echoing them and
     start carrying them: dropping keywords costs the catalogue model 0.072 points, which
     is the LARGEST contribution of any vocabulary it has — ahead of publisher (0.058),
     developer (0.052) and genre (0.019). They are 14% of the catalogue payload (0.31MB)
     and they are worth it, which is the opposite of what the paragraph above predicted.

     Perspective and engine are a different story: in the restricted model they are worth
     -0.001 and -0.004, i.e. nothing, twice. They stay because they are facets in their own
     right, not because the model wants them. */
  igdbKeyword: (r) => igdbRecOf(r).keywords || [],
  igdbPersp: (r) => igdbRecOf(r).perspectives || [],
  igdbEngine: (r) => igdbRecOf(r).engines || [],
};
const PRED_MULTI_KEYS = Object.keys(PRED_MULTI);
const pnorm = (s) => String(s).trim().toLowerCase();

// The critic score. criticOf() already walks Metacritic → the sheet → IGDB → GameRankings;
// the completed sheet keeps its own copy under a different name, so fall back to that.
const predCritic = (row) => {
  const c = criticOf(row);
  if (c != null) return c;
  return row.criticScore != null ? row.criticScore : null;
};
/* What PLAYERS thought — a different opinion, not a second helping of the same one. The
   GameFAQs column lives on the GAMES sheet, so a completed row has to reach across for it;
   that join is the reason this signal sat unused, and it is the single biggest win here.

   GameFAQs goes FIRST, ahead of IGDB's community score, which is measured rather than
   assumed: on the 1,282 rated games where both exist, GameFAQs correlates 0.580 with what
   you actually scored and IGDB's community 0.560. Small, and it only became visible when
   IGDB's player score was backfilled onto the library (it had been null on 98.8% of it,
   see backfill_critic) — asking IGDB first at that point swapped 79% of the training rows
   onto the weaker signal and cost the model 0.124 points. The order is the whole fix.

   IGDB stays in the chain, last, because it is the only player score a game that is NOT on
   the sheet can possibly have: there is no GameFAQs column on a row that doesn't exist. */
/* ONE chain, three questions: what the players said, who the players were, and how many
   of them there were. All three at once, because they must never disagree — the drawer
   prints the name beside the number, the model shrinks the number by the count, and three
   parallel walks of the same fallback list would drift the first time one was reordered.
   That is not hypothetical: this label has been wrong twice already (see the `taste` flag
   below), and putting GameFAQs ahead of IGDB would have made it wrong a third time.

   `votes` is null where the source doesn't say. GameFAQs arrives as a bare column on the
   sheet with no count beside it, so a GameFAQs score cannot be judged for thinness and
   isn't shrunk — see fitEncoder. */
function playerVerdict(row) {
  const e = igdbRecOf(row);
  if (e.vnRating != null)                              // VNs: VNDB's vote count dwarfs all
    return { value: e.vnRating, source: "VNDB", votes: e.vnVotes ?? null };
  if (row.gamefaqsUserRating != null)
    return { value: row.gamefaqsUserRating, source: "GameFAQs", votes: null };
  const g = typeof rowsByK === "function" ? rowsByK().games.get(row._k) : null;
  if (g && g.gamefaqsUserRating != null)
    return { value: g.gamefaqsUserRating, source: "GameFAQs", votes: null };
  if (e.userRating != null)
    return { value: e.userRating, source: "IGDB players", votes: e.userRatingCount ?? 0 };
  return { value: null, source: null, votes: null };
}
const predPlayers = (row) => playerVerdict(row).value;
const predPlayersSource = (row) => playerVerdict(row).source;
const predPlayerVotes = (row) => playerVerdict(row).votes;
/* How many critics. criticSourceOf() already walks the same chain criticOf() does and
   already reports the count for the two sources that publish one (IGDB's aggregate and
   the GameRankings archive); Metacritic and the sheet's own column don't record one.
   Asking it rather than re-walking the chain keeps this honest for free. */
const predCriticVotes = (row) => {
  const cs = typeof criticSourceOf === "function" ? criticSourceOf(row) : null;
  return cs && cs.n != null ? cs.n : null;
};
const predLength = (row) => {
  const e = igdbRecOf(row);
  return e.hltbBest != null ? e.hltbBest : null;
};

/* WHAT A CATALOGUE GAME CAN ACTUALLY ANSWER WITH.

   These are deliberately meaner than the two above, and it matters more than it looks.
   predCritic() walks Metacritic → your sheet → IGDB → the GameRankings archive; a game
   that is not on the sheet has only IGDB's aggregate, because every other link in that
   chain is keyed on a match key it doesn't have. Same for the players: no GameFAQs
   column, no VNDB, just IGDB's own community score.

   Training the restricted model on the FULL chain and then predicting with IGDB's
   aggregate alone would fit the calibration to one distribution and apply it to a
   different one — Metacritic and IGDB's critic aggregate are neither the same scale nor
   the same coverage. So the model that scores catalogue games is trained on exactly the
   signals a catalogue game has, and its error bar is honest about it. */
const catCritic = (row) => {
  const e = igdbRecOf(row);
  return e.criticRating != null ? e.criticRating : null;
};
const catPlayers = (row) => {
  const e = igdbRecOf(row);
  return e.userRating != null ? e.userRating : null;
};
/* `?? 0`, not `?? null`, and the difference matters for a quarter of the catalogue.
   null means "this source doesn't publish a count, so we can't judge it" — true of
   Metacritic and of the sheet's own columns, and the reason those aren't shrunk. IGDB is
   not one of those sources: it publishes rating_count for everything, so a missing count
   is not a mystery, it is a zero.

   And it hands back ratings with no voters behind them, in bulk: 8,394 of the 34,247
   scoreable games (24.5%) carry a user_rating whose count is 0 or absent — "East vs. West"
   is rated 20% by nobody at all. Read as null those would sail through unshrunk at full
   weight; read as zero they collapse to the mean, which is the only defensible thing to do
   with a score no one gave. */
const catCriticVotes = (row) => igdbRecOf(row).criticCount ?? 0;
const catPlayerVotes = (row) => igdbRecOf(row).userRatingCount ?? 0;

/* THE TWO WORLDS A PREDICTION CAN LIVE IN.

   A row on the sheet and a game from the IGDB catalogue are not the same kind of thing.
   The sheet's five single-valued columns and HowLongToBeat's playtime exist for one and
   not the other; a catalogue game has no platform at all, because IGDB keeps one entry
   per game where the sheet keeps one row per platform copy.

   The tempting move is to feed the missing features the global mean and reuse the one
   model. That is wrong in a way that does not announce itself. `developer` and `igdbDev`
   say nearly the same thing — measured on this library, r = 0.775, and 0.72 for
   publisher, 0.74 for franchise — and ridge SPLITS weight across collinear features,
   which is precisely why standardise() exists in this file. Kill the sheet half of each
   pair at prediction time and the surviving half carries a coefficient that was fitted
   expecting help.

   Measured, scoring all 1,709 rated games as if each were a catalogue entry, identical
   inputs either way and only the fitted feature set differing:

       naive  (full model, absent features -> mean)   9.40 pts, bias -0.65
       proper (fitted on what is actually there)      9.09 pts, bias +0.01

   So the honest version is worth 0.31 points — but the bias is the real story. The naive
   model under-predicts EVERY catalogue game by two thirds of a point, silently, and a
   recommender that shades everything down is one that never recommends anything. The
   restricted model is unbiased.

   So: two models, fitted on the same rated completions, cross-validated the same way.
   One may use everything (8.78 pts). The other is restricted to what a catalogue game
   carries (9.09 pts), so its weights are fitted in the world it will actually predict in
   — and 9.09 is the only honest number to quote next to a recommendation. Restriction
   costs 0.31 points against a sheet row, and the result still beats quoting IGDB's
   critics by 19% and guessing your average by 27%.

   ONE CAVEAT ON THAT 9.09, because it is an average over the wrong population. The model
   is far better on games people have actually voted on:

       < 10 voters   12.23 pts   (i.e. barely better than guessing your average, 12.45)
       10-99          8.15 pts
       >= 100         6.95 pts

   and 70% of the catalogue has fewer than ten voters. VOTE_K is why those numbers aren't
   worse, and it cannot make them good: there is no information in two votes. What saves
   the ranking is that those games cannot reach the top of it — with no outside opinion
   worth believing, the model parks them at your mean rather than at 90%, so the noise
   sits in the middle of the list and not the head. Measured on the real catalogue, the
   top 50 recommendations are 6% thin and the top 200 are 19%. Quote 9.09, but do not
   promise it for an obscure game — that is what the confidence bar is for, and it now
   knows the difference. */
const SCOPES = {
  // A row on the sheet: everything we know about anything.
  full: {
    columns: PRED_FEATURES,
    critic: predCritic, criticVotes: predCriticVotes,
    players: predPlayers, playerVotes: predPlayerVotes,
    length: predLength,
  },
  // A game from the IGDB catalogue: IGDB's tags and IGDB's two opinions, full stop.
  igdb: {
    columns: [],
    critic: catCritic, criticVotes: catCriticVotes,
    players: catPlayers, playerVotes: catPlayerVotes,
    length: null,
  },
};
const scopeFor = (row) => (row && row._igdb ? SCOPES.igdb : SCOPES.full);

/* WHEN you rated it, which turns out to matter more than almost anything else about the
   game. Your standard has tightened relentlessly: you averaged 82 in 2009 and 59 in 2025.
   A model blind to that is fitting a 17-year average of a moving target — and, worse, it
   quietly predicts on the OLD scale. Trained on games finished before 2024 and asked about
   the ones since, the previous model came out 4.2 points too generous, every time.

   So the year is a feature. For a game you HAVE rated it's the year you rated it; for one
   you haven't, it is now — because the question is what you'd make of it today, not what
   2013-you would have said. */
const NOW_YEAR = new Date().getFullYear();
const ratedYear = (row) => {
  const d = row.date || row.dateCompleted;
  const y = d ? +String(d).slice(0, 4) : NaN;
  return Number.isFinite(y) ? y : null;
};

let _model = null;
let _multiStats = null;
const resetTaste = () => { _model = null; _multiStats = null; PRED_CACHE = new WeakMap(); };

// ---- linear algebra (a library would be heavier than the maths) -------------
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  // row[i] IS the pivot — `row[i][i]` indexes into a number and yields undefined,
  // which quietly turns the whole solve into NaN (it did).
  return M.map((row, i) => row[n] / row[i]);
}

// Standardise before fitting. Most features here are "your average score for games like
// this", so they all sit in a tight band around your global mean (~0.70) and are near
// collinear. Ridge on raw features of that shape is pathological: it shrinks every
// coefficient to nothing and the intercept eats the whole prediction, which is exactly what
// happened — the first version predicted ~70% for everything and lost to quoting Metacritic.
function standardise(X) {
  const d = X[0].length - 1;               // last column is the intercept
  const mu = new Array(d).fill(0), sd = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    let m = 0;
    for (const row of X) m += row[j];
    mu[j] = m / X.length;
    let v = 0;
    for (const row of X) v += (row[j] - mu[j]) ** 2;
    sd[j] = Math.sqrt(v / X.length) || 1;  // a constant column stays constant
  }
  return (row) => row.map((v, j) => (j < d ? (v - mu[j]) / sd[j] : 1));
}

function ridgeFit(X, y, lambda) {
  const d = X[0].length;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < d; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k < d; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  // Penalise the standardised features, never the intercept (the last column).
  for (let j = 0; j < d - 1; j++) A[j][j] += lambda;
  return solve(A, b) || new Array(d).fill(0);
}

const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const med = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* An ENCODER is everything learned from a set of games: the group averages, the two
   calibrations, the length median. Built from a training set alone, then applied to games
   it has never seen. Cross-validation rebuilds one per fold; the live model builds one from
   everything you have rated. */
function fitEncoder(train, scope = SCOPES.full) {
  const global = avg(train.map((r) => r.rating));

  const single = {};
  for (const f of scope.columns) {
    const m = new Map();
    for (const r of train) {
      const v = r[f];
      if (!v) continue;
      const e = m.get(v) || { sum: 0, n: 0 };
      e.sum += r.rating; e.n += 1;
      m.set(v, e);
    }
    single[f] = m;
  }
  const multi = {};
  for (const f of PRED_MULTI_KEYS) {
    const m = new Map();
    for (const r of train) {
      for (const raw of PRED_MULTI[f](r)) {
        const v = pnorm(raw);
        const e = m.get(v) || { sum: 0, n: 0 };
        e.sum += r.rating; e.n += 1;
        m.set(v, e);
      }
    }
    multi[f] = m;
  }

  // An outside score, regressed through your own bias: you rate ~70 where critics say ~80,
  // so handing back their number would be wrong by ten points every time.
  const calib = (get) => {
    const pairs = train.filter((r) => get(r) != null).map((r) => [get(r), r.rating]);
    if (pairs.length <= 30) return { est: () => null, n: pairs.length, slope: 0, intercept: global };
    const mx = avg(pairs.map((p) => p[0])), my = avg(pairs.map((p) => p[1]));
    let num = 0, den = 0;
    for (const [x, y] of pairs) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
    const slope = den > 1e-9 ? num / den : 0;
    const intercept = my - slope * mx;
    return {
      est: (v) => (v == null ? null : Math.max(0.15, Math.min(1, slope * v + intercept))),
      n: pairs.length, slope, intercept,
    };
  };
  /* HOW MANY PEOPLE ARE BEHIND THAT NUMBER.

     A 95% from two voters and a 95% from five thousand were the same fact to this model,
     and they are not. Shrink each outside opinion toward its own source's mean in
     proportion to how little backs it — the same (n·v + k·prior)/(n + k) already applied
     to group averages twenty lines down, pointed at votes instead of games.

     Measured on the catalogue model, which is where it bites: 9.21 -> 9.09 overall and
     better in every bucket (<10 voters 12.34 -> 12.23, 10-99 8.35 -> 8.15, >=100
     6.98 -> 6.95); the full model gains 0.03. The optimum is a plateau from ~3 to ~10 and
     decays past 20, so VOTE_K is the middle of a flat region, not a fitted constant.

     It does not rescue a thinly-voted game. Nothing can: there is no information in two
     votes, and the honest error there stays ~12.2 against 12.45 for simply guessing your
     average. What it buys is that the model stops FOLLOWING those two votes — which
     matters for what reaches the top of a ranking far more than it shows up in an MAE.
     70% of the IGDB catalogue has fewer than ten voters.

     A null count means the source doesn't publish one (Metacritic, and the sheet's own
     GameFAQs column). Those aren't shrunk: we can't judge what we can't see, and a
     Metacritic aggregate is a panel of professionals rather than a community thumbs-up. */
  const meanOf = (get) => avg(train.map(get).filter((v) => v != null)) || global;
  const cMean = meanOf(scope.critic), uMean = meanOf(scope.players);
  const byVotes = (v, n, mean) =>
    v == null ? null : n == null ? v : (n * v + VOTE_K * mean) / (n + VOTE_K);
  const criticVal = (row) => byVotes(scope.critic(row), scope.criticVotes(row), cMean);
  const playersVal = (row) => byVotes(scope.players(row), scope.playerVotes(row), uMean);

  const C = calib(criticVal);
  const U = calib(playersVal);
  const lenMed = scope.length ? med(train.map(scope.length).filter((v) => v != null)) : 0;
  const midYear = med(train.map(ratedYear).filter((v) => v != null)) || NOW_YEAR;

  const shrink = (sum, n) => (n < 1 ? null : (sum + PRIOR_K * global) / (n + PRIOR_K));

  // A group average with `self` excluded — leave-one-out during training, a plain average
  // at prediction time (when the game isn't in the data anyway).
  const groupEst = (f, value, self) => {
    const e = single[f].get(value);
    if (!e) return null;
    return shrink(e.sum - (self ? self.rating : 0), e.n - (self ? 1 : 0));
  };
  // The multi-valued version: every tag the game carries votes, weighted by how many of
  // your games back it, so a well-evidenced "Metroidvania" outvotes a one-off tag.
  const multiEst = (f, row, self) => {
    const vals = PRED_MULTI[f](row);
    if (!vals.length) return null;
    let acc = 0, wsum = 0;
    for (const raw of vals) {
      const e = multi[f].get(pnorm(raw));
      if (!e) continue;
      const n = e.n - (self ? 1 : 0);
      const est = shrink(e.sum - (self ? self.rating : 0), n);
      if (est == null) continue;
      const w = Math.min(n, 50);
      acc += w * est; wsum += w;
    }
    return wsum ? acc / wsum : null;
  };

  const featurise = (row, self) => {
    const xs = [];
    for (const f of scope.columns) xs.push(groupEst(f, row[f], self) ?? global);
    for (const f of PRED_MULTI_KEYS) xs.push(multiEst(f, row, self) ?? global);

    const c = criticVal(row), u = playersVal(row);
    const ce = C.est(c), ue = U.est(u);
    xs.push(ce ?? global);
    xs.push(c != null ? 1 : 0);            // whether we have a critic score at all
    xs.push(ue ?? global);
    xs.push(u != null ? 1 : 0);
    // An outside verdict needn't map onto yours in a straight line — you may be harsher on
    // mediocre games than you are generous with great ones. A hinge each way lets it bend.
    const cd = (ce ?? global) - global, ud = (ue ?? global) - global;
    xs.push(Math.max(0, cd)); xs.push(Math.max(0, -cd));
    xs.push(Math.max(0, ud)); xs.push(Math.max(0, -ud));
    // Where critics and players DISAGREE is exactly where either one alone misleads.
    xs.push(ce != null && ue != null ? ce - ue : 0);

    // Omitted, not defaulted, when the scope has no playtime: standardise() would turn a
    // constant column into a zero contribution anyway, so feeding it lenMed for every row
    // is a column of nothing that still costs a coefficient to fit.
    if (scope.length) {
      const h = scope.length(row);
      xs.push(Math.log1p(h != null ? h : lenMed));      // length has a long tail, so log it
    }
    const yr = row.releaseYear ? +row.releaseYear : null;
    xs.push(yr ? (yr - 2005) / 10 : 0);
    const cc = igdbRecOf(row).criticCount;
    xs.push(cc != null ? Math.log1p(cc) : 0);           // how reviewed = how big a release

    // Your drifting standard. Three cases, and getting the middle one wrong quietly ruins
    // the feature: a rated game with a date sits in the year you rated it; a rated game
    // with NO date (451 of them) sits in the middle of your history, because dumping it on
    // "today" tells the model you handed out 85s this year when you didn't; and an unplayed
    // game sits TODAY, because the question is what you'd make of it now.
    const ry = ratedYear(row) ?? (row.rating != null ? midYear : NOW_YEAR);
    xs.push((ry - 2015) / 10);

    xs.push(1);                                          // intercept
    return xs;
  };

  // "Your usual" is not your seventeen-year average — it is what you'd give an ordinary
  // game NOW. The verdict ("better than your usual") is read against this, or every
  // prediction would look like a disappointment purely because you've grown harsher.
  const recent = train.filter((r) => (ratedYear(r) ?? 0) >= NOW_YEAR - 3).map((r) => r.rating);
  const baselineNow = recent.length >= 30 ? avg(recent) : global;

  return { global, baselineNow, featurise, groupEst, single, multi, critic: C, players: U, scope };
}

// Fit the weights, using leave-one-out features so the model never sees its own answer.
function fitWeights(train, enc) {
  const X = train.map((r) => enc.featurise(r, r));
  const y = train.map((r) => r.rating);
  const scale = standardise(X);
  const w = ridgeFit(X.map(scale), y, RIDGE * X.length);
  return (xs) => scale(xs).reduce((a, v, i) => a + v * w[i], 0);
}

// ---- the model -------------------------------------------------------------
/* Fit one scope: cross-validate it, then train it on everything.

   Five-fold CV. The encoder is rebuilt inside the loop on purpose: the group averages are
   themselves learned from your ratings, so a model scored against games that shaped its
   own features would be marking its own homework.

   Both scopes are scored on the SAME games — your rated completions — because those are
   the only games whose answer we know. The restricted scope simply isn't allowed to look
   at the sheet columns while doing it, which is exactly the handicap it will run under
   when it meets a game that has none. */
function fitScope(done, scope) {
  const errs = [], errsMean = [], errsCritic = [];
  for (let f = 0; f < CV_FOLDS; f++) {
    const train = done.filter((_, i) => i % CV_FOLDS !== f);
    const test = done.filter((_, i) => i % CV_FOLDS === f);
    if (train.length < MIN_HISTORY || !test.length) continue;
    const enc = fitEncoder(train, scope);
    const predict = fitWeights(train, enc);
    for (const r of test) {
      const p = Math.max(0, Math.min(1, predict(enc.featurise(r, null))));
      errs.push(Math.abs(p - r.rating));
      errsMean.push(Math.abs(enc.global - r.rating));
      const c = scope.critic(r);
      errsCritic.push(Math.abs((c != null ? c : enc.global) - r.rating));
    }
  }

  // The live model: trained on everything you have rated.
  const enc = fitEncoder(done, scope);
  const predict = fitWeights(done, enc);
  const mae = avg(errs), maeMean = avg(errsMean), maeCritic = avg(errsCritic);

  return {
    global: enc.global,
    baselineNow: enc.baselineNow,
    stats: enc.single,
    multi: enc.multi,
    featurise: enc.featurise,
    groupEst: enc.groupEst,
    predict,
    scope,
    critic: { slope: enc.critic.slope, intercept: enc.critic.intercept, est: enc.critic.est, n: enc.critic.n },
    players: { est: enc.players.est, n: enc.players.n },
    eval: {
      mae, maeMean, maeCritic,
      liftVsMean: 1 - mae / (maeMean || 1),
      liftVsCritic: 1 - mae / (maeCritic || 1),
      tested: errs.length,
      folds: CV_FOLDS,
    },
  };
}

function tasteModel() {
  if (_model) return _model;
  const done = ((DATA.sheets.completed || {}).rows || []).filter((r) => r.rating != null);
  if (done.length < MIN_HISTORY) return (_model = { ok: false, n: done.length });

  // The full scope is spread at the top level so every existing caller (the Stats panel's
  // homework, the drawer's error bar) keeps reading `m.eval` / `m.n` and means the same
  // thing by it. `m.igdb` is the restricted twin — a different model with a different,
  // worse, and correct error bar, and the one a recommendation must quote.
  const full = fitScope(done, SCOPES.full);
  let igdb = null;
  return (_model = {
    ok: true, n: done.length, ...full,
    /* Lazily fitted, and it has to be. The restricted twin is another five folds of
       cross-validation — measured at +181ms, 68% on top of the full model — and
       tasteModel() sits behind the grid's Predicted facet, so it runs for anyone who
       opens All Games. Someone who never opens Recommendations should not pay to fit a
       model they never ask a question of. Fitted on first access, then held with the
       rest of the model until resetTaste(). */
    get igdb() {
      if (!igdb) igdb = fitScope(done, SCOPES.igdb);
      return igdb;
    },
  });
}

// ---- prediction ------------------------------------------------------------
function predictRating(row) {
  if (!row || row.completed || row.rating != null) return null;
  const top = tasteModel();
  if (!top.ok) return null;
  // A catalogue game gets the model fitted for what a catalogue game has. Everything
  // downstream — the working, the confidence, the verdict — reads off THIS one, so the
  // number and its explanation can never come from different models.
  const m = row._igdb ? top.igdb : top;

  // Which signals do we actually have for this game? A prediction resting on nothing but
  // the global mean isn't a prediction. (For a catalogue game `columns` is empty, so this
  // rests entirely on the tags and the two outside opinions — as it should.)
  const have = m.scope.columns.filter((f) => row[f] && m.stats[f].has(row[f]));
  // The RAW scores, for the working: the bars report what the critics and the players
  // actually said. The shrunk versions are the model's private business (see VOTE_K) —
  // printing "IGDB players gave it 78" when IGDB says 95 would be inventing a quote.
  const mc = m.scope.critic(row);
  const pl = m.scope.players(row);
  const mcN = m.scope.criticVotes(row);
  const plN = m.scope.playerVotes(row);
  const nTags = PRED_MULTI_KEYS.reduce((a, f) => a + PRED_MULTI[f](row).length, 0);
  if (!have.length && mc == null && pl == null && !nTags) return null;

  const score = Math.max(0, Math.min(1, m.predict(m.featurise(row, null))));

  /* Structured, not a sentence: the UI renders these as bars against your baseline, so you
     can see at a glance which signals pulled the number up and which dragged it down.

     Deduped, because developer and publisher are frequently the same company and "80% on
     Blizzard" twice makes the model look like it's padding. */
  const signals = [];
  const said = new Set();
  const KIND = {
    franchise: "Series", developer: "Developer", publisher: "Publisher",
    genre: "Genre", platform: "Platform",
  };
  /* `taste` marks the signals that are things YOU have scored — the only ones that can
     honestly appear in "you rate X higher than most of what you own".

     This is a flag rather than the UI excluding kinds by name, because excluding by name
     has now broken twice: the sentence claimed "you rate Metacritic higher", and when the
     player score arrived it went straight back to claiming "you rate User score higher".
     You don't rate Metacritic; Metacritic rates the game. A blacklist has to be updated
     every time a new outside opinion is added, and it won't be. */
  for (const f of have) {
    const e = m.stats[f].get(row[f]);
    if (e.n < 2 || said.has(pnorm(row[f]))) continue;
    said.add(pnorm(row[f]));
    signals.push({ kind: KIND[f], label: String(row[f]), value: e.sum / e.n, n: e.n, taste: true });
  }
  // The IGDB tags — the genres and themes the sheet's single-word column never named, and
  // now a real part of the number, so they belong in the working too.
  for (const [f, kind] of [["igdbGenre", "Genre"], ["igdbTheme", "Theme"],
                           ["igdbPersp", "Perspective"], ["igdbKeyword", "Keyword"]]) {
    for (const raw of PRED_MULTI[f](row)) {
      const e = m.multi[f].get(pnorm(raw));
      // Keywords are fine-grained, so a handful of games behind one says nothing. Ask more
      // of them than of a genre before letting one explain a number.
      const floor = f === "igdbKeyword" ? 8 : 5;
      if (!e || e.n < floor || said.has(pnorm(raw))) continue;
      said.add(pnorm(raw));
      signals.push({ kind, label: String(raw), value: e.sum / e.n, n: e.n, taste: true });
    }
  }
  if (mc != null) {
    // Name the source that actually answered — the score may be Metacritic, IGDB's critic
    // aggregate, or the GameRankings archive, and calling all three "Metacritic" lies.
    // A catalogue game has only ever been asked IGDB, so don't send criticSourceOf() to
    // walk a chain of sources keyed on a match key it hasn't got.
    const cs = row._igdb ? { label: "IGDB critics" }
      : (typeof criticSourceOf === "function" ? criticSourceOf(row) : null);
    signals.push({ kind: "Critics", label: (cs && cs.label) || "Critics", value: mc, n: mcN, taste: false });
  }
  if (pl != null) {
    // Same courtesy: say who the players actually are — asked of the chain itself rather
    // than re-derived here, so the name can't drift from the number.
    const src = m.scope === SCOPES.igdb ? "IGDB players" : predPlayersSource(row);
    signals.push({ kind: "Players", label: src, value: pl, n: plN, taste: false });
  }

  /* Confidence counts EVIDENCE, not signals. A score from two voters and one from five
     thousand both used to count as "1 outside opinion", so an obscure game could present
     itself exactly as confidently as Elden Ring while the model was quietly discounting
     the very number it was citing. Weight each outside opinion by the fraction of itself
     the model actually believed — n/(n + VOTE_K), the same weight the shrinkage gave it —
     so the confidence bar and the arithmetic finally agree. A source that publishes no
     count keeps its full vote: no reason to doubt it, just no way to check. */
  const believed = (n) => (n == null ? 1 : n / (n + VOTE_K));
  const evidence = have.length
    + (mc != null ? believed(mcN) : 0)
    + (pl != null ? believed(plN) : 0)
    + (nTags ? 1 : 0);
  /* An opinion nobody actually held is not part of the working. IGDB publishes 8,394
     ratings with zero voters behind them; shrinkage already discounts those to nothing, so
     listing "IGDB players (0) gave it 70" as a reason would be citing a factor that
     provably did not factor — the panel's one job is to explain the number it sits next
     to, and this is the same "the named factors MUST agree" rule as the verdict above. */
  const cited = signals.filter((sg) => sg.taste || sg.n !== 0);
  return {
    score,
    // Two different lines, and they are not interchangeable. The VERDICT is read against
    // what you'd give an ordinary game today; the per-signal bars are all-time group
    // averages, so they're read against your all-time average.
    baseline: m.baselineNow,
    baselineAllTime: m.global,
    confidence: Math.min(1, evidence / 5),
    signals: cited
      .sort((a, b) => Math.abs(b.value - m.global) - Math.abs(a.value - m.global))
      .slice(0, 5),
  };
}

let PRED_CACHE = new WeakMap();
function predictedCached(row) {
  if (PRED_CACHE.has(row)) return PRED_CACHE.get(row);
  const p = predictRating(row);
  PRED_CACHE.set(row, p);
  return p;
}
const predictedOf = (row) => (predictedCached(row) || {}).score ?? null;
