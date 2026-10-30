# Status → Firewall

## notification-dismissal — dismissed alerts release their layout space
- page: admin-status-nftables · Status → Firewall
- package: stock luci-mod-status; notification lifecycle from luci-base `ui.addNotification()`
- dom: `#maincontent > .alert-message.fade-in.warning[style="display:flex"]` before `#view`; Dismiss adds `fade-out` without removing `fade-in`, and the notification's `transitionend` handler removes the node
- symptom: the legacy iptables warning becomes transparent after Dismiss but remains in the DOM, leaving the rules table below an empty gap; other dismissible LuCI notifications share this contract
- cause: the entry opacity animation blocks the exit opacity transition, including early dismissal with backwards fill; global reduced-motion suppression also prevents the removal event
- fix: `_utilities.css` gives `.fade-in/.fade-out` one opacity transition instead of an entry keyframe, with `@starting-style` for optional entry; `fade-out` supplies opacity zero and a 1 ms reduced-motion transition. Unsupported browsers display immediately and still dismiss. Decorative page/menu/tab/footer entry keyframes were separately removed by request; notification component styles remain unchanged. No production JS changes · v1.4.1
- verified: Chrome fixture, 390/1280 px × normal/reduced motion × early/settled dismissal × enhanced/fallback, 16 cases per theme. Old Aurora and shadcn CSS both fail early dismissal with the node still connected; rebuilt CSS removes it on its own opacity transitionend and restores content position within 1 px of baseline, leaving a second notification intact. Fallback is simulated by removing starting-style rules, not by running an old browser. Device verification is pending: configured device connection timed out
- fixture: fixtures/admin-status-nftables--notification-dismissal.html; async checks are awaited, with an adapter regression against `Promise.resolve(false)`
- issue: #103 · mirror: shadcn dcd26e7 (v0.6.1), same fixture passed against its built CSS · status: active
- footprint: including the requested decorative-entry removal, Aurora main.css 185262 → 184884 B (−378 B); shadcn 129996 → 129851 B (−145 B). Login assets and all pre-existing asset budgets are unchanged
- boundary: these utilities handle newly displayed elements; adding `fade-in` to an already-visible element no longer replays a keyframe. No such theme-owned caller was found; external third-party callers were not exhaustively tested
