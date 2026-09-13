# admin-services-openclash-log

## openclash-log-dark-bg — dark page background on the Server Logs page
- page: admin-services-openclash-log · Services → OpenClash → Server Logs (controller openclash.lua:85 entry title "Server Logs")
- package: luci-app-openclash (vernesong)
- dom: `[data-page="admin-services-openclash-log"]` (the body element itself)
- symptom: not recorded (87522d8 subject only)
- cause: unknown (commit 87522d8 has subject only)
- fix: (historic, main.css `@layer patches > luci-app-openclash`) `[data-page="admin-services-openclash-log"] { @apply dark:bg-aurora-night-teal; }` · 87522d8 2025-09-17 · 0.3.6_alpha (first tag v0.4.0-alpha)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: n/a · status: removed 30f922d (2025-11-09 "chore: remove patch styles and adjust DOM indentation" — body: "Removed temporary patch styles … Test case: openclash → Server Logs (dark mode background)"; 0.7.9_beta, first tag v0.8.0_beta)
