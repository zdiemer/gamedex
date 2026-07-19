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
import re
import threading
from pathlib import Path

from match_validator import MatchValidator

log = logging.getLogger("gamedex.platform_sync")

# Redact secrets from anything we log. A requests HTTPError stringifies the full
# URL, which for the Steam Web API carries ?key=<web api key> — a credential that
# must never reach a log line. Also masks the OpenXBL / PSN token headers.
_SECRET_RE = re.compile(
    r"((?:key|apiKey|api_key|access_token|npsso|x-authorization)=)[^&\s\"']+",
    re.IGNORECASE)


def _scrub(s) -> str:
    return _SECRET_RE.sub(r"\1<redacted>", str(s))

# Which platforms' sheet rows a provider's library may match onto.
_PC = {"pc", "mac os", "linux"}
_PLATFORM_FAMILY = {
    "steam": _PC, "gog": _PC, "epic": _PC, "itch": _PC,   # PC storefronts
    "psn": {"playstation", "playstation 2", "playstation 3", "playstation 4",
            "playstation 5", "playstation network", "playstation portable",
            "playstation vita"},
    "xbox": {"xbox", "xbox 360", "xbox one", "xbox series x|s"},
    "nintendo": {"nintendo switch", "nintendo switch 2", "nintendo wii u",
                 "nintendo 3ds"},
}
# The slot in the IGDB record's `stores` map that carries this provider's id.
_STORE_SLOT = {"steam": "steam", "psn": "playstation", "xbox": "xbox",
               "gog": "gog", "epic": "epic", "itch": "itch"}


class PlatformSync:
    def __init__(self, db, providers: dict, enricher=None, catalogue=None,
                 store=None, shots_dir: Path = Path("/data/platshots"),
                 interval: int = 21600, ach_backfill: int = 150, itad=None,
                 itad_interval: int = 3600):
        self._db = db
        self._providers = providers
        self._enricher = enricher
        self._catalogue = catalogue
        self._store = store
        self._itad = itad          # ItadClient (prices), or None if no key
        self._shots_dir = shots_dir
        self._interval = interval
        self._itad_interval = itad_interval
        self._ach_backfill = ach_backfill
        self._validator = MatchValidator()
        self._stop = threading.Event()
        self._wakes = {}         # provider -> its own wake Event (one worker each)
        self._threads = []
        self._busy = {}          # provider -> stage string, for /api/platforms
        self._hot = {}           # provider -> achievements backlog remains; drain promptly

    # ---- lifecycle ---------------------------------------------------------
    def start(self):
        # ONE thread per provider, not one shared. A freshly-linked PSN must not
        # wait behind Steam's multi-hour achievement backfill — the two sync
        # concurrently, each on its own clock. The DB is thread-safe (a lock per
        # method) and the enricher reads it hands out are snapshots, so parallel
        # matching passes don't collide.
        for name, client in self._providers.items():
            self._wakes[name] = threading.Event()
            t = threading.Thread(target=self._provider_loop, args=(name, client),
                                 daemon=True, name=f"platform-sync-{name}")
            self._threads.append(t)
            t.start()
        # Prices used to refresh only inside the 6-hour sync pass, so a Steam
        # flash sale could be over before the wishlist ever saw it. They get
        # their own clock now: hourly, and cheap — a resolved wishlist re-prices
        # in batches of 200 ids, ~15 requests against ITAD's 1,000-per-5-minutes.
        # Lookups (per-item) and bundle checks (no batch endpoint) stay on the
        # sync pass; this loop only touches items that already have an ITAD id.
        if self._itad is not None and self._itad.configured:
            t = threading.Thread(target=self._price_loop, daemon=True, name="itad-prices")
            self._threads.append(t)
            t.start()

    def stop(self):
        self._stop.set()
        for ev in self._wakes.values():
            ev.set()

    def kick(self, provider: str | None = None):
        """Sync now. With a provider, wake only that worker (a fresh link syncs
        immediately regardless of what the others are doing); without, wake all."""
        targets = [provider] if provider else list(self._wakes)
        for name in targets:
            ev = self._wakes.get(name)
            if ev:
                ev.set()

    def busy(self, provider: str) -> str | None:
        return self._busy.get(provider)

    def provider(self, name: str):
        return self._providers.get(name)

    def _provider_loop(self, provider: str, client):
        wake = self._wakes[provider]
        # First pass shortly after boot, so a restart doesn't wait 6 hours — but
        # a hair later per provider so four cold workers don't all hammer the
        # enricher's first matching pass at once.
        if self._stop.wait(20):
            return
        # The in-memory `hot` flag is lost on restart, so a provider that synced
        # <6h ago would be neither due nor hot and would nap until the 6h mark —
        # stalling any half-drained achievement/price backfill across a deploy.
        # Force ONE pass on boot to re-establish the drain state.
        boot = True
        while not self._stop.is_set():
            forced = wake.is_set() or boot
            boot = False
            wake.clear()
            acct = self._db.account(provider)
            if acct and acct["status"] != "disabled":
                full = forced or self._due(acct)
                if full or self._hot.get(provider):
                    try:
                        # A hot pass is achievements-only: the backlog drains in
                        # chunks without re-scraping reviews or re-pulling the
                        # library every few seconds.
                        self.sync_account(acct, client, ach_only=not full)
                    except Exception as exc:
                        log.warning("%s sync pass failed: %s", provider, _scrub(exc))
                        self._db.set_status(provider, "error", _scrub(str(exc)))
            # Matching also tracks the SHEET, which moves on its own schedule.
            try:
                if self._match_stale(provider):
                    self._match_library(provider)
                    self._match_wishlist(provider)
            except Exception as exc:
                log.warning("%s rematch failed: %s", provider, exc)
            # Hot (draining a first backfill) → come back in seconds; else nap.
            wake.wait(5 if self._hot.get(provider) else 60)
            wake.clear()

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
    def sync_account(self, acct: dict, client, ach_only: bool = False) -> dict:
        provider, creds = acct["provider"], acct["credentials"]
        errors = []
        counts = {}

        def stage(name, fn):
            self._busy[provider] = name
            try:
                return fn()
            except Exception as exc:
                log.warning("%s %s stage failed: %s", provider, name, _scrub(exc))
                errors.append(_scrub(f"{name}: {exc}"))
                return None
            finally:
                self._busy.pop(provider, None)

        changed = [] if ach_only else \
            stage("library", lambda: self._sync_library(provider, client, creds))
        # Matching costs minutes of fuzzy CPU over a big library — only when the
        # sheet or the library actually moved (manual pins go through the API,
        # which rewrites lib_matches directly and needs no pass here).
        if not ach_only and \
                self._db.kv_get(f"match_stamp:{provider}") != self._match_stamp(provider):
            stage("matching", lambda: self._match_library(provider))
        if not ach_only:
            counts["screenshots"] = stage(
                "screenshots", lambda: self._sync_screenshots(provider, client, creds))
            counts["wishlist"] = stage(
                "wishlist", lambda: self._sync_wishlist(provider, client, creds))
            counts["reviews"] = stage(
                "reviews", lambda: self._sync_reviews(provider, client, creds))
            # Mark the pass done HERE, before the long achievements backfill —
            # everything else has landed, so the provider drops out of "due" and
            # its next wake is a fast achievements-only chunk instead of another
            # full pass. A slow-paced library (Xbox at 138/hr) would otherwise
            # take its whole first achievements stage before it ever counted as
            # synced, and re-run library+screenshots every time until it did.
            self._db.mark_sync(provider)
            # Backfill a display name a failed link left blank (PSN's profile
            # call needs a token the link didn't have yet). Cheap, best-effort.
            if not acct.get("displayName") and hasattr(client, "account_name"):
                try:
                    nm = client.account_name(creds)
                    if nm:
                        self._db.link(provider, creds, nm)
                except Exception as exc:
                    log.debug("%s display-name backfill failed: %s", provider, exc)
        # ITAD prices run on EVERY pass, full or hot — the first-time backfill of
        # a big wishlist caps its lookups per pass, so it needs the fast hot loop
        # (which Steam is already in for achievements) to drain, not one full
        # pass every six hours. Cheap once the ids are cached (batched refresh).
        # Before achievements, so the (quick) price chunk isn't stuck behind the
        # long achievement chunk every cycle.
        stage("prices", lambda: self._price_wishlist(provider))
        # Achievements LAST — it's the long, bounded, resumable stage, and it
        # must not hold up mark_sync (above) or the fast stages (before).
        counts["achievements"] = stage(
            "achievements", lambda: self._sync_achievements(provider, client, creds, changed or []))
        # Tokens may have rotated during the pass (PSN's do) — the dict the
        # provider mutated is the only copy that still works next time.
        self._db.update_credentials(provider, creds)
        self._db.set_status(provider, "error" if errors else "linked",
                            "; ".join(errors) if errors else None)
        log.info("%s sync%s done: %s%s", provider, " (achievements chunk)" if ach_only else "",
                 counts, f" ({len(errors)} stage errors)" if errors else "")
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
        # Two queues with different budgets. REFRESHES (changed apps we already
        # hold rows for) are always all taken — that's a handful of games you
        # actually played since last pass. NEVER-FETCHED apps are capped at
        # ach_backfill per pass regardless of why they qualified: on the very
        # first sync every app counts as "changed", and without the cap that
        # first pass would grind the whole library in one 4-hour sitting.
        refresh = [a for a in changed if a in have and not no_ach(a)]
        fresh = {a for a in changed if a not in have and not no_ach(a)}
        by_played = sorted(
            (g for g in self._db.lib_games(provider)
             if g["appId"] in fresh or (g["appId"] not in have
                                        and not no_ach(g["appId"]))),
            key=lambda g: g["playtimeMin"] or 0, reverse=True)
        # Most-played first: the games with hours on them are the ones whose
        # achievement grid is worth seeing tonight, not in a week.
        backlog = [g["appId"] for g in by_played if g["appId"] not in refresh]
        # Per-provider budget. Steam's Web API is generous, so it drains fast in
        # hot chunks; OpenXBL's free tier is 150 req/hr, so Xbox takes a small
        # bite each 6-hour pass and never spins (hot=False) — a nightly trickle
        # that stays under the ceiling. A provider sets these as attributes.
        cap = getattr(client, "ach_per_sync", self._ach_backfill)
        hot = getattr(client, "hot_drain", True)
        todo = refresh + backlog[:cap]
        self._hot[provider] = hot and len(backlog) > cap
        fetched = 0
        for app_id in todo:
            if self._stop.is_set():
                break
            try:
                rows = client.fetch_achievements(creds, app_id)
            except Exception as exc:
                # One game's transient 500 (Steam does this) must not abort the
                # whole chunk — skip it and let the next pass retry.
                log.debug("%s achievements for %s failed: %s",
                          provider, app_id, _scrub(exc))
                continue
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
        # Pricing runs as its own stage (every pass, full or hot) — see
        # sync_account — so a big first backfill drains on the fast loop.
        return len(items)

    # PC storefronts whose wishlists have a store price worth pricing via ITAD.
    _PRICED_STORES = {"steam", "gog", "epic"}

    def _price_wishlist(self, provider):
        """Refresh ITAD prices for a store's wishlist. Steam resolves to an ITAD
        game by its appid (exact); GOG and Epic have no Steam appid, so they
        resolve by title (as good as the name). Console networks have no store
        price and are skipped.

        Two kinds of work with very different costs: entries that already have a
        resolved ITAD id just need a (batched, cheap) price refresh; entries
        without one need a lookup EACH. The lookups are capped per pass so the
        first-time backfill of a few thousand items spreads over a handful of
        syncs — the ids cache once resolved, so it's a one-time cost."""
        if self._itad is None or not self._itad.configured or provider not in self._PRICED_STORES:
            return
        from datetime import datetime, timedelta, timezone
        stale = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat(timespec="seconds")
        todo = self._db.wishlist_for_pricing(provider, stale)
        if not todo:
            return
        resolved = {w["appId"]: w["itadId"] for w in todo if w["itadId"]}
        need_lookup = [w for w in todo if not w["itadId"]]
        cap = int(getattr(self, "_itad_lookup_cap", 500))
        for w in need_lookup[:cap]:
            if self._stop.is_set():
                break
            app_id = w["appId"]
            iid = (self._itad.lookup_appid(app_id) if provider == "steam"
                   else self._itad.lookup_title(w["name"]))
            if iid:
                resolved[app_id] = iid
            else:
                # No ITAD match (delisted, bundle-only…) — stamp an empty price
                # so it isn't re-looked-up every pass.
                self._db.set_wishlist_price(provider, app_id, None, None)
        if not resolved:
            return
        prices = self._itad.prices(list(set(resolved.values())))
        for app_id, iid in resolved.items():
            self._db.set_wishlist_price(provider, app_id, iid, prices.get(iid))
        self._bundles_wishlist(provider)
        remaining = max(0, len(need_lookup) - cap)
        # Keep the worker on the fast loop until the id backlog is drained, so
        # the first-time price backfill finishes in one sitting rather than one
        # chunk every six hours.
        if remaining:
            self._hot[provider] = True
        log.info("steam wishlist prices: refreshed %d (ITAD)%s", len(resolved),
                 f", {remaining} left to resolve" if remaining else "")

    # ---- the hourly price clock ---------------------------------------------
    def _price_loop(self):
        """Re-price resolved wishlist items every `itad_interval` seconds
        (default hourly), independent of the 6-hour sync pass. Waits a minute at
        boot so the first sync pass wins any race for a fresh link's items."""
        if self._stop.wait(60):
            return
        while not self._stop.is_set():
            try:
                self._refresh_resolved_prices()
            except Exception as exc:
                log.warning("itad price loop: %s", exc)
            if self._stop.wait(self._itad_interval):
                return

    def _refresh_resolved_prices(self):
        if self._itad is None or not self._itad.configured:
            return
        from datetime import datetime, timedelta, timezone
        stale = (datetime.now(timezone.utc)
                 - timedelta(seconds=self._itad_interval)).isoformat(timespec="seconds")
        for provider in sorted(self._PRICED_STORES):
            acct = self._db.account(provider)
            if not acct or acct["status"] == "disabled":
                continue
            # Resolved ids only: pricing is batched and cheap. Items without an
            # id wait for the sync pass's capped lookups, same as always.
            todo = [w for w in self._db.wishlist_for_pricing(provider, stale) if w["itadId"]]
            if not todo:
                continue
            resolved = {w["appId"]: w["itadId"] for w in todo}
            prices = self._itad.prices(list(set(resolved.values())))
            if not prices:
                continue               # whole batch failed; keep old prices, retry next hour
            wrote = 0
            for app_id, iid in resolved.items():
                # An id ITAD returned nothing for keeps its old price here — the
                # sync pass owns deciding a game is genuinely priceless now.
                if iid in prices:
                    self._db.set_wishlist_price(provider, app_id, iid, prices[iid])
                    wrote += 1
            if wrote:
                log.info("%s wishlist prices: refreshed %d (hourly loop)", provider, wrote)

    def _bundles_wishlist(self, provider):
        """Check ITAD bundles for a bounded slice of matched wishlist items whose
        bundle status is unchecked/stale. One call each and usually empty, so a
        small bite per pass, cached a day (bundles change slowly)."""
        if self._itad is None or not self._itad.configured:
            return
        from datetime import datetime, timedelta, timezone
        stale = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat(timespec="seconds")
        todo = self._db.wishlist_for_bundles(provider, stale, 40)
        found = 0
        for w in todo:
            if self._stop.is_set():
                break
            bundles = self._itad.bundles(w["itadId"])
            if bundles is None:               # couldn't check — leave it for next pass
                continue
            b = bundles[0] if bundles else None
            self._db.set_wishlist_bundle(provider, w["appId"], b)
            found += 1 if b else 0
        if found:
            log.info("steam wishlist bundles: %d now in a bundle", found)

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

    def _match_stale(self, provider) -> bool:
        """The sheet or the library moved since we last matched this provider."""
        return self._db.kv_get(f"match_stamp:{provider}") != self._match_stamp(provider)

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

    # The pieces of a title the fuzzy matcher accepts as "the same game": its
    # normalized whole, either side of a colon/dash subtitle (articles
    # stripped), and the name with a leading possessive removed. Mirrors
    # MatchValidator.titles_equal_fuzzy's cheap branches so those can be
    # answered by ONE index lookup instead of a scan of the whole sheet —
    # 5,000 apps x 2,000 sheet rows of regex + edit distance was an hour of
    # CPU per matching pass, and this is the part that was all of the volume.
    _ARTICLES_RE = re.compile(r"(^The )|(, The$)|(^A )|(, A$)|(^An )|(, An$)")
    _POSSESSIVE_RE = re.compile(r"(^[^':]+'s )")

    def _frags(self, title) -> set[str]:
        t = str(title or "").strip()
        if not t:
            return set()
        out = {self._validator.normalize(t)}
        for sep in (":", " - "):
            if sep in t:
                left, right = t.split(sep, 1)
                for part in (left, right):
                    out.add(self._validator.normalize(
                        self._ARTICLES_RE.sub("", part.strip())))
        stripped = self._POSSESSIVE_RE.sub("", t)
        if stripped != t:
            out.add(self._validator.normalize(stripped))
        out.discard("")
        return out

    def _match_library(self, provider):
        if self._enricher is None:
            return
        overrides = self._db.overrides(provider)
        appid_keys = self._appid_to_keys(provider)
        meta = self._enricher.keys_meta()
        family = _PLATFORM_FAMILY.get(provider, set())
        by_norm: dict[str, list[str]] = {}
        frag_index: dict[str, set[str]] = {}   # fragment -> full norms carrying it
        key_platform: dict[str, str] = {}      # match_key -> lowercased sheet platform
        for mk, m in meta.items():
            plat = (m.get("platform") or "").lower()
            if plat in family:
                title = m.get("title") or ""
                n = self._validator.normalize(title)
                by_norm.setdefault(n, []).append(mk)
                key_platform[mk] = plat
                for f in self._frags(title):
                    frag_index.setdefault(f, set()).add(n)

        def by_platform(keys, game_platform):
            """Narrow same-name matches to the game's OWN platform when it has
            one (a PS5 game keeps off the PS3 row); if nothing on that platform
            matches, fall back to the name match so a platform-naming mismatch
            doesn't drop the game entirely."""
            if not keys or not game_platform:
                return keys
            gp = game_platform.lower()
            exact = [k for k in keys if key_platform.get(k) == gp]
            return exact or keys

        games = self._db.lib_games(provider)
        matched = appid_hits = title_hits = fuzzy_hits = 0
        owned_appid_keys = []     # keys whose owned appid should refresh steamx/pcgw
        per_app = {}              # written in ONE transaction at the end
        for g in games:
            aid = str(g["appId"])
            if aid in overrides:
                mk = overrides[aid]
                per_app[aid] = [(mk, "manual", None)] if mk else []
                if mk:
                    matched += 1
                    owned_appid_keys.append((mk, aid))
                continue
            keys = appid_keys.get(aid)
            if keys:
                per_app[aid] = [(k, "appid", None) for k in keys]
                matched += 1
                appid_hits += 1
                owned_appid_keys += [(k, aid) for k in keys]
                continue
            gplat = g.get("platform")
            norm = self._validator.normalize(g["name"] or "")
            keys = by_platform(by_norm.get(norm), gplat)
            if keys:
                per_app[aid] = [(k, "title", None) for k in keys]
                matched += 1
                title_hits += 1
                owned_appid_keys += [(k, aid) for k in keys]
                continue
            # Fuzzy, cheap tier: one fragment-index lookup. Unique full-norm
            # across every shared fragment or nothing — a fragment like a bare
            # franchise name hits many games and means we don't know.
            norms = set()
            for f in self._frags(g["name"]):
                norms |= frag_index.get(f, set())
            keys = by_platform(by_norm.get(next(iter(norms))), gplat) if len(norms) == 1 else None
            # Expensive tier (edit-distance typos, long-substring containment):
            # only for games with actual hours — the rest of a 5,000-app
            # library isn't worth a scan each, and the cheap tiers already
            # caught everything systematic.
            if not keys and (g["playtimeMin"] or 0) > 0:
                hit = self._fuzzy_scan(g["name"], norm, by_norm, meta)
                keys = by_platform([hit], gplat) if hit else None
            if keys:
                per_app[aid] = [(k, "fuzzy", None) for k in keys]
                matched += 1
                fuzzy_hits += 1
                owned_appid_keys += [(k, aid) for k in keys]
            else:
                per_app[aid] = []
        self._db.replace_matches_bulk(provider, per_app)
        self._db.kv_set(f"match_stamp:{provider}", self._match_stamp(provider))
        log.info("%s matching: %d/%d matched (%d appid, %d title, %d fuzzy)",
                 provider, matched, len(games), appid_hits, title_hits, fuzzy_hits)
        self._requeue_corrected(provider, owned_appid_keys, appid_keys)

    def _fuzzy_scan(self, name, norm, by_norm, meta) -> str | None:
        """A UNIQUE fuzzy hit or nothing — a tie means we don't know, and a wrong
        match here quietly hangs my hours on someone else's game. Candidates are
        length-gated first: the only accept paths the fragment index doesn't
        already cover are edit distance <= 3 and long-substring containment,
        and neither can fire outside these bounds."""
        if not name:
            return None
        hit_norm = None
        for cand, keys in by_norm.items():
            plausible = abs(len(cand) - len(norm)) <= 3 \
                or (len(norm) > 15 and norm in cand) \
                or (len(cand) > 15 and cand in norm)
            if not plausible:
                continue
            if self._validator.titles_equal_fuzzy(name, meta[keys[0]].get("title") or ""):
                if hit_norm is not None and hit_norm != cand:
                    return None
                hit_norm = cand
        return by_norm[hit_norm][0] if hit_norm else None

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

    # The IGDB external_games slot each provider's app id lives under.
    _EXT_STORE = {"steam": "steam", "psn": "playstation", "xbox": "xbox"}

    def _match_wishlist(self, provider):
        if self._enricher is None:
            return
        appid_keys = self._appid_to_keys(provider)
        meta = self._enricher.keys_meta()
        by_norm: dict[str, list[str]] = {}
        for mk, m in meta.items():     # any platform: a wishlisted PC game may be owned on PS4
            by_norm.setdefault(self._validator.normalize(m.get("title") or ""),
                               []).append(mk)
        # An IGDB appid->game lookup is the authoritative match for a wishlist
        # item (a Steam entry carries its appid; external_games maps it straight
        # to the game), but it's one API call each — so it's paced: a bounded
        # slice of the still-unmatched items per pass, the rest next time.
        igdb = getattr(self._enricher, "_igdb", None)
        store = self._EXT_STORE.get(provider)
        api_budget = 150
        for w in self._db.wishlist_unmatched(provider):
            aid = str(w["appId"])
            keys = appid_keys.get(aid)
            if keys:
                self._db.set_wishlist_match(provider, aid, keys[0], None)
                continue
            norm = self._validator.normalize(w["name"]) if w["name"] else ""
            keys = by_norm.get(norm) if norm else None
            if keys:
                self._db.set_wishlist_match(provider, aid, keys[0], None)
                continue
            # The authoritative match is the store-id → IGDB lookup (a Steam
            # wishlist entry carries its appid; external_games maps it straight
            # to the game). It's one API call each, so it's the FIRST choice only
            # when the free catalogue name-match would be a guess — i.e. the name
            # is shared across distinct games ("Haunted House"). An unambiguous
            # catalogue hit is trusted for free.
            hit = self._catalogue.lookup_norm(norm) if (norm and self._catalogue) else None
            if hit and not hit.get("ambiguous"):
                self._db.set_wishlist_match(provider, aid, None, hit["igdbId"],
                                            cover=hit.get("cover"),
                                            name=w["name"] or hit.get("name"))
                continue
            if igdb is not None and store and api_budget > 0:
                api_budget -= 1
                g = igdb.game_by_store_id(store, aid)
                if g and g.get("igdbId"):
                    self._db.set_wishlist_match(provider, aid, None, g["igdbId"],
                                                cover=g.get("cover"),
                                                name=w["name"] or g.get("name"))
                    continue
            # Ambiguous name and no store-id answer (budget spent, or IGDB miss)
            # — fall back to the popularity guess rather than leave it unmatched.
            if hit:
                self._db.set_wishlist_match(provider, aid, None, hit["igdbId"],
                                            cover=hit.get("cover"),
                                            name=w["name"] or hit.get("name"))
