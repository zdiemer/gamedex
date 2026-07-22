#!/usr/bin/env bash
# One-time (idempotent) setup for headless screenshots of the app from inside the
# workspace pod — where there's no browser, no root, and no port-80 egress for apt.
#
# It: installs Playwright + chrome-headless-shell into a private work dir, then fetches
# the shared libraries chrome needs (plus fontconfig + a font) as .debs over HTTPS and
# unpacks them into a prefix with dpkg-deb. Nothing is installed system-wide; shot.sh
# points LD_LIBRARY_PATH + FONTCONFIG_FILE at the work dir at run time.
#
# Everything lands in $GAMEDEX_SHOT_HOME (default ~/.cache/gamedex-shot), outside the
# repo. Safe to re-run — it skips work that's already done. See README.md.

set -euo pipefail

WORK="${GAMEDEX_SHOT_HOME:-$HOME/.cache/gamedex-shot}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="$WORK/prefix"
export PLAYWRIGHT_BROWSERS_PATH="$WORK/ms-playwright"
MIRROR="https://deb.debian.org/debian"

# Match the running release: older libs load fine on a newer glibc, but not the reverse,
# so we must not pull a suite newer than this pod's glibc. VERSION_CODENAME is the suite.
SUITE="$(. /etc/os-release && echo "${VERSION_CODENAME:-bookworm}")"

echo "==> work dir: $WORK   (suite: $SUITE)"
mkdir -p "$WORK" "$PREFIX" "$WORK/debs" "$WORK/fccache"

echo "==> installing Playwright + chrome-headless-shell"
( cd "$WORK"
  [ -f package.json ] || npm init -y >/dev/null 2>&1
  [ -d node_modules/playwright ] || npm i playwright@latest >/dev/null 2>&1
  npx --yes playwright install chromium >/dev/null 2>&1 )

INDEX="$WORK/Packages-$SUITE"
if [ ! -f "$INDEX" ]; then
  echo "==> fetching Debian package index ($SUITE main amd64)"
  curl -fsS --max-time 120 -o "$INDEX.gz" "$MIRROR/dists/$SUITE/main/binary-amd64/Packages.gz"
  gunzip -f "$INDEX.gz"
fi

echo "==> resolving chrome's shared-library closure"
node "$HERE/lib-resolve.js" "$INDEX" > "$WORK/files.txt"
# fontconfig ships the binaries + /etc/fonts; fonts-dejavu-core gives Skia something to
# render. Neither is a lib*, so lib-resolve skips them — add them by hand.
for p in fontconfig fontconfig-config fonts-dejavu-core; do
  grep -A40 "^Package: $p$" "$INDEX" | grep -m1 "^Filename:" | awk '{print $2}' >> "$WORK/files.txt"
done
sort -u "$WORK/files.txt" -o "$WORK/files.txt"

echo "==> downloading + extracting $(grep -c . "$WORK/files.txt") packages"
while read -r f; do
  [ -z "$f" ] && continue
  out="$WORK/debs/$(basename "$f")"
  [ -f "$out" ] || curl -fsS --max-time 90 -o "$out" "$MIRROR/$f"
  dpkg-deb -x "$out" "$PREFIX"
done < "$WORK/files.txt"

echo "==> writing fontconfig config"
cat > "$WORK/fonts.conf" <<XML
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>$PREFIX/usr/share/fonts</dir>
  <cachedir>$WORK/fccache</cachedir>
  <config></config>
</fontconfig>
XML
FC="$(find "$PREFIX" -name fc-cache -type f | head -1 || true)"
if [ -n "$FC" ]; then
  LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu:$PREFIX/lib/x86_64-linux-gnu" \
    FONTCONFIG_FILE="$WORK/fonts.conf" "$FC" -f >/dev/null 2>&1 || true
fi

echo "==> verifying the browser launches"
# Check the headless-shell binary specifically — that's what shot.js launches (headless:true).
# playwright's chromium.executablePath() points at the FULL chromium, which pulls in cairo/
# pango/cups the shell doesn't need; verifying that would demand libs we deliberately skip.
CHROME="$(find "$PLAYWRIGHT_BROWSERS_PATH" -name chrome-headless-shell -type f | head -1)"
[ -n "$CHROME" ] || { echo "!! chrome-headless-shell not found under $PLAYWRIGHT_BROWSERS_PATH"; exit 1; }
missing="$(LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu:$PREFIX/lib/x86_64-linux-gnu" ldd "$CHROME" 2>/dev/null | grep 'not found' || true)"
if [ -n "$missing" ]; then echo "!! still missing libs:"; echo "$missing"; exit 1; fi
LD_LIBRARY_PATH="$PREFIX/usr/lib/x86_64-linux-gnu:$PREFIX/lib/x86_64-linux-gnu" \
  "$CHROME" --headless --no-sandbox --version | head -1

echo "==> ready. Run tools/mobile-shot/shot.sh to capture a screenshot."
