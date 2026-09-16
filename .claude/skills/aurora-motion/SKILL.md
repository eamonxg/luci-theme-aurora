---
name: aurora-motion
description: Use when a change adds, removes or adjusts motion in the Aurora theme (transition, animation, View Transition, hover/press/focus feedback, menu or drawer timing, 动效/动画/过渡/丝滑) or when a request asks "what should this state look like when it changes". Maps each LuCI UI state to one effect (CSS animates, JS only decides when and how far), keeps main.css and the theme JS from growing, and rejects motion that janks a phone or replays on poll.
---

# Aurora motion: which state gets which effect

## First principles

1. **The device is small.** The router has little RAM and flash, and it serves every byte uncompressed. Motion must not grow the theme. Decorative motion must be net ≤ 0 bytes across main.css and the theme JS. Only a functional fix (§Traps) may add bytes, and each must stay under ~100 B.
2. **CSS does the moving; JS decides, in moderation.** Transitions and keyframes animate. JS may decide *when* and *how far* (see §JS). No animation library: `motion/mini` alone is 9,751 B raw (measured 2026-09-16). At HEAD, main.css had 1,270 B left under its 193 KB budget and menu-aurora.js had 306 B left under 22 KB.
3. **Motion explains a state change, nothing else.** If a state is not in the table below, the answer is "no motion". Plain and quiet beats impressive.
4. **Never cause jank.** The client is usually a phone on the router's WiFi. See §Jank.

## State → effect

These timings are the only ones allowed: 150 ms for controls, 250 ms for surfaces, 300–320 ms only for large panels. Curves: `ease-out` for entering elements, `ease-in-out` for symmetric changes. `cubic-bezier(0.34,1.25,0.5,1)` is the float-button's overshoot and nothing else. "Today" describes HEAD.

| State | Hook | Effect | Today |
|---|---|---|---|
| Hover 悬停 (desktop only) | `:hover` | Colour change, instant. Icon-size controls may use `scale-105`. | top nav pills instant; some links still `transition-colors` |
| Focus 键盘聚焦 | `:focus-visible` | A ring appears. No movement. | `ring-2 ring-focus-ring` |
| Press 按下 | `:active` | `scale-95`, only on icon-size controls. | header toggles, switcher, card icons |
| Toggle 开关 | class flip | The thumb slides or the icon morphs. | `.theme-switcher`, hamburger → X |
| Expand / collapse 展开收起 | theme classes | Fade. Grid rows only where they already animate. | mobile submenu |
| Menu / drawer 菜单抽屉 | theme classes | Slide (translate) plus fade. A page scrim only dims; it is never blurred. The desktop sidebar pushes: its grid column eases with the panel's slide, same curve and length. | mega-menu (unblurred curtain), mobile nav, sidebar (push) |
| Tooltip 提示 | hover / focus | Fade plus `scale-95` → 100, after the intent delay. | `_tooltip.css`, `delay-300` |
| Dropdown open 下拉打开 | `.cbi-dropdown[open]` | Opacity .99 → 1 over 120 ms. This is functional: it fires luci-base's focus hand-off. | **missing** (Trap 2) |
| Modal open 弹窗打开 | `body.modal-overlay-active` | Fade in, reusing `aurora-fade-in`. The overlay goes from `display:none` to shown, so the keyframe restarts by itself. | none |
| Modal close 弹窗关闭 | class removed | None. luci-base provides no exit hook. | — |
| Notification in 通知出现 | `.alert-message.fade-in` | Fade in. | `_utilities.css` |
| Notification out 通知消失 | `.fade-out` (dismiss or timer) | Fade out. It must be a *running* transition. | **broken** (Trap 1) |
| View loading 页面加载中 | `#view > .spinning` | Spinner only. It keeps spinning under reduced motion. | `.spinning` |
| Page ready 内容就绪 | direct children of `#view` | At most one fade in, reusing `aurora-fade-in`. No stagger, no rise, and nothing deeper than the direct children. | none |
| Route leave 离开页面 | `#view.view-leaving` | Dim to 60 %. | `_layout.css` |
| Route enter 进入页面 | router swap | Same as "Page ready". Use one mechanism only: the View Transition or the fade, never both stacked. | router root crossfade |
| Tab switch 切换标签 | `[data-tab-active="true"]` | Fade in the incoming pane. Its height snaps. | none |
| Busy action 操作进行中 | `.spinning` on a button | Spinner. | `.spinning` |
| Progress 进度 | `.cbi-progressbar > div` | Width. This is an existing exception; don't copy it. | `_progress.css` |
| Drag 拖拽 | `.dragging` | A static state style, no motion. | `_form.css` |
| Invalid / success / error 校验与结果 | `.cbi-input-invalid`, `.alert-message.*` | Colour plus text. No shake, no bounce. | — |
| Poll refresh 数据刷新 | `LuCI.poll`, every 5 s | **None, ever.** | — |
| Theme switch 主题切换 | header.ut | View Transition crossfade. | header.ut |
| Disabled 禁用 | `:disabled` | None. | — |

The source lines for every hook are in references/luci-hooks.md.

### Never

Blur or mask reveal, parallax, scroll-linked or scroll-triggered motion, stagger on rows, cards or sections, text reveal, tilt, magnetic or cursor-follow effects, hover lift or shadow on `.cbi-section` or `#view`, skeleton screens, layout (FLIP) animation, crossfading tab panes, shake, loops other than `.spinning`, autoplay, and any motion on polled content.

## Bytes

Measured on main.css (raw, Tailwind 4.3.2 plus lightningcss, 2026-09-16). What you write matters more than what the effect is:

| Written as | Cost |
|---|---|
| Add a selector to an existing motion rule's selector list | **+17 B** |
| One shorthand on a new selector: `@apply [transition:opacity_150ms_ease-out]` | +50 B |
| Reuse the keyframe: `@apply animate-[aurora-fade-in_250ms_ease_backwards]` | +59 B |
| New keyframe plus its use (e.g. opacity + scale pop-in) | +141 B |
| Press as shorthand: `[transition:scale_150ms] active:[scale:.95]` | +99 B |
| Split utilities: `transition-opacity duration-150 ease-out` | **+316 B** |
| Split utilities for press: `transition-transform duration-150 active:scale-95` | +415 B |
| `starting:` entry with split utilities (modal) | +508 B |

Tailwind v4's split utilities expand into `--tw-*` fallback chains. So:

- Write motion as **one shorthand declaration**, or reuse `aurora-fade-in`.
- Prefer adding a selector to an existing rule over writing a new one.
- Don't add `@starting-style`: an element that comes back from `display:none` restarts its keyframe anyway.

Check every change. Run `pnpm build`, then compare `wc -c < htdocs/luci-static/aurora/main.css` with `git show HEAD:htdocs/luci-static/aurora/main.css | wc -c`. Put the delta in the commit body. If decorative motion comes out positive, remove bytes elsewhere or drop it.

## Jank

- Animate only `opacity`, `translate`, `scale` and `transform`. Never width, height, margins, `box-shadow`, `filter`, `backdrop-filter` or background. The only existing exceptions are the progress-bar width, the mobile-submenu grid rows, and the desktop sidebar column (user's call, 2026-09-16: a content column that snaps and then slides reads as broken; at 4× CPU the 250 ms push cost ~3 ms layout + style per frame on the overview page).
- Never animate an element that carries `backdrop-blur`, because the blur is re-rasterised every frame. Animate an unblurred child instead. Under software compositing, the blurred mega-menu curtain dropped 3–5 frames per open; without the blur it dropped none (2026-09-16).
- Keep `visibility` out of the tween. Write `[transition:opacity_220ms_…,visibility_0s_220ms]` and put `[transition-delay:0s]` on the shown state. A tweened `visibility` runs on the main thread, and on show it also keeps the paired `opacity` fade off the compositor.
- A `color` or `background-color` transition repaints on the main thread every frame. Swap state colours instantly. Dropping the transition on the nav pills cut repaints by 61 %.
- Always name the transitioned properties. Never use `transition-all`, and never use `will-change`.
- Allow one motion per state change per region, lasting no more than 320 ms. Click, save and error feedback get no delay.
- Under reduced motion, show the end state at once, but keep durations at 1 ms rather than `none` (Trap 1).
- Verify on the Layout track at 4× CPU throttling: aurora-performance runtime.md R1–R3.

## JS

JS is worth its bytes where CSS cannot decide. The mega-menu in `menu-aurora.js` is the reference:

- **Hover intent and aim.** Delay the first open. Hold the open category while the pointer heads into its panel. Every timer is cleared on leave.
- **Measure once, then cache.** Measure after `document.fonts.ready`, in `requestIdleCallback`. Write the result to a custom property (`--mega-menu-height`) and let CSS use it. Invalidate on resize only.
- **Distance-adaptive duration.** Write the computed duration to a custom property as well (`--mega-menu-duration`).
- **Sequencing and cleanup.** Toggle classes (`.active` → `.closing` → removed). A `transitionend` wait always has a fallback timer that reads the real duration back.
- **Reduced motion.** Check `prefers-reduced-motion` before any JS-timed motion, and jump straight to the end state.

Not allowed:

- a `requestAnimationFrame` loop that writes styles every frame;
- scroll or pointer listeners whose only job is an effect;
- layout reads (`offsetHeight`, `getBoundingClientRect`) on every event of a hot handler;
- `el.animate()`, except for a one-off sequence CSS cannot express, cancelled on `luci-navigate`.

## Traps (reproduced on a device, 2026-09-16)

luci-base acts on `transitionend`, which only fires if a transition actually runs.

1. **A dismissed notification never leaves the DOM.** The fill of `.fade-in` (`both`) holds `opacity`, so the `.fade-out` transition never starts. Every Dismiss and every expired notification leaves an invisible 84 px gap. Fix: `both` → `backwards` (+5 B). In `_reduced-motion.css`, replace `transition-none!` with `delay-0! duration-1!` (+57 B).
2. **Arrow keys cannot enter a dropdown.** There is no transition on `.cbi-dropdown > ul`, so focus never moves into the list. Fix: `opacity-99 [transition:opacity_120ms_ease-out]`, with `&.dropdown { opacity-100 }` (+98 B).

Any change touching `.fade-in`/`.fade-out`, dropdowns or `_reduced-motion.css` must pass this, run after `pnpm build`:

```
MAIN_CSS=htdocs/luci-static/aurora/main.css node .claude/skills/aurora-motion/scripts/transitionend-probe.mjs
```

The edit itself goes through /luci-change.
