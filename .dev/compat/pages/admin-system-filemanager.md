# admin-system-filemanager

## filemanager-container-scroll — scrollable file-manager container, flat status bar
- page: admin-system-filemanager · System → File Manager (menu.d title "File Manager")
- package: luci-app-filemanager (in openwrt/luci applications)
- dom: `#file-manager-container` (the app's own `<style>` block targets it, filemanager.js:269-272) and its `#status-bar`
- symptom: not recorded (347d645 subject: "feat: optimize mobile h3 display and add layer plugins")
- cause: unknown (commit 347d645 has subject only)
- fix: patches/admin-system-filemanager.css line 8-17 `[data-page="admin-system-filemanager"] { #file-manager-container { overflow: auto; #status-bar { background: var(--surface); border: 0; } } }` · 347d645 2025-09-12 · 0.2.1_alpha (first tag v0.3.0-alpha) — first written unscoped as `@layer plugins > luci-app-filemanager { #file-manager-container { @apply overflow-auto; #status-bar { @apply border-0 dark:bg-slate-900 } } }` (applied on every page); `_plugins.css` after aedf3dc, merged into `_patches.css` by 7d9f6a1; 1c924cf scoped it to the page (PR #82: "Backfilled missing data-page scoping … filemanager"); native via e14cfcd (the dark-only `bg-slate-900` became an always-on `var(--surface)`)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active
