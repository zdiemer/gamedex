"""KHInsider — the game's soundtrack, and a player for it.

The thing no metadata API carries: the actual music. downloads.khinsider.com has a
scanned-in album for a huge share of games ever released — original sound versions,
gamerips, arrangements, remixes — free and streamable. We match a game to its best
album, list the tracks, and let the drawer play them.

Being sure it is the RIGHT album is the job, same as manuals.py. A game has many
albums (Chrono Trigger alone has ~190 search hits — arrangements, remixes, fan
remasters), so:

  - run every candidate through MatchValidator on title (+ platform, + year), exactly
    like every other source, so "Chrono Cross" can't win for "Chrono Trigger"
  - among the survivors, PREFER the type that is actually the game's music: an official
    Soundtrack over a Gamerip over an Arrangement over a Remix. A fan remix is a real
    match on title but the wrong thing to open first.
  - keep the losers as `alternates` so the drawer can offer "other releases" without a
    second search.

Cloudflare 403s a normal fetch; curl_cffi with impersonate="chrome" matches a real
browser TLS fingerprint and gets through — the same trick guides.py uses for
StrategyWiki. The CDN (vgmtreasurechest.com) serves the mp3s with range support and no
Referer check, so the drawer's <audio> streams and seeks straight off it; the only thing
one request can't get is the per-track mp3 URL, which lives one song-page deep and is
resolved lazily (see resolve_audio) only for tracks actually played.
"""

from __future__ import annotations

import html
import logging
import re
import urllib.parse

from curl_cffi import requests as curl_requests

from excel_game import ExcelGame
from igdb import platform_from_str
from ratelimiter import RateLimiter
from match_validator import MatchValidator

log = logging.getLogger("gamedex.khinsider")

_BASE = "https://downloads.khinsider.com"
_SEARCH = _BASE + "/search"
_ALBUM = _BASE + "/game-soundtracks/album/{}"
# KHInsider 403s a bot-shaped fetch even on plain pages; send a browser UA and, crucially,
# a browser TLS fingerprint via impersonate= — the block is on the handshake, not the UA.
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

# The album's music, best first. An official sound version is the game's score as shipped;
# a gamerip is the same music pulled from the ROM; an arrangement/remix is someone else's
# take. When two albums both match the title, this decides which one opens.
_TYPE_RANK = {"soundtrack": 0, "gamerip": 1, "arrangement": 2,
              "single": 3, "remix": 4, "inspired by": 5}

# The packaging words an album title wraps a game name in — "Chrono Trigger Original Sound
# Version", "Zelda Original Soundtrack", "... Game Music". Stripped ONLY to decide whether an
# album's title is exactly the game's: with them gone, the official OST reads as an exact
# match and outranks "Chrono Trigger: Resurrection - Premium OST", which still carries a real
# subtitle after the strip and so is never treated as exact. NB: nothing here strips
# "remix"/"arrangement"/"remake" — those ARE different things and must stay visible to the rank.
_FURNITURE = re.compile(
    r"\b(original\s+sound(?:\s*track|\s*version)?|original\s+game\s+soundtrack|"
    r"arranged\s+soundtrack|complete\s+soundtrack|full\s+soundtrack|soundtrack|"
    r"original\s+version|game\s+music|ost|osv|bgm|vocal\s+collection|"
    r"the\s+definitive\s+soundtrack)\b", re.I)
_REGION_PAREN = re.compile(r"\((?:usa|us|eu|europe|jp|japan|pal|ntsc|world|disc\s*\d+)[^)]*\)", re.I)


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _strip_furniture(name: str) -> str:
    s = _REGION_PAREN.sub(" ", name or "")
    s = _FURNITURE.sub(" ", s)
    s = re.sub(r"\(\s*\)", " ", s)
    return re.sub(r"\s+", " ", s).strip(" -–—:_")


class KhinsiderClient:
    """Interface matches the other secondary sources in enrich.py."""

    def __init__(self, validator: MatchValidator = None):
        self._v = validator or MatchValidator()
        self._limiter = RateLimiter(2)          # KHInsider is a free service; be gentle

    @property
    def configured(self) -> bool:
        return True

    def _get(self, url, params=None):
        self._limiter.wait()
        r = curl_requests.get(url, params=params, headers={"User-Agent": _UA},
                              timeout=25, impersonate="chrome")
        r.raise_for_status()
        return r.text

    # -- search -------------------------------------------------------------
    def _candidates(self, title: str) -> list[dict]:
        """Every album the search returns, as {slug,name,platforms,type,year,url,cover}.
        Unfiltered — the caller runs them through MatchValidator."""
        text = self._get(_SEARCH, {"search": title})
        out = []
        for row in re.findall(r'<td class="albumIcon">.*?</tr>', text, re.S):
            slug = re.search(r'/game-soundtracks/album/([^"\']+)"', row)
            if not slug:
                continue
            cells = [_clean(re.sub(r"<[^>]+>", " ", c))
                     for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            # cells: [icon, album, platforms, type, year] — strip a trailing catalogue
            # CODE ("Arc Impulse [AKCD-0001]") but NOT a worded descriptor ("[Piano Cover
            # Album]"), which is part of what the album is and must keep it from reading as
            # the game's exact title.
            name = re.sub(r"\s*\[[A-Z0-9][A-Z0-9.\-]*\]\s*$", "", cells[1]) if len(cells) > 1 else ""
            thumb = re.search(r'<img src="([^"]+)"', row)
            out.append({
                "slug": urllib.parse.unquote(slug.group(1)),
                "name": name,
                "platforms": [p.strip() for p in (cells[2].split(",") if len(cells) > 2 else []) if p.strip()],
                "type": cells[3] if len(cells) > 3 else "",
                "year": cells[4] if len(cells) > 4 else "",
                "url": _ALBUM.format(slug.group(1)),
                "cover": thumb.group(1) if thumb else None,
            })
        return out

    def match_meta(self, meta: dict):
        return self.match(meta.get("title"), meta.get("platform"), meta.get("year"))

    def match(self, title: str, platform=None, year=None):
        if not title:
            return None
        game = ExcelGame(title=title, platform=platform_from_str(platform), release_year=year)
        try:
            cands = self._candidates(title)
        except Exception as exc:
            log.warning("khinsider: search failed for %r: %s", title, exc)
            return None

        want_plat = (platform or "").lower()
        want = _norm(title)
        matched = []
        for c in cands:
            years = [int(c["year"])] if re.fullmatch(r"\d{4}", c["year"] or "") else []
            # Validate on the stripped title too, so "Chrono Trigger Original Sound Version"
            # reads as "Chrono Trigger" instead of being rejected as a different game.
            stripped = _strip_furniture(c["name"])
            if not self._v.validate(game, [c["name"], stripped], [], years, [], [], []).matched:
                continue
            # ACCEPTANCE GATE — the whole ballgame, and the same lesson manuals.py learned:
            # a weak match here isn't a wrong number, it's the WRONG GAME's music presented as
            # this game's. KHInsider is thick with derivatives that validate on title — fan
            # tributes ("A Melancholy Tribute to FFVII"), mods ("UNDERTALE: Halloween Hack"),
            # covers, remixes — and many big OSTs have been DMCA'd off it entirely, so the
            # search's best hit for such a game is one of those derivatives. So we require the
            # album, once its soundtrack packaging is stripped, to BE the game — its exact
            # title, or an initial shortening of it ("Xenoblade" for "Xenoblade Chronicles").
            # A title that ADDS words past the game's name ("Undertale Yellow", "... Halloween
            # Hack") is a different work and is dropped. When nothing clears this, we show no
            # soundtrack rather than the wrong one; the admin can still paste the right album.
            nstrip = _norm(stripped)
            if not (nstrip and want.startswith(nstrip)):
                continue
            exact = nstrip == want
            plat_hit = any(want_plat and want_plat in p.lower() for p in c["platforms"])
            yr_gap = abs(int(c["year"]) - int(year)) if years and year else 99
            # Sorts best-first: exact title, then the right type (official sound version over
            # gamerip over arrangement), then the platform is on the album, then closest year.
            c["_rank"] = (0 if exact else 1, _TYPE_RANK.get((c["type"] or "").lower(), 3),
                          0 if plat_hit else 1, yr_gap)
            c["_exact"] = exact
            matched.append(c)

        if not matched:
            return None
        matched.sort(key=lambda c: c["_rank"])
        best = matched[0]
        try:
            rec = self.album(best["slug"])
        except Exception as exc:
            log.debug("khinsider: album fetch failed for %s: %s", best["slug"], exc)
            return None
        if not rec:
            return None
        # The runners-up ride along so the drawer's "other releases" needs no second search;
        # their track lists are filled lazily (client.album) only if one is actually opened.
        rec["alternates"] = [
            {"slug": c["slug"], "name": c["name"], "type": c["type"],
             "year": c["year"], "platforms": c["platforms"], "url": c["url"]}
            for c in matched[1:8] if c["slug"] != best["slug"]
        ]
        rec["confidence"] = 12 if best.get("_exact") else 10
        return rec

    def override_from_url(self, title: str, url: str):
        """Soundtrack mapping: paste a khinsider album URL and it's pinned. You picked it,
        so it's right — no validation."""
        m = re.search(r"/game-soundtracks/album/([^/?#]+)", (url or "").strip())
        if not m:
            return None
        try:
            rec = self.album(urllib.parse.unquote(m.group(1)))
        except Exception:
            return None
        if rec:
            rec["confidence"] = 15
            rec.setdefault("alternates", [])
        return rec

    # -- album page ---------------------------------------------------------
    def album(self, slug: str) -> dict | None:
        """One album page → its metadata, cover, and full track list. Shared by match()
        and the lazy 'switch to another release' endpoint."""
        text = self._get(_ALBUM.format(urllib.parse.quote(slug)))
        if 'id="EchoTopics"' in text and "songlist" not in text:
            return None

        def field(label):
            m = re.search(re.escape(label) + r":\s*</b>\s*(.*?)</p>", text, re.S)
            if not m:
                m = re.search(re.escape(label) + r":\s*(.*?)(?:<br|</p>)", text, re.S)
            return _clean(re.sub(r"<[^>]+>", " ", m.group(1))) if m else ""

        cover = re.search(r'<div class="albumImage">\s*<a href="([^"]+)"', text)
        header = re.search(r"<h2>(.*?)</h2>", text, re.S)
        name = re.sub(r"\s*\[By[^\]]*\]\s*$", "", _clean(re.sub(r"<[^>]+>", " ", header.group(1)))) if header else slug

        tracks = []
        tbl = re.search(r'<table id="songlist">(.*?)</table>', text, re.S)
        if tbl:
            for row in re.findall(r"<tr[^>]*>(.*?)</tr>", tbl.group(1), re.S):
                a = re.search(r'href="(/game-soundtracks/album/[^"]+?\.mp3)"[^>]*>([^<]+)</a>', row)
                if not a:
                    continue
                dur = re.search(r">(\d+:\d{2})<", row)
                tracks.append({
                    "n": len(tracks) + 1,
                    "name": _clean(html.unescape(a.group(2))),
                    "song": urllib.parse.unquote(a.group(1)),
                    "dur": dur.group(1) if dur else None,
                })
        if not tracks:
            return None
        return {
            "source": "KHInsider",
            "slug": slug,
            "name": name,
            "type": field("Album type") or "",
            "platforms": [p for p in re.split(r"\s*,\s*", field("Platforms")) if p],
            "year": field("Year"),
            "publisher": field("Published by") or None,
            "totalSize": field("Total Filesize") or None,
            "cover": cover.group(1) if cover else None,
            "url": _ALBUM.format(urllib.parse.quote(slug)),
            "trackCount": len(tracks),
            "tracks": tracks,
        }

    # -- lazy audio ---------------------------------------------------------
    def resolve_audio(self, song_path: str) -> str | None:
        """A song-page path → the direct CDN mp3 URL. One request, made only when a track is
        actually played (the album page lists song pages, not audio files). The result is the
        real vgmtreasurechest.com URL, which the browser's <audio> streams with range support."""
        if not song_path or "/game-soundtracks/album/" not in song_path:
            return None
        try:
            text = self._get(_BASE + urllib.parse.quote(song_path, safe="/%"))
        except Exception as exc:
            log.debug("khinsider: song page failed for %s: %s", song_path, exc)
            return None
        m = re.search(r'<a[^>]+href="(https://[^"]+?\.mp3)"[^>]*>\s*<span[^>]*>\s*Click here to download', text)
        if not m:
            m = re.search(r'(https://[^"\']+?\.mp3)', text)
        return html.unescape(m.group(1)) if m else None
