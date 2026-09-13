# admin-services-openclash-settings

## openclash-settings-select-full — selects fill the value field on mobile
- page: admin-services-openclash-settings · Services → OpenClash → Plugin Settings (controller openclash.lua:71 entry title "Plugin Settings")
- package: luci-app-openclash (vernesong)
- dom: `.cbi-value-field .cbi-input-select` under `@media (width < 48rem)`
- symptom: not recorded (a667f02 subject: "feat: add openclash cbi-input-select style patch")
- cause: unknown (commit a667f02 has subject only; its diff is a whole-file rewrite of main.css, the rule as first written was `[data-page="admin-services-openclash-settings"] .cbi-value-field .cbi-input-select { @apply max-md:!w-full }`)
- fix: patches/admin-services-openclash-settings.css line 9-13 `@media (width < 48rem) { .cbi-value-field .cbi-input-select { width: 100% !important; } }` · a667f02 2025-09-26 · 0.4.6_alpha (first tag v0.5.0_beta) — `_patches.css` via aedf3dc; own file via 1c924cf; native via e14cfcd
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

## openclash-diag-grid — stack the Debug Logs diagnostic controls in one column on mobile
- page: admin-services-openclash-settings · Services → OpenClash → Plugin Settings → Debug Logs tab (settings.lua:81 tab "debug", :1308 DummyValue rendering `debug.htm`)
- package: luci-app-openclash (vernesong)
- dom: `.diag-style` and `.diag-style > div` — from `luasrc/view/openclash/debug.htm` (which itself styles `.diag-style` for `[data-darkmode="true"]` at its line 12-17)
- symptom: not recorded (87522d8 subject only)
- cause: unknown (commit 87522d8 has subject only)
- fix: patches/admin-services-openclash-settings.css line 15-33 `.diag-style { & > div { display: flex; flex-direction: column; align-items: center; gap: 0.5rem } @media (width < 48rem) { display: grid; grid-template-columns: repeat(1, minmax(0, 1fr)); gap: 1rem; & > div { width: 100% !important; gap: 0.25rem } } }` · 87522d8 2025-09-17 · 0.3.6_alpha (first tag v0.4.0-alpha) — first written unscoped under `@layer plugins > luci-app-openclash` (applied on every page); 7d9f6a1 merged `_plugins.css` into `_patches.css`; 1c924cf scoped it to this page (PR #82: "openclash `.diag-style` → settings"); native via e14cfcd
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active
