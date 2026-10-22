"""Request correlation and timing without a collector or extra dependencies.

Pure ASGI: preserves streaming and measures through response start (including
threadpool queueing and compression). No request bodies, query strings or user
identifiers are logged. GAMEDEX_SLOW_REQUEST_MS controls slow-request logs.
"""
import logging
import time
import uuid

log = logging.getLogger("gamedex.performance")


class PerformanceMiddleware:
    def __init__(self, app, slow_ms=1000):
        self.app = app
        self.slow_ms = slow_ms

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = time.perf_counter()
        request_id = uuid.uuid4().hex
        status = 500
        header_ms = None

        async def timed_send(message):
            nonlocal status, header_ms
            if message["type"] == "http.response.start":
                status = message["status"]
                header_ms = (time.perf_counter() - started) * 1000
                message = dict(message)
                message["headers"] = list(message.get("headers", [])) + [
                    (b"server-timing", f'app;dur={header_ms:.2f}, request;desc="{request_id}"'.encode()),
                    (b"x-request-id", request_id.encode()),
                ]
            await send(message)

        try:
            await self.app(scope, receive, timed_send)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            if elapsed_ms >= self.slow_ms or status >= 500:
                route = getattr(scope.get("route"), "path", "static-or-unmatched")
                log.info("request_id=%s method=%s route=%s status=%d headers_ms=%s total_ms=%.2f",
                         request_id, scope.get("method"), route, status,
                         round(header_ms, 2) if header_ms is not None else None, elapsed_ms)
