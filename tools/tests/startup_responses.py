"""Test startup response caching without importing app startup/background workers."""
import ast
import gzip
import hashlib
import json
from pathlib import Path
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
import unittest

from starlette.responses import Response, JSONResponse
from unittest.mock import Mock, patch


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
        self.ns = dict(gzip=gzip, zlib=zlib, hashlib=hashlib, json=json, time=time, Response=Response,
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


class LibraryResponseTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path('src/app.py').read_text())
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name in ('data', 'api_catalogue')]
        for node in functions:
            node.decorator_list = []
            for arg in node.args.args:
                arg.annotation = None
        self.version = self.edver = 1
        self.snap = {'meta': {'sourceHash': 'sheet-1'},
                     'data': {'games': {'rows': [{'title': 'Pokémon', 'score': 8}]}}}
        self.cat = SimpleNamespace(generation=1, stats=lambda: {'generation': self.cat.generation},
                                   payload=Mock(return_value={'games': [[1, 'Pokémon']], 'generation': 1}))
        self.ns = dict(gzip=gzip, zlib=zlib, hashlib=hashlib, json=json, time=time, Response=Response,
                       JSONResponse=JSONResponse, _DATA_TTL=20,
                       _data_response_lock=threading.Lock(), _cat_response_lock=threading.Lock(),
                       _data_cache=dict(ver=None, rows_key=None, ts=0, body=None, etag=None),
                       _data_rows_cache=dict(key=None, body=None), _cat_payload=dict(gen=None, body=None),
                       store=SimpleNamespace(ready=True, snapshot=lambda: self.snap), catalogue=self.cat,
                       enricher=SimpleNamespace(change_count=lambda: self.version,
                                                stats=lambda: {'version': self.version}),
                       translations=None, EDITS=SimpleNamespace(version=lambda: self.edver, counts=lambda: {}))
        exec(compile(ast.Module(body=functions, type_ignores=[]), 'app.py', 'exec'), self.ns)

    def data(self, etag=None):
        return self.ns['data'](SimpleNamespace(headers={'if-none-match': etag} if etag else {}))

    def decoded(self, response):
        decoder = zlib.decompressobj(wbits=31)
        decoded = decoder.decompress(response.body) + decoder.flush()
        self.assertTrue(decoder.eof)
        self.assertEqual(decoder.unused_data, b'', 'browsers require one gzip stream')
        return json.loads(decoded)

    def test_metadata_refresh_reuses_rows_and_revalidates(self):
        first = self.data()
        self.assertEqual(self.decoded(first)['sheets'], self.snap['data'])
        rows = self.ns['_data_rows_cache']['body']
        self.assertEqual(self.data(first.headers['etag']).status_code, 304)
        self.version += 1
        self.ns['_data_cache']['ts'] = 0
        updated = self.data(first.headers['etag'])
        self.assertEqual(updated.status_code, 200)
        self.assertIs(self.ns['_data_rows_cache']['body'], rows)
        self.assertEqual(self.decoded(updated)['meta']['enrichment']['version'], 2)
        self.cat.generation += 1
        self.ns['_data_cache']['ts'] = 0
        newest = self.data(updated.headers['etag'])
        self.assertEqual(self.decoded(newest)['meta']['catalogue']['generation'], 2)
        self.assertNotEqual(newest.headers['etag'], updated.headers['etag'])
        self.assertIs(self.ns['_data_rows_cache']['body'], rows)

    def test_edits_and_workbook_changes_bypass_ttl(self):
        first = self.data()
        self.snap['data']['games']['rows'][0]['score'] = 9
        self.edver += 1
        edited = self.data(first.headers['etag'])
        self.assertEqual(self.decoded(edited)['sheets']['games']['rows'][0]['score'], 9)
        self.snap = {'meta': {'sourceHash': 'sheet-2'}, 'data': {'games': {'rows': []}}}
        replaced = self.data(edited.headers['etag'])
        self.assertEqual(self.decoded(replaced)['sheets'], self.snap['data'])
        self.assertNotEqual(replaced.headers['etag'], edited.headers['etag'])

    def test_failed_metadata_build_does_not_publish_old_rows(self):
        first = self.data()
        self.edver += 1
        self.snap['data']['games']['rows'].append({'title': 'new'})
        self.snap['meta']['bad'] = float('nan')
        with self.assertRaises(ValueError):
            self.data()
        del self.snap['meta']['bad']
        updated = self.data(first.headers['etag'])
        self.assertEqual(len(self.decoded(updated)['sheets']['games']['rows']), 2)

    def test_concurrent_misses_build_once(self):
        with patch.object(zlib, 'compressobj', wraps=zlib.compressobj) as compress:
            with ThreadPoolExecutor(max_workers=8) as pool:
                responses = list(pool.map(lambda _: self.data(), range(16)))
            self.assertEqual(compress.call_count, 1, 'one reusable compressed row prefix')
            self.assertTrue(all(r.body == responses[0].body for r in responses))
        with ThreadPoolExecutor(max_workers=8) as pool:
            responses = list(pool.map(lambda _: self.ns['api_catalogue'](Response()), range(16)))
        self.cat.payload.assert_called_once()
        self.assertEqual(self.decoded(responses[0]), self.cat.payload.return_value)
        self.assertEqual(responses[0].headers['content-encoding'], 'gzip')
        self.cat.generation = 2
        self.cat.payload.return_value = {'games': [[2, 'New']], 'generation': 2}
        self.assertEqual(self.decoded(self.ns['api_catalogue'](Response()))['generation'], 2)
        self.assertEqual(self.cat.payload.call_count, 2)

    def test_not_ready_does_not_cache_empty_data(self):
        self.ns['store'].ready = False
        self.assertEqual(self.data().status_code, 503)
        self.assertIsNone(self.ns['_data_cache']['body'])
        self.cat.generation = 0
        response = Response()
        self.assertFalse(self.ns['api_catalogue'](response)['ready'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.cat.payload.assert_not_called()


if __name__ == '__main__':
    unittest.main()
