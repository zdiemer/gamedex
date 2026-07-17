"""My PlayStation account: trophies and real hours, via the PSN mobile APIs.

There is no official public PSN API, but the PlayStation App speaks a stable,
well-documented-by-reverse-engineering one (the psn-api / PSNAWP lineage). Auth
is the awkward part: the admin signs in at playstation.com and pastes the NPSSO
cookie (ca.account.sony.com/api/v1/ssocookie). That NPSSO buys an access +
refresh token pair; the refresh token lasts ~2 months, after which the provider
card shows an error asking for a fresh NPSSO. Tokens rotate at runtime, which
is exactly why linked-account credentials live in platforms.sqlite and the sync
engine re-saves them after every pass.

What the two endpoints give us:

  * gamelist (users/me/titles) — the played-games list: titleId (CUSA/PPSA),
    name, playCount, first/last played, and playDuration as an ISO-8601
    duration. This is the LIBRARY: real hours Sony counted.
  * trophy (users/me/trophyTitles + per-set trophies) — the trophy sets. A
    trophy set is keyed by npCommunicationId, which NOTHING maps to titleId
    officially; like every other consumer of this API we join the two by
    normalized name. A miss means "no trophy grid", never a wrong one.

Trophy grades map onto the generic achievements schema: trophyType lands in
`rarity` (bronze/silver/gold/platinum — the UI tints by it), trophyEarnedRate
in `global_pct`.

No wishlist (Sony never exposed one), no reviews (don't exist), and no
screenshots yet — the PS App cloud gallery is a later, separate effort.
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time

import requests

from igdb import RateLimiter
from match_validator import MatchValidator

log = logging.getLogger("gamedex.psn_user")

AUTH = "https://ca.account.sony.com/api/authz/v3/oauth"
API = "https://m.np.playstation.com/api"
# The PlayStation App's own client credentials — public knowledge in every PSN
# library; without them the token endpoints refuse to talk at all.
_CLIENT_ID = "09515159-7237-4370-9b40-3806e67c0891"
_CLIENT_B64 = base64.b64encode(
    f"{_CLIENT_ID}:ucPjka5tntB2KqsP".encode()).decode()
_REDIRECT = "com.scee.psxandroid.scecompcall://redirect"

_DUR = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?")


def _duration_min(iso: str | None) -> int:
    m = _DUR.fullmatch(iso or "")
    if not m:
        return 0
    h, mi, s = (float(x) if x else 0 for x in m.groups())
    return int(h * 60 + mi + s / 60)


class PsnUserClient:
    name = "psn"

    def __init__(self):
        self._limiter = RateLimiter(2)
        self._validator = MatchValidator()
        self._trophy_sets = None      # [{npCommunicationId, name, service}] per pass

    # ---- auth ----------------------------------------------------------------
    def _npsso_to_tokens(self, creds: dict) -> None:
        """NPSSO -> authorization code -> access + refresh tokens, written back
        onto `creds` (the engine persists the dict after each pass)."""
        npsso = (creds.get("npsso") or "").strip()
        if not npsso:
            raise ValueError("no NPSSO token")
        r = requests.get(
            f"{AUTH}/authorize",
            params={"access_type": "offline", "client_id": _CLIENT_ID,
                    "response_type": "code", "scope": "psn:mobile.v2.core psn:clientapp",
                    "redirect_uri": _REDIRECT},
            cookies={"npsso": npsso}, allow_redirects=False, timeout=20)
        loc = r.headers.get("location") or ""
        m = re.search(r"[?&]code=([^&]+)", loc)
        if not m:
            raise ValueError("PSN rejected the NPSSO token — sign in at"
                             " playstation.com and fetch a fresh one")
        self._grant(creds, {"grant_type": "authorization_code", "code": m.group(1),
                            "redirect_uri": _REDIRECT, "token_format": "jwt"})

    def _grant(self, creds: dict, body: dict) -> None:
        r = requests.post(
            f"{AUTH}/token", data=body,
            headers={"Authorization": f"Basic {_CLIENT_B64}",
                     "Content-Type": "application/x-www-form-urlencoded"},
            timeout=20)
        r.raise_for_status()
        j = r.json()
        creds["accessToken"] = j["access_token"]
        creds["refreshToken"] = j.get("refresh_token") or creds.get("refreshToken")
        creds["accessExpires"] = time.time() + int(j.get("expires_in") or 3600)

    @staticmethod
    def _account_id(creds: dict) -> str | None:
        """The numeric PSN account id, read out of the access token's JWT claims.
        The userProfile endpoint needs it — unlike gamelist/trophy, it won't take
        the `me` alias (400s)."""
        tok = creds.get("accessToken") or ""
        try:
            payload = tok.split(".")[1]
            payload += "=" * (-len(payload) % 4)
            return json.loads(base64.urlsafe_b64decode(payload)).get("account_id")
        except Exception:
            return None

    def _token(self, creds: dict) -> str:
        """A live access token, refreshing (or fully re-authing) as needed."""
        if creds.get("accessToken") and time.time() < (creds.get("accessExpires") or 0) - 60:
            return creds["accessToken"]
        if creds.get("refreshToken"):
            try:
                self._grant(creds, {"grant_type": "refresh_token",
                                    "refresh_token": creds["refreshToken"],
                                    "scope": "psn:mobile.v2.core psn:clientapp",
                                    "token_format": "jwt"})
                return creds["accessToken"]
            except Exception as exc:
                log.info("psn refresh token spent (%s); trying the NPSSO", exc)
        self._npsso_to_tokens(creds)      # ~2-monthly: the refresh token aged out
        return creds["accessToken"]

    def _get(self, creds: dict, path: str, params: dict | None = None):
        self._limiter.wait()
        r = requests.get(f"{API}{path}", params=params,
                         headers={"Authorization": f"Bearer {self._token(creds)}"},
                         timeout=25)
        r.raise_for_status()
        return r.json()

    def validate(self, creds: dict) -> dict:
        # The ONLY thing that decides a valid link is whether the NPSSO buys a
        # token pair. Anything after that — the display-name lookup — is cosmetic
        # and must not fail the link (a 502 on the profile call is exactly what
        # blocked the first real attempt).
        try:
            self._npsso_to_tokens(creds)
        except ValueError:
            raise
        except Exception as exc:
            log.warning("psn auth failed: %s", exc)
            raise ValueError(f"couldn't reach PSN auth ({exc})")
        name = None
        acct = self._account_id(creds)
        if acct:
            try:
                j = self._get(creds, f"/userProfile/v1/internal/users/{acct}/profiles")
                name = j.get("onlineId") or ((j.get("profile") or {}).get("onlineId"))
            except Exception as exc:
                log.info("psn profile lookup failed: %s", exc)
        return {"displayName": name}

    def account_name(self, creds: dict) -> str | None:
        """The online ID, refreshed from a live token — the engine calls this to
        backfill a display name a failed link left blank."""
        acct = self._account_id(creds)
        if not acct:
            return None
        try:
            j = self._get(creds, f"/userProfile/v1/internal/users/{acct}/profiles")
            return j.get("onlineId") or ((j.get("profile") or {}).get("onlineId"))
        except Exception:
            return None

    # A PSN "trophyTitlePlatform" (PS3 / PSVITA / PS4,PS5 …) -> the sheet's
    # platform name, so a PS5 remake never lands on the PS3 original's row.
    _PLATFORM = {"PS5": "PlayStation 5", "PS4": "PlayStation 4",
                 "PS3": "PlayStation 3", "PSVITA": "PlayStation Vita",
                 "PSPC": "PC", "PSP": "PlayStation Portable"}
    _CATEGORY_PLATFORM = {"ps5_native_game": "PlayStation 5",
                          "ps4_game": "PlayStation 4", "pspc_game": "PC"}

    def _platform_of(self, raw: str | None) -> str | None:
        """The most specific sheet platform for a trophyTitlePlatform string.
        A "PS4,PS5" cross-gen set prefers PS5 (the newer copy is what a player
        earning trophies today is on)."""
        parts = [p.strip().upper() for p in (raw or "").split(",") if p.strip()]
        for want in ("PS5", "PS4", "PS3", "PSVITA", "PSP"):
            if want in parts:
                return self._PLATFORM.get(want)
        return None

    # ---- library ----------------------------------------------------------------
    def fetch_library(self, creds: dict) -> list[dict]:
        self._trophy_sets = None          # a fresh pass re-reads the trophy list
        self._names = {}
        gl, offset = {}, 0
        while True:
            j = self._get(creds, "/gamelist/v2/users/me/titles",
                          {"categories": "ps4_game,ps5_native_game,pspc_game",
                           "limit": 200, "offset": offset})
            titles = j.get("titles") or []
            for t in titles:
                if not t.get("titleId"):
                    continue
                gl[self._validator.normalize(t.get("name") or "")] = {
                    "appId": t.get("titleId"), "name": t.get("name"),
                    "playtimeMin": _duration_min(t.get("playDuration")),
                    "playtime2wkMin": None,
                    "lastPlayed": t.get("lastPlayedDateTime"),
                    "iconUrl": t.get("imageUrl"),
                    "platform": self._CATEGORY_PLATFORM.get(t.get("category")),
                    "extra": {"playCount": t.get("playCount"),
                              "firstPlayed": t.get("firstPlayedDateTime")},
                }
            offset += len(titles)
            if len(titles) < 200 or offset >= (j.get("totalItemCount") or 0):
                break
        out = list(gl.values())
        # The gamelist is PS4/PS5 only. PS3, Vita and PSP games have TROPHY sets
        # but never appear there — add them from the trophy list so their
        # trophies get synced, keyed by the trophy set's own id. Note we do NOT
        # skip on a name collision with a gamelist game: PS3 Demon's Souls and
        # PS5 Demon's Souls share a name but are different games on different
        # rows, and the platform filter already keeps PS4/PS5 out of here.
        for s in self._sets(creds):
            plat = self._platform_of(s.get("platform"))
            if plat in ("PlayStation 4", "PlayStation 5", "PC", None):
                continue                  # a gamelist game already carries these
            out.append({"appId": s["id"], "name": s["name"], "playtimeMin": None,
                        "playtime2wkMin": None, "lastPlayed": None, "iconUrl": s.get("icon"),
                        "platform": plat, "extra": {"trophySet": s["id"]}})
        self._names = {str(g["appId"]): g["name"] for g in out}
        self._game_platform = {str(g["appId"]): g.get("platform") for g in out}
        return out

    # ---- trophies ------------------------------------------------------------------
    def _sets(self, creds: dict) -> list[dict]:
        if self._trophy_sets is None:
            sets, offset = [], 0
            while True:
                j = self._get(creds, "/trophy/v1/users/me/trophyTitles",
                              {"limit": 250, "offset": offset})
                batch = j.get("trophyTitles") or []
                for s in batch:
                    sets.append({"id": s.get("npCommunicationId"),
                                 "name": s.get("trophyTitleName"),
                                 "service": s.get("npServiceName") or "trophy",
                                 "platform": s.get("trophyTitlePlatform"),
                                 "icon": s.get("trophyTitleIconUrl"),
                                 "norm": self._validator.normalize(
                                     s.get("trophyTitleName") or "")})
                offset += len(batch)
                if len(batch) < 250 or offset >= (j.get("totalItemCount") or 0):
                    break
            self._trophy_sets = sets
        return self._trophy_sets

    def _set_for(self, creds: dict, app_id: str, game_name: str) -> dict | None:
        """The trophy set for a library entry. A PS3/Vita entry is keyed by the
        set's own id (exact). A PS4/PS5 entry is keyed by titleId, joined to a
        set on the normalized name; when a name collides across generations
        (Demon's Souls PS3 vs PS5), the game's own platform breaks the tie."""
        sets = self._sets(creds)
        direct = [s for s in sets if s["id"] == str(app_id)]
        if direct:
            return direct[0]
        norm = self._validator.normalize(game_name or "")
        if not norm:
            return None
        want_plat = (self._game_platform or {}).get(str(app_id))
        hits = [s for s in sets if s["norm"] == norm]
        if len(hits) > 1 and want_plat:
            # Prefer the set whose platform matches this game's copy.
            same = [s for s in hits if self._platform_of(s.get("platform")) == want_plat]
            if len(same) == 1:
                return same[0]
        if len(hits) == 1:
            return hits[0]
        if hits:
            return None                   # still ambiguous — don't guess wrong
        hits = [s for s in sets
                if self._validator.titles_equal_fuzzy(game_name, s["name"] or "")]
        return hits[0] if len(hits) == 1 else None

    _game_platform: dict = {}

    # Engine hands us the titleId (or trophy-set id); names saved at library time.
    _names: dict = {}

    def fetch_achievements(self, creds: dict, app_id: str) -> list[dict] | None:
        name = self._names.get(str(app_id))
        if name is None:
            self.fetch_library(creds)
            name = self._names.get(str(app_id))
        ts = self._set_for(creds, app_id, name or "")
        if ts is None:
            return None                   # no trophy set we can safely claim
        params = {"npServiceName": ts["service"]}
        defs = self._get(creds, f"/trophy/v1/npCommunicationIds/{ts['id']}"
                                "/trophyGroups/all/trophies", params)
        earned = self._get(creds, f"/trophy/v1/users/me/npCommunicationIds/{ts['id']}"
                                  "/trophyGroups/all/trophies", params)
        got = {t.get("trophyId"): t for t in earned.get("trophies") or []}
        out = []
        for t in defs.get("trophies") or []:
            e = got.get(t.get("trophyId")) or {}
            rate = e.get("trophyEarnedRate")
            out.append({
                "id": str(t.get("trophyId")),
                "name": t.get("trophyName"),
                "description": t.get("trophyDetail"),
                "iconUrl": t.get("trophyIconUrl"),
                "iconLockedUrl": t.get("trophyIconUrl"),
                "hidden": bool(t.get("trophyHidden")),
                "rarity": t.get("trophyType"),
                "globalPct": float(rate) if rate is not None else None,
                "unlocked": bool(e.get("earned")),
                "unlockedAt": e.get("earnedDateTime"),
            })
        return out or None

    # ---- the rest: PSN simply has no API for these -------------------------------------
    def fetch_screenshots(self, creds, cursor):
        return [], cursor                 # PS App cloud gallery: a later effort

    def fetch_wishlist(self, creds):
        return []

    def fetch_reviews(self, creds):
        return []

    def download(self, url: str) -> bytes:
        self._limiter.wait()
        r = requests.get(url, timeout=60)
        r.raise_for_status()
        return r.content
