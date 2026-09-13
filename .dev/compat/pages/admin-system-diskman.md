# admin-system-diskman

## diskman-partition-bar — keep the injected partition bar inside the card on small screens, clip segment labels
- page: admin-system-diskman (prefix; also `-partition-<dev>`, `-btrfs-<uuid>`) · System → Disk Man (controller diskman.lua:24 entry title "Disk Man", alias to `disks`; issue #58 calls it the storage area on the home page)
- package: luci-app-diskman (lisaac; the ImmortalWrt feed copy was checked)
- dom: `td[colspan]:has(> div[title])` and `td[colspan] > div[title]`, `.tr > div[style*="nowrap"] > div[title]` — disk_info.htm:34/88 emit `<tr width="100%" style="white-space:nowrap;"><td style="… white-space:nowrap;" colspan="15">` and :36 `<div class="tr cbi-section-table-row …"><div style="white-space:nowrap; position:absolute; width:100%">`, with one inline-block `div[title]` per partition sized in percent
- symptom: issue #58: "首页的存储区域会超出宽度，导致页面可以左右滑动" (the storage area exceeds the width; page scrolls sideways), Safari 26 / iOS 26, OpenWrt 24.10.5, theme 0.11; 49fff90 body: "drags the page ~300px wide"
- cause: 49fff90 body: "luci-app-diskman injects the partition bar as a full-span row whose cell carries an inline white-space:nowrap. Once .tr becomes a flex row on mobile, that cell's automatic minimum size is its min-content — the whole unwrapped bar — so it cannot shrink and drags the page ~300px wide (reported in #58 with the page DOM). … clip each segment so its label stops spilling onto the neighbouring one (visible on desktop too)". The file adds: "The segments are inline-blocks sized in percent: any whitespace between them adds a word space on top of the 100% they already sum to" (hence `font-size: 0` on the cell)
- fix: patches/admin-system-diskman.css line 9-35 `[data-page^="admin-system-diskman"] { td[colspan]:has(> div[title]) { flex: 0 0 100%; min-width: 0; overflow: hidden; border-radius: var(--radius-base); font-size: 0 } td[colspan] > div[title], .tr > div[style*="nowrap"] > div[title] { overflow: hidden; font-size: 0.75rem; line-height: 1.5rem; text-overflow: ellipsis } }` · 49fff90 2026-08-02 · 1.1.13 (first tag v1.2.0)
- verified: not measured (the body states the before width, "~300px wide", from the reporter's DOM; no after-number recorded)
- fixture: none (backfill; DOM snapshot exists in `.dev/mocks/admin-system-diskman.html`)
- issue: #58 · mirror: pending · status: active
