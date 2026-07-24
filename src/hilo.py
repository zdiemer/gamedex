"""Hi-Lo — the daily higher-or-lower, run on the library's own numbers.

One deck a day: a shuffled run of owned games, and a stat dimension that rotates with
the calendar — Metacritic score, hours-to-beat, release year, copies sold (VGChartz),
Steam owners (SteamSpy). You see the current game's number and the next game's cover;
call higher or lower. Right extends the run, wrong ends it, and your score is how far
you got. Ties count as correct — calling a coin-flip wrong is no fun.

Same daily discipline as the Picross and Dexle: candidates shuffled in an order seeded
by the date, the deck cached on the PVC, and the numbers never sent ahead of the guess
— the browser gets one hidden challenger at a time, and each verdict reveals exactly
one value. (Trust-the-client would have been simpler; this way the temptation isn't
even on the wire.)

Practice rounds reuse the engine with a client-minted seed and any dimension, cached
in memory only.
"""

from __future__ import annotations

import hashlib
import json
import logging
import pathlib
import random
from datetime import datetime

log = logging.getLogger("gamedex.hilo")

# dim -> the candidate field it reads. Labels/formatting are the client's business.
DIMS = ("metascore", "hltb", "year", "units", "owners")
MAX_ITEMS = 40          # a perfect run clears the deck; nobody's marathon needs more
MIN_POOL = 12           # fewer than this and the day's dimension isn't a game


class Hilo:
    def __init__(self, cache_dir: str = "/data/hilo"):
        self._dir = pathlib.Path(cache_dir)
        self._dir.mkdir(parents=True, exist_ok=True)
        self._rounds: dict = {}          # practice decks, (seed, dim) -> puz

    # -- deck building -------------------------------------------------------
    @staticmethod
    def _deck(rng: random.Random, dims: list[str], candidates: list[dict]) -> dict | None:
        pool = list(candidates)
        rng.shuffle(pool)
        for dim in dims:
            fit = [g for g in pool if g.get(dim) is not None]
            if len(fit) < MIN_POOL:
                continue
            items = [{"key": g["key"], "title": g["title"], "platform": g.get("platform"),
                      "year": g.get("year"), "cover": g["cover"], "value": g[dim]}
                     for g in fit[:MAX_ITEMS]]
            return {"dim": dim, "items": items}
        return None

    def daily(self, date: str, candidates: list[dict]) -> dict | None:
        """The deck for `date`. `candidates` is [{key,title,platform,year,cover,
        metascore,hltb,units,owners}, ...] with None for stats a game doesn't have."""
        path = self._dir / f"{date}.json"
        if path.exists():
            try:
                return json.loads(path.read_text())
            except Exception:
                pass
        if not candidates:
            return None
        seed = int(hashlib.sha256(("hilo:" + date).encode()).hexdigest()[:12], 16)
        day = datetime.strptime(date, "%Y-%m-%d").toordinal()
        start = day % len(DIMS)
        deck = self._deck(random.Random(seed), list(DIMS[start:] + DIMS[:start]), candidates)
        if not deck:
            log.warning("hilo %s: no dimension had %d candidates", date, MIN_POOL)
            return None
        deck["date"] = date
        path.write_text(json.dumps(deck))
        log.info("hilo %s: %s, %d items", date, deck["dim"], len(deck["items"]))
        return deck

    def round(self, seed: str, dim: str, candidates: list[dict]) -> dict | None:
        """A practice deck: seeded by the client, any (or a chosen) dimension, memory only."""
        key = (seed, dim)
        if key in self._rounds:
            return self._rounds[key]
        if not candidates:
            return None
        h = int(hashlib.sha256(f"hilo:round:{seed}:{dim}".encode()).hexdigest()[:12], 16)
        rng = random.Random(h)
        start = rng.randrange(len(DIMS))
        dims = [dim] if dim in DIMS else list(DIMS[start:] + DIMS[:start])
        deck = self._deck(rng, dims, candidates)
        if not deck:
            return None
        deck["date"] = seed
        if len(self._rounds) > 200:
            self._rounds.pop(next(iter(self._rounds)))
        self._rounds[key] = deck
        return deck

    # -- what the browser sees ----------------------------------------------
    @staticmethod
    def _strip(deck: dict, item: dict) -> dict:
        """A challenger: everything but its number — and for the year dimension the
        year IS the number, so it goes too."""
        out = {k: v for k, v in item.items() if k != "value"}
        if deck["dim"] == "year":
            out.pop("year", None)
        return out

    @staticmethod
    def public(deck: dict) -> dict:
        items = deck["items"]
        return {"date": deck["date"], "dim": deck["dim"], "total": len(items),
                "first": items[0], "next": Hilo._strip(deck, items[1])}

    @staticmethod
    def judge(deck: dict, n: int, direction: str) -> dict:
        """Verdict for guess n (challenger items[n+1] vs current items[n]). Reveals the
        challenger's value either way; hands over the next hidden challenger on a hit."""
        items = deck["items"]
        if not 0 <= n < len(items) - 1:
            return {"ok": False}
        cur, nxt = items[n]["value"], items[n + 1]["value"]
        correct = nxt == cur or (nxt > cur) == (direction == "higher")
        score = n + 1 if correct else n
        cleared = correct and n + 2 >= len(items)
        out = {"ok": True, "correct": correct, "value": nxt, "score": score,
               "over": (not correct) or cleared, "cleared": cleared, "total": len(items)}
        if correct and not cleared:
            out["next"] = Hilo._strip(deck, items[n + 2])
        return out
