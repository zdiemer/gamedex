"""romhack.ing (RHDI) — the active ROM translation database.

romhacking.net closed to submissions in August 2024 and now sits behind a Cloudflare
managed challenge. RHDI is where the scene actually went, and it is the primary source
for Translation Watch: ~7,000 translations, cleanly structured, no anti-bot at all.

HOW TO READ IT
--------------
It is a React SPA, but it ships a full server-rendered mode for no-JS clients. Hit
``GET /api/noScript/enable`` once to pick up a ``noScriptRoute=true`` cookie and every
page afterwards is Next.js SSR HTML carrying a ``<script id="__NEXT_DATA__">`` blob —
the same JSON the SPA would have fetched. Keep the Session and you keep the cookie.

That cookie is load-bearing in a nasty way: WITHOUT it the HTML is an empty shell, and
since the shell parses fine as HTML the failure reads as "the site has no translations"
rather than "we forgot the handshake". Hence ``_ensure_noscript`` re-runs on an empty
payload rather than trusting the cookie to still be there.

There is also a ``/_next/data/<buildId>/…json`` route returning the identical payload in
a third of the bytes. We do not use it. ``<buildId>`` rotates on every one of their
deploys, so that path 404s without warning and buys nothing at one request per second.
``__NEXT_DATA__`` cannot go stale.

The trailing slug in ``/database/content/entry/<id>/<slug>`` is decorative — the route
resolves on the id alone (verified against ``/x`` and ``/_``). We slugify the title for
the sake of the link we show the user, and never depend on getting it right.

TRAPS
-----
* **The list payload has no ``language`` field, and language query parameters are
  silently ignored.** ``?language=English`` returns the unfiltered page and *looks like
  it worked*. This is the most dangerous property of the source: a plausible-looking
  filter would ship every Portuguese patch as English. Language is knowable only from
  the detail page, which is why ``list_page`` returns ``language=None`` and refuses to
  guess. ``_language_in_title`` exists purely to skip an obvious "- German Translation"
  before spending a request; it never decides that something IS English.

* **``thumbnailUrl.url`` is a presigned DigitalOcean Spaces URL that expires in 300
  seconds.** Storing it yields a link dead before anyone clicks. Caching the bytes is no
  better — AssetCache keys on sha256(url), so they would land under a key nothing ever
  requests again. We drop it on the floor: matched games use their IGDB cover, unmatched
  ones fall back to Romhack Plaza's durable .webp or to nothing.

* **``releaseDate`` is the PATCH's date, not the game's.** A 1995 SNES game gets a 2026
  releaseDate here. Never let it reach IGDB as a release year.

* **"Newest first" is by ``releaseDate``, not by insertion.** A backdated or edited
  submission lands in the middle of the list, so an incremental walk cannot stop at the
  first familiar page — see STOP_AFTER_KNOWN_PAGES in translations.py.

* ``tags`` carries more than completion state: ``Machine Translation`` and ``Vibe
  Coded`` mark MTL/AI output, ``NSFW`` marks adult content, and ``Addendum`` means a
  patch layered on top of somebody else's translation rather than a translation. All
  three matter downstream and are passed through untouched.
"""

from __future__ import annotations

import json
import logging
import re

import requests

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.rhdi")

_BASE = "https://romhack.ing"
_UA = "gamedex/1.0 (personal game collection; +https://github.com/zdiemer)"

_NEXT_DATA = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)

# Languages RHDI actually publishes in, for the pre-filter described above. Ordered
# longest-first so "Brazilian Portuguese" wins over "Portuguese" when both would match.
_LANGUAGES = sorted(
    [
        "Brazilian Portuguese", "Portuguese", "Spanish", "Catalan", "Galician", "Basque",
        "French", "German", "Italian", "Dutch", "Danish", "Swedish", "Norwegian",
        "Finnish", "Icelandic", "Polish", "Czech", "Slovak", "Hungarian", "Romanian",
        "Bulgarian", "Serbian", "Croatian", "Slovenian", "Greek", "Turkish", "Russian",
        "Ukrainian", "Hebrew", "Arabic", "Persian", "Hindi", "Thai", "Vietnamese",
        "Indonesian", "Malay", "Filipino", "Tagalog", "Japanese", "Korean", "Chinese",
        "Simplified Chinese", "Traditional Chinese", "Cantonese", "Latin", "Esperanto",
        "Toki Pona", "Welsh", "Irish", "Gaelic", "Latvian", "Lithuanian", "Estonian",
    ],
    key=len,
    reverse=True,
)
_LANG_IN_TITLE = re.compile(
    r"\b(" + "|".join(re.escape(x) for x in _LANGUAGES) + r")\b", re.I
)

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(title):
    """Best-effort mirror of RHDI's own slugs. Decorative — the id is what resolves."""
    return _SLUG_STRIP.sub("-", (title or "").lower()).strip("-") or "x"


class RhdiClient:
    def __init__(self, rate=1.0):
        self._limiter = RateLimiter(rate)
        self._session = None

    @property
    def configured(self):
        return True

    # ---------------------------------------------------------------- transport

    def _new_session(self):
        s = requests.Session()
        s.headers.update({"User-Agent": _UA, "Accept": "text/html,application/xhtml+xml"})
        self._limiter.wait()
        try:
            # Sets noScriptRoute=true. Redirects to /, which we don't care about.
            s.get(f"{_BASE}/api/noScript/enable", timeout=25, allow_redirects=True)
        except requests.RequestException as e:
            # A slow moment on the handshake must not cost the whole pass. Hand back the
            # session anyway: either the cookie is already there from a previous life, or
            # _page_props sees the JS shell and re-runs this once. Letting it raise here
            # meant one timeout took the entire romhack.ing phase down for six hours.
            log.warning("rhdi: noScript handshake failed (%s); continuing without it", e)
        return s

    def _ensure_noscript(self):
        if self._session is None:
            self._session = self._new_session()
        return self._session

    def _page_props(self, path, _retry=True, timeout=40):
        """Fetch a page and return its Next.js pageProps, or None.

        A missing __NEXT_DATA__ means we got the JS shell, i.e. the noScript cookie is
        gone — rebuild the session once and try again before giving up.
        """
        s = self._ensure_noscript()
        self._limiter.wait()
        try:
            r = s.get(f"{_BASE}{path}", timeout=timeout)
        except requests.RequestException as e:
            log.warning("rhdi: %s failed: %s", path, e)
            return None
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            log.warning("rhdi: %s returned %s", path, r.status_code)
            return None
        m = _NEXT_DATA.search(r.text)
        if not m:
            if _retry:
                log.info("rhdi: no __NEXT_DATA__ on %s, re-running noScript handshake", path)
                self._session = None
                return self._page_props(path, _retry=False, timeout=timeout)
            log.warning("rhdi: no __NEXT_DATA__ on %s", path)
            return None
        try:
            return (json.loads(m.group(1)).get("props") or {}).get("pageProps") or None
        except ValueError as e:
            log.warning("rhdi: bad __NEXT_DATA__ on %s: %s", path, e)
            return None

    # ------------------------------------------------------------------ reading

    def list_page(self, page=1):
        """One page of the translation list, newest first. Returns (releases, total).

        Returns (None, None) when the FETCH FAILED, versus ([], total) for a page that
        genuinely holds nothing. The caller walks the archive until a page comes back
        empty, so collapsing these two would let one timeout declare the whole listing
        finished — and the seed cursor would never come back to the pages it skipped.

        `language` is deliberately None on every release — see the module docstring.
        `maybe_english` is the cheap title heuristic: False means "don't bother fetching
        the detail page", it does NOT mean the release is English.
        """
        pp = self._page_props(f"/search/translation?page={int(page)}")
        if pp is None:
            return None, None
        data = pp.get("data") or {}
        out = []
        for e in data.get("entries") or []:
            eid = e.get("id")
            title = e.get("title")
            if not eid or not title:
                continue
            games = e.get("games") or []
            tags = e.get("tags") or []
            out.append({
                "source": "rhdi",
                "source_id": eid,
                "url": f"{_BASE}/database/content/entry/{eid}/{slugify(title)}",
                "patch_title": title,
                # The single most valuable field either site gives us: the underlying
                # game, already separated from the patch.
                "game_title": (games[0].get("title") if games else None),
                "game_source_id": (games[0].get("gameId") if games else None),
                "platform_raw": (e.get("platform") or [None])[0],
                "authors": [a.get("authorName") for a in (e.get("authors") or []) if a.get("authorName")],
                "tags": tags,
                "released": e.get("releaseDate"),
                "download_count": e.get("downloadCount"),
                "language": None,          # detail-only. Never guessed here.
                "maybe_english": self.maybe_english(title),
                "nsfw": any(t.lower() == "nsfw" for t in tags),
            })
        return out, data.get("total")

    def maybe_english(self, patch_title):
        """False only when the title names a language that isn't English.

        Cheap request-saver, not an answer. A title naming no language at all returns
        True so it goes on to the detail page, where the real answer lives.
        """
        m = _LANG_IN_TITLE.search(patch_title or "")
        return not m or m.group(1).lower() == "english"

    def detail(self, source_id, patch_title=None):
        """The detail page — the only place `language` exists."""
        slug = slugify(patch_title) if patch_title else "x"
        pp = self._page_props(f"/database/content/entry/{source_id}/{slug}")
        d = (pp or {}).get("data") or {}
        if not d:
            return None
        return {
            "language": d.get("language") or [],
            "version": d.get("version"),
            "description": d.get("description"),
            "tags": d.get("tags") or [],
            "credits": [c.get("creditName") for c in (d.get("credits") or []) if c.get("creditName")],
            "dat": d.get("dat"),
            "released": d.get("releaseDate"),
            "download_count": d.get("downloadCount"),
        }

    def game(self, game_id, game_title=None):
        """The GAME entry behind a patch. `publisher` here is the best corroborating
        signal we get for matching a Japan-only title against IGDB."""
        slug = slugify(game_title) if game_title else "x"
        pp = self._page_props(f"/database/game/entry/{game_id}/{slug}")
        d = (pp or {}).get("data") or {}
        if not d:
            return None
        return {
            "title": d.get("title"),
            "alt_title": d.get("alternateTitle") or None,
            "description": d.get("description"),
            "platform_raw": (d.get("platform") or [None])[0],
            "publishers": d.get("publisher") or [],
            "tags": d.get("tags") or [],       # genre-ish, plus NSFW
        }
