"""My Nintendo Switch account: per-title playtime, via the Parental Controls API.

Nintendo exposes almost nothing to third parties, with one exception: the
Parental Controls ("Moon") app, which reports how long each title was played.
That is the ONE thing worth having from a Switch — there are no achievements,
no public screenshots, no wishlist API — so this provider does the one thing it
can and leaves the rest empty.

Auth is the NSO-family session-token dance, but the Parental Controls client is
the easy member of it: unlike the Coral/NSO app it needs no f-token (no
imink/znca round-trip), just session_token → access_token straight off
accounts.nintendo.com. The admin obtains a session_token once (the same way
nxapi/pynintendoparental do — log in, grab the token from the redirect) and
pastes it; it's long-lived, and the short access_token is refreshed from it each
pass.

Endpoints and client id mirror pantherale0/pynintendoparental (the current Moon
client): fetchOwnedDevices → fetchLatestMonthlySummary, whose playedApps carry
per-title minutes. Nintendo only keeps recent windows, not a lifetime counter,
so the hours here are "recent", summed across the monthly summaries we can see —
honest about being a floor, not a total.
"""

from __future__ import annotations

import hashlib
import logging
import time

import requests

from igdb import RateLimiter
from match_validator import MatchValidator

log = logging.getLogger("gamedex.nintendo_user")

CLIENT_ID = "54789befb391a838"                # Parental Controls app
TOKEN_URL = "https://accounts.nintendo.com/connect/1.0.0/api/token"
GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer-session-token"
MOON = "https://app.lp1.znma.srv.nintendo.net"
# The Moon (znma) app's real headers — the API 401s without the full set, and
# authenticates with the ID token as a Bearer, NOT the raw access token.
_APP_PKG = "com.nintendo.znma"
_APP_VERSION = "2.4.0"
_APP_BUILD = "660"
_OS_VERSION = "34"
_UA = f"moon_ANDROID/{_APP_VERSION} ({_APP_PKG}; build:{_APP_BUILD}; ANDROID {_OS_VERSION})"


class NintendoUserClient:
    name = "nintendo"
    # Only a handful of Moon calls per pass (devices + a few monthly summaries),
    # and there are no per-title detail calls, so nothing to pace hard.
    ach_per_sync = 0
    hot_drain = False

    def __init__(self):
        self._limiter = RateLimiter(2)
        self._validator = MatchValidator()

    # ---- auth ----------------------------------------------------------------
    def _access_token(self, creds: dict) -> str:
        """session_token -> access_token, cached until it nears expiry."""
        if creds.get("_moonToken") and time.time() < (creds.get("_moonExp") or 0) - 60:
            return creds["_moonToken"]
        session = (creds.get("sessionToken") or "").strip()
        if not session:
            raise ValueError("no Nintendo session token")
        self._limiter.wait()
        # The token endpoint wants a Dalvik User-Agent and a JSON body (per nxapi);
        # a wrong UA gets rejected.
        r = requests.post(TOKEN_URL,
                          json={"client_id": CLIENT_ID, "grant_type": GRANT,
                                "session_token": session},
                          headers={"User-Agent": "Dalvik/2.1.0 (Linux; U; Android 8.0.0)",
                                   "Content-Type": "application/json",
                                   "Accept": "application/json"}, timeout=25)
        if r.status_code in (400, 401):
            raise ValueError("Nintendo rejected the session token — make sure it's a"
                             " Parental Controls token (nxapi pctl auth) and current")
        r.raise_for_status()
        j = r.json()
        # The Moon API authenticates with the ACCESS token as a Bearer (nxapi).
        creds["_moonToken"] = j.get("access_token") or j.get("id_token")
        creds["_moonExp"] = time.time() + int(j.get("expires_in") or 900)
        return creds["_moonToken"]

    def _get(self, creds: dict, path: str):
        self._limiter.wait()
        r = requests.get(f"{MOON}{path}",
                         headers={"Authorization": f"Bearer {self._access_token(creds)}",
                                  "X-Moon-App-Id": _APP_PKG,
                                  "X-Moon-Os": "ANDROID", "X-Moon-Os-Version": _OS_VERSION,
                                  "X-Moon-Model": "Pixel 4 XL",
                                  "X-Moon-App-Display-Version": _APP_VERSION,
                                  "X-Moon-App-Internal-Version": _APP_BUILD,
                                  "X-Moon-TimeZone": "America/Los_Angeles",
                                  "X-Moon-Os-Language": "en-US",
                                  "X-Moon-App-Language": "en-US",
                                  "User-Agent": _UA, "Accept": "application/json"},
                         timeout=25)
        r.raise_for_status()
        return r.json()

    def _devices(self, creds: dict) -> list[dict]:
        j = self._get(creds, "/v2/actions/user/fetchOwnedDevices")
        # The payload wraps the list under json.devices in current Moon builds.
        return ((j.get("json") or {}).get("devices")) or j.get("devices") or []

    def validate(self, creds: dict) -> dict:
        devices = self._devices(creds)     # also proves the token works
        name = None
        for d in devices:
            name = d.get("label") or d.get("name")
            if name:
                break
        return {"displayName": name}

    def account_name(self, creds: dict) -> str | None:
        try:
            for d in self._devices(creds):
                if d.get("label") or d.get("name"):
                    return d.get("label") or d.get("name")
        except Exception:
            return None
        return None

    # ---- library (per-title playtime) ------------------------------------------
    def fetch_library(self, creds: dict) -> list[dict]:
        """Aggregate per-title minutes across every device's latest monthly
        summary. Keyed by the title's own hex id, which is stable; the name is
        what we match on since Nintendo gives no external id join."""
        totals: dict[str, dict] = {}
        for dev in self._devices(creds):
            did = dev.get("deviceId") or dev.get("id")
            if not did:
                continue
            try:
                summary = self._get(
                    creds, f"/v2/actions/playSummary/fetchLatestMonthlySummary?deviceId={did}")
            except Exception as exc:
                log.debug("nintendo monthly summary for %s failed: %s", did, exc)
                continue
            j = summary.get("json") or summary
            for app in j.get("playedApps") or j.get("playingApps") or []:
                aid = str(app.get("applicationId") or app.get("titleId")
                          or hashlib.sha1((app.get("title") or "").encode()).hexdigest()[:12])
                mins = app.get("playingTime") or app.get("playedTime") or 0
                # Moon reports seconds in some builds, minutes in others; values
                # over ~a week in "minutes" are really seconds.
                if mins and mins > 10080:
                    mins = round(mins / 60)
                rec = totals.setdefault(aid, {"name": app.get("title"), "min": 0,
                                              "icon": app.get("imageUri") or app.get("imageURL")})
                rec["min"] += mins
        return [{"appId": aid, "name": r["name"], "playtimeMin": r["min"],
                 "playtime2wkMin": None, "lastPlayed": None, "iconUrl": r["icon"]}
                for aid, r in totals.items() if r["name"]]

    # ---- everything else: the Switch simply has no API for it -----------------------
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
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=60)
        r.raise_for_status()
        return r.content
