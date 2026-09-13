# admin-modem-modemdata-modempreview

## modemdata-badge-width — let signal badges inside info cards size to content
- page: admin-modem-modemdata-modempreview · Modem → Modem Data → (preview) (menu path inferred from the page name; not in the local LuCI checkouts)
- package: luci-app-modemdata (third-party; named in the patch header and PR #80)
- dom: `.ifacebox-body .ifacebadge` on the "General Information" cards (PR #80 text)
- symptom: PR #80 body: "Aurora's default ifacebox styles spread modemdata rows apart, wrap signal badges vertically, and leave cards at uneven heights."
- cause: unknown beyond the PR wording — the merged diff (910c85d, 12 lines) contains only the badge width override; the row-spacing and card-height parts of the PR description have no rule in the commit
- fix: patches/admin-modem-modemdata-modempreview.css line 8-12 `[data-page="admin-modem-modemdata-modempreview"] { & .ifacebox-body .ifacebadge { width: auto !important; } }` · 910c85d 2026-06-28 (author CJay D Acopra, PR #80) · 1.0.2 (first tag v1.1.0) — added to `_patches.css` as `@apply w-auto!`, split into its own file by 1c924cf, native CSS by e14cfcd
- verified: not measured (no record)
- fixture: none (backfill)
- issue: PR #80 · mirror: pending · status: active
