# Unified Sidebar Navigation States

Date: 2026-06-15
Status: approved

## Goal

Make the desktop sidebar and mobile navigation drawer communicate the current
LuCI page with the same hierarchy, active-state language, and accordion
behavior.

The two surfaces keep their device-appropriate layout and sizing. They do not
share one responsive DOM tree; instead, both render from one normalized menu
description and use the same state vocabulary.

This design supersedes conflicting active-state and accordion decisions in:

- `2026-06-11-edge-attached-sidebar-design.md`
- `2026-06-13-mobile-navigation-accordion-redesign-design.md`
- `2026-06-13-mobile-submenu-active-indicator-design.md`

Their unrelated layout, overlay, footer, and whole-sidebar-collapse decisions
remain unchanged.

## Scope

Apply the unified model only when Aurora renders:

- the desktop sidebar at the existing desktop breakpoint; and
- the mobile full-screen navigation drawer below that breakpoint.

Keep the mega-menu, boxed dropdown, LuCI menu tree, route URLs, breadcrumb,
logout placement, theme switcher, and whole desktop sidebar collapse behavior
unchanged.

## Decisions

| Topic | Decision |
| --- | --- |
| Rendering | Separate desktop and mobile DOM containers generated from one normalized menu description |
| State vocabulary | Shared active-group, expanded-group, and active-page states |
| Initial state | Automatically expand the group containing the current page |
| Manual collapse | The active group may be collapsed |
| Accordion | At most one group is expanded on each navigation surface |
| Active top-level group | Brand-colored text without a filled background |
| Active second-level page | Brand-colored semibold text with a short left accent line |
| Device differences | Preserve mobile typography and touch spacing; preserve desktop density |
| Persistence | Do not persist nested accordion state |

## Shared Menu Model

Create one normalized representation from the active LuCI menu tree before
rendering either navigation surface. Each top-level item exposes:

- its name, translated title, and destination when it is a direct link;
- its normalized child pages;
- whether it contains the current route;
- which child page is active; and
- whether it is the logout action.

Both renderers consume this representation instead of independently deriving
active state from `L.env.dispatchpath`.

The desktop and mobile renderers remain responsible for their own container
markup and device-specific classes. This avoids moving one live DOM tree
between breakpoints, which would complicate focus management, hidden controls,
and overlay lifecycle.

## Shared State Vocabulary

Use the same semantic states on both surfaces:

- `is-active-group`: the top-level group containing the current route;
- `is-expanded`: the group whose child region is currently visible; and
- `is-active-page`: the exact active second-level destination.

Class names may be attached to each surface's existing structural classes, but
their meaning must not differ between desktop and mobile.

Expanded state and active-route state are independent. If the user collapses
the active group, it keeps `is-active-group` and its brand-colored label while
losing `is-expanded`. The chevron reflects expansion only: right when closed,
down when open.

## Accordion Behavior

Each navigation surface uses the same transition function to update a group:

1. Find the currently expanded group in that surface.
2. Collapse it when a different group is opening.
3. Toggle the requested group.
4. Synchronize classes, `aria-expanded`, `aria-hidden`, and `inert`.

Only one group may be expanded at a time. Clicking the expanded group collapses
it, including when it is the active group.

On initial render, expand the group containing the current page. If the route
does not match a group, render all groups collapsed.

The desktop sidebar keeps its temporary accordion state while the page remains
loaded. The mobile drawer resets temporary accordion state when it closes.
Opening the drawer again expands the active group, matching the current route.

Crossing the desktop breakpoint closes the mobile drawer, restores body
scrolling, and resets its temporary accordion state. It does not change the
persisted whole-sidebar collapsed preference.

## Visual Language

### Top-Level Groups

The active group uses brand-colored text on both devices. It has no active
pill, filled row background, border, or accent bar.

An expanded inactive group uses the normal foreground color. A collapsed
inactive group uses the existing muted label color. Hover and focus treatments
remain device-appropriate but do not override the active brand color.

### Second-Level Pages

The active page uses:

- brand-colored semibold text;
- a short, rounded brand-colored line on the left; and
- no filled background.

The child list keeps a subtle one-pixel hierarchy line. The active-page accent
is thicker and overlays the relevant segment of that line, producing one
continuous hierarchy marker rather than a second unrelated indicator.

Desktop and mobile use the same color, weight, line geometry, and active-state
meaning. Mobile retains its larger top-level type and minimum 40px child touch
targets; desktop retains its compact spacing and sidebar typography.

## Motion

Use the same 250ms duration for child-list expansion, opacity, hierarchy-line
reveal, and chevron rotation.

The existing mobile overlay entrance and desktop whole-sidebar collapse remain
separate interactions. Under `prefers-reduced-motion: reduce`, accordion and
chevron state changes occur without animation.

## Accessibility

- Expandable groups remain native `<button type="button">` controls.
- Every group button has a stable `aria-controls` target and an accurate
  `aria-expanded` value.
- Every controlled child region has an accurate `aria-hidden` value.
- Collapsed child regions are `inert` so hidden links cannot receive focus.
- The active group button exposes `aria-current="location"`, including while
  its child region is collapsed.
- Active destination links expose `aria-current="page"`.
- Active colors and accent lines are supplementary to these semantic current
  markers.
- Existing visible focus indicators remain intact in light and dark themes.

## Failure Handling

An empty menu tree renders empty navigation lists without breaking the header,
overlay, footer, or whole-sidebar toggle.

If the current route cannot be matched, no item receives an active state and
all groups begin collapsed. A malformed item without children is treated as a
direct destination when it has a URL; otherwise it is skipped.

Missing optional desktop or mobile containers must not prevent the other
surface from rendering.

## Implementation Boundaries

Expected source changes:

- `.dev/src/resource/menu-aurora.js`
  - normalize the menu tree once;
  - render desktop and mobile from the shared description;
  - replace separate expansion helpers with one surface-scoped state updater;
  - apply shared state classes and accessibility attributes.
- `.dev/src/media/components/_nav.css`
  - define mode-independent active-group and active-page treatments.
- `.dev/src/media/_layout.css`
  - retain desktop sizing and spacing overrides only.
- `.dev/src/media/components/_overlay.css`
  - retain mobile typography, touch spacing, overlay layout, and hierarchy
    geometry overrides only.
- Generated CSS and JavaScript under `htdocs/luci-static/`.

Do not add a framework, dependency, new theme token, hardcoded color, persisted
nested-menu setting, or shared responsive DOM tree.

## Validation

- Verify desktop and mobile use the same active-group, expanded, and
  active-page semantics.
- Verify the current group initially expands on both surfaces.
- Verify the current group can be manually collapsed while retaining its
  active label.
- Verify opening another group closes the previous group.
- Verify mobile close and reopen restores the route-derived active group.
- Verify crossing the breakpoint closes the mobile drawer and restores body
  scrolling.
- Verify `aria-expanded`, `aria-hidden`, `inert`, and `aria-current` match the
  visible state.
- Verify direct top-level links, logout, keyboard activation, and whole
  desktop sidebar collapse still work.
- Verify active indicators remain clear in light and dark themes.
- Verify reduced-motion mode removes accordion movement.
- Visually inspect representative nested routes at desktop width and at 320px,
  390px, and 767px mobile widths.
- Run Prettier on touched source files.
- Run `pnpm test` and `pnpm build` from `.dev`.
- Run JavaScript syntax checks and `git diff --check`.
