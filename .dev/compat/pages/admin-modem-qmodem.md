# admin-modem-qmodem

## qmodem-theming — colours, borders, hover states, tab and table styling across the QModem pages
- page: admin-modem-qmodem (prefix; covers `-overview`, `-sms`, `-sms-conversation-<contact>`, `-sms_sim`, `-config_advanced`, `-settings`, `-network_config`) · Modem → QModem → … (menu paths inferred from the page names; the app is not in the local LuCI checkouts)
- package: luci-app-qmodem (third-party; named in the patch header and PR #92)
- dom: `[data-page^="admin-modem-qmodem"]`: `.copyright-section`, `fieldset.cbi-section > legend`, `fieldset.cbi-section`, `.cbi-section-table-titles.named::before` (line 9-42); `[data-page^="admin-modem-qmodem-sms-conversation"]`: `#sms-messages-area`, `.sms-message-bubble`, `.sms-message-content`, `.sms-message-meta` (line 44-64); `[data-page="admin-modem-qmodem-config_advanced"]`: `.cbi-tabmenu li` and `.cbi-tab` (line 66-96; the file's comment: "targets <li> directly (not li > a) because qmodem's tab markup has no <a> inside tabs"); `[data-page="admin-modem-qmodem-sms"]`: `.td > div`, `.td > span[style*="margin-left"]`, `.sms-conversations` (+ `> .cbi-section`, `fieldset.cbi-section`, `.table.cbi-section-table`), `.cbi-section-table-row.tr` (+ hover), `.sms-unread-conversation`, `.sms-unread-badge` (line 98-175); `[data-page="admin-modem-qmodem-sms_sim"]`: `.cbi-section-table-row.tr` (+ hover) (line 177-197); `[data-page="admin-modem-qmodem-settings"]`: `.cbi-section-table-descr.named::before` (line 201-206)
- symptom: not recorded per rule. PR #92 body: "Styles qmodem overview, SMS, conversation, advanced config, network config, and settings pages with consistent theming (borders, colors, hover states, table formatting, and tab styling)."
- cause: unknown (commit 7066351 has subject only; the PR body lists scope, not what each page did wrong)
- fix: patches/admin-modem-qmodem.css (whole file) · 7066351 2026-07-25 (author shiraneko, PR #92 by cjayacopra) · 1.1.2 (first tag v1.2.0) — written with `@reference`/`@apply`, rewritten natively by e14cfcd 2026-07-27 (1.1.8; radii became `calc(var(--radius-base) * n)`)
- verified: not measured (no record)
- fixture: none (backfill; DOM snapshots exist in `.dev/mocks/admin-modem-qmodem*.html` — overview, sms, sms_sim, config_advanced, settings, network_config)
- issue: PR #92 · mirror: pending · status: active
