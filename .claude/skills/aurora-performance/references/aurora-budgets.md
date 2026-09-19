# Performance — aurora budgets & ledger

Methodology lives in this skill's reference files (`server.md`, `loading.md`,
`runtime.md`, `measuring.md`, alongside this file). This file holds what is
specific to THIS theme: budgets, the optimization ledger, and accepted
exceptions. The measured baselines backing the numbers live in the skill's
`baselines/` directory (git-ignored — they record device model and LAN
address, so they stay local).

## Budgets

| Metric | Budget | Track | Source |
|---|---|---|---|
| main.css (identity/raw) | ≤ 187 KB | size | production build, 2026-09-19 (185,262 B; −4,968 B pseudo-elements as nested rules, one `content` each; 2026-09-17: 190,230 B; +0.6 KB palette tab rows "Parent › Title", unnested short selectors; −0.77 KB sidebar push as two transitions instead of run keyframes; +42 B replayed nav skips the fade; +~2 KB custom-background mode, +~0.5 KB router progress bar / live region; the bar is now Turbo-shaped — width/opacity only, inserted per navigation; −1.24 KB unblurred mega-menu curtain, delayed visibility, instant nav-pill colours) |
| login.css (identity/raw) | ≤ 12 KB | size | production build, 2026-09-19 (11,972 B; +211 B: the prune's re-minify now targets the theme floor, which restores `-webkit-backdrop-filter`) |
| menu-aurora.js (identity/raw) | ≤ 23 KB | size | production build, 2026-09-17 (22,665 B; +1.3 KB palette tabs: third-level nodes, redirect parents folded into their tabs, legacy recents mapped, parent-aware scoring, path words matched segment by segment; −0.24 KB sidebar toggle is a class flip; −0.09 KB pre-paint nav cache, its crumb renderer moved into header.ut (the replay itself is per-response HTML, see below); +0.8 KB palette recents: record on pick, pure-LRU browse order, storage validation; +0.2 KB ">" logout command) |
| router-aurora.js (identity/raw, Navigation-API browsers only) | ≤ 16 KB | size | production build, 2026-09-13 (15,771 B, shipped from @eamonxg/luci-theme-devkit; 2026-08: 14,844 B: template shells fetched, per-render listener teardown, timeout-as-failure, expiry gate, readonly folding, node css, wildcard actions, trickling progress bar, same-URL reload rule, visibility gate, contract check) |
| Default logo (identity/raw) | ≤ 16 KB | size | production build, 2026-07 (15,057 B) |
| Core admin cold theme assets (identity/raw) | ≤ 264 KB | size | main CSS + menu JS + router JS + default font + logo, 2026-09-19 (262,335 B; −4,968 B nested pseudo-element rules; 2026-09-17: 267,303 B; +1.9 KB palette tabs; −1.1 KB sidebar push and nav cache; the router is a one-time cost that removes per-click dispatcher work; +1.0 KB palette recents and logout command; −1.24 KB mega-menu curtain) |
| Login cold theme assets, excluding configured background (identity/raw) | ≤ 55 KB | size | login CSS + default font + logo, 2026-07 (49,572 B) |
| Admin HTML inline scripts added per full load (identity, never cached) | — | size | header.ut, 2026-09-16: pre-paint nav replay ≈ +0.5 KB (mega-menu/dropdown) / ≈ +1.9 KB (sidebar, with the shared crumb renderer); login page +0.07 KB. Template shells the router fetches carry it too. |
| Blocking requests before first paint | ≤ 4 | count | current waterfall |
| Repeat-visit asset requests | ≈ 0 | count | target state; package-built CSS/JS URLs are versioned, but long-lived cache headers still need live verification |
| TTFB, login page (device) | proposed: ≤ 130 ms | latency | local device baseline, 2026-07 |
| LCP @ 4× CPU + Slow 4G | TBD — fill from baseline | latency | local baseline archive |
| INP @ 4× CPU | TBD — fill from baseline | latency | local baseline archive |
| uhttpd VmRSS during page load | proposed: ≤ 2050 kB | memory | local device baseline, 2026-07 |

Budget revisions require a new baseline entry under `../baselines/`.

## Optimization ledger

### Landed

- Compositor animation rework; mega-menu idle pre-measurement; on-demand
  patches; `font-display: swap` and inline `@font-face` CSS.
- Tailwind `source(none)`, login-only Preflight removal, native scrollbar
  styling, and local fade animation; unused CSS plugins removed.
- Shared SVG custom properties prevent repeated mask payloads.
- Terser compression/mangling with LuCI loader directives preserved.
- Default logo raster resized inside its compatibility SVG wrapper.
- Login template reuses its board/UCI reads when including `header.ut`.
- Package-root `.DS_Store` metadata removed and covered by a regression test.
- login.css pruned to its reachable custom properties at build time (the
  shared token sheet is admin-sized; the login page consumes a fraction).
- Mega-menu curtain (2026-09-16): no backdrop blur, `visibility` delayed
  instead of tweened, instant nav-pill colours; main.css −1,244 B. Device
  trace, 4× CPU, median of 3: repaints 287 → 112, main-thread animations
  33 → 8. With `--disable-gpu`, dropped frames per open went 3–5 → 0.

- Build targets (2026-09-19): `LIGHTNINGCSS_TARGETS` is the theme floor (Chrome/Edge 111, Firefox 128,
  Safari 16.4), not `last 4 versions`. Only the login prune's re-minify reads it — Vite overrides
  `css.lightningcss.targets` with `build.cssTarget` for the main build — and the old query (floor
  Safari 26.1) had stripped the login card's `-webkit-backdrop-filter`. `app.webmanifest` icon paths
  fixed (they still pointed into the flattened `pwa/` directory and 404ed).

- Nested pseudo-elements (2026-09-19): 36 `@apply` lines moved their `before:`/`after:` utilities into
  `&::before`/`&::after` blocks (`@variant hover` where the hover media gate must stay); `content:var(--tw-content)`
  202 → 27, main.css −4,968 B, computed styles identical over `.dev/mocks`.

- Client-side router (`router-aurora.js`, `.dev/docs/router.md`,
  2026-08-16): view/alias/firstchild/overview navigations become
  same-document swaps on Navigation-API browsers, MPA elsewhere.
  Measured on RE-SS-01 over plain HTTP (`bench-router.mjs`, RUNS=10): click →
  view painted **241–544 ms → 49–251 ms warm, median −67 %**; walk of
  51/62 linked pages (mega-menu/sidebar), 42–43 served, **0 divergences** vs
  full loads incl. DOM shape; 65-navigation soak flat after the first lap
  once departed regions are cleared through `dom.content()` (the data-idref
  registry otherwise pins every departed subtree: 26k → 72k nodes before)
  and per-render window/document listeners are torn down; back traversal
  through alias/firstchild entries same-document; poison gate → full load →
  router again. Report in `../baselines/router-re-ss-01.md`.

### Pending
| Item | Principle | Estimated gain |
|---|---|---|
| Long-lived cache headers for versioned CSS/JS | L2 | after LuCI build-time `?v=$(PKG_VERSION)`, kills per-click 304s if headers permit disk/memory cache reuse |
| `defer` head scripts | L1 | needs on-device timing verification |
| Source-level `@apply` weight: ~~nest `&::before` instead of stacked `before:` variants (190 repeated `content:var(--tw-content)`)~~ (landed 2026-09-19), light `@utility` for transitions and shadows | S3 | ≤ ~20 KB of main.css by byte attribution; gate with a computed-style diff over `.dev/mocks` |

### Notes

- **LuCI build-time asset versioning** — Source templates may show
  `{{ media }}/main.css`, `{{ media }}/login.css`, or
  `{{ resource }}/menu-aurora.js` without a query string. When packaged
  through LuCI's `luci.mk`, quoted `{{ media }}/... .css` and
  `{{ resource }}/... .js` links are rewritten to append
  `?v=$(PKG_VERSION)`; for aurora 1.0.7 this yields
  `/luci-static/aurora/main.css?v=1.0.7` and
  `/luci-static/aurora/login.css?v=1.0.7`. Do not re-propose manual
  cache-versioning for these links unless inspecting the installed package
  or live HTML proves the rewrite did not happen.
- **No CSS post-processing** (2026-09-19) — mangling `--tw-*` measured 190,230 → 165,672 B raw but
  only ~1 KB after gzip, and packages/flash are compressed: it buys a few ms on the first load per
  version at the price of a custom build step, unreadable production variables and noisy committed
  artifacts. Rejected; reduce at the source instead (see Pending).
- **Light `@utility` for transitions / shadows — deferred by the maintainer (2026-09-19).** Ceiling by
  static resolution of the built sheet: transitions 54 rules, 15,323 → 7,668 B (−7.7 KB); shadows 50
  rules, 9,419 → 2,299 B (−7.1 KB), of which only the 40 shadow-only rules (−5.4 KB) are safe — focus
  states set a ring alone and rely on Tailwind's five-variable `box-shadow` composition. It changes
  declarations, so only a computed-style diff plus a manual pass over hover/focus can gate it.
- **No gzip on the target uhttpd** — budgets and the bench harness use raw
  identity bytes. Do not add precompressed sidecars unless the deployed HTTP
  server is changed and live response headers prove negotiation works.

### Accepted exceptions

- **`.cbi-progressbar` width transition** — the inner bar's `width` is set via
  inline style by LuCI core's `Progressbar` widget, so a `transform: scaleX()`
  swap would need a JS observer to mirror that value into a custom property
  (plus RTL-aware `transform-origin`). Given the bar updates infrequently
  (firmware/package install progress, not a 60fps animation), the single
  explicit `transition-[width]` is left as-is rather than adding that
  infrastructure.
- **Per-request `lsdir()`** — `header.ut` calls `fs.lsdir()` at render time to
  discover installed patches (see the on-demand third-party patches design).
  Accepted per S1 because it's a single directory read on an already-dynamic
  template render, not a hot loop, and it's what makes patches a drop-in
  extension point without a build-time registry.
- **`backdrop-blur` paint flashing** — elements with `backdrop-blur` (mega-menu
  panel, modal scrim) **will** show some green flashing while animating —
  that's the inherent cost of a blur layer, not a regression. Judge the
  **reflow-class** animations (height / shadow) on whether they still flash,
  *not* whether blur reaches zero flash.

## Baselines

Local baseline reports live in `../baselines/` when present. That directory is
git-ignored because reports include device model and LAN address.
