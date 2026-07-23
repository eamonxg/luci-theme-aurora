<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>
<p align="center">
    <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/logo/logo-lockup.png" width="360" alt="Aurora Theme"/>
</p>
<p align="center"><strong>一款基于 Vite 和 Tailwind CSS 构建的现代 OpenWrt LuCI 主题。</strong></p>
<h4 align="center">🏔️ 纯净 | 🦢 优雅 | 📱 响应式 | 🌗 深色/浅色模式 | ⚙️ 可配置 </h4>
<div align="center">
  <a href="https://openwrt.org"><img alt="OpenWrt" src="https://img.shields.io/badge/OpenWrt-%E2%89%A523.05-00B5E2?logo=openwrt&logoColor=white"></a>
  <a href="https://www.google.com/chrome/"><img alt="Chrome" src="https://img.shields.io/badge/Chrome-%E2%89%A5111-4285F4?logo=googlechrome&logoColor=white"></a>
  <a href="https://www.apple.com/safari/"><img alt="Safari" src="https://img.shields.io/badge/Safari-%E2%89%A516.4-000000?logo=safari&logoColor=white"></a>
  <a href="https://www.mozilla.org/firefox/"><img alt="Firefox" src="https://img.shields.io/badge/Firefox-%E2%89%A5128-FF7139?logo=firefoxbrowser&logoColor=white"></a>
  <a href="https://github.com/eamonxg/luci-theme-aurora/releases/latest"><img alt="GitHub release" src="https://img.shields.io/github/v/release/eamonxg/luci-theme-aurora"></a>
  <a href="https://github.com/eamonxg/luci-theme-aurora/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/eamonxg/luci-theme-aurora/total"></a>
  <a href="https://discord.gg/EBncRrzfTw"><img alt="Discord" src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white"></a>
  <a href="#加入贡献"><img alt="Contributors" src="https://img.shields.io/github/contributors/eamonxg/luci-theme-aurora?color=orange"></a>
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/multi-device-showcase.png" alt="Multi-Device Showcase" width="100%">
</div>


## 特性

- **现代化**：内容优先的现代化 UI 设计，布局整洁，动画优雅。
- **移动端友好**：针对移动端的交互和显示进行了优化，适配手机和平板设备。
- **主题切换**：内置主题切换器，支持在自动（跟随系统）、浅色和深色模式之间无缝切换。
- **悬浮工具栏**：提供可点击的图标按钮，用于快速访问常用页面。
- **可安装（PWA）**：内置 Web 应用清单（manifest）与应用图标，可将 LuCI 安装到主屏幕，像原生应用一样启动。
- **高度可定制**：[luci-app-aurora-config](https://github.com/eamonxg/luci-app-aurora-config) 插件内置多套主题预设，可自由切换；同时还支持自定义浅色/深色色彩令牌、导航布局（Mega Menu、下拉菜单、侧边栏）、布局间距、字体排版、品牌标识（Logo、favicon、登录背景），以及添加或编辑悬浮工具栏中的常用页面。

## 预览

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/preview-demo.gif" alt="Theme Demo" width="100%">
  <br>
  <sub><strong>✨ 概览</strong> — 现代 UI 与优雅动效</sub>
</div>

<br>

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/dark-light-preview.png" alt="Dark and Light Preview" width="49%">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/mobile-preview.png" alt="Mobile Preview" width="49%">
</div>

## 兼容性

- **OpenWrt**：需要 OpenWrt 23.05.0 或更高版本，因为本主题使用了 ucode 模板和 LuCI JavaScript APIs。
- **浏览器**：基于 **TailwindCSS v4** 构建。兼容以下现代浏览器：
  - **Chrome/Edge 111+** _(2023 年 3 月发布)_
  - **Safari 16.4+** _(2023 年 3 月发布)_
  - **Firefox 128+** _(2024 年 7 月发布)_

## 安装

以下命令均在路由器本机执行（例如通过 SSH 会话）。

### 通过 eamonxg 软件源

OpenWrt 25.12+ 和 Snapshot 版本使用 `apk`；其他版本使用 `opkg`：

> **提示**：您可以运行 `opkg --version` 或 `apk --version` 来确认您的包管理器。如果有输出内容（而非 "not found"），那就是您的包管理器。

```sh
wget -qO- https://openwrt.eamonxg.fun/install.sh | sh
```

- **opkg**（OpenWrt < 25.12）：

  ```sh
  opkg install luci-theme-aurora
  ```

- **apk**（OpenWrt 25.12+ 及 snapshots）：

  ```sh
  apk add luci-theme-aurora
  ```

一次性添加源，之后更新只需 `opkg update && opkg install luci-theme-aurora` / `apk update && apk add luci-theme-aurora`，无需再手动下载安装包。详细信息见 [openwrt.eamonxg.fun](https://openwrt.eamonxg.fun/)。

### 通过 GitHub Release

```sh
cd /tmp

# opkg
uclient-fetch -O luci-theme-aurora.ipk https://github.com/eamonxg/luci-theme-aurora/releases/latest/download/luci-theme-aurora_1.1.0-r20260711_all.ipk
opkg install luci-theme-aurora.ipk

# apk
uclient-fetch -O luci-theme-aurora.apk https://github.com/eamonxg/luci-theme-aurora/releases/latest/download/luci-theme-aurora-1.1.0-r20260711.apk
apk add --allow-untrusted luci-theme-aurora.apk
```

## 从源码构建

使用 OpenWrt 构建系统自行编译。主机前置条件见 [Build system setup](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem)。产物位于 `bin/packages/<arch>/base/`（例如 `bin/packages/x86_64/base/luci-theme-aurora_*_all.ipk`），拷贝到路由器后按上文方式安装即可。

### 通过完整源码或 SDK

准备环境——克隆完整源码：

```sh
# 完整源码——openwrt-24.10 分支构建 .ipk，main 分支构建 .apk
git clone https://github.com/openwrt/openwrt.git
cd openwrt
git checkout openwrt-24.10
```

或 [预编译 SDK](https://openwrt.org/docs/guide-developer/toolchain/using_the_sdk)（更快，省去编译工具链）。从 [downloads.openwrt.org](https://downloads.openwrt.org) 下载与目标匹配的压缩包，下载页面按 Release 和 Snapshot 分类——Release 24.10.x 及以下构建 `.ipk`；Release 25.12+ 和 Snapshot 构建 `.apk`（文件名、架构、压缩格式因目标而异）：

```sh
wget <从 downloads.openwrt.org 获取的 SDK 压缩包地址>
tar -xf openwrt-sdk-*.tar.*
cd openwrt-sdk-*/
```

然后在该目录下：

```sh
# 加入本软件包并安装 feeds（提供 luci-base）
git clone https://github.com/eamonxg/luci-theme-aurora.git package/luci-theme-aurora
./scripts/feeds update -a
./scripts/feeds install -a

# 在 menuconfig 中勾选主题：LuCI → Themes → luci-theme-aurora
make menuconfig

# 用 SDK 时跳过这两行——它已自带编译好的工具链
make tools/install -j$(nproc)
make toolchain/install -j$(nproc)

make package/luci-theme-aurora/compile -j$(nproc) V=s
```

## 加入贡献

Aurora 使用 **Vite** 与现代前端工具链构建，并尝试将 AI 融入开发全链路。详见[开发文档](.dev/docs/DEVELOPMENT.md)。欢迎提交建议或 PR。

[discord.gg/EBncRrzfTw](https://discord.gg/EBncRrzfTw)

感谢这些出色的贡献者：

<!-- contributors:start -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.29%"><a href="https://github.com/eamonxg"><img src="https://avatars.githubusercontent.com/u/114069097?v=4&s=160" width="80px;" alt="eamonxg"/><br /><sub><b>eamonxg</b></sub></a></td>
      <td align="center" valign="top" width="14.29%"><a href="https://github.com/cjayacopra"><img src="https://avatars.githubusercontent.com/u/83209495?v=4&s=160" width="80px;" alt="cjayacopra"/><br /><sub><b>cjayacopra</b></sub></a></td>
      <td align="center" valign="top" width="14.29%"><a href="https://github.com/chillykidd"><img src="https://avatars.githubusercontent.com/u/197483577?v=4&s=160" width="80px;" alt="chillykidd"/><br /><sub><b>chillykidd</b></sub></a></td>
    </tr>
  </tbody>
</table>
<!-- contributors:end -->

## 许可与致谢

[Apache 2.0](LICENSE)。致谢：

- [luci-theme-bootstrap](https://github.com/openwrt/luci/tree/master/themes/luci-theme-bootstrap)
- [Vite](https://vitejs.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Tabler Icons](https://tabler.io/icons) — 界面图标集
- [Claude Code](https://claude.ai/code)
- [Apple](https://www.apple.com/) 和 [Vercel](https://vercel.com/) — 设计灵感
