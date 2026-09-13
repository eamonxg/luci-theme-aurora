# admin-status-overview

## leases-td-max-width — cap DHCP lease cells so DUID/IAID columns cannot widen the table
- page: admin-status-overview · Status → Overview, "Active DHCP Leases" / "Active DHCPv6 Leases" tables (luci-mod-status 40_dhcp.js:110 `#status_leases`, :169 `#status_leases6`; `[id*=]` matches both). The commit subject says "DHCP > Leases"; the ids exist only in this status include
- package: stock luci-mod-status
- dom: `.table[id*="status_leases"] .td` (class `table leases` / `table leases6`, div-based `.td` cells)
- symptom: table overflow from the DUID/IAID columns (80be54c subject)
- cause: unknown (commit 80be54c has subject only; no DOM or widths recorded)
- fix: components/_table.css `&[id*="status_leases"] { & .td { … } }` (line 137-141) `max-w-62 max-md:max-w-full` · 80be54c 2025-12-12 · 0.9.1_beta (first tag v0.10.0)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## section-actions-mobile — action-button cell spans the mobile card, buttons share the row
- page: admin-status-overview · Status → Overview → Active DHCP Leases; also System → Mount Points and Network → Interfaces / Wireless / Firewall (all five listed in e86b70f)
- package: stock luci-mod-status / luci-mod-system / luci-mod-network (per the pages listed)
- dom: `.table td.cbi-section-actions` (`> div` wrapper, `> div > .cbi-button`) and `.table td > .cbi-button`
- symptom: not recorded (e86b70f subject: "cbi-button display on mobile for cell view")
- cause: unknown (commit e86b70f has subject only)
- fix: components/_table.css `&.cbi-section-actions` nested under `& td, & .td` (line 190-200) `max-md:flex-[0_0_100%]`, `& > div` `max-md:w-full`, `& > div > .cbi-button` `max-md:flex-1`; plus `& > .cbi-button` (line 202-204) `max-md:w-full` · e86b70f 2025-10-17 · 0.5.15_beta (first tag v0.6.0_beta)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## section-actions-mobile-v0 — original scaffold rule for the actions cell on mobile
- page: unknown (076281f is the initial scaffold commit; no page recorded)
- package: unknown
- dom: `.table td.cbi-section-actions` (`& div`, `& .btn, & .cbi-button`) and a sibling `.td.cbi-section-actions { p-2 max-md:p-1 … }` block in the button layer
- symptom: not recorded
- cause: unknown (076281f "chore: setup luci-theme-aurora with Vite and TailwindCSS" has subject only)
- fix: (historic, main.css) `&.cbi-section-actions { @apply max-md:mt-3 max-md:border-t max-md:pt-3; & div { max-md:flex max-md:flex-wrap max-md:justify-start max-md:gap-2 } & .btn, & .cbi-button { max-md:min-w-0 max-md:flex-1 … } }` · 076281f 2025-08-25 · 0.1.0 (first tag v0.2.0-alpha)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: n/a · status: removed 386dec5 (2025-08-30 "feat: optimize mobile display for table" rewrote the mobile table block and dropped it; the `.td.cbi-section-actions` button-layer block was dropped by 4c99ac8 2025-09-05 "chore: adjust button nesting style structure", which replaced it with the generic `.cbi-section-actions > div { flex flex-row … }`). e86b70f re-added a different rule seven weeks later — see the entry above
