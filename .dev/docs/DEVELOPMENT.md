# Development Guide

This guide covers the complete development workflow for the Aurora theme, from environment setup to building production packages.

## Prerequisites

- **[Node.js 20.19+ / 22.12+](https://nodejs.org/en/download)** - JavaScript runtime (mirrors Vite 7's support range — odd releases like 21.x don't qualify; enforced at `pnpm install` time via `engines` + `engine-strict`, so an unsupported Node fails fast with a clear message)
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
# One-shot wizard: asks for every .env value (router IP, dev-server host/port,
# current .env entries as defaults), generates/installs an SSH key (one
# router-password prompt), verifies template sync end-to-end, and writes .env
pnpm setup:router

# Non-interactive: pass the IP directly (no prompts; dev-server values keep
# their saved .env entries or defaults)
pnpm setup:router 192.168.2.1
```

> The script is named `setup:router` (not `setup`) because `pnpm setup` resolves to pnpm's own built-in setup command and would never run a package script.

**What it does** (`scripts/setup.js`), in order:

1. **Collects the `.env` values.** With no argument it prompts for each variable in turn, showing the current `.env` entry as the default (an empty answer keeps it). With an IP argument it takes that as `VITE_OPENWRT_HOST` non-interactively and leaves the dev-server values alone. Nothing is written yet — `.env` is only updated once every step below has succeeded.
2. **Pre-flights the connection.** A raw TCP probe of `<host>:22` with a 2s timeout, so an unreachable device or one with SSH disabled fails immediately with a clear message instead of hanging inside ssh.
3. **Finds or generates an SSH key.** It looks for `~/.ssh/id_ed25519.pub`, `id_rsa.pub`, `id_ecdsa.pub` in that order and reuses the first one present — an existing key is never overwritten. **If you have no key at all, it generates one** (`ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519`). The empty passphrase is deliberate: `.ut` sync has to run unattended for the whole `pnpm dev` session.
4. **Installs the public key on the router.** It first tests whether passwordless SSH already works (`ssh -o BatchMode=yes … echo ok`) and skips the install if so — after a full reflash that wipes the key, the test fails and the install simply runs again. Otherwise it appends the key to `/etc/dropbear/authorized_keys` over one interactive SSH session; the append is guarded by `grep -qxF`, so re-running never duplicates the entry. **This is the only step that asks for the router's root password, and it asks once.** Afterwards it re-tests passwordless auth and classifies any failure (wrong password / host unreachable / other). On a device running openssh rather than dropbear the key belongs in `/root/.ssh/authorized_keys` instead — install it manually there and this step detects it and skips.
5. **Verifies the sync end-to-end.** Rather than trusting `echo ok`, it pushes `ucode/template/themes/aurora/` through the exact `tar -cf - | ssh … tar -xf -` pipeline the `ut-sync` plugin uses (see [Template (`.ut`) Live Sync](#template-ut-live-sync)). If this passes, `pnpm dev`'s template sync will too.
6. **Writes `.env`.** Managed keys are rewritten in place so surrounding comments keep their meaning, missing ones are appended, and any other line passes through untouched.

> The password prompt in step 4 comes from the **local** ssh client, which reads it straight from `/dev/tty` rather than stdin — so it shows up normally even though the script pipes ssh's stderr in order to classify errors. It does mean the step needs a controlling terminal **on the development machine** (the router side is unaffected): run it from a normal shell, not from CI, `nohup`, or an editor task pane, where ssh has no way to ask and the run fails at authentication. Check with `tty` if unsure; in such an environment, install the key by hand instead.

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

- **`main.css`** — the LuCI admin UI. It is an import manifest that disables Tailwind's automatic source scan (`source(none)`) and pulls in (in order) `@eamonxg/luci-theme-tokens/dist/aurora/tokens.css` (OKLCH theme tokens, mapped via `@theme inline`), shared `_icons.css`, `_base.css`, `_elements.css`, `_layout.css`, every file in `components/` (one partial per UI component — buttons, cards, modals, tables, etc.), and `_utilities.css`.
- **`login.css`** — the standalone login page (`sysauth.ut`). Self-contained: imports Tailwind theme/utilities with `source(none)`, omits full Preflight in favor of a tiny local reset, and imports `@eamonxg/luci-theme-tokens/dist/aurora/tokens.css` directly. At build time the `login-css-prune` plugin (`vite.config.ts`) strips every custom property the page's var() chains never reach, so the admin-sized token sheet ships login-sized.

Third-party compatibility patches are **not** bundled into `main.css` — they are split into per-page files under `media/patches/` and loaded on demand (see [On-Demand Third-Party Patches](#on-demand-third-party-patches) below).

**Adding new styles:**

- New UI component → create `components/_<name>.css` and add an `@import` line to `main.css`. Each file is its own organizational unit — don't add `@layer` wrappers: theme partials stay unlayered, so they outrank Tailwind's layered base/utilities regardless of specificity.
- Compatibility fix for a third-party LuCI app/page → add a new file under `media/patches/` (see below).

All rules use `@apply` with Tailwind utilities and CSS Nesting — no raw CSS properties. The one deliberate exception is `media/patches/*.css`, which is plain native CSS by design (see below).

### On-Demand Third-Party Patches

> Page-scoped JS patches must expose `window.aurora.patches[stem] = { mount, unmount }` (and mount themselves once at eval) so the client-side router can drive them across same-document navigations — see `router.md`.

Some third-party LuCI apps ship markup that doesn't adapt to the theme and needs a narrow compatibility override. Instead of bundling every such patch into `main.css` (which would ship them to **every** page), each patch is a standalone CSS file loaded **only on the page it targets**.

**How it works:**

1. **One file per page, named by `data-page`.** Each patch lives at `media/patches/<page>.css`, where `<page>` is the value of `<body data-page="…">` for the target page — i.e. the request path segments joined by `-` (e.g. `admin-services-openclash-config`). `header.ut` computes the same string at render time from `ctx.request_path`, falling back to `ctx.path` when `request_path` is empty (`join('-', length(ctx.request_path) ? ctx.request_path : ctx.path)`) so default landings reached without an explicit path still resolve their patch.
2. **Build splits, not bundles.** `vite.config.ts` adds every `media/patches/*.css` as its own Rollup entry, so each compiles to `htdocs/luci-static/aurora/patches/<page>.css`. They are no longer part of `main.css`.
3. **Plain CSS, not `@apply`.** Patches are the one place that writes native declarations instead of Tailwind utilities. Each patch is its own build entry, and the old `@reference "../main.css";` + `@apply` setup made every file carry its own `@property`/helper boilerplate. Rewriting the *same rules* natively — measured on the v1.1.7 → v1.1.8 conversion, built output, identical selectors and values:

   | patch | `@reference` + `@apply` | native CSS | saved |
   | --- | ---: | ---: | ---: |
   | admin-dashboard | 6,940 B | 2,639 B | −62% |
   | admin-modem-modemdata-modempreview | 162 B | 96 B | −41% |
   | admin-modem-qmodem | 9,483 B | 4,497 B | −53% |
   | admin-network-network | 160 B | 86 B | −46% |
   | admin-services-openclash-config | 187 B | 87 B | −53% |
   | admin-services-openclash-settings | 638 B | 509 B | −20% |
   | admin-statistics-graphs | 1,609 B | 110 B | −93% |
   | admin-system-filemanager | 576 B | 184 B | −68% |
   | **total** | **19,755 B** | **8,208 B** | **−58%** |

   The overhead is per-entry and fixed-ish (`@property` registrations, `--tw-*` helper chains), so the smaller the patch, the worse the ratio — the two-rule statistics patch paid 15× its own weight. uhttpd serves identity bytes (no gzip), so raw size is wire size. Note the runtime `:root` exposes the raw color tokens plus `--radius-base` and `--app-shadow-*` — the `--radius-3xl`-style names only exist inside the Tailwind build, so a patch writes `calc(var(--radius-base) * 3)` for radii, never `var(--radius-3xl)`. The old Tailwind mode is still *supported* for theme-repo patches — a file starting with `@reference "../main.css";` and using `@apply` continues to compile — and it has real upsides worth weighing against the table above: **build-time validation** (a typo'd utility or color name fails the build, while a typo'd `var()` fails silently at runtime — exactly how the `--radius-3xl` regression slipped into the native rewrite), the **same vocabulary** as the component partials with the `dark:`/`md:`/`hover:` variant shorthands, and **automatic tracking** when the theme remaps a utility (a radius-chain or shadow-token change recompiles into Tailwind patches for free; native patches need a hand edit). Native is the default convention for the size numbers, not a hard gate. App-shipped patches (installed straight into the device's `patches/` directory) have never had a choice: they bypass the build entirely, so `@apply` would reach the browser as dead text — plain CSS only, as always. It also means third-party patch authors need no Tailwind knowledge. Reach theme values through the `:root` custom properties (`var(--surface-sunken)`, `var(--hairline)`, `var(--radius-3xl)`, `var(--shadow-lg)`, …) rather than hardcoding colors or radii; the dark variant is a plain selector (`[data-darkmode="true"] & { … }`), breakpoints are plain media queries (`@media (width < 48rem)`), and CSS Nesting still works — the build (lightningcss) minifies and lowers it for the supported browsers.
4. **`header.ut` discovers patches at render time.** On each (non-login) page render, `header.ut` lists `/www/luci-static/aurora/patches/` with ucode's `fs.lsdir()` (a readdir of a dozen entries — microseconds, dwarfed by the template's existing `ubus` call) and matches the installed `*.css` filenames against the **cumulative path-segment prefixes** of the request: a patch matches its exact page and any subpage, but only on real segment boundaries — `admin-services-wol.css` covers `admin/services/wol/plus`, yet never a sibling app whose own segment merely starts the same way (`admin/services/wol-plus`). Every matching patch is linked right after `main.css`, in lexical order — so a general patch loads before a more specific one and the specific one cascades on top. Pages with no match get nothing — no extra request, no 404. If the directory is missing or unreadable, the list is empty and the page renders unpatched.
5. **The patches directory is a drop-in extension point.** Because discovery is at render time, patches don't have to ship with the theme: **any package may install a `<page-prefix>.css` into `/www/luci-static/aurora/patches/`** and the theme will load it on matching pages. Install/uninstall lifecycle is automatic — the file appears and disappears with the package, no registration or allow-list rebuild. (Patches shipped this way are plain CSS served as-is; the theme's own patches are written the same way and only pass through the build for minification.)
6. **Dynamically generated pages are covered by their fixed prefix.** Some apps mint a page per entity — e.g. QModem's SMS conversations render as `admin-modem-qmodem-sms-conversation-<contact>`. Name the patch after the fixed prefix (`admin-modem-qmodem-sms-conversation.css`) and the prefix match loads it for every conversation page, regardless of the contact name. No wildcard syntax is needed (and `*` in a filename is not supported).

**Adding a patch:**

1. Open the target page in the browser and read `document.body.dataset.page` — that exact string is your filename (for a family of dynamic per-entity pages, use their fixed prefix instead — see point 5 above).
2. Create `media/patches/<that-string>.css`:
   ```css
   /* PATCH: <page> (luci-app-foo) */

   [data-page="<page>"] {
     /* narrow, selector-scoped overrides — native CSS + CSS Nesting,
        theme values via var(--surface), var(--hairline), … */
   }
   ```
3. Run `pnpm build`. There is no allow-list to regenerate — the loader discovers whatever `.css` files are installed under `patches/` at render time.
4. Verify `htdocs/luci-static/aurora/patches/<page>.css` is small (just your rules).

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

> Unlike the `_`-prefixed partials (which are `@import`-only fragments), patch filenames have no `_` prefix — each is a real build entry that ships to `htdocs/`. This also holds inside `media/patches/` itself: a `_`-prefixed file there is a shared fragment for other patches to `@import`, skipped by the entry scan and never shipped.

**JS payloads.** The mechanism is not CSS-specific: the same `lsdir()` sweep also collects `patches/<page>.js` files, emitted as `<script defer src>` right after the patch stylesheet links — same per-page prefix matching, same drop-in lifecycle for third-party packages (ship a plain script; it must not assume LuCI modules are loadable via `L.require` at parse time — run after DOM ready or poll for your target element). Theme-owned JS patches live at `src/resource/patches/<page>.js` and build through the same Terser pass as other resource JS, but land under `aurora/patches/` so one directory listing serves both payload types. First user: the log-viewer enhancement on `admin-status-logs` (parses the read-only `#syslog` textarea into a colored, column-aligned view, with a parse-success gate that falls back to the stock textarea on unknown log formats; the one prefix covers the System Log tab, the Kernel Log tab and the bare `/logs` alias on every supported release). Its CSS is deliberately **not** a patch: the log pages are stock LuCI, so their styling lives in `components/_syslog.css` inside `main.css`, where the full Tailwind token pipeline (reactive radii, shadows, config-app overrides) applies — patches/ stays reserved for third-party compatibility.

**Aliases — one payload, several pages.** When two unrelated page names need the same payload, naming the file after their shared prefix would over-match (an `admin-status` patch would load on *every* status subpage, including the busiest overview page). For that case `PATCH_ALIASES` in `vite.config.ts` duplicates the built output (CSS and JS) under each alias name, and the dev server resolves alias requests to the shared source. Duplicate CSS *entries* would not work as an alternative: Rollup deduplicates identical-content assets into a single file, so one of the two names would silently never ship. (The map is currently empty — the log viewer turned out to need only `admin-status-logs`, since every supported release mounts both log pages under `admin/status/logs/*`.)

### Mock Pages

Style a third-party app's page — write or adjust its `patches/*.css`, or check a `main.css`/component change against it — **without having the app (or a device) installed**. Save the page's rendered HTML once, then develop against it with the theme live and hot-reloading.

- **Where snapshots live:** `.dev/mocks/*.html` (git-ignored — snapshots are large, device/fork-specific and go stale, so they stay local). The directory need not exist in a fresh clone; it's created on first capture.
- **The mock bar:** every HTML page this dev server hands out — proxied device pages and served snapshots alike — gets `scripts/mock-bar.client.js` (served at `/mocks/__bar.js`), a floating bar in the bottom-left corner. It lives in a Shadow DOM, so theme and patch CSS can neither restyle it nor be polluted by it, and the theme's own floating toolbar keeps the bottom-right corner. On a device page it lists what `.dev/mocks/` holds, so the workflow is reachable without typing the `/mocks/` URL: `◆` appears when this page's `data-page` matches a snapshot and opens it in one click, `⊕` captures the open page, and an empty `.dev/mocks/` shrinks the bar to a lone `⊕`. Inside a snapshot it names the open one, steps through the rest, and `↩` goes back to the same page on the device. `✕` collapses it to a dot, remembered in `localStorage['aurora.mockbar.collapsed']`. The snapshot list is injected inline next to the script; both tags carry `data-aurora-mock`, which is how a capture strips them back out — a snapshot must never bake in a list that is re-injected, current, on every serve.
- **Capture one:** with the dev server proxying a device that has the page, open the page through the proxy and hit `⊕` on the mock bar — or press <kbd>Alt/Option+Shift+S</kbd>, or call `__auroraMockCapture()` in the console. It POSTs the live DOM to `/mocks/__save`, which writes `.dev/mocks/<data-page>.html` — named after the page's `data-page`, doctype included, dev-only script tags stripped. (The endpoint only accepts requests carrying the helper's custom header, which cross-origin pages can't send without a CORS preflight this server never approves.) Manual capture still works: run `copy(document.documentElement.outerHTML)` in the DevTools console and save the paste as `.dev/mocks/<name>.html` — the filename is free; the page's real identity is the `data-page` attribute already in its `<body>`, which patch selectors match.
- **Capture it from a device running _this_ theme — snapshots are not portable between themes.** A snapshot is a verbatim copy of a rendered page, so it hard-codes the theme that rendered it in three places: the stylesheet links (`/luci-static/aurora/main.css` plus that page's patch), the device's stored UCI token overrides in an inline `<style>`, and the theme's own header/nav markup. Drop a snapshot captured under `luci-theme-shadcn` in here (or vice versa) and the page renders **completely unstyled**, because a dev server only serves its own `/luci-static/<theme>/` prefix. The giveaway is a terminal line naming the other theme's stylesheet:
  ```
  [Mocks] miss /luci-static/shadcn/main.css → 404 (mirror it at .dev/mocks/static/… to serve it)
  ```
  Mirroring, which that generic hint suggests, is the wrong fix here — re-capture the page from a device running this theme. If you must reuse a foreign snapshot anyway, only the app's own content region means anything: point its stylesheet links at this theme, and delete the inline `<style>` block, or the captured device's colors override this checkout's tokens.
- **View:** `pnpm dev`, then open <http://localhost:5173/mocks/> — an auto-generated index lists every snapshot with its `data-page` and age. The `mock-pages-plugin` (in `vite.config.ts`) serves each page with the Vite HMR client injected, so editing any theme source (`main.css`, a component, a `patches/*.css`, or served JS) triggers the usual full reload (see [Live Reload Behavior](#live-reload-behavior)). The snapshot keeps its absolute `/luci-static/…` links; theme CSS/JS, fonts and images resolve locally and compile on the fly. Serving prepends the `<!doctype html>` that `outerHTML` captures drop, so mocks render in standards mode exactly like the real page.
- **Navigate between snapshots in place:** inside a mock the bar also takes over clicks on the snapshot's own LuCI links (`/cgi-bin/luci/…`), resolving them against the captured snapshots by `data-page` (exact match) and jumping straight to the matching mock — an app's tab bar or the sidebar works just like on the device. Uncaptured targets are blocked with a hint naming the missing snapshot instead of falling through to the proxy. The bar lists every snapshot, cycles with <kbd>[</kbd>/<kbd>]</kbd> (or its ‹/› buttons) and links back to the index. `↩` leaves for the real page: its target is the `requestpath` from LuCI's own inline bootstrap, but only when that agrees with the snapshot's `data-page` (a hand-assembled mock can carry the segments of the page it was built from); otherwise it falls back to splitting `data-page`, which is lossy whenever a path segment contains a dash of its own (`admin-status-disks-info`), then to the last device page visited in this tab.
- **Third-party assets:** an app's own css/js the snapshot references (e.g. `qmodem-next.css`, or a device-only custom logo) isn't in this repo. To serve it, mirror its URL under `.dev/mocks/static/` (e.g. `.dev/mocks/static/luci-static/resources/qmodem/qmodem-next.css`); files there are served as-is (no HMR). Misses requested by a mock page 404 immediately — never proxied to the router, so mocks stay fully offline-capable — and each miss prints a one-time terminal hint with the exact mirror path. (CSS-initiated requests, e.g. nav icons, carry the stylesheet's URL as referer and can't be attributed to the mock page; any `/luci-static` request that falls through to the proxy is therefore bounded to 5s and answers 504 when the router is unreachable.) The theme still applies without them.
- **No auth, no runtime:** a snapshot is static DOM, so `mock-pages-plugin` strips LuCI's runtime scripts (`luci.js`/`cbi.js`/`xhr.js` and `/cgi-bin/` endpoints) and injects a no-op `L`/`LuCI`/`XHR` stub before serving. Without this, LuCI boots, polls the backend, gets 403 (no session) and pops the "Session expired" modal. The trade-off: framework-dependent theme JS (e.g. `menu-aurora`) no-ops in mocks — the captured DOM is already rendered, so it still looks right. The theme's own inline scripts (dark mode, toolbar state) and any `src/media/` JS still run.

### Design Tokens

There is no local `_tokens.css` and no generation step: `main.css`/`login.css` `@import "@eamonxg/luci-theme-tokens/dist/aurora/tokens.css"` directly, resolved straight out of `node_modules` at build time. The source of truth lives in the standalone [`@eamonxg/luci-theme-tokens`](https://github.com/eamonxg/luci-theme-tokens) npm package, consumed here as a devDependency:

- **`aurora/defaults.js`** — the 10 editable input colors (`bg`, `surface`, `text`, `brand`, `on_brand`, `link`, `info`, `warning`, `success`, `danger`) for light and dark mode, as OKLCH strings.
- **`aurora/spec.js`** — `DERIVATIONS` (how every other token — `text_muted`, `surface_sunken`, `hairline`, `brand_hover`, `brand_subtle`, `focus_ring`, `progress_start`/`progress_end`, `*_surface`, `scrim`, `mega_menu_bg`, …) is computed from the inputs via `mix`/`shade`/`set`/`alpha`/`const` operators, and `FIXED` (mode-specific literals such as shadows that bypass derivation).
- **`engine.js`** — the OKLCH/OKLAB color math behind those operators, via [colorjs.io](https://colorjs.io/).
- **`resolve.js`** — `createResolver` walks a `DERIVATIONS` spec and returns a flat `{token: oklchString}` map with no `color-mix()`/`var()` left in it; `aurora/index.js` pre-binds this to Aurora's own spec as `resolveMode(mode)`, exported from the package's `/aurora` entry point.
- **`dist/aurora/tokens.css`** — built by the package's own `build.mjs` (its `prepublishOnly`) and shipped in the published tarball; nothing in this repo regenerates it.

**Changing a color:**

1. Edit `aurora/spec.js`/`aurora/defaults.js` in the [`luci-theme-tokens`](https://github.com/eamonxg/luci-theme-tokens) repo (derivation rules, fixed literals, base input colors), tag a release so CI tests, builds `dist/`, and publishes the package, then bump the `@eamonxg/luci-theme-tokens` devDependency version here and run `pnpm install`. For unreleased iteration against a local checkout, run `pnpm link ../../luci-theme-tokens` from `.dev` instead of bumping/publishing.
2. Run `pnpm build` — Vite resolves `@eamonxg/luci-theme-tokens/dist/aurora/tokens.css` straight from `node_modules`, so a version bump (or `pnpm link`) is all a color change needs on this side.
3. Run `pnpm test` to check the color-math and derived-token invariants (`tests/resolve.test.js`, `tests/surfaces.test.js`, both importing `resolveMode` from `@eamonxg/luci-theme-tokens/aurora`) — e.g. hue families, lightness ordering between `bg`/`surface_sunken`/`surface`, and translucency of menu backgrounds.

**Runtime overrides from UCI:** `header.ut` reads `uci get_all aurora.theme` on each render and re-emits stored tokens as CSS custom-property overrides in an inline `<style>` after `main.css`. Keys are namespaced by prefix — `light_*` and `struct_*` land in `:root`, `dark_*` in `[data-darkmode="true"]` — with the prefix stripped and `_` mapped to `-` (e.g. `light_surface_sunken` → `--surface-sunken`). The template flattens all keys in a single pass into two pre-joined declaration strings (rather than per-key template loops), which halves the iteration work and keeps the emitted `<style>` compact. This is the hook `luci-app-aurora-config` writes through.

### LuCI JavaScript API

For LuCI-specific JavaScript development, refer to the official API documentation:

- [LuCI JavaScript API Reference](http://openwrt.github.io/luci/jsapi/index.html)

### Live Reload Behavior

- **CSS changes**: Trigger full page reload via custom HMR handler
- **JS changes**: Trigger full page reload via custom HMR handler
- **Template changes** (`.ut` files): Auto-synced to router over SSH and trigger full page reload (one-time `pnpm setup:router` required, see below)

### Template (`.ut`) Live Sync

The `.ut` template files are rendered server-side on the OpenWrt device, so unlike CSS/JS they can't be served locally — the dev server pushes them to the router instead. Run `pnpm setup:router` once to configure passwordless SSH; after that it's fully automatic:

- **On startup**, the whole template directory is pushed (as one tarball over ssh stdin — Dropbear has no SFTP server for scp), so edits made while the dev server was down never leave the router stale.
- **On save**, changes are debounced and the directory is pushed again, then the browser reloads.
- **On page load**, requests to `/cgi-bin` wait for any in-flight push, so a proxied render never uses a stale template.

**Troubleshooting** — sync errors are printed with the fix:

- **Host key mismatch** (device was reflashed): Run `ssh-keygen -R <device-ip>`, then restart the dev server
- **Authentication failed** (public key not on device, e.g. after a reflash): Run `pnpm setup:router`
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

1. Vite builds the CSS entry points (`src/media/main.css` and `src/media/login.css`), resolving `@eamonxg/luci-theme-tokens/dist/aurora/tokens.css` straight from `node_modules` (see [Design Tokens](#design-tokens)) and keeping Tailwind's native `@layer` structure
2. Custom Vite plugin (`luci-js-compress`) minifies JS files via Terser
3. Static assets copied from `.dev/public/aurora/`

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
│   │   └── DEVELOPMENT.md          # Development guide (this file)
│   ├── mocks/                      # Local page snapshots for /mocks/ (git-ignored, see Mock Pages)
│   ├── public/aurora/              # Public static assets
│   │   ├── fonts/                  # Web fonts (Lato)
│   │   └── images/                 # Theme images + PWA icons
│   ├── scripts/                    # Build scripts + dev-server client helpers
│   │   ├── clean.js                # Build cleanup utility
│   │   ├── mock-bar.client.js      # Injected into device pages and /mocks/ — snapshot bar, capture, link takeover
│   │   └── setup.js                # pnpm setup:router — .env wizard + passwordless SSH to the router
│   ├── src/                        # Source code
│   │   ├── assets/icons/           # SVG icons
│   │   ├── media/                  # CSS source (Tailwind CSS v4)
│   │   │   ├── main.css            # Admin UI entry point (import manifest; tokens via @eamonxg/luci-theme-tokens)
│   │   │   ├── login.css           # Login page entry point
│   │   │   ├── _base.css           # Document foundation (html/body viewport bg)
│   │   │   ├── _elements.css       # Base element styles (headings, links, …)
│   │   │   ├── _layout.css         # Page layout/structure
│   │   │   ├── _utilities.css      # Custom utility classes
│   │   │   ├── components/         # One partial per UI component
│   │   │   └── patches/            # Per-page third-party patches (on-demand, one file per data-page)
│   │   └── resource/               # JavaScript resources
│   │       └── menu-aurora.js      # Menu logic
│   ├── tests/                      # All test suites (pnpm test)
│   │   ├── resolve.test.js         # Resolved token invariants (against @eamonxg/luci-theme-tokens/aurora)
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
- **[colorjs.io](https://colorjs.io/)** - OKLCH/OKLAB color math for design token generation (used by [`@eamonxg/luci-theme-tokens`](https://github.com/eamonxg/luci-theme-tokens))
- **[Terser](https://terser.org/)** - JavaScript minifier
- **[Prettier](https://prettier.io/)** - Code formatter
- **[prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)** - Tailwind class sorting
- **[tw-animate-css](https://github.com/Wombosvideo/tw-animate-css)** - Animation utilities for Tailwind CSS
- **[tailwind-scrollbar](https://github.com/adoxography/tailwind-scrollbar)** - Custom scrollbar styling plugin
