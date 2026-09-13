# admin-network-network

## bridge-vlan-descr-hidden — hide the table description row on mobile
- page: admin-network-network · Network → Interfaces → Devices → Bridge VLAN Filtering (efa07d8 body: "Network -> Interfaces -> Devices -> Bridge VLAN Filtering")
- package: stock luci-mod-network
- dom: `.table tr.cbi-section-table-descr` — global selector, added for this page
- symptom: not recorded beyond "to improve layout" (efa07d8 body)
- cause: unknown (efa07d8 body states the action, not what the descr row did wrong)
- fix: components/_table.css `&.table-titles, &.cbi-section-table-titles, &.cbi-section-table-descr { max-md:hidden }` (line 58-62) — `.cbi-section-table-descr` was added to the existing list · efa07d8 2025-09-18 · 0.3.7_alpha (first tag v0.4.0-alpha)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## ifacebox-cells-full-row — interface status/box cells stack full-width on mobile
- page: admin-network-network · Network → Interfaces (menu.d title "Interfaces")
- package: stock luci-mod-network
- dom: `td[data-name="_ifacebox"]`, `td[data-name="_ifacestat"]` — DummyValue cells of the `interface` GridSection (interfaces.js:296-297 query `[data-name="_ifacestat"] > div` and `[data-name="_ifacebox"] .ifacebox-body`)
- symptom: not recorded (bec6830 subject: "feat: enhance ifacebox display in td")
- cause: unknown (commit bec6830 has subject only)
- fix: components/_table.css `[data-page="admin-network-network"] & { &[data-name="_ifacebox"], &[data-name="_ifacestat"] { … } }` nested under `& td, & .td` (line 214-219) `max-md:basis-[100%]` · bec6830 2025-09-23 · 0.4.3_alpha (first tag v0.5.0_beta). The same commit added the `td &` variants of `.ifacebox` that 397e46b later moved under `#cbi-network-interface` (next entry)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## interface-cards-floor — equal-width interface cards, horizontal card layout on mobile
- page: admin-network-network · Network → Interfaces
- package: stock luci-mod-network
- dom: `#cbi-network-interface` (id of `form.Map('network')` + GridSection `'interface'`, interfaces.js:497-501) — five descendant rules on `.ifacebox`, `.ifacebox-head`, `.ifacebox-body`, `.ifacebox-body > div`, `.ifacebox-body small`
- symptom: 397e46b body: "The interfaces overview sizes every card by its content, so a bridge carrying seven device icons rendered far wider than a single-port one."
- cause: 397e46b body: "The shared `.ifacebox` min-width had been masking half of that until 1.2.7 lowered it to stop the port status grid overlapping. The floor now sits on the overview's own section instead — `#cbi-network-interface`, the scope luci-theme-bootstrap already uses for this page — at 152px, and the five `td &` rules that only ever applied there move under it too rather than reaching every `.ifacebox` inside any table cell."
- fix: components/_card.css `#cbi-network-interface &` at line 72-74 (`.ifacebox`: `max-md:flex-row md:min-w-38`), 83-85 (`.ifacebox-head`: `max-md:flex max-md:w-auto max-md:shrink-0 max-md:items-center max-md:justify-center max-md:rounded-l-3xl max-md:rounded-tr-none max-md:border-r max-md:border-b-0`), 107-109 (`.ifacebox-body`: `max-md:flex-row max-md:items-center max-md:rounded-r-3xl max-md:rounded-bl-none max-md:py-2 max-md:pr-2 max-md:pl-4`), 144-146 (`.ifacebox-body > div`: `max-md:w-auto max-md:flex-1 max-md:space-y-1`), 163-165 (`.ifacebox-body small`: `max-md:mt-0`) · 397e46b 2026-08-30 · 1.2.10 (first tag v1.3.0). The mobile rules were first written as `td &` in bec6830 (2025-09-23)
- verified: no before/after measurement of the card widths recorded; the body states the size changes it made: "icons 24px -> 20px, the gap between adjacent ones 8px -> 4px, card padding 16px -> 12px and the label line spacing 16px -> 4px", floor 152px, `.ifacebox-body > img` / badge icons "intrinsic 32px" → 20px, zone swatch 33px tall → vertical padding 2px
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## bridge-vlan-dropdown-clip — let the Bridge VLAN table's dropdowns escape their wrapper on mobile
- page: admin-network-network · Network → Interfaces → Devices → Configure → Bridge VLAN filtering (path from efa07d8's wording of the same table; c5a2dff itself only says "bridge-vlan table")
- package: stock luci-mod-network
- dom: `[data-name="bridge-vlan"] > div` — the SectionValue option `bridge-vlan` wrapping the Bridge VLAN TableSection (tools/network.js:1354); patch rule under `@media (width < 48rem)`
- symptom: dropdown clipped on mobile (c5a2dff subject: "fix(mobile): resolve clipped dropdown in bridge-vlan table")
- cause: unknown (commit c5a2dff has subject only; the diff shows only the override, not which rule clipped the dropdown)
- fix: patches/admin-network-network.css line 8-12 `@media (width < 48rem) { [data-name="bridge-vlan"] > div { overflow: visible !important; } }` · c5a2dff 2025-10-19 · 0.6.1_beta (first tag v0.7.0_beta) — written as `@layer patches > admin-network-network { … @apply max-md:!overflow-visible }` in main.css, moved to `_patches.css` by aedf3dc, split into its own on-demand file by 1c924cf (#82, `@reference` + `@apply`), rewritten as native CSS by e14cfcd
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

See also: e86b70f lists "Network => (Interfaces, Wireless, Firewall)" for the `.cbi-section-actions` mobile rule — recorded in `admin-status-overview.md`.
