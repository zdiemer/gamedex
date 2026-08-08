"""The shelf: the physical games, as objects.

Everything here exists to answer one question — what does this game look like as a
box you could pick up? Four answers, in descending order of truth:

    upload a scan the owner supplied by hand. Always wins: it is us being corrected.
    ss     ScreenScraper's scans of the printed box, one image PER FACE — front,
           back and spine as separate photographs, region-tagged.
    wrap   a Cover Project scan of the real box, flattened: one image holding all
           three faces, which we slice.
    cover  no scan anywhere, but IGDB has the front. We make a spine from the art's
           dominant hue and a stand-in back.
    blank  nothing at all (a GP2X Wiz game). A plain case with the title on it.

Those tiers describe a GAME, but the faces are resolved one at a time — a game whose
only ScreenScraper media is the front still gets the Cover Project spine if it has
one, and a synthesised one if it doesn't. `face()` is that chain, in order.

The wrap scans are 3-6 MB and there are two thousand of them, so we do NOT fetch
them up front. `resolve_covers.py` and `resolve_screenscraper.py` have already
decided WHICH scan (and, for a wrap, which way up), offline; this module only
fetches when someone actually pulls that game off the shelf — or when the boot-time
warm pass gets there first — and keeps the pieces on disk forever after.
"""

from __future__ import annotations

import collections
import colorsys
import io
import json
import logging
import math
import pathlib
import threading
import time

import requests
from PIL import Image, ImageFilter, ImageOps

log = logging.getLogger("gamedex.shelf")

_BLUR = ImageFilter.GaussianBlur(9)


def _hex(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

# Physical cases, in millimetres, for games with no scan to measure. Used only to
# give the fallback box a believable shape.
FALLBACK_CASE = {
    "Super Nintendo Entertainment System": (191, 133, 33),   # landscape
    "Nintendo Entertainment System": (127, 178, 25),
    "Nintendo 64": (190, 133, 33),      # landscape, like the real box
    "Sega Genesis": (133, 184, 28),
    "Nintendo GameCube": (125, 175, 15),
    "Sega Dreamcast": (140, 190, 15),
    "PlayStation": (142, 125, 10),          # a real jewel case: landscape
    "Sega Saturn": (142, 125, 10),
    "PlayStation 2": (135, 190, 14),
    "Nintendo Wii": (135, 190, 14),
    "Xbox": (135, 190, 14),
    "Xbox 360": (135, 190, 14),
    "Nintendo Wii U": (135, 190, 14),
    "PlayStation 3": (135, 171, 14),
    "PlayStation 4": (135, 171, 14),
    "PlayStation 5": (135, 171, 14),
    "Xbox One": (135, 171, 14),
    "Xbox Series X|S": (135, 171, 14),
    "Nintendo Switch": (105, 170, 11),
    "Nintendo Switch 2": (105, 170, 11),
    "Nintendo 3DS": (122, 137, 12),
    "New Nintendo 3DS": (122, 137, 12),
    "Nintendo DS": (125, 137, 12),
    "PlayStation Vita": (105, 137, 12),
    "PlayStation Portable": (105, 170, 14),
    # A Game Boy box is SQUARE, and it was the one shape here that was simply invented:
    # 92x133 is a DVD case's proportions, so every Game Boy front was cropped by a third
    # to fit one. Their own art agrees — every box-2D for GB, GBC and GBA measures 1.000
    # (700x700, 400x400) and the spine strips measure d/h ≈ 0.14. A retail box protector
    # for these is sold as 125 x 125 x 23mm, so the depth sits between the two.
    "Nintendo Game Boy Advance": (125, 125, 20),
    "Nintendo Game Boy": (125, 125, 20),
    "Nintendo Game Boy Color": (125, 125, 20),
    # The sheet mostly uses shorthands, and a platform missing from this table silently
    # gets a generic DVD case — which is how a fallback SNES box came out portrait.
    # A US SNES box and an N64 box are LANDSCAPE (see TEMPLATE_ROT in tools/cp_wrap.py).
    "SNES": (191, 133, 33),
    "NES": (127, 178, 25),
    "Genesis": (133, 184, 28),
    "Game Boy": (125, 125, 20),
    "Game Boy Color": (125, 125, 20),
    "Game Boy Advance": (125, 125, 20),
    "GameCube": (125, 175, 15),
    "Wii": (135, 190, 14),
    "Wii U": (135, 190, 14),
    "Dreamcast": (140, 190, 15),
    "Saturn": (142, 125, 10),
    "PSP": (105, 170, 14),
    "PS Vita": (105, 137, 12),
    "3DO": (142, 125, 10),
}
DEFAULT_CASE = (135, 190, 14)
# The same table, keyed the way a MATCH KEY spells a platform (lowercased) — see
# Enricher.key_for. `case_mm` takes either spelling, so the box's shape can be looked
# up from the sheet's platform name or from the key alone.
_CASE_LC = {k.lower(): v for k, v in FALLBACK_CASE.items()}


def case_mm(platform: str) -> tuple[int, int, int]:
    """This platform's real case, in millimetres, as (w, h, d).

    Read LIVE rather than out of a resolved manifest. data/screenscraper.json stores a
    `case` per game, but it is a copy of this table taken when the resolver ran — so a
    correction here (the Game Boy box is square, not a DVD case) would otherwise reach
    the fallback boxes and leave every ScreenScraper box wearing the old wrong shape
    until someone re-ran a tool that costs API quota."""
    if platform in FALLBACK_CASE:
        return FALLBACK_CASE[platform]
    return _CASE_LC.get((platform or "").strip().lower(), DEFAULT_CASE)


FACES = ("front", "spine", "back")

# Bump when the CUTTING logic changes, so already-cached faces on the volume are
# thrown away and recut. Without this, a fix to how a box is sliced never reaches a
# box that was cut wrong the first time. (v3: on rotated templates the back turns the
# opposite way from the front, to cancel the 3D mirror on the back face.)
CUT_VERSION = "3"

# Bump when the UPLOAD slicing changes, to re-cut stored uploads from originals.
# (v2: honour EXIF orientation.)
UPLOAD_CUT_VERSION = "2"

# Bump when the ScreenScraper face BUILD changes, to re-fetch and rebuild them. Kept
# separate from CUT_VERSION so a change to how a Cover Project wrap is sliced doesn't
# throw away thousands of faces that cost an API quota to fetch. (v2: only the SPINE is
# ever turned — see _orient. A portrait regional printing was being laid on its side to
# look more like the platform's usual shape.) This costs a full re-crawl, which is the
# price of the stored faces being the pixels we serve: it resumes, it is polite, and the
# media next door are stamped separately so they are not thrown away with it.
SS_VERSION = "2"

# The physical medium — the cartridge, the game card, the printed disc — on its own
# version, for the same reason SS_VERSION is separate from CUT_VERSION: it is fetched
# by its own pass, and re-doing it must not throw away a box that cost quota to build.
MEDIA_VERSION = "1"

# How long a request for a MEDIUM will wait for one of the two fetch permits before
# giving up (see Shelf.media). Long enough to outlast a crawl's turn, short enough that
# a request thread is never really parked.
SS_DEMAND_WAIT = 8.0

# Cover Project's print templates, in millimetres: back | spine | front | height.
# Kept in step with tools/cp_wrap.py, which is what chose the template offline.
TEMPLATES = {
    "dvd":     (130, 14, 129, 183),
    "gc":      (124, 14, 124, 175),
    "snes":    (133, 33, 133, 191),
    "nes":     (127, 25, 127, 178),
    "genesis": (133, 28, 133, 184),
    "n64":     (133, 33, 133, 190),
    "switch":  (105, 11, 105, 170),
    "bluray":  (135, 14, 135, 171),
    "jewel":   (142, 10, 142, 125),
}


def _saturation(im: Image.Image) -> float:
    small = im.convert("RGB").resize((40, 40))
    return sum(colorsys.rgb_to_hls(r / 255, g / 255, b / 255)[2]
               for r, g, b in small.getdata()) / 1600


def _strip(im: Image.Image) -> Image.Image:
    """Land the scan as a horizontal back|spine|front strip.

    Some scans arrive portrait, and the direction to turn them is NOT constant: Super
    Metroid has the front at the top, Hades at the bottom. Turn both the same way and
    one comes out back-to-front. A front is art and a back is text and barcodes, so the
    saturated end is the front — and we want it on the right. This must stay identical
    to tools/resolve_covers.py, which measured the scan with the same rule.
    """
    if im.height <= im.width:
        return im
    cw = im.rotate(-90, expand=True)
    third = cw.width // 3
    left = _saturation(cw.crop((0, 0, third, cw.height)))
    right = _saturation(cw.crop((cw.width - third, 0, cw.width, cw.height)))
    return cw if right >= left else im.rotate(90, expand=True)


def dominant_hue(im: Image.Image) -> str:
    """The spine colour for a game with no scanned spine.

    The MEAN colour of box art is brown. Always. A box is one or two strong colours
    over a lot of dark, and averaging that gives you mud. So take the modal HUE of
    the pixels that actually carry colour, weighted by how colourful they are, and
    throw away the greys and the blacks that would otherwise win on volume alone.
    """
    small = im.convert("RGB").resize((60, 80))
    votes: dict[int, float] = collections.defaultdict(float)
    for r, g, b in small.getdata():
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if s < 0.25 or l < 0.12 or l > 0.92:
            continue
        votes[round(h * 24)] += s
    if not votes:
        return "#6E6E78"
    top = max(votes, key=votes.get)
    r, g, b = colorsys.hls_to_rgb((top % 24) / 24, 0.42, 0.55)
    return "#%02X%02X%02X" % (int(r * 255), int(g * 255), int(b * 255))


def _orient(im: Image.Image, want_ar: float) -> Image.Image:
    """Stand a SPINE up, if it arrived lying down.

    ScreenScraper photographs each face separately, which was supposed to mean no
    rotation question — and for the front and back it does. The SPINE of a
    landscape-box platform is the exception, and it is not a rare one: a SNES or N64
    spine comes back as a WIDE horizontal strip (400x57) because that is how it sits on
    the flattened box, while the 3D case's left wall is 33mm x 133mm — tall and thin.
    Painted as-is it is a smear.

    Nothing is guessed here. The face's true aspect is known from the case dimensions
    we already hold, so the only question is which of two orientations is closer to it,
    measured in log-ratio so that "twice as wide" and "half as wide" are the same size
    of wrong. Clockwise, because the strip's LEFT edge is the top of the spine: it puts
    the title at the top, the way a box reads on a shelf.

    THE SPINE ONLY, and that is the whole of v2. Run on the front as well, this asks
    "is this picture closer to the shape of the platform's case, or to its transpose?"
    — and a box that was genuinely printed the other way round answers wrongly. The
    Super Famicom Chrono Trigger box is PORTRAIT where the SNES one is landscape, so
    its front (275x500) was being turned on its side to look more like the table's
    191x133. A front and a back arrive upright; there is nothing here for them to gain
    and a real regional printing to lose."""
    ar = im.width / max(im.height, 1)
    if want_ar <= 0 or ar <= 0:
        return im
    as_is = abs(math.log(ar / want_ar))
    turned = abs(math.log((1 / ar) / want_ar))
    return im.rotate(-90, expand=True) if turned < as_is - 0.35 else im


class _NoArt(Exception):
    """This medium exists but isn't art. Not a failure — an ordinary absence, so it
    unwinds the build for one face without logging as though something broke."""


def _placeholder(im: Image.Image) -> bool:
    """Is this a chroma-key placeholder rather than a photograph of a box?

    ScreenScraper answers "we have no back for this game" with an IMAGE — a slab of
    pure #00FF00, two colours in the whole file, HTTP 200, correct aspect ratio. It is
    indistinguishable from real art to everything except the pixels, and roughly a
    quarter of the backs sampled were one. Shipped unchecked, the shelf grows green
    rectangles for backs, which is worse than the blurred-front stand-in it already
    knows how to make.

    Pure chroma green is the test, not "flat": a real box back can be nearly a single
    colour, but no printed box is 30% #00FF00 — that is a key colour, and even the
    green consoles are nowhere near it (the Xbox brand green is #107C10)."""
    small = im.convert("RGB").resize((32, 32), Image.NEAREST)
    green = sum(1 for r, g, b in small.getdata() if g > 200 and r < 60 and b < 60)
    return green > 32 * 32 * 0.30


def _save_cutout(im: Image.Image, path: pathlib.Path) -> None:
    """Write one physical medium — a cartridge, a card, a disc — keeping its ALPHA.

    That is the whole point of storing it differently from a face: their `support`
    render is the object cut out on a transparent background, and the transparency is
    what lets the browser mask its own silhouette and extrude it into a solid. Flattened
    to JPEG it is a rectangle with a black surround, which is a coaster again.

    WebP rather than PNG, and that is not a small detail: these are photographic renders
    with a soft edge, so a lossless PNG of one runs 200-550 KB where the same picture is
    20-80 KB here. It is one image on demand either way, but the box interior should not
    cost half a megabyte on a phone."""
    long = max(im.size)
    if long > 600:
        s = 600 / long
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))),
                       Image.LANCZOS)
    tmp = path.with_suffix(".tmp")
    im.save(tmp, "WEBP", quality=86, method=4)
    tmp.replace(path)


def _decode(raw: bytes, cap: int, mode: str = "RGB") -> Image.Image:
    """Decode an image we didn't choose the size of.

    `maxwidth` is a REQUEST, not a guarantee — a source that ignores it hands back a
    600 dpi scan, and a 3366x2100 JPEG is 21 MB decoded before a single crop copies it
    again. That is what OOM-killed this pod at a 512Mi limit (see _cut). draft() makes
    libjpeg decode at a reduced scale in the first place, which is free: no face is
    ever shown above 600px, so the detail is thrown away regardless."""
    im = Image.open(io.BytesIO(raw))
    im.draft("RGB", (cap, cap))       # a no-op on PNG, which is what the media arrives as
    return im.convert(mode)


def _save(im: Image.Image, path: pathlib.Path, quality: int = 84) -> None:
    """Write one finished face. 600px on the long edge is more than a 250px case can
    show, and turns a 6 MB scan into ~40 KB. Written to a temp name and renamed, so a
    reader never catches a half-written JPEG."""
    long = max(im.size)
    if long > 600:
        s = 600 / long
        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))),
                       Image.LANCZOS)
    tmp = path.with_suffix(".tmp")
    im.save(tmp, "JPEG", quality=quality, optimize=True)
    tmp.replace(path)


def _derive(front: Image.Image, ch: float, cd: float) -> dict[str, Image.Image]:
    """The two faces you can honestly make out of a front cover alone.

    The spine is the art's dominant hue at the case's real depth-to-height ratio, so
    it sits in a row of spines at the right width and the right colour. The back is
    the front blurred and darkened — not a lie about what the back says, just a
    surface that reads as "the other side of this box" at a glance."""
    spine = Image.new("RGB", (max(8, round(front.height * cd / max(ch, 1))), front.height),
                      _hex(dominant_hue(front)))
    return {"spine": spine, "back": front.filter(_BLUR).point(lambda p: int(p * 0.42))}


# Which template a manually-uploaded WRAP is sliced with, by platform. A user uploads
# an upright wrap (they orient it themselves with the rotate control), so unlike the
# Cover Project scans there is no rotated-template weirdness here — just the slice ratio
# and the case dimensions.
UPLOAD_TEMPLATE = {
    "Nintendo Switch": "switch", "Nintendo Switch 2": "switch",
    "PlayStation 5": "bluray", "PlayStation 4": "bluray", "PlayStation 3": "bluray",
    "Xbox One": "bluray", "Xbox Series X|S": "bluray", "Xbox 360": "bluray",
    "PlayStation 2": "dvd", "Nintendo Wii": "dvd", "Nintendo Wii U": "dvd",
    "Wii": "dvd", "Wii U": "dvd", "Xbox": "dvd", "Sega Dreamcast": "dvd",
    "Dreamcast": "dvd", "PlayStation": "dvd", "Sega Saturn": "dvd", "Saturn": "dvd",
    "Nintendo GameCube": "gc", "GameCube": "gc",
    "Super Nintendo Entertainment System": "snes", "SNES": "snes",
    "Nintendo Entertainment System": "nes", "NES": "nes",
    "Nintendo 64": "n64", "Sega Genesis": "genesis", "Genesis": "genesis",
}
DEFAULT_UPLOAD_TEMPLATE = "bluray"


# Where a fallback front came from, in the order we'd rather have it. GameTDB first: for a
# Nintendo disc it is the actual printed box, region and all.
_FRONT_SOURCES = (
    ("gtdbCover", "GameTDB"), ("coverUrl", None), ("vnCover", "VNDB"),
    ("adbCover", "Arcade DB"), ("vgcCover", "VGChartz"),
)


def _front(e: dict) -> tuple[str, str]:
    """(url, source name) for a real box front when IGDB has no cover for the game.

    Mirrors coverSrc() in static/enrich.js, minus the IGDB image id (which the shelf already handles
    separately as `cover`). Every one of these URLs was being fetched and stored already —
    the shelf just never knew how to read anything but an IGDB id, so it drew a grey slab.
    """
    for field, label in _FRONT_SOURCES:
        url = e.get(field)
        if url:
            # coverUrl is whatever primary fallback matched (IGN/Steam/LaunchBox/…); the
            # record's own `source` is the honest name for it.
            return url, (label or e.get("source") or "fallback")
    return "", ""


def _front_url(e: dict) -> str:
    return _front(e)[0]


class Shelf:
    def __init__(self, resolved: dict, cache_dir: pathlib.Path,
                 screenscraper: dict | None = None, ss_client=None):
        self._wraps = resolved.get("wraps", {})
        self._hues = resolved.get("hues", {})
        self._dir = cache_dir
        self._dir.mkdir(parents=True, exist_ok=True)
        # User uploads live in their OWN directory, so a CUT_VERSION cache-clear (which
        # only sweeps self._dir) never touches art someone chose by hand. They also take
        # priority over everything: a manual upload is the user correcting us.
        self._udir = cache_dir / "uploads"
        self._udir.mkdir(parents=True, exist_ok=True)
        self._umanifest = self._udir / "manifest.json"
        self._uploads = self._load_uploads()
        # ScreenScraper faces get their own directory for the same reason, plus one of
        # their own: every file in it cost a request against a daily quota, so it must
        # survive a change to how Cover Project wraps are cut.
        # No credentials means no way to fetch any of it, and a row that CLAIMS real art
        # the server can't serve is worse than one that doesn't: the shelf would paint a
        # wall of black rectangles where the spines should be. Checked once, on `enabled`
        # rather than `usable()` — a quota spent halfway through the day must not retire
        # the thousands of faces already sitting on the volume.
        self._ssc = ss_client
        self._ss = (screenscraper or {}).get("games", {}) if (ss_client and ss_client.enabled) else {}
        # On-demand fetching is BOUNDED. /api/shelf/face runs in the request threadpool,
        # the shelf asks for every visible spine at once, and the client is rate-limited
        # to about one request a second — so an unbounded "fetch it when asked" parks
        # dozens of request threads in a queue and the whole app stops answering. Two at
        # a time, and anything past that is simply left to the warm pass, which will get
        # there on its own.
        self._ss_demand = threading.BoundedSemaphore(2)
        self._sdir = cache_dir / "screenscraper"
        self._sdir.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        self._invalidate_stale_cache()
        self._recut_uploads_if_stale()
        self._invalidate_stale_ss()
        self._invalidate_stale_media()
        # Games whose ScreenScraper art turned out to be unusable once fetched (their
        # "no image" placeholder, or a front that failed to decode). Loaded from the
        # volume so the knowledge survives a restart, and added to as the warm crawl
        # discovers more. rows() consults it, so this costs one set lookup per game
        # rather than a filesystem stat. AFTER _invalidate_stale_ss, which may have
        # just swept the markers along with everything else.
        #
        # Built from the KEYS, not from the filenames: safe-naming replaces '/' with
        # '_' and keys contain underscores of their own, so the mapping does not invert.
        self._ss_nofront = {k for k in self._ss
                            if (self._sdir / f"{k.replace('/', '_')}.nofront").exists()}

    def _recut_uploads_if_stale(self) -> None:
        """When the upload SLICING changes, re-cut every upload from its stored original
        so already-broken art fixes itself on deploy. (v2: honour EXIF orientation — a
        3DS wrap uploaded from a phone was sliced sideways into thin strips.)"""
        stamp = self._udir / ".upload-cut-version"
        if stamp.exists() and stamp.read_text().strip() == UPLOAD_CUT_VERSION:
            return
        n = 0
        for key, meta in list(self._uploads.items()):
            orig = self._udir / f"{key.replace('/', '_')}.orig"
            if not orig.exists():
                continue
            try:
                self.set_cover(key, orig.read_bytes(), kind=meta.get("kind", "wrap"),
                               platform="", rotate=meta.get("rotate", 0),
                               x1=meta.get("x1"), x2=meta.get("x2"), case=meta.get("case"),
                               face_rot=meta.get("faceRot", 0))
                n += 1
            except Exception as e:
                log.warning("re-cut upload %s: %s", key, e)
        stamp.write_text(UPLOAD_CUT_VERSION)
        if n:
            log.info("shelf: re-cut %d uploads (v%s)", n, UPLOAD_CUT_VERSION)

    def _load_uploads(self) -> dict:
        try:
            return json.loads(self._umanifest.read_text())
        except Exception:
            return {}

    def _save_uploads(self) -> None:
        tmp = self._umanifest.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._uploads))
        tmp.replace(self._umanifest)

    def _invalidate_stale_cache(self) -> None:
        """Drop the whole cut cache when the cutting logic changed, so a box that was
        sliced wrong the first time gets a fresh, correct cut instead of the old one."""
        stamp = self._dir / ".cut-version"
        if stamp.exists() and stamp.read_text().strip() == CUT_VERSION:
            return
        n = 0
        for f in self._dir.glob("*.jpg"):
            f.unlink(missing_ok=True)
            n += 1
        stamp.write_text(CUT_VERSION)
        if n:
            log.info("shelf: cut logic changed (v%s) — cleared %d cached faces", CUT_VERSION, n)

    def _restamp(self, stamp: pathlib.Path, version: str, markers: list[str], what: str,
                 skip: tuple[str, ...] = ()) -> None:
        """Order a ScreenScraper rebuild WITHOUT emptying the shelf first.

        The wrap cache above deletes its files, and can: they are re-cut from a CDN in
        seconds. These cost quota — thousands of rate-limited requests, an hour or more
        of crawling — and deleting them means every box on the shelf falls back to an
        IGDB cover until the crawl catches up, which is a worse shelf than the one the
        rebuild is fixing. So a rebuild only drops the `.done` STAMPS. The warm crawl
        then walks every game again and each face is overwritten in place, so nothing is
        ever missing: you keep the old picture right up until the new one lands.

        (The one thing this cannot fix is a file the new build would no longer write at
        all — a face that used to be synthesised and now isn't. Nothing has needed that;
        if something ever does, it wants a deliberate sweep of its own, not this.)"""
        if stamp.exists() and stamp.read_text().strip() == version:
            return
        n = 0
        for pat in markers:
            for f in self._sdir.glob(pat):
                if any(f.name.endswith(s) for s in skip):
                    continue
                f.unlink(missing_ok=True)
                n += 1
        stamp.write_text(version)
        if n:
            log.info("shelf: %s build changed (v%s) — %d games queued for a refresh",
                     what, version, n)

    def _invalidate_stale_ss(self) -> None:
        """The faces, on their own version. Only a change to how they are BUILT should
        bump SS_VERSION, never a change elsewhere in the cutting. `.nofront` goes too: a
        game we wrote off as having no usable front deserves to be asked again."""
        # `.media.done` is excluded by name: it is a separate fetch on a separate version,
        # and sweeping it here would re-spend quota on cartridges already sitting there.
        self._restamp(self._sdir / ".ss-version", SS_VERSION,
                      ["*.done", "*.nofront"], "screenscraper", skip=(".media.done",))

    def _invalidate_stale_media(self) -> None:
        """And the same for the cartridges and discs, on MEDIA_VERSION — so a change to
        how a medium is trimmed or stored re-fetches the media without touching a single
        box face."""
        self._restamp(self._sdir / ".media-version", MEDIA_VERSION,
                      ["*.media.done"], "screenscraper media")

    # ---------- what's on the shelf ----------

    def rows(self, games, enrichment) -> list[dict]:
        """The physical games, in the order a real shelf holds them: grouped by platform,
        alphabetical within each — which is how you'd actually find one."""
        out = []
        for g in games:
            if not g.get("owned"):
                continue
            if (g.get("format") or "").strip().lower() not in ("physical", "both"):
                continue                      # a digital game is not an object
            mk = g.get("_k")
            if not mk:
                continue                      # no match key: nothing to hang art off
            # The BOX is keyed by game AND region: title|platform|year collapses a US and
            # a Japanese copy into one entry, and owning Chrono Trigger on both SNES and
            # Super Famicom then put two Super Famicom boxes on the shelf.
            key = f"{mk}#{(g.get('releaseRegion') or '').strip()}"
            up = self._uploads.get(key)
            ss = self._ss.get(key)
            w = self._wraps.get(key)
            e = enrichment.get(mk) or {}
            if up:                            # a manual upload wins over everything
                case, src = up["case"], "upload"
            # A front is the whole claim: without one there is nothing to show and
            # nothing to derive the other faces from, so the game keeps whatever tier it
            # had. resolve_screenscraper.py never writes an entry like that, but rows()
            # is what decides whether the browser asks for faces, and it costs one
            # condition to not take the tool's word for it.
            elif (ss and key not in self._ss_nofront
                  and ((ss.get("faces") or {}).get("front") or ss.get("texture"))):
                # ScreenScraper photographs the faces separately, so unlike a wrap it
                # tells us nothing about the box's SHAPE. This is the STARTING shape —
                # the platform's real case — and the browser then fits the box to the
                # front art it actually receives (see shFitCase), which is the only
                # thing that knows how that particular printing was proportioned.
                mm = case_mm(g.get("platform"))
                case = {"w": mm[0], "h": mm[1], "d": mm[2]}
                src = "ss"
            elif w:
                case, src = w["case"], "wrap"
            else:
                mm = case_mm(g.get("platform"))
                case = {"w": mm[0], "h": mm[1], "d": mm[2]}
                src = "cover" if (e.get("cover") or _front_url(e)) else "blank"
            out.append({
                "k": key,                     # the box (per region)
                "mk": mk,                     # the game, for the detail card
                "t": g.get("title"),
                "p": g.get("platform"),
                "series": g.get("franchise") or "",
                "year": g.get("releaseYear"),
                "done": bool(g.get("completed")),
                "case": case,
                "src": src,
                "region": (up or ss or w or {}).get("region") or "",
                "cover": e.get("cover"),      # IGDB image id, for the fallback front
                # …and a whole URL when IGDB has no art but another source does. A Wii disc
                # IGDB never matched still has a real, region-correct box front on GameTDB's
                # CDN — showing a grey slab instead of it was a choice we were making by
                # accident, because the shelf only ever understood an IGDB image id.
                "coverUrl": _front(e)[0],
                "coverFrom": "IGDB" if e.get("cover") else _front(e)[1],
                "hue": self._hues.get(key, "#6E6E78"),   # the spine when we have no scan
                "uv": (up or {}).get("v"),    # upload version, for cache-busting the faces
                # Is the back a real photograph, or the front blurred? A wrap always
                # carries one; ScreenScraper carries one only when someone scanned it,
                # or when a full box texture came with the game.
                "backReal": bool(
                    up.get("back_is_real") if up else
                    (w or (ss and ("back" in ss.get("faces", {}) or ss.get("texture"))))),
                # Where the box art came from, for the card's badge. Only meaningful for
                # the real-art tiers; the fallback front reports itself via coverFrom.
                "artFrom": "ScreenScraper" if src == "ss" else "",
                # False when the box we found is a different printing from the one you
                # own — they had no US Sonic 2, so you are looking at the PAL box. Still
                # a real box, still worth showing, but the card should not imply it's
                # yours. Only ScreenScraper knows this; a wrap is region-matched by
                # resolve_covers.py before it is ever written.
                "regionOff": bool(src == "ss" and not ss.get("regionMatch", True)),
                # Is there a scan of the thing INSIDE the box — the cartridge, the game
                # card, the printed disc? Read off the manifest, not off the disk: the
                # image is fetched on demand behind /api/shelf/media, exactly like a
                # face, so this says "ask for it" rather than "it is already here".
                # Independent of `src`: a game wearing your own uploaded box art still
                # has ScreenScraper's cartridge sitting inside it.
                "media": bool(ss and ss.get("support")),
                # the upload's own settings, so "Change art" can reopen and re-adjust it
                "upload": up and {"kind": up.get("kind"), "rotate": up.get("rotate", 0),
                                  "faceRot": up.get("faceRot", 0),
                                  "x1": up.get("x1"), "x2": up.get("x2"),
                                  "d": up.get("case", {}).get("d")},
            })
        # Sort titles the way a person alphabetises a shelf: ignore a leading article.
        def alpha(t):
            t = (t or "").lower()
            for a in ("the ", "a ", "an "):
                if t.startswith(a):
                    return t[len(a):]
            return t
        out.sort(key=lambda r: (r["p"] or "", alpha(r["t"])))
        return out

    # ---------- the faces ----------

    def warm(self, delay: float = 0) -> None:
        """Cut every wrap we haven't cut yet, in the background, at boot.

        The shelf asks for 165 spines the moment it opens. Cutting them lazily means
        165 cold requests, each of which downloads a 3-6 MB scan first — so the shelf
        paints black rectangles and fills in over the next several minutes. Do it once,
        up front, and every visit afterwards is served off the volume."""
        todo = [k for k in self._wraps
                if not (self._dir / f"{k.replace('/', '_')}.spine.jpg").exists()]
        if not todo:
            log.info("shelf: all %d wraps already cut", len(self._wraps))
            return

        def run():
            if delay:
                time.sleep(delay)              # let the parse + backfills finish first
            # Strictly serial. This runs in the background and nobody is waiting on it,
            # so there is nothing to buy with concurrency except peak memory — and peak
            # memory is exactly what killed the pod. It is also politer to their CDN.
            for n, k in enumerate(todo, 1):
                self.face(k, "spine")          # _cut writes all three faces at once
                if n % 25 == 0:
                    log.info("shelf: cut %d/%d wraps", n, len(todo))
            log.info("shelf: %d wraps cut and cached", len(todo))

        threading.Thread(target=run, name="shelf-warm", daemon=True).start()

    def _lock(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def face(self, key: str, face: str) -> bytes | None:
        """One face of one box, best available source first. Fetched and cut the first
        time it's asked for, then read off disk forever. Two people pulling the same
        game at once cut it once.

        The chain is per FACE, not per game, and the order is the order of truth:

            1. the owner's own upload          — us being corrected
            2. a ScreenScraper photograph      — that face, actually scanned
            3. the Cover Project wrap's panel  — that face, cut out of a flat scan
            4. a face synthesised from the front (hue spine, blurred back)

        3 sits above 4 deliberately: a game whose only ScreenScraper media is the box
        front still has a REAL spine if Cover Project scanned its wrap, and a real
        spine beats a coloured rectangle every time."""
        if face not in FACES:
            return None
        safe = key.replace("/", "_")
        # A manual upload overrides everything auto-resolved, so it's checked first.
        if key in self._uploads:
            up = self._udir / f"{safe}.{face}.jpg"
            if up.exists():
                return up.read_bytes()

        gen = None
        if key in self._ss:
            # The file we already have wins over rebuilding it. During a refresh (see
            # _restamp) every stamp is gone but every face is still there, and asking the
            # API again to re-learn what is sitting on the disk would park this request
            # thread behind a rate limiter for a picture it could have served instantly.
            # The warm crawl is what refreshes these; a request only ever fills a gap.
            real = self._sdir / f"{safe}.{face}.jpg"
            if real.exists():
                return real.read_bytes()
            self._ss_build(key, safe)
            if real.exists():
                return real.read_bytes()
            gen = self._sdir / f"{safe}.{face}.gen.jpg"

        if key in self._wraps:
            path = self._dir / f"{safe}.{face}.jpg"
            if not path.exists():
                with self._lock(key):
                    if not path.exists():      # someone else may have done it while we waited
                        try:
                            self._cut(key, safe)
                        except Exception as e:
                            log.warning("wrap %s: %s", key, e)
            if path.exists():
                return path.read_bytes()

        return gen.read_bytes() if gen and gen.exists() else None

    # ---------- ScreenScraper faces ----------

    def _ss_build(self, key: str, safe: str, blocking: bool = False) -> None:
        """Fetch this game's ScreenScraper faces once, then never again.

        Guarded by a `.done` stamp rather than by "does the file exist", because the
        common case is a game with a front and NOTHING else: without a stamp, every
        request for its back would hit their API again to rediscover that there isn't
        one. A quota failure deliberately leaves the stamp unwritten, so tomorrow's
        boot picks the game back up where this one gave out.

        `blocking` is the warm pass, which is alone and in no hurry. A request handler
        calls this without it and gives up rather than queue: the face it wanted comes
        back on the next page load, once the warm pass has been past."""
        done = self._sdir / f"{safe}.done"
        if done.exists() or not (self._ssc and self._ssc.usable()):
            return
        if not self._ss_demand.acquire(blocking=blocking):
            return
        try:
            with self._lock(key):
                if done.exists():
                    return
                try:
                    self._ss_fetch(key, safe)
                except Exception as e:
                    # QuotaExceeded lands here too, and must NOT stamp: the game has not
                    # been resolved, it has been postponed.
                    log.warning("screenscraper %s: %s", key, e)
                    return
                done.write_text("1")
        finally:
            self._ss_demand.release()

    def _ss_fetch(self, key: str, safe: str) -> None:
        entry = self._ss[key]
        # The case comes from the live table, via the platform spelled inside the match
        # key ("<title>|<platform>|<year>#<region>"), and only falls back to the copy the
        # resolver stored. Same reason as rows(): a corrected shape has to reach a box
        # whose manifest entry was written months ago.
        plat = key.rsplit("#", 1)[0].split("|")[1] if "|" in key else ""
        stored = entry.get("case") or {}
        mm = (case_mm(plat) if plat.lower() in _CASE_LC else
              (stored.get("w") or DEFAULT_CASE[0], stored.get("h") or DEFAULT_CASE[1],
               stored.get("d") or DEFAULT_CASE[2]))
        cw, ch, cd = float(mm[0]), float(mm[1]), float(mm[2])

        got: dict[str, Image.Image] = {}
        for name in FACES:
            ref = (entry.get("faces") or {}).get(name)
            if not ref:
                continue
            raw = self._ssc.fetch(ref, max_px=900)
            if raw:
                try:
                    im = _decode(raw, 1000)
                    if _placeholder(im):
                        continue           # their "no image" image; let the chain fill it
                    got[name] = _orient(im, cd / max(ch, 1)) if name == "spine" else im
                except Exception as e:
                    log.warning("screenscraper %s %s: %s", key, name, e)

        # A full box TEXTURE is the same thing a Cover Project scan is: back|spine|front
        # flattened into one image. It only gets fetched when a face is still missing,
        # and it only fills the missing ones — a photograph of a face beats a slice of a
        # texture, which may have been trimmed or padded to make a 3D box render.
        if entry.get("texture") and any(n not in got for n in FACES):
            raw = self._ssc.fetch(entry["texture"], max_px=1800)
            if raw:
                try:
                    im = _strip(_decode(raw, 1800))
                    if _placeholder(im):
                        # Expected, and common — a placeholder texture is just this game
                        # not having one. Raising here logged it at WARNING, which turned
                        # an ordinary miss into hundreds of lines of alarm during the warm
                        # crawl and buried the failures that do matter.
                        raise _NoArt
                    total = 2 * cw + cd
                    x1 = round(im.width * cw / total)
                    x2 = round(im.width * (cw + cd) / total)
                    panels = {"back": im.crop((0, 0, x1, im.height)),
                              "spine": im.crop((x1, 0, x2, im.height)),
                              "front": im.crop((x2, 0, im.width, im.height))}
                    for name, panel in panels.items():
                        got.setdefault(name, panel)
                except _NoArt:
                    pass
                except Exception as e:
                    log.warning("screenscraper %s texture: %s", key, e)

        if "front" not in got:
            # Without a front there is nothing to build a box out of and nothing to
            # derive the others from. Remember it, so rows() stops offering this game
            # as one with real art — otherwise the shelf asks for a front that will
            # never come and paints a broken image where the box should be. Measured at
            # 0 of 48, but the cost of being wrong is visible and the fix is a set.
            (self._sdir / f"{safe}.nofront").write_text("1")
            self._ss_nofront.add(key)
            return
        for name, im in got.items():
            _save(im, self._sdir / f"{safe}.{name}.jpg", 84)
        # `.gen` marks a face we made up. face() reaches for it only after the Cover
        # Project wrap has had its turn, so a real panel always wins over a fake one.
        for name, im in _derive(got["front"], ch, cd).items():
            if name not in got:
                _save(im, self._sdir / f"{safe}.{name}.gen.jpg", 82)

    # ---------- what is inside the box ----------

    def media(self, key: str) -> bytes | None:
        """The physical medium of one game — the cartridge, the game card, the printed
        disc — as ScreenScraper rendered it: the whole object, cut out, on transparency.

        Same contract as face(): fetched on first ask, then read off the volume forever,
        and a 404 until the warm pass has been past. Kept apart from the box faces on
        purpose — a game can have a cartridge scan and no box art, or the reverse, and
        neither absence should cost the other a fetch.

        This one WAITS for its turn, unlike a face. A face request is one of dozens the
        shelf fires at once, so giving up instantly is the only way it can behave; a
        medium is one image, asked for because someone just opened one box, and while
        the two warm crawls are running they hold both fetch permits nearly all the
        time — so "give up instantly" means "the cartridge you asked for never arrives
        until the crawl happens to reach it, an hour from now". A permit frees every
        second or two, so a short wait almost always gets one."""
        if key not in self._ss:
            return None
        safe = key.replace("/", "_")
        path = self._sdir / f"{safe}.media.webp"
        if not path.exists():
            self._ss_media_build(key, safe, wait=SS_DEMAND_WAIT)
        return path.read_bytes() if path.exists() else None

    def _ss_media_build(self, key: str, safe: str, blocking: bool = False,
                        wait: float = 0) -> None:
        """Fetch this game's medium once, then never again. Stamped like the faces, on
        its own `.media.done`, so a game with no usable support image is asked about
        exactly once rather than on every request for it.

        Its own lock name, too: a request waiting on the medium must not queue behind
        the same game's box build (three faces plus a texture), which is a much longer
        job than the one it came for."""
        entry = self._ss.get(key) or {}
        ref = entry.get("support")
        done = self._sdir / f"{safe}.media.done"
        if not ref or done.exists() or not (self._ssc and self._ssc.usable()):
            return
        got = (self._ss_demand.acquire(timeout=wait) if wait
               else self._ss_demand.acquire(blocking=blocking))
        if not got:
            return
        try:
            with self._lock(key + "\x00media"):
                if done.exists():
                    return
                try:
                    raw = self._ssc.fetch(ref, max_px=700)
                    if raw:
                        im = _decode(raw, 800, "RGBA")
                        # Their "no image" answer is an image (see _placeholder), and it
                        # arrives here too — a slab of chroma green where a cartridge
                        # should be. Judged on the flattened pixels, since the check is
                        # about colour and the alpha is what we are keeping.
                        if _placeholder(im.convert("RGB")):
                            raise _NoArt
                        # Trim the transparent margin. The object is what we extrude, and
                        # a canvas with 40px of nothing down one side extrudes that empty
                        # strip too — the medium ends up floating off-centre in its box.
                        box = im.getchannel("A").getbbox()
                        if box:
                            im = im.crop(box)
                        _save_cutout(im, self._sdir / f"{safe}.media.webp")
                except _NoArt:
                    pass
                except Exception as e:
                    # QuotaExceeded included: postponed, not resolved, so no stamp.
                    log.warning("screenscraper media %s: %s", key, e)
                    return
                done.write_text("1")
        finally:
            self._ss_demand.release()

    def warm_media(self, delay: float = 0) -> None:
        """Fetch every cartridge and disc we haven't got yet, in the background.

        A second crawl in the shape of warm_screenscraper's, and separate from it for
        the same reason `.media.done` is separate from `.done`: this one is additive —
        it was switched on long after the boxes were cached — so folding it in would
        have meant re-fetching thousands of faces we already hold to reach the media
        sitting next to them."""
        if not (self._ssc and self._ssc.enabled):
            return
        todo = [k for k, e in self._ss.items()
                if e.get("support")
                and not (self._sdir / f"{k.replace('/', '_')}.media.done").exists()]
        if not todo:
            log.info("shelf: all %d screenscraper media already fetched",
                     sum(1 for e in self._ss.values() if e.get("support")))
            return

        def run():
            if delay:
                time.sleep(delay)
            for n, k in enumerate(todo, 1):
                if not self._ssc.usable():
                    log.info("shelf: screenscraper quota spent — media stopped at %d/%d, "
                             "resuming on the next boot", n, len(todo))
                    return
                self._ss_media_build(k, k.replace("/", "_"), blocking=True)
                if n % 50 == 0:
                    log.info("shelf: fetched %d/%d screenscraper media", n, len(todo))
            log.info("shelf: %d screenscraper media fetched and cached", len(todo))

        threading.Thread(target=run, name="shelf-warm-media", daemon=True).start()

    def warm_screenscraper(self, delay: float = 0) -> None:
        """Fetch every ScreenScraper box we haven't fetched yet, in the background.

        This is not the same shape of problem as warming the wraps. There are ~175
        wraps and they come off a CDN with no quota; there are thousands of these and
        every one costs requests against a daily ceiling. So it runs strictly serially
        behind the client's rate limiter, stops the moment the quota says stop, and is
        resumable by construction — the `.done` stamps mean the next boot starts where
        this one stopped rather than at the beginning.

        It has to happen eventually, though, and it may as well be now: the shelf shows
        a SPINE for every game with real art, so the first person to scroll the shelf
        would otherwise trigger a thousand cold fetches at once."""
        if not (self._ssc and self._ssc.enabled):
            return
        todo = [k for k in self._ss if not (self._sdir / f"{k.replace('/', '_')}.done").exists()]
        if not todo:
            log.info("shelf: all %d screenscraper boxes already fetched", len(self._ss))
            return

        def run():
            if delay:
                time.sleep(delay)
            for n, k in enumerate(todo, 1):
                if not self._ssc.usable():
                    log.info("shelf: screenscraper quota spent — stopped at %d/%d, "
                             "resuming on the next boot", n, len(todo))
                    return
                self._ss_build(k, k.replace("/", "_"), blocking=True)
                if n % 50 == 0:
                    log.info("shelf: fetched %d/%d screenscraper boxes", n, len(todo))
            log.info("shelf: %d screenscraper boxes fetched and cached", len(todo))

        threading.Thread(target=run, name="shelf-warm-ss", daemon=True).start()

    # ---------- manual uploads ----------

    def has_upload(self, key: str) -> bool:
        return key in self._uploads

    def uploaded_covers(self) -> dict:
        """{matchKey: {"url": front-face URL, "v": version}} for every manual upload —
        so the grid and drawer can show hand-supplied art as the game's cover, not just
        the shelf. Keyed by match key alone (region dropped); first region wins."""
        from urllib.parse import quote
        out = {}
        for key, up in self._uploads.items():
            mk = key.rsplit("#", 1)[0]
            if mk in out:
                continue
            v = up.get("v", 1)
            # Key in the QUERY string (see api_shelf_face) — a slash in the platform
            # would break a path segment. quote_via keeps it encoded for the value.
            out[mk] = {"url": f"/api/shelf/face?key={quote(key, safe='')}&face=front&v={v}",
                       "v": v}
        return out

    def set_cover(self, key: str, data: bytes, kind: str, platform: str,
                  rotate: int = 0, x1: float | None = None, x2: float | None = None,
                  case: dict | None = None, face_rot: int = 0,
                  crop: dict | None = None) -> dict:
        """Store a user-supplied cover for one game, as three cached faces.

        The shape of the box comes from the IMAGE and the user, not a per-platform table
        (which got a Game Boy box a Blu-ray shape). The editor derives everything and
        passes it in:
          case   — the box's real proportions {w,h,d} in mm; the FRONT face aspect is the
                   uploaded image's own aspect, so nothing is squashed to a template.
          x1,x2  — for a wrap, the spine boundaries as FRACTIONS of width (0..1), which
                   the user drags to line up with their scan. Back is [0,x1], spine
                   [x1,x2], front [x2,1].

        `rotate` (0/90/180/270) is applied to the WHOLE image first, so the user can
        straighten a sideways scan — which is why uploads never need the per-face
        rotation the Cover Project scans do."""
        if kind not in ("wrap", "front"):
            raise ValueError("kind must be 'wrap' or 'front'")
        im = Image.open(io.BytesIO(data))
        # Honour EXIF orientation. A phone photo (or a re-saved scan) can carry an
        # orientation flag that the browser applies automatically — so the editor showed
        # it upright and the guides were placed on that — but PIL does NOT apply it by
        # default, so the server was slicing the raw sideways pixels into thin strips
        # (the "3DS box wrapped vertically" bug). Bake the orientation in, then the
        # server and the editor agree.
        im = ImageOps.exif_transpose(im).convert("RGB")
        if max(im.size) > 2400:                            # sanity cap before any work
            s = 2400 / max(im.size)
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        if rotate % 360:
            im = im.rotate(-(rotate % 360), expand=True)   # clockwise, to match the UI

        # Front-only crop, in fractions of the ROTATED image — the editor drags it against
        # what it is showing, which is the post-rotation picture. Cropping here (before the
        # faces are built) means the spine colour is sampled from the art you kept, not from
        # the scanner margin you threw away.
        if kind == "front" and crop:
            cx1 = max(0.0, min(1.0, float(crop.get("x1", 0.0))))
            cy1 = max(0.0, min(1.0, float(crop.get("y1", 0.0))))
            cx2 = max(0.0, min(1.0, float(crop.get("x2", 1.0))))
            cy2 = max(0.0, min(1.0, float(crop.get("y2", 1.0))))
            l, r = sorted((cx1, cx2))
            t, b = sorted((cy1, cy2))
            box = (round(im.width * l), round(im.height * t),
                   round(im.width * r), round(im.height * b))
            if box[2] - box[0] >= 8 and box[3] - box[1] >= 8:   # ignore a degenerate drag
                im = im.crop(box)

        # The case dims: the editor's numbers if given, else a platform fallback so the
        # older callers and the API without a case still work.
        if case and all(k in case for k in ("w", "h", "d")):
            cw, ch, cd = float(case["w"]), float(case["h"]), float(case["d"])
        else:
            mm = FALLBACK_CASE.get(platform, DEFAULT_CASE)
            cw, ch, cd = float(mm[0]), float(mm[1]), float(mm[2])

        if kind == "wrap":
            if x1 is None or x2 is None:              # fall back to a DVD-ish split
                x1, x2 = 130 / 273, 144 / 273
            c1, c2 = sorted((max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))))
            p1, p2 = round(im.width * c1), round(im.width * c2)
            faces = {
                "back": im.crop((0, 0, p1, im.height)),
                "spine": im.crop((p1, 0, p2, im.height)),
                "front": im.crop((p2, 0, im.width, im.height)),
            }
            # SNES/N64 art is a LANDSCAPE strip whose panels are lying on their side, so
            # the faces need the same per-face turn the Cover Project cut does (_cut):
            #   front — rot90, to stand it up.
            #   back  — rot270. The 3D back face is mirrored (rotateY(180)), and a 90°
            #           turn lands on a mirror differently than a 0° one, so the same
            #           rot90 that fixes the front leaves the back upside-down.
            #   spine — 0. It is already thin-and-tall, the shape the spine face wants;
            #           turning it makes a wide sliver that gets stretched across it.
            if face_rot % 360:
                fr = face_rot % 360
                turn = {"front": fr, "back": (fr + 180) % 360, "spine": 0}
                faces = {n: (p.rotate(turn[n], expand=True) if turn[n] else p)
                         for n, p in faces.items()}
        else:
            faces = {"front": im, **_derive(im, ch, cd)}

        safe = key.replace("/", "_")
        for name, piece in faces.items():
            _save(piece, self._udir / f"{safe}.{name}.jpg", 84)

        # Keep the ORIGINAL upload so "Change art" can reopen it and re-adjust — otherwise
        # we'd only have the sliced faces and couldn't re-drag the spine.
        (self._udir / f"{safe}.orig").write_bytes(data)

        # A monotonic version so the browser refetches after a re-upload — the face URL
        # gets ?v=<n>, which changes even though the path is the same (faces are cached
        # immutably otherwise).
        prev = self._uploads.get(key, {}).get("v", 0)
        entry = {"kind": kind, "region": "user",
                 "back_is_real": kind == "wrap", "v": prev + 1,
                 "rotate": rotate % 360, "faceRot": face_rot % 360,
                 "x1": round(float(x1), 4) if x1 is not None else None,
                 "x2": round(float(x2), 4) if x2 is not None else None,
                 # Keep the crop so reopening re-draws the rectangle over the untouched
                 # original, which is what makes it adjustable rather than destructive.
                 "crop": ({k: round(float(crop[k]), 4) for k in ("x1", "y1", "x2", "y2")}
                          if kind == "front" and crop else None),
                 "case": {"w": round(cw, 1), "h": round(ch, 1), "d": round(cd, 1)}}
        with self._guard:
            self._uploads[key] = entry
            self._save_uploads()
        return entry

    def remove_cover(self, key: str) -> bool:
        """Drop a manual upload, reverting the game to its auto-resolved cover."""
        with self._guard:
            if key not in self._uploads:
                return False
            del self._uploads[key]
            self._save_uploads()
        safe = key.replace("/", "_")
        for name in FACES:
            (self._udir / f"{safe}.{name}.jpg").unlink(missing_ok=True)
        (self._udir / f"{safe}.orig").unlink(missing_ok=True)
        return True

    def original(self, key: str) -> tuple[bytes, str] | None:
        """The raw image the user uploaded, so the editor can reopen and re-adjust it."""
        if key not in self._uploads:
            return None
        p = self._udir / f"{key.replace('/', '_')}.orig"
        if not p.exists():
            return None
        data = p.read_bytes()
        ct = "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else \
             "image/webp" if data[8:12] == b"WEBP" else "image/jpeg"
        return data, ct

    def _cut(self, key: str, safe: str) -> None:
        w = self._wraps[key]
        # We cache OUR OWN slices and never hotlink their CDN. One fetch per game, ever.
        r = requests.get(w["url"], timeout=120, headers={"User-Agent": "gamedex/1.0"})
        r.raise_for_status()

        im = Image.open(io.BytesIO(r.content))
        # These scans are 300-600 dpi. A 3366x2100 JPEG is 6 MB on the wire and TWENTY
        # ONE MEGABYTES decoded — and every crop and rotate copies it again. That OOM-
        # killed the pod at a 512Mi limit. draft() tells libjpeg to decode at a reduced
        # scale in the first place, which is free: we throw the detail away regardless,
        # since no face is ever shown above 600px.
        im.draft("RGB", (1700, 1700))
        im = _strip(im.convert("RGB"))

        back_mm, spine_mm, front_mm, _ = TEMPLATES[w["template"]]
        total = back_mm + spine_mm + front_mm
        x1 = round(im.width * back_mm / total)
        x2 = round(im.width * (back_mm + spine_mm) / total)
        cuts = {
            "back": im.crop((0, 0, x1, im.height)),
            "spine": im.crop((x1, 0, x2, im.height)),
            "front": im.crop((x2, 0, im.width, im.height)),
        }
        # On a rotated-scan platform (SNES, N64) the ART inside each panel is on its
        # side, and the three faces do NOT fix the same way:
        #   spine — already thin-and-tall, the shape the spine face wants. Rotating it
        #     turns it into a wide sliver that gets stretched across the spine.
        #   front — turn it upright: rot90.
        #   back  — turn it the OTHER way: rot270. The back sits on a face that is
        #     mirrored in 3D (rotateY(180)), and a 90-degree turn lands on a mirror
        #     differently than a 0-degree one — so the same rot90 that fixes the front
        #     leaves the back upside-down. The opposite turn cancels the mirror.
        #   (A normal box's back is rot0 and needs no help; its mirror is correct.)
        rot = {"front": w["rot"], "back": (w["rot"] + 180) % 360, "spine": 0} if w["rot"] else {}
        for name, piece in cuts.items():
            if rot.get(name):
                piece = piece.rotate(rot[name], expand=True)
            _save(piece, self._dir / f"{safe}.{name}.jpg", 82)
