"""My itch.io account: the games I own, via itch's real (official) API.

itch.io is the easy one — it has an actual documented API and simple key auth.
The admin makes an API key at itch.io/user/settings/api-keys and pastes it; no
token dance. The owned-keys endpoint lists every game bought or claimed, with
title and cover.

itch has no playtime, no achievements, and no wishlist API (collections aren't
a wishlist), so this syncs the library and nothing else — which is the whole of
what itch exposes about your account.
"""

from __future__ import annotations

import logging

import requests

from igdb import RateLimiter

log = logging.getLogger("gamedex.itch_user")

API = "https://api.itch.io"


class ItchUserClient:
    name = "itch"
    ach_per_sync = 0
    hot_drain = False

    def __init__(self):
        self._limiter = RateLimiter(4)

    def _get(self, creds, path, params=None, timeout=25):
        self._limiter.wait()
        r = requests.get(f"{API}{path}", params=params,
                         headers={"Authorization": creds.get("apiKey", ""),
                                  "Accept": "application/json"}, timeout=timeout)
        r.raise_for_status()
        return r.json()

    # ---- auth ----------------------------------------------------------------
    def validate(self, creds: dict) -> dict:
        if not (creds.get("apiKey") or "").strip():
            raise ValueError("need an itch.io API key (itch.io/user/settings/api-keys)")
        try:
            j = self._get(creds, "/profile")
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else 0
            raise ValueError("itch.io rejected the API key" if code in (401, 403)
                             else f"itch.io error ({code})")
        return {"displayName": (j.get("user") or {}).get("username")}

    def account_name(self, creds: dict) -> str | None:
        try:
            return (self._get(creds, "/profile").get("user") or {}).get("username")
        except Exception:
            return None

    # ---- library -------------------------------------------------------------
    def fetch_library(self, creds: dict) -> list[dict]:
        out, page = [], 1
        while page <= 100:
            j = self._get(creds, "/profile/owned-keys", {"page": page})
            keys = j.get("owned_keys") or []
            for k in keys:
                g = k.get("game") or {}
                if not g.get("id"):
                    continue
                out.append({
                    "appId": str(g["id"]), "name": g.get("title"),
                    "playtimeMin": None, "playtime2wkMin": None, "lastPlayed": None,
                    "platform": "PC", "iconUrl": g.get("cover_url"),
                    "extra": {"url": g.get("url"), "purchasedAt": k.get("created_at")},
                })
            if not keys or len(keys) < (j.get("per_page") or 50):
                break
            page += 1
        return [g for g in out if g["appId"] and g["name"]]

    # ---- itch exposes none of these --------------------------------------------
    def fetch_achievements(self, creds, app_id):
        return None

    def fetch_screenshots(self, creds, cursor):
        return [], cursor

    def fetch_wishlist(self, creds):
        return []

    def fetch_reviews(self, creds):
        return []

    def download(self, url: str) -> bytes:
        self._limiter.wait()
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        return r.content
