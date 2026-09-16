# admin-services-mini-diskmanager

## partition-table-font — the table's own font-size reaches its cells

- page: admin-services-mini-diskmanager-minidiskmanager · Services → Disk Manager
- package: luci-app-mini-diskmanager (4IceG/luci-app-mini-diskmanager)
- dom: `table#partition-table-<dev> > tr.tr > td.td` — the `<table>` carries inline `table-layout:fixed; width:100%; font-size:12px`; first `th` 180px, the other seven `width:12.5%; min-width:90px`; the type cell is `<span class="partition-color-indicator"> NAME`
- symptom: type/filesystem and mount-point cells wrap — swatch on one line, name below; long names break mid-word (`0BOOTCONFIG` / `1`, `/mnt/mmcblk0` / `p6`)
- cause: `td, .td` set `text-base` (16px) directly, so the table's inline 12px never reached the cells; fixed columns sized for 12px got 16px text and `wrap-break-word` split what did not fit. bootstrap puts its font size on `.table` and lets cells inherit.
- fix: `components/_table.css` `table.table, .table` `text-base max-md:text-sm` (moved off `td, .td`, which now inherit) · dd7c64b · 1.3.3
- verified: device 192.168.8.1, CDP before/after in one page load — cells 16 → 12px; wrapped cells 5 → 1 at 1280 (the remaining `0BOOTCONFIG1` wraps under bootstrap at that width too), 5 → 0 at 1920, 0 → 0 at 390; eleven stock pages (overview, routes, processes, interfaces, firewall zones/rules, DHCP, wireless, mounts, startup, SSH keys) showed zero font-size/line-height changes on any text-bearing table element at 1280 and 390
- fixture: fixtures/admin-services-mini-diskmanager-minidiskmanager--partition-table.html
- issue: #65 · mirror: shadcn 4f1c7f4 · status: active

## partition-table-gutter — the stable scrollbar gutter leaves the type cell 0.9px short at 1280

- page: admin-services-mini-diskmanager-minidiskmanager · Services → Disk Manager
- package: luci-app-mini-diskmanager (4IceG/luci-app-mini-diskmanager)
- dom: `table#partition-table-<dev>` (inline `table-layout:fixed; width:100%`); type cell `<span class="partition-color-indicator"> 0BOOTCONFIG`
- symptom: with classic scrollbars at a 1280px viewport the swatch and `0BOOTCONFIG` split onto two lines; overlay scrollbars are unaffected
- cause: `_elements.css` `html` `[scrollbar-gutter:stable]` (added so short pages and open modals stop shifting the layout) reserves the 11px thin scrollbar on every page, which is what a scrolling page already paid; the #65 fit had 0.6px to spare
- fix: none on the page; the fixture pins `html { scrollbar-gutter: auto }` because its 1153px width was measured without a scrollbar, so it keeps guarding #65's inherited 12px
- verified: headless Chrome, fixture at 1280 — table 1152.7 → 1142.1px, cell content 114.9 → 113.4px against a 114.3px line (fits → wraps); `pnpm test` compat fails without the pin and passes with it
- fixture: fixtures/admin-services-mini-diskmanager-minidiskmanager--partition-table.html
- issue: — · mirror: shadcn 50c53a9 · status: active
