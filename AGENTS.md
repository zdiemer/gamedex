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
   the requirement. Explain that gap in the change description and add the new
   component to the library inventory and gallery where applicable.

Shared primitives live in `static/components.js`; existing domain components
remain in their documented owning files. Theme tokens and shared styles live in
`static/style.css`. Use those tokens and classes; keep feature layout scoped.
Preserve accessibility, selectors used by event delegation, and existing behavior.
Escape data in HTML; keep state and event handlers in the consuming feature.

Browse all UI via **Menu → Admin → Component library** (`/?tab=components`).
Maintain isolated examples or app-context entries for UI changes, and regenerate
`static/components-catalog.js` with `python3 tools/components/catalog.py`.
Run `python3 tools/components/catalog.py --check` to prevent inventory drift. Run `node tools/tests/components.cjs`,
`node tools/tests/startup-order.cjs`, and checks relevant to changed consumers.
Check affected UI in light/dark themes and at phone/desktop widths. For API-backed
screens, use the workflow in `tools/mobile-shot/README.md`.

Keep script ordering and the offline shell list in `static/sw.js` in sync when
adding runtime files; update its cache version for changed shell assets.

`AGENTS.md` is the repository's canonical agent guidance. `CLAUDE.md` imports it;
put shared policy here so both agents follow the same instructions.
