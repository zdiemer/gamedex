"""A tiny monotonic-spacing rate limiter.

Every third-party client here (IGDB, HLTB, the storefront/achievement scrapers,
the platform-account clients) throttles itself the same way: allow at most N
calls per second, spacing them evenly. It lived in igdb.py for historical
reasons — the IGDB client was the first to need it — but it knows nothing about
IGDB, so it's its own module now and everyone imports it from here.

Thread-safe: the backfill runs several worker threads through one client, so the
spacing has to hold across all of them, not per-thread.
"""

from __future__ import annotations

import threading
import time


class RateLimiter:
    """Allow at most `rate` calls per second (monotonic spacing).

    `rate` may be fractional for slow ceilings — RateLimiter(200 / 3600) is
    200 requests/hour. wait() blocks the caller until the next slot is due.
    """

    def __init__(self, rate: float = 4):
        self._min_gap = 1.0 / rate
        self._lock = threading.Lock()
        self._next = 0.0

    def wait(self):
        with self._lock:
            now = time.monotonic()
            if now < self._next:
                time.sleep(self._next - now)
                now = time.monotonic()
            self._next = now + self._min_gap
