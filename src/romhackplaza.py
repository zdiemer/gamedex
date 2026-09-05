"""Romhack Plaza — the secondary translation source.

A Laravel/Livewire site, server-rendered, no anti-bot: plain requests with an
identifying User-Agent gets a 200. It is much smaller than RHDI (a few hundred English
translations against RHDI's several thousand) but it is not a subset — patches show up
here that never get posted to RHDI, and its cover images are usable where RHDI's are
not. It earns its place as a second opinion, not as a primary.

THE ONE GOOD SURPRISE
---------------------
``languages[0]=1`` IS English and IS honoured server-side — the exact opposite of RHDI,
where language filters are silently ignored. 353 English rows out of 1,961 total is the
proof. So there is no detail fetch in this module at all: the list page is already the
answer. Do not "improve" this with a redundant client-side language check; it would need
its own language vocabulary and could only ever disagree with the server.

TRAPS
-----
* **``Added: YY-MM-DD`` is a two-digit year, and it is when the SITE added the entry,**
  not when the patch shipped. It is a fine watermark for incremental crawling and a
  wrong ``releasedAt``, so it is kept in its own field and never conflated with RHDI's
  ``releaseDate``.

* ``entry-card-title`` is the **game** title, not the patch title — "RoboCop 3", not
  "RoboCop 3 - Portuguese Translation". That is what we want, but it means the patch
  title has to be reconstructed from the slug when one is needed for display.

* Livewire re-renders the results grid on interaction, so only the initial
  server-rendered HTML is reachable with ``requests``. Selectors are anchored on the
  canonical ``/translations/<slug>`` href — the stable identity — rather than on any
  Livewire-generated attribute, which changes between renders.

* The ``<span class="badge">`` variants are semantic by class, not by position:
  ``badge translations`` is the entry type, ``badge orange`` is a language, and a bare
  ``badge`` is the status. A missing status is left unknown rather than assumed
  "Complete". **There can be more than one orange badge** — a "Korean / English
  Translation Patch" carries both, and keeping only the last one silently relabels an
  English patch as Korean. Hence ``languages`` is a list and ``language`` prefers
  English when it is among them.

* The ``/storage/entries/main-images/*.webp`` cover is **durable**, unlike RHDI's
  presigned thumbnails. This is the one place in Translation Watch where a source's own
  image may be stored, and it is the fallback cover for a game IGDB never matched.
"""

from __future__ import annotations

import logging
import re
import time

import requests
from bs4 import BeautifulSoup

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.romhackplaza")

_BASE = "https://romhackplaza.org"
_UA = "gamedex/1.0 (personal game collection; +https://github.com/zdiemer)"

# The site's own language id for English, used as a server-side filter. Verified against
# the unfiltered listing: 353 rows here vs 1961 without it.
_ENGLISH_ID = 1

_ADDED = re.compile(r"Added:\s*(\d{2})-(\d{2})-(\d{2})")
_COUNT = re.compile(r"([\d,]+)\s+results?")


def _int(text):
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


class RomhackPlazaClient:
    def __init__(self, rate=1.0):
        self._limiter = RateLimiter(rate)
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": _UA})

    @property
    def configured(self):
        return True

    def _get(self, path, params=None):
        self._limiter.wait()
        try:
            r = self._session.get(f"{_BASE}{path}", params=params, timeout=30)
        except requests.RequestException as e:
            log.warning("plaza: %s failed: %s", path, e)
            return None
        if r.status_code != 200:
            log.warning("plaza: %s returned %s", path, r.status_code)
            return None
        return r.text

    def list_page(self, page=1, english_only=True):
        """One page of the translations listing, newest first. Returns (releases, total).

        Unlike RHDI, `language` is populated here — the server filtered on it.
        """
        params = [
            ("types[0]", "translations"),
            ("sort", "created_at"),
            ("dir", "desc"),
            ("page", int(page)),
        ]
        if english_only:
            params.append(("languages[0]", _ENGLISH_ID))
        html = self._get("/database", params)
        if html is None:
            # Fetch FAILED — not the same as a page with nothing on it. The caller walks
            # until a page comes back empty, so returning [] here would let one bad
            # request declare the listing finished. See rhdi.list_page for the same note.
            return None, None
        soup = BeautifulSoup(html, "html.parser")

        total = None
        count_el = soup.select_one(".database-results-count")
        if count_el:
            m = _COUNT.search(count_el.get_text(" ", strip=True))
            if m:
                total = _int(m.group(1))

        out = []
        for card in soup.select(".entry-card"):
            link = card.select_one("a.entry-card-title") or card.select_one(
                'a[href*="/translations/"]'
            )
            if not link:
                continue
            href = link.get("href") or ""
            slug = href.rstrip("/").rsplit("/", 1)[-1]
            if not slug:
                continue
            title = link.get_text(" ", strip=True)
            if not title:
                continue

            # A patch can ship more than one language ("Korean / English Translation"),
            # and each gets its own orange badge. Keeping only the last one silently
            # relabels an English patch as Korean, so collect them all.
            languages, status = [], None
            for b in card.select("span.badge"):
                classes = b.get("class") or []
                text = b.get_text(" ", strip=True)
                if "orange" in classes:
                    if text:
                        languages.append(text)
                elif "translations" in classes:
                    continue                     # the entry-type chip ("Trans")
                elif not status:
                    status = text                # left unknown rather than assumed

            author = card.select_one(".entry-card-author")
            authors = []
            if author:
                authors = [
                    a.strip()
                    for a in re.sub(r"^\s*By\s+", "", author.get_text(" ", strip=True), flags=re.I).split(",")
                    if a.strip()
                ]

            img = card.select_one("img")
            src = img.get("src") if img else None
            cover = (_BASE + src) if src and src.startswith("/") else src

            platform_el = card.select_one(".entry-badge")
            meta_text = card.get_text(" ", strip=True)
            m = _ADDED.search(meta_text)
            added = None
            if m:
                yy, mm, dd = (int(x) for x in m.groups())
                try:
                    added = int(time.mktime((2000 + yy, mm, dd, 0, 0, 0, 0, 0, -1)))
                except (ValueError, OverflowError):
                    added = None

            downloads = None
            dl = card.select_one(".entry-card-meta span")
            if dl:
                downloads = _int(dl.get_text(" ", strip=True))

            out.append({
                "source": "plaza",
                "source_id": slug,
                "url": href if href.startswith("http") else f"{_BASE}{href}",
                # The card shows the GAME title; the patch title only exists in the slug.
                "patch_title": title,
                "game_title": title,
                "game_source_id": None,
                "platform_raw": platform_el.get_text(" ", strip=True) if platform_el else None,
                "authors": authors,
                "tags": [t for t in (status,) if t],
                "languages": languages,
                "language": ("English" if any(l.lower() == "english" for l in languages)
                             else (languages[0] if languages else None)),
                "status": status,
                # Site-added date, NOT a patch release date. See the module docstring.
                "added": added,
                "released": None,
                "download_count": downloads,
                "cover_url": cover,
                "nsfw": False,          # the site exposes no NSFW flag on the card
            })
        return out, total
