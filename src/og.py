"""The /og.png social card, drawn live.

The checked-in static/og.png froze the library at whatever the counts were the
day it was exported — "14,752 games catalogued" is a stat, and stats drift.
This renders the same 1200x630 card from the live snapshot instead: the
wordmark and counts on the left, the most recent completions' covers as a
full-bleed collage on the right. Covers come through the same PVC-backed
image cache the UI's /api/img proxy uses, so a card render never hits IGDB
twice for the same art.

Fonts: Pillow cannot read woff2, so the repo carries TTF twins of the two
shell fonts (static/fonts/*.ttf) converted from the same OFL sources.
"""
from __future__ import annotations

import io
import logging
import urllib.request

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

log = logging.getLogger("gamedex.og")

W, H = 1200, 630

# The shell's dark-theme palette (:root in static/style.css), so the card and
# the app it unfurls into read as one thing.
BG = (10, 12, 17)          # --bg
TEXT = (233, 237, 244)     # --text
MUTED = (138, 148, 166)    # --muted
DIM = (91, 101, 122)       # --dim
ACCENT = (124, 92, 255)    # --accent

_FONT_DIR = Path(__file__).resolve().parent.parent / "static" / "fonts"

# Collage geometry: the right half is a 3x2 grid of covers bled to the edges.
_COLLAGE_X = 600
_GAP = 4
_COLS, _ROWS = 3, 2
_TILE_W = (W - _COLLAGE_X - (_COLS - 1) * _GAP) // _COLS
_TILE_H = (H - (_ROWS - 1) * _GAP) // _ROWS


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_FONT_DIR / name), size)


def _cover_url(light_entry: dict | None) -> str | None:
    """The same preference order as the UI's coverSrc (static/enrich.js):
    a full URL where the source gave one, else the IGDB image id."""
    if not light_entry:
        return None
    u = light_entry.get("coverUrl")
    if u and u.startswith("http"):
        return u
    cid = light_entry.get("cover")
    if cid:
        return f"https://images.igdb.com/igdb/image/upload/t_cover_big/{cid}.jpg"
    return None


def _cover_bytes(url: str, cache) -> bytes | None:
    hit = cache.get(url) if cache else None
    if hit:
        return hit[0]
    # Cache off (local dev without a writable dir) — fetch directly; the card
    # is rendered at most once a day, so an uncached miss costs nothing.
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "gamedex-og/1.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read()
    except Exception:
        return None


def _collage_tiles(completed: list[dict], light: dict, cache) -> list[Image.Image]:
    """Covers of the most recently finished games, newest first, skipping any
    that won't resolve or fetch — a card with four covers beats no card."""
    recent = sorted((r for r in completed if r.get("date")),
                    key=lambda r: str(r.get("date")), reverse=True)
    tiles: list[Image.Image] = []
    for r in recent:
        url = _cover_url(light.get(r.get("_k")))
        if not url:
            continue
        raw = _cover_bytes(url, cache)
        if not raw:
            continue
        try:
            tiles.append(Image.open(io.BytesIO(raw)).convert("RGB"))
        except Exception:
            continue
        if len(tiles) == _COLS * _ROWS:
            break
    return tiles


def render_og(snapshot: dict, light: dict, img_cache) -> bytes:
    data = (snapshot or {}).get("data") or {}
    games = (data.get("games") or {}).get("rows") or []
    completed = (data.get("completed") or {}).get("rows") or []
    hours = sum(r.get("playTime") or 0 for r in completed)

    img = Image.new("RGB", (W, H), BG)

    # ---- right: the collage --------------------------------------------
    tiles = _collage_tiles(completed, light or {}, img_cache)
    for i, tile in enumerate(tiles):
        col, row = i % _COLS, i // _COLS
        fitted = ImageOps.fit(tile, (_TILE_W, _TILE_H), Image.LANCZOS)
        img.paste(fitted, (_COLLAGE_X + col * (_TILE_W + _GAP),
                           row * (_TILE_H + _GAP)))
    if tiles:
        # Fade the collage's left edge into the background so the text side
        # doesn't butt against a hard seam.
        fade_w = 180
        grad = Image.new("L", (fade_w, 1))
        for x in range(fade_w):
            grad.putpixel((x, 0), 255 - int(x * 255 / (fade_w - 1)))
        grad = grad.resize((fade_w, H))
        img.paste(Image.new("RGB", (fade_w, H), BG), (_COLLAGE_X, 0), grad)

    # ---- left: wordmark, tagline, counts -------------------------------
    draw = ImageDraw.Draw(img)
    x = 64

    wordmark = _font("archivo-800.ttf", 82)
    draw.text((x, 56), "Game", font=wordmark, fill=TEXT)
    draw.text((x + draw.textlength("Game", font=wordmark), 56), "dex",
              font=wordmark, fill=MUTED)

    num_f = _font("archivo-800.ttf", 54)
    lbl_f = _font("plex-sans.ttf", 26)
    stats = [
        (f"{len(games):,}", "games cataloged"),
        (f"{len(completed):,}", "completed"),
        (f"{int(hours):,}", "hours played"),
    ]
    y0, row_h = 300, 84
    draw.rectangle([x, y0 + 6, x + 4, y0 + row_h * len(stats) - 22], fill=ACCENT)
    for i, (num, label) in enumerate(stats):
        y = y0 + i * row_h
        draw.text((x + 28, y), num, font=num_f, fill=TEXT)
        draw.text((x + 28 + draw.textlength(num, font=num_f) + 18, y + 26),
                  label, font=lbl_f, fill=MUTED)

    draw.text((x, H - 56), "games.zachd.duckdns.org",
              font=_font("plex-sans.ttf", 22), fill=DIM)

    out = io.BytesIO()
    img.save(out, format="PNG", optimize=True)
    return out.getvalue()
