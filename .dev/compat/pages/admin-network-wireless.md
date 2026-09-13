# admin-network-wireless

## assoclist-full-row-cells — Associated Stations cells take a full row on mobile
- page: admin-network-wireless · Network → Wireless, "Associated Stations" table (wireless.js:2667 creates `#wifi_assoclist_table`, h3 at :2680). The same id is also created by luci-mod-status 60_wifi.js:243 on Status → Overview; 1dbd95a does not say which page it was written against
- package: stock luci-mod-network (and luci-mod-status for the overview copy)
- dom: `#wifi_assoclist_table td`, `#wifi_assoclist_table .td` (class `table assoclist`); rule also moves the `data-title` ::before label (`before:max-md:mb-1.5`)
- symptom: not recorded (1dbd95a subject: "Ensure each table cell in Associated Stations takes up a full row on mobile")
- cause: unknown (commit 1dbd95a has subject only)
- fix: components/_table.css `#wifi_assoclist_table &` nested under `& td, & .td` (line 156-158) `max-md:flex-[0_0_100%] max-md:px-3 max-md:py-2 before:max-md:mb-1.5` · 1dbd95a 2025-10-17 · 0.5.14_beta (first tag v0.6.0_beta)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

See also: 50c2b84 lists "Network => Wireless host: Fix overflow when td text is too long" as one motivation for `.td.cbi-value-field { break-all }` — that lineage is recorded in `admin-services-dockerman.md` (the rule's current form comes from a2d110a). e86b70f lists "Network => (Interfaces, Wireless, Firewall)" for the `.cbi-section-actions` mobile rule — recorded in `admin-status-overview.md`.
