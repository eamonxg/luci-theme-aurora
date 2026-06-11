# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All dev commands run from `.dev/`:

```bash
cd .dev/
pnpm dev      # Start Vite dev server (proxies to OpenWrt device)
pnpm build    # Clean + build production assets to htdocs/luci-static/
pnpm clean    # Remove build output only
```

No test suite or linter CLI. Formatting uses Prettier with format-on-save (`.vscode/settings.json`).

## Architecture

**Dual-layer build**: source in `.dev/` → OpenWrt-compatible output in `htdocs/luci-static/`.

- `.dev/src/media/main.css` and `.dev/src/media/login.css` → `htdocs/luci-static/aurora/main.css` and `login.css` (TailwindCSS v4, lightningcss)
- `.dev/src/resource/*.js` → `htdocs/luci-static/resources/*.js` (Terser, no bundling)
- `.dev/public/aurora/` → `htdocs/luci-static/aurora/` (copied as-is)
- `ucode/template/themes/aurora/*.ut` — server-side templates, not processed by Vite

**CSS**: two Tailwind CSS v4 entry points in `.dev/src/media/` — `main.css` (admin UI; a pure import manifest over `_tokens.css`, `_base.css`, `_layout.css`, `components/*.css`, `_utilities.css`, `_patches.css`) and `login.css` (standalone login page). All styling MUST use TailwindCSS v4 utility classes via `@apply` — no raw CSS properties (e.g. write `@apply text-sm font-semibold;` not `font-size: 14px; font-weight: 600;`). Use [CSS Nesting syntax](https://drafts.csswg.org/css-nesting/) for selectors. Theme colors defined as OKLCH custom properties in `_tokens.css` and mapped via `@theme inline`. `@layer` at-rules stripped by PostCSS plugin for OpenWrt compatibility. See `.dev/docs/DEVELOPMENT.md` for the full CSS file layout.

**JavaScript**: LuCI `E()` DOM API (not React/Vue). Minified but not bundled.

**Dark mode**: `@custom-variant dark` keyed on `[data-darkmode=true]`, switching logic in `header.ut`.

**Templates**: `header.ut`, `footer.ut`, `sysauth.ut` — ucode templates rendered server-side on OpenWrt.

## Key References

- **Development guide**: `.dev/docs/DEVELOPMENT.md` — dev server setup, env config, proxy details, CI workflows, directory structure
- **Vite config**: `.dev/vite.config.ts` — custom plugins (luci-js-compress, local-serve, redirect, ut-sync, remove-layers)
- **Version**: `PKG_VERSION` and `PKG_RELEASE` in `Makefile`
