# admin-services-samba4

## samba4-cell-padding — tighter th/td padding inside the Network Shares form
- page: admin-services-samba4 · Services → Network Shares (title from luci-app-samba4 menu.d; 1dbd95a writes it as "NAS => Network Shares => Shared Directories")
- package: stock luci-app-samba4
- dom: `#cbi-samba4` (id of `form.Map('samba4')`, samba4.js:23) containing the `sambashare` TableSection "Shared Directories" (samba4.js:93); rule hits every `th/.th` and `td/.td` under it
- symptom: not recorded (1dbd95a subject: "Reduce cell padding in NAS => Network Shares => Shared Directories")
- cause: unknown (commit 1dbd95a has subject only; no symptom or measurement)
- fix: components/_table.css `#cbi-samba4 &` (nested under `& th, & .th`, line 114-116, and under `& td, & .td`, line 148-150) `px-0.5 py-1.5` · 1dbd95a 2025-10-17 · 0.5.14_beta (first tag v0.6.0_beta)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## samba4-section-overflow — horizontal scroll on the samba4 card
- page: admin-services-samba4 · Services → Network Shares (menu path inferred from the page name)
- package: stock luci-app-samba4
- dom: `#cbi-samba4 .cbi-section`
- symptom: not recorded (2e1d18a subject: "table overflow issue on samba4, package, and autoreboot pages")
- cause: unknown (commit 2e1d18a has subject only). The diff shows the section went from `overflow-x-auto` to `overflow-visible` globally and got `#cbi-samba4 & { @apply overflow-x-auto; }` back for this page only, alongside dropping `table-fixed` from `.table`
- fix: (historic, main.css `.cbi-section`) `#cbi-samba4 & { @apply overflow-x-auto; }` · 2e1d18a 2025-08-31 · 0.1.3_alpha (first tag v0.2.0-alpha)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: n/a · status: removed 6b9b328 (2025-09-03 "feat: make dropdown fill based on content, simplify table" — `.cbi-section` went back to global `overflow-x-auto`, so the per-page override was deleted with it)
