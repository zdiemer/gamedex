# Working on Gamedex

Gamedex serves a plain HTML/CSS/JavaScript frontend from `static/` and a Python
FastAPI backend from `src/`. Frontend scripts share globals; their deferred load
order in `static/index.html` is part of the runtime contract. Do not introduce a
framework or build system for routine UI work.

## Component-first UI development

Read [the component library](docs/components.md) before creating or modifying UI.
Search the inventory and existing implementations/callers, then:

1. Use an existing library component whenever it fits.
2. Modify or extend the shared component when a requirement belongs to its
   existing responsibility. Check affected callers rather than copying markup.
3. Create a new component only when existing components cannot reasonably meet
   the requirement. Explain that gap in the change description; the library discovers new files
   automatically. Add an optional interactive example when useful.

All UI implementations belong in grouped folders under `static/components/`.
Use the domain groups documented in `docs/components.md`; keep related renderers
together and avoid a flat directory or duplicate implementations. Top-level feature
modules own fetching, navigation orchestration and business state. Reuse the single
`panels/panel.js` component; source-specific content belongs in the configuration
registry `panels/sources.js`, not another panel component. Preserve source data
rules, escaping and interaction hooks. Feature panels use the same shell with
`className` and `data` hooks. Reuse `controls/pager.js` for pagination and
`lists/poster-card.js` for poster markup/status styling. Use `openUiDialog` for
standard dialogs or `mountUiDialog` for specialized shells; close through the
shared lifecycle before removing their host or leaving their route.

Canonical shell markup also lives in grouped HTML/SVG component files. Edit those
sources and run `python3 tools/components/catalog.py` to regenerate their marked
sections in `static/index.html`. The catalogue recursively covers grouped folders;
its checks reject UI implementations outside them and stale shell templates.
The server and local preview proxy regenerate the library from this folder on
every gallery load; no component registry entry is needed for a new file.
Theme tokens and shared styles live in `static/style.css`; keep feature styles scoped.
Preserve accessibility, selectors used by event delegation, and existing behavior.
Escape data in HTML; keep state and event handlers in the consuming feature.

Browse all UI via **Menu → Admin → Component library** (`/?tab=components`).
Maintain useful isolated examples or app-context entries for UI changes. Discovery
does not depend on them. The image build refreshes `static/components-catalog.js`
automatically; `python3 tools/components/catalog.py` refreshes it for generic static
preview servers and updates canonical shell fragments.
Run `python3 tools/components/catalog.py --check` to prevent inventory drift. Run `node tools/tests/components.cjs`,
`node tools/tests/startup-order.cjs`, and checks relevant to changed consumers.
Check affected UI in light/dark themes and at phone/desktop widths. For API-backed
screens, use the workflow in `tools/mobile-shot/README.md`.

Keep script ordering and the offline shell list in `static/sw.js` in sync when
adding runtime files; update its cache version for changed shell assets. The worker
installs the shell atomically and serves it from its own versioned cache. Never
revalidate individual shell assets into an active release: shared-global scripts
from different builds can prevent startup. Validate cache upgrades with
`tools/tests/service-worker.cjs` and `tools/tests/service-worker-upgrade.cjs`.

`AGENTS.md` is the repository's canonical agent guidance. `CLAUDE.md` imports it;
put shared policy here so both agents follow the same instructions.
