# The Frame

The router ships the assets, but the browser does the animating — usually a
phone GPU/CPU, not a bare fast desktop. The essence of a runtime
optimization is moving work **off the main thread**: from per-frame
**Layout/Paint** onto the **compositor**. So the single most important
question every recipe below answers is: *does the main thread still run
`Layout` events while the animation plays?* These rules are usually already
followed by convention in a codebase that's been through this once — the
gap agents actually hit is skipping the named verification step, not the
authoring rule itself.

## R1 — Animate compositor properties only

**Why.** `transform`, `opacity`, `clip-path`, and `scale` can run entirely on
the compositor thread. `height`, `width`, `top`, `box-shadow`, and
`background-color` force `Layout` or `Paint` on the main thread, every
frame, on the same slow client CPU the page is already competing for.

**Do / Don't.** Animate only `transform` / `opacity` / `clip-path` / `scale`.
Never animate `height` / `width` / `top` / `box-shadow` / `background-color`.
Avoid blanket `transition-all` — list explicit properties so a future change
can't silently start transitioning a reflow-triggering property.

**Verify.** Two recordings, used together:

- *Performance panel — the Layout track (core evidence).* CPU throttle 4×
  (Performance panel ⚙️) → ● Record → trigger the animation once → let it
  finish → Stop. Read the timeline: purple `Layout`/`Recalculate Style` bars
  mean reflow; the FPS bar collapsing means dropped frames. Pass: after the
  first frame, the animation produces **no new `Layout` events** — it runs
  purely on the compositor.
- *Rendering panel — paint flashing (fastest visual check, no recording).*
  Rendering panel → enable **Paint flashing** → trigger the animation.
  Repainted regions flash green. Pass: no continuous green flashing over a
  reflow-class element; a single flash at a reveal edge is fine.

Honest caveat: any element using `backdrop-blur` (a frosted panel, a modal
scrim) **will** show some green flashing while animating — that is the
inherent cost of a blur layer, not a regression. Judge reflow-class
animations (height/shadow-style changes) on whether *they* still flash, not
on whether a blur layer reaches zero flash.

Worked example — one theme's component map (aurora); build the equivalent
for your theme:

| Component | Trigger | Technique | Pass criteria |
|-----------|---------|-----------|---------------|
| Desktop mega-menu | Hover a top nav item with a submenu (e.g. *System*) | `clip-path` (not `height`) | No continuous `Layout` bars while expanding (old height-anim reflowed every frame → should be ≈0) |
| Mobile submenu | Device mode (`Cmd+Shift+M`) → hamburger → tap a parent item | `grid-template-rows` (not JS `scrollHeight`) | No `Layout` bars, **and no single forced-reflow spike** on expand (old code read `scrollHeight`) |
| Main view (`#view`) hover | Desktop width, move cursor in/out of the main card repeatedly | hover shadow repaint removed | No `Paint` flashing during the recording (old hover shadow repainted the whole block) |
| Tooltip | Hover then mouse-out of a `[data-tooltip]` element | `scale` + `opacity` transition | `scale` and `opacity` fade *together* on hide — no instant size snap |
| Theme switch | Footer theme toggle | View Transitions API (not body `transition-all`) | No body-wide repaint storm on the Main track (see R3 for the reduced-motion/no-API fallback check on this same interaction) |

**Quantify.** `Layout` event count after frame 1 (target: 0); dropped-frame
count under 4× CPU throttle.

## R2 — JS must not force synchronous layout

**Why.** Reading a layout-dependent property (`offsetHeight`, `scrollHeight`,
`getBoundingClientRect`, …) right after writing to the DOM forces the browser
to flush layout synchronously, mid-script, on the main thread — on a slow
client this is a visible stall, not just a profiler footnote.

**Do / Don't.** Cache layout reads instead of re-reading them per event.
Defer measurement to idle time (`requestIdleCallback`, and only after
`document.fonts.ready` so measurements aren't taken against unloaded font
metrics) rather than measuring synchronously inside a hot interaction path
(example: aurora's mega-menu pre-measures submenu height once, off the
interaction path, instead of reading `scrollHeight` on every hover).

**Verify.** Performance panel → trigger the interaction → check for
"Forced reflow" / "Forced synchronous layout" warnings in the recorded
trace or the Console.

**Quantify.** Forced-reflow warning count (target: 0) per interaction.

## R3 — Accessibility is functionality

**Why.** `prefers-reduced-motion` and graceful degradation aren't polish —
an animation that ignores the reduced-motion signal, or leaves an element
stuck mid-transition when a feature isn't supported, is a functional bug for
the user who triggered it.

**Do / Don't.** Every animation needs a `prefers-reduced-motion: reduce`
branch that removes the transition, not just shortens it. Anything using
the View Transitions API needs a plain fallback for browsers that lack it.

**Verify.** Two checks, used together:

- *Reduced motion.* Rendering panel → **Emulate CSS media feature
  prefers-reduced-motion** → `reduce` → trigger every animation: menus,
  drawers, tooltips, theme switch, page navigation. Pass: each snaps into
  place with no transition, **and** functionality is unaffected — nothing
  stays stuck hidden or half-open. Reset to "No emulation" when done.
- *View Transitions degradation.* In a browser that supports the API (e.g.
  Chrome/Edge), trigger the transition (example: aurora's footer theme
  toggle) and confirm the whole page crossfades together, with no crossfade
  flash on first load. In a browser without support (e.g. Firefox/Safari),
  confirm the switch is instant with no console errors.

**Quantify.** Reduced-motion and degradation checks are pass/fail, not
numeric — track them as a checklist item per animation, not a metric.

## Behavior-regression checklist

Run this after any runtime rework — a compositor-safe rewrite that breaks
interaction is not a win:

- [ ] Menus: opening one closes any other open menu/submenu with no residue.
- [ ] Esc / scrim-click / outside-click closes the open menu, drawer, or modal.
- [ ] Submenu accordion: opening one submenu auto-closes sibling submenus;
      reopening the parent container starts fully collapsed.
- [ ] Modal/drawer: scrim blur/dim is present and the content on top stays
      sharp and interactive.
- [ ] Tooltip: appears on hover, disappears on leave, without a jarring
      instant size or opacity snap.
