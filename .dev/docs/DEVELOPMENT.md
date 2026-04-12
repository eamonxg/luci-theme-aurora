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
3. CSS requests to `/luci-static/aurora/main.css` are rewritten to serve from `.dev/src/media/main.css`
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
│   ├── main.css           # Minified CSS (via lightningcss)
│   ├── fonts/             # Web fonts (Lato)
│   └── images/            # Logo assets + PWA icons
└── resources/
    └── menu-aurora.js     # Menu configuration (minified via Terser)
```

**Build Process:**

1. Vite builds CSS entry point (`src/media/main.css`)
2. Custom PostCSS plugin removes `@layer` at-rules for OpenWrt compatibility
3. Custom Vite plugin (`luci-js-compress`) minifies JS files via Terser
4. Static assets copied from `.dev/public/aurora/`

## Package Compilation

### Via GitHub Actions

**Build frontend assets:**

1. Manually trigger the `frontend-assets-build` workflow
2. It runs `pnpm build`, then auto-commits the output to `htdocs/` if anything changed

**Build `.ipk`/`.apk` packages:**

1. Push a version tag (`v*`) or push to `master` with `[build]` in the commit message
2. The `build-theme-package` workflow compiles the OpenWrt package

**PR checks:**

Pull requests that touch `.dev/`, `htdocs/`, `ucode/`, or `root/` are automatically linted and build-verified by the `pr-check` workflow.

**Workflow Files:** `.github/workflows/`
- `frontend-assets-build.yml` — Build assets and auto-commit
- `build-theme-package.yml` — Compile `.ipk`/`.apk` packages
- `pr-check.yml` — Lint and build verification for PRs

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
│   │   └── clean.js                # Build cleanup utility
│   ├── src/                        # Source code
│   │   ├── assets/icons/           # SVG icons
│   │   ├── media/                  # CSS entry points
│   │   │   └── main.css            # Main stylesheet (Tailwind CSS)
│   │   └── resource/               # JavaScript resources
│   │       └── menu-aurora.js      # Menu logic
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
│   │   └── main.css                # Compiled CSS
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
  **[pnpm](https://pnpm.io/)** - Fast, disk space efficient package manager
- **[lightningcss](https://lightningcss.dev/)** - CSS minifier
- **[Terser](https://terser.org/)** - JavaScript minifier
- **[Prettier](https://prettier.io/)** - Code formatter
- **[prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)** - Tailwind class sorting
