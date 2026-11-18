#!/usr/bin/env python3
"""Copy ntfy's write-only `alerts` publisher password into the games namespace.

The scraper health checker (src/scraper_health.py) publishes to the `gamedex`
ntfy topic. A secretKeyRef cannot cross namespaces, and putting the password in
op://homelab/games-gamedex as well would mean one credential in two vault items,
where the forgotten copy breaks on the next rotation. infra/ntfy seeds the
authoritative row into the cluster from its own vault item, so this copies that.
claude-workspace and talaria do the same.

Run once, and again after rotating the publisher password (the rotation reaches
ntfy on its next pod start, not this Secret). The password is never decoded,
printed, or written to disk.
"""

import json
import subprocess

SOURCE_NAMESPACE = "infra"
SOURCE_SECRET = "ntfy-seed"
SOURCE_KEY = "pw-alerts"
TARGET_NAMESPACE = "games"
TARGET_SECRET = "gamedex-ntfy"

source = json.loads(subprocess.check_output(
    ["kubectl", "-n", SOURCE_NAMESPACE, "get", "secret", SOURCE_SECRET, "-o", "json"]))
password = source["data"].get(SOURCE_KEY)
if not password:
    raise SystemExit(
        f"{SOURCE_NAMESPACE}/{SOURCE_SECRET} has no {SOURCE_KEY}: the ntfy "
        "release has no `alerts` user. See selfhosted infra/ntfy.")

secret = {
    "apiVersion": "v1",
    "kind": "Secret",
    "metadata": {"name": TARGET_SECRET, "namespace": TARGET_NAMESPACE},
    "type": "Opaque",
    "data": {"NTFY_PASSWORD": password},
}
subprocess.run(
    ["kubectl", "apply", "--server-side", f"--field-manager={TARGET_SECRET}", "-f", "-"],
    input=json.dumps(secret).encode(), check=True)
