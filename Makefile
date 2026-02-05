#
# Copyright (C) 2025 eamonxg <eamonxiong@gmail.com>
# Licensed under the Apache License, Version 2.0.
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Aurora Theme (A modern browser theme built with Vite and Tailwind CSS)
LUCI_DEPENDS:=+luci-base

PKG_VERSION:=0.10.11
PKG_RELEASE:=20260206
PKG_LICENSE:=Apache-2.0

LUCI_MINIFY_CSS:=
CONFIG_LUCI_CSSTIDY:=

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
