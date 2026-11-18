"""Scraper health checks: probe, confirm, alert once, remind, recover, persist."""
import unittest

import scraper_health as sh
from enrich import Enricher


class FakeClient:
    def __init__(self):
        self.mode = "ok"
        self.calls = 0

    def match(self, title, platform, year):
        self.calls += 1
        if self.mode == "raise":
            raise KeyError("hpKey")
        return {"name": title} if self.mode == "ok" else None


class FakeNtfy:
    def __init__(self):
        self.sent = []
        self.accept = True

    def send(self, title, message, priority="default", tags=""):
        if self.accept:
            self.sent.append((title, message, priority))
        return self.accept


class Clock:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


class HealthTest(unittest.TestCase):
    def setUp(self):
        self.client = FakeClient()
        self.e = Enricher(None, ":memory:", secondary={"hltb": self.client})
        self.addCleanup(self.e._db.close)
        self.e._sources = ["hltb"]          # leave IGDB out; its client is None here
        self.e._key_meta = {f"k{i}": {"title": f"Game {i}", "platform": "PC", "year": 2020}
                            for i in range(5)}
        self.e._db.executemany("INSERT INTO hltb(match_key,status) VALUES(?,'matched')",
                               [(f"k{i}",) for i in range(5)])
        self.e._db.execute("INSERT INTO hltb(match_key,status,manual) VALUES('m','matched',1)")
        self.clock = Clock()
        self.ntfy = FakeNtfy()
        self.h = self.new_health()

    def new_health(self):
        return sh.ScraperHealth(self.e, notifier=self.ntfy, interval=6 * 3600, clock=self.clock)

    def advance(self, seconds):
        self.clock.t += seconds

    def test_healthy_probe_sends_nothing(self):
        self.h.tick()
        self.assertEqual(self.ntfy.sent, [])
        self.assertEqual(self.h.snapshot()["hltb"]["status"], "ok")
        self.assertEqual(self.client.calls, 1)   # stops at the first canary found

    def test_probe_skips_manual_and_unknown_keys(self):
        keys = {k for k, _m, _x in self.e.probe_keys("hltb", limit=10)}
        self.assertEqual(keys, {f"k{i}" for i in range(5)})

    def test_one_miss_waits_for_confirmation_then_alerts_once(self):
        self.client.mode = "raise"
        self.h.tick()
        self.assertEqual(self.ntfy.sent, [])
        self.assertEqual(self.h.snapshot()["hltb"]["misses"], 1)
        self.assertIn("KeyError", self.h.snapshot()["hltb"]["lastMiss"])
        self.advance(60)
        self.h.tick()                             # recheck not due yet
        self.assertEqual(self.ntfy.sent, [])
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertEqual(len(self.ntfy.sent), 1)
        title, body, priority = self.ntfy.sent[0]
        self.assertEqual(title, "gamedex: hltb is failing")
        self.assertIn("KeyError", body)
        self.assertEqual(priority, "high")
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertEqual(len(self.ntfy.sent), 1)  # no repeat inside the reminder window

    def test_reminder_then_recovery(self):
        self.client.mode = "none"                 # page changed: parses to nothing
        self.h.tick()
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertIn("0/3", self.ntfy.sent[0][1])
        self.advance(sh.REMIND)
        self.h.tick()
        self.assertEqual(self.ntfy.sent[-1][0], "gamedex: hltb still failing")
        self.client.mode = "ok"
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertEqual(self.ntfy.sent[-1][0], "gamedex: hltb recovered")
        self.assertEqual(self.h.snapshot()["hltb"]["status"], "ok")

    def test_undelivered_alert_is_retried(self):
        self.ntfy.accept = False
        self.client.mode = "raise"
        self.h.tick()
        self.advance(sh.RECHECK)
        self.h.tick()
        self.ntfy.accept = True
        self.advance(60)
        self.h.tick()
        self.assertEqual([t for t, _b, _p in self.ntfy.sent], ["gamedex: hltb is failing"])

    def test_error_streak_brings_probe_forward(self):
        self.h.tick()                             # healthy; next probe is 6h out
        self.client.mode = "raise"
        for _ in range(sh.ERROR_STREAK):
            self.h.record_error("hltb", KeyError("hpKey"))
        self.advance(60)
        self.h.tick()                             # streak (1 miss) + failed probe (2)
        self.assertEqual(self.ntfy.sent[0][0], "gamedex: hltb is failing")

    def test_error_streak_cleared_by_good_probe(self):
        self.h.tick()
        for _ in range(sh.ERROR_STREAK):
            self.h.record_error("hltb", RuntimeError("429"))
        self.advance(60)
        self.h.tick()                             # probe matches: a blip, not an outage
        self.assertEqual(self.ntfy.sent, [])
        self.assertEqual(self.h.snapshot()["hltb"]["errorStreak"], 0)

    def test_state_survives_restart(self):
        self.client.mode = "raise"
        self.h.tick()
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertEqual(len(self.ntfy.sent), 1)
        self.h = self.new_health()               # redeploy
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertEqual(len(self.ntfy.sent), 1)  # already alerted; no duplicate
        self.client.mode = "ok"
        self.advance(sh.RECHECK)
        self.h.tick()
        self.assertEqual(self.ntfy.sent[-1][0], "gamedex: hltb recovered")

    def test_nothing_to_probe_is_unknown_not_failing(self):
        self.e._db.execute("DELETE FROM hltb")
        self.h.tick()
        self.assertEqual(self.h.snapshot()["hltb"]["status"], "unknown")
        self.assertEqual(self.ntfy.sent, [])

    def test_describe_strips_query_strings(self):
        msg = sh.describe(RuntimeError("403 for url: https://x.test/api?key=SECRET&q=1"))
        self.assertNotIn("SECRET", msg)
        self.assertTrue(msg.startswith("RuntimeError: 403"))


if __name__ == "__main__":
    unittest.main()
