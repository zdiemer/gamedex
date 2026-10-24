"""Exercise the real static/auth handlers without starting background workers."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
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
                  ACCOUNTS=accounts, SESSION_COOKIE='gamedex_session')
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'app.py', 'exec'), ns)
        app = Starlette(routes=[Mount('/', ns['RevalidatingStatic'](directory='static', html=True))])
        self.client = TestClient(app)

    def test_gallery_requires_admin_on_every_request(self):
        for path in ['/components.html', '/components-gallery.js', '/%63omponents.html',
                     '/x/../components.html', '/x/%2e%2e/components.html']:
            with self.subTest(path=path):
                self.client.cookies.clear()
                for token in [None, 'expired-test-session', 'valid-test-session', None]:
                    self.client.cookies.clear()
                    if token:
                        self.client.cookies.set('gamedex_session', token)
                    for method in ['get', 'head']:
                        response = getattr(self.client, method)(path)
                        self.assertEqual(response.status_code, 200 if token == 'valid-test-session' else 401)
                        self.assertEqual(response.headers['cache-control'], 'private, no-store')
                        self.assertEqual(response.headers['vary'], 'Cookie')

    def test_public_runtime_remains_public(self):
        for path in ['/', '/components.js', '/core.js', '/style.css']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['cache-control'], 'no-cache')


if __name__ == '__main__':
    unittest.main()
