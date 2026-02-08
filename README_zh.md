<h4 align="right"><a href="README.md">English</a> | <strong>简体中文</strong></h4>
<p align="center">
    <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/logo/logo-circular.png" width="152"/>
</p>
<h1 align="center">Aurora Theme</h1>
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
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/theme/multi-device-showcase.png" alt="Multi-Device Showcase" width="100%">
</div>

## 特性

- **现代化**：内容优先的现代化 UI 设计，布局整洁，动画优雅。
- **移动端友好**：针对移动端的交互和显示进行了优化，适配手机和平板设备。
- **主题切换**：内置主题切换器，支持在自动（跟随系统）、浅色和深色模式之间无缝切换。
- **悬浮工具栏**：提供可点击的图标按钮，用于快速访问常用页面。
- **高度可定制**：[luci-app-aurora-config](https://github.com/eamonxg/luci-app-aurora-config) 插件内置多套主题预设，可自由切换；同时还支持自定义颜色、导航子菜单样式、主题 Logo，以及添加或编辑悬浮工具栏中的常用页面。

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

OpenWrt 25.12+ 和 Snapshot 版本使用 `apk`；其他版本使用 `opkg`：

> **提示**：您可以运行 `opkg --version` 或 `apk --version` 来确认您的包管理器。如果有输出内容（而非 "not found"），那就是您的包管理器。

- **opkg** (OpenWrt < 25.12):

  ```sh
  cd /tmp && uclient-fetch -O luci-theme-aurora.ipk https://github.com/eamonxg/luci-theme-aurora/releases/latest/download/luci-theme-aurora_0.11.0-r20260208_all.ipk && opkg install luci-theme-aurora.ipk
  ```

- **apk** (OpenWrt 25.12+ 及 snapshots):

  ```sh
  cd /tmp && uclient-fetch -O luci-theme-aurora.apk https://github.com/eamonxg/luci-theme-aurora/releases/latest/download/luci-theme-aurora-0.11.0-r20260208.apk && apk add --allow-untrusted luci-theme-aurora.apk
  ```

## 加入贡献

<details>
<summary><b>关于开发</b></summary>

<p>步入 2026 年，前端工具链已相当成熟先进，并且现代浏览器也支持了很多有趣的新特性。所以全面拥抱现代前端生态是 Aurora 主题的核心理念。</p>

<p>Aurora 使用 <strong>Vite</strong> 作为构建工具。</p>

<ul>
<li>在开发过程中，您可以自由选择并集成任何 CSS 工具链。</li>
<li>在生产环境中，提供多种策略来优化打包资源。</li>
<li>最重要的是，借助于本地代理服务器，样式的修改可以实时预览！</li>
</ul>

<p>更多开发信息，请参阅 <a href=".dev/docs/DEVELOPMENT.md">开发文档</a>。</p>

</details>

<h4>社区</h4>

<p>我建立了一个 Discord 服务器 —— 欢迎来聊天！👋 <a href="https://discord.gg/EBncRrzfTw">加入 Discord</a></p>

## 许可与致谢

本项目基于 Apache License 2.0 许可开源。

生产构建结构基于官方 OpenWrt 主题 [luci-theme-bootstrap](https://github.com/openwrt/luci/tree/master/themes/luci-theme-bootstrap)。

视觉风格和部分实现受到 [Apple](https://www.apple.com/) 和 [Vercel](https://vercel.com/) 的影响。

本项目使用现代前端技术栈开发，包括 [Vite](https://vitejs.dev/) 和 [Tailwind CSS](https://tailwindcss.com/)。
