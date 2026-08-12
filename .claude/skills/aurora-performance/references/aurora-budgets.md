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
| main.css (identity/raw) | ≤ 190 KB | size | production build, 2026-07 (183,820 B) |
| login.css (identity/raw) | ≤ 12 KB | size | production build, 2026-07 (10,935 B, token-pruned) |
| menu-aurora.js (identity/raw) | ≤ 20 KB | size | production build, 2026-07 (19,100 B) |
| Default logo (identity/raw) | ≤ 16 KB | size | production build, 2026-07 (15,057 B) |
| Core admin cold theme assets (identity/raw) | ≤ 250 KB | size | main CSS + menu JS + default font + logo, 2026-07 (241,557 B) |
| Login cold theme assets, excluding configured background (identity/raw) | ≤ 55 KB | size | login CSS + default font + logo, 2026-07 (49,572 B) |
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
- Speculation Rules document prefetch in `header.ut` (N2): hover-triggered,
  `*/logout*` excluded, prerender never used; ~200 B of inline HTML per
  page view, no asset growth. Guarded by tests (`speculative prefetch
  stays side-effect-safe`).
- Cross-document View Transitions opt-in in `_base.css` (N4): +106 B in
  main.css and +106 B in login.css (2026-08 build); survival in both
  entries guarded by a build test.
- Poll lifecycle in menu-aurora.js (N3): hidden-tab pause (resumes only
  its own pause) + bfcache `pageshow` stop/start for an immediate
  `step()`; +255 B → 19,783 B of the 20,000 B budget.

### Pending
| Item | Principle | Estimated gain |
|---|---|---|
| Long-lived cache headers for versioned CSS/JS | L2 | after LuCI build-time `?v=$(PKG_VERSION)`, kills per-click 304s if headers permit disk/memory cache reuse |
| `defer` head scripts | L1 | needs on-device timing verification; weight rises under the MPA strategy (paid on every navigation) |
| On-device verification of the 2026-08 navigation batch | N2/N3/N4 | prefetch waterfall (hover rows, no logout row, click served from prefetch cache); DevTools bfcache Test passes and restored pages refresh in one step; screen recording shows no blank frame; TTFB/nav-median A/B via bench.mjs |
| Hover view-module prewarm (transitive require closure) | N2 | cold-navigation RTTs; **measure first** — est. 1–1.5 KB JS far exceeds menu-aurora.js's remaining 217 B headroom, needs its own deferred file or a budget revision with a new baseline |

Headroom check (2026-08 build): main.css 190,263 / 192,000 B; login.css
11,805 / 12,000 B; menu-aurora.js 19,783 / 20,000 B. All three budgets are
nearly exhausted — the next feature of any size needs a trim or a budget
revision with a new baseline, not optimism.

### Strategy decisions

- **Navigation stays MPA — client-side routing rejected** (2026-08). A theme
  router must take over framework-owned lifecycle state (views instantiate
  inside `require()` and cache as instances; `Request` cannot abort; `Poll`
  teardown ordering; `uci.js`/`network.js` singleton caches that assume
  document death resets them) plus an open ecosystem of third-party pages
  injecting head styles and raw timers on the same assumption. That cost is
  permanent and must be re-verified against every luci-base release, while
  the browser keeps shipping MPA wins (bfcache, bytecode cache, View
  Transitions, speculation rules) for free. Full rationale and the
  replacement mechanisms: `navigation.md`. Do not re-propose.
- **Prerender rejected** (2026-08). Speculative prerender executes the
  target page's JS — its full RPC load — on the router's 1–2 shared cores
  for pages never opened. Prefetch only (N2).

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
- **No gzip on the target uhttpd** — budgets and the bench harness use raw
  identity bytes. Do not add precompressed sidecars unless the deployed HTTP
  server is changed and live response headers prove negotiation works.
- **Menu and RPC discovery are already session-cached upstream** —
  `ui.menu.load()` returns the tree from `sessionStorage` after the
  session's first page (`session.getLocalData('menu')`), and `rpcBaseURL` /
  `features` are cached the same way. The true per-navigation server cost
  is a single dispatcher run. Do not re-propose menu caching, and never
  re-fetch these directly.
- **Dispatcher HTML ships no `Cache-Control`** (verified on luci master,
  2026-08): that is what keeps pages bfcache- and prefetch-eligible — never
  add `no-store`. Static assets carry only `ETag`/`Last-Modified`, so
  repeat-visit behavior rests on heuristic freshness; verify the ≈0
  repeat-request budget row on the device before trusting it.
- **No `unload`/`beforeunload` listeners exist** in luci-base resources or
  this theme (verified 2026-08). Introducing one forfeits bfcache — treat
  it as a performance regression in review.

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
