"""Personal platform data: linked accounts, libraries, achievements, screenshots.

The sheet knows what I own and what I thought of it; the platforms know what I
actually DID — the hours Steam counted, the achievements with timestamps, the
screenshots I took, the wishlist I keep adding to. This is the store for all of
that, one SQLite file on the PVC, keyed by (provider, app_id) rather than the
sheet's match key because it mirrors the platform's own view of the library.

The join to the sheet happens in lib_matches: one platform app can map to
SEVERAL sheet rows (the same game as a PC row and a Steam Deck row), so the
mapping is its own table instead of a column. platform_sync.py fills it; a
manual pin in match_overrides always wins and survives re-matching.

Credentials live here too (plaintext JSON, same trust boundary as
accounts.sqlite on the same volume) because later providers rotate tokens at
runtime — PSN's refresh token has to be rewritten mid-sync, which env-sourced
secrets can't do. A Fernet wrap keyed from the environment could be added
later without touching the schema.

Screenshot BYTES are not in the DB — they land under SHOTS_DIR
(<provider>/<app_id>/<shot_id>.<ext>), durable and never evicted, unlike the
/api/img cache. That matters for later providers: PSN's cloud gallery deletes
captures after 14 days, so our copy is the only one that lasts.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone

log = logging.getLogger("gamedex.platformdb")

PROVIDERS = ("steam", "psn", "xbox", "nintendo")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class PlatformDB:
    def __init__(self, db_path: str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        c = self._db
        c.execute(
            "CREATE TABLE IF NOT EXISTS linked_accounts("
            " provider TEXT PRIMARY KEY, credentials TEXT NOT NULL,"
            " display_name TEXT, status TEXT NOT NULL DEFAULT 'linked',"
            " error TEXT, linked_at TEXT, last_sync TEXT, last_full_sync TEXT)"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS lib_games("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL,"
            " name TEXT, playtime_min INTEGER, playtime_2wk_min INTEGER,"
            " last_played TEXT, icon_url TEXT, extra TEXT, updated_at TEXT,"
            " platform TEXT,"           # the game's own platform, for exact matching
            " PRIMARY KEY(provider, app_id))"
        )
        if "platform" not in {r[1] for r in c.execute("PRAGMA table_info(lib_games)")}:
            c.execute("ALTER TABLE lib_games ADD COLUMN platform TEXT")
        c.execute(
            "CREATE TABLE IF NOT EXISTS lib_matches("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL, match_key TEXT NOT NULL,"
            " source TEXT, score INTEGER,"      # 'appid' | 'title' | 'fuzzy' | 'manual'
            " PRIMARY KEY(provider, app_id, match_key))"
        )
        c.execute("CREATE INDEX IF NOT EXISTS ix_matches_key ON lib_matches(match_key)")
        c.execute(
            "CREATE TABLE IF NOT EXISTS achievements("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL, ach_id TEXT NOT NULL,"
            " name TEXT, description TEXT, icon_url TEXT, icon_locked_url TEXT,"
            " hidden INTEGER DEFAULT 0, rarity TEXT, global_pct REAL,"
            " unlocked INTEGER NOT NULL DEFAULT 0, unlocked_at TEXT, updated_at TEXT,"
            " PRIMARY KEY(provider, app_id, ach_id))"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS screenshots("
            " provider TEXT NOT NULL, shot_id TEXT NOT NULL, app_id TEXT,"
            " taken_at TEXT, caption TEXT, source_url TEXT, file_path TEXT,"
            " width INTEGER, height INTEGER, updated_at TEXT,"
            " PRIMARY KEY(provider, shot_id))"
        )
        c.execute("CREATE INDEX IF NOT EXISTS ix_shots_app ON screenshots(provider, app_id)")
        c.execute(
            "CREATE TABLE IF NOT EXISTS wishlist("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL,"
            " name TEXT, added_at TEXT, priority INTEGER, extra TEXT,"
            " match_key TEXT, igdb_id INTEGER, cover TEXT, updated_at TEXT,"
            # ITAD price data (see itad.py): current/regular/cut, all-time low,
            # and whether today's price is AT that low.
            " itad_id TEXT, price_current REAL, price_regular REAL, price_cut INTEGER,"
            " price_low REAL, price_currency TEXT, price_url TEXT, price_shop TEXT,"
            " price_at_low INTEGER, price_updated TEXT,"
            " PRIMARY KEY(provider, app_id))"
        )
        _wl_cols = {r[1] for r in c.execute("PRAGMA table_info(wishlist)")}
        for col, typ in (("itad_id", "TEXT"), ("price_current", "REAL"),
                         ("price_regular", "REAL"), ("price_cut", "INTEGER"),
                         ("price_low", "REAL"), ("price_currency", "TEXT"),
                         ("price_url", "TEXT"), ("price_shop", "TEXT"),
                         ("price_at_low", "INTEGER"), ("price_updated", "TEXT")):
            if col not in _wl_cols:
                c.execute(f"ALTER TABLE wishlist ADD COLUMN {col} {typ}")
        c.execute(
            "CREATE TABLE IF NOT EXISTS reviews("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL,"
            " recommended INTEGER, text TEXT, posted_at TEXT,"
            " hours_at_review REAL, url TEXT, updated_at TEXT,"
            " PRIMARY KEY(provider, app_id))"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS playtime_daily("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL, day TEXT NOT NULL,"
            " minutes INTEGER,"                 # cumulative total as of that day
            " PRIMARY KEY(provider, app_id, day))"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS match_overrides("
            " provider TEXT NOT NULL, app_id TEXT NOT NULL,"
            " match_key TEXT NOT NULL,"         # '' pins "matches nothing"
            " PRIMARY KEY(provider, app_id))"
        )
        c.execute("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)")
        c.commit()

    # ---- kv ----------------------------------------------------------------
    def kv_get(self, k: str) -> str | None:
        with self._lock:
            row = self._db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return row[0] if row else None

    def kv_set(self, k: str, v: str) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO kv(k,v) VALUES(?,?)", (k, v))
            self._db.commit()

    # ---- accounts ----------------------------------------------------------
    def account(self, provider: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT credentials, display_name, status, error, linked_at,"
                " last_sync, last_full_sync FROM linked_accounts WHERE provider=?",
                (provider,)).fetchone()
        if row is None:
            return None
        return {"provider": provider, "credentials": json.loads(row[0]),
                "displayName": row[1], "status": row[2], "error": row[3],
                "linkedAt": row[4], "lastSync": row[5], "lastFullSync": row[6]}

    def accounts(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT provider FROM linked_accounts").fetchall()
        return [a for a in (self.account(r[0]) for r in rows) if a]

    def link(self, provider: str, credentials: dict, display_name: str | None) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO linked_accounts(provider, credentials, display_name,"
                " status, error, linked_at) VALUES(?,?,?,'linked',NULL,?)"
                " ON CONFLICT(provider) DO UPDATE SET credentials=excluded.credentials,"
                " display_name=excluded.display_name, status='linked', error=NULL",
                (provider, json.dumps(credentials), display_name, _now()))
            self._db.commit()
        log.info("linked %s as %r", provider, display_name)

    def unlink(self, provider: str, purge: bool = False) -> None:
        with self._lock:
            self._db.execute("DELETE FROM linked_accounts WHERE provider=?", (provider,))
            if purge:
                for t in ("lib_games", "lib_matches", "achievements", "screenshots",
                          "wishlist", "reviews", "playtime_daily", "match_overrides"):
                    self._db.execute(f"DELETE FROM {t} WHERE provider=?", (provider,))
            self._db.commit()
        log.info("unlinked %s (purge=%s)", provider, purge)

    def update_credentials(self, provider: str, credentials: dict) -> None:
        """Persist rotated tokens (PSN refreshes them mid-sync) without touching
        status or identity the way link() would."""
        with self._lock:
            self._db.execute(
                "UPDATE linked_accounts SET credentials=? WHERE provider=?",
                (json.dumps(credentials), provider))
            self._db.commit()

    def set_status(self, provider: str, status: str, error: str | None = None) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE linked_accounts SET status=?, error=? WHERE provider=?",
                (status, error, provider))
            self._db.commit()

    def mark_sync(self, provider: str, full: bool = False) -> None:
        with self._lock:
            if full:
                self._db.execute(
                    "UPDATE linked_accounts SET last_sync=?, last_full_sync=? WHERE provider=?",
                    (_now(), _now(), provider))
            else:
                self._db.execute(
                    "UPDATE linked_accounts SET last_sync=? WHERE provider=?",
                    (_now(), provider))
            self._db.commit()

    # ---- library -----------------------------------------------------------
    def upsert_games(self, provider: str, games: list[dict]) -> list[str]:
        """Upsert the library snapshot. Returns app_ids whose playtime changed —
        the sync engine uses that as 'worth re-asking for achievements'."""
        changed = []
        day = _today()
        with self._lock:
            old = dict(self._db.execute(
                "SELECT app_id, playtime_min FROM lib_games WHERE provider=?", (provider,)))
            for g in games:
                aid = str(g["appId"])
                mins = g.get("playtimeMin") or 0
                if old.get(aid) != mins:
                    changed.append(aid)
                    self._db.execute(
                        "INSERT OR REPLACE INTO playtime_daily(provider,app_id,day,minutes)"
                        " VALUES(?,?,?,?)", (provider, aid, day, mins))
                self._db.execute(
                    "INSERT INTO lib_games(provider,app_id,name,playtime_min,"
                    " playtime_2wk_min,last_played,icon_url,extra,platform,updated_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(provider,app_id) DO UPDATE SET name=excluded.name,"
                    " playtime_min=excluded.playtime_min,"
                    " playtime_2wk_min=excluded.playtime_2wk_min,"
                    " last_played=excluded.last_played, icon_url=excluded.icon_url,"
                    " extra=excluded.extra, platform=excluded.platform,"
                    " updated_at=excluded.updated_at",
                    (provider, aid, g.get("name"), mins, g.get("playtime2wkMin"),
                     g.get("lastPlayed"), g.get("iconUrl"),
                     json.dumps(g["extra"]) if g.get("extra") else None,
                     g.get("platform"), _now()))
            self._db.commit()
        return changed

    def lib_games(self, provider: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT app_id, name, playtime_min, playtime_2wk_min, last_played, platform"
                " FROM lib_games WHERE provider=?", (provider,)).fetchall()
        return [{"appId": r[0], "name": r[1], "playtimeMin": r[2],
                 "playtime2wkMin": r[3], "lastPlayed": r[4], "platform": r[5]} for r in rows]

    # ---- matching ----------------------------------------------------------
    def replace_matches(self, provider: str, app_id: str,
                        matches: list[tuple[str, str, int | None]]) -> None:
        """matches: [(match_key, source, score)] — the full new set for one app."""
        with self._lock:
            self._db.execute(
                "DELETE FROM lib_matches WHERE provider=? AND app_id=?", (provider, app_id))
            for mk, source, score in matches:
                if not mk:
                    continue
                self._db.execute(
                    "INSERT OR REPLACE INTO lib_matches(provider,app_id,match_key,source,score)"
                    " VALUES(?,?,?,?,?)", (provider, app_id, mk, source, score))
            self._db.commit()

    def replace_matches_bulk(self, provider: str,
                             per_app: dict[str, list[tuple[str, str, int | None]]]) -> None:
        """The whole matching pass in ONE transaction. Per-app commits meant
        ~5,000 fsyncs on the PVC — five minutes of a matching pass that
        computes in under a second."""
        with self._lock:
            for app_id, matches in per_app.items():
                self._db.execute(
                    "DELETE FROM lib_matches WHERE provider=? AND app_id=?",
                    (provider, app_id))
                for mk, source, score in matches:
                    if not mk:
                        continue
                    self._db.execute(
                        "INSERT OR REPLACE INTO lib_matches(provider,app_id,match_key,"
                        " source,score) VALUES(?,?,?,?,?)",
                        (provider, app_id, mk, source, score))
            self._db.commit()

    def matches(self, provider: str) -> dict[str, list[dict]]:
        """{app_id: [{key, source, score}]}"""
        out: dict[str, list[dict]] = {}
        with self._lock:
            rows = self._db.execute(
                "SELECT app_id, match_key, source, score FROM lib_matches"
                " WHERE provider=?", (provider,)).fetchall()
        for aid, mk, src, score in rows:
            out.setdefault(aid, []).append({"key": mk, "source": src, "score": score})
        return out

    def app_for_key(self, provider: str, match_key: str) -> str | None:
        with self._lock:
            row = self._db.execute(
                "SELECT app_id FROM lib_matches WHERE provider=? AND match_key=?",
                (provider, match_key)).fetchone()
        return row[0] if row else None

    def steam_appid_for_key(self, match_key: str) -> str | None:
        """The enricher's appid override: the appid of the copy I actually own."""
        return self.app_for_key("steam", match_key)

    def set_override(self, provider: str, app_id: str, match_key: str) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO match_overrides(provider,app_id,match_key)"
                " VALUES(?,?,?)", (provider, str(app_id), match_key))
            self._db.commit()

    def clear_override(self, provider: str, app_id: str) -> None:
        with self._lock:
            self._db.execute(
                "DELETE FROM match_overrides WHERE provider=? AND app_id=?",
                (provider, str(app_id)))
            self._db.commit()

    def overrides(self, provider: str) -> dict[str, str]:
        with self._lock:
            rows = self._db.execute(
                "SELECT app_id, match_key FROM match_overrides WHERE provider=?",
                (provider,)).fetchall()
        return dict(rows)

    # ---- achievements --------------------------------------------------------
    def save_achievements(self, provider: str, app_id: str, rows: list[dict]) -> None:
        with self._lock:
            for a in rows:
                self._db.execute(
                    "INSERT INTO achievements(provider,app_id,ach_id,name,description,"
                    " icon_url,icon_locked_url,hidden,rarity,global_pct,unlocked,"
                    " unlocked_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(provider,app_id,ach_id) DO UPDATE SET"
                    " name=excluded.name, description=excluded.description,"
                    " icon_url=excluded.icon_url, icon_locked_url=excluded.icon_locked_url,"
                    " hidden=excluded.hidden, rarity=excluded.rarity,"
                    " global_pct=excluded.global_pct, unlocked=excluded.unlocked,"
                    " unlocked_at=excluded.unlocked_at, updated_at=excluded.updated_at",
                    (provider, str(app_id), a["id"], a.get("name"), a.get("description"),
                     a.get("iconUrl"), a.get("iconLockedUrl"), 1 if a.get("hidden") else 0,
                     a.get("rarity"), a.get("globalPct"), 1 if a.get("unlocked") else 0,
                     a.get("unlockedAt"), _now()))
            self._db.commit()

    def achievements_for(self, provider: str, app_id: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT ach_id,name,description,icon_url,icon_locked_url,hidden,"
                " rarity,global_pct,unlocked,unlocked_at FROM achievements"
                " WHERE provider=? AND app_id=?", (provider, str(app_id))).fetchall()
        return [{"id": r[0], "name": r[1], "description": r[2], "iconUrl": r[3],
                 "iconLockedUrl": r[4], "hidden": bool(r[5]), "rarity": r[6],
                 "globalPct": r[7], "unlocked": bool(r[8]), "unlockedAt": r[9]}
                for r in rows]

    def apps_with_achievements(self, provider: str) -> set[str]:
        with self._lock:
            rows = self._db.execute(
                "SELECT DISTINCT app_id FROM achievements WHERE provider=?",
                (provider,)).fetchall()
        return {r[0] for r in rows}

    # ---- screenshots ---------------------------------------------------------
    def upsert_shots(self, provider: str, shots: list[dict]) -> int:
        """Insert metadata for new shots; returns how many were new."""
        new = 0
        with self._lock:
            for s in shots:
                cur = self._db.execute(
                    "INSERT INTO screenshots(provider,shot_id,app_id,taken_at,caption,"
                    " source_url,width,height,updated_at) VALUES(?,?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(provider,shot_id) DO NOTHING",
                    (provider, str(s["id"]), str(s["appId"]) if s.get("appId") else None,
                     s.get("takenAt"), s.get("caption"), s.get("sourceUrl"),
                     s.get("width"), s.get("height"), _now()))
                new += cur.rowcount
            self._db.commit()
        return new

    def shots_undownloaded(self, provider: str, limit: int = 200) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT shot_id, source_url FROM screenshots"
                " WHERE provider=? AND file_path IS NULL AND source_url IS NOT NULL"
                " LIMIT ?", (provider, limit)).fetchall()
        return [{"id": r[0], "sourceUrl": r[1]} for r in rows]

    def set_shot_file(self, provider: str, shot_id: str, file_path: str,
                      width: int | None = None, height: int | None = None) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE screenshots SET file_path=?,"
                " width=COALESCE(?,width), height=COALESCE(?,height)"
                " WHERE provider=? AND shot_id=?",
                (file_path, width, height, provider, str(shot_id)))
            self._db.commit()

    def shots_for_app(self, provider: str, app_id: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT shot_id, taken_at, caption, file_path, source_url, width, height"
                " FROM screenshots WHERE provider=? AND app_id=?"
                " ORDER BY taken_at DESC", (provider, str(app_id))).fetchall()
        return [{"id": r[0], "takenAt": r[1], "caption": r[2], "filePath": r[3],
                 "sourceUrl": r[4], "width": r[5], "height": r[6]} for r in rows]

    def shot_row(self, provider: str, shot_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT file_path, source_url FROM screenshots"
                " WHERE provider=? AND shot_id=?", (provider, str(shot_id))).fetchone()
        if row is None:
            return None
        return {"filePath": row[0], "sourceUrl": row[1]}

    # ---- wishlist --------------------------------------------------------------
    # The match + price columns to carry across a full wishlist refresh (both
    # are filled by separate passes and mustn't be wiped every sync).
    _WL_KEEP = ("match_key", "igdb_id", "cover", "name", "itad_id",
                "price_current", "price_regular", "price_cut", "price_low",
                "price_currency", "price_url", "price_shop", "price_at_low",
                "price_updated")

    def replace_wishlist(self, provider: str, items: list[dict]) -> None:
        """Full refresh, but keep the prior match AND price columns for entries
        that persist — those come from separate passes."""
        cols = ",".join(self._WL_KEEP)
        with self._lock:
            old = {r[0]: dict(zip(self._WL_KEEP, r[1:])) for r in self._db.execute(
                f"SELECT app_id, {cols} FROM wishlist WHERE provider=?", (provider,))}
            self._db.execute("DELETE FROM wishlist WHERE provider=?", (provider,))
            for w in items:
                aid = str(w["appId"])
                p = old.get(aid, {})
                self._db.execute(
                    "INSERT INTO wishlist(provider,app_id,name,added_at,priority,extra,"
                    " match_key,igdb_id,cover,updated_at,itad_id,price_current,"
                    " price_regular,price_cut,price_low,price_currency,price_url,"
                    " price_shop,price_at_low,price_updated)"
                    " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (provider, aid, w.get("name") or p.get("name"), w.get("addedAt"),
                     w.get("priority"),
                     json.dumps(w["extra"]) if w.get("extra") else None,
                     p.get("match_key"), p.get("igdb_id"), p.get("cover"), _now(),
                     p.get("itad_id"), p.get("price_current"), p.get("price_regular"),
                     p.get("price_cut"), p.get("price_low"), p.get("price_currency"),
                     p.get("price_url"), p.get("price_shop"), p.get("price_at_low"),
                     p.get("price_updated")))
            self._db.commit()

    def wishlist_for_pricing(self, provider: str, stale_before: str) -> list[dict]:
        """Steam wishlist entries whose price is missing or older than
        `stale_before` (an ISO timestamp) — the ones a price pass should refresh."""
        with self._lock:
            rows = self._db.execute(
                "SELECT app_id, itad_id FROM wishlist WHERE provider=?"
                " AND (price_updated IS NULL OR price_updated < ?)",
                (provider, stale_before)).fetchall()
        return [{"appId": r[0], "itadId": r[1]} for r in rows]

    def set_wishlist_price(self, provider: str, app_id: str, itad_id: str | None,
                           price: dict | None) -> None:
        p = price or {}
        with self._lock:
            self._db.execute(
                "UPDATE wishlist SET itad_id=COALESCE(?,itad_id), price_current=?,"
                " price_regular=?, price_cut=?, price_low=?, price_currency=?,"
                " price_url=?, price_shop=?, price_at_low=?, price_updated=?"
                " WHERE provider=? AND app_id=?",
                (itad_id, p.get("current"), p.get("regular"), p.get("cut"),
                 p.get("low"), p.get("currency"), p.get("url"), p.get("shop"),
                 1 if p.get("atLow") else 0, _now(), provider, str(app_id)))
            self._db.commit()

    def wishlist_unmatched(self, provider: str) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT app_id, name FROM wishlist"
                " WHERE provider=? AND match_key IS NULL AND igdb_id IS NULL",
                (provider,)).fetchall()
        return [{"appId": r[0], "name": r[1]} for r in rows]

    def set_wishlist_match(self, provider: str, app_id: str, match_key: str | None,
                           igdb_id: int | None, cover: str | None = None,
                           name: str | None = None) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE wishlist SET match_key=?, igdb_id=?,"
                " cover=COALESCE(?,cover), name=COALESCE(?,name)"
                " WHERE provider=? AND app_id=?",
                (match_key, igdb_id, cover, name, provider, str(app_id)))
            self._db.commit()

    def wishlist_all(self) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT provider, app_id, name, added_at, priority, match_key,"
                " igdb_id, cover, price_current, price_regular, price_cut, price_low,"
                " price_currency, price_url, price_shop, price_at_low FROM wishlist").fetchall()
        out = []
        for r in rows:
            item = {"provider": r[0], "appId": r[1], "name": r[2], "addedAt": r[3],
                    "priority": r[4], "matchKey": r[5], "igdbId": r[6], "cover": r[7]}
            if r[8] is not None or r[11] is not None:      # has price or a known low
                item["price"] = {"current": r[8], "regular": r[9], "cut": r[10],
                                 "low": r[11], "currency": r[12], "url": r[13],
                                 "shop": r[14], "atLow": bool(r[15])}
            out.append(item)
        return out

    # ---- reviews ----------------------------------------------------------------
    def replace_reviews(self, provider: str, items: list[dict]) -> None:
        with self._lock:
            self._db.execute("DELETE FROM reviews WHERE provider=?", (provider,))
            for r in items:
                self._db.execute(
                    "INSERT OR REPLACE INTO reviews(provider,app_id,recommended,text,"
                    " posted_at,hours_at_review,url,updated_at) VALUES(?,?,?,?,?,?,?,?)",
                    (provider, str(r["appId"]),
                     None if r.get("recommended") is None else int(r["recommended"]),
                     r.get("text"), r.get("postedAt"), r.get("hoursAtReview"),
                     r.get("url"), _now()))
            self._db.commit()

    def review_for(self, provider: str, app_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT recommended, text, posted_at, hours_at_review, url FROM reviews"
                " WHERE provider=? AND app_id=?", (provider, str(app_id))).fetchone()
        if row is None:
            return None
        return {"recommended": None if row[0] is None else bool(row[0]),
                "text": row[1], "postedAt": row[2], "hoursAtReview": row[3], "url": row[4]}

    # ---- the light map (one query pass, served on every page load) ----------------
    def mine_light(self) -> dict[str, dict]:
        """{match_key: {provider, appId, playtimeMin, ..., ach:{unlocked,total},
        shots, review:{recommended}}} — everything the grid/hero/launch needs,
        fanned out to EVERY sheet row the app matched (a PC row and a Deck row
        both deserve the hours)."""
        with self._lock:
            games = {(r[0], r[1]): r for r in self._db.execute(
                "SELECT provider, app_id, playtime_min, playtime_2wk_min,"
                " last_played FROM lib_games")}
            match_rows = self._db.execute(
                "SELECT provider, app_id, match_key FROM lib_matches").fetchall()
            ach = {(r[0], r[1]): (r[2], r[3]) for r in self._db.execute(
                "SELECT provider, app_id, SUM(unlocked), COUNT(*) FROM achievements"
                " GROUP BY provider, app_id")}
            shots = {(r[0], r[1]): r[2] for r in self._db.execute(
                "SELECT provider, app_id, COUNT(*) FROM screenshots"
                " WHERE app_id IS NOT NULL GROUP BY provider, app_id")}
            revs = {(r[0], r[1]): r[2] for r in self._db.execute(
                "SELECT provider, app_id, recommended FROM reviews")}
            wl_keys = {r[0] for r in self._db.execute(
                "SELECT DISTINCT match_key FROM wishlist WHERE match_key IS NOT NULL")}
        out: dict[str, dict] = {}
        for provider, app_id, mk in match_rows:
            g = games.get((provider, app_id))
            if g is None:
                continue
            entry = out.setdefault(mk, {})
            item = {"appId": app_id, "playtimeMin": g[2], "playtime2wkMin": g[3],
                    "lastPlayed": g[4]}
            a = ach.get((provider, app_id))
            if a and a[1]:
                item["ach"] = {"unlocked": a[0] or 0, "total": a[1]}
            n = shots.get((provider, app_id))
            if n:
                item["shots"] = n
            r = revs.get((provider, app_id))
            if r is not None:
                item["review"] = {"recommended": bool(r)}
            entry[provider] = item
        for mk in wl_keys:
            out.setdefault(mk, {}).setdefault("_flags", {})["wishlisted"] = True
        return out

    def counts(self, provider: str) -> dict:
        with self._lock:
            g = self._db.execute(
                "SELECT COUNT(*) FROM lib_games WHERE provider=?", (provider,)).fetchone()[0]
            m = self._db.execute(
                "SELECT COUNT(DISTINCT app_id) FROM lib_matches WHERE provider=?",
                (provider,)).fetchone()[0]
            a = self._db.execute(
                "SELECT COUNT(*) FROM achievements WHERE provider=?", (provider,)).fetchone()[0]
            au = self._db.execute(
                "SELECT COUNT(*) FROM achievements WHERE provider=? AND unlocked=1",
                (provider,)).fetchone()[0]
            s = self._db.execute(
                "SELECT COUNT(*) FROM screenshots WHERE provider=?", (provider,)).fetchone()[0]
            w = self._db.execute(
                "SELECT COUNT(*) FROM wishlist WHERE provider=?", (provider,)).fetchone()[0]
            r = self._db.execute(
                "SELECT COUNT(*) FROM reviews WHERE provider=?", (provider,)).fetchone()[0]
        return {"games": g, "matched": m, "achievements": a, "achievementsUnlocked": au,
                "screenshots": s, "wishlist": w, "reviews": r}
