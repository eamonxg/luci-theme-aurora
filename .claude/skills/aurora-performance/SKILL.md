---
name: aurora-performance
description: Use when developing an OpenWrt LuCI theme — editing ucode (.ut) templates, adding or loading CSS/JS/font/image assets, writing CSS animations or menu/drawer interactions, reviewing a theme PR for performance, or measuring TTFB, transfer size, memory, or dropped frames on router-served pages.
---

# Aurora Theme Performance

## Overview

Two machines are involved, and they have almost nothing in common. The
**server** is the router: 1–2 slow cores, 64–512 MB RAM, squashfs flash, a
single-process `uhttpd` with no dynamic compression — every cycle you spend
there repeats on every page view. The **client** is the browser, usually a
phone on the router's own WiFi, doing the actual painting and animating. Both
planes have budgets, and "it feels fine on my laptop" proves nothing on
either of them. Every optimization claim needs a measurement, not a
rationalization — "consistent with the existing pattern" is not a cost
justification.

## When to use

- Editing a `.ut` template, or anything that adds a `ubus`/`uci`/`fs` call
- Adding or changing what loads in `<head>` — CSS, JS, fonts, images
- Writing a CSS animation, transition, or JS-driven interaction
- Reviewing a theme PR for performance impact
- Measuring TTFB, transfer size, memory, or dropped frames

Not for: pure content/copy changes with no runtime surface (rewording a
label, fixing a typo, adjusting a translation string).

## The three planes

| Touching | Read |
|---|---|
| `.ut` templates, ubus/uci/fs calls, shipped file sizes | references/server.md |
| `<head>` links/scripts, assets, caching, compression | references/loading.md |
| CSS animations, JS interactions, transitions | references/runtime.md |
| Verifying/quantifying any of the above | references/measuring.md |

## Non-negotiables (quick reference)

- **S1** — Compute at build time, never at request time. → references/server.md
- **S2** — Per-request ubus/uci/fs calls are a budget. → references/server.md
- **S3** — Every byte sent is router CPU. → references/server.md
- **S4** — Memory has a ceiling. → references/server.md
- **L1** — Kill render-blocking requests. → references/loading.md
- **L2** — Download once, cache forever. → references/loading.md
- **L3** — Ship compressed. → references/loading.md
- **R1** — Animate compositor properties only. → references/runtime.md
- **R2** — JS must not force synchronous layout. → references/runtime.md
- **R3** — Accessibility is functionality. → references/runtime.md

## Budgets & ledger

The reference files above are generic to any LuCI theme. The concrete numbers
for THIS theme — budget table, optimization ledger, accepted exceptions — live
in `references/aurora-budgets.md`. Consult it before declaring a budget met or
re-proposing a previously rejected optimization. The measured baselines backing
those numbers sit in `baselines/` (git-ignored: they record device model and
LAN address, so they stay local). Porting this skill to another theme means
swapping `references/aurora-budgets.md` and `baselines/`.
