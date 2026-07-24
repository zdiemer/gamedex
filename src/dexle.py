"""Dexle — the daily guess-the-game, cut from the library's own metadata.

One game a day, six guesses, and a different KIND of clue depending on the day:

  cover    the box art, zoomed in far too close; each miss zooms out a little
  shot     a screenshot behind frosted glass; each miss wipes it cleaner
  summary  IGDB's blurb with the names blacked out; each miss reveals more of it
  review   MY OWN review of the game, censored the same way — a clue nobody
           else's quiz can have
  ost      a track from the soundtrack; each miss buys a longer listen

The mode rotates with the calendar (ordinal day mod the mode list), so the week has a
rhythm; if no candidate qualifies for the day's mode (no review long enough, no soundtrack
matched) it falls through to the next mode rather than skipping the day.

Like the Picross, candidates are tried in a deterministic order seeded by the date, so
everyone gets the same game, and the chosen puzzle is cached on the PVC. The answer —
and for `ost` the track's song path, which has the album name IN it — never leaves the
server; the browser gets the clue material and nothing that spoils it.

Wrong guesses earn metadata hints (year, platform, genre, developer, first letter) and a
proximity nudge ("right franchise, wrong entry") — both computed here, where the answer is.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pathlib
import random
import re
import unicodedata
from datetime import datetime

log = logging.getLogger("gamedex.dexle")

MAX_GUESSES = 6
MODES = ("cover", "shot", "summary", "review", "ost")
PROBE_CAP = 250            # candidates to try for modes that cost a DB read per probe
MIN_PROSE = 200            # a summary/review shorter than this isn't a clue, it's a caption

_WORD = re.compile(r"[A-Za-z0-9]+")
_WORDU = re.compile(r"[^\W_]+", re.UNICODE)   # like _WORD but accent-aware, for prose
_ROMAN = re.compile(r"^[ivxlcdm]+$", re.I)
_SENT = re.compile(r"(?<=[.!?])\s+")
_PAREN = re.compile(r"\s*\([^)]*\)")
BLOCK = "▇▇▇"


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _fold(w: str) -> str:
    """Accent-blind lowercase: 'Pokémon' and 'Pokemon' must be the same word, or the
    censor waves the franchise name straight through."""
    return unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode().lower()


def _censor_terms(names: list[str]) -> set[str]:
    """The words that give the game away: every meaningful word of its title(s) and
    franchise. Short function words survive ("of", "the"); numerals and roman numerals
    don't — "VII" names the game as surely as "Fantasy" does."""
    terms = set()
    for name in names:
        # Fold BEFORE tokenizing: 'Pokémon' must yield the token 'pokemon', not the
        # é-split shrapnel 'pok'+'mon'.
        for w in _WORD.findall(_fold(name or "")):
            if len(w) >= 3 or w.isdigit() or _ROMAN.match(w):
                terms.add(w)
    return terms


def _censor(text: str, terms: set[str]) -> str:
    # _WORDU, not _WORD: the prose side must keep 'Pokémon' one token too, or the
    # é-split halves never fold back to the term they're hiding.
    return _WORDU.sub(lambda m: BLOCK if _fold(m.group(0)) in terms else m.group(0), text)


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text.strip()) if s.strip()]


def _dur_secs(dur: str | None) -> int:
    """KHInsider's 'M:SS' (or 'H:MM:SS') as seconds; 0 when unparseable."""
    if not dur:
        return 0
    try:
        parts = [int(p) for p in dur.split(":")]
    except ValueError:
        return 0
    out = 0
    for p in parts:
        out = out * 60 + p
    return out


class Dexle:
    def __init__(self, cache_dir: str = "/data/dexle"):
        self._dir = pathlib.Path(cache_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        # Practice rounds, keyed by (seed, mode). Deterministic from the seed, so this is
        # only a cost saver (a shot/summary/ost build probes the DB) — a restart just
        # rebuilds the same round when the next guess arrives.
        self._rounds: dict = {}

    def daily(self, date: str, candidates: list[dict], get_detail, get_ost) -> dict | None:
        """The puzzle for `date`. `candidates` is [{key,title,platform,year,cover,genre,
        developer,franchise,review,rating}, ...]; `get_detail(key)` returns the full IGDB
        record or None, `get_ost(key)` the matched KHInsider album or None.

        Cached: the first request of the day builds it, everyone else reads the file."""
        path = self._dir / f"{date}.json"
        if path.exists():
            try:
                return json.loads(path.read_text())
            except Exception:
                pass
        if not candidates:
            return None

        # Deterministic: same day, same order, same game and mode for everyone.
        seed = int(hashlib.sha256(("dexle:" + date).encode()).hexdigest()[:12], 16)
        rng = random.Random(seed)
        pool = list(candidates)
        rng.shuffle(pool)
        day = datetime.strptime(date, "%Y-%m-%d").toordinal()

        # The calendar picks the day's mode; a mode with no qualifying game falls
        # through to the next rather than costing the day its puzzle.
        start = day % len(MODES)
        for mode in MODES[start:] + MODES[:start]:
            probes = 0
            for g in pool:
                if mode in ("shot", "summary", "ost"):
                    probes += 1                    # these cost a DB read per candidate
                    if probes > PROBE_CAP:
                        break
                puz = self._build(mode, g, rng, get_detail, get_ost)
                if puz:
                    puz["date"] = date
                    path.write_text(json.dumps(puz))
                    log.info("dexle %s: %s (%s) via %s", date, g["title"], g.get("platform"), mode)
                    return puz
        log.warning("dexle %s: no candidate qualified for any mode", date)
        return None

    def round(self, seed: str, mode: str, candidates: list[dict], get_detail, get_ost) -> dict | None:
        """A practice round: same engine as daily(), seeded by a client-minted string
        instead of the calendar, and never written to disk. `mode` is a specific mode
        or "any" (the seed picks). Deterministic per (seed, mode), so a guess can
        rebuild the round even after a restart."""
        key = (seed, mode)
        if key in self._rounds:
            return self._rounds[key]
        if not candidates:
            return None
        h = int(hashlib.sha256(f"dexle:round:{seed}:{mode}".encode()).hexdigest()[:12], 16)
        rng = random.Random(h)
        pool = list(candidates)
        rng.shuffle(pool)
        start = rng.randrange(len(MODES))
        order = [mode] if mode in MODES else list(MODES[start:] + MODES[:start])
        for m in order:
            probes = 0
            for g in pool:
                if m in ("shot", "summary", "ost"):
                    probes += 1
                    if probes > PROBE_CAP:
                        break
                puz = self._build(m, g, rng, get_detail, get_ost)
                if puz:
                    puz["date"] = seed          # public() calls it date; the client echoes it back
                    if len(self._rounds) > 200:
                        self._rounds.pop(next(iter(self._rounds)))
                    self._rounds[key] = puz
                    return puz
        return None

    def _build(self, mode: str, g: dict, rng: random.Random, get_detail, get_ost) -> dict | None:
        """The puzzle dict for one candidate, or None if it can't carry this mode."""
        title = g.get("title") or ""
        if not title or not g.get("cover"):
            return None
        detail = None
        clue: dict | None = None
        song = None

        if mode == "cover":
            clue = {"cover": g["cover"]}
        elif mode == "shot":
            detail = get_detail(g["key"])
            shots = [str(s) for s in ((detail or {}).get("screenshots") or []) if s]
            if not shots:
                return None
            clue = {"shot": rng.choice(shots)}
        elif mode in ("summary", "review"):
            if mode == "summary":
                detail = get_detail(g["key"])
                prose = (detail or {}).get("summary") or ""
            else:
                prose = g.get("review") or ""
            prose = prose.strip()
            if len(prose) < MIN_PROSE:
                return None
            terms = _censor_terms([title, g.get("franchise") or "",
                                   (detail or {}).get("name") or ""])
            sents = _sentences(_censor(prose, terms))
            # A clue that never mentions what it's hiding is a clue that never bit:
            # if censoring removed nothing, the text never names the game — fine.
            if len(sents) < 2:
                return None
            clue = {"sentences": sents}
            if mode == "review" and g.get("rating") is not None:
                clue["rating"] = g["rating"]
        elif mode == "ost":
            album = get_ost(g["key"])
            tracks = (album or {}).get("tracks") or []
            # A proper listen: prefer tracks with some body to them. 45s–6min keeps out
            # both the 8-second jingles and the full-album rips.
            good = [t for t in tracks if 45 <= _dur_secs(t.get("dur")) <= 360]
            pick = rng.choice(good) if good else None
            if not pick or not pick.get("song"):
                return None
            song = pick["song"]
            clue = {"track": {"dur": pick.get("dur")}}
        if not clue:
            return None

        hints = []
        if g.get("year"):
            hints.append({"label": "Released", "value": str(g["year"])})
        if g.get("platform"):
            hints.append({"label": "Platform", "value": str(g["platform"])})
        if g.get("genre"):
            hints.append({"label": "Genre", "value": str(g["genre"])})
        if g.get("developer"):
            hints.append({"label": "Developer", "value": str(g["developer"])})
        hints.append({"label": "First letter", "value": title.strip()[0].upper()})

        # Every spelling that counts as right: the sheet's title, the title without its
        # parenthetical (region/platform tags), and the name IGDB matched it to.
        accept = {_norm(title), _norm(_PAREN.sub("", title))}
        if detail is None and mode not in ("shot", "summary"):
            detail = get_detail(g["key"])
        if (detail or {}).get("name"):
            accept.add(_norm(detail["name"]))
        accept.discard("")

        return {
            "mode": mode, "clue": clue, "hints": hints, "song": song,
            "accept": sorted(accept),
            "answer": {"key": g["key"], "title": title, "platform": g.get("platform"),
                       "year": g.get("year"), "cover": g["cover"]},
        }

    @staticmethod
    def public(puz: dict) -> dict:
        """What the browser is allowed to see: the clue, and nothing that spoils it.
        (For `ost` that includes the song path — the album name is in it.)"""
        return {"date": puz["date"], "mode": puz["mode"], "maxGuesses": MAX_GUESSES,
                "clue": puz["clue"], "hintCount": len(puz["hints"])}

    @staticmethod
    def near(guess: str, puz: dict, candidates: list[dict]) -> str | None:
        """The warmer/colder nudge for a wrong guess, computed where the answer lives.
        Only fields the guessed game actually shares — and franchise outranks the rest,
        because 'right franchise, wrong entry' is the one that stings best."""
        gn = _norm(guess)
        row = next((c for c in candidates if _norm(c.get("title")) == gn), None)
        if not row:
            return None
        ans_key = puz["answer"]["key"]
        ans = next((c for c in candidates if c.get("key") == ans_key), None)
        if not ans:
            return None
        same = lambda f: (row.get(f) and ans.get(f)
                          and _norm(str(row[f])) == _norm(str(ans[f])))
        if same("franchise"):
            return "Right franchise, wrong entry."
        if same("developer"):
            return "Same developer."
        if same("genre"):
            return "Same genre."
        if same("platform"):
            return "Same platform."
        try:
            if abs(int(row.get("year")) - int(ans.get("year"))) <= 2:
                return "Released around the same time."
        except (TypeError, ValueError):
            pass
        return None
