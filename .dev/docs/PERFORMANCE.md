# Performance — Animation & Runtime

How to verify and quantify the theme's runtime (animation/interaction) performance.

> The essence of an animation optimization is moving work **off the main thread**: from
> per-frame **Layout/Paint** onto the **compositor** (`transform` / `opacity` / `clip-path` /
> `scale`). So the single most important question this guide answers is:
>
> **"Does the main thread still run `Layout` events while the animation plays?"**

## Where this fits

Frontend performance splits into two unrelated buckets — don't conflate them:

| Bucket | Concern | Relevant here? |
|--------|---------|----------------|
| **Load** | First paint, bundle size (LCP, CSS/JS bytes) | Only for `main.css` size |
| **Runtime** | Interaction & animation smoothness (INP, dropped frames) | ✅ This doc |

Two more axes the industry tracks:

- **Lab vs Field** — *lab* is your local, repeatable profiling (DevTools, Lighthouse).
  *Field* is real users (RUM). This doc is lab-only; for field data see
  [Preventing regressions](#preventing-regressions).
- **Reality check** — LuCI's assets ship from the router, but **rendering happens in the
  user's browser**. The bottleneck is the *client* GPU/CPU. Most users open LuCI on a
  **phone**, so always profile under CPU throttle, never on a bare fast desktop.

---

## 0. Setup (one-time)

1. Run the dev server (`cd .dev && pnpm dev`) and open a logged-in page in Chrome/Edge,
   e.g. `http://localhost:5173/cgi-bin/luci/admin/status/overview`.
2. Open DevTools (`F12` / `Cmd+Opt+I`).
3. Have two panels ready:
   - **Rendering**: `Cmd+Shift+P` → type `Show Rendering`.
   - **Performance**: the top tab.
4. Confirm you're serving the optimized CSS: **Network** → reload → click `main.css` →
   **Response** → search `prefers-reduced-motion`. If present, it's the new build.

---

## 1. Core evidence — Performance recording (the Layout track)

This is where the real numbers come from. Generic recipe, used for every animation:

1. Performance panel ⚙️ → **CPU: 4× slowdown** (emulates a low-end phone/tablet admin device).
2. ● Record → trigger the animation once → let it finish → Stop.
3. Read the timeline:
   - **Purple `Layout` / `Recalculate Style` bars** = reflow. Fewer is better.
   - **FPS green bar** collapsing = dropped frames.
   - **Summary → Rendering** time at the bottom.

> **Verdict rule:** watch the `Layout` row. The ideal result is that **after the first frame,
> the entire animation produces no new `Layout` events** — it runs purely on the compositor.

### Component → technique → what to check

| Component | Trigger | Technique | Pass criteria |
|-----------|---------|-----------|---------------|
| **Desktop mega-menu** | Hover a top nav item with a submenu (e.g. *System*) | `clip-path` (not `height`) | No continuous `Layout` bars while expanding (old height-anim reflowed every frame → should be ≈0) |
| **Mobile submenu** | Device mode (`Cmd+Shift+M`) → hamburger → tap a parent item | `grid-template-rows` (not JS `scrollHeight`) | No `Layout` bars, **and no single forced-reflow spike** on expand (old code read `scrollHeight`) |
| **Main view (`#view`) hover** | Desktop width, move cursor in/out of the main card repeatedly | hover shadow repaint removed | No `Paint` flashing during the recording (old hover shadow repainted the whole block) |
| **Tooltip** | Hover then mouse-out of a `[data-tooltip]` element | `scale` + `opacity` transition | `scale` and `opacity` fade *together* on hide — no instant size snap |
| **Theme switch** | Footer theme toggle | View Transitions API (not body `transition-all`) | No body-wide repaint storm on the Main track |

---

## 2. Fastest visual evidence — Paint flashing (no recording)

1. Rendering panel → enable **Paint flashing**.
2. Trigger each animation; repainted regions flash **green**.

| Trigger | Pass criteria |
|---------|---------------|
| Open/close mega-menu | The frosted panel should **not** flash green as a solid block continuously (ideally only a faint flash at the reveal edge) |
| Mobile drawer slide in/out | Drawer body **doesn't** flash green continuously (transform slide is repaint-free) |
| Tooltip appear | Only the small tooltip region flashes once |
| Toggle floating toolbar | Button area doesn't flash green continuously |

> ⚠️ **Honest caveat:** elements with `backdrop-blur` (mega-menu panel, modal scrim) **will**
> show some green flashing while animating — that's the inherent cost of a blur layer, not a
> regression. Judge the **reflow-class** animations (height / shadow) on whether they still
> flash, *not* whether blur reaches zero flash.

---

## 3. Accessibility & fallback — `prefers-reduced-motion`

1. Rendering panel → **Emulate CSS media feature prefers-reduced-motion** → `reduce`.
2. Trigger animations:

| Check | Pass criteria |
|-------|---------------|
| Mega-menu / drawer / tooltip | Snap into place, **no transition** |
| Theme switch | Instant, no crossfade |
| Page navigation | `#view` has no entry animation |
| **Functionality** | All menus/modals **still open and close** — nothing stuck hidden |

Reset to `No emulation` when done.

---

## 4. View Transitions — theme switch

1. **Chrome/Edge** (supports View Transitions): click the footer theme toggle (device / light / dark).
   - Pass: the **whole page** crossfades smoothly (every element transitions together).
2. **No first-paint flash:** reload the page.
   - Pass: **no** theme crossfade on load (the first set is guarded by `prev !== null`).
3. **Graceful degradation:** switch theme in **Firefox** / Safari.
   - Pass: instant switch, **no console errors**.

---

## 5. Behavior regression (animation rework didn't break function)

- [ ] Mega-menu: hover opens, leave closes; sweeping between menus closes the old and opens the new with no residue.
- [ ] Mega-menu height: submenu content **fully visible, not clipped** (`--mega-menu-height` computed correctly).
- [ ] Mobile drawer: closes via `Esc` / scrim tap / close button; **scrim fades out** on close.
- [ ] Mobile submenu: opening B auto-closes A; reopening the drawer shows all submenus collapsed.
- [ ] Modal (e.g. *Save & Apply*): scrim still blurs the background; modal content stays sharp.
- [ ] Tooltip: appears on hover, disappears on leave, ~150 ms, feels responsive.

---

## 6. Before/after A/B comparison (real numbers)

Absolute numbers on a fast machine prove nothing — **the delta vs `master` is the result.**

```bash
cd /path/to/luci-theme-aurora
git stash                 # if you have uncommitted work
git checkout master
cd .dev && pnpm build     # old assets
# Hard-refresh the browser (Cmd+Shift+R), record the mega-menu open (§1),
# note the Layout event count / Rendering time.
cd .. && git checkout perf/compositor-animations
cd .dev && pnpm build
# Record again — Layout count should drop noticeably.
```

> The dev server re-proxies the new build automatically; **hard-refresh** each time to clear cache.

---

## Pass criteria summary

| Signal | Tool | Pass criteria |
|--------|------|---------------|
| Main-thread reflow during animation | Performance → Main track | Near-zero `Layout` / `Recalculate Style` after frame 1 |
| Dropped frames | Performance → Frames / FPS meter | No frame > 16.7 ms; steady ~60 fps under 4× throttle |
| Repaint area | Rendering → Paint flashing | Minimal green on reflow-class animations |
| Compositor offload | Rendering → Layer borders | Animated elements promoted to their own layer |
| Interaction latency (INP) | Lighthouse / Performance | No regression; improved where `scrollHeight` was removed |

---

## Preventing regressions

Verifying once isn't enough — keep it from drifting back:

- **CSS size budget**: gate `main.css` size in CI (e.g. [`size-limit`](https://github.com/ai/size-limit))
  so a PR that bloats the bundle fails.
- **Field data (optional)**: ship the [`web-vitals`](https://github.com/GoogleChrome/web-vitals)
  library to report INP/LCP/CLS from real users, and watch the **P75** (not the average).
- **Rule of thumb for new CSS**: animate only `transform` / `opacity` / `clip-path` / `scale`.
  Never animate `height` / `width` / `top` / `box-shadow` / `background-color` (they reflow or
  repaint). Avoid blanket `transition-all` — list explicit properties.
- **Accepted exception — `.cbi-progressbar`**: the inner bar's `width` is set via inline style
  by LuCI core's `Progressbar` widget, so a `transform: scaleX()` swap would need a JS observer
  to mirror that value into a custom property (plus RTL-aware `transform-origin`). Given the bar
  updates infrequently (firmware/package install progress, not a 60fps animation), the single
  explicit `transition-[width]` is left as-is rather than adding that infrastructure.

---

## The 3 fastest checks (when short on time)

1. **§1** — record a mega-menu open → is the `Layout` row clear?
2. **§2** — Paint flashing → does the mega-menu / mobile drawer still flash as a solid block?
3. **§3** — emulate `reduce` → are animations fully off *and* everything still functional?
