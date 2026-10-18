#!/usr/bin/env python3
"""Run with the app dependencies: PYTHONPATH=src python tools/tests/cache_memory.py."""
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from enrich import Enricher


class LightCacheTest(unittest.TestCase):
    def setUp(self):
        self.e = Enricher(None, ":memory:", secondary={"hltb": None})
        self.e._db.executemany(
            "INSERT INTO enrichment(match_key,status,data) VALUES(?,'matched',?)",
            [(f"game-{i:04}", json.dumps({"cover": f"cover-{i}"})) for i in range(600)],
        )
        self.e._db.execute(
            "INSERT INTO hltb(match_key,status,data) VALUES('game-0000','matched',?)",
            (json.dumps({"main": 12}),),
        )
        self.e._db.commit()

    def tearDown(self):
        self.e._db.close()

    def test_concurrent_misses_build_once_across_pages(self):
        barrier = threading.Barrier(12)
        def read(_):
            barrier.wait()
            return self.e.get_all_light()
        with patch("enrich.json.loads", wraps=json.loads) as loads:
            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(pool.map(read, range(12)))
        self.assertEqual(loads.call_count, 601)
        self.assertTrue(all(r is results[0] for r in results))
        self.assertEqual(len(results[0]), 600)
        self.assertEqual(results[0]["game-0000"]["hltbMain"], 12)
        self.assertEqual(results[0]["game-0599"]["cover"], "cover-599")

    def test_refresh_and_failure_preserve_previous_snapshot(self):
        old = self.e.get_all_light()
        self.e._db.execute("UPDATE enrichment SET data=? WHERE match_key='game-0000'",
                           (json.dumps({"cover": "new-cover"}),))
        self.e._db.commit()
        self.e._all_light_ts = 0
        new = self.e.get_all_light()
        self.assertEqual(old["game-0000"]["cover"], "cover-0")
        self.assertEqual(new["game-0000"]["cover"], "new-cover")
        self.e._db.execute("UPDATE enrichment SET data='invalid' WHERE match_key='game-0000'")
        self.e._db.commit()
        self.e._all_light_ts = 0
        with self.assertRaises(json.JSONDecodeError):
            self.e.get_all_light()
        self.assertIs(self.e._all_light_cache, new)
        self.assertTrue(self.e._all_light_lock.acquire(blocking=False))
        self.e._all_light_lock.release()


if __name__ == "__main__":
    unittest.main()
