# Development Guide

This guide covers the complete development workflow for the Aurora theme, from environment setup to building production packages.

## Prerequisites

- **[Node.js v20.19+](https://nodejs.org/en/download)** - JavaScript runtime
- **pnpm** - Package manager (managed via [Corepack](https://github.com/nodejs/corepack))
- **Tailwind CSS knowledge** - Required for styling. See [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- **Network access** - Development machine must be on the same network as your OpenWrt router

## Environment Setup

### 1. Clone and Install

```bash
# Clone the repository
git clone git@github.com:eamonxg/luci-theme-aurora.git
cd luci-theme-aurora/.dev/

# Enable Corepack to manage pnpm version
corepack enable && corepack prepare

# Install dependencies
pnpm install
```

### 2. Configure Environment

```bash
# One-shot wizard: asks for the router IP, generates/installs an SSH key
# (one router-password prompt), and writes .env
pnpm setup
```

If the router is at the default `192.168.1.1` and passwordless SSH already works, no `.env` is needed at all — every value below has a working default.

**Environment Variables** (all optional):

- `VITE_OPENWRT_HOST` - bare router address, e.g. `192.168.1.1` (default; `host:port` and full-URL forms also accepted). The web proxy target and the `.ut`-sync SSH target (`root@<hostname>`) both derive from it; anything fancier (a dedicated key, a jump host, a non-standard ssh port) belongs in a `Host` block in `~/.ssh/config`, which ssh picks up automatically.
- `VITE_DEV_HOST` - Development server host (code default: `127.0.0.1`, `.env.example` sets `0.0.0.0` for LAN access)
- `VITE_DEV_PORT` - Development server port (default: `5173`)

## Development Workflow

### Start Development Server

```bash
cd luci-theme-aurora/.dev/
pnpm dev
```

The development server will start at `http://127.0.0.1:5173` and proxy requests to your OpenWrt device.

**How Vite Proxy Works:**

The Vite development server uses middleware to rewrite local requests to serve CSS/JS resources from your development environment instead of the router. This enables live editing without deploying to the router. For detailed implementation, see `vite.config.ts`.

**Key proxy behaviors:**

1. Proxies `/cgi-bin` and `/luci-static` requests to OpenWrt device
2. Uses middleware (`createLocalServePlugin`) to rewrite request paths for CSS and JS files
3. CSS requests to `/luci-static/aurora/main.css` and `/luci-static/aurora/login.css` are rewritten to serve from `.dev/src/media/main.css` and `.dev/src/media/login.css` respectively
4. JS file requests are served directly from `.dev/src/resource/` with middleware reading and returning file content
5. Injects Vite HMR client into proxied HTML responses for live reload support
6. Redirects `/` to `/cgi-bin/luci` for proper routing

### Code Style and Formatting

This project uses **Prettier** for code formatting with automatic formatting on save.

**Prettier Configuration:**

- Located in `.prettierrc`
- VS Code settings in `.vscode/settings.json` enable format-on-save for CSS and JS files
- Uses `prettier-plugin-tailwindcss` to sort Tailwind CSS classes

### CSS Nesting Support

Thanks to **lightningcss**, you can freely use [CSS Nesting syntax](https://drafts.csswg.org/css-nesting/) in your stylesheets. The build process automatically compiles nested CSS into flat, browser-compatible format.

This will be compiled to standard CSS that works in all browsers.

### CSS Architecture

The theme has two independent Tailwind CSS v4 entry points, both sourced from `.dev/src/media/`:

- **`main.css`** — the LuCI admin UI. It contains no rules of its own; it's a pure import manifest that pulls in (in order) `_tokens.css` (OKLCH theme tokens, mapped via `@theme inline`), `_base.css`, `_elements.css`, `_layout.css`, every file in `components/` (one partial per UI component — buttons, cards, modals, tables, etc.), and `_utilities.css`.
- **`login.css`** — the standalone login page (`sysauth.ut`). Self-contained: imports Tailwind and `_tokens.css` directly.

Third-party compatibility patches are **not** bundled into `main.css` — they are split into per-page files under `media/patches/` and loaded on demand (see [On-Demand Third-Party Patches](#on-demand-third-party-patches) below).

**Adding new styles:**

- New UI component → create `components/_<name>.css` and add an `@import` line to `main.css`. Each file is its own organizational unit — don't add `@layer` wrappers: theme partials stay unlayered, so they outrank Tailwind's layered base/utilities regardless of specificity.
- Compatibility fix for a third-party LuCI app/page → add a new file under `media/patches/` (see below).

All rules use `@apply` with Tailwind utilities and CSS Nesting — no raw CSS properties.

### On-Demand Third-Party Patches

Some third-party LuCI apps ship markup that doesn't adapt to the theme and needs a narrow compatibility override. Instead of bundling every such patch into `main.css` (which would ship them to **every** page), each patch is a standalone CSS file loaded **only on the page it targets**.

**How it works:**

1. **One file per page, named by `data-page`.** Each patch lives at `media/patches/<page>.css`, where `<page>` is the value of `<body data-page="…">` for the target page — i.e. the request path segments joined by `-` (e.g. `admin-services-openclash-config`). `header.ut` computes the same string at render time from `ctx.request_path`, falling back to `ctx.path` when `request_path` is empty (`join('-', length(ctx.request_path) ? ctx.request_path : ctx.path)`) so default landings reached without an explicit path still resolve their patch.
2. **Build splits, not bundles.** `vite.config.ts` adds every `media/patches/*.css` as its own Rollup entry, so each compiles to `htdocs/luci-static/aurora/patches/<page>.css`. They are no longer part of `main.css`.
3. **`@reference`, not `@import`.** Every patch file starts with `@reference "../main.css";`. This loads the theme context (tokens, custom utilities like `bg-surface`, the `dark:` variant) so `@apply` resolves — **without** re-emitting `main.css` into the patch output. Using `@import` here would inline all of `main.css` into every patch (hundreds of KB); `@reference` keeps each patch to just its own rules.
4. **`header.ut` discovers patches at render time.** On each (non-login) page render, `header.ut` lists `/www/luci-static/aurora/patches/` with ucode's `fs.lsdir()` (a readdir of a dozen entries — microseconds, dwarfed by the template's existing `ubus` call) and matches the installed `*.css` filenames against the **cumulative path-segment prefixes** of the request: a patch matches its exact page and any subpage, but only on real segment boundaries — `admin-services-wol.css` covers `admin/services/wol/plus`, yet never a sibling app whose own segment merely starts the same way (`admin/services/wol-plus`). Every matching patch is linked right after `main.css`, in lexical order — so a general patch loads before a more specific one and the specific one cascades on top. Pages with no match get nothing — no extra request, no 404. If the directory is missing or unreadable, the list is empty and the page renders unpatched.
5. **The patches directory is a drop-in extension point.** Because discovery is at render time, patches don't have to ship with the theme: **any package may install a `<page-prefix>.css` into `/www/luci-static/aurora/patches/`** and the theme will load it on matching pages. Install/uninstall lifecycle is automatic — the file appears and disappears with the package, no registration or allow-list rebuild. (Patches shipped this way are plain CSS served as-is; the theme's own patches additionally go through the Tailwind build below.)
6. **Dynamically generated pages are covered by their fixed prefix.** Some apps mint a page per entity — e.g. QModem's SMS conversations render as `admin-modem-qmodem-sms-conversation-<contact>`. Name the patch after the fixed prefix (`admin-modem-qmodem-sms-conversation.css`) and the prefix match loads it for every conversation page, regardless of the contact name. No wildcard syntax is needed (and `*` in a filename is not supported).

**Adding a patch:**

1. Open the target page in the browser and read `document.body.dataset.page` — that exact string is your filename (for a family of dynamic per-entity pages, use their fixed prefix instead — see point 5 above).
2. Create `media/patches/<that-string>.css`:
   ```css
   /* PATCH: <page> (luci-app-foo) */
   @reference "../main.css";

   [data-page="<page>"] {
     /* narrow, selector-scoped overrides using @apply + CSS Nesting */
   }
   ```
3. Run `pnpm build`. There is no allow-list to regenerate — the loader discovers whatever `.css` files are installed under `patches/` at render time.
4. Verify `htdocs/luci-static/aurora/patches/<page>.css` is small (just your rules, not a copy of `main.css`).

> Removing a patch is symmetric: delete the file and rebuild — the loader stops linking it because it no longer exists.

**Shipping a patch with a third-party app** (no theme release needed): build or hand-write a plain CSS file named after your page's `data-page` prefix and install it from your package's Makefile:

```makefile
define Package/luci-app-foo/install
	...
	$(INSTALL_DIR) $(1)/www/luci-static/aurora/patches
	$(INSTALL_DATA) ./htdocs/aurora-patch.css \
		$(1)/www/luci-static/aurora/patches/admin-services-foo.css
endef
```

The theme loads it automatically on `admin-services-foo` and all its subpages whenever both packages are installed. Note app-shipped patches bypass the theme's Tailwind build — write plain CSS (you can still target the theme's CSS custom properties, e.g. `var(--surface)`), and scope every rule under your own `[data-page^="…"]` selector.

**Naming.** The filename is the page's `data-page` string; matching by prefix means broader targets also just work:

| You want to patch… | File to create | Then it loads on |
| --- | --- | --- |
| One specific page, `admin/services/foo/general` | `admin-services-foo-general.css` | that page (and any subpage under it) |
| A whole app, all pages under `admin/services/foo/…` | `admin-services-foo.css` | `foo`, `foo/general`, `foo/rules`, … |
| Dynamic per-entity pages, e.g. QModem SMS `…/sms/conversation/<contact>` | `admin-modem-qmodem-sms-conversation.css` (the fixed prefix — no wildcard needed) | every conversation page, whatever the contact |

Two rules of thumb that follow from prefix matching:

- **A patch applies to its page and all subpages by default.** `admin-services-foo.css` loads on every page under `admin/services/foo/…`. When you need finer targeting, narrow it in either of two ways: scope individual rules inside the file (`[data-page="admin-services-foo-general"] { … }` only affects that one page), or ship an additional, longer-named file (`admin-services-foo-rules.css`) for page-specific rules — on a page matching both, **both load**, shorter name first, so the more specific file wins the cascade.
- **Matching respects path-segment boundaries**, so a prefix never leaks onto a lookalike sibling: `admin-services-wol.css` covers `admin/services/wol/plus` but not a different app at `admin/services/wol-plus`. The one unavoidable collision is two paths joining to the same `data-page` string (`wol/plus` vs `wol-plus`) — such a patch loads on both pages. If that matters, key rules to your app's own class names/ids so an accidental load matches nothing.

> Unlike the `_`-prefixed partials (which are `@import`-only fragments), patch filenames have no `_` prefix — each is a real build entry that ships to `htdocs/`.

### Design Tokens

`src/media/_tokens.css` is **generated** — its header says "DO NOT EDIT". The source of truth is the standalone [`@eamonxg/aurora-tokens`](https://github.com/eamonxg/aurora-tokens) npm package, consumed here as a devDependency:

- **`defaults.js`** — the 10 editable input colors (`bg`, `surface`, `text`, `brand`, `on_brand`, `link`, `info`, `warning`, `success`, `danger`) for light and dark mode, as OKLCH strings.
- **`spec.js`** — `DERIVATIONS` (how every other token — `text_muted`, `surface_sunken`, `hairline`, `brand_hover`, `brand_subtle`, `focus_ring`, `progress_start`/`progress_end`, `*_surface`, `scrim`, `mega_menu_bg`, …) is computed from the inputs via `mix`/`shade`/`set`/`alpha`/`const` operators, and `FIXED` (mode-specific literals such as shadows that bypass derivation).
- **`engine.js`** — the OKLCH/OKLAB color math behind those operators, via [colorjs.io](https://colorjs.io/).
- **`resolve.js`** — `resolveMode(mode)` walks `DERIVATIONS` and returns a flat `{token: oklchString}` map with no `color-mix()`/`var()` left in it. `.dev/scripts/gen-tokens.js` imports `resolveMode`/`FIXED` straight from the package root.

**Changing a color:**

1. Edit `spec.js`/`defaults.js` in the [`aurora-tokens`](https://github.com/eamonxg/aurora-tokens) repo (derivation rules, fixed literals, base input colors), tag a release so CI publishes the package, then bump the `@eamonxg/aurora-tokens` devDependency version here and run `npm install`. For unreleased iteration against a local checkout, run `npm link ../../aurora-tokens` from `.dev` instead of bumping/publishing.
2. Run `pnpm gen:tokens` (also runs automatically as part of `pnpm build`) to rewrite `src/media/_tokens.css` — it emits `:root` (light) and `[data-darkmode="true"]` (dark) blocks plus the `@theme inline` mapping, in that order.
3. Run `pnpm test` to check the color-math operators and derived-token invariants (`tests/engine.test.js`, `tests/resolve.test.js`, `tests/surfaces.test.js`) — e.g. hue families, lightness ordering between `bg`/`surface_sunken`/`surface`, and translucency of menu backgrounds.

**Runtime overrides from UCI:** `header.ut` reads `uci get_all aurora.theme` on each render and re-emits stored tokens as CSS custom-property overrides in an inline `<style>` after `main.css`. Keys are namespaced by prefix — `light_*` and `struct_*` land in `:root`, `dark_*` in `[data-darkmode="true"]` — with the prefix stripped and `_` mapped to `-` (e.g. `light_surface_sunken` → `--surface-sunken`). The template flattens all keys in a single pass into two pre-joined declaration strings (rather than per-key template loops), which halves the iteration work and keeps the emitted `<style>` compact. This is the hook `luci-app-aurora-config` writes through.

### LuCI JavaScript API

For LuCI-specific JavaScript development, refer to the official API documentation:

- [LuCI JavaScript API Reference](http://openwrt.github.io/luci/jsapi/index.html)

### Live Reload Behavior

- **CSS changes**: Trigger full page reload via custom HMR handler
- **JS changes**: Trigger full page reload via custom HMR handler
- **Template changes** (`.ut` files): Auto-synced to router over SSH and trigger full page reload (one-time `pnpm setup` required, see below)

### Template (`.ut`) Live Sync

The `.ut` template files are rendered server-side on the OpenWrt device, so unlike CSS/JS they can't be served locally — the dev server pushes them to the router instead. Run `pnpm setup` once to configure passwordless SSH; after that it's fully automatic:

- **On startup**, the whole template directory is pushed (as one tarball over ssh stdin — Dropbear has no SFTP server for scp), so edits made while the dev server was down never leave the router stale.
- **On save**, changes are debounced and the directory is pushed again, then the browser reloads.
- **On page load**, requests to `/cgi-bin` wait for any in-flight push, so a proxied render never uses a stale template.

**Troubleshooting** — sync errors are printed with the fix:

- **Host key mismatch** (device was reflashed): Run `ssh-keygen -R <device-ip>`, then restart the dev server
- **Authentication failed** (public key not on device): Run `pnpm setup`
- **Connection refused/timed out**: Check that the device is online and SSH is enabled

A failed sync is retried on the next `.ut` change; CSS/JS dev features work normally without SSH.

## Building for Production

### Build Command

```bash
cd luci-theme-aurora/.dev/
pnpm build
```

This compiles all assets to the production directory `htdocs/luci-static/`, which is used by LuCI during OpenWrt package compilation.

**Build Output:**

```
htdocs/luci-static/
├── aurora/
│   ├── main.css           # Minified admin UI CSS (via lightningcss)
│   ├── login.css          # Minified login page CSS (via lightningcss)
│   ├── fonts/             # Web fonts (Lato)
│   └── images/            # Logo assets + PWA icons
└── resources/
    └── menu-aurora.js     # Menu configuration (minified via Terser)
```

**Build Process:**

1. `pnpm gen:tokens` regenerates `src/media/_tokens.css` from `@eamonxg/aurora-tokens` (see [Design Tokens](#design-tokens))
2. Vite builds the CSS entry points (`src/media/main.css` and `src/media/login.css`), keeping Tailwind's native `@layer` structure
3. Custom Vite plugin (`luci-js-compress`) minifies JS files via Terser
4. Static assets copied from `.dev/public/aurora/`

## Package Compilation

### Via GitHub Actions

**Build frontend assets:**

1. Manually trigger the `frontend-assets-build` workflow
2. It runs `pnpm build`, then auto-commits the output to `htdocs/` if anything changed

**Build `.ipk`/`.apk` packages:**

1. Push a version tag (`v*`), push to `master`/`feat/**` with `[build]` in the commit message, or manually trigger the workflow
2. The `build-theme-package` workflow compiles both `.ipk` and `.apk` OpenWrt packages

**PR review:**

Pull requests that touch `.dev/`, `htdocs/`, `ucode/`, or `root/` are automatically reviewed by the `claude-pr-review` workflow — it posts inline comments on the source diff (generated `htdocs/` output is excluded) plus a summary comment. Mention `@claude` in a PR comment to request a follow-up review or ask a question.

**Issue triage:**

New issues are handled by the `claude-issue-bot` workflow — it checks for spam/duplicates, applies labels, and posts a deep technical analysis comment. Mention `@claude` in an issue comment to get a response.

**Workflow Files:** `.github/workflows/`
- `frontend-assets-build.yml` — Build assets and auto-commit (manual trigger)
- `build-theme-package.yml` — Compile `.ipk`/`.apk` packages
- `claude-pr-review.yml` — AI code review for PRs (inline + summary comments)
- `claude-issue-bot.yml` — AI issue triage and analysis

## Directory Structure

```
luci-theme-aurora/
├── .dev/                           # Development environment
│   ├── docs/                       # Project documentation
│   │   ├── changelog/              # Version changelogs
│   │   └── DEVELOPMENT.md          # Development guide (this file)
│   ├── public/aurora/              # Public static assets
│   │   ├── fonts/                  # Web fonts (Lato)
│   │   └── images/                 # Theme images + PWA icons
│   ├── scripts/                    # Build scripts
│   │   ├── clean.js                # Build cleanup utility
│   │   └── gen-tokens.js           # Regenerates src/media/_tokens.css from @eamonxg/aurora-tokens
│   ├── src/                        # Source code
│   │   ├── assets/icons/           # SVG icons
│   │   ├── media/                  # CSS source (Tailwind CSS v4)
│   │   │   ├── main.css            # Admin UI entry point (import manifest)
│   │   │   ├── login.css           # Login page entry point
│   │   │   ├── _tokens.css         # OKLCH theme tokens -- GENERATED, see @eamonxg/aurora-tokens
│   │   │   ├── _base.css           # Document foundation (html/body viewport bg)
│   │   │   ├── _elements.css       # Base element styles (headings, links, …)
│   │   │   ├── _layout.css         # Page layout/structure
│   │   │   ├── _utilities.css      # Custom utility classes
│   │   │   ├── components/         # One partial per UI component
│   │   │   └── patches/            # Per-page third-party patches (on-demand, one file per data-page)
│   │   └── resource/               # JavaScript resources
│   │       └── menu-aurora.js      # Menu logic
│   ├── tests/                      # All test suites (pnpm test)
│   │   ├── engine.test.js          # Color-math operators
│   │   ├── resolve.test.js         # Resolved token invariants
│   │   ├── surfaces.test.js        # Surface/hue layering invariants
│   │   ├── overlay.test.js         # Overlay/layout CSS assertions
│   │   └── navigation-*.test.js    # Navigation model/rendering/styles
│   ├── .env.example                # Environment variables template
│   ├── .prettierrc                 # Prettier configuration
│   ├── package.json                # Node.js dependencies
│   ├── pnpm-lock.yaml              # pnpm lock file
│   └── vite.config.ts              # Vite configuration with custom plugins
├── .github/                        # GitHub configuration
│   ├── ISSUE_TEMPLATE/             # Issue templates
│   ├── workflows/                  # GitHub Actions workflows
│   └── renovate.json               # Renovate dependency update config
├── .vscode/                        # VS Code workspace settings
│   └── settings.json               # Auto-format on save settings
├── htdocs/luci-static/             # Build output (generated by Vite)
│   ├── aurora/                     # Theme CSS and assets
│   │   ├── fonts/                  # Built font files
│   │   ├── images/                 # Built images + PWA icons
│   │   ├── main.css                # Compiled admin UI CSS
│   │   ├── login.css               # Compiled login page CSS
│   │   └── patches/                # Compiled per-page patches (linked on demand by header.ut)
│   └── resources/                  # Built JavaScript modules
│       └── menu-aurora.js          # Minified menu logic
├── root/etc/uci-defaults/          # OpenWrt system integration
│   └── 30_luci-theme-aurora        # Theme auto-setup script
├── ucode/template/themes/aurora/   # LuCI ucode templates
│   ├── header.ut                   # Header template
│   ├── footer.ut                   # Footer template
│   └── sysauth.ut                  # Login page template
├── LICENSE                         # Apache License 2.0
├── Makefile                        # OpenWrt package Makefile
├── README.md                       # English documentation
└── README_zh.md                    # Chinese documentation
```

## Tools and Technologies

- **[Tailwind CSS v4](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Vite](https://vitejs.dev/)** - Build tool and development server
- **[pnpm](https://pnpm.io/)** - Fast, disk space efficient package manager
- **[lightningcss](https://lightningcss.dev/)** - CSS minifier
- **[colorjs.io](https://colorjs.io/)** - OKLCH/OKLAB color math for design token generation (used by [`@eamonxg/aurora-tokens`](https://github.com/eamonxg/aurora-tokens))
- **[Terser](https://terser.org/)** - JavaScript minifier
- **[Prettier](https://prettier.io/)** - Code formatter
- **[prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)** - Tailwind class sorting
- **[tw-animate-css](https://github.com/Wombosvideo/tw-animate-css)** - Animation utilities for Tailwind CSS
- **[tailwind-scrollbar](https://github.com/adoxography/tailwind-scrollbar)** - Custom scrollbar styling plugin
