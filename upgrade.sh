#!/usr/bin/env bash
# Apply the current chart + values.local.yaml to the running gamedex release.
#
# Flow:
#   1. helm upgrade --install
#   2. Wait for rollout
#   3. Print pod status
#
# NOTE: if you changed anything under src/, static/, or the Dockerfile, bump the
# tag (Chart.yaml appVersion + values.yaml image.tag move together) and run
# ./build.sh first — it pushes to ghcr.io/zdiemer/gamedex. imagePullPolicy is
# IfNotPresent, so reusing a tag will NOT re-pull.

set -euo pipefail

RELEASE="${RELEASE:-gamedex}"
NAMESPACE="${NAMESPACE:-games}"
HERE="$(cd "$(dirname "$0")" && pwd)"
VALUES="${HERE}/values.yaml"
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

VALUE_ARGS=(-f "$VALUES")
[[ -f "$LOCAL_VALUES" ]] && VALUE_ARGS+=(-f "$LOCAL_VALUES")

K="kubectl -n ${NAMESPACE}"

command -v helm    >/dev/null || { echo "helm required"; exit 1; }
command -v kubectl >/dev/null || { echo "kubectl required"; exit 1; }

echo "==> helm upgrade --install ${RELEASE} ${HERE} -n ${NAMESPACE}"
helm upgrade --install "$RELEASE" "$HERE" -n "$NAMESPACE" "${VALUE_ARGS[@]}"

echo "==> Waiting for ${RELEASE} rollout"
$K rollout status "deployment/${RELEASE}" --timeout=180s

echo "==> Pods"
$K get pods -l app.kubernetes.io/instance="${RELEASE}"

# Refresh which games are on the NAS. This runs HERE, not in the cluster: the ROM library is a CIFS
# share mounted on the workstation and the k3s nodes can't see it (and shouldn't have to). The index
# is read from romnas's download receipts, not by walking 80TiB — see tools/nas_index.py. Warm, it's
# a couple of seconds; if the share isn't mounted it says so and exits 0, because a deploy from
# another machine is not a failed deploy.
NAS_TOKEN="$(python3 - "$LOCAL_VALUES" <<'PY' 2>/dev/null || true
import re, sys, pathlib
t = pathlib.Path(sys.argv[1]).read_text() if pathlib.Path(sys.argv[1]).is_file() else ""
m = re.search(r'^nas:\s*$.*?^\s+token:\s*"?([^"\n]+)"?', t, re.M | re.S)
print(m.group(1) if m else "")
PY
)"
if [[ -n "$NAS_TOKEN" ]]; then
  echo "==> Refreshing the NAS index"
  NAS_TOKEN="$NAS_TOKEN" python3 "${HERE}/tools/nas_index.py" || echo "    (nas index failed — the app keeps the last one)"
else
  echo "==> Skipping the NAS index (no nas.token in values.local.yaml)"
fi
