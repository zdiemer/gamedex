"""The manual's front cover, as an image, for the inside of the box lid.

The shelf's 3D case swings open and the booklet should visibly sit in the lid —
which means an <img>, not a PDF. The PDFs live on archive.org and are cached
whole by the manual AssetCache; this module derives a small JPEG of page 1 from
that copy and keeps it on the PVC, so pulling a box never waits on a 40 MB
download to draw a 40 KB picture.

Derived files, not fetched files — so this is modelled on Shelf's slice cache
(disk file → exists? read : compute under a lock), NOT a third AssetCache. And
the covers deliberately live OUTSIDE the PDF cache's LRU: evicting a big PDF to
make room must never take its little cover with it. Covers are never evicted;
the whole library of them costs less than a handful of the PDFs they came from.

The one wrinkle is what page 1 actually is. Some scans lead with the front
cover alone; others lead with the booklet unfolded flat — back and front as one
wide page, stapled edge in the middle. Measured against real Archive scans, the
docs come in three shapes: all singles (Twilight Princess: every page 0.58),
all spreads (Star Fox Assault: every page 1.18 — including page 1, which is
back+front), and a lone cover followed by spreads (Four Swords Adventures:
0.59 then 1.17s). So page 1 is judged two ways, in order:

  1. RELATIVE, when the doc has more pages: a page ~2x as wide as the body of
     the document is the unfolded pair regardless of its absolute shape, and a
     page ~half as wide is the lone cover. This is what gets the mixed docs
     right at every booklet size.
  2. ABSOLUTE, when the doc is uniform (all singles and all spreads look alike
     relatively): the widest single cover a hinged case can hold is a jewel
     booklet (square, ~1.0 with scan borders), and the narrowest spread is a
     GameCube pair (measured 1.17-1.19; singles 0.58). 1.12 splits the two
     populations with margin on both sides.

Spread → keep the right half, because on an unfolded western booklet the
binding is on the left and the front cover is the right leaf.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from pathlib import Path

import pymupdf

log = logging.getLogger("manualcover")

# In the FILENAME, like Shelf's CUT_VERSION: bumping it orphans every cached
# cover (and every failure marker) and re-renders lazily on next request.
COVER_VERSION = "1"

_WIDE = 1.12          # uniform docs: page-1 w/h above this = a spread (see module docstring)
_REL_SPREAD = 1.5     # page 1 this much wider than the doc's body = a spread at any size
_REL_SINGLE = 0.75    # page 1 this much narrower than the body = a lone cover at any size
_PROBE_PAGES = 5      # how far into the doc the body median looks
_TARGET_W = 640       # px; the lid is 300–500 css px on screen, 640 covers 1.5x DPR
_MAX_ZOOM = 4.0       # a tiny page rect must not explode into a giant raster
_JPG_QUALITY = 80


class ManualCovers:
    def __init__(self, cover_dir, pdf_cache):
        self._pdfs = pdf_cache             # the manual AssetCache: fetch + SSRF guard live there
        self._dir = Path(cover_dir)
        self.enabled = True
        # Locks sharded like assetcache's: 256 buckets stop a double render
        # without leaking one lock per URL ever seen.
        self._locks: dict[str, threading.Lock] = {}
        self._guard = threading.Lock()
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning("manualcover: cannot create %s (%s) — covers disabled", self._dir, e)
            self.enabled = False

    # ---- public -----------------------------------------------------------
    def get(self, url: str) -> bytes | None:
        """The cover JPEG for a manual PDF's URL, rendering it on the first ask.

        None means "no cover": either we couldn't get the PDF right now (transient
        — nothing is written, so a later request retries) or the PDF itself can't
        yield a page (recorded in a marker file, so we never chew the same broken
        PDF twice)."""
        if not self.enabled or not url:
            return None
        path = self._path(url)
        try:
            return path.read_bytes()
        except FileNotFoundError:
            pass
        except Exception as e:
            log.debug("manualcover read %s: %s", path.name, e)
            return None
        if self._err_path(path).exists():
            return None

        with self._lock(path.name[:2]):
            if path.exists():              # someone else rendered while we waited
                try:
                    return path.read_bytes()
                except Exception:
                    return None
            if self._err_path(path).exists():
                return None
            hit = self._pdfs.get(url)      # PVC-cached PDF; fetches (guarded) on a miss
            if hit is None:
                return None                # transient: network, SSRF-refused, over the item cap
            img = self._render(hit[0])
            if img is None:
                # The PDF arrived but cannot yield a cover (encrypted, empty,
                # corrupt). That is a property of the file, not of the moment —
                # mark it and stop asking, until a COVER_VERSION bump retries.
                self._write(self._err_path(path), b"")
                return None
            self._write(path, img)
            return img

    def warm(self, url: str) -> bool:
        """Populate the cover for `url`; True only when cold work was done.

        The pre-warm loop uses the return to pace itself: a disk hit is a stat
        call and deserves no politeness delay, a cold render pulled a PDF off
        archive.org and does."""
        if not self.enabled or not url:
            return False
        path = self._path(url)
        if path.exists() or self._err_path(path).exists():
            return False
        self.get(url)
        return True

    # ---- internals --------------------------------------------------------
    def _path(self, url: str) -> Path:
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return self._dir / key[:2] / f"{key}.v{COVER_VERSION}.jpg"

    @staticmethod
    def _err_path(path: Path) -> Path:
        return path.with_suffix(".err")

    def _lock(self, shard: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(shard, threading.Lock())

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(data)
            tmp.replace(path)              # atomic: a reader never sees a half-written file
        except Exception as e:
            log.debug("manualcover store %s: %s", path.name, e)

    @staticmethod
    def _render(pdf_bytes: bytes) -> bytes | None:
        """Page 1 of the PDF as a JPEG, cropped to the front cover if unfolded."""
        try:
            doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        except Exception as e:
            log.debug("manualcover open: %s", e)
            return None
        try:
            if doc.needs_pass or doc.page_count == 0:
                return None
            page = doc[0]
            r = page.rect                  # rotation already applied
            if r.width <= 0 or r.height <= 0:
                return None
            ar = r.width / r.height
            body = [doc[p].rect for p in range(1, min(doc.page_count, _PROBE_PAGES))]
            body_ars = sorted(b.width / b.height for b in body if b.height > 0)
            spread = ar > _WIDE            # uniform doc (or 1 page): absolute shape decides
            if body_ars:
                med = body_ars[len(body_ars) // 2]
                if ar > med * _REL_SPREAD:
                    spread = True          # twice the body's width: the unfolded pair
                elif ar < med * _REL_SINGLE:
                    spread = False         # half the body's width: the lone cover
            clip = (pymupdf.Rect(r.x0 + r.width / 2, r.y0, r.x1, r.y1)
                    if spread else r)
            zoom = min(_TARGET_W / clip.width, _MAX_ZOOM)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip,
                                  colorspace=pymupdf.csRGB, alpha=False)
            return pix.tobytes("jpeg", jpg_quality=_JPG_QUALITY)
        except Exception as e:
            log.debug("manualcover render: %s", e)
            return None
        finally:
            try:
                doc.close()
            except Exception:
                pass
