# admin-system-package-manager

## progress-title-10px — shrink the progress bar's title text below the sm breakpoint
- page: admin-system-package-manager · System → Software (menu.d title "Software")
- package: stock luci-app-package-manager
- dom: `.cbi-progressbar[title]` (package-manager.js:1253 `E('div', { class: 'cbi-progressbar', title })`); the theme prints the title through `before:content-[attr(title)]` with `before:whitespace-nowrap` (_progress.css line 2)
- symptom: progress text clipping on the package page (cdcc680 subject)
- cause: unknown (commit cdcc680 has subject only). What the diff shows: the title is a nowrap ::before centred in the bar; the fix only lowers its font size under the sm breakpoint. 386dec5 (2025-08-30) had earlier given every progressbar `max-md:before:text-[10px]`; when that left is not traced here
- fix: components/_progress.css `[data-page="admin-system-package-manager"] &` nested under `.cbi-progressbar` (line 3-5) `max-sm:before:text-[10px]` · cdcc680 2025-12-05 · 0.8.10_beta (first tag v0.9.0_beta)
- verified: not measured (no record)
- fixture: none (backfill)
- issue: — · mirror: pending · status: active

See also (global rules motivated by this page, not page-scoped):
- 2e1d18a 2025-08-31 "fix: table overflow issue on samba4, package, and autoreboot pages" — dropped `table-fixed` from `.table` globally (see `admin-services-samba4.md`).
- 50c2b84 2025-10-12 "System => (Software, Mount Points): Fix overflow when td text is too long" — `.td.cbi-value-field { break-all }`, now `wrap-anywhere md:max-w-prose` (see `admin-services-dockerman.md`).
- edf378d 2025-10-17 "Adjust .controls button layout — Affected pages: Statistics => Graphs, System => Software (filter form and paginator)" — `.controls { m-2 flex flex-wrap items-center gap-3 … }` in main.css at the time; current location not traced here.
