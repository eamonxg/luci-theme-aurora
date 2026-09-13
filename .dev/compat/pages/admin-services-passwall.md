# admin-services-passwall

## td-global-max-width — a global `max-w-94` on every table cell
- page: admin-services-passwall-node_list · Services → PassWall → Node List (controller passwall.lua:39 entry title "Node List") — the page that got the rule removed; the page it was added for is not recorded
- package: luci-app-passwall (xiaorouji; the ImmortalWrt feed copy was checked)
- dom: `.table td, .table .td` (global) — on Node List the `td.cbi-section-actions` cell holds the row's action buttons
- symptom: on removal — 50c2b84 subject: "Services => passwall => Node List cbi-section-actions: Fix overflow beyond td max width" (the action buttons ran past the capped cell). On addition — not recorded
- cause: addition: unknown (efa07d8's body describes two other changes — "Removed conflicting styling that prevented setting `overflow-auto`, which was necessary to maintain the sticky positioning of `th` elements" and hiding `.cbi-section-table-descr` on the Bridge VLAN page — and says nothing about `max-w-94`, which the diff adds to td alongside `max-md:max-w-full` and col caps). Removal: the fixed cap could not hold the Node List action cell (50c2b84 subject); d276fd3 later restates the lesson: "the fix avoids applying a global maximum width to table data cells (`td`) to prevent regressions in CBI section actions (e.g., in Services -> passwall -> Node List)"
- fix: (historic, main.css `& td, & .td`) `max-w-94` · efa07d8 2025-09-18 · 0.3.7_alpha (first tag v0.4.0-alpha)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: n/a · status: removed 50c2b84 (2025-10-12 "fix: table content overflow", 0.5.8_beta, first tag v0.6.0_beta). The same commit added `.td.cbi-value-field { break-all }` as the replacement overflow guard for "System => (Software, Mount Points)" and "Network => Wireless host" — see `admin-services-dockerman.md`; per-page caps came back scoped: `[data-page="admin-system-mounts"]` (d276fd3, `admin-system-mounts.md`) and `[id*="status_leases"]` (80be54c, `admin-status-overview.md`)

See also: bbb355b 2025-10-26 "fix: resolve tooltip flicker and add footer spacing" — body: "added top margin to the footer to avoid overlap with main content in plugins that lack proper view containers (e.g., PassWall)"; a global `footer` rule (currently _layout.css line 644), not traced further here.
