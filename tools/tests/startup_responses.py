"""Test startup response caching without importing app startup/background workers."""
import ast
import gzip
import hashlib
import json
from pathlib import Path
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import unittest

from starlette.responses import Response


class StartupResponseTest(unittest.TestCase):
    def setUp(self):
        source = Path('src/app.py').read_text()
        tree = ast.parse(source)
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name in ('covers', 'enrichment_all')]
        for node in functions:
            node.decorator_list = []
            node.args.args[0].annotation = None
        self.version = 1
        self.items = {'game': {'cover': 'first', 'genres': ['RPG']}}
        self.e = SimpleNamespace(change_count=lambda: self.version,
                                 get_all_light=lambda: self.items,
                                 get_all_covers=lambda: {'game': {'cover': 'first'}},
                                 resolved_no_match=lambda: ['unmatched'], stats=lambda: {})
        self.ns = dict(gzip=gzip, hashlib=hashlib, json=json, time=time, Response=Response,
                       enricher=self.e, _ENRICH_ALL_TTL=20,
                       _enrich_response_lock=threading.Lock(), _covers_response_lock=threading.Lock())
        for key in ('_enrich_all_cache', '_covers_cache'):
            self.ns[key] = dict(ver=None, ts=0, body=None, etag=None)
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'app.py', 'exec'), self.ns)

    def request(self, name, etag=None):
        return self.ns[name](SimpleNamespace(headers={'if-none-match': etag} if etag else {}))

    def test_enrichment_revalidation_and_changes(self):
        first = self.request('enrichment_all')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(json.loads(gzip.decompress(first.body))['items'], self.items)
        etag = first.headers['etag']
        same = self.request('enrichment_all', etag)
        self.assertEqual(same.status_code, 304)
        self.assertEqual(same.body, b'')
        self.assertEqual(same.headers['cache-control'], 'no-cache')
        self.version += 1
        self.items = {'game': {'cover': 'edited'}}
        self.assertEqual(self.request('enrichment_all', etag).status_code, 304, 'existing TTL applies')
        self.ns['_enrich_all_cache']['ts'] = 0
        changed = self.request('enrichment_all', etag)
        self.assertEqual(changed.status_code, 200)
        self.assertNotEqual(changed.headers['etag'], etag)
        self.assertEqual(json.loads(gzip.decompress(changed.body))['items'], self.items)
        # A fresh process has no cache even if its DB change count happens to match.
        self.ns['_enrich_all_cache'].update(body=None)
        self.items = {'game': {'cover': 'after-restart'}}
        self.assertEqual(self.request('enrichment_all', changed.headers['etag']).status_code, 200)

    def test_covers_do_not_wait_for_full_response(self):
        entered, release = threading.Event(), threading.Event()
        def slow_map():
            entered.set()
            if not release.wait(5):
                raise TimeoutError('test failed to release full response')
            return self.items
        self.e.get_all_light = slow_map
        with ThreadPoolExecutor(max_workers=2) as pool:
            full = pool.submit(self.request, 'enrichment_all')
            self.assertTrue(entered.wait(2))
            try:
                covers = pool.submit(self.request, 'covers').result(timeout=2)
                self.assertEqual(covers.status_code, 200)
                self.assertEqual(self.request('covers', covers.headers['etag']).status_code, 304)
            finally:
                release.set()
            self.assertEqual(full.result().status_code, 200)


if __name__ == '__main__':
    unittest.main()
