<h4 align="right"><strong>English</strong> | <a href="README_zh.md">简体中文</a></h4>
<p align="center">
    <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/logo/logo-lockup.png" width="360" alt="Aurora Theme"/>
</p>
<p align="center"><strong>A modern OpenWrt LuCI theme built with Vite and Tailwind CSS.</strong></p>
<h4 align="center">🏔️ Pure | 🦢 Elegant | 📱 Responsive | 🌗 Dark/Light Mode | ⚙️ Settable </h4>
<div align="center">
  <a href="https://openwrt.org"><img alt="OpenWrt" src="https://img.shields.io/badge/OpenWrt-%E2%89%A523.05-00B5E2?logo=openwrt&logoColor=white"></a>
  <a href="https://www.google.com/chrome/"><img alt="Chrome" src="https://img.shields.io/badge/Chrome-%E2%89%A5111-4285F4?logo=googlechrome&logoColor=white"></a>
  <a href="https://www.apple.com/safari/"><img alt="Safari" src="https://img.shields.io/badge/Safari-%E2%89%A516.4-000000?logo=safari&logoColor=white"></a>
  <a href="https://www.mozilla.org/firefox/"><img alt="Firefox" src="https://img.shields.io/badge/Firefox-%E2%89%A5128-FF7139?logo=firefoxbrowser&logoColor=white"></a>
  <a href="https://github.com/eamonxg/luci-theme-aurora/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/eamonxg/luci-theme-aurora"></a>
  <a href="https://github.com/eamonxg/luci-theme-aurora/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/eamonxg/luci-theme-aurora/total"></a>
  <a href="https://discord.gg/EBncRrzfTw"><img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white"></a>
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/multi-device-showcase.png" alt="Multi-Device Showcase" width="100%">
</div>


## Features

- **Modern**: Modern, content-first UI design with a clean layout and elegant animations.
- **Mobile-friendly**: Optimized for mobile interactions and display, supporting both smartphones and tablets.
- **Theme Switcher**: Built-in theme switcher with seamless switching between Auto (system), Light, and Dark modes.
- **Floating Toolbar**: Clickable button icons for quick access to frequently used pages.
- **Installable (PWA)**: Ships a web app manifest and app icons, so LuCI can be installed to your home screen and launched like a native app.
- **Customizable**: The [luci-app-aurora-config](https://github.com/eamonxg/luci-app-aurora-config) plugin includes multiple built‑in theme presets you can switch between, and lets you customize Light/Dark color tokens, the navigation layout (Mega Menu, Dropdown, Sidebar), layout density, typography, branding (logo, favicons, login background), and the floating toolbar (add or edit frequently used pages).

## Preview

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/preview-demo.gif" alt="Theme Demo" width="100%">
  <br>
  <sub><strong>✨ Overview</strong>— Modern UI & Elegant Animations</sub>
</div>

<br>

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/dark-light-preview.png" alt="Dark and Light Preview" width="49%">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/mobile-preview.png" alt="Mobile Preview" width="49%">
</div>

## Compatibility

- **OpenWrt**: Requires OpenWrt 23.05.0 or later, as the theme uses ucode templates and LuCI JavaScript APIs.
- **Browsers**: Built with **TailwindCSS v4**. Compatible with the following modern browsers:
  - **Chrome/Edge 111+** _(released March 2023)_
  - **Safari 16.4+** _(released March 2023)_
  - **Firefox 128+** _(released July 2024)_

## Install a pre-built release

OpenWrt 25.12+ and snapshots use `apk`; other versions use `opkg`:

> **Tip**: You can confirm your package manager by running `opkg --version` or `apk --version`. If it returns output (not "not found"), that's your package manager.

- **opkg** (OpenWrt < 25.12):

  ```sh
  cd /tmp && uclient-fetch -O luci-theme-aurora.ipk https://github.com/eamonxg/luci-theme-aurora/releases/latest/download/luci-theme-aurora_1.0.0-r20260619_all.ipk && opkg install luci-theme-aurora.ipk
  ```

- **apk** (OpenWrt 25.12+ and snapshots):
  ```sh
  cd /tmp && uclient-fetch -O luci-theme-aurora.apk https://github.com/eamonxg/luci-theme-aurora/releases/latest/download/luci-theme-aurora-1.0.0-r20260619.apk && apk add --allow-untrusted luci-theme-aurora.apk
  ```

## Build from source

Build the package yourself with the OpenWrt build system. Host prerequisites: [Build system setup](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem). The build writes the package to `bin/packages/<arch>/base/` (e.g. `bin/packages/x86_64/base/luci-theme-aurora_*_all.ipk`); copy it to your router and install it as above.

### Via the OpenWrt buildroot

```sh
# Clone OpenWrt — the openwrt-24.10 branch builds an .ipk, the main branch builds an .apk
git clone https://github.com/openwrt/openwrt.git
cd openwrt
git checkout openwrt-24.10       # omit to stay on main (snapshots → .apk)

# Add this package and install feeds (provides luci-base)
git clone https://github.com/eamonxg/luci-theme-aurora.git package/luci-theme-aurora
./scripts/feeds update -a
./scripts/feeds install -a

# Select the theme in menuconfig: LuCI → Themes → luci-theme-aurora
make menuconfig

# Build host tools + toolchain, then compile the package
make tools/install -j$(nproc)
make toolchain/install -j$(nproc)
make package/luci-theme-aurora/compile -j$(nproc) V=s
```

### Via the prebuilt SDK (faster)

The [OpenWrt SDK](https://openwrt.org/docs/guide-developer/toolchain/using_the_sdk) bundles a prebuilt toolchain, so the `tools/install` / `toolchain/install` steps are skipped. Download the SDK for your target from [downloads.openwrt.org](https://downloads.openwrt.org) (a release SDK builds `.ipk`, a snapshot SDK builds `.apk`), extract it, then from the SDK directory:

```sh
git clone https://github.com/eamonxg/luci-theme-aurora.git package/luci-theme-aurora
./scripts/feeds update -a
./scripts/feeds install -a

# Select the theme in menuconfig: LuCI → Themes → luci-theme-aurora
make menuconfig
make package/luci-theme-aurora/compile -j$(nproc) V=s
```

## Contributing

Aurora uses **Vite** and a modern front-end toolchain, and is experimenting with end-to-end AI integration across the full development workflow. See [Development Documentation](.dev/docs/DEVELOPMENT.md) to get started. Suggestions and PRs are always welcome.

[discord.gg/EBncRrzfTw](https://discord.gg/EBncRrzfTw)

## License & Credits

[Apache 2.0](LICENSE). Thanks to:

- [luci-theme-bootstrap](https://github.com/openwrt/luci/tree/master/themes/luci-theme-bootstrap)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Claude Code](https://claude.ai/code)
- [Apple](https://www.apple.com/) and [Vercel](https://vercel.com/) — design inspiration
