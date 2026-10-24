"""Exercise the real static/auth handlers without starting background workers."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
import json
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from component_catalog import catalogue_script
from starlette.concurrency import run_in_threadpool

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles
from starlette.testclient import TestClient


class GalleryAccessTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse(Path('src/app.py').read_text())
        nodes = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef))
                 and n.name in {'RevalidatingStatic', 'current_user'}]
        accounts = SimpleNamespace(resolve_session=lambda token:
                                   {'user_id': 1} if token == 'valid-test-session' else None)
        ns = dict(StaticFiles=StaticFiles, Request=Request, JSONResponse=JSONResponse,
                  RedirectResponse=RedirectResponse, Response=Response, Path=Path,
                  catalogue_script=catalogue_script, run_in_threadpool=run_in_threadpool, ACCOUNTS=accounts, SESSION_COOKIE='gamedex_session')
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'app.py', 'exec'), ns)
        self.handler = ns['RevalidatingStatic']
        app = Starlette(routes=[Mount('/', self.handler(directory='static', html=True))])
        self.client = TestClient(app)

    def test_gallery_requires_admin_on_every_request(self):
        for path in ['/components.html', '/components-gallery.js', '/components-gallery.css', '/components-catalog.js',
                     '/%63omponents.html',
                     '/x/../components.html', '/x/%2e%2e/components.html']:
            with self.subTest(path=path):
                self.client.cookies.clear()
                for token in [None, 'expired-test-session', 'valid-test-session', None]:
                    self.client.cookies.clear()
                    if token:
                        self.client.cookies.set('gamedex_session', token)
                    for method in ['get', 'head']:
                        response = getattr(self.client, method)(path + ("?embedded=1" if "html" in path else ""))
                        self.assertEqual(response.status_code, 200 if token == 'valid-test-session' else 401)
                        self.assertEqual(response.headers['cache-control'], 'private, no-store')
                        self.assertEqual(response.headers['vary'], 'Cookie')

    def test_legacy_gallery_redirects_into_spa(self):
        self.assertEqual(self.client.get('/components.html').status_code, 401)
        self.client.cookies.set('gamedex_session', 'valid-test-session')
        response = self.client.get('/components.html', follow_redirects=False)
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers['location'], '/?tab=components')
        self.assertEqual(response.headers['cache-control'], 'private, no-store')

    def test_catalogue_refreshes_from_folder_without_generation_or_registration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / 'components' / 'new-group' / 'nested'
            folder.mkdir(parents=True)
            (root / 'components-catalog.js').write_text('STALE SNAPSHOT')
            client = TestClient(Starlette(routes=[Mount('/', self.handler(directory=directory, html=True))]))
            client.cookies.set('gamedex_session', 'valid-test-session')
            def entries():
                response = client.get('/components-catalog.js')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['cache-control'], 'private, no-store')
                return json.loads(response.text.split('const COMPONENT_SOURCES = ', 1)[1].rstrip().rstrip(';'))
            self.assertEqual(entries(), [])
            self.assertEqual(client.post('/components-catalog.js').status_code, 405)
            component = folder / 'status.js'
            component.write_text('export const Status = () => "<span>Ready</span>";')
            discovered = entries()
            self.assertEqual(discovered[0]['name'], 'Status')
            self.assertEqual(discovered[0]['category'], 'New Group')
            self.assertEqual(discovered[0]['file'], 'components/new-group/nested/status.js')
            component.write_text('export class StatusCard {}')
            self.assertEqual(entries()[0]['name'], 'StatusCard')
            component.unlink()
            self.assertEqual(entries(), [])
            client.cookies.clear()
            self.assertEqual(client.get('/components-catalog.js').status_code, 401)

    def test_public_runtime_remains_public(self):
        for path in ['/', '/components/controls/primitives.js', '/component-library.js', '/core.js', '/style.css']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-cache')


if __name__ == '__main__':
    unittest.main()
