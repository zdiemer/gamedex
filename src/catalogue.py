"""The IGDB catalogue — every game IGDB knows, not just the ones on the sheet.

The enricher asks IGDB one question per spreadsheet row: "what is THIS game?".
This asks the other one: "what games are there?". 369,802 of them, at the first
crawl. The sheet's 14.7k is four percent of that.

WHY IT IS CHEAP. ~740 requests at `limit 500` for pass 1 and ~170 for pass 2, all at
IGDB's 4 req/s: measured end to end at SEVEN MINUTES for the whole table, 76 MB on
the volume. Incremental sync barely earns its complexity at that price — we do it
anyway (daily, on `updated_at`) because seven minutes of someone else's rate limit
every day is rude when thirty seconds would do, and we keep the full sweep weekly
because `updated_at` cannot show you a DELETION. IGDB's own answer to deletes is a
webhook; pointing a public, unauthenticated app at one is a worse trade than
re-crawling weekly. Bulk CSV dumps would beat all of this and are Data-Partner-only.

WHY IT IS TWO PASSES. Of the 264,542 main games with cover art, only 34,248 have
any rating at all — no player score, no critic score, nothing. The predicted-rating
model's strongest features by a distance are those two outside opinions, so for the
other 231,000 it has nothing to say and would hand back your global mean for every
one of them. They are not recommendations; they are noise with a cover.

So pass 1 takes the cheap columns for all 369,802 — that is what makes "does IGDB
know this game?" answerable and what a delete sweep needs — and pass 2 takes the
expensive nested tag fields (genres, themes, keywords, companies) for only the
34,248 that can actually be ranked. Asking for nested fields on every game would
multiply the crawl's bytes by an order of magnitude to describe games nothing will
ever rank.

THIS MODULE KNOWS NOTHING ABOUT THE SPREADSHEET, deliberately. /api/catalogue is a
pure function of the crawl, so it is byte-identical for every visitor all day and
caches like a static asset. The sheet join happens in the browser, against the live
enrichment map — the only copy that is never stale, because enrichment lands
asynchronously for minutes after boot and a game can become a sheet game while you
are looking at it. See loadAllEnrichment() in panels.js.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone

from match_validator import MatchValidator

log = logging.getLogger("gamedex.catalogue")

_now = lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")

# What counts as recommendable. Main games (0) plus the three kinds of re-release that
# are their own game rather than a repackaging: standalone expansion (4), remake (8),
# remaster (9). The Resident Evil 2 remake is not the 1998 Resident Evil 2, and a
# recommender that can't tell you about it is missing the point. Bundles, DLC, mods,
# episodes, packs and updates are none of them a game you would add to the sheet.
SCOREABLE_TYPES = (0, 4, 8, 9)
# `total_rating` is IGDB's blend of the player score and the critic score, so it is
# present iff at least one of them is. Checked rather than assumed:
# `where aggregated_rating != null & total_rating = null` returns 0 games. One
# predicate, both signals.
SCOREABLE_WHERE = (
    f"game_type = ({','.join(str(t) for t in SCOREABLE_TYPES)})"
    " & cover != null & total_rating != null"
)
_SCOREABLE_SQL = (
    f"game_type IN ({','.join(str(t) for t in SCOREABLE_TYPES)})"
    " AND cover IS NOT NULL AND rating IS NOT NULL"
)

FULL_CRAWL_DAYS = 7
# Wait for the boot peak (xlsx parse, enrichment backfills) to pass before adding 740
# requests to it — the same courtesy SHELF.warm(delay=90) pays.
START_DELAY = 120
# A watermark pass this big means the cursor is wrong, or IGDB has re-indexed the
# world. Falling back to a full crawl is both more correct and, at three minutes,
# barely more expensive than the pass it abandons.
WATERMARK_MAX = 25_000

# The wire format is arrays-of-arrays, not objects: at 34k games, repeating twenty key
# names per row IS the payload. The client rehydrates against `fields`, which is sent
# with it, so the two cannot drift.
#
# Scalars first, in the order payload()'s SELECT reads them.
_SCALARS = [
    "id", "name", "norm", "slug", "year", "cover",
    "rating", "ratingCount", "userRating", "userRatingCount",
    "criticRating", "criticCount", "type",
]
# Then (payload namespace, rich-record key) for every interned vocabulary. Names repeat
# hard across 34k games — 23 genres cover the lot — so a dictionary plus int arrays is
# dramatically smaller than the strings inline.
_VOCAB = [
    ("genres", "genres"), ("themes", "themes"), ("modes", "gameModes"),
    ("persp", "perspectives"), ("devs", "developers"), ("pubs", "publishers"),
    ("frans", "franchises"), ("keywords", "keywords"), ("engines", "engines"),
]
# Derived, not restated: the column order and the vocab order are the same fact, and
# writing it twice is one edit away from silently shipping every game's genres under
# the "themes" key.
PAYLOAD_FIELDS = _SCALARS + [ns for ns, _ in _VOCAB]


class Catalogue:
    def __init__(self, igdb_client, db_path: str):
        self._igdb = igdb_client
        self._validator = MatchValidator()
        self._stop = threading.Event()
        self._db_lock = threading.Lock()
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS catalogue("
            " igdb_id INTEGER PRIMARY KEY, name TEXT NOT NULL, norm_name TEXT,"
            " slug TEXT, game_type INTEGER, year INTEGER, cover TEXT,"
            " rating REAL, rating_count INTEGER, user_rating REAL, user_rating_count INTEGER,"
            " critic_rating REAL, critic_count INTEGER,"
            " updated_at INTEGER, checksum TEXT,"
            " rich TEXT, rich_checksum TEXT, gen INTEGER)"
        )
        # The delete sweep is `WHERE gen != current`, and it runs over 370k rows.
        self._db.execute("CREATE INDEX IF NOT EXISTS cat_gen ON catalogue(gen)")
        # Partial: the scoreable set is 9% of the table and every read path filters to it.
        self._db.execute(
            f"CREATE INDEX IF NOT EXISTS cat_scoreable ON catalogue(igdb_id) WHERE {_SCOREABLE_SQL}"
        )
        self._db.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)")
        self._db.commit()

    # -- kv ------------------------------------------------------------------
    def _kv_get(self, k):
        with self._db_lock:
            row = self._db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return row[0] if row else None

    def _kv_set(self, k, v):
        with self._db_lock:
            self._db.execute("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", (k, str(v)))
            self._db.commit()

    @property
    def generation(self):
        """Bumped only when a full crawl finishes BOTH passes.

        It gates the payload and the client's cache key, so it must never name a
        half-built catalogue: during the first crawl there is a stretch where the lean
        rows are in and the tags are not, and shipping that would be shipping 34k games
        with no genres.
        """
        try:
            return int(self._kv_get("generation") or 0)
        except (TypeError, ValueError):
            return 0

    def _days_since_full(self):
        last = self._kv_get("full_crawled")
        if not last:
            return 10 ** 6                       # never crawled: do it now
        try:
            then = datetime.fromisoformat(last).date()
        except ValueError:
            return 10 ** 6
        return (datetime.now(timezone.utc).date() - then).days

    # -- writing -------------------------------------------------------------
    def _lean_row(self, c, gen):
        year = None
        if c.get("first_release_date"):
            try:
                year = datetime.fromtimestamp(c["first_release_date"], tz=timezone.utc).year
            except (OSError, ValueError, OverflowError):
                year = None                      # IGDB carries a few absurd timestamps
        pct = lambda v: round(v / 100, 4) if v is not None else None
        name = c.get("name") or ""
        # `or None`: normalize() strips to alphanumerics, and nine real IGDB games are
        # named things like "!", ":)", "^_^" and "_-_", which strip to NOTHING. An empty
        # string is a perfectly good Set key, so leaving it would let the client's
        # unmatched-title backstop (which reads normalized titles out of `_k`) match ""
        # against "" and silently suppress an unrelated game. An empty normalization is
        # not a title; it must never participate in a title join.
        norm = self._validator.normalize(name) if name else None
        return (
            c["id"], name, norm or None,
            c.get("slug"), c.get("game_type"), year,
            (c.get("cover") or {}).get("image_id"),
            pct(c.get("total_rating")), c.get("total_rating_count"),
            pct(c.get("rating")), c.get("rating_count"),
            pct(c.get("aggregated_rating")), c.get("aggregated_rating_count"),
            c.get("updated_at"), c.get("checksum"), gen,
        )

    def _upsert_lean(self, rows, gen):
        """Write pass-1 columns. Explicitly does NOT touch `rich`/`rich_checksum` —
        an upsert that clobbered them would throw away pass 2's work on every crawl."""
        vals = [self._lean_row(c, gen) for c in rows if c.get("id") and c.get("name")]
        if not vals:
            return 0
        with self._db_lock:
            self._db.executemany(
                "INSERT INTO catalogue(igdb_id,name,norm_name,slug,game_type,year,cover,"
                " rating,rating_count,user_rating,user_rating_count,critic_rating,critic_count,"
                " updated_at,checksum,gen)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(igdb_id) DO UPDATE SET"
                "  name=excluded.name, norm_name=excluded.norm_name, slug=excluded.slug,"
                "  game_type=excluded.game_type, year=excluded.year, cover=excluded.cover,"
                "  rating=excluded.rating, rating_count=excluded.rating_count,"
                "  user_rating=excluded.user_rating, user_rating_count=excluded.user_rating_count,"
                "  critic_rating=excluded.critic_rating, critic_count=excluded.critic_count,"
                "  updated_at=excluded.updated_at, checksum=excluded.checksum, gen=excluded.gen",
                vals,
            )
            self._db.commit()
        return len(vals)

    # -- the crawl -----------------------------------------------------------
    def full_crawl(self):
        """Every game, by keyset on id, then the tags for the ones worth ranking.

        Keyset rather than offset: IGDB v4 does not document an offset ceiling, but v3
        capped it at 10,000 and the cap's absence is undocumented rather than promised.
        `where id > N; sort id asc` has no such question over it, and it cannot skip or
        double-count rows when IGDB inserts mid-crawl the way a moving offset can.
        """
        # A fresh tag for THIS attempt, not `generation + 1`. The pod restarts on every
        # deploy and a full crawl takes ~15 minutes, so an abandoned attempt is routine —
        # and deriving the tag from the last SUCCESSFUL generation would hand the retry
        # the same number the abandoned attempt already wrote. Rows it saw would then
        # survive the retry's delete sweep having never been re-seen, so a game IGDB
        # dropped in between would live on. A monotonic counter makes the sweep exact.
        gen = int(self._kv_get("crawl_attempt") or 0) + 1
        self._kv_set("crawl_attempt", gen)
        started = time.monotonic()
        last_id, seen, pages = 0, 0, 0
        while not self._stop.is_set():
            try:
                page = self._igdb.catalogue_page(after_id=last_id)
            except Exception as exc:
                log.warning("catalogue: page after id=%d failed: %s", last_id, exc)
                return False
            if not page:
                break
            seen += self._upsert_lean(page, gen)
            last_id = max(int(g["id"]) for g in page)
            pages += 1
            if pages % 100 == 0:
                log.info("catalogue: %d games (id ≤ %d)", seen, last_id)
            # Be a good neighbour to the live enrichment workers: the rate limiter is
            # shared with them, so an unpaced crawl simply takes their whole budget for
            # three minutes. Same courtesy extras_for() pays.
            time.sleep(0.25)
        if self._stop.is_set():
            return False

        filled = self._fill_rich()
        if filled is None:
            # Pass 2 failed. Do NOT bump the generation — the lean rows are fine and are
            # already written, but the payload would be missing tags for whatever pass 2
            # never reached. Next run retries; the old generation keeps serving.
            log.warning("catalogue: crawl reached %d games but tags failed; generation held", seen)
            return False

        # Deletions. A row IGDB no longer returns keeps its old gen and is swept here —
        # this is the entire reason the full crawl still runs weekly once the watermark
        # pass exists, because `updated_at` can never report an absence.
        with self._db_lock:
            cur = self._db.execute("DELETE FROM catalogue WHERE gen IS NOT ?", (gen,))
            gone = cur.rowcount
            self._db.commit()

        # Hand the daily pass its cursor. Without this the watermark is never set, so
        # every watermark_pass() reads `since = 0`, falls back here, and the "daily
        # incremental" crawl is a full 370k sweep every single day, forever.
        # Read back out of the table rather than tracked through the loop: the answer is
        # one indexed MAX() and it stays right even if a page was skipped.
        with self._db_lock:
            high = self._db.execute("SELECT MAX(updated_at) FROM catalogue").fetchone()[0]
        if high:
            self._kv_set("watermark", high)

        self._kv_set("generation", gen)
        self._kv_set("full_crawled", datetime.now(timezone.utc).date().isoformat())
        self._kv_set("crawled_at", _now())
        log.info("catalogue: full crawl gen %d — %d games, %d tagged, %d deleted, %.0fs",
                 gen, seen, filled, gone, time.monotonic() - started)
        return True

    def watermark_pass(self):
        """Only what IGDB has touched since last time. Adds and edits, never deletes."""
        since = int(self._kv_get("watermark") or 0)
        if not since:
            return self.full_crawl()
        gen = self.generation
        offset, seen, high = 0, 0, since
        while not self._stop.is_set():
            try:
                page = self._igdb.catalogue_updated(since=since, offset=offset)
            except Exception as exc:
                log.warning("catalogue: watermark page at offset %d failed: %s", offset, exc)
                return False
            if not page:
                break
            # Keep these rows on the CURRENT generation: they are alive, and the weekly
            # full crawl's delete sweep must not mistake them for rows IGDB dropped.
            seen += self._upsert_lean(page, gen)
            high = max(high, max((g.get("updated_at") or 0) for g in page))
            offset += len(page)
            if offset >= WATERMARK_MAX:
                log.warning("catalogue: %d rows changed since %d — full crawl instead", offset, since)
                return self.full_crawl()
            time.sleep(0.25)
        if self._stop.is_set():
            return False

        filled = self._fill_rich()
        if filled is None:
            return False                          # leave the watermark; retry next run
        # `>=` on the read, so rows sharing the boundary second are re-seen rather than
        # skipped — many rows share an updated_at, and a strict `>` silently drops the
        # ones written after the cursor within the same second. Upserts are idempotent,
        # so the cost of re-seeing them is nil and the cost of missing them is a game
        # that never updates again.
        self._kv_set("watermark", high)
        self._kv_set("crawled_at", _now())
        if seen or filled:
            log.info("catalogue: watermark pass — %d changed, %d re-tagged", seen, filled)
        return True

    def _fill_rich(self):
        """Pass 2: the nested tag fields, for scoreable rows that lack them or whose
        checksum has moved. Returns the number written, or None if the pass failed.

        `checksum` is a per-row uuid IGDB changes when the row changes, so it answers
        "did anything actually happen here?" without re-reading the tags — which matters
        because `updated_at` gets bumped by bulk re-indexing that changes nothing we
        store.
        """
        with self._db_lock:
            need = [r[0] for r in self._db.execute(
                f"SELECT igdb_id FROM catalogue WHERE {_SCOREABLE_SQL}"
                " AND (rich IS NULL OR rich_checksum IS NOT checksum)"
            )]
        if not need:
            return 0
        log.info("catalogue: fetching tags for %d games", len(need))
        written = 0
        try:
            for batch in self._igdb.catalogue_rich(need, stop=self._stop):
                rows = [(json.dumps(v["rich"], separators=(",", ":")), v["checksum"], gid)
                        for gid, v in batch.items()]
                with self._db_lock:
                    self._db.executemany(
                        "UPDATE catalogue SET rich=?, rich_checksum=? WHERE igdb_id=?", rows)
                    self._db.commit()
                written += len(rows)
        except Exception as exc:
            log.warning("catalogue: tag pass failed after %d: %s", written, exc)
            return None
        return written

    # -- reading -------------------------------------------------------------
    def stats(self):
        with self._db_lock:
            total = self._db.execute("SELECT COUNT(*) FROM catalogue").fetchone()[0]
            scoreable = self._db.execute(
                f"SELECT COUNT(*) FROM catalogue WHERE {_SCOREABLE_SQL} AND rich IS NOT NULL"
            ).fetchone()[0]
        return {
            "enabled": True,
            "generation": self.generation,
            "total": total,
            "scoreable": scoreable,
            "crawledAt": self._kv_get("crawled_at"),
        }

    def names(self):
        """[(igdb_id, name)] for every scoreable game — what the similar-games recommender
        needs to vote for a title that isn't on the sheet. Just the two columns: it joins
        on the normalized name and would throw the rest away."""
        with self._db_lock:
            return [(r[0], r[1]) for r in self._db.execute(
                f"SELECT igdb_id,name FROM catalogue WHERE {_SCOREABLE_SQL} AND rich IS NOT NULL")]

    def payload(self):
        """The scoreable catalogue, interned and columnar. A pure function of the crawl:
        no sheet, no enrichment, no per-visitor state — so it caches like a static file."""
        vocab, index = {ns: [] for ns, _ in _VOCAB}, {ns: {} for ns, _ in _VOCAB}

        def intern(ns, name):
            i = index[ns]
            if name not in i:
                i[name] = len(vocab[ns])
                vocab[ns].append(name)
            return i[name]

        games = []
        with self._db_lock:
            # Column order here IS _SCALARS; rich comes last and is unpacked, not shipped.
            rows = self._db.execute(
                "SELECT igdb_id,name,norm_name,slug,year,cover,rating,rating_count,"
                " user_rating,user_rating_count,critic_rating,critic_count,game_type,rich"
                f" FROM catalogue WHERE {_SCOREABLE_SQL} AND rich IS NOT NULL"
            ).fetchall()
        n = len(_SCALARS)
        for r in rows:
            try:
                rich = json.loads(r[n]) or {}
            except (TypeError, ValueError):
                continue
            games.append(list(r[:n]) + [
                [intern(ns, v) for v in (rich.get(key) or []) if v] for ns, key in _VOCAB
            ])
        return {
            "enabled": True,
            "generation": self.generation,
            "generatedAt": self._kv_get("crawled_at"),
            "fields": PAYLOAD_FIELDS,
            "vocab": vocab,
            "games": games,
        }

    # -- lifecycle -----------------------------------------------------------
    def start(self):
        threading.Thread(target=self._loop, name="catalogue", daemon=True).start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        """Weekly full sweep, daily watermark. The cadence lives in the DB, not in
        memory: this process restarts on every deploy, and an in-memory counter would
        re-crawl 370k games each time — the lesson _value_loop() already learned."""
        if self._stop.wait(START_DELAY):
            return
        while not self._stop.is_set():
            try:
                if self._days_since_full() >= FULL_CRAWL_DAYS:
                    self.full_crawl()
                else:
                    self.watermark_pass()
            except Exception as exc:
                log.warning("catalogue: crawl failed: %s", exc)
            if self._stop.wait(24 * 3600):
                return
