#!/usr/bin/env bash
# Nightly NAS-index push, decoupled from deploys.
#
# upgrade.sh refreshes the index on every rollout, but the ROM library changes
# between deploys too — this is the same push on a crontab. Runs on the
# workstation because only it can see the CIFS mount (the k3s nodes can't and
# shouldn't). Quiet no-op when the share isn't mounted or the token is absent.
#
# Install (idempotent example):
#   (crontab -l 2>/dev/null | grep -v nas_cron.sh; \
#    echo '17 3 * * * /home/zachd/Code/gamedex/tools/nas_cron.sh >> ~/.local/state/gamedex-nas-cron.log 2>&1') | crontab -

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_VALUES="${HERE}/values.local.yaml"
[[ -f "$LOCAL_VALUES" ]] || { echo "nas-cron: no values.local.yaml — skipping"; exit 0; }

NAS_TOKEN="$(python3 - "$LOCAL_VALUES" <<'PY' 2>/dev/null || true
import re, sys, pathlib
t = pathlib.Path(sys.argv[1]).read_text()
m = re.search(r'^nas:\s*$.*?^\s+token:\s*"?([^"\n]+)"?', t, re.M | re.S)
print(m.group(1) if m else "")
PY
)"
[[ -n "$NAS_TOKEN" ]] || { echo "nas-cron: no nas.token — skipping"; exit 0; }

echo "nas-cron: $(date -Is)"
NAS_TOKEN="$NAS_TOKEN" python3 "${HERE}/tools/nas_index.py"
