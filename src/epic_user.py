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

The Store wishlist lives behind a GraphQL endpoint on a different token, so it's
best-effort: if the call works it syncs, otherwise the library + playtime still
land and the wishlist stage just comes back empty.
"""

from __future__ import annotations

import base64
import logging
import re
import time

import requests

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.epic_user")

# legendary's registered client — public, in every Epic library tool.
CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a"
CLIENT_SECRET = "daafbccc737745039dffe53d94fc76cf"
_BASIC = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
ACCOUNT = "https://account-public-service-prod.ol.epicgames.com"
LAUNCHER = "https://launcher-public-service-prod06.ol.epicgames.com"
CATALOG = "https://catalog-public-service-prod06.ol.epicgames.com"
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

    # ---- wishlist (best-effort, Store GraphQL) -------------------------------
    def fetch_wishlist(self, creds: dict) -> list[dict]:
        try:
            r = requests.post(
                "https://store.epicgames.com/graphql",
                json={"query": _WISHLIST_QUERY, "variables": {}},
                headers={"Authorization": f"Bearer {self._token(creds)}",
                         "Content-Type": "application/json"}, timeout=25)
            r.raise_for_status()
            elems = (((r.json().get("data") or {}).get("Wishlist") or {})
                     .get("wishlistItems") or {}).get("elements") or []
        except Exception as exc:
            log.info("epic wishlist unavailable: %s", exc)
            return []
        out = []
        for e in elems:
            off = e.get("offer") or {}
            out.append({"appId": str(e.get("offerId") or off.get("id") or ""),
                        "name": off.get("title"), "addedAt": e.get("created"),
                        "extra": {"namespace": e.get("namespace")}})
        return [w for w in out if w["appId"]]

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


_WISHLIST_QUERY = """
query wishlist {
  Wishlist {
    wishlistItems {
      elements { offerId namespace created
        offer { id title keyImages { type url } }
      }
    }
  }
}
"""
