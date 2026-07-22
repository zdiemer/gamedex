"use strict";
/* Resolve the shared libraries chrome-headless-shell needs, straight out of a Debian
   Packages index, and print the pool paths of the .deb files that provide them.

   Why this exists: the workspace pod is a slim node image with no browser libs, no root,
   and no port-80 egress to run apt. But HTTPS works, dpkg-deb can unpack a .deb without
   root, and a lib loaded via LD_LIBRARY_PATH needs no install step. So setup.sh fetches
   the .debs this prints and extracts them into a private prefix. See README.

   Usage: node lib-resolve.js <Packages-file>   (prints one Filename per line) */

const fs = require("fs");
const packagesPath = process.argv[2];
if (!packagesPath) { console.error("usage: node lib-resolve.js <Packages-file>"); process.exit(2); }

const txt = fs.readFileSync(packagesPath, "utf8");
const pkgs = {};
for (const block of txt.split("\n\n")) {
  if (!block.trim()) continue;
  const g = (k) => { const m = block.match(new RegExp("^" + k + ": (.*)$", "m")); return m ? m[1] : ""; };
  const name = g("Package");
  if (!name || pkgs[name]) continue;        // first (highest-priority) stanza wins
  const deps = (g("Depends") + "," + g("Pre-Depends")).split(",")
    .map((d) => d.trim().split("|")[0].trim().replace(/\s*\(.*\)/, "").replace(/:any$/, ""))
    .filter(Boolean);
  pkgs[name] = { filename: g("Filename"), deps };
}

// Never shadow the base C/C++ runtime that's already loaded into node/chrome — dropping a
// different libc/libstdc++ into LD_LIBRARY_PATH is an instant ABI break.
const DENY = new Set(["libc6", "libgcc-s1", "libstdc++6", "libc-bin", "zlib1g", "gcc-14-base", "libcrypt1"]);

// The direct dependencies chrome-headless-shell reports as "not found" on a bare image.
// Both the plain and the `t64` package names are listed so this resolves on either a
// pre-t64 release (bookworm) or a post-t64 one (trixie+); only the names present in the
// index survive. libfontconfig1/libfreetype6 aren't in chrome's own NEEDED list — it
// dlopens fontconfig, and without it Skia fatals "Not implemented" the moment a web font
// is used — so they're seeded here and setup.sh adds the fontconfig binaries + a font.
const seed = [
  "libx11-6", "libxcomposite1", "libxdamage1", "libxext6", "libxfixes3", "libxrandr2",
  "libasound2", "libatk1.0-0", "libatk1.0-0t64", "libatk-bridge2.0-0", "libatk-bridge2.0-0t64",
  "libatspi2.0-0", "libatspi2.0-0t64", "libdbus-1-3", "libgbm1",
  "libglib2.0-0", "libglib2.0-0t64", "libnspr4", "libnss3", "libxcb1", "libxkbcommon0",
  "libfontconfig1", "libfreetype6",
];

const want = new Set(), queue = [...seed];
while (queue.length) {
  const n = queue.shift();
  if (want.has(n) || DENY.has(n) || !pkgs[n]) continue;
  want.add(n);
  // Follow only lib* dependencies — that's the transitive shared-library closure (libpcre2,
  // libxau, libdrm, …) and skips the debconf/coreutils noise a full solver would drag in.
  for (const d of pkgs[n].deps) if (d.startsWith("lib") && !DENY.has(d) && pkgs[d]) queue.push(d);
}

const files = [...want].map((n) => pkgs[n].filename).filter(Boolean);
console.error(`resolved ${want.size} packages`);
console.log(files.join("\n"));
