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
# Copy environment template
cp .env.example .env

# Edit .env and set your OpenWrt device address
# VITE_OPENWRT_HOST=http://192.168.1.1
```

**Environment Variables:**

- `VITE_OPENWRT_HOST` - Your OpenWrt LuCI web interface URL (required)
- `VITE_OPENWRT_SSH_HOST` - SSH target for `.ut` template sync, e.g. `root@192.168.1.1` (optional)
- `VITE_OPENWRT_SSH_KEY` - Path to SSH private key (optional, falls back to ssh-agent or `~/.ssh/config`)
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

- New UI component → create `components/_<name>.css` and add an `@import` line to `main.css`. Each file is its own organizational unit — no `@layer` wrappers needed (any that remain are stripped by PostCSS).
- Compatibility fix for a third-party LuCI app/page → add a new file under `media/patches/` (see below).

All rules use `@apply` with Tailwind utilities and CSS Nesting — no raw CSS properties.

### On-Demand Third-Party Patches

Some third-party LuCI apps ship markup that doesn't adapt to the theme and needs a narrow compatibility override. Instead of bundling every such patch into `main.css` (which would ship them to **every** page), each patch is a standalone CSS file loaded **only on the page it targets**.

**How it works:**

1. **One file per page, named by `data-page`.** Each patch lives at `media/patches/<page>.css`, where `<page>` is the value of `<body data-page="…">` for the target page — i.e. the request path segments joined by `-` (e.g. `admin-services-openclash-config`). `header.ut` computes the same string at render time from `ctx.request_path`, falling back to `ctx.path` when `request_path` is empty (`join('-', length(ctx.request_path) ? ctx.request_path : ctx.path)`) so default landings reached without an explicit path still resolve their patch.
2. **Build splits, not bundles.** `vite.config.ts` adds every `media/patches/*.css` as its own Rollup entry, so each compiles to `htdocs/luci-static/aurora/patches/<page>.css`. They are no longer part of `main.css`.
3. **`@reference`, not `@import`.** Every patch file starts with `@reference "../main.css";`. This loads the theme context (tokens, custom utilities like `bg-surface`, the `dark:` variant) so `@apply` resolves — **without** re-emitting `main.css` into the patch output. Using `@import` here would inline all of `main.css` into every patch (hundreds of KB); `@reference` keeps each patch to just its own rules.
4. **`header.ut` links exactly one patch.** A static allow-list `PATCH_PAGES` in `header.ut` lists which pages have a patch file. When the current page is in the list, header emits a single `<link>` to its patch file, right after `main.css` (so patches can override base styles). Pages not in the list get nothing — no extra request, no 404. A static list is used (rather than probing the filesystem) to avoid a hard `fs` dependency in the template and to avoid 404s on the ~95% of pages with no patch.

**Adding a patch:**

1. Open the target page in the browser and read `document.body.dataset.page` — that exact string is your filename.
2. Create `media/patches/<that-string>.css`:
   ```css
   /* PATCH: <page> (luci-app-foo) */
   @reference "../main.css";

   [data-page="<page>"] {
     /* narrow, selector-scoped overrides using @apply + CSS Nesting */
   }
   ```
3. Run `pnpm build` (or just `pnpm gen:patch-pages`). The `PATCH_PAGES` allow-list in `header.ut` is **auto-generated** from the `patches/` directory by `scripts/gen-patch-pages.js` — no manual editing. It rewrites the region between the `//#patch-pages-start` / `//#patch-pages-end` markers; don't hand-edit inside them.
4. Verify `htdocs/luci-static/aurora/patches/<page>.css` is small (just your rules, not a copy of `main.css`).

> Removing a patch is symmetric: delete the file and rebuild — it drops out of `PATCH_PAGES` automatically.

> **Naming notes:** match the page exactly — granularity is per page, not per app. An app with several pages (e.g. openclash `…-config` and `…-settings`) gets one file per page. The filename has no `_` prefix (unlike the `_`-prefixed partials, which are `@import`-only fragments); patch files are real build entries that ship to `htdocs/`.

### Design Tokens

`src/media/_tokens.css` is **generated** — its header says "DO NOT EDIT". The source of truth is `.dev/tokens/`:

- **`defaults.js`** — the 10 editable input colors (`bg`, `surface`, `text`, `brand`, `on_brand`, `link`, `info`, `warning`, `success`, `danger`) for light and dark mode, as OKLCH strings.
- **`spec.js`** — `DERIVATIONS` (how every other token — `text_muted`, `surface_sunken`, `hairline`, `brand_hover`, `brand_subtle`, `focus_ring`, `progress_start`/`progress_end`, `*_surface`, `scrim`, `mega_menu_bg`, …) is computed from the inputs via `mix`/`shade`/`set`/`alpha`/`const` operators, and `FIXED` (mode-specific literals such as shadows that bypass derivation).
- **`engine.js`** — the OKLCH/OKLAB color math behind those operators, via [colorjs.io](https://colorjs.io/).
- **`resolve.js`** — `resolveMode(mode)` walks `DERIVATIONS` and returns a flat `{token: oklchString}` map with no `color-mix()`/`var()` left in it.

**Changing a color:**

1. Edit `tokens/defaults.js` (base input colors) and/or `tokens/spec.js` (derivation rules, fixed literals).
2. Run `pnpm gen:tokens` (also runs automatically as part of `pnpm build`) to rewrite `src/media/_tokens.css` — it emits `:root` (light) and `[data-darkmode="true"]` (dark) blocks plus the `@theme inline` mapping, in that order.
3. Run `pnpm test` to check the color-math operators and derived-token invariants (`tests/engine.test.js`, `tests/resolve.test.js`, `tests/surfaces.test.js`) — e.g. hue families, lightness ordering between `bg`/`surface_sunken`/`surface`, and translucency of menu backgrounds.

### LuCI JavaScript API

For LuCI-specific JavaScript development, refer to the official API documentation:

- [LuCI JavaScript API Reference](http://openwrt.github.io/luci/jsapi/index.html)

### Live Reload Behavior

- **CSS changes**: Trigger full page reload via custom HMR handler
- **JS changes**: Trigger full page reload via custom HMR handler
- **Template changes** (`.ut` files): Auto-synced to router via SCP and trigger full page reload (requires SSH setup, see below)

### Template (`.ut`) Live Sync

The `.ut` template files are rendered server-side on the OpenWrt device. To see template changes during development, the dev server can automatically sync modified `.ut` files to the router via SCP.

**1. Set up SSH key authentication to your router:**

```bash
# Generate a key if you don't have one
ssh-keygen -t ed25519

# Copy your public key to the router (OpenWrt uses Dropbear, not OpenSSH)
cat ~/.ssh/id_ed25519.pub | ssh root@192.168.1.1 "cat >> /etc/dropbear/authorized_keys"

# Verify passwordless login works
ssh root@192.168.1.1 "echo ok"
```

**2. Add SSH config to `.env`:**

```bash
# SSH target for .ut file sync (user@host)
VITE_OPENWRT_SSH_HOST=root@192.168.1.1

# Optional: path to SSH private key (falls back to ssh-agent or ~/.ssh/config)
# VITE_OPENWRT_SSH_KEY=~/.ssh/id_ed25519
```

**3. Start `pnpm dev` and edit any `.ut` file** — the dev server will automatically sync it to the router and reload the browser.

**Troubleshooting:**

The dev server checks SSH connectivity on startup and prints actionable errors:

- **Host key mismatch** (device was reflashed): Run `ssh-keygen -R <device-ip>`, then restart the dev server
- **Authentication failed** (public key not on device): Copy your key with the command above
- **Connection refused/timed out**: Check that the device is online and SSH is enabled

If `VITE_OPENWRT_SSH_HOST` is not set, template sync is simply disabled and other dev features work normally.

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

1. `pnpm gen:tokens` regenerates `src/media/_tokens.css` from `tokens/` (see [Design Tokens](#design-tokens))
2. Vite builds the CSS entry points (`src/media/main.css` and `src/media/login.css`)
3. Custom PostCSS plugin removes `@layer` at-rules for OpenWrt compatibility
4. Custom Vite plugin (`luci-js-compress`) minifies JS files via Terser
5. Static assets copied from `.dev/public/aurora/`

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
│   │   └── gen-tokens.js           # Regenerates src/media/_tokens.css from tokens/
│   ├── src/                        # Source code
│   │   ├── assets/icons/           # SVG icons
│   │   ├── media/                  # CSS source (Tailwind CSS v4)
│   │   │   ├── main.css            # Admin UI entry point (import manifest)
│   │   │   ├── login.css           # Login page entry point
│   │   │   ├── _tokens.css         # OKLCH theme tokens -- GENERATED, see tokens/
│   │   │   ├── _base.css           # Document foundation (html/body viewport bg)
│   │   │   ├── _elements.css       # Base element styles (headings, links, …)
│   │   │   ├── _layout.css         # Page layout/structure
│   │   │   ├── _utilities.css      # Custom utility classes
│   │   │   ├── components/         # One partial per UI component
│   │   │   └── patches/            # Per-page third-party patches (on-demand, one file per data-page)
│   │   └── resource/               # JavaScript resources
│   │       └── menu-aurora.js      # Menu logic
│   ├── tokens/                     # Design token source (-> src/media/_tokens.css)
│   │   ├── defaults.js             # 10 editable input colors (light/dark)
│   │   ├── spec.js                 # Derivation rules (DERIVATIONS) + fixed literals
│   │   ├── engine.js               # OKLCH/OKLAB color math (mix/shade/set/alpha)
│   │   └── resolve.js              # Resolves spec into a flat token map
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
- **[colorjs.io](https://colorjs.io/)** - OKLCH/OKLAB color math for design token generation (`.dev/tokens/`)
- **[Terser](https://terser.org/)** - JavaScript minifier
- **[Prettier](https://prettier.io/)** - Code formatter
- **[prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)** - Tailwind class sorting
- **[tw-animate-css](https://github.com/Wombosvideo/tw-animate-css)** - Animation utilities for Tailwind CSS
- **[tailwind-scrollbar](https://github.com/adoxography/tailwind-scrollbar)** - Custom scrollbar styling plugin
