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
  every top-level frontend module and `static/components/`, including feature-specific UI. Each entry
  names its file/line and shows implementation source. It is a discovery index,
  not a claim that each function is a separately reusable primitive.

The catalogue is an admin-only SPA tab: the app owns navigation, history, and
theme. Its fixture document stays isolated in a frame so sample globals and DOM
IDs cannot overwrite the running app. Leaving the tab disposes its previews.
Legacy `/components.html` links redirect into the SPA. The workbench fills the
available width up to 1500px; selecting an example does not resize its columns.

The app-context previews are deliberately lazy: opening the catalogue alone does
not boot a second app or issue API requests. All gallery-only JS/CSS and HTML are
server-gated and bypass service-worker caching. The catalogue uses the production implementations directly.

The library discovers `static/components/` recursively on every admin page load.
New JS/MJS, HTML, SVG, CSS and JSON files appear automatically, including nested
folders and modules without recognizable declarations. Names, source locations and
categories come from the files and folders; no registration list is required.
The scanner reads source without executing newly discovered modules.

`src/component_catalog.py` powers the server, local preview proxy and static
snapshot generator. The Docker build refreshes the snapshot and shell templates
automatically. Curated examples and app-context previews are optional enhancements;
new components are listed with their source even before an example exists.

## Find a component

| Need | Reuse | Owner / styles |
| --- | --- | --- |
| Text action | `buttonHtml(label, options)` | `static/components/controls/primitives.js`; `.btn`, `.ghost`, `.danger` |
| Metadata / facet chip | `chipHtml(value, { facet })`, `chips(values, facet)` | `static/components/controls/primitives.js`; `.chip`, `.chips`, `.facet-link` |
| Empty results with optional action | `emptyState(title, hint, action, options)` | `static/components/controls/primitives.js`; `.empty` |
| Icon / emoji | `icon(id, size)`, `glyph(value, size)` | `static/components/foundations/core.js`; sprite in `static/components/foundations/icons.svg`, `.ico` |
| Icon-only control | `<button type="button" class="refreshbtn" aria-label="…">` + `icon()` | `static/style.css`; use `disabled` / `.spinning` as needed |
| Compact badge | `<span class="pill">…</span>` | `static/style.css` |
| Game poster | `posterCardHtml(row, { cls, note, attrs })` | `static/components/lists/poster-card.js`; `.card` and descendants |
| Poster cover + body / summary | `posterContentHtml(row, bodyHtml, { pending })`, `posterSummaryHtml(row, options)` | `static/components/lists/poster-card.js`; listing, search, Home, challenges |
| Listing / facets / pagination | `renderTable`, `renderGrid`, `renderPager`, existing listing pipeline | `static/components/lists/table.js`, `static/components/lists/preview.js`, `static/components/lists/filters.js` |
| Collapsible game tags | `tagChipsHtml(items)` | `static/components/drawer/drawer-detail.js`; delegated actions in `static/components/navigation/chrome.js` |
| Game detail hero / panels | `heroHtml`, `detailHtml`, shared source panel | `static/components/drawer/hero.js`, `static/components/drawer/drawer-detail.js`, `static/components/panels/panel.js` |
| Text prompt / confirmation | `uiPrompt(options)`, `uiConfirm(options)` | `static/components/controls/dialog.js`; `.np-*` |
| Dialog lifecycle / shell | `openUiDialog(options)` | `static/components/controls/dialog.js`; `.ce-*` / `.np-*` |
| Toast | `showToast(message, iconId)` | `static/components/navigation/chrome.js`; `.toast` |
| Autocomplete | `acAttach(input, getItems)` | `static/components/foundations/core.js`; `.ac-*` |
| Media carousel / lightbox | `wireCarousel`, `openShotSet` | `static/components/media/media-carousel.js` |

## Component file boundaries

All indexed UI implementations live under `static/components/`, grouped by domain.
Related renderers share a module; the inventory counts implementations, not files.

| Folder | Responsibility |
| --- | --- |
| `foundations/` | Icons, formatting, autocomplete and sprite |
| `controls/` | Buttons, chips, empty states, dialogs and search fields |
| `navigation/` | Header, sidebar, account controls, palette and app navigation UI |
| `lists/` | Posters, grids, tables, search, facets, pagination and timelines |
| `drawer/` | Hero, detail, relationships and drawer composition |
| `panels/` | One generic panel and its source-data configurations |
| `account/` | Personal progress, achievements and screenshots |
| `admin/` | Editors, health, mapping and library UI |
| `discovery/` | Home, picker and random-game UI |
| `collections/` | Collections, groups and challenges |
| `statistics/` | Charts, stats and review UI |
| `recommendations/` | Recommendations, swipe, wishlist and translations |
| `games/` | Daily game interfaces |
| `events/` | Seasonal events and theme UI |
| `media/` | Carousel, lightbox, soundtracks, jukebox and attract mode |
| `shelf/` | Physical media, manuals and shelf UI |
| `feedback/` | Loading, progress and status |

Top-level feature modules retain state, fetching and orchestration. Components use
the same shared globals and public APIs; no framework or runtime bundler is needed.
Component declarations load before the controller that can invoke them. Update
both HTML script manifests and the service-worker shell whenever a file moves.

`tools/components/locations.json` only maps former feature-file locations to
component declarations for VM tests. It is not a component registry and is not
used to discover the library. New files require no entry there. The catalogue
maintenance check still rejects UI renderers outside `components/`.

Static UI also has canonical component sources: header, sidebar, listing toolbar,
mobile controls, drawer, lightbox, palette, attract overlay, status and icon sprite.
Edit their grouped HTML/SVG files, then run `python3 tools/components/catalog.py`.
It refreshes the marked sections of `index.html` alongside the catalogue. These
sections are included in the initial HTML, so they add no runtime requests or
startup race. `--check` detects drift between the component source and served shell.

### One panel, multiple configurations

`panels/panel.js` exports `panelHtml({ headingHtml, bodyHtml })`,
`panelRowHtml({ labelHtml, valueHtml, className, valueClass })` and
`sourcePanelHtml(source, data)`. A null configuration hides the panel; omitting
the heading supports compact panels such as critic scores. HTML arguments are
**trusted renderer fragments**; adapters escape all external text and URLs.

`panels/sources.js` is a configuration registry, not a collection of separate
panel components. Its adapters retain each source's data rules, links, media,
availability and formatting. Add a configuration for a new source and reuse the
panel and row renderers. The gallery shows one generic panel example plus source
variants. The drawer keeps its existing order and PC/platform/admin gates.

## Primitive API

`static/components/controls/primitives.js` loads immediately after `core.js` and before features.
These HTML builders are synchronous, return HTML strings, and escape labels and attribute
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
PORT=8080 node tools/mobile-shot/serve.js
# Open http://localhost:8080/components.html
python3 tools/components/catalog.py --check
node tools/tests/components.cjs
node tools/tests/startup-order.cjs
node tools/tests/poster-components.cjs
python tools/tests/component_gallery.py # requires Starlette and httpx
```

When served by Gamedex, `/components.html` and its gallery-only scripts/styles require an
admin session and are never cached by the browser, CDN, or service worker. Sign
in through the app first. The local preview proxy above is for development and has no authentication;
use it only in a trusted development environment.

For automatic discovery, run `node tools/tests/component-library-discovery.cjs`
against the preview proxy. It adds/removes a temporary component and checks the
gallery after each reload without regeneration.

For catalogue and dialog regressions, serve the gallery locally and run
`node tools/tests/component-library.cjs` and `node tools/tests/dialog-components.cjs` with Playwright available on `NODE_PATH`
and `GAMEDEX_UI_URL` set to the server origin. The browser setup and library
environment are the same as `tools/mobile-shot/shot.sh`. For the optional
read-only live-data integration check, run `tools/tests/component-library-live.cjs`
with `GAMEDEX_UI_URL` pointing to that static/API proxy and a nonempty library.
Run `node tools/tests/component-library-spa.cjs` against the same proxy to check
SPA history, admin routing, theme synchronization, responsive sizing, and fixture
isolation. It stubs the signed-in identity locally and blocks API writes.

The preview proxy above discovers components on every gallery reload and supports
isolated examples and source browsing. A generic static HTTP server instead uses
the snapshot from `python3 tools/components/catalog.py`. For live
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
