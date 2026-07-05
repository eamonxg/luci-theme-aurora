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
| main.css (gzip-transferred) | ≤ 30 KB | size | measured 2026-07 (28 KB) |
| Per-page cold transfer (all theme assets, gzip) | ≤ 60 KB | size | sum of current gzip sizes + headroom |
| Blocking requests before first paint | ≤ 4 | count | current waterfall |
| Repeat-visit asset requests | ≈ 0 | count | target state; package-built CSS/JS URLs are versioned, but long-lived cache headers still need live verification |
| TTFB, login page (device) | proposed: ≤ 130 ms | latency | local device baseline, 2026-07 |
| LCP @ 4× CPU + Slow 4G | TBD — fill from baseline | latency | local baseline archive |
| INP @ 4× CPU | TBD — fill from baseline | latency | local baseline archive |
| uhttpd VmRSS during page load | proposed: ≤ 2050 kB | memory | local device baseline, 2026-07 |

Budget revisions require a new baseline entry under `../baselines/`.

## Optimization ledger

### Landed
(compositor animation rework; mega-menu idle pre-measurement; on-demand
patches; `font-display: swap`)

### Pending
| Item | Principle | Estimated gain |
|---|---|---|
| Precompressed `.gz` assets | S1+L3 | ~260 KB → ~35 KB cold |
| Terser `compress`+`mangle` in `vite.config.ts` | L3 | ~20 KB → ~10 KB |
| Inline `@font-face` + preload woff2 | L1 | −1 blocking RTT |
| SVGO `logo.svg` | L3 | 45 KB → est. < 20 KB |
| Long-lived cache headers for versioned CSS/JS | L2 | after LuCI build-time `?v=$(PKG_VERSION)`, kills per-click 304s if headers permit disk/memory cache reuse |
| `defer` head scripts | L1 | needs on-device timing verification |

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
