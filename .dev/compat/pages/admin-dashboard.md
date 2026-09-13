# admin-dashboard

Patch file: `.dev/src/media/patches/admin-dashboard.css` (scope `[data-page="admin-dashboard"] .Dashboard > .section-content`, line 8-10). Route: main.css `@layer luci-mod-dashboard` (7f25128) → `_patches.css` (aedf3dc, 7d9f6a1) → own on-demand file with `@reference`/`@apply` (1c924cf, PR #82) → native CSS (e14cfcd). Page package: stock luci-mod-dashboard (menu.d "admin/dashboard" "Dashboard"); it ships its own `view/dashboard/css/custom.css`.

## dashboard-cards-and-dark — card decoration on `.dashboard-bg`, dark-mode svg invert, title rule, wifi device cell
- page: admin-dashboard · Dashboard
- package: stock luci-mod-dashboard
- dom: `.dashboard-bg` (card), `.dashboard-bg.tr` (row variant, no radius), `img[src*=".svg"]`, `.title h3`, `.router-status-wifi .wifi-info .devices-info .tr .td:nth-child(3)`
- symptom: not recorded beyond the subjects ("dark mode display issue in luci-mod-dashboard"; 56db83c: "Adapt for missing data-page="admin-dashboard" on default login redirect to dashboard", "Remove border-radius on .dashboard-bg for mobile view")
- cause: unknown for the card/wifi/h3 rules (7f25128 has subject only). For the scope: 56db83c body says the `[data-page="admin-dashboard"]` attribute was missing when the login redirect landed on the dashboard, so the scope was dropped; 1c924cf restored it when the patch became on-demand (PR #82: "Backfilled missing data-page scoping in the original patches (… dashboard)"), and header.ut now computes the page name from `ctx.path` when `request_path` is empty (DEVELOPMENT.md §On-Demand Third-Party Patches, item 1)
- fix: patches/admin-dashboard.css — `.dashboard-bg { background: var(--surface-overlay) }` + `&.tr { border-radius: 0 }` + `&:not(.tr) { border: 1px solid var(--hairline); box-shadow: var(--app-shadow-lg); &:hover {…} }` (line 11-27); `img[src*=".svg"] { [data-darkmode="true"] & { filter: invert(100%) } }` (line 38-42); `.title h3 { color: var(--text); border: 0; padding-bottom: 1rem; @media (width < 48rem) { margin-inline: 0; padding-bottom: 0.5rem } }` (line 93-102); `.router-status-wifi .wifi-info .devices-info .tr .td { &:nth-child(3) { position: relative; top: 0; width: 100%; padding-inline: 0 } @media (width < 48rem) { flex: 1 1 50% } }` (line 104-117) · 7f25128 2025-09-28 · 0.5.1_beta (first tag v0.5.5_beta); 56db83c 2025-10-12 · 0.5.9_beta (first tag v0.6.0_beta) dropped the scope and added `.tr { rounded-none }`; the original `.router-status-lan .devices-info tr th { max-md:flex-[1_1_50%] }` from 7f25128 was removed by c3fae55 2025-09-29 "fix: mobile display issue in luci-mod-dashboard th" (subject only)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## dashboard-dark-text-and-inline-tables — force theme text colour in dark mode, compact assoclist cells, undecorate inline info tables
- page: admin-dashboard · Dashboard (issue #66 names the System, DHCP Devices and Wireless panels)
- package: stock luci-mod-dashboard
- dom: `.dashboard-bg span/td/th` (dark mode), `.dashboard-bg .td/.th` (assoclist cells carry `.td/.th` classes), `.dashboard-bg .table:not(.assoclist)` with its `tr` and `td` (the DNS-style inline info tables)
- symptom: issue #66: "Using luci-mod-dashboard with aurora in dark mode results in multiple UI readability and layout issues … Some elements are rendered with very low contrast (almost black on dark background), and spacing/padding in certain tables and panels (System, DHCP Devices, Wireless) appears inconsistent." (OpenWrt 25.12.4, two screenshots)
- cause: the patch's own comment: "Dark mode: override custom.css hardcoded light-mode colors on all text nodes" — luci-mod-dashboard's `custom.css` sets text colours the theme's dark palette does not reach; the spacing/inline-table rules have no recorded cause (944e7c5 has subject only)
- fix: patches/admin-dashboard.css — `& span, & td, & th { [data-darkmode="true"] & { color: var(--text) !important } }` (line 30-36); `& .td { padding-block: 0.5rem; @media (width < 48rem) { padding-block: 0.25rem } }` and `& .th { padding-block: 0.5rem }` (line 45-54); `& .table:not(.assoclist) { margin-bottom: 0; border-radius: 0; border: 0; background: transparent; box-shadow: none; & tr { &:hover { background: transparent } @media (width < 48rem) { display: table-row; border: 0; padding: 0 } } & td { border: 0; padding: 0.125rem 0; @media (width < 48rem) { display: table-cell } &:first-child { padding-right: 0.5rem; white-space: nowrap; opacity: 0.7 } } }` (line 57-91) · 944e7c5 2026-05-31 (in `_patches.css`) · 0.11.10 (first tag v0.12.0)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: #66 (still open) · mirror: pending · status: active
