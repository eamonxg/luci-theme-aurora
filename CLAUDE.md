# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All dev commands run from `.dev/`:

```bash
cd .dev/
pnpm setup      # One-shot dev setup: router IP → .env, installs SSH key on device
pnpm dev        # Start Vite dev server (proxies to OpenWrt device)
pnpm build      # Clean + regenerate tokens + build production assets to htdocs/luci-static/
pnpm gen:tokens # Regenerate src/media/_tokens.css from tokens/ (also runs as part of build)
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

**CSS**: two Tailwind CSS v4 entry points in `.dev/src/media/` — `main.css` (admin UI; a pure import manifest over `_tokens.css`, `_base.css`, `_elements.css`, `_layout.css`, `components/*.css`, `_utilities.css`) and `login.css` (standalone login page; imports `_base.css`). Third-party compatibility patches are not bundled into `main.css`; each lives in `media/patches/<data-page>.css`, builds to its own `htdocs/luci-static/aurora/patches/<data-page>.css`, and is linked on demand by `header.ut`, which discovers installed patches at render time via `fs.lsdir()` and matches them on path-segment-boundary prefixes (dynamic subpages inherit their prefix's patch; third-party packages may drop their own patch into the directory) — see "On-Demand Third-Party Patches" in `.dev/docs/DEVELOPMENT.md`. All styling MUST use TailwindCSS v4 utility classes via `@apply` — no raw CSS properties (e.g. write `@apply text-sm font-semibold;` not `font-size: 14px; font-weight: 600;`). Use [CSS Nesting syntax](https://drafts.csswg.org/css-nesting/) for selectors. Theme colors defined as OKLCH custom properties in `_tokens.css` and mapped via `@theme inline`. Built CSS keeps Tailwind's native `@layer` structure (theme partials are unlayered, so they outrank layered utilities); the OKLCH requirement already gates browsers to ones with `@layer` support. See `.dev/docs/DEVELOPMENT.md` for the full CSS file layout.

**Design tokens**: `_tokens.css` is GENERATED — do not hand-edit (see its header comment). Source of truth is `.dev/tokens/`: `defaults.js` holds the 10 editable input colors per mode (`bg`, `surface`, `text`, `brand`, `on_brand`, `link`, `info`, `warning`, `success`, `danger`); `spec.js` declares how every other token derives from those via `mix`/`shade`/`set`/`alpha`/`const` operators plus `FIXED` literals (shadows); `engine.js`/`resolve.js` do the OKLCH math and flatten everything to plain `oklch(...)` values. After changing inputs or derivations, run `pnpm gen:tokens` to rewrite `_tokens.css`, and `pnpm test` to check the color-math and token invariants.

**JavaScript**: LuCI `E()` DOM API (not React/Vue). Minified but not bundled.

**Dark mode**: `@custom-variant dark` keyed on `[data-darkmode=true]`, switching logic in `header.ut`.

**Templates**: `header.ut`, `footer.ut`, `sysauth.ut` — ucode templates rendered server-side on OpenWrt.

## Key References

- **Development guide**: `.dev/docs/DEVELOPMENT.md` — dev server setup, env config, proxy details, CI workflows, directory structure
- **Vite config**: `.dev/vite.config.ts` — custom plugins (luci-js-compress, local-serve, redirect, ut-sync)
- **Version**: `PKG_VERSION` and `PKG_RELEASE` in `Makefile`
