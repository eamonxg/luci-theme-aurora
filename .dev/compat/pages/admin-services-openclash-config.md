# admin-services-openclash-config

## openclash-subinfo-icons — fix the subscription-info icon size
- page: admin-services-openclash-config · Services → OpenClash → Config Manage (controller openclash.lua:84 entry title "Config Manage")
- package: luci-app-openclash (vernesong; the ImmortalWrt feed copy was checked)
- dom: `.sub_div img` — `.sub_div` comes from `luasrc/view/openclash/sub_info_show.htm`, the template used by config.lua:191
- symptom: not recorded (87522d8 subject: "feat: add openclash patch and remove btn spacing")
- cause: unknown (commit 87522d8 has subject only)
- fix: patches/admin-services-openclash-config.css line 8-13 `[data-page="admin-services-openclash-config"] { .sub_div img { height: 1.25rem; width: 1.25rem; } }` · 87522d8 2025-09-17 · 0.3.6_alpha (first tag v0.4.0-alpha) — written as `@layer patches > luci-app-openclash { [data-page=…] .sub_div img { @apply h-5 w-5 } }` in main.css; `_patches.css` via aedf3dc; own file via 1c924cf; native via e14cfcd
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active
