# Gamedex component library

Gamedex's library is plain JavaScript HTML builders, shared CSS, and existing
feature-aware components. There is no framework or build step. Start here before
adding UI: reuse a component, extend it if needed, and introduce a new one only
when existing components cannot reasonably express the required behavior.

## Find a component

| Need | Reuse | Owner / styles |
| --- | --- | --- |
| Text action | `buttonHtml(label, options)` | `static/components.js`; `.btn`, `.ghost`, `.danger` |
| Metadata / facet chip | `chipHtml(value, { facet })`, `chips(values, facet)` | `static/components.js`; `.chip`, `.chips`, `.facet-link` |
| Empty results with optional action | `emptyState(title, hint, action, options)` | `static/components.js`; `.empty` |
| Icon / emoji | `icon(id, size)`, `glyph(value, size)` | `static/core.js`; sprite in `static/index.html`, `.ico` |
| Icon-only control | `<button type="button" class="refreshbtn" aria-label="…">` + `icon()` | `static/style.css`; use `disabled` / `.spinning` as needed |
| Compact badge | `<span class="pill">…</span>` | `static/style.css` |
| Game poster | `posterCardHtml(row, { cls, note, attrs })` | `static/table.js`; `.card` and descendants |
| Poster cover + body / summary | `posterContentHtml(row, bodyHtml, { pending })`, `posterSummaryHtml(row, options)` | `static/table.js`; listing, search, Home, challenges |
| Listing / facets / pagination | `renderTable`, `renderGrid`, `renderPager`, existing listing pipeline | `static/table.js`, `static/preview.js`, `static/filters.js` |
| Collapsible game tags | `tagChipsHtml(items)` | `static/hero.js`; delegated actions in `static/chrome.js` |
| Game detail hero / panels | `heroHtml`, `detailHtml`, source panel builders | `static/hero.js`, `static/panels.js` |
| Text prompt / confirmation | `uiPrompt(options)`, `uiConfirm(options)` | `static/components.js`; `.np-*` |
| Dialog lifecycle / shell | `openUiDialog(options)` | `static/components.js`; `.ce-*` / `.np-*` |
| Toast | `showToast(message, iconId)` | `static/chrome.js`; `.toast` |
| Autocomplete | `acAttach(input, getItems)` | `static/core.js`; `.ac-*` |
| Media carousel / lightbox | `wireCarousel`, `openShotSet` | `static/panels.js` |

These existing components remain in their owning files. Do not copy them into a
second implementation just to put everything in one directory. Read their
signatures and callers before using them; domain components require app state.

## Primitive API

`static/components.js` loads immediately after `core.js` and before features.
Its HTML builders are synchronous, return HTML strings, and escape labels and attribute
values (including numbers). They neither fetch data nor attach event handlers.
Dialog helpers also manage DOM insertion and dismissal, as described below.

```js
host.innerHTML = buttonHtml("Clear filters", { id: "clearFilters", variant: "ghost" });
host.querySelector("#clearFilters").addEventListener("click", clearFilters);

chipHtml("Adventure");
chipHtml("Adventure", { facet: "genre" }); // uses existing facet delegation
chips(["Adventure", "Puzzle"], "genre"); // empty array -> empty string

emptyState("No games match", "Try clearing a filter.", "Clear filters");
emptyState("No saved games", "Save a game to see it here.");
// Multiple actionable states on one page need distinct IDs and handlers:
emptyState("No results", "Try another search.", "Reset", { actionId: "resetSearch" });
```

`buttonHtml` options: `id`, `title`, `disabled` (boolean), and `variant`
(`default`, `ghost`, `danger`). It always emits `type="button"`; it is not a
navigation link or a form submit control. Unknown variants throw. For navigation
use an anchor with the shared `.btn` classes and a validated URL; do not emulate
links with buttons. Icon-only buttons need an accessible name. Facet chips retain
the app's existing span/delegation behavior; they are not general-purpose buttons.

`emptyState` retains the existing `#emptyAction` hook used by the listing. Its
fourth argument is optional. Features attach their own action behavior.

Raw HTML is not accepted by these primitives. Older domain helpers such as
`posterCardHtml` accept trusted `note` / `attrs` HTML: escape interpolated data
with `escapeHtml(String(value))`, validate URLs, and never pass API content as
markup. `icon` / `glyph` also expect trusted icon identifiers or escaped content.

## Shared dialogs and posters

`openUiDialog({ html, family, className, panelClass, label, role, onClose,
dismissValue })` returns `{ host, close }`. It owns the shell, backdrop dismissal,
Escape handling (only the top dialog), scroll locking, listener removal, and
restoring the prior focus when possible. `close(result)` is idempotent and calls
`onClose` once. The default family uses `.ce-scrim` / `.ce` and a close button;
`family: "prompt"` uses `.np-scrim` / `.np-box`. Content is **trusted HTML**:
escape data before interpolating it. Callers own initial focus, forms, and business
actions. Close through the returned API instead of removing the host directly.

Prefer `uiPrompt` / `uiConfirm` for simple questions. Auth and edit wrappers retain
their public APIs and use the same lifecycle. Replacing either wrapper closes the
previous dialog, including its listeners. Escape must not dismiss the game drawer
underneath a dialog.

`posterContentHtml` owns the shared cover, pixel-art class, placeholder, VR badge,
and `.card-body`. `pending: true` shows the listing's existing skeleton when no
cover exists. `posterSummaryHtml` owns title and platform/year markup, with optional
trusted `note` and `afterHtml`. `posterCardHtml` composes them for Home/challenges;
listing and search compose their own bodies and retain row maps, status classes,
click handlers, preview wiring, and tour behavior. Do not copy cover markup into
another feature or force feature-specific badges into the shared shell.

## Design and behavior contracts

- `static/style.css` owns the theme tokens (`:root` and the light-theme override),
  fonts, shared classes, responsive rules, and reduced-motion behavior. Use
  `--surface`, `--surface-2`, `--text`, `--muted`, `--accent`, `--border`,
  `--r-sm`, `--font`, and `--display` instead of introducing near-identical values.
- Keep shared styling there; scope feature layout under the feature's root.
  Do not globally override `.btn`, `.chip`, or `.card` for a single screen.
- Preserve focus visibility, labels, disabled semantics, keyboard behavior,
  delegated selectors, and data attributes when extending components.
- Dialogs and overlays must integrate with `syncScrollLock` and existing close /
  focus behavior. Extend the existing dialog rather than writing another shell.
- A reusable builder owns presentation; its caller owns business state, data
  loading, navigation, and event handlers.

## Preview and validate

From the repository root:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory static
# Open http://localhost:8080/components.html
node tools/tests/components.cjs
node tools/tests/startup-order.cjs
node tools/tests/poster-components.cjs
python tools/tests/component_gallery.py # requires Starlette and httpx
```

When served by Gamedex, `/components.html` and its gallery script require an
admin session and are never cached by the browser, CDN, or service worker. Sign
in through the app first. The local static-only preview command above is for
development and has no authentication; bind it to localhost on shared machines.

For dialog lifecycle regressions, serve the gallery locally and run
`node tools/tests/dialog-components.cjs` with Playwright available on `NODE_PATH`
and `GAMEDEX_UI_URL` set to the server origin. The browser setup and library
environment are the same as `tools/mobile-shot/shot.sh`.

The gallery renders the real primitives and shared styles without an API. Toggle
light/dark and check desktop and phone widths, focus, and disabled controls. It
covers primitives; inspect domain components on the corresponding app surfaces
with real data (see `tools/mobile-shot/README.md`).

For UI changes, search this inventory and existing callers first. Extend a shared
component for a missing variant when that keeps its purpose clear. Add a new
component only for a distinct responsibility or behavior that existing components
cannot reasonably support; explain why in the change description. Avoid speculative
options. Update this inventory, gallery where applicable, and behavior tests when
the public contract changes. Migrate the affected callers in the same change.

New runtime assets must be loaded in dependency order in `static/index.html` and
included in `static/sw.js`'s shell cache. Change the shell version when changing
cached assets so existing installations receive them together.
