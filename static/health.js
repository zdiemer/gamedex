"use strict";

/* Data health — what's wrong with the spreadsheet.

   Ported from the validation/statistics selectors in zdiemer/GamesMaster and
   zdiemer/GamePicker (potential_duplicates, missing_playtime, completed_ordering,
   unknown_playability, hltb_mismatch, largest_rating_differences, …).

   Each check is a question with a list of offending rows behind it. Every row is
   clickable, so a check is a work queue: open the game, see what's missing, fix
   it in Dropbox, and it disappears on the next poll.

   Loaded after app.js; shares its globals (DATA, ENRICH, openDrawer, …). */

// `page` is per check, so opening a different one doesn't drop you on page 4 of it.
const healthState = { open: null, page: {} };

const hzGames = () => ((DATA.sheets.games || {}).rows || []).filter((r) => r.title);
const hzDone = () => ((DATA.sheets.completed || {}).rows || []);

// Same normalisation the matcher uses, far enough to spot near-duplicates.
const hzNorm = (s) => String(s || "").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]/g, "");

/* A title reduced to what a typo would actually change. Roman numerals become
   digits, "&" becomes "and", accents are stripped, and everything that isn't a
   letter or a digit goes — so only a real letter-level difference survives. */
const _ROMAN = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7",
                 viii: "8", ix: "9", x: "10", xi: "11", xii: "12", xiii: "13" };
function hzTitleKey(t) {
  return String(t || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    // Editions and tags in brackets are a different EDITION, not a different
    // spelling: "Resident Evil 4" vs "Resident Evil 4 [VR]".
    .replace(/[[(][^\])]*[\])]/g, " ")
    // A leading article is a cataloguing convention, not a typo: IGDB files it as
    // "A Total War Saga: Troy", the sheet doesn't.
    .replace(/^(a|an|the)\s+/, "")
    .replace(/&/g, "and")
    .replace(/[×x]/g, "x")
    .split(/\s+/)
    .map((w) => {
      const bare = w.replace(/[^a-z0-9]/g, "");
      return _ROMAN[bare] || bare;
    })
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

/* Collapse the ways the SAME Japanese title gets romanised, so a spelling difference
   that's really just Hepburn drift isn't mistaken for a typo. Long vowels are the big
   one — "Toukiden" vs "Tokiden", "Yuusha" vs "Yusha" — plus sokuon doubles and を.
   Applied to both sides before the edit-distance check; if the two collapse to the
   same string, it was never a misspelling. */
const hzRomaji = (s) => String(s || "")
  .replace(/ou/g, "o").replace(/wo/g, "o")
  .replace(/(.)\1+/g, "$1");            // oo/uu/aa/ii long vowels + kk/tt/pp/ss sokuon

/* Split a title into its series base and trailing sequel number, on the same
   normalised key the other checks use: "The Amazing Spider-Man 2" -> {base:
   "amazingspiderman", num: "2"}, "The Amazing Spider-Man" -> {base: "amazingspiderman",
   num: ""}. Roman numerals are already digits by the time hzTitleKey is done. */
function hzSequel(t) {
  const s = hzTitleKey(t);
  const m = s.match(/^(.+?)(\d+)$/);
  return m ? { base: m[1], num: m[2] } : { base: s, num: "" };
}
// Two titles that are the same series but a different number in it — a sequel mismatch.
function hzSequelMismatch(a, b) {
  // Fractions, superscripts and slashes turn a title's number into garbage once the
  // punctuation is stripped ("Zeit²" → zeit vs "Zeit 2" → zeit2; "ClayFighter 63⅓";
  // "Police 24/7") — those aren't sequel differences, they're notation. And a trailing
  // four-digit YEAR ("Surgeon Simulator 2013") is an edition, not a sequel.
  const notation = /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞²³¹¼-¾\/]/;
  if (notation.test(a) || notation.test(b)) return false;
  const x = hzSequel(a), y = hzSequel(b);
  if (x.base.length < 4 || x.base !== y.base || x.num === y.num) return false;
  const isYear = (n) => /^(19|20)\d\d$/.test(n);
  return !isYear(x.num) && !isYear(y.num);
}

// Levenshtein, bounded. We only care whether it's 1-2 edits, so bail out early
// rather than filling a 60x60 matrix for every one of 14,752 titles.
function hzEditDistance(a, b, max = 3) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;       // no path back under the threshold
    prev = cur;
  }
  return prev[b.length];
}

// ---- match confidence ----------------------------------------------------
// Every automatic match already carried a score and nobody ever saw it.
// MatchValidator.match_score is 0-15: 5 for matching the title at all, 5 MORE if
// that title was exact, then +1 each for platform, release date, publisher,
// developer and franchise. So >= 10 means the title matched exactly; below that
// the matcher settled for something that merely looked similar.
const CONF_EXACT = 10;

const hzConf = (r) => {
  const e = ENRICH[r._k];
  if (!e || e.manualMatch) return null;        // you picked it by hand; not ours to doubt
  if (!e.igdbId && !e.source) return null;     // nothing matched at all — that's "nometa"
  return typeof e.confidence === "number" ? e.confidence : null;
};

// The one thing that makes a bad match obvious: what it matched you TO.
const hzConfDetail = (r) => {
  const e = ENRICH[r._k] || {};
  const c = hzConf(r);
  const name = e.name && hzNorm(e.name) !== hzNorm(r.title)
    ? `matched \u201c${e.name}\u201d` : "same title";
  return `${name} \u00b7 ${c}/15 \u00b7 ${e.source || "igdb"}`;
};

// Sheet rows that a provider's wishlist still lists, matched by matchKey or IGDB id.
function hzWishOnSheet(provider) {
  const wl = (typeof WL !== "undefined" && WL) || [];
  const mine = wl.filter((w) => w.provider === provider);
  const keys = new Set(mine.filter((w) => w.matchKey).map((w) => w.matchKey));
  const igdbs = new Set(mine.filter((w) => w.igdbId).map((w) => Number(w.igdbId)));
  return hzGames().filter((r) => {
    if (keys.has(r._k)) return true;
    const e = ENRICH[r._k];
    return e && e.igdbId && igdbs.has(Number(e.igdbId));
  });
}

// [provider, hours] for every linked account whose family covers this row's
// platform (MINE_PLAT_FAMILY, mine.js — a PS5 completion isn't judged by stray
// Steam hours) and that actually clocked time. GOG and itch report no playtime,
// so they never contribute.
function hzPlatHours(r) {
  if (typeof MINE === "undefined") return [];
  const plat = String(r.platform || "").toLowerCase();
  const out = [];
  for (const [p, it] of mineEntries(r._k)) {
    const fam = MINE_PLAT_FAMILY[p];
    if (!fam || !fam.includes(plat)) continue;
    if (it.playtimeMin != null && it.playtimeMin > 0) out.push([p, it.playtimeMin / 60]);
  }
  return out;
}

// severity: "error" = almost certainly wrong · "warn" = probably worth a look ·
// "info" = just a gap you may not care about.
const HEALTH_CHECKS = [
  {
    id: "dupes", severity: "warn", sheet: "games",
    title: "Possible duplicate rows",
    why: "The same game logged twice: same title, platform, region AND release year. "
       + "A US and a JP copy, or two platforms, or two years, are genuinely different "
       + "things you own, so they're not flagged.",
    find: () => {
      const seen = new Map();
      for (const r of hzGames()) {
        // Region and year are part of what makes a row distinct: a NTSC and a PAL
        // Ocarina, or the SNES and the GBA Chrono Trigger, are not duplicates.
        const k = [hzNorm(r.title), r.platform || "", r.releaseRegion || "", r.releaseYear || ""].join("|");
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push(r);
      }
      return [...seen.values()].filter((g) => g.length > 1).flat();
    },
  },
  {
    id: "order", severity: "error", sheet: "games",
    title: "Completed before it was started",
    why: "Date Completed is earlier than Date Started, so one of the two dates is wrong.",
    find: () => hzGames().filter((r) => r.dateStarted && r.dateCompleted && r.dateCompleted < r.dateStarted),
  },
  {
    id: "future", severity: "error", sheet: "games",
    title: "Completed in the future",
    why: "Date Completed is after today.",
    find: () => {
      const today = new Date().toISOString().slice(0, 10);
      return hzGames().filter((r) => r.dateCompleted && r.dateCompleted > today);
    },
  },
  {
    id: "donenodate", severity: "warn", sheet: "games",
    title: "Completed, but no completion date",
    why: "Marked Completed with no Date Completed. It won't count toward any challenge, which all key off that date.",
    find: () => hzGames().filter((r) => r.completed && !r.dateCompleted),
  },
  {
    id: "donenotime", severity: "info", sheet: "games",
    title: "Completed, but no completion time",
    why: "Marked Completed with no Completion Time, so it's missing from the hours-played totals.",
    find: () => hzGames().filter((r) => r.completed && r.completionTime == null),
  },
  {
    id: "stalled", severity: "info", sheet: "games",
    title: "Started, never completed, not marked as playing",
    why: "Has a Date Started but isn't Completed and has no Playing Status. Abandoned, or just untracked?",
    find: () => hzGames().filter((r) => r.dateStarted && !r.completed && !r.playingStatus),
  },
  {
    id: "playingdone", severity: "error", sheet: "games",
    title: "Completed, but still marked as playing",
    why: "Completed and a Playing Status at the same time, so it'll show up in Now Playing forever.",
    find: () => hzGames().filter((r) => r.completed && r.playingStatus),
  },
  {
    id: "unknownplay", severity: "info", sheet: "games",
    title: "Playability unknown",
    why: "Playable is Unknown, so these are excluded from every challenge and from the picker.",
    find: () => hzGames().filter((r) => r.playable === "Unknown"),
  },
  {
    id: "ownednoprice", severity: "info", sheet: "games",
    title: "Owned, but no purchase price",
    why: "Missing from the spend totals and from the buy→finish gap.",
    find: () => hzGames().filter((r) => r.owned && r.purchasePrice == null),
  },
  {
    id: "wishowned", severity: "warn", sheet: "games",
    title: "Wishlisted and already owned",
    why: "You own it, so it shouldn't still be on the wishlist.",
    find: () => hzGames().filter((r) => r.wishlisted && r.owned),
  },
  {
    id: "steamwishsheet", severity: "info", sheet: "games",
    title: "On your Steam wishlist, but already on the sheet",
    why: "A game still on your Steam wishlist that is already in your library, matched by "
       + "IGDB id or title. You may already own it, or can clear it off the Steam wishlist.",
    find: () => hzWishOnSheet("steam"),
  },
  {
    id: "gogwishsheet", severity: "info", sheet: "games",
    title: "On your GOG wishlist, but already on the sheet",
    why: "A game still on your GOG wishlist that is already in your library, matched by "
       + "IGDB id or title. You may already own it, or can clear it off the GOG wishlist.",
    find: () => hzWishOnSheet("gog"),
  },
  {
    id: "hltbgap", severity: "warn", sheet: "games",
    title: "Your playtime is wildly off HowLongToBeat",
    why: "Your Completion Time differs from HLTB's main story by more than 3×. Likely a units slip (minutes for hours) or a typo.",
    find: () => hzGames().filter((r) => {
      const e = ENRICH[r._k];
      const mine = r.completionTime, theirs = e && e.hltbMain;
      if (!mine || !theirs || mine < 0.5 || theirs < 0.5) return false;
      const ratio = mine > theirs ? mine / theirs : theirs / mine;
      return ratio >= 3;
    }),
    detail: (r) => {
      const e = ENRICH[r._k] || {};
      return `you ${fmtHours(r.completionTime)} · HLTB ${fmtHours(e.hltbMain)}`;
    },
  },
  {
    id: "platplaygap", severity: "warn", sheet: "games",
    title: "Your playtime disagrees with the platform's clock",
    why: "Your Completion Time is 2× or more off the hours the platform itself recorded, "
       + "and the gap is at least an hour. Only counted when the row's platform matches the "
       + "account that clocked it — a PS5 completion isn't judged by stray Steam hours. "
       + "When several accounts clocked the same copy (the Xbox app shadow-tracks PC games "
       + "Steam already counts), only the LARGEST clock is judged, not the sum. Xbox Series "
       + "clocks also run hot: Quick Resume counts suspended time as played.",
    find: () => hzGames().filter((r) => {
      const mine = r.completionTime;
      if (!mine || mine < 0.5) return false;
      // Largest single clock, not the sum — overlapping trackers (Steam + the
      // Xbox PC app) would double-count the same sitting.
      const theirs = hzPlatHours(r).reduce((m, [, h]) => Math.max(m, h), 0);
      if (theirs < 0.5 || Math.abs(mine - theirs) < 1) return false;
      const ratio = mine > theirs ? mine / theirs : theirs / mine;
      return ratio >= 2;
    }),
    detail: (r) => {
      const parts = hzPlatHours(r)
        .map(([p, h]) => `${MINE_PROVIDERS[p].label} ${fmtHours(h)}`);
      return `you ${fmtHours(r.completionTime)} · ${parts.join(" · ")}`;
    },
  },
  {
    id: "criticgap", severity: "info", sheet: "completed",
    title: "Biggest disagreements with the critics",
    why: "Not an error, just where your score is furthest from the critics'. Worth a sanity check for typos.",
    find: () => hzDone()
      .filter((r) => r.rating != null && r.criticScore != null && Math.abs(r.rating - r.criticScore) >= 0.35)
      .sort((a, b) => Math.abs(b.rating - b.criticScore) - Math.abs(a.rating - a.criticScore)),
    detail: (r) => {
      const d = Math.round((r.rating - r.criticScore) * 100);
      return `you ${Math.round(r.rating * 100)} · critics ${Math.round(r.criticScore * 100)} · ${d > 0 ? "+" : ""}${d}`;
    },
  },
  {
    id: "nometa", severity: "info", sheet: "games",
    title: "No metadata from any source",
    why: "No IGDB, no fallback, no cover. Usually a title that needs correcting, or a manual mapping.",
    find: () => hzGames().filter((r) => {
      const e = ENRICH[r._k];
      return !e || (!e.igdbId && !e.source && !e.cover && !e.coverUrl);
    }),
  },
  {
    id: "titleonly", severity: "error", sheet: "games",
    title: "Matched on a fuzzy title and nothing else",
    why: "Confidence 5/15 or less: the matcher accepted a title that was merely SIMILAR, and nothing "
       + "corroborated it: not the platform, not the release year, not the publisher, developer or "
       + "franchise. These are where a wrong cover, a wrong score or a wrong launch link comes from. "
       + "Open one, check the matched name against yours, and pin the right game with Match manually.",
    find: () => hzGames().filter((r) => { const c = hzConf(r); return c != null && c <= 5; })
      .sort((a, b) => hzConf(a) - hzConf(b)),
    detail: hzConfDetail,
  },
  {
    id: "lowconf", severity: "warn", sheet: "games",
    title: "Low-confidence metadata match",
    why: "Confidence 6-9/15: the title was a fuzzy match rather than an exact one, though something else "
       + "agreed (platform, year, publisher…). Usually right, maybe a subtitle or a \u00ae your library spells "
       + "differently, but this is the pile worth spot-checking.",
    find: () => hzGames().filter((r) => { const c = hzConf(r); return c != null && c > 5 && c < CONF_EXACT; })
      .sort((a, b) => hzConf(a) - hzConf(b)),
    detail: hzConfDetail,
  },
  {
    id: "misspelled", severity: "warn", sheet: "games",
    title: "Title may be misspelled",
    why: "Your library's title and IGDB's differ by a letter or two, close enough to be the same game, "
       + "far enough apart that one of them is a typo. Note that it isn't always yours: IGDB spells "
       + "Slayers X as 'Vengance'. Punctuation, roman numerals, bracketed editions and leading "
       + "articles are normalized away first, so what's left is a genuine letter-level difference.",
    find: () => hzGames().filter((r) => {
      const e = ENRICH[r._k];
      if (!e || !e.name || e.manualMatch) return false;
      // Only where the match is CONFIDENT: a low-confidence match differing by two
      // characters is a bad match, not a typo, and it's already flagged as one.
      if (typeof e.confidence === "number" && e.confidence < CONF_EXACT) return false;
      /* Compare on LETTERS, not on punctuation and numerals. Raw edit distance
         flagged 665 games, and almost none were typos:

           "Helldivers II"          vs "Helldivers 2"            roman numeral
           "Command & Conquer: X"   vs "Command & Conquer X"     a colon
           "Invincible VS"          vs "Invincible Vs."          a full stop

         Those are style differences between two catalogues, not misspellings.
         Normalise them away and what's left is a genuine letter-level typo. */
      const a = hzTitleKey(r.title), b = hzTitleKey(e.name);
      if (!a || !b || a === b) return false;
      // Romanisation drift ("Toukiden" vs "Tokiden") isn't a misspelling.
      if (hzRomaji(a) === hzRomaji(b)) return false;
      // A sequel-number difference is a WRONG MATCH, not a typo — its own check.
      if (hzSequelMismatch(r.title, e.name)) return false;
      const d = hzEditDistance(a, b);
      return d > 0 && d <= 2 && Math.min(a.length, b.length) >= 10;
    }),
    detail: (r) => `library: "${r.title}" · IGDB: "${(ENRICH[r._k] || {}).name}"`,
  },
  {
    id: "sequel", severity: "warn", sheet: "games",
    title: "Matched the wrong game in a series",
    why: "The IGDB match is the same series but a different number: \"The Amazing "
       + "Spider-Man\" matched \"The Amazing Spider-Man 2\", \"Sonic the "
       + "Hedgehog\" matched \"Sonic the Hedgehog 2\". The metadata, cover and "
       + "playtime are all for the wrong game.",
    find: () => hzGames().filter((r) => {
      const e = ENRICH[r._k];
      if (!e || !e.name || e.manualMatch) return false;
      return hzSequelMismatch(r.title, e.name);
    }),
    detail: (r) => `library: "${r.title}" · IGDB: "${(ENRICH[r._k] || {}).name}"`,
  },
  {
    id: "incompletecol", severity: "info", sheet: "games",
    title: "Collections you've only partly completed",
    why: "A compilation where you've completed some of the games inside but never marked the "
       + "collection itself complete. Either there's more to play, or the parent row needs ticking.",
    find: () => {
      if (typeof buildCollections !== "function") return [];
      buildCollections();
      const out = [];
      for (const c of (typeof collectionsAll === "function" ? collectionsAll() : [])) {
        if (!c.parent || c.complete) continue;
        if (!c.members.length) continue;
        out.push(c.parent);
      }
      return out;
    },
    detail: (r) => {
      const c = typeof collectionOfParent === "function" ? collectionOfParent(r) : null;
      return c ? `${c.members.length} of its games completed, collection not marked complete` : "";
    },
  },
  {
    id: "nopriority", severity: "info", sheet: "games",
    title: "No priority set",
    why: "Priority drives the picker and the challenge candidate pool; unset rows are treated as lowest.",
    find: () => hzGames().filter((r) => !r.completed && (r.priority == null || r.priority === "")),
  },
];

const SEV = {
  error: { label: "Error", cls: "sev-error" },
  warn: { label: "Warning", cls: "sev-warn" },
  info: { label: "Gap", cls: "sev-info" },
};

let _healthResults = null;
function healthResults() {
  if (_healthResults) return _healthResults;
  return (_healthResults = HEALTH_CHECKS.map((c) => ({ c, rows: c.find() })));
}
// The page indices go too: they belong to a result set that no longer exists, and only
// the clamp in the renderer stood between a stale one and an out-of-range slice.
const resetHealth = () => { _healthResults = null; healthState.page = {}; };

function healthRowHtml(check, r, i) {
  const title = String(r.title || r.game || "");
  const bits = [r.platform, r.releaseYear].filter((x) => x != null && x !== "")
    .map((x) => escapeHtml(String(x))).join(" · ");
  const extra = check.detail ? check.detail(r) : "";
  return `<button class="hz-row" data-hc="${check.id}" data-hi="${i}">
    <span class="hz-row-t">${escapeHtml(title)}</span>
    <span class="hz-row-m">${bits}</span>
    ${extra ? `<span class="hz-row-x">${escapeHtml(extra)}</span>` : ""}
  </button>`;
}

const HZ_SHOWN = 40;      // rows per page

/* The list used to stop dead at 40 with "Showing the first 40 of 153" and no way to reach
   the other 113 — which is useless precisely when a check finds a lot, i.e. when you sit
   down to work through them. Paged now, and the page is remembered per check: fix a mapping,
   come back, and you're still on the page you were on rather than back at the top. */
function healthPager(id, total, page) {
  const pages = Math.ceil(total / HZ_SHOWN);
  if (pages <= 1) return "";
  const from = page * HZ_SHOWN + 1;
  const to = Math.min(total, (page + 1) * HZ_SHOWN);
  return `<div class="hz-pager">
    <button class="hz-pg" data-hp="${id}" data-hpn="${page - 1}" ${page === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="hz-pg-n">${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}
      <span class="muted">· page ${page + 1} of ${pages}</span></span>
    <button class="hz-pg" data-hp="${id}" data-hpn="${page + 1}" ${page >= pages - 1 ? "disabled" : ""}>Next ›</button>
  </div>`;
}

// How much of the library each metadata source has matched. This used to sit in
// every listing's result bar; it's plumbing detail, and this page is where the
// plumbing gets looked at. Reads the stats updateEnrichStatus (enrich.js) stashes.
const HZ_SOURCE_LABEL = {
  hltb: "HowLongToBeat", metacritic: "Metacritic", gameye: "GameEye",
  arcadedb: "ArcadeDB", vndb: "VNDB", thumby: "Thumby", vgchartz: "VGChartz",
  steamx: "Steam extras", speedrun: "Speedrun.com", guides: "StrategyWiki",
  cooptimus: "Co-Optimus", manuals: "Manuals", gametdb: "GameTDB",
  pcgw: "PCGamingWiki", wikidata: "Wikidata", khinsider: "Soundtracks",
};
function hzMatchDashboard() {
  const s = typeof ENRICH_STATS !== "undefined" && ENRICH_STATS;
  if (!s || !s.total) return "";
  const pill = (label, matched) =>
    `<span class="hz-pill hz-match">${escapeHtml(label)} <b>${(matched || 0).toLocaleString()}</b></span>`;
  const pills = [pill("IGDB", s.matched)];
  for (const [key, src] of Object.entries(s.sources || {})) {
    pills.push(pill(HZ_SOURCE_LABEL[key] || key, src.matched));
  }
  let queued = s.queued || 0;
  for (const src of Object.values(s.sources || {})) queued += src.queued || 0;
  return `<div class="hz-matches">
    <h2>Metadata matches <span class="muted">of ${s.total.toLocaleString()} games${
      queued ? ` · ${queued.toLocaleString()} queued` : ""}</span></h2>
    <div class="hz-summary">${pills.join("")}</div>
  </div>`;
}

function renderHealth() {
  const host = $("#health");
  if (!DATA) return;
  const results = healthResults();
  const errs = results.filter((x) => x.c.severity === "error" && x.rows.length).length;
  const warns = results.filter((x) => x.c.severity === "warn" && x.rows.length).length;
  const total = results.reduce((a, x) => a + x.rows.length, 0);

  host.innerHTML =
    `<div class="hz-head">
      <h1>Data health</h1>
      <p>${total.toLocaleString()} entries across ${results.filter((x) => x.rows.length).length} checks want a second look.
         Fix them at the source and they'll clear on the next refresh.</p>
      <div class="hz-summary">
        <span class="hz-pill sev-error">${errs} error${errs !== 1 ? "s" : ""}</span>
        <span class="hz-pill sev-warn">${warns} warning${warns !== 1 ? "s" : ""}</span>
        <span class="hz-pill sev-info">${results.filter((x) => x.c.severity === "info" && x.rows.length).length} gaps</span>
      </div>
      ${hzMatchDashboard()}
    </div>
    <div class="hz-list">` +
    results.map(({ c, rows }) => {
      const open = healthState.open === c.id;
      const sev = SEV[c.severity];
      return `<section class="hz-check${rows.length ? "" : " clean"}${open ? " open" : ""}">
        <button class="hz-check-head" data-toggle="${c.id}">
          <span class="hz-pill ${sev.cls}">${sev.label}</span>
          <span class="hz-check-t">${escapeHtml(c.title)}</span>
          <span class="hz-count">${rows.length ? rows.length.toLocaleString() : "✓ clean"}</span>
          <span class="hz-caret">${open ? "▾" : "▸"}</span>
        </button>
        ${open ? (() => {
          // Clamp: the row count shrinks as you fix things, and page 4 of a check that now
          // has two pages must not render an empty list.
          const pages = Math.max(1, Math.ceil(rows.length / HZ_SHOWN));
          const page = Math.min(healthState.page[c.id] || 0, pages - 1);
          healthState.page[c.id] = page;
          const start = page * HZ_SHOWN;
          return `<div class="hz-body">
            <p class="hz-why">${escapeHtml(c.why)}</p>
            <div class="hz-rows">${rows.slice(start, start + HZ_SHOWN)
              // The index must be ABSOLUTE — the click handler looks the row up in the full
              // list, so a page-relative one would open the wrong game from page two on.
              .map((r, i) => healthRowHtml(c, r, start + i)).join("")}</div>
            ${healthPager(c.id, rows.length, page)}
          </div>`;
        })() : ""}
      </section>`;
    }).join("") + `</div>`;

  host.querySelectorAll("[data-toggle]").forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.toggle;
      const wasOpen = healthState.open === id;
      healthState.open = wasOpen ? null : id;
      if (!wasOpen) healthState.page[id] = 0;      // a fresh open starts at the top
      renderHealth();
    };
  });
  host.querySelectorAll("[data-hp]").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      healthState.page[el.dataset.hp] = Math.max(0, +el.dataset.hpn);
      renderHealth();
      // Keep the check you're paging through under the cursor, rather than leaving you
      // halfway down a list that just changed under you.
      const sec = host.querySelector(".hz-check.open");
      if (sec) sec.scrollIntoView({ block: "nearest" });
    };
  });
  host.querySelectorAll("[data-hc]").forEach((el) => {
    el.onclick = () => {
      const res = healthResults().find((x) => x.c.id === el.dataset.hc);
      if (!res) return;
      const row = res.rows[+el.dataset.hi];
      if (row) openDrawer(row, res.c.sheet);
    };
  });
}

// Landing state (core.js): every check collapsed, back on its first page.
TAB_RESET.health = () => { healthState.open = null; healthState.page = {}; };
