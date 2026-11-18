"""Health checks for the enrichment scrapers, published to ntfy.

A broken scraper fails quietly. The worker logs a warning and moves on, and once
the library is enriched there is often nothing queued that would hit the broken
code at all. HowLongToBeat changed its search handshake in November 2026, and
the only sign was a page of warnings nobody was reading.

There are two signals:

* Passive. Each worker reports every lookup here. `ERROR_STREAK` failed
  lookups in a row count as one miss and bring that source's probe forward.
* Probe. Every `interval` seconds, each source re-runs `probes` lookups for
  games it matched before (Enricher.probe_keys). A working scraper should find
  at least one of them again. If none come back, the source is re-probed after
  `RECHECK` seconds, and a second miss marks it failing. Raising and returning
  nothing both count as a miss: a changed page usually parses to nothing rather
  than throwing.

A failing source gets one ntfy alert, a reminder every `REMIND` seconds while
it stays down, and a recovery notice once a probe matches again. A failing
source is re-probed every `RECHECK` seconds, so recovery shows up promptly.
State is kept in the enricher's kv table, so a redeploy neither repeats an
alert nor forgets one.

Error text is reduced to the exception type plus a message with query strings
removed. Some clients put API keys in the query string, and this goes to a phone.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone

log = logging.getLogger("gamedex.scraper_health")

ERROR_STREAK = 10
RECHECK = 15 * 60
REMIND = 24 * 60 * 60
_KV = "scraper_health"


def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat(timespec="seconds") if ts else None


def describe(exc) -> str:
    text = re.sub(r"\?\S*", "?...", str(exc)).strip()
    text = f"{type(exc).__name__}: {text}" if text else type(exc).__name__
    return text[:200]


class ScraperHealth:
    def __init__(self, enricher, notifier=None, interval=6 * 3600, probes=3,
                 start_delay=15 * 60, clock=time.time):
        self._e = enricher
        self.notifier = notifier
        self.interval = interval
        self.probes = probes
        self.start_delay = start_delay
        self._clock = clock
        self._lock = threading.Lock()
        self._streak: dict[str, int] = {}
        self._streak_error: dict[str, str] = {}
        self._state: dict[str, dict] = {}
        self._loaded = False
        self._thread = None

    # -- passive signal (called from the enricher's worker threads) ---------------
    def record_success(self, src):
        if self._streak.get(src):
            with self._lock:
                self._streak[src] = 0

    def record_error(self, src, exc):
        with self._lock:
            self._streak[src] = self._streak.get(src, 0) + 1
            self._streak_error[src] = describe(exc)

    # -- state ---------------------------------------------------------------------
    def _load(self):
        if self._loaded:
            return
        try:
            raw = self._e._kv_get(_KV)
            self._state = json.loads(raw) if raw else {}
        except (ValueError, TypeError):
            self._state = {}
        self._loaded = True

    def _save(self):
        self._e._kv_set(_KV, json.dumps(self._state, sort_keys=True))

    def _st(self, src):
        return self._state.setdefault(src, {
            "failing": False, "since": None, "reason": None, "misses": 0,
            "alerted": False, "lastAlert": 0, "lastProbe": 0, "lastOk": None,
            "nextProbe": 0,
        })

    def snapshot(self):
        with self._lock:
            self._load()
            out = {}
            for src in self._e._sources:
                st = dict(self._state.get(src) or {})
                out[src] = {
                    "status": "failing" if st.get("failing") else ("ok" if st.get("lastOk") else "unknown"),
                    "since": st.get("since"), "reason": st.get("reason"),
                    "lastProbe": _iso(st.get("lastProbe")), "lastOk": st.get("lastOk"),
                    "errorStreak": self._streak.get(src, 0),
                }
            return out

    # -- probing -------------------------------------------------------------------
    def _client_ready(self, src):
        if src == "igdb":
            return True
        client = self._e._secondary.get(src)
        return client is not None and getattr(client, "ready", True)

    def probe(self, src):
        """(ok, detail). ok is None when there is nothing to probe with yet."""
        canaries = self._e.probe_keys(src, self.probes)
        if not canaries:
            return None, "no previously matched games to probe with"
        errors = []
        for _key, meta, extra in canaries:
            try:
                if self._e.fetch(src, meta, **extra):
                    return True, None
            except Exception as exc:  # noqa: BLE001 — any failure is the signal
                errors.append(describe(exc))
        detail = f"0/{len(canaries)} previously matched games found again"
        if errors:
            detail += f"; {len(errors)} raised, e.g. {errors[0]}"
        return False, detail

    # -- the loop ------------------------------------------------------------------
    def tick(self):
        """One pass: fold in the passive signal, run due probes, send what's owed."""
        now = self._clock()
        with self._lock:
            self._load()
            streaks = {s: (n, self._streak_error.get(s)) for s, n in self._streak.items()}
        for src in self._e._sources:
            if self._e._stop.is_set():
                return
            st = self._st(src)
            n, err = streaks.get(src, (0, None))
            if n >= ERROR_STREAK and not st["failing"] and st["misses"] == 0:
                # Counts as one miss and brings the probe forward: a probe that
                # also misses confirms it, and one that matches clears it, so a
                # burst of 429s does not page on its own.
                st["misses"] = 1
                st["nextProbe"] = now
                log.warning("scraper health: %s: %d lookups in a row failed (%s); probing",
                            src, n, err)
            if now < st["nextProbe"] or not self._client_ready(src):
                continue
            ok, detail = self.probe(src)
            now = self._clock()
            st["lastProbe"] = now
            if ok is None:
                st["nextProbe"] = now + self.interval
            elif ok:
                st["misses"] = 0
                with self._lock:
                    self._streak[src] = 0
                st["lastOk"] = _iso(now)
                if st["failing"]:
                    self._resolve(src, st, now)
                st["nextProbe"] = now + self.interval
            else:
                st["misses"] += 1
                if st["misses"] >= 2 and not st["failing"]:
                    self._mark_failing(st, now, detail)
                elif st["failing"]:
                    st["reason"] = detail
                st["nextProbe"] = now + RECHECK
            with self._lock:
                self._save()
        self._deliver(now)
        with self._lock:
            self._save()

    def _mark_failing(self, st, now, reason):
        st.update(failing=True, since=_iso(now), reason=reason, alerted=False, lastAlert=0)

    def _resolve(self, src, st, now):
        alerted = st["alerted"]
        down = st["since"]
        st.update(failing=False, since=None, reason=None, alerted=False, lastAlert=0, misses=0)
        if alerted and self.notifier:
            # Best effort: a lost recovery notice is the cheap failure mode here.
            self.notifier.send(f"gamedex: {src} recovered",
                               f"{src} is matching games again (failing since {down}).",
                               priority="default", tags="white_check_mark")
        log.info("scraper health: %s recovered", src)

    def _deliver(self, now):
        if not self.notifier:
            return
        for src, st in self._state.items():
            if not st.get("failing"):
                continue
            if st["alerted"] and now - st["lastAlert"] < REMIND:
                continue
            first = not st["alerted"]
            title = f"gamedex: {src} {'is failing' if first else 'still failing'}"
            body = f"{st['reason']}\nFailing since {st['since']}."
            if st.get("lastOk"):
                body += f" Last good probe {st['lastOk']}."
            if self.notifier.send(title, body, priority="high" if first else "default",
                                  tags="warning"):
                st["alerted"] = True
                st["lastAlert"] = now
                log.warning("scraper health: %s failing, ntfy sent: %s", src, st["reason"])

    def start(self):
        if self._thread:
            return
        self._thread = threading.Thread(target=self._run, name="scraper-health", daemon=True)
        self._thread.start()

    def _run(self):
        if self._e._stop.wait(self.start_delay):
            return
        while not self._e._stop.is_set():
            try:
                self.tick()
            except Exception:  # noqa: BLE001 — the checker must outlive its own bugs
                log.exception("scraper health: tick failed")
            self._e._stop.wait(60)
