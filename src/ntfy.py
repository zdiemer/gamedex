"""Publish to the cluster's ntfy server (infra/ntfy in selfhosted).

NTFY_URL is the topic URL (http://ntfy.infra.svc.cluster.local/gamedex). The
credential is ntfy's write-only `alerts` publisher, copied into this namespace
by tools/provision-ntfy-secret.py. With no NTFY_URL every send is a no-op, so a
local run or a fresh cluster stays quiet instead of erroring.
"""

from __future__ import annotations

import logging
import os

import requests

log = logging.getLogger("gamedex.ntfy")


class Ntfy:
    def __init__(self, url=None, username=None, password=None, click=None):
        self.url = url if url is not None else os.environ.get("NTFY_URL", "")
        self.username = username if username is not None else os.environ.get("NTFY_USERNAME", "")
        self.password = password if password is not None else os.environ.get("NTFY_PASSWORD", "")
        self.click = click if click is not None else os.environ.get("NTFY_CLICK", "")

    @property
    def configured(self):
        return bool(self.url)

    def send(self, title: str, message: str, priority: str = "default", tags: str = "") -> bool:
        """True once ntfy accepted the message; False means try again later."""
        if not self.url:
            return False
        # Header values go out as latin-1: keep titles and tags ASCII.
        headers = {"Title": title, "Priority": priority}
        if tags:
            headers["Tags"] = tags
        if self.click:
            headers["Click"] = self.click
        auth = (self.username, self.password) if self.username else None
        try:
            r = requests.post(self.url, data=message.encode("utf-8"), headers=headers,
                              auth=auth, timeout=10)
        except requests.RequestException as exc:
            log.warning("ntfy: publish failed: %s", type(exc).__name__)
            return False
        if r.status_code >= 300:
            log.warning("ntfy: publish rejected with HTTP %s", r.status_code)
            return False
        return True
