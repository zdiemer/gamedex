"""PYTHONPATH=src python3 tools/tests/performance_middleware.py (stdlib only)."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from performance import PerformanceMiddleware


class PerformanceTest(unittest.IsolatedAsyncioTestCase):
    async def test_streaming_headers_correlation_and_safe_log(self):
        messages = []
        scope = {"type": "http", "method": "GET", "query_string": b"secret=hidden",
                 "route": SimpleNamespace(path="/api/detail/{key}")}

        async def app(scope, receive, send):
            await send({"type": "http.response.start", "status": 200,
                        "headers": [(b"server-timing", b"cache;dur=2")]})
            await send({"type": "http.response.body", "body": b"first", "more_body": True})
            await asyncio.sleep(0)
            await send({"type": "http.response.body", "body": b"last"})

        async def send(message):
            messages.append(message)

        with patch("performance.log.info") as log:
            await PerformanceMiddleware(app, slow_ms=0)(scope, None, send)
        headers = messages[0]["headers"]
        request_id = dict(headers)[b"x-request-id"].decode()
        self.assertEqual(len(request_id), 32)
        self.assertIn(request_id.encode(), dict(headers)[b"server-timing"])
        self.assertIn((b"server-timing", b"cache;dur=2"), headers)
        self.assertEqual([m["body"] for m in messages[1:]], [b"first", b"last"])
        self.assertTrue(messages[1]["more_body"])
        logged = str(log.call_args)
        self.assertIn(request_id, logged)
        self.assertIn("/api/detail/{key}", logged)
        self.assertNotIn("secret", logged)

    async def test_exceptions_propagate_and_are_logged(self):
        async def app(*args):
            raise RuntimeError("failed")
        with patch("performance.log.info") as log:
            with self.assertRaises(RuntimeError):
                await PerformanceMiddleware(app)({"type": "http", "method": "GET"}, None, None)
        self.assertEqual(log.call_args.args[4], 500)

    async def test_non_http_passthrough(self):
        calls = []
        async def app(*args):
            calls.append(args)
        scope = {"type": "websocket"}
        await PerformanceMiddleware(app)(scope, None, None)
        self.assertEqual(calls, [(scope, None, None)])


if __name__ == "__main__":
    unittest.main()
