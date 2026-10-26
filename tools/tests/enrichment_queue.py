"""Bounded queue scheduling and database lock ownership regressions."""
import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from enrich import Enricher


class QueueTest(unittest.TestCase):
    def setUp(self):
        self.e = Enricher(None, ':memory:', secondary={'hltb': None})
        self.addCleanup(self.e._db.close)
        self.e._key_meta = {f'k{i}': {} for i in range(600)}

    def test_bulk_query_budget_and_resolved_results(self):
        self.e._db.executemany(
            "INSERT INTO enrichment(match_key,status) VALUES(?,'no_match')",
            [(f'k{i}',) for i in range(300)])
        statements = []
        self.e._db.set_trace_callback(statements.append)
        self.e.request(list(self.e._key_meta), front=False)
        selects = [s for s in statements if s.startswith('SELECT')]
        self.assertEqual(len(selects), 6)  # three pages, two sources, not 1200 queries
        self.assertEqual(len(self.e._q['igdb']), 300)
        self.assertEqual(len(self.e._q['hltb']), 600)
        self.e.request(['k599', 'k599'])
        self.assertEqual(self.e._q['igdb'][0], 'k599')
        self.assertEqual(len(self.e._q['igdb']), 300)

    def test_queue_lock_available_while_db_is_busy(self):
        waiting = threading.Event()
        original = self.e._db_lock
        class ObservedLock:
            def __enter__(self):
                waiting.set()
                original.acquire()
            def __exit__(self, *args):
                original.release()
        self.e._db_lock = ObservedLock()
        with ThreadPoolExecutor(max_workers=1) as pool:
            original.acquire()
            future = pool.submit(self.e.request, ['k1'])
            try:
                self.assertTrue(waiting.wait(2))
                acquired = self.e._lock.acquire(timeout=1)
                if acquired:
                    self.e._lock.release()
                self.assertTrue(acquired, 'queue lock held while waiting for SQLite')
            finally:
                original.release()
            future.result(timeout=2)

    def test_json_decode_does_not_hold_database_lock(self):
        self.e._db.execute("INSERT INTO enrichment(match_key,status,data) VALUES('k1','matched',?)",
                           (json.dumps({'cover': 'x'}),))
        original = json.loads
        def decode(data):
            acquired = self.e._db_lock.acquire(blocking=False)
            self.assertTrue(acquired)
            if acquired:
                self.e._db_lock.release()
            return original(data)
        with patch('enrich.json.loads', side_effect=decode):
            self.assertEqual(self.e._get('enrichment', ['k1'])['k1'][1]['cover'], 'x')
            self.assertEqual(self.e.all_records()['k1']['cover'], 'x')


if __name__ == '__main__':
    unittest.main()
