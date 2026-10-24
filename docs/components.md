# Gamedex component library

Gamedex's library is plain JavaScript HTML builders, shared CSS, and existing
feature-aware components. There is no framework or build step. Start here before
adding UI: reuse a component, extend it if needed, and introduce a new one only
when existing components cannot reasonably express the required behavior.

## Browse the whole site

Sign in and choose **Menu → Admin → Component library** (`/?tab=components`).
The catalogue has three complementary views, searchable by name, category, and
owning file:

- **Isolated examples** call production builders or clone current `index.html`
  markup. They use local fixture data: search fields, avatars, toggles, dropdowns,
  buttons, tags, autocomplete, posters and status variants, drawer heroes/source
  panels, achievements, charts, dialogs, and feedback. They never request live API
  data. Switch light/dark themes and resize to inspect the same implementations.
- **App surfaces** open the real app in an iframe on demand: navigation/account
  forms, facets, table/pagination, complete detail drawers, shelf boxes/media,
  Home, picker, collections/challenges, timelines, statistics, events/themes,
  daily games, jukebox, recommendations, wishlist, translations, and admin tools.
  These use the current library/account and have real app behavior; previews
  explicitly say so. Some components require selecting a game with matching data.
- **Source inventory** indexes UI builders, renderers, and DOM construction across
  every top-level frontend module, including feature-specific UI. Each entry
  names its file/line and shows implementation source. It is a discovery index,
  not a claim that each function is a separately reusable primitive.

The catalogue is an admin-only SPA tab: the app owns navigation, history, and
theme. Its fixture document stays isolated in a frame so sample globals and DOM
IDs cannot overwrite the running app. Leaving the tab disposes its previews.
Legacy `/components.html` links redirect into the SPA. The workbench fills the
available width up to 1500px; selecting an example does not resize its columns.

The app-context previews are deliberately lazy: opening the catalogue alone does
not boot a second app or issue API requests. All gallery-only JS/CSS and HTML are
server-gated and bypass service-worker caching. Production modules stay in their
existing owners; the catalogue does not duplicate their implementations.

`tools/components/catalog.py` generates `static/components-catalog.js`. Run it
when adding/moving UI implementations, and run it with `--check` in validation.
It scans named renderers and functions that construct DOM/markup. For template-only
or unusually named UI, also add a curated entry in `components-gallery.js`; the
scanner cannot infer every component's intended usage or required data.

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
python3 tools/components/catalog.py --check
node tools/tests/components.cjs
node tools/tests/startup-order.cjs
node tools/tests/poster-components.cjs
python tools/tests/component_gallery.py # requires Starlette and httpx
```

When served by Gamedex, `/components.html` and its gallery-only scripts/styles require an
admin session and are never cached by the browser, CDN, or service worker. Sign
in through the app first. The local static-only preview command above is for
development and has no authentication; bind it to localhost on shared machines.

For catalogue and dialog regressions, serve the gallery locally and run
`node tools/tests/component-library.cjs` and `node tools/tests/dialog-components.cjs` with Playwright available on `NODE_PATH`
and `GAMEDEX_UI_URL` set to the server origin. The browser setup and library
environment are the same as `tools/mobile-shot/shot.sh`. For the optional
read-only live-data integration check, run `tools/tests/component-library-live.cjs`
with `GAMEDEX_UI_URL` pointing to that static/API proxy and a nonempty library.
Run `node tools/tests/component-library-spa.cjs` against the same proxy to check
SPA history, admin routing, theme synchronization, responsive sizing, and fixture
isolation. It stubs the signed-in identity locally and blocks API writes.

The static server above supports isolated examples and source browsing. For live
app previews, use the real server or the static/API proxy described in
`tools/mobile-shot/README.md`. Check light/dark, phone/desktop, keyboard focus,
and disabled/empty/loading states. The admin gate is enforced by FastAPI, not
by the local development static server.

For UI changes, search this inventory and existing callers first. Extend a shared
component for a missing variant when that keeps its purpose clear. Add a new
component only for a distinct responsibility or behavior that existing components
cannot reasonably support; explain why in the change description. Avoid speculative
options. Update the generated inventory, the relevant isolated example or app-surface entry,
and behavior tests when
the public contract changes. Migrate the affected callers in the same change.

New app runtime assets must be loaded in dependency order in `static/index.html` and
included in `static/sw.js`'s shell cache. Change the shell version when changing
cached assets so existing installations receive them together.

Gallery-only assets must stay out of the offline shell cache and remain covered by
the static handler's admin gate and the service worker's network-only gallery rule.
