"""My GOG account: the DRM-free library and the wishlist, via GOG's embed API.

GOG has no official public API, but the website's own embed.gog.com endpoints
are stable and well-trodden (the gogapi lineage). Auth is GOG's OAuth: the admin
logs in on GOG's site and pastes the one-time `code` from the redirect URL —
the same shape as PSN's NPSSO, a value copied out of a browser. The code buys an
access + refresh token pair; the refresh token is long-lived and rewritten each
pass (like PSN's), which is why credentials live in the DB.

What it delivers:
  * library — the owned games (getFilteredProducts, paged): title, cover, GOG
    product id.
  * wishlist — the wishlisted product ids, resolved to titles.

GOG does NOT expose playtime over the web API (Galaxy keeps it in a local DB),
so, like Xbox, the hours cell just won't show for GOG games. No achievements
over this API either — GOG has them but only through Galaxy's client protocol,
not the embed endpoints. Library + wishlist are what GOG gives, and that's what
this syncs.
"""

from __future__ import annotations

import logging
import re
import time

import requests

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.gog_user")

# GOG Galaxy's own OAuth client — public knowledge, in every gogapi client.
CLIENT_ID = "46899977096215655"
CLIENT_SECRET = "9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9"
REDIRECT = "https://embed.gog.com/on_login_success?origin=client"
AUTH_URL = ("https://auth.gog.com/auth?client_id=" + CLIENT_ID +
            "&redirect_uri=https%3A%2F%2Fembed.gog.com%2Fon_login_success%3Forigin%3Dclient"
            "&response_type=code&layout=client2")
TOKEN = "https://auth.gog.com/token"
EMBED = "https://embed.gog.com"


class GogUserClient:
    name = "gog"
    # No achievements over the embed API, so nothing for the achievement loop.
    ach_per_sync = 0
    hot_drain = False

    def __init__(self):
        self._limiter = RateLimiter(4)

    # ---- auth ----------------------------------------------------------------
    def _token(self, creds: dict) -> str:
        if creds.get("accessToken") and time.time() < (creds.get("accessExpires") or 0) - 60:
            return creds["accessToken"]
        if creds.get("refreshToken"):
            params = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
                      "grant_type": "refresh_token", "refresh_token": creds["refreshToken"]}
        else:
            code = (creds.get("code") or "").strip()
            # The pasted value might be the whole redirect URL — pull the code out.
            m = re.search(r"[?&]code=([^&]+)", code)
            if m:
                code = m.group(1)
            if not code:
                raise ValueError("no GOG login code")
            params = {"client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
                      "grant_type": "authorization_code", "code": code,
                      "redirect_uri": REDIRECT}
        self._limiter.wait()
        r = requests.get(TOKEN, params=params, timeout=25)
        if r.status_code in (400, 401):
            raise ValueError("GOG rejected the login — grab a fresh code from the"
                             " login link")
        r.raise_for_status()
        j = r.json()
        creds["accessToken"] = j["access_token"]
        creds["refreshToken"] = j.get("refresh_token") or creds.get("refreshToken")
        creds["accessExpires"] = time.time() + int(j.get("expires_in") or 3600)
        creds["userId"] = j.get("user_id") or creds.get("userId")
        creds.pop("code", None)          # spent; the refresh token carries on
        return creds["accessToken"]

    def _get(self, creds, path, params=None, base=EMBED, timeout=25):
        self._limiter.wait()
        r = requests.get(f"{base}{path}", params=params,
                         headers={"Authorization": f"Bearer {self._token(creds)}",
                                  "Accept": "application/json"}, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def validate(self, creds: dict) -> dict:
        j = self._get(creds, "/userData.json")   # proves the token; carries the name
        if not j.get("isLoggedIn", True):
            raise ValueError("GOG says not logged in — the code may have expired")
        return {"displayName": j.get("username")}

    def account_name(self, creds: dict) -> str | None:
        try:
            return self._get(creds, "/userData.json").get("username")
        except Exception:
            return None

    # ---- library -------------------------------------------------------------
    def fetch_library(self, creds: dict) -> list[dict]:
        out, page = [], 1
        while page <= 100:
            j = self._get(creds, "/account/getFilteredProducts",
                          {"mediaType": 1, "page": page})
            for p in j.get("products") or []:
                img = p.get("image")
                out.append({
                    "appId": str(p.get("id")), "name": p.get("title"),
                    "playtimeMin": None, "playtime2wkMin": None, "lastPlayed": None,
                    "platform": "PC",
                    "iconUrl": (f"https:{img}_196.jpg" if img and img.startswith("//") else img),
                    "extra": {"slug": p.get("slug"), "url": p.get("url")},
                })
            if page >= (j.get("totalPages") or 1):
                break
            page += 1
        return [g for g in out if g["appId"] and g["name"]]

    # ---- wishlist ------------------------------------------------------------
    def fetch_wishlist(self, creds: dict) -> list[dict]:
        # GOG returns {"wishlist": {game_id: true}, "checksum": ...}.
        j = self._get(creds, "/user/wishlist.json")
        ids = [k for k, v in (j.get("wishlist") or {}).items() if v]
        out = []
        for i in range(0, len(ids), 50):
            batch = ids[i:i + 50]
            try:
                # api.gog.com resolves product ids to titles in one call.
                prods = self._get(creds, "/products",
                                  {"ids": ",".join(batch)}, base="https://api.gog.com")
            except Exception as exc:
                log.debug("gog wishlist name batch failed: %s", exc)
                prods = []
            by_id = {str(p.get("id")): p for p in (prods or [])}
            for gid in batch:
                p = by_id.get(str(gid)) or {}
                url = p.get("purchase_link") or (p.get("links") or {}).get("product_card")
                out.append({"appId": str(gid), "name": p.get("title"),
                            "addedAt": None, "extra": {"url": url}})
        return out

    # ---- GOG gives none of these over the embed API --------------------------------
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
