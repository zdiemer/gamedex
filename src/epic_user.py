"""My Epic Games Store account: the library, real playtime, the wishlist.

Epic has no public API either, but the launcher's own services are stable and
well-mapped (the `legendary` client's lineage). Auth is Epic's OAuth: while
logged in on epicgames.com the admin visits the redirect endpoint, which hands
back a one-time `authorizationCode` (a 32-char hex string) — pasted in like
PSN's NPSSO. That buys an access + refresh token pair off the account service;
the refresh token is long-lived and rewritten each pass.

Three services, joined on the app name:
  * launcher assets — the owned games (appName, namespace, catalogItemId).
  * catalog — resolves each catalogItemId to a title + key image.
  * playtime — /playtime/account/<id>/all gives totalTime per artifactId
    (= appName). Epic, unlike GOG, actually reports hours.

The Store wishlist uses its platform REST API with the existing launcher token
and browser-compatible TLS. Failed or incomplete snapshots raise so the sync
coordinator preserves cached entries and reports the failed wishlist stage.
"""

from __future__ import annotations

import base64
import logging
import re
import time

import requests
from curl_cffi import requests as browser_requests
from urllib.parse import quote

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.epic_user")

# legendary's registered client — public, in every Epic library tool.
CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a"
CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf"
_BASIC = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
ACCOUNT = "https://account-public-service-prod.ol.epicgames.com"
LAUNCHER = "https://launcher-public-service-prod06.ol.epicgames.com"
CATALOG = "https://catalog-public-service-prod06.ol.epicgames.com"
WISHLIST = "https://egs-platform-service.store.epicgames.com/api/v2/private/account/wishlist"
LIBRARY = "https://library-service.live.use1a.on.epicgames.com"
REDIRECT_HINT = ("https://www.epicgames.com/id/api/redirect?clientId="
                 + CLIENT_ID + "&responseType=code")


class EpicUserClient:
    name = "epic"
    ach_per_sync = 0            # Epic achievements aren't on these services
    hot_drain = False

    def __init__(self):
        self._limiter = RateLimiter(4)

    # ---- auth ----------------------------------------------------------------
    def _token(self, creds: dict) -> str:
        if creds.get("accessToken") and time.time() < (creds.get("accessExpires") or 0) - 60:
            return creds["accessToken"]
        if creds.get("refreshToken"):
            data = {"grant_type": "refresh_token", "refresh_token": creds["refreshToken"]}
        else:
            code = (creds.get("code") or "").strip()
            m = re.search(r'"?authorizationCode"?\s*[:=]\s*"?([0-9a-f]{32})', code)
            if m:
                code = m.group(1)
            else:
                m = re.search(r"\b([0-9a-f]{32})\b", code)
                code = m.group(1) if m else code
            if not code:
                raise ValueError("no Epic authorization code")
            data = {"grant_type": "authorization_code", "code": code}
        self._limiter.wait()
        r = requests.post(f"{ACCOUNT}/account/api/oauth/token", data=data,
                          headers={"Authorization": f"Basic {_BASIC}",
                                   "Content-Type": "application/x-www-form-urlencoded"},
                          timeout=25)
        if r.status_code in (400, 401):
            raise ValueError("Epic rejected the code — get a fresh authorizationCode"
                             " from the login link (codes are single-use)")
        r.raise_for_status()
        j = r.json()
        creds["accessToken"] = j["access_token"]
        creds["refreshToken"] = j.get("refresh_token") or creds.get("refreshToken")
        creds["accessExpires"] = time.time() + int(j.get("expires_in") or 3600)
        creds["accountId"] = j.get("account_id") or creds.get("accountId")
        creds["displayName"] = j.get("displayName") or creds.get("displayName")
        creds.pop("code", None)
        return creds["accessToken"]

    def _get(self, creds, url, params=None, timeout=25):
        self._limiter.wait()
        r = requests.get(url, params=params,
                         headers={"Authorization": f"Bearer {self._token(creds)}",
                                  "Accept": "application/json"}, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def validate(self, creds: dict) -> dict:
        self._token(creds)               # exchange the code; raises on bad input
        return {"displayName": creds.get("displayName")}

    def account_name(self, creds: dict) -> str | None:
        try:
            self._token(creds)
            return creds.get("displayName")
        except Exception:
            return None

    # ---- library + playtime --------------------------------------------------
    def _playtime(self, creds: dict) -> dict:
        """{artifactId(appName): minutes} — Epic's own hours."""
        acct = creds.get("accountId")
        if not acct:
            return {}
        try:
            rows = self._get(
                creds, f"{LIBRARY}/library/api/public/playtime/account/{acct}/all")
        except Exception as exc:
            log.debug("epic playtime failed: %s", exc)
            return {}
        return {r.get("artifactId"): round((r.get("totalTime") or 0) / 60)
                for r in rows or [] if r.get("artifactId")}

    def fetch_library(self, creds: dict) -> list[dict]:
        assets = self._get(
            creds, f"{LAUNCHER}/launcher/api/public/assets/Windows", {"label": "Live"})
        # One game per (namespace, catalogItemId); skip DLC/engine artifacts.
        games = {}
        for a in assets or []:
            cat = a.get("catalogItemId")
            ns = a.get("namespace")
            if cat and ns and a.get("appName"):
                games[(ns, cat)] = a["appName"]
        play = self._playtime(creds)
        out = []
        items = list(games.items())
        # Resolve titles in bulk per namespace.
        by_ns: dict = {}
        for (ns, cat), _ in items:
            by_ns.setdefault(ns, []).append(cat)
        titles: dict = {}
        for ns, cats in by_ns.items():
            for i in range(0, len(cats), 50):
                chunk = cats[i:i + 50]
                try:
                    j = self._get(
                        creds, f"{CATALOG}/catalog/api/shared/namespace/{ns}/bulk/items",
                        {"id": chunk, "country": "US", "locale": "en-US",
                         "includeMainGameDetails": "true"})
                    for cid, meta in (j or {}).items():
                        titles[(ns, cid)] = meta
                except Exception as exc:
                    log.debug("epic catalog %s failed: %s", ns, exc)
        for (ns, cat), app_name in items:
            meta = titles.get((ns, cat)) or {}
            # Games only — the catalog marks apps/DLC with categories.
            cats = {c.get("path") for c in meta.get("categories") or []}
            if meta and "games" not in cats and "applications" not in cats and meta.get("categories"):
                continue
            img = next((k.get("url") for k in meta.get("keyImages") or []
                        if k.get("type") in ("DieselStoreFrontTall", "Thumbnail", "OfferImageTall")), None)
            out.append({
                "appId": cat, "name": meta.get("title") or app_name,
                "playtimeMin": play.get(app_name), "playtime2wkMin": None,
                "lastPlayed": None, "platform": "PC", "iconUrl": img,
                "extra": {"namespace": ns, "appName": app_name},
            })
        return [g for g in out if g["appId"] and g["name"]]

    # ---- wishlist (current Store platform API) -------------------------------
    def fetch_wishlist(self, creds: dict) -> list[dict]:
        """Return a complete snapshot or raise, never turn failure into []."""
        try:
            return self._fetch_wishlist(creds)
        except Exception:
            # Never log response bodies, tokens, cookies or account IDs. The
            # coordinator records the failed stage and keeps the prior cache.
            raise RuntimeError(
                "Epic wishlist fetch failed; cached wishlist retained"
            ) from None

    def _fetch_wishlist(self, creds: dict) -> list[dict]:
        # The legacy Store GraphQL Wishlist resolver no longer authenticates
        # launcher tokens. This is the API used by the current Epic frontend.
        # Browser TLS is required even with a valid OAuth bearer token.
        entries = []
        total = None
        seen = set()
        with browser_requests.Session(impersonate="chrome") as session:
            for _ in range(100):
                self._limiter.wait()
                r = session.get(
                    WISHLIST,
                    params={"locale": "en-US", "country": "US",
                            "start": len(entries), "count": 50},
                    headers={"Authorization": f"Bearer {self._token(creds)}",
                             "Accept": "application/json"},
                    timeout=25, allow_redirects=False)
                r.raise_for_status()
                payload = r.json()
                if not isinstance(payload, dict) or payload.get("errors"):
                    raise ValueError("Invalid wishlist response")
                page, paging = payload.get("data"), payload.get("paging")
                if not isinstance(page, list) or not isinstance(paging, dict):
                    raise ValueError("Missing wishlist snapshot")
                expected = paging.get("total")
                if type(expected) is not int or expected < 0:
                    raise ValueError("Invalid wishlist total")
                if total is None:
                    total = expected
                if expected != total or paging.get("start") != len(entries):
                    raise ValueError("Wishlist changed or pagination was ignored")
                for item in page:
                    if not isinstance(item, dict):
                        raise ValueError("Invalid wishlist entry")
                    offer, namespace = item.get("offerId"), item.get("sandboxId")
                    if not isinstance(offer, str) or not offer or not isinstance(namespace, str) or not namespace:
                        raise ValueError("Missing wishlist identity")
                    if offer in seen:
                        raise ValueError("Duplicate wishlist offer")
                    seen.add(offer)
                    entries.append(item)
                if len(entries) == total:
                    break
                if not page or len(entries) > total:
                    raise ValueError("Incomplete wishlist snapshot")
            else:
                raise ValueError("Wishlist pagination limit exceeded")

        # The platform API returns identities, not titles. Resolve offers with
        # the same catalog service and OAuth token used by library sync.
        by_namespace = {}
        for item in entries:
            by_namespace.setdefault(item["sandboxId"], []).append(item["offerId"])
        titles = {}
        for namespace, offers in by_namespace.items():
            for start in range(0, len(offers), 50):
                batch = offers[start:start + 50]
                data = self._get(
                    creds, f"{CATALOG}/catalog/api/shared/namespace/{quote(namespace, safe='')}/bulk/offers",
                    {"id": batch, "country": "US", "locale": "en-US"})
                for offer in batch:
                    title = data[offer]["title"]
                    if not isinstance(title, str) or not title.strip():
                        raise ValueError("Missing wishlist offer title")
                    titles[offer] = title
        return [{"appId": item["offerId"], "name": titles[item["offerId"]],
                 "addedAt": item.get("created"),
                 "extra": {"namespace": item["sandboxId"]}} for item in entries]

    # ---- not available -------------------------------------------------------------
    def fetch_achievements(self, creds, app_id):
        return None

    def fetch_screenshots(self, creds, cursor):
        return [], cursor

    def fetch_reviews(self, creds):
        return []

    def download(self, url: str) -> bytes:
        self._limiter.wait()
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        return r.content
