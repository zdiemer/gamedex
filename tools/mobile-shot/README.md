# mobile-shot

Screenshot the app at a phone viewport from your **working tree** — so you can see a
CSS/JS change rendered before committing or deploying, instead of reasoning about media
queries. It renders `static/` from disk while proxying `/api/*` to a running gamedex, so
you get your uncommitted edits against the live spreadsheet data with no build or deploy.

Built for the workspace pod, which has no browser, no `sudo`, and no port-80 egress for
`apt`. `setup.sh` gets around that: it installs Playwright's `chrome-headless-shell`, then
fetches the shared libraries Chromium needs (plus fontconfig + a font) as `.deb`s over
HTTPS and unpacks them into a private prefix with `dpkg-deb` — nothing touches the system,
and `shot.sh` points `LD_LIBRARY_PATH`/`FONTCONFIG_FILE` at that prefix at run time.

## Use

```bash
tools/mobile-shot/setup.sh          # once per pod (idempotent; ~a minute, downloads ~150MB)
tools/mobile-shot/shot.sh           # → ./mobile-shot.png  (pick tab, 390px wide)
```

`shot.sh` port-forwards `games/svc/gamedex` for data, serves your `static/`, drives the
browser, and stops everything it started on exit.

## Knobs (environment variables)

| var | default | meaning |
|-----|---------|---------|
| `SHOT_OUT` | `./mobile-shot.png` | output file |
| `SHOT_VIEWPORT` | `390x820` | `WxH` CSS px |
| `SHOT_TAB` | `pick` | tab to switch to (`""` = landing view) |
| `SHOT_CLIP` | `.pick-card` | element to crop to (`""` = full page) |
| `SHOT_ROLL_CLICK` / `SHOT_ROLL_UNTIL` | roll `#pickBtn` until `.pick-info .vd` | click one selector until another appears (for the pick tab's random roll) |
| `GAMEDEX_API` | `localhost:18080` | `host:port` of the app to proxy `/api` to |
| `GAMEDEX_PF` | `1` | auto port-forward the cluster pod; set `0` if `GAMEDEX_API` is something you run yourself |
| `PORT` | `18090` | port the local static+proxy server listens on |
| `GAMEDEX_SHOT_HOME` | `~/.cache/gamedex-shot` | where the browser + libs live |

Examples:

```bash
# Another tab, full page, larger phone
SHOT_TAB=home SHOT_CLIP= SHOT_VIEWPORT=414x896 SHOT_OUT=/tmp/home.png tools/mobile-shot/shot.sh

# Point at an instance you're already running (no kubectl)
GAMEDEX_PF=0 GAMEDEX_API=localhost:8080 tools/mobile-shot/shot.sh
```

To screenshot what's **deployed** rather than your working tree, just open the pod directly
— `SHOT_URL=http://localhost:18080/ GAMEDEX_PF=0` after your own port-forward — though the
local-static path is the point of this tool.

## Notes

- The work dir is ephemeral pod storage; re-run `setup.sh` after a pod restart.
- External CDN images (IGDB covers) aren't reachable from the pod, so covers render as
  blank placeholders — expected, and irrelevant to layout/CSS checks.
- `setup.sh` reads `VERSION_CODENAME` from `/etc/os-release` and pulls libs for that Debian
  suite. Older libs load on a newer glibc but not vice-versa, so matching the suite matters;
  the resolver seeds both plain and `t64` package names so it works pre- and post-t64.
