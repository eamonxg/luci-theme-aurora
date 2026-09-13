# admin-statistics-graphs

## rrd-graphs-dark — invert and hue-rotate the rendered graph images in dark mode
- page: admin-statistics-graphs · Statistics → Graphs (menu.d title "Graphs"; edf378d: "Affected pages: Statistics => Graphs")
- package: stock luci-app-statistics
- dom: `[data-plugin] img` — the per-plugin tab containers built in graphs.js:75 (`'data-plugin': plugin`) holding the rrdtool PNGs; dark scope is `[data-darkmode="true"]` on `<html>`
- symptom: not recorded beyond "Adapt img background color for dark mode" (edf378d body)
- cause: edf378d body: "Adapt img background color for dark mode" — the graphs are server-rendered images whose light background does not follow the theme; nothing further recorded
- fix: patches/admin-statistics-graphs.css line 8-10 `[data-darkmode="true"] [data-page="admin-statistics-graphs"] [data-plugin] img { filter: hue-rotate(150deg) invert(100%); }` · edf378d 2025-10-17 · 0.5.16_beta (first tag v0.6.0_beta) — written as `@layer luci-app-statistics { [data-page=…] [data-plugin] img { @apply dark:hue-rotate-150 dark:invert } }` in main.css; `_plugins.css` after aedf3dc, merged into `_patches.css` by 7d9f6a1, own file via 1c924cf, native via e14cfcd (the e14cfcd body cites this file: "the two-rule statistics patch alone went 1,609 B → 110 B")
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active
