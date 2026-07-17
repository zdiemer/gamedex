"""The platform sync engine: one background thread, one pass per linked account.

A pass is five stages — library, matching, achievements, screenshots, wishlist +
reviews — and each stage fails ALONE. A markup change that breaks the review
scrape must cost exactly the reviews; the hours and achievements still land.
Whatever broke is written to linked_accounts.error so the admin card can say so.

Providers are pluggable (steam today; psn/xbox/nintendo are future modules with
the same duck type — see steam_user.SteamUserClient). The engine owns pacing:
achievements are 2-3 requests per app, so a 2,000-game library is NOT fetched in
one pass — apps whose playtime just changed go first, then a bounded slice
(ACH_BACKFILL_PER_SYNC) of never-asked apps, so the full backfill spreads over
days at one request a second without starving anything else.

Matching — which sheet row does this Steam app belong to — reuses the site's
own identity machinery: the IGDB store appid on the enrichment record first
(exact), then the normalized title against the sheet's PC-family rows, then a
unique fuzzy hit. One app may match SEVERAL rows (a PC row and a Steam Deck
row); all of them get the hours. A manual pin in match_overrides beats
everything and '' pins "matches nothing". Matching re-runs when the workbook
or the library changes, and never overwrites a pin.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from pathlib import Path

from match_validator import MatchValidator

log = logging.getLogger("gamedex.platform_sync")

# Which platforms' sheet rows a provider's library may match onto.
_PLATFORM_FAMILY = {
    "steam": {"pc", "mac os"},
    "psn": {"playstation", "playstation 2", "playstation 3", "playstation 4",
            "playstation 5", "playstation vita", "psp"},
    "xbox": {"xbox", "xbox 360", "xbox one", "xbox series x|s"},
    "nintendo": {"nintendo switch", "nintendo switch 2", "nintendo wii u",
                 "nintendo 3ds"},
}
# The slot in the IGDB record's `stores` map that carries this provider's id.
_STORE_SLOT = {"steam": "steam", "psn": "playstation", "xbox": "xbox"}


class PlatformSync:
    def __init__(self, db, providers: dict, enricher=None, catalogue=None,
                 store=None, shots_dir: Path = Path("/data/platshots"),
                 interval: int = 21600, ach_backfill: int = 150):
        self._db = db
        self._providers = providers
        self._enricher = enricher
        self._catalogue = catalogue
        self._store = store
        self._shots_dir = shots_dir
        self._interval = interval
        self._ach_backfill = ach_backfill
        self._validator = MatchValidator()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = None
        self._busy = {}          # provider -> stage string, for /api/platforms

    # ---- lifecycle ---------------------------------------------------------
    def start(self):
        self._thread = threading.Thread(target=self._loop, daemon=True,
                                        name="platform-sync")
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def kick(self):
        """Sync now (the admin button). The loop wakes and takes a full pass."""
        self._wake.set()

    def busy(self, provider: str) -> str | None:
        return self._busy.get(provider)

    def provider(self, name: str):
        return self._providers.get(name)

    def _loop(self):
        # First pass shortly after boot, so a restart doesn't wait 6 hours.
        if self._stop.wait(20):
            return
        while not self._stop.is_set():
            forced = self._wake.is_set()
            self._wake.clear()
            for acct in self._db.accounts():
                provider = acct["provider"]
                client = self._providers.get(provider)
                if client is None or acct["status"] == "disabled":
                    continue
                if forced or self._due(acct):
                    try:
                        self.sync_account(acct, client)
                    except Exception as exc:
                        log.warning("%s sync pass failed: %s", provider, exc)
                        self._db.set_status(provider, "error", str(exc))
            # Matching also depends on the SHEET, which changes on its own
            # schedule — re-run cheaply whenever the workbook hash moves.
            try:
                self._rematch_if_stale()
            except Exception as exc:
                log.warning("rematch failed: %s", exc)
            self._wake.wait(60)
            self._wake.clear()

    def _due(self, acct) -> bool:
        from datetime import datetime, timezone
        if not acct["lastSync"]:
            return True
        try:
            last = datetime.fromisoformat(acct["lastSync"])
        except ValueError:
            return True
        return (datetime.now(timezone.utc) - last).total_seconds() >= self._interval

    # ---- one pass ------------------------------------------------------------
    def sync_account(self, acct: dict, client) -> dict:
        provider, creds = acct["provider"], acct["credentials"]
        errors = []
        counts = {}

        def stage(name, fn):
            self._busy[provider] = name
            try:
                return fn()
            except Exception as exc:
                log.warning("%s %s stage failed: %s", provider, name, exc)
                errors.append(f"{name}: {exc}")
                return None
            finally:
                self._busy.pop(provider, None)

        changed = stage("library", lambda: self._sync_library(provider, client, creds))
        stage("matching", lambda: self._match_library(provider))
        counts["achievements"] = stage(
            "achievements", lambda: self._sync_achievements(provider, client, creds, changed or []))
        counts["screenshots"] = stage(
            "screenshots", lambda: self._sync_screenshots(provider, client, creds))
        counts["wishlist"] = stage(
            "wishlist", lambda: self._sync_wishlist(provider, client, creds))
        counts["reviews"] = stage(
            "reviews", lambda: self._sync_reviews(provider, client, creds))

        self._db.mark_sync(provider)
        self._db.set_status(provider, "error" if errors else "linked",
                            "; ".join(errors) if errors else None)
        log.info("%s sync done: %s%s", provider, counts,
                 f" ({len(errors)} stage errors)" if errors else "")
        return counts

    # ---- stages -----------------------------------------------------------------
    def _sync_library(self, provider, client, creds) -> list[str]:
        games = client.fetch_library(creds)
        changed = self._db.upsert_games(provider, games)
        log.info("%s library: %d games, %d with changed playtime",
                 provider, len(games), len(changed))
        return changed

    def _sync_achievements(self, provider, client, creds, changed: list[str]) -> int:
        have = self._db.apps_with_achievements(provider)
        no_ach = lambda a: self._db.kv_get(f"noach:{provider}:{a}") is not None
        # Recently-played first, then a bounded slice of the never-asked backlog.
        todo = [a for a in changed if not no_ach(a)]
        backlog = [g["appId"] for g in self._db.lib_games(provider)
                   if g["appId"] not in have and g["appId"] not in todo
                   and not no_ach(g["appId"])]
        todo += backlog[: self._ach_backfill]
        fetched = 0
        for app_id in todo:
            if self._stop.is_set():
                break
            rows = client.fetch_achievements(creds, app_id)
            if rows is None:
                self._db.kv_set(f"noach:{provider}:{app_id}", "1")
                continue
            self._db.save_achievements(provider, app_id, rows)
            fetched += 1
        if todo:
            log.info("%s achievements: refreshed %d apps (%d backlog left)",
                     provider, fetched, max(0, len(backlog) - self._ach_backfill))
        return fetched

    def _sync_screenshots(self, provider, client, creds) -> int:
        cursor = self._db.kv_get(f"shots_cursor:{provider}")
        shots, new_cursor = client.fetch_screenshots(creds, cursor)
        new = self._db.upsert_shots(provider, shots)
        if new_cursor:
            self._db.kv_set(f"shots_cursor:{provider}", str(new_cursor))
        # Download whatever still has no local file — including strays from a
        # previous pass that died mid-download.
        saved = 0
        for s in self._db.shots_undownloaded(provider):
            if self._stop.is_set():
                break
            try:
                data = client.download(s["sourceUrl"])
            except Exception as exc:
                log.debug("shot %s download failed: %s", s["id"], exc)
                continue
            rel = self._shot_path(provider, s["id"], s["sourceUrl"])
            dest = self._shots_dir / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
            self._db.set_shot_file(provider, s["id"], rel)
            saved += 1
        if new or saved:
            log.info("%s screenshots: %d new, %d downloaded", provider, new, saved)
        return saved

    @staticmethod
    def _shot_path(provider, shot_id, url) -> str:
        ext = "jpg"
        m = (url or "").split("?")[0].rsplit(".", 1)
        if len(m) == 2 and m[1].lower() in ("jpg", "jpeg", "png", "webp"):
            ext = m[1].lower()
        return f"{provider}/{shot_id}.{ext}"

    def _sync_wishlist(self, provider, client, creds) -> int:
        items = client.fetch_wishlist(creds)
        self._db.replace_wishlist(provider, items)
        self._match_wishlist(provider)
        return len(items)

    def _sync_reviews(self, provider, client, creds) -> int:
        items = client.fetch_reviews(creds)
        # An empty scrape when we HAD reviews smells like a markup change or a
        # login wall, not a user deleting everything — keep what we have.
        if not items and self._db.counts(provider)["reviews"]:
            raise RuntimeError("scrape returned nothing; keeping existing reviews")
        self._db.replace_reviews(provider, items)
        return len(items)

    # ---- matching ------------------------------------------------------------------
    def _match_stamp(self, provider) -> str:
        src = ""
        if self._store is not None:
            src = str(self._store.snapshot()["meta"].get("sourceHash") or "")
        return f"{src}|{self._db.counts(provider)['games']}"

    def _rematch_if_stale(self):
        for acct in self._db.accounts():
            p = acct["provider"]
            if self._db.kv_get(f"match_stamp:{p}") != self._match_stamp(p):
                self._match_library(p)
                self._match_wishlist(p)

    def _appid_to_keys(self, provider) -> dict[str, list[str]]:
        """{store appid: [match_key]} from every matched enrichment record."""
        slot = _STORE_SLOT.get(provider)
        out: dict[str, list[str]] = {}
        if not slot or self._enricher is None:
            return out
        for mk, rec in self._enricher.all_records().items():
            st = (rec.get("stores") or {}).get(slot)
            sid = st.get("id") if isinstance(st, dict) else st
            if sid:
                out.setdefault(str(sid), []).append(mk)
        return out

    def _match_library(self, provider):
        if self._enricher is None:
            return
        overrides = self._db.overrides(provider)
        appid_keys = self._appid_to_keys(provider)
        meta = self._enricher.keys_meta()
        family = _PLATFORM_FAMILY.get(provider, set())
        by_norm: dict[str, list[str]] = {}
        for mk, m in meta.items():
            if (m.get("platform") or "").lower() in family:
                by_norm.setdefault(self._validator.normalize(m.get("title") or ""),
                                   []).append(mk)

        games = self._db.lib_games(provider)
        matched = appid_hits = title_hits = fuzzy_hits = 0
        owned_appid_keys = []     # keys whose owned appid should refresh steamx/pcgw
        for g in games:
            aid = str(g["appId"])
            if aid in overrides:
                mk = overrides[aid]
                self._db.replace_matches(provider, aid,
                                         [(mk, "manual", None)] if mk else [])
                if mk:
                    matched += 1
                    owned_appid_keys.append((mk, aid))
                continue
            keys = appid_keys.get(aid)
            if keys:
                self._db.replace_matches(provider, aid, [(k, "appid", None) for k in keys])
                matched += 1
                appid_hits += 1
                owned_appid_keys += [(k, aid) for k in keys]
                continue
            norm = self._validator.normalize(g["name"] or "")
            keys = by_norm.get(norm)
            if keys:
                self._db.replace_matches(provider, aid, [(k, "title", None) for k in keys])
                matched += 1
                title_hits += 1
                owned_appid_keys += [(k, aid) for k in keys]
                continue
            hit = self._fuzzy_one(g["name"], by_norm, meta)
            if hit:
                self._db.replace_matches(provider, aid, [(hit, "fuzzy", None)])
                matched += 1
                fuzzy_hits += 1
                owned_appid_keys.append((hit, aid))
            else:
                self._db.replace_matches(provider, aid, [])
        self._db.kv_set(f"match_stamp:{provider}", self._match_stamp(provider))
        log.info("%s matching: %d/%d matched (%d appid, %d title, %d fuzzy)",
                 provider, matched, len(games), appid_hits, title_hits, fuzzy_hits)
        self._requeue_corrected(provider, owned_appid_keys, appid_keys)

    def _fuzzy_one(self, name, by_norm, meta) -> str | None:
        """A UNIQUE fuzzy hit or nothing — a tie means we don't know, and a wrong
        match here quietly hangs my hours on someone else's game."""
        if not name:
            return None
        hits = []
        for norm, keys in by_norm.items():
            if self._validator.titles_equal_fuzzy(name, meta[keys[0]].get("title") or ""):
                hits += keys
                if len(hits) > 1:
                    return None
        return hits[0] if len(hits) == 1 else None

    def _requeue_corrected(self, provider, owned_appid_keys, appid_keys):
        """Where the appid I actually own differs from the one IGDB guessed,
        make the appid-keyed sources (steamx, pcgw) re-fetch under the right id.
        The enricher's appid_for already prefers the override; this just clears
        the stale rows fetched under the wrong id."""
        if provider != "steam" or self._enricher is None:
            return
        igdb_appid = {}
        for aid, keys in appid_keys.items():
            for k in keys:
                igdb_appid[k] = aid
        # != covers both cases that matter: IGDB guessed a DIFFERENT appid, and
        # IGDB had none at all (steamx/pcgw recorded no_match; now they can ask).
        wrong = sorted({k for k, aid in owned_appid_keys if igdb_appid.get(k) != aid})
        if not wrong:
            return
        # Requeueing deletes + re-fetches those sources, so do it once per SET,
        # not once per rematch — the sheet changes far more often than this list.
        sig = hashlib.sha256("\n".join(wrong).encode()).hexdigest()
        if self._db.kv_get("requeue_sig:steam") == sig:
            return
        log.info("steam: %d keys' owned appid beats IGDB's; requeueing appid sources",
                 len(wrong))
        self._enricher.requeue_appid_sources(wrong)
        self._db.kv_set("requeue_sig:steam", sig)

    def _match_wishlist(self, provider):
        if self._enricher is None:
            return
        appid_keys = self._appid_to_keys(provider)
        meta = self._enricher.keys_meta()
        by_norm: dict[str, list[str]] = {}
        for mk, m in meta.items():     # any platform: a wishlisted PC game may be owned on PS4
            by_norm.setdefault(self._validator.normalize(m.get("title") or ""),
                               []).append(mk)
        for w in self._db.wishlist_unmatched(provider):
            aid = str(w["appId"])
            keys = appid_keys.get(aid)
            if keys:
                self._db.set_wishlist_match(provider, aid, keys[0], None)
                continue
            if not w["name"]:
                continue
            norm = self._validator.normalize(w["name"])
            keys = by_norm.get(norm)
            if keys:
                self._db.set_wishlist_match(provider, aid, keys[0], None)
                continue
            if self._catalogue is not None:
                hit = self._catalogue.lookup_norm(norm)
                if hit:
                    self._db.set_wishlist_match(provider, aid, None, hit["igdbId"],
                                                cover=hit.get("cover"),
                                                name=w["name"] or hit.get("name"))
