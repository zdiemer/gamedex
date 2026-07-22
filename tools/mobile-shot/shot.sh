#!/usr/bin/env bash
# Screenshot the app from your working tree at a phone viewport, end to end:
#   1. port-forward the live pod (for /api data)      — unless GAMEDEX_API points elsewhere
#   2. serve static/ from disk + proxy /api to the pod — so it renders YOUR uncommitted edits
#   3. drive headless Chromium and save a screenshot
# Anything it starts, it stops on exit. Run tools/mobile-shot/setup.sh once first.
#
# Common uses:
#   tools/mobile-shot/shot.sh                                  # pick tab, phone, → ./mobile-shot.png
#   SHOT_OUT=/tmp/x.png SHOT_VIEWPORT=414x896 tools/mobile-shot/shot.sh
#   SHOT_TAB=home SHOT_CLIP= tools/mobile-shot/shot.sh         # full-page shot of another tab
# See README.md for every SHOT_* knob and how to point at a non-cluster instance.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${GAMEDEX_SHOT_HOME:-$HOME/.cache/gamedex-shot}"
PREFIX="$WORK/prefix"
PORT="${PORT:-18090}"
GAMEDEX_API="${GAMEDEX_API:-localhost:18080}"
GAMEDEX_PF="${GAMEDEX_PF:-1}"      # 1 = auto port-forward games/svc/gamedex to :18080

[ -d "$WORK/node_modules/playwright" ] && [ -d "$PREFIX" ] || {
  echo "!! not set up yet — run: $HERE/setup.sh"; exit 1; }

export PLAYWRIGHT_BROWSERS_PATH="$WORK/ms-playwright"
export LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu:$PREFIX/lib/x86_64-linux-gnu"
export FONTCONFIG_FILE="$WORK/fonts.conf"
export GAMEDEX_SHOT_HOME="$WORK" GAMEDEX_API PORT

up() { curl -fsS -o /dev/null --max-time 3 "http://$1/" 2>/dev/null; }
pids=()
# Kill AND reap every helper we start. Leaving even one alive (or unreaped) keeps a pipe
# open / a child in the group, which surfaces to the caller as a signal-death exit code.
cleanup() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  for p in "${pids[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done
}
trap cleanup EXIT

if [ "$GAMEDEX_PF" = "1" ] && [ "$GAMEDEX_API" = "localhost:18080" ] && ! up "$GAMEDEX_API"; then
  echo "==> port-forwarding games/svc/gamedex → :18080"
  kubectl -n games port-forward svc/gamedex 18080:8080 </dev/null >/tmp/gamedex-shot-pf.log 2>&1 &
  pids+=($!)
  for _ in $(seq 1 20); do up "$GAMEDEX_API" && break; sleep 0.5; done
fi
up "$GAMEDEX_API" || { echo "!! app not reachable at $GAMEDEX_API (set GAMEDEX_API or GAMEDEX_PF=1)"; exit 1; }

if ! up "localhost:$PORT"; then
  echo "==> serving working-tree static/ on :$PORT"
  node "$HERE/serve.js" </dev/null >/tmp/gamedex-shot-serve.log 2>&1 &
  pids+=($!)
  for _ in $(seq 1 20); do up "localhost:$PORT" && break; sleep 0.3; done
fi

export SHOT_URL="${SHOT_URL:-http://localhost:$PORT/}"
echo "==> rendering ${SHOT_TAB:-pick} @ ${SHOT_VIEWPORT:-390x820}"
node "$HERE/shot.js"
