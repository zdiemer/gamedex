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
# Resolve the secret from 1Password into RAM for the life of this run. It is
# never written to a persistent disk, and it is removed on exit.
#
# $SELFHOSTED_LOCAL_VALUES lets a caller supply a path instead. The on-disk
# values.local.yaml is the last resort, for a clone that predates this.
resolve_local_values() {
  local here="$1" rt="" d
  if [[ -n "${SELFHOSTED_LOCAL_VALUES:-}" ]]; then printf '%s\n' "$SELFHOSTED_LOCAL_VALUES"; return 0; fi
  if [[ -f "${here}/values.local.tpl.yaml" ]] && command -v op >/dev/null 2>&1; then
    # A tmpfs, asserted rather than assumed: /tmp is ext4 on some of these hosts,
    # so falling back to it would quietly reintroduce the file this removes.
    for d in "${XDG_RUNTIME_DIR:-}" "/run/user/$(id -u)" /dev/shm; do
      [[ -n "$d" && -d "$d" && -w "$d" ]] || continue
      case "$(stat -f -c %T "$d" 2>/dev/null)" in tmpfs|ramfs) rt="$d"; break ;; esac
    done
    [[ -n "$rt" ]] || { echo "FAIL: no tmpfs available; refusing to write the secret to a disk" >&2; return 1; }
    local f; f="$(mktemp "${rt}/values.local.XXXXXX")" || return 1
    chmod 600 "$f"
    op inject -i "${here}/values.local.tpl.yaml" -o "$f" -f >/dev/null 2>&1 \
      || { rm -f "$f"; echo "FAIL: op inject failed. Signed in?  eval \$(op signin)" >&2; return 1; }
    printf '%s\n' "$f"; return 0
  fi
  printf '%s\n' "${here}/values.local.yaml"
}
LOCAL_VALUES="$(resolve_local_values "$HERE")" || exit 1
[[ "$LOCAL_VALUES" == "${HERE}/"* ]] || trap 'rm -f "$LOCAL_VALUES"' EXIT INT TERM

# NOT `exit 0` any more. This runs from crontab at 03:17, and the old line
# treated a missing values.local.yaml as "nothing to do" — so once the file was
# removed the nightly NAS index would have stopped SILENTLY and SUCCESSFULLY,
# one log line, no alert, indefinitely. A job that cannot do its work has
# failed; say so and let cron's mail/exit status carry it.
[[ -f "$LOCAL_VALUES" ]] || { echo "nas-cron: could not resolve the secret — see values.local.tpl.yaml" >&2; exit 1; }

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
