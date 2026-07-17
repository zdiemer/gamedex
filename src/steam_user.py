"""My Steam account: the library, the hours, the achievements, the wishlist,
the screenshots, the reviews.

Everything steamx.py knows is about the GAME (global rarity, SteamSpy owners);
everything here is about ME. Auth is the boring official kind — a Web API key
plus a SteamID64, both entered once in the admin UI and kept in platforms.sqlite
— which buys five real endpoints and leaves two gaps Valve never filled:

  * Reviews have no per-user API at all. The profile's /recommended/ pages are
    the only source, so those are scraped (curl_cffi + bs4, the Co-Optimus
    stack) and parsed defensively: a markup change must cost us the reviews
    stage, never the sync.
  * Screenshots: IPublishedFileService/GetUserFiles is the official route and
    is tried first, but its screenshot coverage is spotty (it only reliably
    returns items with workshop-style metadata), so the community profile's
    /screenshots/ grid is the fallback when it comes back empty.

Privacy matters here: GetOwnedGames returns an EMPTY object (not an error) for
a private profile, so validate() checks for that explicitly and says so —
otherwise a locked-down profile looks like an empty library forever.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from curl_cffi import requests as crequests

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.steam_user")

API = "https://api.steampowered.com"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _iso(ts) -> str | None:
    try:
        ts = int(ts)
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat(timespec="seconds")


class SteamUserClient:
    name = "steam"

    def __init__(self):
        self._limiter = RateLimiter(1)

    def _get(self, path, params, timeout=20):
        self._limiter.wait()
        r = requests.get(f"{API}{path}", params=params,
                         headers={"User-Agent": _UA}, timeout=timeout)
        r.raise_for_status()
        return r.json()

    def _scrape(self, url, params=None, timeout=25):
        self._limiter.wait()
        r = crequests.get(url, params=params, impersonate="chrome", timeout=timeout,
                          # Age-gated content otherwise bounces to an interstitial.
                          cookies={"birthtime": "0", "mature_content": "1"})
        r.raise_for_status()
        return r.text

    # ---- auth --------------------------------------------------------------
    def validate(self, creds: dict) -> dict:
        """Check the key + id actually work, and that the profile is open enough
        to be worth syncing. Returns {'displayName': ...}; raises ValueError with
        a human-readable reason otherwise."""
        key, sid = (creds.get("apiKey") or "").strip(), (creds.get("steamId") or "").strip()
        if not key or not re.fullmatch(r"\d{17}", sid):
            raise ValueError("need an API key and a 17-digit SteamID64")
        try:
            j = self._get("/ISteamUser/GetPlayerSummaries/v2/",
                          {"key": key, "steamids": sid})
        except requests.HTTPError as e:
            code = e.response.status_code if e.response is not None else 0
            raise ValueError("Steam rejected the API key" if code in (401, 403)
                             else f"Steam API error ({code})")
        players = ((j.get("response") or {}).get("players")) or []
        if not players:
            raise ValueError("no Steam profile with that SteamID64")
        owned = self._get("/IPlayerService/GetOwnedGames/v1/",
                          {"key": key, "steamid": sid, "include_appinfo": 0})
        if not (owned.get("response") or {}).get("game_count"):
            raise ValueError('library is empty or private — set "Game details" to'
                             " Public in Steam privacy settings")
        return {"displayName": players[0].get("personaname")}

    # ---- library -------------------------------------------------------------
    def fetch_library(self, creds: dict) -> list[dict]:
        j = self._get("/IPlayerService/GetOwnedGames/v1/",
                      {"key": creds["apiKey"], "steamid": creds["steamId"],
                       "include_appinfo": 1, "include_played_free_games": 1})
        out = []
        for g in ((j.get("response") or {}).get("games")) or []:
            icon = g.get("img_icon_url")
            out.append({
                "appId": g["appid"], "name": g.get("name"),
                "playtimeMin": g.get("playtime_forever") or 0,
                "playtime2wkMin": g.get("playtime_2weeks"),
                "lastPlayed": _iso(g.get("rtime_last_played")),
                "iconUrl": (f"https://media.steampowered.com/steamcommunity/public/images/"
                            f"apps/{g['appid']}/{icon}.jpg" if icon else None),
            })
        return out

    # ---- achievements ----------------------------------------------------------
    def fetch_achievements(self, creds: dict, app_id: str) -> list[dict] | None:
        """Schema (names/icons) + player state (unlocked/when), merged.
        None = the game has no achievements at all — callers record that so the
        question is never asked twice."""
        try:
            schema = self._get("/ISteamUserStats/GetSchemaForGame/v2/",
                               {"key": creds["apiKey"], "appid": app_id})
        except requests.HTTPError as e:
            if e.response is not None and e.response.status_code in (400, 403):
                return None
            raise
        by_id = {}
        for a in ((schema.get("game") or {}).get("availableGameStats") or {}) \
                .get("achievements") or []:
            by_id[a["name"]] = {
                "id": a["name"], "name": a.get("displayName"),
                "description": a.get("description"),
                "iconUrl": a.get("icon"), "iconLockedUrl": a.get("icongray"),
                "hidden": bool(a.get("hidden")), "unlocked": False, "unlockedAt": None,
            }
        if not by_id:
            return None
        try:
            player = self._get("/ISteamUserStats/GetPlayerAchievements/v1/",
                               {"key": creds["apiKey"], "steamid": creds["steamId"],
                                "appid": app_id})
        except requests.HTTPError as e:
            # "Requested app has no stats" comes back as a 400 with success:false.
            if e.response is not None and e.response.status_code == 400:
                return None
            raise
        ps = (player.get("playerstats") or {})
        if not ps.get("success", True) and not ps.get("achievements"):
            return None
        for a in ps.get("achievements") or []:
            rec = by_id.get(a.get("apiname"))
            if rec and a.get("achieved"):
                rec["unlocked"] = True
                rec["unlockedAt"] = _iso(a.get("unlocktime"))
        # Global rarity, so the grid can say "3.1% of players have this". Keyless
        # public endpoint; a miss just leaves the percentages off.
        try:
            g = self._get("/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",
                          {"gameid": app_id})
            for a in ((g.get("achievementpercentages") or {}).get("achievements")) or []:
                rec = by_id.get(a.get("name"))
                if rec:
                    rec["globalPct"] = round(float(a.get("percent") or 0), 2)
        except Exception as exc:
            log.debug("global pct %s: %s", app_id, exc)
        return list(by_id.values())

    # ---- screenshots -------------------------------------------------------------
    def fetch_screenshots(self, creds: dict, cursor: str | None) -> tuple[list[dict], str | None]:
        """Newest-first until we hit `cursor` (the newest shot_id already stored).
        Returns (shots, new_cursor)."""
        shots = self._shots_api(creds, cursor)
        if shots is None:
            shots = self._shots_scrape(creds, cursor)
        new_cursor = shots[0]["id"] if shots else cursor
        return shots, new_cursor

    def _shots_api(self, creds, cursor) -> list[dict] | None:
        """GetUserFiles filetype=4 (screenshots). Returns None when the endpoint
        yields nothing usable, so the scrape gets its turn."""
        out, page = [], 1
        try:
            while page <= 50:
                j = self._get("/IPublishedFileService/GetUserFiles/v1/",
                              {"key": creds["apiKey"], "steamid": creds["steamId"],
                               "filetype": 4, "numperpage": 100, "page": page,
                               "return_metadata": True})
                resp = j.get("response") or {}
                files = resp.get("publishedfiledetails") or []
                if not files:
                    break
                for f in files:
                    sid = str(f.get("publishedfileid") or "")
                    if not sid:
                        continue
                    if cursor and sid == str(cursor):
                        return out
                    url = f.get("file_url") or f.get("preview_url")
                    if not url:
                        continue
                    out.append({"id": sid, "appId": f.get("consumer_appid"),
                                "takenAt": _iso(f.get("time_created")),
                                "caption": (f.get("title") or "").strip() or None,
                                "sourceUrl": url,
                                "width": f.get("image_width"),
                                "height": f.get("image_height")})
                if len(files) < 100 or page * 100 >= (resp.get("total") or 0):
                    break
                page += 1
        except Exception as exc:
            log.warning("GetUserFiles failed (%s); falling back to profile scrape", exc)
            return None
        return out or None

    def _shots_scrape(self, creds, cursor) -> list[dict]:
        """The community profile's screenshot grid. Grid pages give the file ids
        newest-first; each detail page gives the full-size CDN URL and the app."""
        sid = creds["steamId"]
        out, page = [], 1
        while page <= 100:
            html = self._scrape(f"https://steamcommunity.com/profiles/{sid}/screenshots/",
                                {"p": page, "sort": "newestfirst", "view": "grid"})
            ids = list(dict.fromkeys(
                re.findall(r"filedetails/\?id=(\d+)", html)))
            if not ids:
                break
            done = False
            for fid in ids:
                if cursor and fid == str(cursor):
                    done = True
                    break
                detail = self._scrape(
                    "https://steamcommunity.com/sharedfiles/filedetails/", {"id": fid})
                s = BeautifulSoup(detail, "html.parser")
                img = s.select_one("#ActualMedia") or s.select_one(".screenshotEnlargeable img")
                href = s.select_one("a[href*='store.steampowered.com/app/']")
                m = re.search(r"/app/(\d+)", href["href"]) if href else None
                date_el = s.select_one(".detailsStatRight")
                out.append({"id": fid,
                            "appId": m.group(1) if m else None,
                            "takenAt": None,
                            "caption": (date_el.get_text(strip=True) if date_el else None),
                            "sourceUrl": img["src"].split("?")[0] if img and img.get("src") else None})
            if done:
                break
            page += 1
        return [s for s in out if s["sourceUrl"]]

    # ---- wishlist ------------------------------------------------------------------
    def fetch_wishlist(self, creds: dict) -> list[dict]:
        j = self._get("/IWishlistService/GetWishlist/v1/",
                      {"key": creds["apiKey"], "steamid": creds["steamId"]})
        items = ((j.get("response") or {}).get("items")) or []
        out = [{"appId": it["appid"], "addedAt": _iso(it.get("date_added")),
                "priority": it.get("priority")} for it in items if it.get("appid")]
        self._wishlist_names(out)
        return out

    def _wishlist_names(self, items):
        """Batch-resolve names via IStoreBrowseService; a miss just leaves the
        name NULL (matching may still fill it from the catalogue by appid)."""
        import json as _json
        for i in range(0, len(items), 50):
            batch = items[i:i + 50]
            try:
                j = self._get("/IStoreBrowseService/GetItems/v1/", {
                    "input_json": _json.dumps({
                        "ids": [{"appid": int(it["appId"])} for it in batch],
                        "context": {"language": "english", "country_code": "US"},
                    })})
                got = {s.get("appid"): s.get("name")
                       for s in ((j.get("response") or {}).get("store_items")) or []}
                for it in batch:
                    it["name"] = got.get(int(it["appId"]))
            except Exception as exc:
                log.debug("wishlist name batch failed: %s", exc)

    # ---- reviews ----------------------------------------------------------------------
    def fetch_reviews(self, creds: dict) -> list[dict]:
        """Scrape /recommended/ — the only source there is. Parsed loosely: any
        block we can't make sense of is skipped, not fatal."""
        sid = creds["steamId"]
        out, page = [], 1
        while page <= 50:
            html = self._scrape(f"https://steamcommunity.com/profiles/{sid}/recommended/",
                                {"p": page})
            soup = BeautifulSoup(html, "html.parser")
            boxes = soup.select(".review_box")
            if not boxes:
                break
            for box in boxes:
                try:
                    rec = self._parse_review(box)
                    if rec:
                        out.append(rec)
                except Exception as exc:
                    log.debug("review parse skipped a block: %s", exc)
            if not soup.select_one(f'.pagebtn[href*="p={page + 1}"]') and \
               not soup.select_one(f'a[href*="p={page + 1}"]'):
                break
            page += 1
        return out

    @staticmethod
    def _parse_review(box) -> dict | None:
        link = box.select_one('a[href*="/recommended/"]')
        m = re.search(r"/recommended/(\d+)", link["href"]) if link else None
        if not m:
            return None
        app_id = m.group(1)
        thumb = box.select_one(".thumb img")
        recommended = None
        if thumb and thumb.get("src"):
            src = thumb["src"]
            recommended = "thumbsUp" in src if "thumbs" in src else None
        title_el = box.select_one(".vote_header .title, .title")
        if recommended is None and title_el:
            recommended = "Recommended" == title_el.get_text(strip=True)
        hours = None
        hrs_el = box.select_one(".hours")
        if hrs_el:
            hm = re.search(r"([\d,.]+)", hrs_el.get_text())
            if hm:
                hours = float(hm.group(1).replace(",", ""))
        posted = None
        posted_el = box.select_one(".posted")
        if posted_el:
            posted = posted_el.get_text(strip=True).replace("Posted", "").strip()
        content = box.select_one(".content")
        text = content.get_text("\n", strip=True) if content else None
        return {"appId": app_id, "recommended": recommended, "text": text,
                "postedAt": posted, "hoursAtReview": hours,
                "url": link["href"].split("?")[0]}

    # ---- bytes --------------------------------------------------------------------------
    def download(self, url: str) -> bytes:
        self._limiter.wait()
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=60)
        r.raise_for_status()
        return r.content
