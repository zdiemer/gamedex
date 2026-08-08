"""ScreenScraper: the box as it was actually printed, one face at a time.

Cover Project hands us a WRAP — a single scan of the flattened box, which shelf.py
slices into back|spine|front. That is where all the difficulty lives: which of seven
regional scans is the right one, which template it was printed to, and which way up
the art inside each panel is (see tools/resolve_covers.py, which exists entirely to
answer those three questions).

ScreenScraper hands us the FACES THEMSELVES. `box-2D` is the front, `box-2D-back`
the back, `box-2D-side` the spine, each its own image, each tagged with the region it
was printed for. Nothing to slice, no template to match, no rotation to argue about.
It also carries `box-texture` (a full flat wrap, when someone scanned one), `support-2D`
(the cartridge label or the printed disc face) and `manuel` (the instruction booklet) —
all in the same response, so they cost nothing extra to collect and are stored
alongside the faces for the media models and the manual reader to pick up.

What it does have is a QUOTA. Every endpoint refuses without a developer key, every
response reports how much of your day you have spent, and a non-contributing account
gets one thread. So the matching runs OFFLINE — tools/resolve_screenscraper.py writes
data/screenscraper.json once — and the server only ever fetches media it already knows
the id of, one face at a time, cached on the volume forever after.

Credentials (values.local.yaml -> Secret -> env), all four required for full access:
    SCREENSCRAPER_DEV_ID / SCREENSCRAPER_DEV_PASSWORD   the developer key, granted per
                                                        piece of software on request
    SCREENSCRAPER_USER   / SCREENSCRAPER_PASSWORD       the user account: higher quota,
                                                        higher-resolution media
"""

from __future__ import annotations

import logging
import os
import urllib.parse

import requests

from ratelimiter import RateLimiter

log = logging.getLogger("gamedex.screenscraper")

API = "https://api.screenscraper.fr/api2"
SOFTNAME = "gamedex"
# They hand media URLs back on neoclone.screenscraper.fr, one of their mirrors. We
# rebuild against the canonical host instead (verified: it serves the same bytes and
# honours maxwidth), so a mirror going away doesn't strand a manifest of stored refs.
MEDIA_ENDPOINT = "mediaJeu.php"

# One thread, one request at a time. A non-contributing account is allowed exactly one
# concurrent thread, and the warm pass runs for an hour — being impolite here gets the
# key revoked, and there is nothing to buy with speed when nobody is waiting.
DEFAULT_RATE = float(os.environ.get("SCREENSCRAPER_RATE", "1"))

# Which media is which face. The names are ScreenScraper's own; a game usually has the
# front and often nothing else, which is why shelf.py synthesises what is missing rather
# than requiring the set.
FACE_MEDIA = {
    "front": ("box-2D",),
    "back": ("box-2D-back",),
    "spine": ("box-2D-side", "box-2D-spine"),
}
# The flat wrap, when someone scanned one: back|spine|front in a single image, exactly
# the shape shelf.py already knows how to cut. Used only for faces the per-face media
# above didn't supply.
TEXTURE_MEDIA = ("box-texture",)
# The physical media itself — a cartridge label, a printed disc face. This is what
# static/media.js has been holding `mediaArt().scan` open for.
SUPPORT_MEDIA = ("support-2D", "support-texture")
MANUAL_MEDIA = ("manuel", "manual")

# Our sheet's release region -> ScreenScraper's region codes, best first. "wor" is a
# worldwide release and "ss" is ScreenScraper's own composite, both of which are better
# than a foreign box; a Japanese scan is the last resort for a game we own in NTSC-U,
# for the same reason resolve_covers.py refuses one outright.
# Every value the sheet's releaseRegion actually takes is listed. A region MISSING
# from this table is not a harmless gap: it falls back to the US-first order, so an
# Asian copy gets offered the US box first — which is precisely the substitution the
# per-region box key exists to prevent.
REGION_PREF = {
    "North America": ("us", "wor", "ss", "eu", "uk", "au", "jp"),
    "Europe": ("eu", "uk", "wor", "ss", "fr", "de", "sp", "it", "us", "jp"),
    "Japan": ("jp", "asi", "wor", "ss", "us", "eu"),
    "Asia": ("asi", "jp", "kr", "wor", "ss", "us", "eu"),
    "Korea": ("kr", "asi", "jp", "wor", "ss", "us", "eu"),
    "Australia": ("au", "eu", "uk", "wor", "ss", "us", "jp"),
    "": ("us", "wor", "ss", "eu", "uk", "jp"),
}

# Printings that belong to no single territory: a worldwide release, and their own
# composite entry. These MATCH whatever you own — a region-free Switch card has one
# printing and it is yours, so flagging it as a foreign box would be the lie.
UNIVERSAL_REGIONS = ("wor", "ss")

# Our platform names -> ScreenScraper system ids. Both the full names the sheet
# sometimes uses and the shorthands it usually does, same as PLATFORM_DIR in
# tools/resolve_covers.py.
#
# ScreenScraper is a RETRO database first: it is thin-to-empty above the PS4/Xbox One
# generation, and a platform missing from this table is simply not asked about (the
# resolver reports which ones it skipped, so the gaps are visible rather than silent).
SYSTEME_ID = {
    "Nintendo Entertainment System": 3, "NES": 3,
    "Nintendo Family Computer Disk System": 106, "Famicom Disk System": 106,
    "e-Reader": 119,
    "Super Nintendo Entertainment System": 4, "SNES": 4,
    "Nintendo 64": 14, "N64": 14,
    "Nintendo GameCube": 13, "GameCube": 13,
    "Nintendo Wii": 16, "Wii": 16,
    "Nintendo Wii U": 18, "Wii U": 18,
    "Nintendo Switch": 225, "Switch": 225,
    "Nintendo Switch 2": 296, "Switch 2": 296,
    "Nintendo Game Boy": 9, "Game Boy": 9,
    "Nintendo Game Boy Color": 10, "Game Boy Color": 10,
    "Nintendo Game Boy Advance": 12, "Game Boy Advance": 12,
    "Nintendo DS": 15, "New Nintendo 3DS": 17, "Nintendo 3DS": 17,
    "Nintendo Virtual Boy": 11, "Virtual Boy": 11,
    "PlayStation": 57, "PlayStation 2": 58, "PlayStation 3": 59, "PlayStation 4": 60,
    "PlayStation 5": 284,
    "PlayStation Portable": 61, "PSP": 61,
    "PlayStation Vita": 62, "PS Vita": 62,
    "Xbox": 32, "Xbox 360": 33, "Xbox One": 34,
    "Sega Genesis": 1, "Genesis": 1,
    "Sega Master System": 2, "Master System": 2,
    "Sega Game Gear": 21, "Game Gear": 21,
    "Sega Saturn": 22, "Saturn": 22,
    "Sega Dreamcast": 23, "Dreamcast": 23,
    "Sega CD": 20, "Sega 32X": 19,
    "Atari 2600": 26, "Atari 5200": 40, "Atari 7800": 41,
    "Atari Jaguar": 27, "Jaguar": 27, "Atari Lynx": 28, "Lynx": 28,
    "3DO Interactive Multiplayer": 29, "3DO": 29,
    "Neo Geo": 142, "Neo Geo Pocket": 25, "Neo Geo Pocket Color": 82,
    "TurboGrafx-16": 31, "ColecoVision": 48, "Intellivision": 115,
    "WonderSwan": 45, "WonderSwan Color": 46,
    "Philips CD-i": 133, "Vectrex": 102,
}


class QuotaExceeded(RuntimeError):
    """The day's requests are spent. Stop asking; try again tomorrow."""


class ScreenScraper:
    def __init__(self, dev_id: str = "", dev_password: str = "", user: str = "",
                 password: str = "", rate: float = DEFAULT_RATE):
        self.dev_id = dev_id or os.environ.get("SCREENSCRAPER_DEV_ID", "")
        self.dev_password = dev_password or os.environ.get("SCREENSCRAPER_DEV_PASSWORD", "")
        self.user = user or os.environ.get("SCREENSCRAPER_USER", "")
        self.password = password or os.environ.get("SCREENSCRAPER_PASSWORD", "")
        self._limit = RateLimiter(rate)
        self._session = requests.Session()
        self.quota_spent = False

    @property
    def enabled(self) -> bool:
        """The DEVELOPER pair is the gate. A user account alone gets you nothing —
        every endpoint checks the developer key first and refuses in French."""
        return bool(self.dev_id and self.dev_password)

    def usable(self) -> bool:
        """Enabled AND not already turned away for the day. The warm pass asks this
        before every game so a spent quota stops the crawl instead of grinding through
        thousands of guaranteed failures."""
        return self.enabled and not self.quota_spent

    def _auth(self) -> dict:
        p = {"devid": self.dev_id, "devpassword": self.dev_password,
             "softname": SOFTNAME, "output": "json"}
        if self.user:
            p["ssid"] = self.user
            p["sspassword"] = self.password
        return p

    # ---------- the endpoints ----------

    def _call(self, endpoint: str, params: dict, timeout: int = 45) -> dict | None:
        """One JSON call. Their errors are PLAIN TEXT with a 200, not JSON with a
        status, so "did it work" is decided by whether the body parses."""
        if not self.enabled or self.quota_spent:
            return None
        self._limit.wait()
        try:
            r = self._session.get(f"{API}/{endpoint}", params={**self._auth(), **params},
                                  timeout=timeout)
        except Exception as e:
            log.warning("screenscraper %s: %s", endpoint, e)
            return None
        body = r.text.strip()
        if r.status_code == 429 or "quota" in body[:200].lower():
            self.quota_spent = True
            raise QuotaExceeded(body[:200])
        if r.status_code >= 400 or not body.startswith("{"):
            # "Erreur de login", "Jeu non trouvé", a maintenance page. The first is worth
            # shouting about (nothing will ever work); the rest are ordinary misses.
            if "login" in body.lower() or "identifiant" in body.lower():
                log.error("screenscraper: %s", body[:200])
            return None
        try:
            return r.json().get("response") or {}
        except Exception:
            return None

    def systems(self) -> list[dict]:
        """Their system list, so SYSTEME_ID can be checked against the truth rather
        than trusted. Used by the resolver, not at runtime."""
        d = self._call("systemesListe.php", {}) or {}
        return d.get("systemes") or []

    def search(self, systeme_id: int, term: str) -> list[dict]:
        """Name search, best match first. ScreenScraper ranks these itself, but the
        ranking is a text ranking — the resolver still confirms the hit against the
        IGDB cover before believing it."""
        d = self._call("jeuRecherche.php", {"systemeid": systeme_id, "recherche": term})
        return (d or {}).get("jeux") or []

    def game(self, systeme_id: int, rom_name: str) -> dict | None:
        """Lookup by ROM filename. Exact when we have a real filename (the NAS index
        and RomM both have them); a decent second opinion when we only have a title."""
        d = self._call("jeuInfos.php", {"systemeid": systeme_id, "romnom": rom_name})
        return (d or {}).get("jeu")

    def quota(self) -> dict:
        """What every response tells us about the day: requests spent, the ceiling,
        and how many threads this account is allowed."""
        d = self._call("ssuserInfos.php", {}) or {}
        return d.get("ssuser") or {}

    # ---------- the media ----------

    def media_ref(self, media: dict) -> dict | None:
        """Boil one ScreenScraper media entry down to what we are willing to STORE.

        Their `url` is a fully-formed mediaJeu.php link with our developer key and our
        account password sitting in the query string. data/screenscraper.json is
        committed to git, so that URL cannot be what we keep. We keep the parameters
        that identify the image and rebuild the URL with live credentials at fetch
        time — which is also why the stored file stays valid when the key rotates."""
        url = media.get("url") or ""
        if not url:
            return None
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        one = lambda k: (q.get(k) or [""])[0]
        if not one("media"):
            return None
        ref = {"media": one("media"), "format": one("mediaformat") or media.get("format") or "png"}
        for k in ("systemeid", "jeuid", "romid"):
            if one(k):
                ref[k] = one(k)
        if media.get("region"):
            ref["region"] = media["region"]
        # Not every medium comes off the same endpoint: a manual is a PDF served by
        # mediaManuelJeu.php, not mediaJeu.php. Recorded when it differs, so a stored
        # ref stays fetchable without anyone having to remember the exception.
        path = urllib.parse.urlparse(url).path.rsplit("/", 1)[-1]
        if path and path != MEDIA_ENDPOINT:
            ref["endpoint"] = path
        return ref

    def media_url(self, ref: dict, max_px: int = 0) -> str:
        """Rebuild a fetchable URL from a stored ref, with live credentials.

        `max_px` asks their server to resize before sending. No face is ever shown
        above 600px, so asking for a 4000px PNG and throwing 95% of it away is a
        waste of their bandwidth and our memory alike."""
        # `region` and `format` are ours, for choosing and for reporting — the media is
        # already identified by the `media` string, which carries the region inside it
        # ("box-2D(us)"). Passing them on would be handing their endpoint parameters it
        # never asked for.
        skip = ("format", "region", "endpoint")
        p = {**self._auth(), **{k: v for k, v in ref.items() if k not in skip}}
        p["mediaformat"] = ref.get("format", "png")
        if max_px:
            p["maxwidth"] = p["maxheight"] = max_px
        return f"{API}/{ref.get('endpoint', MEDIA_ENDPOINT)}?" + urllib.parse.urlencode(p)

    def fetch(self, ref: dict, max_px: int = 800, timeout: int = 60) -> bytes | None:
        """The image itself. Returns None for anything that isn't one — their
        "media not found" is a text body with a 200, same as everywhere else."""
        if not self.enabled or self.quota_spent:
            return None
        self._limit.wait()
        try:
            r = self._session.get(self.media_url(ref, max_px), timeout=timeout)
        except Exception as e:
            log.warning("screenscraper media %s: %s", ref.get("media"), e)
            return None
        if r.status_code == 429:
            self.quota_spent = True
            raise QuotaExceeded("media quota")
        if r.status_code >= 400 or not r.content[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0",
                                                         b"\xff\xd8\xff\xe1", b"\xff\xd8\xff\xdb"):
            if r.content[:1] == b"\xff":          # some other JPEG variant; trust it
                return r.content
            return None
        return r.content


# ---------- picking, out of what a game happens to have ----------


def _pick(medias: list[dict], kinds: tuple[str, ...], order: list[str]) -> dict | None:
    """The best medium of these kinds, by the given region order then by kind order.

    A region not in the list still ranks — behind every one that is. Region is a
    preference here and never a requirement: a game whose only box is the Brazilian
    printing gets the Brazilian box, because a real foreign box beats a synthesised
    one. That is the opposite of the Cover Project resolver's call, which refuses a
    foreign scan outright — but it can afford to, having a plausible fabricated
    fallback for every game. Here the alternative is no box at all."""
    best, best_rank = None, 10_000
    for kind in kinds:
        for m in medias:
            if (m.get("type") or "") != kind:
                continue
            region = (m.get("region") or "").lower()
            rank = order.index(region) if region in order else len(order) + (1 if region else 0)
            rank += kinds.index(kind) * 1000       # an exact kind beats an alias
            if rank < best_rank:
                best, best_rank = m, rank
    return best


def region_matches(region: str, release_region: str) -> bool:
    """Is this the printing you own, rather than the nearest one they had?

    Drives the shelf card, which names the region on the badge — so saying "US" over a
    European box would be a worse lie than saying nothing. A worldwide printing counts
    as yours (see UNIVERSAL_REGIONS); anything else has to be your territory's own.

    Kept separate from art_for so a stored manifest can be re-judged without re-fetching
    a single image — which is what saved a full re-crawl when this rule was wrong."""
    if not region:
        return False
    if region in UNIVERSAL_REGIONS:
        return True
    want = REGION_PREF.get(release_region) or REGION_PREF[""]
    return region == want[0]


def art_for(client: ScreenScraper, jeu: dict, release_region: str = "") -> dict:
    """Every piece of physical art this game has, as storable refs.

    Returns {faces: {front/back/spine}, texture, support, manual, region, regionMatch}
    — with only the keys that actually exist. A game with no box front at all returns
    no `faces`, and the resolver drops it: a box whose front we would have to invent is
    exactly the box the existing `cover` path already draws.

    ONE REGION FOR THE WHOLE BOX. Picking the best available region per FACE is the
    obvious implementation and it builds a box that never existed: Ocarina of Time
    carries nine regional printings of each face, so an independent choice can hand
    back a US front, a European spine and an Australian back — three real photographs
    of three real boxes, assembled into a thing you cannot own. The region is chosen
    once, from the printings that have a FRONT (the face that must exist for the box to
    be worth building at all), and every other face is taken from that same printing.
    Only when that printing genuinely lacks a face does it fall back — a real spine off
    the next-best box beats a coloured rectangle, and unlike the front, a spine is not
    where you would notice."""
    medias = jeu.get("medias") or []
    prefs = REGION_PREF.get(release_region, REGION_PREF[""])

    fronts = {(m.get("region") or "").lower() for m in medias
              if (m.get("type") or "") in FACE_MEDIA["front"]}
    region = next((r for r in prefs if r in fronts), "")
    if not region and fronts:
        region = sorted(fronts)[0]                 # nothing preferred: take one, deterministically
    # The chosen printing first, then everything else in preference order.
    order = [region] + [r for r in prefs if r != region] if region else list(prefs)

    out: dict = {"faces": {}}
    for face, kinds in FACE_MEDIA.items():
        ref = client.media_ref(_pick(medias, kinds, order) or {})
        if ref:
            out["faces"][face] = ref
    for key, kinds in (("texture", TEXTURE_MEDIA), ("support", SUPPORT_MEDIA),
                       ("manual", MANUAL_MEDIA)):
        ref = client.media_ref(_pick(medias, kinds, order) or {})
        if ref:
            out[key] = ref

    out["region"] = region
    out["regionMatch"] = region_matches(region, release_region)
    # Which faces came off a different printing than the front. Nothing reads this
    # today; it is recorded because a mixed box is the kind of thing you want to be
    # able to COUNT later without re-crawling their API to find out.
    mixed = sorted(f for f, r in out["faces"].items() if r.get("region", "") != region)
    if mixed:
        out["mixedFaces"] = mixed
    return out
