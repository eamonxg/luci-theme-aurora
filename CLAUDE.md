# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All dev commands run from `.dev/`:

```bash
cd .dev/
pnpm setup:router  # One-shot dev setup: all .env values (router IP, dev host/port) → .env, installs SSH key on device ([ip] to run non-interactively; safe to re-run after a reflash)
pnpm dev        # Start Vite dev server (proxies to OpenWrt device)
pnpm build      # Clean + build production assets to htdocs/luci-static/
pnpm test       # Run tests/*.test.js (node:test)
pnpm clean      # Remove build output only
```

No linter CLI. Formatting uses Prettier with format-on-save (`.vscode/settings.json`).

## Architecture

**Dual-layer build**: source in `.dev/` → OpenWrt-compatible output in `htdocs/luci-static/`.

- `.dev/src/media/main.css` and `.dev/src/media/login.css` → `htdocs/luci-static/aurora/main.css` and `login.css` (TailwindCSS v4, lightningcss)
- `.dev/src/resource/*.js` → `htdocs/luci-static/resources/*.js` (Terser, no bundling)
- `.dev/public/aurora/` → `htdocs/luci-static/aurora/` (copied as-is)
- `ucode/template/themes/aurora/*.ut` — server-side templates, not processed by Vite

**CSS**: two Tailwind CSS v4 entry points in `.dev/src/media/` — `main.css` (admin UI; a pure import manifest over `@eamonxg/luci-theme-tokens/dist/aurora/tokens.css`, `_base.css`, `_elements.css`, `_layout.css`, `components/*.css`, `_utilities.css`) and `login.css` (standalone login page; imports `_base.css`). Third-party compatibility patches are not bundled into `main.css`; each lives in `media/patches/<data-page>.css`, builds to its own `htdocs/luci-static/aurora/patches/<data-page>.css`, and is linked on demand by `header.ut`, which discovers installed patches at render time via `fs.lsdir()` and matches them on path-segment-boundary prefixes (dynamic subpages inherit their prefix's patch; third-party packages may drop their own patch into the directory). The same sweep also loads `patches/<data-page>.js` payloads as deferred scripts (theme-owned JS patches live in `.dev/src/resource/patches/`; `PATCH_ALIASES` in `vite.config.ts` duplicates one built payload under several page names) — see "On-Demand Third-Party Patches" in `.dev/docs/DEVELOPMENT.md`. All styling MUST use TailwindCSS v4 utility classes via `@apply` — no raw CSS properties (e.g. write `@apply text-sm font-semibold;` not `font-size: 14px; font-weight: 600;`). The one deliberate exception is `media/patches/*.css`, which is plain native CSS by design (smaller standalone output, and third-party patch authors need no Tailwind) — reach theme values through the `:root` custom properties (`var(--surface)`, `var(--radius-base)`, …). Use [CSS Nesting syntax](https://drafts.csswg.org/css-nesting/) for selectors. Theme colors defined as OKLCH custom properties, imported from the published tokens package, and mapped via `@theme inline`. Built CSS keeps Tailwind's native `@layer` structure (theme partials are unlayered, so they outrank layered utilities); the OKLCH requirement already gates browsers to ones with `@layer` support. See `.dev/docs/DEVELOPMENT.md` for the full CSS file layout.

**Design tokens**: `_tokens.css` 已随 @eamonxg/luci-theme-tokens 上移——main.css/login.css 直接 @import 包内 dist/aurora/tokens.css。改配色/推导请到 luci-theme-tokens 仓库（aurora/defaults.js、aurora/spec.js），发版后在此 bump 依赖重新构建。

**JavaScript**: LuCI `E()` DOM API (not React/Vue). Minified but not bundled. `router-aurora.js` turns view-page navigation into same-document swaps on Navigation-API browsers (MPA elsewhere) — read `.dev/docs/router.md` before touching navigation, teardown, or page-scoped patches, and verify with `bench-router.mjs`.

**Dark mode**: `@custom-variant dark` keyed on `[data-darkmode=true]`, switching logic in `header.ut`.

**Templates**: `header.ut`, `footer.ut`, `sysauth.ut` — ucode templates rendered server-side on OpenWrt.

## Key References

- **Development guide**: `.dev/docs/DEVELOPMENT.md` — dev server setup, env config, proxy details, CI workflows, directory structure
- **Vite config**: `.dev/vite.config.ts` — custom plugins (luci-js-compress, local-serve, redirect, ut-sync)
- **Version**: `PKG_VERSION` and `PKG_RELEASE` in `Makefile`
