"""Shared game-meta service.

The light per-game fields a card needs — cover, trailer, release date, platforms,
and the tag subset the taste model regresses on — plus a completion time, fetched
by IGDB id and cached process-wide.

This began life inside `/api/wishlist/meta`, but nothing about it is wishlist-
specific: the Recommend tab hangs off exactly the same per-id lookup (both tabs
show catalogue games that aren't in your library). They now share one instance,
so a game looked up for one tab is already warm for the other.

The completion time is IGDB's own game_time_to_beats where it has one (games_light
carries it); where it doesn't, an HLTB title match fills it. HLTB is a ~1/sec
scrape that can stall on rate-limit retries, so it NEVER blocks a response: one
background worker drains a queue, `fetch()` returns the IGDB meta immediately, and
the ids whose time is still resolving come back under `pending` for the caller to
re-poll.
"""

from __future__ import annotations

import threading


class GameMetaService:
    def __init__(self, igdb, hltb=None, hltb_batch: int = 8):
        self._igdb = igdb
        self._hltb = hltb                 # optional HowLongToBeat client (completion-time fallback)
        self._batch = hltb_batch
        self._meta: dict = {}             # igdb_id -> light meta dict | None (negative cache)
        self._hltb_cache: dict = {}       # igdb_id -> {hltbMain,hltbBest,hltbUrl} | None
        self._hltb_busy = threading.Event()

    def prime(self, igdb_id: int, meta: dict):
        """Seed the cache from a hand-made match, so the next fetch is a hit."""
        self._meta[igdb_id] = meta

    def fetch(self, ids) -> dict:
        """`ids`: iterable of int IGDB ids. Returns
        {"items": {str(id): meta}, "pending": [str(id)]} — the meta that's ready now,
        and the ids whose completion time is still resolving in the background."""
        want = list(ids)
        missing = [i for i in want if i not in self._meta]
        if missing:
            try:
                for gid, meta in self._igdb.games_light(missing).items():
                    self._meta[gid] = meta
            except Exception:
                pass
            for i in missing:                       # negative-cache misses too
                self._meta.setdefault(i, None)

        # Which records still need a completion time (IGDB had none, HLTB not yet
        # tried). Queue them for the background worker; report them as pending.
        jobs, pending = [], []
        for i in want:
            rec = self._meta.get(i)
            if not rec or rec.get("hltbBest") is not None or i in self._hltb_cache:
                continue
            if not self._hltb or not rec.get("name"):
                self._hltb_cache[i] = None          # nothing to search on → definite miss
                continue
            pending.append(i)
            plats = rec.get("platforms") or []
            jobs.append((i, rec["name"], plats[0] if plats else None, rec.get("year")))
        # Kick the worker if it's idle. One at a time — HLTB's own rate limiter would
        # serialise concurrent scrapes anyway, and this keeps the queue orderly.
        if jobs and not self._hltb_busy.is_set():
            self._hltb_busy.set()
            threading.Thread(target=self._scrape_hltb_bg, args=(jobs[:self._batch],),
                             daemon=True).start()

        def merged(i):
            rec = dict(self._meta[i])
            h = self._hltb_cache.get(i)
            if h and rec.get("hltbBest") is None:
                rec.update(h)
            return rec

        return {"items": {str(i): merged(i) for i in want if self._meta.get(i)},
                "pending": [str(i) for i in pending]}

    def _scrape_hltb_bg(self, jobs):
        """Fill the HLTB cache for a batch of (igdb_id, name, platform, year)."""
        try:
            for gid, name, plat, year in jobs:
                if gid in self._hltb_cache:
                    continue
                try:
                    d = self._hltb.match(name, plat, year) if self._hltb else None
                except Exception:
                    d = None
                self._hltb_cache[gid] = (
                    {"hltbMain": d.get("main"), "hltbBest": d.get("best"), "hltbUrl": d.get("url")}
                    if d else None)
        finally:
            self._hltb_busy.clear()
