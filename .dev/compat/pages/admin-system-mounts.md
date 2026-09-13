# admin-system-mounts

## mounts-td-max-width — cap cells on Mount Points so a long mount path cannot widen the table
- page: admin-system-mounts · System → Mount Points → "Mounted file systems" (menu.d title "Mount Points"; d276fd3: "Tests: System -> Mount Points -> Mounted file systems")
- package: stock luci-mod-system (page depends on block-mount)
- dom: every `td/.td` under `.table` on the page. The "Mounted file systems" table is a plain `E('table', { class: 'table' })` (mounts.js:168) with no id, so the page scope is the only handle; the rule also reaches the `mount`/`swap` GridSections
- symptom: a long docker directory path breaks the Mount Points layout (issue #24: "docker目录比较长，mounts下显示问题", Chrome 142, OpenWrt 24.10, screenshot only)
- cause: d276fd3 body: "the fix avoids applying a global maximum width to table data cells (`td`) to prevent regressions in CBI section actions (e.g., in Services -> passwall -> Node List)" — i.e. the cap is page-scoped because the earlier global `max-w-94` on td was removed in 50c2b84 for passwall (see `admin-services-passwall.md`). Why the path overflowed rather than wrapped is not recorded
- fix: components/_table.css `[data-page="admin-system-mounts"] &` nested under `& td, & .td` (line 152-154) `max-w-104 max-md:max-w-full` · d276fd3 2025-11-28 · 0.8.6_beta (first tag v0.9.0_beta)
- verified: d276fd3 says "Tests: System -> Mount Points -> Mounted file systems"; no numbers. a2d110a (2026-09-13) notes: "On admin/system/mounts the GridSection value cells now take the 65ch cap instead of the page's 26rem one (same specificity, later rule). That only shifts width distribution and was not measured: the test device has no block-mount, so the page is absent."
- fixture: none (backfill)
- issue: #24 · mirror: pending · status: active

See also: 50c2b84 lists "System => (Software, Mount Points): Fix overflow when td text is too long" for `.td.cbi-value-field { break-all }` — recorded in `admin-services-dockerman.md`. e86b70f lists "System => Mount Points" for the `.cbi-section-actions` mobile rule — recorded in `admin-status-overview.md`.
