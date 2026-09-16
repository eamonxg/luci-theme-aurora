# Evidence for the state table

luci-base line numbers are from openwrt/luci master (d19bf1358f, 2026-09-14),
through `$LUCI_SRC` (see luci-knowledge). Router line numbers are from
`@eamonxg/luci-theme-devkit` 0.3.1, `runtime/router.js`. Re-check them after
a version bump.

## Hooks luci-base emits

| State | Source | What happens |
|---|---|---|
| Modal open / close | `ui.js:4224`, `ui.js:4242` | `showModal` adds `body.modal-overlay-active`. `hideModal` only removes that class, so there is no exit hook. `#modal_overlay` is `hidden` until the class is present (`_modal.css`). |
| Notification | `ui.js:4359–4390`, `ui.js:4440` | `addNotification` creates `.alert-message.fade-in`. Dismiss adds `.fade-out`, and the node is removed on its `transitionend` (`ui.js:4364`). The time-limited variant adds `.fade-out` on a timer. |
| Dropdown | `ui.js:1300–1306`, `1390–1395`, `1416–1423` | Opening sets `[open]`, and the focus layer gets `.cbi-dropdown-open`. Focus moves into the list only on `transitionend` of the `ul`. |
| Dropdown keys | `ui.js:1881–1930` | ArrowUp/ArrowDown act only when a `li` or the `ul` already has focus. |
| Tabs | `ui.js:4728`, `4882–4887` | Panes get `data-tab-active="true"/"false"`, and the pane fires the `cbi-tab-active` event. In this theme, inactive panes are `invisible h-0` (`_segmented.css`), not `display:none`. |
| Busy button | `ui.js:5683` | Adds `.spinning` while a handler's promise is pending. |
| Drag | `ui.js:2442–2449` | Adds `.dragging` on `dragstart` and removes it on `dragend` (`.cbi-dynlist`). |
| Invalid input | `ui.js:2011` and the validators | `.cbi-input-invalid`. |
| Header indicator | `ui.js:4492` | `#indicators span[data-indicator][data-style=active\|inactive]`. |
| First render | `luci.js:2771` | `luci-loaded` fires after `initDOM()` and `Poll.start()`. |
| Poll | `luci.js:1093`, `luci.js:1165` | Ticks once a second and runs each callback every `pollinterval` seconds: 5 by default (`/etc/config/luci`; luci-base `header.ut:20`). Clicking the `poll-status` indicator pauses it (`luci.js:2742–2750`). |

For reference, bootstrap animates `max-height` over 125 ms on the dropdown
`ul` (`themes/luci-theme-bootstrap/.../cascade.css:1738`). That transition
is what makes the focus hand-off work there.

## Hooks the router emits

| Hook | Source | What happens |
|---|---|---|
| `.view-staging`, `#view.view-leaving` | `router.js:832–848` (`stage()`) | The incoming view renders off-screen, and the outgoing one is marked. |
| `document.startViewTransition(swap)` | `router.js:872` (`commit()`) | Skipped when the API is missing or reduced motion is set. |
| `luci-navigate` / `luci-navigated` | `router.js:733` / `router.js:756` | Document events; `detail` is the route. Neither fires on MPA browsers, so any motion must also work after a full page load. |
| Departed view | `router.js:852–861` | The old view is cleared through `dom.content()` and removed synchronously, so it has no exit animation. |

## Traps: how they were reproduced

`scripts/transitionend-probe.mjs` logs in, renders a stock `ui.Dropdown` and
calls `ui.addNotification` on a real page. It runs with and without
`prefers-reduced-motion` and can serve any build as main.css (`MAIN_CSS`).

| main.css | Dropdown after ArrowDown ×2 | Notification after Dismiss |
|---|---|---|
| HEAD (2026-09-16) | focus stays on the dropdown | still in the DOM, 84 px tall |
| HEAD + reduced motion | same | same |
| + `.fade-in` fill `backwards` + dropdown `ul` opacity transition | focus moves `li a` → `li b` | removed |
| + the above + reduced motion at `duration 1ms` instead of `transition: none` | `li a` → `li b` | removed |

The cause of Trap 1: Chrome does not start a transition on a property that
a filling CSS animation still holds (`.fade-in` uses `… both`). Removing
`.fade-in` before dismissing also made the removal work.

Upstream direction (decision doc only, through /upstream-rfc): luci-base
should not depend on `transitionend` alone, and should fall back when the
computed transition duration is `0s`.
