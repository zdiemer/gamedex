"""My Xbox account: achievements, gamerscore, captures — via OpenXBL.

Microsoft never opened a consumer Xbox Live API, so this goes through OpenXBL
(xbl.io), a hosted relay the admin authorizes: sign in there with the Microsoft
account, copy the API key, paste it in the provider card. One header
(`x-authorization`) and REST from there — no token dance, because OpenXBL holds
the Microsoft OAuth on its side.

The one real constraint is the free tier's 150 requests/hour. So this is built
for a nightly TRICKLE, not a sprint (see hot_drain=False / ach_per_sync below):

  * titleHistory — ONE call for the whole played-games list: titleId, name,
    last-played, and the achievement summary (earned/total, gamerscore). That
    summary is cheap and lands for everything in the first pass.
  * achievements/title/{titleId} — one call per game for the full list with
    unlock state, timestamps, gamerscore rewards and rarity. THIS is the
    expensive part, so only a few games' worth are pulled per pass.
  * dvr/screenshots — the captures, paginated by continuationToken, each with a
    download URL we mirror to the PVC like Steam's.

Xbox exposes playtime poorly (no per-title minutes on titleHistory), so the
hours cell simply won't show for Xbox games — the gamerscore and achievement
grid are what Xbox is good for, and those are what we surface.
"""

from __future__ import annotations

import logging

import requests

from igdb import RateLimiter

log = logging.getLogger("gamedex.xbox_user")

BASE = "https://xbl.io"


class XboxUserClient:
    name = "xbox"
    # Free tier is 150 req/hr. Take a small achievements bite per 6h pass and
    # never spin — the backlog drains over a few nights, under the ceiling.
    ach_per_sync = 30
    hot_drain = False

    def __init__(self):
        self._limiter = RateLimiter(1)   # OpenXBL is fine with bursts; the
        self._xuid = None                # hourly cap is the real limit

    def _get(self, creds, path, params=None, timeout=25):
        self._limiter.wait()
        r = requests.get(f"{BASE}{path}", params=params,
                         headers={"x-authorization": creds.get("apiKey", ""),
                                  "Accept": "application/json"}, timeout=timeout)
        if r.status_code == 429:
            raise RuntimeError("OpenXBL hourly rate limit hit — try later")
        r.raise_for_status()
        j = r.json()
        # OpenXBL wraps the real payload in {"content": {...}, "code": 200}. Some
        # endpoints answer flat, so unwrap only when the envelope is present.
        if isinstance(j, dict) and "content" in j and isinstance(j["content"], (dict, list)):
            return j["content"]
        return j

    @staticmethod
    def _name_from_account(j: dict) -> tuple[str | None, str | None]:
        """(xuid, gamertag) out of an /account response, tolerating the
        profileUsers field being either a single object or a list of them."""
        users = j.get("profileUsers")
        if isinstance(users, dict):
            users = [users]
        if not users:
            return None, None
        u = users[0]
        settings = {s.get("id"): s.get("value") for s in (u.get("settings") or [])}
        return u.get("id"), (settings.get("Gamertag") or settings.get("GameDisplayName")
                             or settings.get("ModernGamertag"))

    # ---- auth --------------------------------------------------------------
    def validate(self, creds: dict) -> dict:
        if not (creds.get("apiKey") or "").strip():
            raise ValueError("need an OpenXBL API key (from xbl.io)")
        try:
            j = self._get(creds, "/api/v2/account")
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else 0
            raise ValueError("OpenXBL rejected the API key" if code in (401, 403)
                             else f"OpenXBL error ({code})")
        self._xuid, name = self._name_from_account(j)
        if name:
            return {"displayName": name}
        # /account gave no profile name. A blank-but-working key is only worth
        # linking if it can actually read the library — otherwise the account
        # has no Xbox profile connected on OpenXBL's side, and a silent empty
        # link looks like a broken feature. Require real data, say so if absent.
        try:
            th = self._get(creds, "/api/v2/player/titleHistory")
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else 0
            if code == 403:
                raise ValueError("OpenXBL accepted the key but won't return your"
                                 " Xbox data — open xbl.io and connect your Xbox"
                                 " (Microsoft) account, then make a new key")
            raise ValueError(f"OpenXBL error reading your library ({code})")
        if not (th.get("titles") or []):
            raise ValueError("OpenXBL returned an empty Xbox library — connect the"
                             " right Microsoft account at xbl.io and try again")
        return {"displayName": name}

    def account_name(self, creds: dict) -> str | None:
        try:
            _, name = self._name_from_account(self._get(creds, "/api/v2/account"))
            return name
        except Exception:
            return None

    # ---- library -------------------------------------------------------------
    def fetch_library(self, creds: dict) -> list[dict]:
        j = self._get(creds, "/api/v2/player/titleHistory")
        out = []
        for t in j.get("titles") or []:
            ach = t.get("achievement") or {}
            th = t.get("titleHistory") or {}
            out.append({
                "appId": str(t.get("titleId")),
                "name": t.get("name"),
                # Xbox doesn't hand out per-title minutes; the gamerscore and
                # achievement counts are the signal instead (kept in `extra`).
                "playtimeMin": None,
                "playtime2wkMin": None,
                "lastPlayed": th.get("lastTimePlayed"),
                "iconUrl": t.get("displayImage"),
                "extra": {"gamerscore": ach.get("currentGamerscore"),
                          "totalGamerscore": ach.get("totalGamerscore"),
                          "achEarned": ach.get("currentAchievements"),
                          "achTotal": ach.get("totalAchievements")},
            })
        return [g for g in out if g["appId"] and g["appId"] != "None"]

    # ---- achievements ----------------------------------------------------------
    def fetch_achievements(self, creds: dict, app_id: str) -> list[dict] | None:
        try:
            j = self._get(creds, f"/api/v2/achievements/title/{app_id}")
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                return None
            raise
        rows = j.get("achievements") or []
        if not rows:
            return None
        out = []
        for a in rows:
            unlocked = str(a.get("progressState") or "").lower() == "achieved"
            prog = a.get("progression") or {}
            rarity = a.get("rarity") or {}
            icon = None
            for m in a.get("mediaAssets") or []:
                if str(m.get("type") or "").lower() == "icon":
                    icon = m.get("url")
                    break
            pct = rarity.get("currentPercentage")
            out.append({
                "id": str(a.get("id")),
                "name": a.get("name"),
                # The description depends on lock state — Xbox ships both.
                "description": (a.get("description")
                                if unlocked else a.get("lockedDescription")) or a.get("description"),
                "iconUrl": icon,
                "iconLockedUrl": icon,
                "hidden": str(a.get("isSecret")) == "True" or bool(a.get("isSecret")),
                # Gamescore reward, not a metal grade — kept as text; the grid
                # only tints on the four PSN trophy words, so this stays neutral.
                "rarity": (rarity.get("currentCategory") or "").lower() or None,
                "globalPct": float(pct) if pct is not None else None,
                "unlocked": unlocked,
                "unlockedAt": prog.get("timeUnlocked") if unlocked else None,
            })
        return out

    # ---- screenshots -------------------------------------------------------------
    def fetch_screenshots(self, creds: dict, cursor: str | None):
        out = []
        j = self._get(creds, "/api/v2/dvr/screenshots")
        # OpenXBL keys this list "screenshots" (game clips would be "gameClips").
        for s in j.get("screenshots") or j.get("values") or []:
            sid = str(s.get("contentId") or "")
            if not sid:
                continue
            if cursor and sid == str(cursor):
                break
            url = None
            for loc in s.get("contentLocators") or []:
                if str(loc.get("locatorType") or "").lower() == "download":
                    url = loc.get("uri")
                    break
            out.append({"id": sid,
                        "appId": str(s.get("titleId")) if s.get("titleId") else None,
                        "takenAt": s.get("dateTaken"),
                        "caption": s.get("titleName"),
                        "sourceUrl": url})
        new_cursor = out[0]["id"] if out else cursor
        return [s for s in out if s["sourceUrl"]], new_cursor

    # ---- the rest: OpenXBL has no wishlist or reviews ----------------------------------
    def fetch_wishlist(self, creds):
        return []

    def fetch_reviews(self, creds):
        return []

    def download(self, url: str) -> bytes:
        self._limiter.wait()
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        return r.content
