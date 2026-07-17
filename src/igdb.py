"""IGDB client + title matcher.

Auth is Twitch OAuth (client-credentials → bearer token, ~60d, auto-refreshed).
We fetch everything for a title in a SINGLE nested-field request (IGDB v4 lets
you expand related objects inline), so matching one spreadsheet row costs ~1
request instead of the dozen the original GamesMaster client made. Matching
reuses that project's battle-tested MatchValidator + platform-alias map.

Rate limited to IGDB's 4 req/s. Callers (the lazy enricher) serialize through
here, so a simple monotonic-spacing limiter is enough.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import unicodedata
from datetime import datetime, timezone

import requests

from excel_game import ExcelGame, ExcelPlatform
from match_validator import MatchValidator

log = logging.getLogger("gamedex.igdb")

_TWITCH_AUTH = "https://id.twitch.tv/oauth2/token"
_IGDB = "https://api.igdb.com/v4"

# One request pulls all candidates with everything we display, nested inline.
_FIELDS = (
    "fields name,slug,url,category,summary,storyline,"
    "first_release_date,total_rating,total_rating_count,rating,rating_count,"
    "aggregated_rating,aggregated_rating_count,"
    "alternative_names.name,platforms.name,release_dates.y,"
    "genres.name,themes.name,game_modes.name,player_perspectives.name,"
    "keywords.name,game_engines.name,"
    "age_ratings.rating_category,age_ratings.organization,"
    "cover.image_id,screenshots.image_id,artworks.image_id,"
    "videos.video_id,videos.name,"
    "involved_companies.company.name,involved_companies.developer,"
    "involved_companies.publisher,"
    "franchises.name,franchise.name,"
    "similar_games.name,similar_games.slug,similar_games.url,"
    "similar_games.cover.image_id,"
    # Storefront ids — this is what lets the UI hand off to `steam://`.
    "external_games.external_game_source,external_games.uid,external_games.url;"
)

# The catalogue crawl (see catalogue.py) reads the whole games table rather than one title,
# so it asks for two much narrower field sets than _FIELDS. Pass 1 is every game and takes
# only flat columns — no nested expansion at all, which is what keeps a 370k-row sweep to a
# few hundred MB instead of a few GB. Pass 2 is the ~34k rated games and takes the nested
# tags the predicted-rating model actually reads.
_CATALOGUE_LEAN = (
    "fields id,name,slug,game_type,first_release_date,cover.image_id,"
    "total_rating,total_rating_count,rating,rating_count,"
    "aggregated_rating,aggregated_rating_count,updated_at,checksum,"
    # Which game this one is a version OF. Both fields, because IGDB picks between them
    # unpredictably — Divinity's Definitive Edition hangs off parent_game and its Divine
    # Edition off version_parent. Two ids, no nesting, so pass 1 stays flat and cheap; it
    # is what lets the browser stop offering you the base game of an edition you own.
    "parent_game,version_parent;"
)
_CATALOGUE_RICH = (
    "fields id,checksum,genres.name,themes.name,game_modes.name,"
    "player_perspectives.name,keywords.name,game_engines.name,"
    "involved_companies.company.name,involved_companies.developer,"
    "involved_companies.publisher,franchise.name,franchises.name;"
)

# Keywords that describe the SHOP or the PLUMBING, not the game. Drawn from a census of the
# actual library rather than guessed: unfiltered, the single most common keyword across 2,000
# games was "steam achievements", and after a first pass it was "digital distribution" (1,773).
# Neither tells you anything about a game. What's left underneath is the good stuff —
# metroidvania, female protagonist, multiple endings, bullet hell, cozy.
#
# Word boundaries matter here: `\bsteam\b` must not eat "steampunk", which is a real and
# useful tag. It doesn't, and the census confirms steampunk survives.
_KEYWORD_JUNK = re.compile(
    # storefronts and platform holders
    r"\b(steam|epic games?|gog|itch\.io|xbox|playstation|nintendo|origin|uplay)\b"
    r"|digital distribution|physical release|virtual console|game pass|prime gaming"
    r"|^available on|^previously on|^featured|deck verified"
    # store furniture
    r"|achievements?|leaderboards?|workshop|trading cards?|cloud sav|family sharing|families"
    r"|^demo$|free demo|playtest|early access|pre-?order|season pass|battle pass"
    r"|crowdfunding|kickstarter|nextfest|next fest"
    # hardware and middleware — how it was built or plugged in, not what it is
    r"|\bcontroller\b|dualsense|gamepad|remote play|vr support|cross-?platform"
    r"|bink video|scaleform|havok|speedtree|denuvo"
    # tags that only restate a field we already have, or are pure trivia
    r"|single-?player only|multiplayer only"
    r"|protagonist'?s name in the title|^sequel$|^prequel$",
    re.I,
)

# IGDB's external_game_source enum, read off live data rather than guessed —
# the docs are thin and three of our first guesses were wrong (15 is Google Play,
# not itch; 36 is PlayStation, not Epic). The field used to be called `category`;
# it was renamed, and querying the old name silently returns nothing.
_STORE_SOURCE = {
    1: "steam",         # store.steampowered.com/app/<appid>
    5: "gog",           # gog.com — uid is the numeric product id
    11: "xbox",         # xbox.com/games/store — uid is the MS product id
    13: "appstore",     # itunes.apple.com/app/id<appid>
    15: "googleplay",   # play.google.com — uid is the package name
    23: "amazon",       # play.amazon.com — Amazon Games / Luna
    26: "epic",         # store.epicgames.com
    30: "itch",         # <dev>.itch.io/<game>
    36: "playstation",  # store.playstation.com/concept/<id>
    54: "microsoft",    # microsoft.com/p/... — the other MS store id
}


def platform_from_str(value):
    if not value:
        return None
    try:
        return ExcelPlatform(value)
    except ValueError:
        return None


class RateLimiter:
    """Allow at most `rate` calls per second (monotonic spacing)."""

    def __init__(self, rate: int = 4):
        self._min_gap = 1.0 / rate
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self):
        with self._lock:
            now = time.monotonic()
            if now < self._next:
                time.sleep(self._next - now)
                now = time.monotonic()
            self._next = now + self._min_gap


class IgdbClient:
    def __init__(self, client_id: str, client_secret: str, user_agent="gamedex"):
        self._client_id = client_id
        self._client_secret = client_secret
        self._ua = user_agent
        self._token = None
        self._token_expiry = 0.0
        self._auth_lock = threading.Lock()
        self._limiter = RateLimiter(4)
        self._validator = MatchValidator()
        self._age_cache = None          # (organizations, categories), fetched once

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    # -- auth ---------------------------------------------------------------
    def _ensure_token(self):
        if self._token and time.time() < self._token_expiry - 60:
            return
        with self._auth_lock:
            if self._token and time.time() < self._token_expiry - 60:
                return
            resp = requests.post(
                _TWITCH_AUTH,
                params={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "client_credentials",
                },
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            self._token = data["access_token"]
            self._token_expiry = time.time() + int(data.get("expires_in", 3600))
            log.info("IGDB: obtained Twitch app token")

    def _post(self, route: str, body: str):
        self._ensure_token()
        self._limiter.wait()
        resp = requests.post(
            f"{_IGDB}/{route}",
            headers={
                "User-Agent": self._ua,
                "Client-ID": self._client_id,
                "Authorization": f"Bearer {self._token}",
            },
            data=body.encode("utf-8"),
            timeout=30,
        )
        if resp.status_code == 401:  # token rotated out early — refresh once
            self._token = None
            self._ensure_token()
            self._limiter.wait()
            resp = requests.post(
                f"{_IGDB}/{route}",
                headers={
                    "User-Agent": self._ua,
                    "Client-ID": self._client_id,
                    "Authorization": f"Bearer {self._token}",
                },
                data=body.encode("utf-8"),
                timeout=30,
            )
        resp.raise_for_status()
        return resp.json()

    # -- search + match -----------------------------------------------------
    def _search(self, title: str):
        processed = unicodedata.normalize(
            "NFKD",
            title.replace("ū", "uu").replace("ō", "ou").replace("Ō", "Ou").replace("Ū", "Uu"),
        ).replace('"', '\\"')
        body = f'search "{processed}"; {_FIELDS} limit 25;'
        return self._post("games", body)

    def match(self, title, platform=None, release_year=None,
              developer=None, publisher=None, franchise=None):
        """Return (enrichment_dict, score) for the best acceptable candidate, or
        (None, 0) when nothing clears the confidence bar (blank-on-low-confidence)."""
        game = ExcelGame(
            title=title,
            platform=platform_from_str(platform),
            release_year=release_year,
            developer=developer,
            publisher=publisher,
            franchise=franchise,
        )
        candidates = self._search(title) or []
        best = None
        best_info = None
        for c in candidates:
            names = [c.get("name")] + [a["name"] for a in c.get("alternative_names", []) if a.get("name")]
            plat_names = [p["name"] for p in c.get("platforms", []) if p.get("name")]
            years = [rd["y"] for rd in c.get("release_dates", []) if rd.get("y")]
            if not years and c.get("first_release_date"):
                years = [datetime.fromtimestamp(c["first_release_date"], tz=timezone.utc).year]
            devs, pubs = [], []
            for ic in c.get("involved_companies", []):
                nm = (ic.get("company") or {}).get("name")
                if not nm:
                    continue
                if ic.get("developer"):
                    devs.append(nm)
                if ic.get("publisher"):
                    pubs.append(nm)
            frans = [f["name"] for f in c.get("franchises", []) if f.get("name")]
            if c.get("franchise", {}).get("name"):
                frans.append(c["franchise"]["name"])

            info = self._validator.validate(game, names, plat_names, years, pubs, devs, frans)
            # Accept only a confident match: title+platform agree, or an exact
            # title match when the candidate lists no platforms.
            accept = info.likely_match or (info.matched and not any(plat_names))
            if not accept:
                continue
            if best is None or info.match_score > best_info.match_score:
                best, best_info = c, info

        if best is None:
            return None, 0
        return self._to_enrichment(best, best_info), best_info.match_score

    # IGDB's game_type enum — what KIND of thing this entry is.
    GAME_TYPES = {
        0: "Main game", 1: "DLC", 2: "Expansion", 3: "Bundle",
        4: "Standalone expansion", 5: "Mod", 6: "Episode", 7: "Season",
        8: "Remake", 9: "Remaster", 10: "Expanded edition", 11: "Port",
        12: "Fork", 13: "Pack", 14: "Update",
    }

    _REL_FIELDS = (
        "fields id,game_type,version_title,"
        "parent_game.id,parent_game.name,parent_game.cover.image_id,"
        "version_parent.id,version_parent.name,version_parent.cover.image_id,"
        "dlcs.id,dlcs.name,dlcs.cover.image_id,"
        "expansions.id,expansions.name,expansions.cover.image_id,"
        "standalone_expansions.id,standalone_expansions.name,standalone_expansions.cover.image_id,"
        "expanded_games.id,expanded_games.name,expanded_games.cover.image_id,"
        "remakes.id,remakes.name,remakes.cover.image_id,"
        "remasters.id,remasters.name,remasters.cover.image_id,"
        "ports.id,ports.name,ports.cover.image_id,"
        "forks.id,forks.name,forks.cover.image_id,"
        "bundles.id,bundles.name,bundles.cover.image_id,"
        "collections.id,collections.name;"
    )

    _EPISODE, _SEASON, _BUNDLE = 6, 7, 3

    def relations_for(self, igdb_ids):
        """{igdb_id: relations} — the graph IGDB keeps and a spreadsheet can't.

        Fetched by id in batches of 500, like stores_for: asking for all of this
        on every *search* would bloat 25 results per query, and we only need it
        once per game.

        Two of the relationships have NO forward field and only exist as reverse
        links, so they need their own passes:
          episodes/seasons — an episode points UP via parent_game; the parent lists
            nothing. (Tales of Monkey Island is a plain Main game; its five chapters
            each have parent_game = it.)
          bundle contents  — a game in a bundle points UP via bundles; the bundle
            lists nothing.
        """
        out = {}
        for i in range(0, len(igdb_ids), 500):
            chunk = [int(x) for x in igdb_ids[i:i + 500]]
            body = f"{self._REL_FIELDS} where id = ({','.join(str(c) for c in chunk)}); limit 500;"
            for g in self._post("games", body) or []:
                rel = self._relations(g)
                if rel:
                    out[g["id"]] = rel

        ids = [int(x) for x in igdb_ids]
        self._add_episodes(out, ids)
        self._add_bundle_contents(out, ids)
        return out

    def _add_episodes(self, out, ids):
        """Attach episodes/seasons — the children that point up via parent_game."""
        for i in range(0, len(ids), 400):
            chunk = ids[i:i + 400]
            offset = 0
            while True:
                body = (
                    "fields id,name,game_type,parent_game,cover.image_id; "
                    f"where parent_game = ({','.join(str(c) for c in chunk)}) "
                    f"& game_type = ({self._EPISODE},{self._SEASON}); "
                    f"limit 500; offset {offset}; sort id asc;"
                )
                got = self._post("games", body) or []
                for g in got:
                    pid = g.get("parent_game")
                    if pid is None:
                        continue
                    rel = out.setdefault(pid, {"gameType": None, "gameTypeLabel": None})
                    key = "episodes" if g.get("game_type") == self._EPISODE else "seasons"
                    rel.setdefault(key, []).append(self._one(g))
                if len(got) < 500:
                    break
                offset += 500

    def _add_bundle_contents(self, out, ids):
        """Attach a bundle's contents — the games that point up via `bundles`."""
        bundles = {gid for gid, rel in out.items()
                   if rel.get("gameType") == self._BUNDLE and gid in set(ids)}
        bl = list(bundles)
        for i in range(0, len(bl), 400):
            chunk = bl[i:i + 400]
            offset = 0
            while True:
                body = (
                    "fields id,name,game_type,bundles,cover.image_id; "
                    f"where bundles = ({','.join(str(c) for c in chunk)}); "
                    f"limit 500; offset {offset}; sort id asc;"
                )
                got = self._post("games", body) or []
                for g in got:
                    for b in (g.get("bundles") or []):
                        if b in bundles:
                            out[b].setdefault("bundleContents", []).append(self._one(g))
                if len(got) < 500:
                    break
                offset += 500

    @staticmethod
    def _one(x):
        if not x:
            return None
        return {"id": x.get("id"), "name": x.get("name"),
                "cover": (x.get("cover") or {}).get("image_id")}

    @classmethod
    def _relations(cls, g):
        one = cls._one

        def many(key):
            return [one(x) for x in (g.get(key) or []) if x.get("name")]

        rel = {
            "gameType": g.get("game_type"),
            "gameTypeLabel": cls.GAME_TYPES.get(g.get("game_type")),
            "versionTitle": g.get("version_title"),
            "parent": one(g.get("parent_game")),
            "versionParent": one(g.get("version_parent")),
            "dlcs": many("dlcs"),
            "expansions": many("expansions"),
            "standaloneExpansions": many("standalone_expansions"),
            "expandedGames": many("expanded_games"),
            "remakes": many("remakes"),
            "remasters": many("remasters"),
            "ports": many("ports"),
            "forks": many("forks"),
            "bundles": many("bundles"),
            "collections": [c.get("name") for c in (g.get("collections") or []) if c.get("name")],
        }
        # Nothing but a game_type isn't a relationship worth storing.
        has_any = any(rel[k] for k in rel if k not in ("gameType", "gameTypeLabel"))
        return rel if has_any or rel["gameType"] else None

    def stores_for(self, igdb_ids):
        """{igdb_id: {'steam': '620', …}} for a batch of ids.

        Used to backfill storefront ids onto records matched before we started
        asking for them. Fetching by id lets us do 500 games per request instead
        of one search each — the whole 14.5k library is ~30 calls.
        """
        out = {}
        for i in range(0, len(igdb_ids), 500):
            chunk = [int(x) for x in igdb_ids[i:i + 500]]
            # .url matters: for Epic and itch there's no way to build a link from
            # the id alone, so a record backfilled without it has no button at all.
            body = ("fields id,external_games.external_game_source,external_games.uid,"
                    "external_games.url; "
                    f"where id = ({','.join(str(c) for c in chunk)}); limit 500;")
            for g in self._post("games", body) or []:
                st = self._stores(g.get("external_games") or [])
                if st:
                    out[g["id"]] = st
        return out

    def fetch_by_slug(self, slug: str):
        """Fetch a single game by its IGDB URL slug (for manual overrides)."""
        safe = slug.replace('"', "")
        res = self._post("games", f'{_FIELDS} where slug = "{safe}"; limit 1;')
        return res[0] if res else None

    def games_light(self, igdb_ids) -> dict:
        """{igdb_id: {cover, video, year, release, platforms, genres, summary, …}}
        for a batch of ids — the light card fields (cover, a trailer to autoplay,
        the release date, the platforms) without a full detail fetch each, PLUS
        the fields the taste model's catalogue scope regresses on: the tag arrays
        (themes/modes/perspectives/keywords/engines), the companies and
        franchises, and IGDB's two outside opinions with their vote counts.

        That predict subset is why a wishlist card can carry a Predicted score
        that varies by game: a wishlisted game isn't on the sheet, so its only
        features are the ones IGDB knows — exactly what `predict.js`'s `igdb`
        scope is fitted on. Ratings are divided by 100 to the 0-1 scale the model
        (and the catalogue) uses; everything else mirrors enrichment_from_result."""
        ids = [int(i) for i in igdb_ids if str(i).strip().isdigit()]
        out: dict = {}
        for i in range(0, len(ids), 400):
            chunk = ids[i:i + 400]
            try:
                rows = self._post(
                    "games",
                    "fields id,name,cover.image_id,first_release_date,"
                    "videos.video_id,platforms.name,summary,"
                    "genres.name,themes.name,game_modes.name,player_perspectives.name,"
                    "keywords.name,game_engines.name,franchises.name,franchise.name,"
                    "involved_companies.company.name,involved_companies.developer,"
                    "involved_companies.publisher,"
                    "aggregated_rating,aggregated_rating_count,rating,rating_count;"
                    f" where id = ({','.join(map(str, chunk))}); limit {len(chunk)};")
            except Exception as exc:
                log.debug("games_light chunk failed: %s", exc)
                continue
            for g in rows:
                gid = g.get("id")
                if not gid:
                    continue
                rel = g.get("first_release_date")
                iso = year = None
                if rel:
                    from datetime import datetime, timezone
                    dt = datetime.fromtimestamp(rel, timezone.utc)
                    iso, year = dt.strftime("%Y-%m-%d"), dt.year
                vids = g.get("videos") or []
                devs, pubs = [], []
                for ic in g.get("involved_companies") or []:
                    nm = (ic.get("company") or {}).get("name")
                    if not nm:
                        continue
                    if ic.get("developer"):
                        devs.append(nm)
                    if ic.get("publisher"):
                        pubs.append(nm)
                crit, usr = g.get("aggregated_rating"), g.get("rating")
                out[gid] = {
                    "name": g.get("name"),
                    "cover": (g.get("cover") or {}).get("image_id"),
                    "video": (vids[0].get("video_id") if vids else None),
                    "year": year, "release": iso,
                    "platforms": [p.get("name") for p in (g.get("platforms") or []) if p.get("name")],
                    "genres": [x.get("name") for x in (g.get("genres") or []) if x.get("name")],
                    "themes": [x.get("name") for x in (g.get("themes") or []) if x.get("name")],
                    "gameModes": [x.get("name") for x in (g.get("game_modes") or []) if x.get("name")],
                    "perspectives": [x.get("name") for x in (g.get("player_perspectives") or []) if x.get("name")],
                    "keywords": self._keywords_of(g),
                    "engines": self._engines_of(g),
                    "developers": sorted(set(devs)),
                    "publishers": sorted(set(pubs)),
                    "franchises": self._franchises_of(g),
                    "criticRating": round(crit / 100, 4) if crit is not None else None,
                    "criticCount": g.get("aggregated_rating_count"),
                    "userRating": round(usr / 100, 4) if usr is not None else None,
                    "userRatingCount": g.get("rating_count"),
                    "summary": g.get("summary"),
                }
            # IGDB's own time-to-beat aggregate — a separate endpoint keyed by
            # game_id. It's the same species of data as HowLongToBeat (aggregate
            # player completion times, in seconds), so it feeds the same
            # hltbMain/hltbBest fields the rest of the app reads — letting a
            # wishlisted game, which has no sheet row and so no scraped HLTB, still
            # carry an Estimated Time to sort on. Matches hltb.py's hour rounding.
            try:
                ttb = self._post(
                    "game_time_to_beats",
                    "fields game_id,normally,completely;"
                    f" where game_id = ({','.join(map(str, chunk))}); limit {len(chunk)};")
            except Exception as exc:
                log.debug("games_light ttb chunk failed: %s", exc)
                ttb = []
            for t in ttb or []:
                rec = out.get(t.get("game_id"))
                if not rec:
                    continue
                normally, completely = t.get("normally"), t.get("completely")
                main = round(normally / 3600, 2) if normally else None
                rec["hltbMain"] = main
                # Main-story preferred, mirroring hltb.py's `best = main or …`.
                rec["hltbBest"] = main or (round(completely / 3600, 2) if completely else None)
        return out

    def detail_by_id(self, igdb_id) -> dict | None:
        """The full enrichment record for a bare IGDB id — how a wishlisted game
        we don't own (so it has no match-key record) gets a real drawer:
        summary, screenshots, tags, similar games."""
        try:
            iid = int(igdb_id)
        except (TypeError, ValueError):
            return None
        res = self._post("games", f"{_FIELDS} where id = {iid}; limit 1;")
        return self.enrichment_from_result(res[0]) if res else None

    def override_from_url(self, title, url):
        """Manual mapping: build an enrichment record from a pasted IGDB URL."""
        m = re.search(r"/games/([^/?#]+)", url)
        if not m:
            return None
        result = self.fetch_by_slug(m.group(1))
        return self.enrichment_from_result(result) if result else None

    # external_game_source ids (mirror of _STORE_SOURCE): 1 steam, 36 playstation,
    # 11 xbox, 5 gog, 26 epic. The authoritative appid -> IGDB join.
    _EXT_SOURCE = {"steam": 1, "playstation": 36, "xbox": 11, "gog": 5, "epic": 26}

    def game_by_store_id(self, store: str, app_id: str) -> dict | None:
        """The IGDB game a storefront id points at — {igdbId, name, cover, year}.
        This is exact where a title match only guesses: a Steam wishlist entry
        carries its appid, and external_games maps it straight to the game."""
        src = self._EXT_SOURCE.get(store)
        if src is None or not app_id:
            return None
        try:
            rows = self._post(
                "external_games",
                f'fields game.id,game.name,game.cover.image_id,'
                f'game.first_release_date; '
                f'where uid = "{app_id}" & external_game_source = {src}; limit 5;')
        except Exception as exc:
            log.debug("external_games %s/%s: %s", store, app_id, exc)
            return None
        for r in rows:
            g = r.get("game") or {}
            if g.get("id"):
                yr = None
                if g.get("first_release_date"):
                    from datetime import datetime, timezone
                    yr = datetime.fromtimestamp(g["first_release_date"], timezone.utc).year
                return {"igdbId": g["id"], "name": g.get("name"),
                        "cover": (g.get("cover") or {}).get("image_id"), "year": yr}
        return None

    def _to_enrichment(self, c, info):
        e = self.enrichment_from_result(c)
        e["confidence"] = info.match_score
        return e

    @staticmethod
    def _franchises_of(c):
        """A game's franchises, as names. IGDB splits these across `franchise` (the
        primary one) and `franchises` (all of them), and either can be absent — merge
        both and de-dup while preserving order (primary first)."""
        out = []
        main = (c.get("franchise") or {}).get("name")
        if main:
            out.append(main)
        for f in c.get("franchises") or []:
            nm = f.get("name")
            if nm and nm not in out:
                out.append(nm)
        return out

    def critic_for(self, igdb_ids):
        """{igdb_id: {criticRating, criticCount, userRating, userRatingCount}} — the two
        outside opinions, fetched by id to backfill records matched before we stored them.

        `rating` (what IGDB's players think) rides along with `aggregated_rating` (what the
        critics think) because it is the same query, by the same ids, in the same batches
        of 500 — asking for one and not the other costs an identical ~30 calls and leaves
        the field null forever. It WAS null forever: userRating has been in the record
        shape, in the light map and read by predict.js since it was added, and it was
        populated on 1.2% of the library, because only games matched AFTER the field was
        added ever got one and nothing ever went back for the rest. IGDB has a player
        score for 61% of this library.

        Chunks are resilient and paced, which they were not, and it mattered the moment
        this pass had real work to do: bumping CRITIC_VERSION gave it 13,892 games to fetch
        at boot, it went out at the full 4 req/s alongside six other backfill threads and
        the live enrichment workers, and IGDB answered 429 EIGHT SECONDS IN. On a bare
        _post that exception unwound the whole pass, the caller logged a warning and gave
        up, and the field stayed null until someone redeployed — which would have failed
        the same way. This is the identical lesson extras_for() records above it; it just
        hadn't bitten here yet, because at version 1 there was nothing left to fetch and
        the pass returned before making a single request.
        """
        out = {}
        for i in range(0, len(igdb_ids), 500):
            chunk = [int(x) for x in igdb_ids[i:i + 500]]
            body = ("fields id,aggregated_rating,aggregated_rating_count,rating,rating_count; "
                    f"where id = ({','.join(str(c) for c in chunk)}); limit 500;")
            try:
                got = self._post_resilient("games", body)
            except Exception as exc:
                # One chunk of 500 is not worth the other 13,000. Skip it; the next run
                # picks it up, because a record with no userRating key is still "needed".
                log.warning("critic backfill: chunk at %d failed, skipping: %s", i, exc)
                continue
            for g in got or []:
                a, u = g.get("aggregated_rating"), g.get("rating")
                out[g["id"]] = {
                    "criticRating": round(a / 100, 4) if a is not None else None,
                    "criticCount": g.get("aggregated_rating_count"),
                    "userRating": round(u / 100, 4) if u is not None else None,
                    "userRatingCount": g.get("rating_count"),
                }
            time.sleep(0.35)                      # be a good neighbour to the live workers
        return out

    def franchises_for(self, igdb_ids):
        """{igdb_id: [franchise names]} — fetched by id in batches, to backfill records
        matched before franchises were stored. Mirrors relations_for."""
        out = {}
        for i in range(0, len(igdb_ids), 500):
            chunk = [int(x) for x in igdb_ids[i:i + 500]]
            body = ("fields id,franchise.name,franchises.name; "
                    f"where id = ({','.join(str(c) for c in chunk)}); limit 500;")
            for g in self._post("games", body) or []:
                out[g["id"]] = self._franchises_of(g)
        return out

    @staticmethod
    def _keywords_of(c):
        """IGDB keywords, minus the shop fittings.

        Half of the most common keywords in this library describe the STOREFRONT, not the
        game: "steam achievements" (144), "steam cloud" (120), "steam families" (120),
        "controller support" (100), "xbox controller support for pc", "steam trading cards",
        "previously on - prime gaming". As a facet those are noise — they cut the library by
        which shop sold it. Underneath them the keywords are the richest vocabulary IGDB has:
        metroidvania, soulslike, bullet hell, cozy, story rich, female protagonist,
        multiple endings. Keep those; drop the plumbing.

        This is the same lesson as the IGN genres: an unfiltered third-party vocabulary is
        mostly the third party talking about itself."""
        out = []
        for k in c.get("keywords") or []:
            nm = (k.get("name") or "").strip()
            if not nm or _KEYWORD_JUNK.search(nm):
                continue
            out.append(nm)
            if len(out) >= 14:          # a long tail of one-offs bloats every payload
                break
        return out

    @staticmethod
    def _engines_of(c):
        return [e["name"] for e in (c.get("game_engines") or []) if e.get("name")][:3]

    def _age_of(self, c):
        """The game's age rating, as "ESRB M" / "PEGI 18".

        IGDB hands back two enum ids (organization 1, rating_category 3) and nothing else,
        so resolve them against the enum tables rather than hardcoding — the categories have
        been renumbered before, and a wrong guess would silently mislabel every game."""
        ratings = c.get("age_ratings") or []
        if not ratings:
            return None
        orgs, cats = self._age_tables()
        best = None
        for r in ratings:
            org = orgs.get(r.get("organization"))
            cat = cats.get(r.get("rating_category"))
            if not org or not cat:
                continue
            label = f"{org} {cat}"
            if org == "ESRB":                     # the one I actually read; prefer it
                return label
            if best is None or org == "PEGI":
                best = label
        return best

    def _age_tables(self):
        """(organizations, categories) id -> name. Fetched once, then cached."""
        if self._age_cache is None:
            orgs, cats = {}, {}
            try:
                for r in self._post("age_rating_organizations", "fields id,name; limit 50;") or []:
                    orgs[r["id"]] = r.get("name")
                for r in self._post("age_rating_categories", "fields id,rating; limit 100;") or []:
                    cats[r["id"]] = r.get("rating")
            except Exception as exc:
                log.warning("igdb: age-rating tables unavailable: %s", exc)
            self._age_cache = (orgs, cats)
        return self._age_cache

    def extras_for(self, igdb_ids, on_chunk=None):
        """{igdb_id: {keywords, engines, ageRating, perspectives}} — batched by id, to
        backfill records matched before these fields were asked for.

        Retries each chunk with backoff and never lets one failure kill the pass. The first
        attempt at this walked the whole library in one go and IGDB answered 429 four seconds
        in — the rate limiter is shared with five other backfill threads and the live
        enrichment workers, so a burst of big queries tips it over. Chunks are smaller now,
        and a chunk that keeps failing is skipped rather than taking the other 13,000 with it.

        `on_chunk` is handed each batch as it lands, so the caller can write results away as
        they arrive instead of holding the whole library in memory and losing it all on a
        crash halfway through."""
        out = {}
        for i in range(0, len(igdb_ids), 200):
            chunk = [int(x) for x in igdb_ids[i:i + 200]]
            body = ("fields id,keywords.name,game_engines.name,player_perspectives.name,"
                    "age_ratings.rating_category,age_ratings.organization; "
                    f"where id = ({','.join(str(c) for c in chunk)}); limit 500;")
            got = None
            for attempt in range(5):
                try:
                    got = self._post("games", body) or []
                    break
                except requests.HTTPError as exc:
                    code = exc.response.status_code if exc.response is not None else 0
                    if code not in (429, 500, 502, 503):
                        log.warning("igdb extras: chunk failed hard (%s), skipping", code)
                        break
                    time.sleep(2 ** attempt)          # 1s, 2s, 4s, 8s, 16s
                except Exception as exc:
                    log.warning("igdb extras: %s", exc)
                    time.sleep(2 ** attempt)
            if got is None:
                continue
            batch = {}
            for g in got:
                batch[g["id"]] = {
                    "keywords": self._keywords_of(g),
                    "engines": self._engines_of(g),
                    "ageRating": self._age_of(g),
                    "perspectives": [p["name"] for p in g.get("player_perspectives", []) if p.get("name")],
                }
            out.update(batch)
            if on_chunk:
                on_chunk(batch, chunk)
            time.sleep(0.35)                          # be a good neighbour to the live workers
        return out

    # -- catalogue crawl ----------------------------------------------------
    def _post_resilient(self, route, body, tries=5):
        """_post with backoff on the codes that mean "later", not "never".

        The catalogue crawl is ~800 requests sharing a rate limiter with six backfill
        threads and the live enrichment workers, so a 429 mid-sweep is a matter of when.
        Mirrors extras_for()'s retry, which exists because the first version of that pass
        walked the library in one go and IGDB answered 429 four seconds in.
        """
        for attempt in range(tries):
            try:
                return self._post(route, body)
            except requests.HTTPError as exc:
                code = exc.response.status_code if exc.response is not None else 0
                if code not in (429, 500, 502, 503):
                    raise
                time.sleep(2 ** attempt)          # 1s, 2s, 4s, 8s, 16s
            except requests.RequestException:
                time.sleep(2 ** attempt)
        raise RuntimeError(f"igdb: {route} failed after {tries} tries")

    def count(self, where: str = "") -> int:
        """How many games match — one request, and the only honest way to size a crawl."""
        return int((self._post("games/count", f"where {where};" if where else "") or {}).get("count", 0))

    def catalogue_page(self, after_id: int = 0, limit: int = 500):
        """One keyset page of the whole games table: `where id > N; sort id asc`.

        Ids are not contiguous — there are gaps everywhere — so `after_id` is a cursor,
        never a progress bar.
        """
        body = f"{_CATALOGUE_LEAN} where id > {int(after_id)}; sort id asc; limit {int(limit)};"
        return self._post_resilient("games", body) or []

    def catalogue_updated(self, since: int, offset: int = 0, limit: int = 500):
        """One page of everything IGDB has touched since `since`.

        Offset, not keyset, because `updated_at` is not unique and cannot be a cursor.
        That is safe only because the result set is a day of churn rather than the whole
        table — catalogue.py falls back to a full crawl if it ever isn't.
        """
        body = (f"{_CATALOGUE_LEAN} where updated_at >= {int(since)}; "
                f"sort updated_at asc; limit {int(limit)}; offset {int(offset)};")
        return self._post_resilient("games", body) or []

    def catalogue_rich(self, igdb_ids, stop=None):
        """Yield {igdb_id: {"rich": {...}, "checksum": str}} in batches.

        A generator, so the caller writes each batch away as it lands instead of holding
        34k records in memory and losing the lot to a crash halfway through — the same
        reason extras_for() grew its on_chunk callback.
        """
        for i in range(0, len(igdb_ids), 200):
            if stop is not None and stop.is_set():
                return
            chunk = [int(x) for x in igdb_ids[i:i + 200]]
            body = f"{_CATALOGUE_RICH} where id = ({','.join(str(c) for c in chunk)}); limit 500;"
            batch = {}
            for g in self._post_resilient("games", body) or []:
                batch[g["id"]] = {"rich": self._catalogue_rich_of(g), "checksum": g.get("checksum")}
            if batch:
                yield batch
            time.sleep(0.35)                      # be a good neighbour to the live workers

    def _catalogue_rich_of(self, c):
        """The tag fields, in the same shape and vocabulary as an enrichment record.

        Same shape on purpose: the browser's predicted-rating model reads `genres` /
        `themes` / `developers` / … off a sheet game's enrichment record, and it has to
        read the identical keys off a catalogue game or it would be scoring the two
        against different vocabularies and calling the result comparable.
        """
        devs, pubs = [], []
        for ic in c.get("involved_companies", []):
            nm = (ic.get("company") or {}).get("name")
            if not nm:
                continue
            if ic.get("developer"):
                devs.append(nm)
            if ic.get("publisher"):
                pubs.append(nm)
        return {
            "genres": [g["name"] for g in c.get("genres", []) if g.get("name")],
            "themes": [t["name"] for t in c.get("themes", []) if t.get("name")],
            "gameModes": [m["name"] for m in c.get("game_modes", []) if m.get("name")],
            "perspectives": [p["name"] for p in c.get("player_perspectives", []) if p.get("name")],
            "keywords": self._keywords_of(c),
            "engines": self._engines_of(c),
            "developers": sorted(set(devs)),
            "publishers": sorted(set(pubs)),
            "franchises": self._franchises_of(c),
        }

    def enrichment_from_result(self, c):
        devs, pubs = [], []
        for ic in c.get("involved_companies", []):
            nm = (ic.get("company") or {}).get("name")
            if not nm:
                continue
            if ic.get("developer"):
                devs.append(nm)
            if ic.get("publisher"):
                pubs.append(nm)
        year = None
        if c.get("first_release_date"):
            year = datetime.fromtimestamp(c["first_release_date"], tz=timezone.utc).year
        rating = c.get("total_rating")
        user_rating = c.get("rating")            # IGDB community/user rating
        # aggregated_rating is the EXTERNAL CRITIC aggregate — the one thing here that is
        # a critic score rather than a player score. We already asked for it and threw it
        # away; it is the best fallback for a game Metacritic never covered.
        critic = c.get("aggregated_rating")
        return {
            "igdbId": c.get("id"),
            "name": c.get("name"),
            "url": c.get("url"),
            "cover": (c.get("cover") or {}).get("image_id"),
            "summary": c.get("summary"),
            "storyline": c.get("storyline"),
            "rating": round(rating / 100, 4) if rating is not None else None,
            "ratingCount": c.get("total_rating_count"),
            "userRating": round(user_rating / 100, 4) if user_rating is not None else None,
            "userRatingCount": c.get("rating_count"),
            "criticRating": round(critic / 100, 4) if critic is not None else None,
            "criticCount": c.get("aggregated_rating_count"),
            "year": year,
            "genres": [g["name"] for g in c.get("genres", []) if g.get("name")],
            "themes": [t["name"] for t in c.get("themes", []) if t.get("name")],
            "gameModes": [m["name"] for m in c.get("game_modes", []) if m.get("name")],
            "perspectives": [p["name"] for p in c.get("player_perspectives", []) if p.get("name")],
            "keywords": self._keywords_of(c),
            "engines": self._engines_of(c),
            "ageRating": self._age_of(c),
            "developers": sorted(set(devs)),
            "publishers": sorted(set(pubs)),
            "franchises": self._franchises_of(c),
            "screenshots": [s["image_id"] for s in c.get("screenshots", []) if s.get("image_id")][:12],
            "artworks": [a["image_id"] for a in c.get("artworks", []) if a.get("image_id")][:6],
            "videos": [{"id": v["video_id"], "name": v.get("name")} for v in c.get("videos", []) if v.get("video_id")][:4],
            "similar": [
                {"name": s.get("name"), "url": s.get("url"),
                 "cover": (s.get("cover") or {}).get("image_id")}
                for s in c.get("similar_games", []) if s.get("name")
            ][:12],
            "stores": self._stores(c.get("external_games") or []),
            "confidence": None,
        }

    @staticmethod
    def _stores(external):
        """{'steam': {'id': '620', 'url': '…'}, …}

        The id is what a launch URI needs; the url is what we fall back to when a
        storefront has no launch scheme (most of them).
        """
        out = {}
        for e in external:
            name = _STORE_SOURCE.get(e.get("external_game_source"))
            uid = e.get("uid")
            if not name or not uid or name in out:
                continue
            out[name] = {"id": str(uid), "url": e.get("url") or None}
        return out
