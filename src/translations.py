"""Translation Watch — a feed of newly English-translated games.

The sheet already knows WHETHER a game is playable in English: parse.py's tri-state
`english` column (None / Partial / Full, blank = natively English). What it cannot know
is WHEN that changes. A Japan-only game sitting in the collection marked `english: None`
is, as far as the sheet is concerned, permanently unplayable — even on the week somebody
finally finishes translating it.

This module closes that loop. It polls the two active ROM-translation sites, keeps
English releases, resolves each one to the underlying GAME in IGDB, and cross-references
the result against the collection so that "a game you own just became playable" is an
alert rather than one row in a feed of seven thousand.

SHAPE
-----
Two clients (rhdi.py, romhackplaza.py) do transport and parsing and nothing else. This
module owns the SQLite store on the PVC, the cadence, the matching ladder, the sheet
cross-reference, and the API payload. It is modelled on catalogue.py: cadence lives in a
kv table rather than in memory, because this process restarts on every deploy and an
in-memory counter would re-crawl everything each time.

TWO IDENTITIES, AND CONFLATING THEM IS THE TRAP
-----------------------------------------------
`cluster_id` is a GAME (normalized title + platform). It drives IGDB resolution and the
sheet cross-reference. Two rival translations of the same game share it — correctly, and
usefully: resolving a cluster costs one IGDB search no matter how many patches target it.

`group_id` is a PATCH (a cluster plus an intersecting author set). The same translation
posted to both sites is one group with two source links. Two different authors both
translating Yu-Gi-Oh! Duel Monsters 4 — which is on page one of the live listing — are
two groups inside one cluster, and collapsing them would silently hide somebody's work.

WHAT IS DELIBERATELY NOT STORED
-------------------------------
Alert state. There is no `alert` column and no snapshot of the sheet's `english` value.
Alert-ness is re-derived from the live spreadsheet on every pass, so when you apply the
patch and flip the cell to Full, the alert disappears on the next workbook poll — for
free, and precisely because nothing was persisted. The only thing kept is a kv `seen_at`
for the nav badge.

TRAPS
-----
* **Cold-start alert storm.** On an empty database all ~7,000 entries are "new". Without
  care the feature introduces itself with several hundred alerts. The first crawl seeds
  `first_seen` from the release date and stamps kv `seeded_at`; alerts are suppressed for
  anything first seen during that seed. Same discipline as Catalogue.generation refusing
  to name a half-built table.

* **`english` in the served rows is a LABEL, not a code.** parse.py applies
  _VALUE_LABELS at parse time, so the values are "None" / "Partial" / "Full", never
  0/1/2. And an ABSENT key is not "unknown, show it anyway" — blanks are dropped by
  _coerce, and a blank cell means the game shipped in English. It must never alert.

* **The IGDB rate limiter is shared.** It lives on the single IgdbClient instance
  alongside the enrichment workers and the catalogue crawl. MATCH_BUDGET is what keeps
  this feature from eating the enrichment backfill's whole budget.

* **Never send a release date to IGDB as a release year.** The sites' dates are the
  PATCH's (2026); the game's is 1995. Passing it guarantees date_matched=False forever.

* **`Catalogue.lookup_norm` is free, platform-blind and popularity-ranked.** It answers
  "the popular game with this name", which on a short name is a coin flip. Trust it only
  on long, unambiguous normalizations, and only once the catalogue has a generation.

* **constants.PLATFORM_NAMES is forward-only.** The site-vocabulary map below is an
  explicit dict, not a reverse index — read backwards that table collides ("sega cd 32x"
  lives under both SEGA_32X and SEGA_CD).

* **An Addendum is not a translation.** It is a patch layered on somebody else's
  translation, and it must never fire the owned-game alert. Nor must an Improvement,
  which retranslates a game that was already in English.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone

from excel_game import ExcelGame, ExcelPlatform
from igdb import platform_from_str
from match_validator import MatchValidator
from rhdi import RhdiClient
from romhackplaza import RomhackPlazaClient

log = logging.getLogger("gamedex.translations")

# Bump to re-walk the listings from page 1 (the list-parse shape changed).
LIST_VERSION = "1"
# Bump to re-fetch every RHDI detail page. Needed because nothing on the source's side
# would ever trigger a re-fetch when WE start reading a field we previously ignored.
DETAIL_VERSION = "1"
# Bump to re-run the matching ladder over every cluster, including the negative cache.
MATCH_VERSION = "1"

START_DELAY = 240            # behind catalogue's 120, ahead of screenscraper's 300
POLL_INTERVAL = 6 * 3600
DEEP_CRAWL_DAYS = 7
MAX_PAGES = 40               # per source per incremental pass
# The first crawl has ~470 RHDI pages to get through. Doing that in one go is both rude
# to a volunteer-run site and fragile — a redeploy halfway would start again from page
# one. So the seed is capped per pass and resumes from a persisted cursor instead.
SEED_MAX_PAGES = 60
STOP_AFTER_KNOWN_PAGES = 2   # see _ingest: one quiet page is not proof
DETAIL_BUDGET = 400          # RHDI detail fetches per pass (7042 on a cold DB)
# romhack.ing serves list pages happily but starts timing out under a sustained run of
# detail requests — observed 14 timeouts in a 25-page burst. That is the site asking us
# to stop, so the pass gives up rather than spending its whole budget on a server that
# is already struggling. Unfetched rows keep detail_fetched_at NULL and come back round
# next pass, so nothing is lost by quitting early.
DETAIL_MAX_CONSECUTIVE_FAILS = 5
MATCH_BUDGET = 60            # IGDB searches per pass — the limiter is SHARED
RETRY_UNMATCHED_DAYS = 30    # IGDB does gain Japan-only games over time
MIN_CONFIDENCE = 10          # below this we ship no metadata at all
SAME_RELEASE_DAYS = 45

# Tags that mean "this is not a fresh translation of a previously untranslated game".
_NOT_A_TRANSLATION = {"addendum", "improvement", "bug fix", "graphic", "gameplay", "text"}
_MACHINE_TAGS = {"machine translation", "vibe coded"}

# ---------------------------------------------------------------------------
# Platform vocabulary.
#
# Collected by walking both listings rather than guessed: 40 distinct codes on RHDI, 31
# names on Romhack Plaza. Plaza's are close enough to ExcelPlatform's own values that a
# casefolded comparison catches most of them ("Nintendo Gamecube" vs "Nintendo GameCube",
# "Turbografx-16" vs "TurboGrafx-16", "Wonderswan" vs "WonderSwan"); RHDI's terse codes
# need this table. An unmapped platform yields None, which costs corroboration in the
# matcher but is never a guess.
# ---------------------------------------------------------------------------
_PLATFORM_ALIASES = {
    # RHDI codes. "3DO", "ARC"->Arcade aside, "FM-7", "MSX", "NES", "PC", "SNES" and
    # "XBOX" already casefold onto an ExcelPlatform value and are not repeated here.
    "arc": ExcelPlatform.ARCADE,
    "fm": ExcelPlatform.FM_TOWNS,
    "fds": ExcelPlatform.FAMICOM_DISK_SYSTEM,
    "gb": ExcelPlatform.GAME_BOY,
    "gbc": ExcelPlatform.GAME_BOY_COLOR,
    "gba": ExcelPlatform.GAME_BOY_ADVANCE,
    "n64": ExcelPlatform.NINTENDO_64,
    "64dd": ExcelPlatform.NINTENDO_64DD,
    "gcn": ExcelPlatform.NINTENDO_GAMECUBE,
    "nds": ExcelPlatform.NINTENDO_DS,
    "3ds": ExcelPlatform.NINTENDO_3DS,
    "wii": ExcelPlatform.NINTENDO_WII,
    "psx": ExcelPlatform.PLAYSTATION,
    "ps2": ExcelPlatform.PLAYSTATION_2,
    "ps3": ExcelPlatform.PLAYSTATION_3,
    "psp": ExcelPlatform.PLAYSTATION_PORTABLE,
    "vita": ExcelPlatform.PLAYSTATION_VITA,
    "gen": ExcelPlatform.SEGA_GENESIS,
    "segacd": ExcelPlatform.SEGA_CD,
    "sms": ExcelPlatform.SEGA_MASTER_SYSTEM,
    "gg": ExcelPlatform.SEGA_GAME_GEAR,
    "sat": ExcelPlatform.SEGA_SATURN,
    "dc": ExcelPlatform.SEGA_DREAMCAST,
    "sg1k": ExcelPlatform.SEGA_SG_1000,
    "tg16": ExcelPlatform.TURBOGRAFX_16,
    "tgcd": ExcelPlatform.TURBOGRAFX_CD,
    "pcfx": ExcelPlatform.PC_FX,
    "pc88": ExcelPlatform.NEC_PC_8801,
    "pc98": ExcelPlatform.NEC_PC_9801,
    "x1": ExcelPlatform.SHARP_X1,
    "ast": ExcelPlatform.ATARI_ST,
    "loopy": ExcelPlatform.CASIO_LOOPY,
    "ws": ExcelPlatform.WONDERSWAN,
    "ngpc": ExcelPlatform.NEO_GEO_POCKET_COLOR,
    # Romhack Plaza names that don't casefold onto an ExcelPlatform value
    "super nintendo": ExcelPlatform.SNES,
    "nintendo entertainment system": ExcelPlatform.NES,
    "family computer disk system": ExcelPlatform.FAMICOM_DISK_SYSTEM,
    "pc-88": ExcelPlatform.NEC_PC_8801,
    "pc-98": ExcelPlatform.NEC_PC_9801,
    "x68000": ExcelPlatform.SHARP_X68000,
    "pc (windows)": ExcelPlatform.PC,
}

# Built once: every ExcelPlatform value, casefolded, so Plaza's near-miss casing is free.
_PLATFORM_BY_VALUE = {p.value.lower(): p for p in ExcelPlatform}


def platform_of(raw):
    """Site platform string -> ExcelPlatform, or None. Never guesses."""
    if not raw:
        return None
    key = str(raw).strip().lower()
    return (
        _PLATFORM_ALIASES.get(key)
        or _PLATFORM_BY_VALUE.get(key)
        or platform_from_str(str(raw).strip())
    )


# ---------------------------------------------------------------------------
# Title cleaning
# ---------------------------------------------------------------------------

# Patch furniture, stripped from the end of a patch title. Ordered so the longest and
# most specific run first.
_PATCH_SUFFIX = re.compile(
    r"\s*(?:[-–—:|]\s*)?(?:"
    r"(?:full|complete|partial|new|improved)?\s*"
    # The language segment. Allows "/" and "&" so a dual-language patch
    # ("Korean / English Translation Patch") is stripped whole rather than leaving a
    # dangling "- Korean /" behind.
    r"(?:[A-Za-z]+(?:[ /&,]+[A-Za-z]+){0,3})?\s*"
    r"(?:re)?translation(?:\s+(?:patch|project|addendum|revision|hack))?"
    r"|translation\s+patch|english\s+patch|eng(?:lish)?\s+trans(?:lation)?"
    r"|localization|localisation"
    # "English Translation AND Restoration" — a trailing conjoined clause.
    r")(?:\s+and\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,2})?\s*$",
    re.I,
)
# The sites hang their own tag vocabulary off the end of a title ("… - Translation
# Revision - Text"). Bounded to the tags actually seen in the listings, so it can never
# eat a real word off the end of a game's name.
_TRAILING_TAG = re.compile(
    r"\s*[-–—|]\s*(?:text|graphics?|gameplay|audio|music|sound|addendum|revision|"
    r"restoration|improvement|bug\s*fix|fix|patch|complete|partial|unfinished|"
    r"beta|demo|final|wip|v\d[\w.]*)\s*$",
    re.I,
)
_TRAILING_VERSION = re.compile(r"\s*[-–—(\[]?\s*v(?:er)?\.?\s*\d+(?:\.\d+)*\s*[)\]]?\s*$", re.I)
_TRAILING_PAREN = re.compile(r"\s*[\(\[][^)\]]{0,40}[\)\]]\s*$")
_LEADING_PLATFORM = re.compile(r"^\s*[\[\(][A-Za-z0-9 /-]{2,20}[\]\)]\s*")
_SUBTITLE_SEP = re.compile(r"\s+[-–—~]\s+|\s*:\s+")


def strip_patch_title(title):
    """Remove patch furniture from a patch title, leaving the game's name.

    "Flower, Sun and Rain - English Translation" -> "Flower, Sun and Rain"
    "Pixy Garden (Disc 1 - Game Disc) - English Translation" -> "Pixy Garden"
    """
    t = (title or "").strip()
    if not t:
        return ""
    t = _LEADING_PLATFORM.sub("", t)
    for _ in range(4):                      # suffixes stack: "- English Translation v1.1"
        before = t
        t = _TRAILING_VERSION.sub("", t)
        t = _TRAILING_TAG.sub("", t)
        t = _PATCH_SUFFIX.sub("", t)
        t = t.rstrip(" -–—:|,")
        if t == before:
            break
    # Only drop a trailing parenthetical once the translation marker is gone, or
    # "(Disc 1 - Game Disc)" survives as the whole title.
    stripped = _TRAILING_PAREN.sub("", t).strip()
    return (stripped or t).strip(" -–—:|,")


def subtitle_dropped(title):
    """"Foo - Bar" -> "Foo". Returns None when there is no subtitle to drop."""
    parts = _SUBTITLE_SEP.split(title or "", maxsplit=1)
    head = parts[0].strip() if parts else ""
    return head if len(parts) > 1 and len(head) >= 4 else None


# MatchValidator.romanize already folds ō->ou and ū->uu, which is the expanding
# direction. The sources hand us those expanded spellings ("Kouryuu no Mimi") while IGDB
# usually carries the contracted one ("Koryu"), so contraction is the direction that
# pays. normalize() strips non-alphanumerics, so particle spacing already collapses on
# its own; long vowels do not.
#
# ONLY contraction. Going the other way (o -> ou) is ambiguous — every bare vowel is a
# candidate — and generates nonsense like "Kouryuu nou Mimi" that burns IGDB searches.
_LONG_VOWEL = [("ou", "o"), ("uu", "u"), ("oo", "o"), ("oh", "o")]


def romaji_variants(title):
    """Contracted long-vowel spellings, most likely first, excluding the input itself."""
    base = (title or "").strip()
    if not base:
        return []
    out, seen = [], {base.lower()}
    # Each rule alone, then all of them together — "Kouryuu" wants both applied.
    for rules in ([r] for r in _LONG_VOWEL):
        cand = base
        for src, dst in rules:
            cand = re.sub(src, dst, cand, flags=re.I)
        if cand.lower() not in seen:
            seen.add(cand.lower())
            out.append(cand)
    allrules = base
    for src, dst in _LONG_VOWEL:
        allrules = re.sub(src, dst, allrules, flags=re.I)
    if allrules.lower() not in seen:
        out.insert(0, allrules)
    return out[:4]


def _now():
    return int(time.time())


def _iso(ts=None):
    return datetime.fromtimestamp(ts or time.time(), tz=timezone.utc).isoformat()


class TranslationWatch:
    def __init__(self, igdb_client, db_path, store=None, enricher=None, catalogue=None,
                 sources="rhdi,plaza", poll_interval=POLL_INTERVAL,
                 detail_budget=DETAIL_BUDGET, match_budget=MATCH_BUDGET,
                 include_nsfw=False):
        self._igdb = igdb_client
        self._store = store
        self._enricher = enricher
        self._catalogue = catalogue
        self._validator = MatchValidator()
        self._sources = {s.strip().lower() for s in (sources or "").split(",") if s.strip()}
        self._poll_interval = poll_interval
        self._detail_budget = detail_budget
        self._match_budget = match_budget
        self._include_nsfw = include_nsfw

        self._rhdi = RhdiClient() if "rhdi" in self._sources else None
        self._plaza = RomhackPlazaClient() if "plaza" in self._sources else None

        self._stop = threading.Event()
        self._wake = threading.Event()
        self._db_lock = threading.Lock()
        self._payload_memo = None
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._init_db()

    # -- schema --------------------------------------------------------------

    def _init_db(self):
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS releases("
            " uid TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL,"
            " url TEXT, patch_title TEXT NOT NULL, game_title TEXT, game_source_id TEXT,"
            " alt_titles TEXT, platform_raw TEXT, platform TEXT,"
            " authors TEXT, version TEXT, status TEXT, tags TEXT,"
            " language TEXT, machine INTEGER DEFAULT 0, nsfw INTEGER DEFAULT 0,"
            " released INTEGER, added INTEGER, download_count INTEGER,"
            " cover_url TEXT, description TEXT, publishers TEXT, genres TEXT,"
            " detail_fetched_at TEXT, detail_version TEXT,"
            " cluster_id TEXT, group_id TEXT,"
            " first_seen TEXT NOT NULL, last_seen TEXT, updated_at TEXT, rev_seen TEXT)"
        )
        # CREATE TABLE IF NOT EXISTS is a no-op on an existing table, so new columns go
        # in by hand — the same dance catalogue.py and enrich.py do.
        cols = {r[1] for r in self._db.execute("PRAGMA table_info(releases)")}
        for col, decl in (("machine", "INTEGER DEFAULT 0"), ("genres", "TEXT")):
            if col not in cols:
                self._db.execute(f"ALTER TABLE releases ADD COLUMN {col} {decl}")

        self._db.execute(
            "CREATE TABLE IF NOT EXISTS games("
            " cluster_id TEXT PRIMARY KEY, display_title TEXT, platform TEXT,"
            " igdb_id INTEGER, igdb TEXT, confidence INTEGER, tier TEXT,"
            " match_version TEXT, resolved_at TEXT, manual INTEGER DEFAULT 0,"
            " sheet_key TEXT, sheet_tier TEXT, cover_url TEXT)"
        )
        self._db.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)")
        self._db.execute("CREATE INDEX IF NOT EXISTS tw_rel_cluster ON releases(cluster_id)")
        self._db.execute("CREATE INDEX IF NOT EXISTS tw_rel_group ON releases(group_id)")
        self._db.execute("CREATE INDEX IF NOT EXISTS tw_rel_seen ON releases(first_seen DESC)")
        self._db.execute("CREATE INDEX IF NOT EXISTS tw_games_igdb ON games(igdb_id)")
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

    def _kv_int(self, k, default=0):
        try:
            return int(self._kv_get(k) or default)
        except (TypeError, ValueError):
            return default

    @property
    def seeded(self):
        """True once the first full crawl has finished. Alerts stay silent until then —
        on a cold database every one of ~7,000 entries is 'new'."""
        return self._kv_get("seeded_at") is not None

    # -- lifecycle -----------------------------------------------------------

    def start(self):
        threading.Thread(target=self._loop, name="translations", daemon=True).start()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def kick(self):
        """Force a pass now (admin route). Mirrors PlatformSync.kick."""
        self._wake.set()

    def _loop(self):
        if self._stop.wait(START_DELAY):
            return
        while not self._stop.is_set():
            try:
                self.poll()
            except Exception as exc:                      # one bad pass must not end the thread
                log.warning("translations: pass failed: %s", exc)
            self._wake.clear()
            if self._stop.wait(self._poll_interval) or self._stop.is_set():
                return

    def poll(self):
        """One pass. Each phase is isolated so a dead source can't take the rest down."""
        deep = self._days_since_deep() >= DEEP_CRAWL_DAYS
        # A resumable seed spans several passes; it is only over when every enabled
        # source has walked its listing to the end.
        seeding = not self.seeded
        for name, fn in (
            ("rhdi", lambda: self._ingest_rhdi(deep or seeding)),
            ("plaza", lambda: self._ingest_plaza(deep or seeding)),
            ("detail", self._detail_pass),
            ("cluster", self._cluster),
            ("resolve", self._resolve),
            ("crossref", self._crossref),
        ):
            try:
                fn()
            except Exception as exc:
                log.warning("translations: %s phase failed: %s", name, exc)
        self._kv_set("polled_at", _now())
        if deep or seeding:
            self._kv_set("deep_crawled_at", _now())
        if seeding and all(self._source_seeded(s) for s in self._enabled_sources()):
            self._kv_set("seeded_at", _now())
            log.info("translations: initial seed complete; alerts are live from here")

    def _enabled_sources(self):
        return [s for s, client in (("rhdi", self._rhdi), ("plaza", self._plaza)) if client]

    def _days_since_deep(self):
        if self._kv_get("list_version") != LIST_VERSION:
            return 10 ** 6
        last = self._kv_int("deep_crawled_at", 0)
        return 10 ** 6 if not last else (_now() - last) / 86400.0

    # -- ingest --------------------------------------------------------------

    def _known_uids(self, source):
        with self._db_lock:
            return {r[0] for r in self._db.execute(
                "SELECT uid FROM releases WHERE source=?", (source,))}

    def _ingest(self, source, fetch_page, deep, watermark_key, date_key, seeding=False):
        """Walk a listing newest-first and upsert what it holds.

        Incremental passes stop after STOP_AFTER_KNOWN_PAGES consecutive pages that are
        entirely known AND entirely older than the watermark. Two pages, not one:
        "newest first" is ordered by release date, not by insertion, so a backdated or
        edited submission lands in the middle of the list, and one quiet page proves
        nothing.

        The seed is different: it has the whole archive to get through, so it walks at
        most SEED_MAX_PAGES per pass and stores where it stopped. It resumes there next
        pass — including across a redeploy, which is the point.
        """
        known = self._known_uids(source)
        watermark = self._kv_int(watermark_key, 0)
        high = watermark
        quiet = 0
        cursor_key = f"{source}_seed_page"
        start = self._kv_int(cursor_key, 1) if seeding else 1
        limit = SEED_MAX_PAGES if seeding else MAX_PAGES
        seen_any = False
        page = start
        exhausted = False
        aborted = False
        for page in range(start, start + limit):
            if self._stop.is_set():
                break
            rows, _total = fetch_page(page)
            if rows is None:
                # Transport failure. Stop this pass, but do NOT record the source as
                # walked to the end: a redeploy-proof cursor is worthless if one timeout
                # can permanently truncate the seed.
                log.warning("translations: %s page %d failed; pausing this pass", source, page)
                aborted = True
                break
            if not rows:
                exhausted = True
                break
            seen_any = True
            fresh = False
            for rel in rows:
                uid = f"{source}:{rel['source_id']}"
                stamp = rel.get(date_key) or 0
                high = max(high, stamp or 0)
                if uid not in known or (stamp and stamp > watermark):
                    fresh = True
                self._upsert(uid, rel)
            quiet = 0 if fresh else quiet + 1
            if not (seeding or deep) and quiet >= STOP_AFTER_KNOWN_PAGES:
                break
            time.sleep(0.25)          # the courtesy catalogue.full_crawl pays
        if seeding and not aborted:
            self._kv_set(cursor_key, 1 if exhausted else page + 1)
            if exhausted:
                self._kv_set(f"{source}_seeded", 1)
        elif seeding and page > start:
            # Keep the ground we did cover, but resume ON the page that failed.
            self._kv_set(cursor_key, page)
        # The watermark is only meaningful once we've actually seen the newest page, and
        # a resumed seed starts in the middle of the archive. Advancing it from page 300
        # would tell the next incremental pass that everything is old.
        if seen_any and high > watermark and (start == 1 or not seeding):
            self._kv_set(watermark_key, high)
        self._kv_set("list_version", LIST_VERSION)

    def _source_seeded(self, source):
        return bool(self._kv_int(f"{source}_seeded", 0))

    def _ingest_rhdi(self, deep):
        if not self._rhdi:
            return
        self._ingest("rhdi", self._rhdi.list_page, deep, "rhdi_watermark", "released",
                     seeding=not self._source_seeded("rhdi"))

    def _ingest_plaza(self, deep):
        if not self._plaza:
            return
        self._ingest("plaza", lambda p: self._plaza.list_page(p), deep,
                     "plaza_watermark", "added",
                     seeding=not self._source_seeded("plaza"))

    def _upsert(self, uid, rel):
        """Insert a new release, or update one we already hold.

        A revision (same uid, new version) UPDATES and records the old version in
        rev_seen — it must not become a second row, and it must not re-fire an alert
        that has already been delivered. The one exception is a status crossing into
        Complete, which _crossref treats as a fresh event because it is one.
        """
        now = _iso()
        tags = rel.get("tags") or []
        machine = int(any(t.lower() in _MACHINE_TAGS for t in tags))
        status = rel.get("status") or self._status_from_tags(tags)
        with self._db_lock:
            row = self._db.execute(
                "SELECT version, status, rev_seen FROM releases WHERE uid=?", (uid,)).fetchone()
            if row is None:
                self._db.execute(
                    "INSERT INTO releases(uid, source, source_id, url, patch_title,"
                    " game_title, game_source_id, platform_raw, platform, authors,"
                    " version, status, tags, language, machine, nsfw, released, added,"
                    " download_count, cover_url, first_seen, last_seen)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (uid, rel["source"], rel["source_id"], rel.get("url"),
                     rel["patch_title"], rel.get("game_title"), rel.get("game_source_id"),
                     rel.get("platform_raw"),
                     (platform_of(rel.get("platform_raw")).value
                      if platform_of(rel.get("platform_raw")) else None),
                     json.dumps(rel.get("authors") or []), rel.get("version"), status,
                     json.dumps(tags), rel.get("language"), machine,
                     int(bool(rel.get("nsfw"))), rel.get("released"), rel.get("added"),
                     rel.get("download_count"), rel.get("cover_url"), now, now),
                )
            else:
                old_version, old_status, rev_seen = row
                revised = rel.get("version") and rel["version"] != old_version
                try:
                    revs = json.loads(rev_seen) if rev_seen else []
                except ValueError:
                    revs = []
                if revised and old_version and old_version not in revs:
                    revs.append(old_version)
                self._db.execute(
                    "UPDATE releases SET url=?, patch_title=?, game_title=?,"
                    " game_source_id=?, platform_raw=?, platform=?, authors=?, version=?,"
                    " status=?, tags=?, machine=?, nsfw=?, released=COALESCE(?, released),"
                    " added=COALESCE(?, added), download_count=?, cover_url=COALESCE(?, cover_url),"
                    " last_seen=?, updated_at=CASE WHEN ? THEN ? ELSE updated_at END,"
                    " rev_seen=? WHERE uid=?",
                    (rel.get("url"), rel["patch_title"], rel.get("game_title"),
                     rel.get("game_source_id"), rel.get("platform_raw"),
                     (platform_of(rel.get("platform_raw")).value
                      if platform_of(rel.get("platform_raw")) else None),
                     json.dumps(rel.get("authors") or []), rel.get("version"), status,
                     json.dumps(tags), machine, int(bool(rel.get("nsfw"))),
                     rel.get("released"), rel.get("added"), rel.get("download_count"),
                     rel.get("cover_url"), now,
                     1 if (revised or status != old_status) else 0, now,
                     json.dumps(revs), uid),
                )
            self._db.commit()

    @staticmethod
    def _status_from_tags(tags):
        lowered = [t.lower() for t in tags or []]
        for want in ("complete", "unfinished", "in-progress", "addendum", "improvement"):
            if want in lowered:
                return want.title()
        return None

    # -- detail --------------------------------------------------------------

    def _detail_pass(self):
        """Fill in RHDI's language/version/description. The ONLY place English-ness for
        that source becomes knowable — the list payload has no language field and the
        server ignores language filters."""
        if not self._rhdi:
            return
        if self._kv_get("detail_version") != DETAIL_VERSION:
            with self._db_lock:
                self._db.execute(
                    "UPDATE releases SET detail_fetched_at=NULL WHERE source='rhdi'")
                self._db.commit()
            self._kv_set("detail_version", DETAIL_VERSION)
        with self._db_lock:
            todo = self._db.execute(
                "SELECT uid, source_id, patch_title, game_source_id, game_title"
                " FROM releases WHERE source='rhdi' AND detail_fetched_at IS NULL"
                " ORDER BY COALESCE(released,0) DESC LIMIT ?", (self._detail_budget,)
            ).fetchall()
        if not todo:
            return
        log.info("translations: %d rhdi detail pages queued (budget %d)",
                 len(todo), self._detail_budget)
        game_cache = {}
        done = 0
        fails = 0
        for uid, source_id, patch_title, game_id, game_title in todo:
            if self._stop.is_set():
                break
            if fails >= DETAIL_MAX_CONSECUTIVE_FAILS:
                log.warning("translations: %d detail fetches in a row failed; ending the"
                            " pass early (%d done, the rest stay queued)", fails, done)
                break
            # Skip the request entirely when the title names a language that isn't
            # English. This is a request-saver, never an answer: a title naming no
            # language still goes to the detail page.
            if not self._rhdi.maybe_english(patch_title):
                with self._db_lock:
                    self._db.execute(
                        "UPDATE releases SET language='(non-english)', detail_fetched_at=?,"
                        " detail_version=? WHERE uid=?", (_iso(), DETAIL_VERSION, uid))
                    self._db.commit()
                continue
            d = self._rhdi.detail(source_id, patch_title)
            if not d:
                fails += 1
                continue
            fails = 0
            langs = d.get("language") or []
            language = ("English" if any(l.lower() == "english" for l in langs)
                        else (langs[0] if langs else None))
            game = None
            if game_id:
                if game_id not in game_cache:
                    game_cache[game_id] = self._rhdi.game(game_id, game_title) or {}
                game = game_cache[game_id]
            tags = d.get("tags") or []
            # The patch-level NSFW tag is applied inconsistently: the same PC-98 game
            # appears once tagged and once not, and an untagged adult entry would go
            # straight into the default feed. The GAME record carries its own NSFW tag
            # and is the more reliable of the two, so either one is enough.
            game_tags = (game or {}).get("tags") or []
            nsfw = any(t.lower() == "nsfw" for t in list(tags) + list(game_tags))
            with self._db_lock:
                self._db.execute(
                    "UPDATE releases SET language=?, version=?, description=?, tags=?,"
                    " machine=?, nsfw=?, status=COALESCE(?, status),"
                    " alt_titles=?, publishers=?, genres=?,"
                    " detail_fetched_at=?, detail_version=? WHERE uid=?",
                    (language, d.get("version"), d.get("description"), json.dumps(tags),
                     int(any(t.lower() in _MACHINE_TAGS for t in tags)),
                     int(nsfw),
                     self._status_from_tags(tags),
                     json.dumps([t for t in [(game or {}).get("alt_title")] if t]),
                     json.dumps((game or {}).get("publishers") or []),
                     json.dumps((game or {}).get("tags") or []),
                     _iso(), DETAIL_VERSION, uid),
                )
                self._db.commit()
            done += 1
        log.info("translations: detail pass fetched %d", done)

    # -- clustering ----------------------------------------------------------

    def _english_sql(self):
        """The English gate. A row whose language is still NULL is NOT 'unknown, show it
        anyway' — it is excluded until the detail pass answers."""
        return "language = 'English'"

    def _cluster(self):
        """Assign cluster_id (a GAME) and group_id (a PATCH). See the module docstring
        for why these are two different things."""
        norm = self._validator.normalize
        with self._db_lock:
            rows = self._db.execute(
                "SELECT uid, source, game_title, patch_title, platform, authors, released,"
                " added FROM releases WHERE " + self._english_sql()).fetchall()
        clusters = {}
        for uid, source, game_title, patch_title, platform, authors, released, added in rows:
            title = game_title or strip_patch_title(patch_title)
            if not title:
                continue
            cid = f"{norm(title)}|{(platform or '').lower()}"
            try:
                auth = {a.lower().strip() for a in json.loads(authors or "[]") if a}
            except ValueError:
                auth = set()
            clusters.setdefault(cid, []).append(
                {"uid": uid, "authors": auth, "title": title,
                 "when": released or added or 0, "patch_title": patch_title})

        updates = []
        for cid, members in clusters.items():
            # Within a cluster, one group per translation. Two entries group when their
            # author sets intersect (scene handles are identical across both sites), or
            # when the patch titles agree fuzzily and the dates are close — the fallback
            # for a site that credits nobody.
            groups = []
            for m in members:
                for g in groups:
                    if (m["authors"] and g["authors"] & m["authors"]) or (
                        not m["authors"] and not g["authors"]
                        and self._validator.titles_equal_fuzzy(m["patch_title"], g["title"])
                        and abs(m["when"] - g["when"]) <= SAME_RELEASE_DAYS * 86400
                    ):
                        g["authors"] |= m["authors"]
                        g["uids"].append(m["uid"])
                        break
                else:
                    groups.append({"authors": set(m["authors"]), "uids": [m["uid"]],
                                   "title": m["patch_title"], "when": m["when"]})
            for i, g in enumerate(groups):
                gid = f"{cid}#{i}"
                for uid in g["uids"]:
                    updates.append((cid, gid, uid))
        if not updates:
            return
        with self._db_lock:
            self._db.executemany(
                "UPDATE releases SET cluster_id=?, group_id=? WHERE uid=?", updates)
            self._db.commit()

    # -- matching ------------------------------------------------------------

    def _cluster_facts(self, cid):
        """Everything the ladder knows about one game, pooled across its releases."""
        with self._db_lock:
            rows = self._db.execute(
                "SELECT game_title, patch_title, alt_titles, platform, publishers, genres,"
                " cover_url FROM releases WHERE cluster_id=?", (cid,)).fetchall()
        titles, alts, publishers, genres, platform, cover = [], [], [], [], None, None
        for game_title, patch_title, alt_titles, plat, pubs, gen, cov in rows:
            platform = platform or plat
            cover = cover or cov
            if game_title:
                titles.append(game_title)
            stripped = strip_patch_title(patch_title)
            if stripped:
                titles.append(stripped)
            for bucket, raw in ((alts, alt_titles), (publishers, pubs), (genres, gen)):
                try:
                    bucket.extend(x for x in json.loads(raw or "[]") if x)
                except ValueError:
                    pass
        # Ordered-unique: the game title comes first because it is the underlying game
        # already separated from the patch, but the stripped patch title is just as often
        # the name IGDB actually carries (romaji vs localised). Both go in the ladder.
        def uniq(seq):
            seen, out = set(), []
            for x in seq:
                k = x.lower().strip()
                if k and k not in seen:
                    seen.add(k)
                    out.append(x.strip())
            return out
        titles = uniq(titles)
        candidates = list(titles) + uniq(alts)
        for t in list(titles)[:2]:
            sub = subtitle_dropped(t)
            if sub:
                candidates.append(sub)
            candidates.extend(romaji_variants(t))
        return {
            "candidates": uniq(candidates),
            "platform": platform,
            "publisher": (uniq(publishers) or [None])[0],
            "genres": uniq(genres),
            "cover_url": cover,
            "display_title": titles[0] if titles else None,
        }

    def _resolve(self):
        """The matching ladder, per CLUSTER — two rival translations of one game cost one
        IGDB resolution, not two."""
        if not self._igdb or not getattr(self._igdb, "configured", False):
            return
        cutoff = _iso(_now() - RETRY_UNMATCHED_DAYS * 86400)
        with self._db_lock:
            todo = [r[0] for r in self._db.execute(
                "SELECT DISTINCT r.cluster_id FROM releases r"
                " LEFT JOIN games g ON g.cluster_id = r.cluster_id"
                " WHERE r.cluster_id IS NOT NULL"
                "   AND (g.cluster_id IS NULL"
                "        OR (COALESCE(g.manual,0) = 0"
                "            AND (g.match_version IS NULL OR g.match_version != ?"
                "                 OR (g.igdb_id IS NULL AND COALESCE(g.resolved_at,'') < ?))))"
                " ORDER BY (SELECT MAX(COALESCE(released, added, 0)) FROM releases"
                "           WHERE cluster_id = r.cluster_id) DESC"
                " LIMIT ?", (MATCH_VERSION, cutoff, self._match_budget)).fetchall()]
        if not todo:
            return
        log.info("translations: resolving %d clusters (budget %d)", len(todo), self._match_budget)
        for cid in todo:
            if self._stop.is_set():
                break
            try:
                self._resolve_one(cid)
            except Exception as exc:
                log.warning("translations: resolve %s failed: %s", cid, exc)

    def _resolve_one(self, cid):
        facts = self._cluster_facts(cid)
        candidates = facts["candidates"]
        if not candidates:
            return
        platform = facts["platform"]
        best, best_score, tier = None, 0, None

        # Rung 1 — the catalogue. Free: no IGDB call at all.
        hit = self._catalogue_hit(candidates)
        if hit:
            detail = None
            try:
                detail = self._igdb.detail_by_id(hit)
            except Exception as exc:
                log.warning("translations: detail_by_id(%s) failed: %s", hit, exc)
            if detail:
                # Capped deliberately: a platform-blind normalized-name hit is matched +
                # exact with no corroboration, and that is genuinely all we verified.
                best, best_score, tier = detail, 10, "catalogue"

        # Rung 2/3 — IGDB search on each candidate title, best score wins.
        if best is None:
            for title in candidates[:4]:
                try:
                    rec, score = self._igdb.match(
                        title,
                        platform=platform,
                        release_year=None,          # the site's date is the PATCH's
                        publisher=facts["publisher"],
                    )
                except Exception as exc:
                    log.warning("translations: igdb.match(%r) failed: %s", title, exc)
                    continue
                if rec and score > best_score:
                    best, best_score, tier = rec, score, "igdb-game"
                if best_score >= 14:                # nothing left to improve on
                    break

        # Rung 4 — platform-relaxed, exact-only. Only when everything above missed.
        if best is None:
            rec, score = self._relaxed_match(candidates[0], facts)
            if rec:
                best, best_score, tier = rec, score, "igdb-relaxed"

        now = _iso()
        if best is None or best_score < MIN_CONFIDENCE:
            # Blank on low confidence, and remember the miss so it isn't re-bought every
            # pass. A wrong cover on a Japan-only game is worse than no cover: it is
            # indistinguishable from a right one.
            #
            # "low" and "none" are different answers and both are worth keeping: "low"
            # means IGDB offered something we didn't believe (worth a look in the manual
            # match UI), "none" means it offered nothing at all. Recording the rung that
            # produced the rejected candidate would claim a match we just refused.
            self._save_game(cid, facts, None, None, best_score,
                            "low" if best is not None else "none", now)
            return
        self._save_game(cid, facts, best.get("igdbId"), best, best_score, tier, now)

    def _catalogue_hit(self, candidates):
        """Catalogue.lookup_norm, guarded. Free, but platform-blind and ranked by
        rating_count — on a short name it answers 'the popular game called this', which
        is a coin flip. Long normalizations only, and never mid-first-crawl."""
        cat = self._catalogue
        if not cat or not getattr(cat, "generation", 0):
            return None
        for title in candidates:
            norm = self._validator.normalize(title)
            if len(norm) < 12:
                continue
            try:
                hit = cat.lookup_norm(norm)
            except Exception:
                continue
            if hit and not hit.get("ambiguous") and hit.get("igdbId"):
                return hit["igdbId"]
        return None

    def _relaxed_match(self, title, facts):
        """Platform-relaxed, exact-title-only, requiring publisher or franchise
        corroboration.

        This rescues Famicom Disk System / X68000 / PC-98 / SuperGrafx titles whose IGDB
        platform name doesn't line up with the site's. It is strictly NARROWER than
        IgdbClient.match's own rule on the title axis and only trades away the platform
        check — the axis that failed. match()'s rule is tuned for spreadsheet rows and
        must not be loosened for everybody to serve this one case.
        """
        search = getattr(self._igdb, "search_candidates", None)
        if not search:
            return None, 0
        game = ExcelGame(title=title, publisher=facts["publisher"])
        try:
            results = search(title) or []
        except Exception as exc:
            log.warning("translations: relaxed search(%r) failed: %s", title, exc)
            return None, 0
        best, best_info = None, None
        for c in results:
            names = [c.get("name")] + [
                a["name"] for a in c.get("alternative_names", []) if a.get("name")]
            pubs = [(ic.get("company") or {}).get("name")
                    for ic in c.get("involved_companies", []) if ic.get("publisher")]
            frans = [f["name"] for f in c.get("franchises", []) if f.get("name")]
            info = self._validator.validate(
                game, [n for n in names if n], None, None, [p for p in pubs if p], None, frans)
            if not (info.exact and (info.publisher_matched or info.franchise_matched)):
                continue
            if best is None or info.match_score > best_info.match_score:
                best, best_info = c, info
        if best is None:
            return None, 0
        return self._igdb.enrichment_from_result(best), best_info.match_score

    def _save_game(self, cid, facts, igdb_id, record, score, tier, now):
        with self._db_lock:
            self._db.execute(
                "INSERT INTO games(cluster_id, display_title, platform, igdb_id, igdb,"
                " confidence, tier, match_version, resolved_at, cover_url)"
                " VALUES(?,?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(cluster_id) DO UPDATE SET display_title=excluded.display_title,"
                " platform=excluded.platform, igdb_id=excluded.igdb_id, igdb=excluded.igdb,"
                " confidence=excluded.confidence, tier=excluded.tier,"
                " match_version=excluded.match_version, resolved_at=excluded.resolved_at,"
                " cover_url=excluded.cover_url"
                " WHERE COALESCE(games.manual,0) = 0",
                (cid, facts["display_title"], facts["platform"], igdb_id,
                 json.dumps(record) if record else None, score, tier,
                 MATCH_VERSION, now, facts["cover_url"]),
            )
            self._db.commit()

    # -- collection cross-reference -----------------------------------------

    def _sheet_rows(self):
        """{_k: row} for the owned/wishlisted sheet. Read live every pass — see the
        module docstring on why alert state is never persisted."""
        if not self._store:
            return {}
        try:
            snap = self._store.snapshot() or {}
            rows = ((snap.get("data") or {}).get("games") or {}).get("rows") or []
        except Exception:
            return {}
        return {r["_k"]: r for r in rows if r.get("_k")}

    def _crossref(self):
        """Join resolved clusters onto sheet rows. No network. Three tiers, mirroring
        PlatformSync._match_library: IGDB id, then a year-free key, then a
        platform-scoped fuzzy match that must be unique."""
        if not self._enricher:
            return
        sheet = self._sheet_rows()
        if not sheet:
            return
        try:
            records = self._enricher.all_records()
            keys_meta = self._enricher.keys_meta()
        except Exception as exc:
            log.warning("translations: crossref could not read the enricher: %s", exc)
            return

        by_igdb = {}
        for k, rec in records.items():
            gid = rec.get("igdbId")
            if gid is not None and k in sheet:
                by_igdb.setdefault(gid, k)
        norm = self._validator.normalize
        # Year-free: key_for() includes the year and we do not know the GAME's year
        # before resolution (the site's date is the patch's).
        by_title_plat = {}
        for k, meta in keys_meta.items():
            if k not in sheet:
                continue
            by_title_plat.setdefault(
                (norm(meta.get("title") or ""), (meta.get("platform") or "").lower()), k)

        with self._db_lock:
            games = self._db.execute(
                "SELECT cluster_id, display_title, platform, igdb_id FROM games").fetchall()
        updates = []
        for cid, display_title, platform, igdb_id in games:
            key = tier = None
            if igdb_id is not None and igdb_id in by_igdb:
                key, tier = by_igdb[igdb_id], "igdb"
            if key is None and display_title:
                key = by_title_plat.get((norm(display_title), (platform or "").lower()))
                tier = "key" if key else None
            if key is None and display_title and platform:
                key = self._fuzzy_sheet(display_title, platform, keys_meta, sheet)
                tier = "fuzzy" if key else None
            updates.append((key, tier, cid))
        if updates:
            with self._db_lock:
                self._db.executemany(
                    "UPDATE games SET sheet_key=?, sheet_tier=? WHERE cluster_id=?", updates)
                self._db.commit()

    def _fuzzy_sheet(self, title, platform, keys_meta, sheet):
        """Last-tier title match, scoped to one platform and required to be UNIQUE.

        A tie means we do not know, and guessing here would put an alert on the wrong
        game — the failure mode this whole feature exists to avoid.
        """
        plat = (platform or "").lower()
        hits = [
            k for k, meta in keys_meta.items()
            if k in sheet and (meta.get("platform") or "").lower() == plat
            and self._validator.titles_equal_fuzzy(title, meta.get("title") or "")
        ]
        return hits[0] if len(hits) == 1 else None

    # -- payload -------------------------------------------------------------

    def _alert_tier(self, rel, sheet_row):
        """Why this release matters to YOU, or None.

        The sheet's `english` is a LABEL ("None"/"Partial"/"Full"), and an ABSENT value
        means the game shipped in English — that must never alert.
        """
        if not sheet_row or not self.seeded:
            return None
        status = (rel.get("status") or "").lower()
        tags = {t.lower() for t in rel.get("tags") or []}
        # An addendum patches somebody else's translation; an improvement retranslates a
        # game that was already in English. Neither makes an untranslated game playable.
        if status != "complete" or (tags & _NOT_A_TRANSLATION):
            return None
        english = sheet_row.get("english")
        if english not in ("None", "Partial"):
            return None
        if sheet_row.get("owned"):
            return "alert"
        if sheet_row.get("wishlisted"):
            return "wishlist"
        return None

    def payload(self, limit=500):
        """The /api/translations body: alerts pinned, then the feed, newest first.

        Memoized on (last poll, spreadsheet hash) because stats() rides the /api/data
        path: without this, every data request would re-fold several thousand releases
        just to put a number on a nav badge.
        """
        key = (self._kv_int("polled_at", 0), self._sheet_hash(), limit)
        if self._payload_memo and self._payload_memo[0] == key:
            return self._payload_memo[1]
        built = self._build_payload(limit)
        self._payload_memo = (key, built)
        return built

    def _sheet_hash(self):
        if not self._store or not getattr(self._store, "ready", False):
            return None
        try:
            return (self._store.snapshot() or {}).get("meta", {}).get("sourceHash")
        except Exception:
            return None

    def _build_payload(self, limit):
        sheet = self._sheet_rows()
        with self._db_lock:
            rels = self._db.execute(
                "SELECT uid, source, url, patch_title, game_title, platform, platform_raw,"
                " authors, version, status, tags, machine, nsfw, released, added,"
                " download_count, cover_url, cluster_id, group_id, first_seen, updated_at"
                " FROM releases WHERE " + self._english_sql() +
                " AND group_id IS NOT NULL ORDER BY COALESCE(updated_at, first_seen) DESC"
            ).fetchall()
            # NSFW is folded over the whole CLUSTER, not just the group. The two sources
            # tag the same game differently — Romhack Plaza publishes no adult flag at
            # all, and RHDI's own tagging is patchy — so one untagged posting is enough
            # to put an adult game in the default feed unless the game's other postings
            # get a vote. This is still best-effort: when neither source tags a game and
            # its own game record doesn't either, nothing here can know.
            nsfw_clusters = {
                r[0] for r in self._db.execute(
                    "SELECT DISTINCT cluster_id FROM releases"
                    " WHERE nsfw=1 AND cluster_id IS NOT NULL")
            }
            games = {
                r[0]: r for r in self._db.execute(
                    "SELECT cluster_id, igdb_id, igdb, confidence, tier, sheet_key,"
                    " sheet_tier, cover_url FROM games")
            }

        groups, order = {}, []
        for row in rels:
            (uid, source, url, patch_title, game_title, platform, platform_raw, authors,
             version, status, tags, machine, nsfw, released, added, downloads, cover,
             cluster_id, group_id, first_seen, updated_at) = row
            try:
                tag_list = json.loads(tags or "[]")
                author_list = json.loads(authors or "[]")
            except ValueError:
                tag_list, author_list = [], []
            item = groups.get(group_id)
            if item is None:
                g = games.get(cluster_id)
                igdb = None
                if g and g[1] is not None and (g[3] or 0) >= MIN_CONFIDENCE and g[2]:
                    try:
                        igdb = json.loads(g[2])
                    except ValueError:
                        igdb = None
                sheet_key = g[5] if g else None
                sheet_row = sheet.get(sheet_key) if sheet_key else None
                item = {
                    "id": group_id,
                    "clusterId": cluster_id,
                    "title": (igdb or {}).get("name") or game_title or strip_patch_title(patch_title),
                    "patchTitle": patch_title,
                    "platform": platform or platform_raw,
                    "status": status,
                    "version": version,
                    "authors": author_list,
                    "tags": tag_list,
                    "machine": bool(machine),
                    "nsfw": bool(nsfw),
                    "released": released or added,
                    "firstSeen": first_seen,
                    "updatedAt": updated_at,
                    "downloads": downloads or 0,
                    "sources": [],
                    "game": igdb,
                    "confidence": (g[3] if g else None),
                    "matchTier": (g[4] if g else None),
                    # Only a durable image ever reaches the client. RHDI's thumbnails are
                    # presigned and dead in five minutes, so they never get stored.
                    "coverUrl": (g[7] if g else None) or cover,
                    "mine": None,
                }
                if sheet_row is not None:
                    item["mine"] = {
                        "matchKey": sheet_key,
                        "matchTier": g[6] if g else None,
                        "owned": bool(sheet_row.get("owned")),
                        "wishlisted": bool(sheet_row.get("wishlisted")),
                        "english": sheet_row.get("english"),
                        "tier": None,
                    }
                groups[group_id] = item
                order.append(group_id)
            item["sources"].append({"name": source, "url": url, "uid": uid})
            item["downloads"] = max(item["downloads"], downloads or 0)
            # These two are properties of the TRANSLATION, so they are folded over every
            # release in the group rather than taken from whichever row arrived first.
            # They disagree in practice: the same PC-98 game is listed twice, once tagged
            # NSFW and once not, and reading the untagged row put adult games straight
            # into the default feed.
            #   nsfw    — ANY, because the safe direction is to hide it.
            #   machine — ALL, because if any posting of this translation is credited to
            #             a human, it is not a machine translation.
            item["nsfw"] = item["nsfw"] or bool(nsfw) or (cluster_id in nsfw_clusters)
            item["machine"] = item["machine"] and bool(machine)
            if not item["tags"]:
                item["tags"] = tag_list
            if not item["version"] and version:
                item["version"] = version

        items, alerts = [], []
        for gid in order:
            item = groups[gid]
            # Applied here, after the fold above — during the loop it would read a
            # half-built flag.
            if item["nsfw"] and not self._include_nsfw:
                continue
            mine = item.get("mine")
            if mine:
                tier = self._alert_tier(item, sheet.get(mine["matchKey"]))
                mine["tier"] = tier
                if tier:
                    alerts.append(item)
                    continue
            items.append(item)

        seen_at = self._kv_int("seen_at", 0)
        unseen = sum(1 for a in alerts
                     if a.get("firstSeen") and a["firstSeen"] > _iso(seen_at))
        return {
            "enabled": True,
            "ready": self.seeded,
            "polledAt": self._kv_int("polled_at", 0) or None,
            "counts": {
                "releases": len(items) + len(alerts),
                "alerts": len(alerts),
                "unseen": unseen,
                "matched": sum(1 for i in items + alerts if i.get("game")),
            },
            "alerts": alerts,
            "items": items[:limit],
        }

    def stats(self):
        """The small summary folded into /api/data's meta, for the nav badge. Shares the
        memo with payload(), so it is free whenever the tab has already been rendered."""
        p = self.payload(limit=0)
        return {"enabled": True, "ready": p["ready"], "polledAt": p["polledAt"], **p["counts"]}

    def mark_seen(self):
        self._kv_set("seen_at", _now())
        self._payload_memo = None      # `unseen` is computed from it
