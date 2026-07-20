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

Playtime doesn't ride on titleHistory, but the userstats service behind
player/stats serves a MinutesPlayed stat — and it batches, so ONE extra POST
per pass covers the whole library. Only the modern titles (Xbox One/Series/PC)
carry the stat; 360-era games stay hours-less forever, and Series clocks run
hot (Quick Resume counts suspended time), which the health page's
platform-clock check is there to surface.
"""

from __future__ import annotations

import logging

import requests

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.xbox_user")

BASE = "https://xbl.io"


class XboxUserClient:
    name = "xbox"
    # Free tier is 150 req/hr. Rather than one tiny 30-app bite per 6-hour pass
    # (which stalled a big library for days at a fraction of the budget), drain
    # CONTINUOUSLY but paced to the ceiling: the rate limiter spaces every call
    # ~26s apart (~138/hr, safely under 150), and hot_drain keeps the worker
    # cycling so the whole backlog clears in a couple of hours, not a week.
    ach_per_sync = 50
    hot_drain = True

    def __init__(self):
        self._limiter = RateLimiter(1 / 26)   # ~138 requests/hour
        self._xuid = None
        # titleId -> the titleHistory summary's achievement volume (count +
        # gamerscore). Zero means the x360 fallback has nothing to find, which
        # spares a paced call per app-with-no-achievements (Steam shadow
        # entries, Halo Waypoint and friends).
        self._ach_totals: dict[str, int] = {}

    @staticmethod
    def _unwrap(j):
        # OpenXBL wraps the real payload in {"content": {...}, "code": 200}. Some
        # endpoints answer flat, so unwrap only when the envelope is present.
        if isinstance(j, dict) and "content" in j and isinstance(j["content"], (dict, list)):
            j = j["content"]
        # Over the limit, OpenXBL answers 200 with a throttle notice instead of
        # data ({"limitType": "Rate", "currentRequests": ...}). Left to flow
        # through, that body reads as "no achievements" and the app gets
        # permanently flagged noach — so it must raise, not return.
        if isinstance(j, dict) and j.get("limitType") == "Rate":
            raise RuntimeError("OpenXBL rate limit hit — try later")
        return j

    def _get(self, creds, path, params=None, timeout=25):
        self._limiter.wait()
        r = requests.get(f"{BASE}{path}", params=params,
                         headers={"x-authorization": creds.get("apiKey", ""),
                                  "Accept": "application/json"}, timeout=timeout)
        if r.status_code == 429:
            raise RuntimeError("OpenXBL hourly rate limit hit — try later")
        r.raise_for_status()
        return self._unwrap(r.json())

    def _post(self, creds, path, body, timeout=30):
        self._limiter.wait()
        r = requests.post(f"{BASE}{path}", json=body,
                          headers={"x-authorization": creds.get("apiKey", ""),
                                   "Accept": "application/json"}, timeout=timeout)
        if r.status_code == 429:
            raise RuntimeError("OpenXBL hourly rate limit hit — try later")
        r.raise_for_status()
        return self._unwrap(r.json())

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
    @staticmethod
    def _platform_from_devices(devices) -> str | None:
        """A sheet-platform hint from titleHistory's devices list, so matching
        can keep a Game Pass PC title on the PC rows and a 360 title off them.
        Play Anywhere (PC + console) stays None — it could be either side."""
        d = set(devices or [])
        if not d:
            return None
        if d <= {"PC", "Win32"}:      # Store/Game Pass PC, GFWL, tracked Steam
            return "pc"
        if "Xbox360" in d:            # 360 titles also list their backcompat hosts
            return "xbox 360"
        if "PC" in d:
            return None
        if d == {"XboxSeries"}:
            return "xbox series x|s"
        return "xbox one"

    def _fetch_minutes(self, creds, title_ids) -> dict[str, int]:
        """MinutesPlayed for the whole library in ONE userstats batch. Only
        modern (One/Series/PC) titles carry the stat; the rest just return no
        row. Raises on failure rather than answering {} — a transient miss
        must fail the library stage, not overwrite every stored clock with 0."""
        if not self._xuid or not title_ids:
            return {}
        j = self._post(creds, "/api/v2/player/stats",
                       {"xuids": [str(self._xuid)],
                        "stats": [{"name": "MinutesPlayed", "titleId": str(t)}
                                  for t in title_ids]})
        out = {}
        for coll in (j.get("statlistscollection") or []) if isinstance(j, dict) else []:
            for s in coll.get("stats") or []:
                v = s.get("value")
                if v is None or s.get("name") != "MinutesPlayed":
                    continue
                try:
                    out[str(s.get("titleid"))] = int(v)
                except (TypeError, ValueError):
                    continue
        return out

    def fetch_library(self, creds: dict) -> list[dict]:
        j = self._get(creds, "/api/v2/player/titleHistory")
        # titleHistory names the account's xuid; the x360 achievements endpoint
        # needs it in the path (the modern one infers it from the key).
        self._xuid = j.get("xuid") or self._xuid
        titles = [t for t in j.get("titles") or []
                  if t.get("titleId") is not None]
        minutes = self._fetch_minutes(creds, [t["titleId"] for t in titles])
        out = []
        for t in titles:
            ach = t.get("achievement") or {}
            th = t.get("titleHistory") or {}
            tid = str(t.get("titleId"))
            self._ach_totals[tid] = ((ach.get("totalAchievements") or 0)
                                     + (ach.get("totalGamerscore") or 0))
            plat = self._platform_from_devices(t.get("devices"))
            # The Xbox PC app shadow-tracks OTHER stores' games (Steam,
            # mostly): a PC-side entry with zero achievement volume isn't
            # owned on Xbox in any sense worth a pill on the PC row — and a
            # real-but-unplayed Game Pass title still shows its full
            # totalGamerscore, so this only sheds the shadows.
            if plat == "pc" and not (ach.get("currentGamerscore")
                                     or ach.get("totalGamerscore")
                                     or ach.get("currentAchievements")
                                     or ach.get("totalAchievements")):
                continue
            out.append({
                "appId": tid,
                "name": t.get("name"),
                "playtimeMin": minutes.get(tid),
                "playtime2wkMin": None,
                "lastPlayed": th.get("lastTimePlayed"),
                "iconUrl": t.get("displayImage"),
                "platform": plat,
                "extra": {"gamerscore": ach.get("currentGamerscore"),
                          "totalGamerscore": ach.get("totalGamerscore"),
                          "achEarned": ach.get("currentAchievements"),
                          "achTotal": ach.get("totalAchievements")},
            })
        return out

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
            # Empty here doesn't mean the game has none: Xbox 360-era titles
            # (GFWL included) only answer on the x360 endpoint, in its own
            # schema. But when the titleHistory summary already said the title
            # has zero achievements AND zero gamerscore, the fallback has
            # nothing to find — skip the paced call. Unknown (cold cache)
            # errs toward asking.
            if self._ach_totals.get(str(app_id), 1) == 0:
                return None
            return self._fetch_achievements_x360(creds, app_id)
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

    def _ensure_xuid(self, creds) -> str | None:
        if not self._xuid:
            j = self._get(creds, "/api/v2/player/titleHistory")
            self._xuid = j.get("xuid")
        return self._xuid

    def _fetch_achievements_x360(self, creds: dict, app_id: str) -> list[dict] | None:
        """Xbox 360 titles, which the modern endpoint answers with an empty
        list. This one serves only the EARNED unlocks (Portal 2 at 18/50 comes
        back as 18 rows) — the locked remainder isn't offered, so the grid for
        a 360 game shows what was earned and the summary counts carry the
        denominator. No mediaAssets, but the legacy tile service still serves
        the icons at image.xboxlive.com/global/t.{titleId hex}/ach/0/{imageId
        hex} (plain http — fine, the UI proxies every third-party image
        through /api/img anyway)."""
        xuid = self._ensure_xuid(creds)
        if not xuid:
            return None
        try:
            j = self._get(creds, f"/api/v2/achievements/x360/{xuid}/title/{app_id}")
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code == 404:
                return None
            raise
        rows = j.get("achievements") or []
        if not rows:
            return None
        out = []
        for a in rows:
            unlocked = (bool(a.get("unlocked")) or bool(a.get("unlockedOnline"))) \
                and not a.get("isRevoked")
            rarity = a.get("rarity") or {}
            pct = rarity.get("currentPercentage")
            icon = None
            try:
                icon = (f"http://image.xboxlive.com/global/t.{int(app_id):x}"
                        f"/ach/0/{int(a['imageId']):x}")
            except (KeyError, TypeError, ValueError):
                pass
            out.append({
                "id": str(a.get("id")),
                "name": a.get("name"),
                "description": (a.get("description")
                                if unlocked else a.get("lockedDescription")) or a.get("description"),
                "iconUrl": icon,
                "iconLockedUrl": icon,
                "hidden": bool(a.get("isSecret")),
                "rarity": (rarity.get("currentCategory") or "").lower() or None,
                "globalPct": float(pct) if pct is not None else None,
                "unlocked": unlocked,
                "unlockedAt": a.get("timeUnlocked") if unlocked else None,
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
