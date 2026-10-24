"use strict";

/* Timeline — your gaming life, in order.

   1,707 completions with covers, scores and reviews, and until now the only way
   to see them was a paginated table. This is the emotional version: scroll
   through the whole thing, year by year, and watch your taste change.

   It's a VIEW MODE on the Completed tab rather than another tab — it's the same
   rows, sorted by date, and it respects whatever filters and search are active.

   Loaded after app.js; shares its globals (DATA, ENRICH, openDrawer, …). */

const TL_SNIPPET = 190;                     // characters of review shown inline
const TL_BATCH = 12;
let _tlSpy = null, _tlLoad = null, _tlRun = 0;
function disposeTimeline() {
  ++_tlRun;
  _tlSpy?.disconnect();
  _tlLoad?.disconnect();
  _tlSpy = _tlLoad = null;
}
const _tlDateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
function tlDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(iso + "T00:00:00");
  return Number.isNaN(date.getTime()) ? "Invalid Date" : _tlDateFormat.format(date);
}
// Set by timelineJumpToDay() and consumed by the next render — the entries don't exist
// until renderTimeline has painted, so the request has to outlive the navigation.
let _tlPendingDay = null;

/* Jump the Completed timeline to one day (the Stats heatmap's day cells).

   Filtering to the day was the other option and it's worse: you'd lose the run of games
   around it, which is the thing a timeline is for. This lands you on the date with its
   neighbours still there.

   Forces the timeline view and the default date sort, because neither a grid nor an
   A–Z bucketing has a place to land. Both are part of the tab's landing state anyway, so
   a deliberate navigation was going to reset them. */
function timelineJumpToDay(iso) {
  _tlPendingDay = iso;
  goTab("completed", () => {
    const st = tabState.completed;
    st.view = "timeline";
    st.sort = null;              // → DEFAULT_SORT.completed, date desc (table.js)
  });
}

function tlYearOf(r) {
  const y = String(r.date || "").slice(0, 4);
  return /^\d{4}$/.test(y) ? +y : null;
}

// The timeline buckets by whatever the sort is (date → years, Title → A–Z, Platform → each
// platform, Rating → bands …), so the label a row falls under depends on the active sort's
// primary key/type. Same shape as the grid's facet buckets, tuned for section headings.
function tlRatingBand(v) {
  if (v == null) return "Unrated";
  const pct = v * 100;
  return pct >= 90 ? "90–100%" : pct >= 80 ? "80–89%" : pct >= 70 ? "70–79%"
    : pct >= 60 ? "60–69%" : "Below 60%";
}
function tlBucketLabel(r, spec) {
  const key = spec.key;
  // A virtual sort has no cell to read — its value comes from the accessor, and
  // its bands from what the value is: ratings band like Rating, hours bucket
  // like Play Time. Without this every row fell into one "—" section.
  const vs = spec.kind && VIRTUAL_SORTS.find((s) => s.kind === spec.kind);
  if (vs) {
    const v = vs.get(r);
    if (vs.kind === "esttime") return v != null ? (bucketLabel(+v, PLAYTIME_BUCKETS) || "—") : "Unknown";
    return tlRatingBand(v);              // predicted / critic / user are all 0–1
  }
  const type = spec.type || (typeof colByKey === "function" ? (colByKey(key) || {}).type : null);
  if (key === "game" || key === "title") {
    // Strip diacritics first, so "Ōkami" buckets under O (and sits contiguously with the other
    // O's — cmpBy sorts titles accent-insensitively, so the label has to agree or you get a
    // stray "#" wedged mid-alphabet).
    const c = String(r.game || r.title || "").trim().normalize("NFD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : "#";
  }
  const v = r[key];
  if (type === "date") { const y = String(v || "").slice(0, 4); return /^\d{4}$/.test(y) ? y : "Undated"; }
  if (type === "rating") return tlRatingBand(v);
  if (type === "hours") return v != null ? (bucketLabel(+v, PLAYTIME_BUCKETS) || "—") : "Unknown";
  if (type === "bool") return v ? "Yes" : "No";
  if (type === "year" || type === "int") return (v != null && v !== "") ? String(v) : "—";
  return (v != null && v !== "") ? String(v) : "—";
}

function tlSnippet(notes) {
  if (!notes) return "";
  const s = String(notes).replace(/\s+/g, " ").trim();
  if (s.length <= TL_SNIPPET) return s;
  // Cut on a word boundary, not mid-word.
  return s.slice(0, s.lastIndexOf(" ", TL_SNIPPET)) + "…";
}

function tlFull(notes) {
  // Keep the review's line breaks — the paragraphs are how it was written. Collapse
  // only runs of blank lines and trailing spaces; the CSS renders it with pre-line.
  return notes
    ? String(notes).replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : "";
}
