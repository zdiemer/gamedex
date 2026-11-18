"""HowLongToBeat client.

HLTB guards search behind a per-session handshake: GET /api/search/site/init
returns {token}, and the search POST to /api/search/site echoes it as
`x-auth-token`. The token is reused across searches and refreshed on a 403.
Until 2026-11 init also returned {hpKey, hpVal}, which had to be echoed as
`x-hp-key` / `x-hp-val` headers and a `{[hpKey]: hpVal}` body field. They are
still sent when present, so either shape of the handshake works.

A 429 (HLTB's "too many searches, wait a minute") pauses every lookup for
Retry-After or a minute. Without the pause, a failed init left no session,
so the next queued game re-ran init at 1/s and stayed throttled. The route rotates every so
often (/api/search, /api/seek, /api/bleed, now /api/search/site) — when
every lookup starts 404ing, pull the site's _next chunks and grep for
`api/`; the shape has outlived every rename.
Rate limited to 1/s. Matching reuses the ported MatchValidator.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time

import requests

from excel_game import ExcelGame
from igdb import platform_from_str
from ratelimiter import RateLimiter
from match_validator import MatchValidator

log = logging.getLogger("gamedex.hltb")

_BASE = "https://howlongtobeat.com"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _hours(seconds):
    return round(seconds / 3600, 2) if seconds else None


class HltbClient:
    def __init__(self):
        self._validator = MatchValidator()
        self._limiter = RateLimiter(1)
        self._session = None            # {token[, hpKey, hpVal]}
        self._lock = threading.Lock()
        self._cooldown_until = 0.0

    @property
    def configured(self):
        return True

    def _base_headers(self):
        return {"User-Agent": _UA, "referer": _BASE + "/", "Origin": _BASE}

    def _throttle(self, resp):
        """Turn a 429 into a shared pause; raise so this lookup is retried later."""
        if resp.status_code != 429:
            return
        try:
            delay = max(1.0, min(float(resp.headers.get("Retry-After", 60)), 600.0))
        except ValueError:
            delay = 60.0
        self._cooldown_until = max(self._cooldown_until, time.monotonic() + delay)
        log.warning("HLTB: rate limited, pausing lookups for %.0fs", delay)
        resp.raise_for_status()

    def _wait_cooldown(self):
        remaining = self._cooldown_until - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)

    def _init_session(self):
        with self._lock:
            self._wait_cooldown()
            self._limiter.wait()
            r = requests.get(f"{_BASE}/api/search/site/init?t={int(time.time() * 1000)}",
                             headers=self._base_headers(), timeout=30)
            self._throttle(r)
            r.raise_for_status()
            j = r.json()
            token = j.get("token")
            if not token:
                raise RuntimeError(f"HLTB init returned no token (keys: {sorted(j)})")
            self._session = {"token": token}
            if j.get("hpKey"):
                self._session.update(hpKey=j["hpKey"], hpVal=j.get("hpVal", ""))
            log.info("HLTB: search session initialized")

    def _search(self, title: str):
        if not self._session:
            self._init_session()
        return self._do_search(title, retry=True)

    def _do_search(self, title, retry):
        s = self._session
        terms = [w for w in title.split(" ") if w]
        body = {
            "searchType": "games", "searchTerms": terms, "searchPage": 1, "size": 20,
            "searchOptions": {
                "games": {"userId": 0, "platform": "", "sortCategory": "popular",
                          "rangeCategory": "main", "rangeTime": {"min": None, "max": None},
                          "gameplay": {"perspective": "", "flow": "", "genre": ""},
                          "year": "", "modifier": ""},
                "users": {"sortCategory": "postcount"}, "lists": {"sortCategory": "follows"},
                "filter": "", "sort": 0, "randomizer": 0},
            "useCache": True,
        }
        headers = {**self._base_headers(), "Content-Type": "application/json",
                   "x-auth-token": s["token"]}
        if "hpKey" in s:                  # legacy honeypot handshake
            body[s["hpKey"]] = s["hpVal"]
            headers.update({"x-hp-key": s["hpKey"], "x-hp-val": s["hpVal"]})
        self._wait_cooldown()
        self._limiter.wait()
        resp = requests.post(f"{_BASE}/api/search/site", data=json.dumps(body), headers=headers, timeout=30)
        self._throttle(resp)
        if resp.status_code == 403 and retry:   # token expired — refresh once
            self._init_session()
            return self._do_search(title, retry=False)
        resp.raise_for_status()
        return resp.json()

    def match(self, title, platform=None, year=None):
        game = ExcelGame(title=title, platform=platform_from_str(platform), release_year=year)
        data = self._search(title)
        for r in (data or {}).get("data", []):
            if not r.get("comp_main"):
                continue
            names = [r.get("game_name")] + [a for a in (r.get("game_alias") or "").split(", ") if a]
            plats = [p for p in (r.get("profile_platform") or "").split(", ") if p]
            years = [r["release_world"]] if r.get("release_world") else []
            info = self._validator.validate(game, names, plats, years)
            if info.likely_match or (info.matched and not any(plats)):
                return self._to_hltb(r)
        return None

    def override_from_url(self, title, url):
        """Manual mapping: pick the HLTB result whose game id matches the URL."""
        m = re.search(r"/game/(\d+)", url)
        if not m:
            return None
        gid = m.group(1)
        for r in (self._search(title) or {}).get("data", []):
            if str(r.get("game_id")) == gid:
                return self._to_hltb(r)
        return None

    def _to_hltb(self, r):
        main = r.get("comp_main") or 0
        plus = r.get("comp_plus") or 0
        hundred = r.get("comp_100") or 0
        allv = r.get("comp_all") or 0
        best = main or plus or hundred or allv
        return {
            "name": r.get("game_name"), "url": f"{_BASE}/game/{r.get('game_id')}",
            "main": _hours(main), "mainPlus": _hours(plus), "hundred": _hours(hundred),
            "allStyles": _hours(allv), "best": _hours(best),
        }
