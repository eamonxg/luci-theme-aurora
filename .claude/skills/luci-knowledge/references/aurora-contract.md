# Aurora's own contract (what a change must keep intact)

## Layout
`.dev/src/media/**` → `htdocs/luci-static/aurora/{main,login}.css` + `patches/*.css`;
`.dev/src/resource/**` → `htdocs/luci-static/resources/*.js` + `aurora/patches/*.js`
(Terser, `compress.directives:false` keeps the `'require …'` pragmas);
`.dev/public/aurora/**` copied. `htdocs/` is committed output — never hand-edit.
Templates: `ucode/template/themes/aurora/{header,footer,sysauth}.ut`. Version: `Makefile`.

## Head order (`header.ut`) — do not reorder without a reason
inline theme script (`setTheme`/`syncSwitchers` globals; `data-darkmode` before first paint)
→ `main.css` `[data-luci-shell]` → matching `patches/<prefix>.css` `[data-luci-patch]`
→ `patches/<prefix>.js` (defer) → font preload + inline `@font-face` → icons/manifest
→ `dispatched.css` `[data-luci-node-css]` → `{{ css }}` → UCI token overrides
(`:root{--light_*→--*}` / `[data-darkmode=true]{--dark_*}`)
→ `admin/translations/<lang>` (sync) → `cbi.js` (sync). Nothing in `<head>` may use `L`.
Footer: `L.require('menu-aurora').then(() => window.navigation && L.require('router-aurora'))`.
Both sync tags must stay synchronous: `_()` is defined by `cbi.js` and `menu-aurora.js`
calls it in `__init__` (12 call sites, first at `:59`); with `defer` the cached module
chain can run first → `ReferenceError`, and with only the catalog deferred the 12
strings render untranslated (see `.dev/decisions/translations-catalog-caching.md`).

## DOM hooks shared by templates, CSS and JS
`body[data-page]` (request segments joined by `-`), `body[data-nav-type]`
(`mega-menu|dropdown|sidebar`), `body[data-asset-version]`, `body[data-patches]`,
`body[data-bg]`; `#maincontent[tabindex=-1]`, `#tabmenu`, `#topmenu`, `#sidebar-list`,
`#sidebar-footer`, `#header-crumb`, `#mobile-nav-list`, `#mobile-nav-footer-action`,
`#indicators`, `#modemenu`, `#cmdk-trigger`, `.desktop-menu-container > .desktop-menu-sheet
> .desktop-menu-canvas`, `.desktop-menu-board` (template cloned per panel),
`.theme-switcher .theme-option[data-theme]`. Renaming any of these is a
cross-file change (grep all three layers + tests).

## Router invariants (`router-aurora.js`, spec in `.dev/docs/router.md`)
`contract()` lists every luci-base surface it needs — a missing one means MPA, not
a broken page. `menu-aurora.js` must keep `syncRoute()` and `closeSurfaces()`. Page
JS patches expose `window.luciPatches[stem] = { mount, unmount }` and mount once at
eval. Same-URL navigations, hash changes, forms, downloads, expired sessions and a
poisoned `<head>` are full loads. Teardown order: `poll.queue.length = 0; poll.stop();
poll.start(); hideIndicator('poll-status'); clear view intervals/listeners; hideModal;
closeSurfaces; unmountPatches`. Departed regions go through `L.dom.content(n, null)`.

## CSS rules
`@apply` + CSS Nesting everywhere except `media/patches/*.css` (plain CSS; theme values
only through `:root` vars: `--surface`, `--hairline`, `--radius-base` (radii are
`calc(var(--radius-base) * n)`), `--app-shadow-*`; dark = `[data-darkmode="true"]`).
No `@layer` wrappers in partials; `main.css` import order is cascade order; tokens come
from `@eamonxg/luci-theme-tokens/dist/aurora/tokens.css` (change colours in that repo).
Budgets (`tests/build-performance.test.js`, mirrored in
`.claude/skills/aurora-performance/references/aurora-budgets.md`): main.css ≤ 193 KB,
login.css ≤ 12 KB, menu-aurora.js ≤ 22 KB, router-aurora.js ≤ 15 KB, admin cold set
≤ 267.5 KB, login set ≤ 55 KB, SVG data URLs ≤ 17 KB and unique.

## Patches contract (third-party compatibility)
File name = the page's `data-page` prefix; prefix matching on segment boundaries; both
CSS and JS discovered per render by `lsdir()` in `header.ut:30`; any package may drop a
file into `/www/luci-static/aurora/patches/`. Every page-scoped rule — patches and
the page selectors inside the component partials alike — has an entry in
`.dev/compat/pages/<data-page prefix>.md` (page, package, menu path, DOM, cause, fix,
verification); grep it for a file or selector before changing either
(`luci-dom-compat` skill). Geometric ones are guarded by `.dev/compat/fixtures/` via
`tests/compat.test.js`.

## Verification available
`cd .dev && pnpm test` (140 tests, ~1 s) · `pnpm build` · on-device:
`.claude/skills/aurora-performance/scripts/{bench.mjs,bench-router.mjs,bench-fullload.mjs,bench-dispatch.sh}`
(need `.dev/.env` + a reachable router; say so when they were not run).

## Commit rules
One logical change per commit; short conventional subject, reasoning in the body;
never `Claude-Session:`/session URLs; never push without an explicit instruction.
