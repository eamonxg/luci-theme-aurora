# The client-side router

How the theme turns a menu click into an in-document view swap instead of a
full page load, where it deliberately does not, and the invariants a router
inside LuCI has to keep. Source: `.dev/src/resource/router-aurora.js`,
loaded from `footer.ut` next to `menu-aurora.js`. **No changes to luci-base
or to any view** — the router is additive theme JS plus two small template
hooks (a patch manifest and a `<footer>` boundary).

## Why it pays, measured

One warm navigation on an `ipq60xx` router over plain HTTP, master 1.2.0:

| stage | ms | note |
|---|--:|---|
| dispatcher renders the page HTML | ~80 | TTFB; menu tree + ACL + template |
| `admin/translations/<lang>` | +70 (parallel) | a second dispatcher run, render-blocking, uncacheable |
| DOMContentLoaded | 167 | |
| view module + 4 ubus calls | 167→220 | static assets are already 0-byte cache hits |

≈ 150 ms of the 220 is the router-side work of rebuilding a document whose
content is rendered client-side anyway. A same-document swap keeps only the
last row (view module from cache + data RPCs + render). Speculation-rules
prefetch cannot reach that number on HTTP at all (secure-context API) and on
HTTPS only hides the first row.

## Why it is possible

For a `view` node the dispatcher renders `view.ut`: the theme header, then
`<div id="view">` with an inline `L.require('ui').then(ui =>
ui.instantiateView('<path>'))`, then the theme footer. The server decides
*which* view; the client renders it. The router repeats what `view.ut` does
without the reload: resolve the path against the menu tree the client
already holds (`ui.menu.load()` serves it from `sessionStorage`), swap the
content region, re-instantiate the view, and let the browser own the URL.

## Kernel: the Navigation API, and only that

`navigation.addEventListener('navigate', …)` + `event.intercept()`. One
event covers link clicks, `location.assign`, back/forward traversals to
same-document entries, and our own `navigation.navigate()`; the browser
writes the URL and history entry, exposes `event.signal` for supersession,
and (with `scroll: 'after-transition'`) restores scroll on traversal /
scrolls to top on push, so the router carries no `pushState`/`popstate`
code, no scroll bookkeeping, and no fragment-vs-navigation heuristics.

**Browsers without the API stay MPA.** Feature-detected at module eval:
`window.navigation?.addEventListener` and `NavigateEvent.prototype.intercept`.
Chrome/Edge 102+, Safari 26.2+, Firefox 147+ get the router; the theme's
declared floor (Chrome 111 / Safari 16.4 / Firefox 128) keeps working as it
does today. This is a deliberate trade: one code path, correct by
construction, over a second history-API path that would double the surface
of everything below.

## Compatibility

### Browsers — per platform feature

| Feature | Used for | Required? | Chrome / Edge | Safari | Firefox | Without it |
|---|---|---|---|---|---|---|
| Navigation API (`navigation.addEventListener('navigate')`, `NavigateEvent.intercept()`, `event.destination/signal`, `navigation.navigate()/back()`) | the whole router | **yes — gate** | 105+ (2022) | 26.2+ (2026-01) | 147+ (2026-01) | `router-aurora.js` is not even loaded (`footer.ut` checks `window.navigation`); the theme is the plain MPA it was before |
| `document.startViewTransition()` (same-document) | crossfade at the swap | no | 111+ | 18+ | 144+ | swap without animation; also off under `prefers-reduced-motion` |
| `fetch(url, { priority: 'low' })` | hover module prewarm | no | 101+ | 17.2+ | 132+ | the option is ignored, the fetch still runs at default priority |
| `MutationObserver`, `DOMParser`, `WeakSet`, `URL`, `Element.replaceWith`, `:scope`, `matchMedia`, optional chaining / `??=` | render completion, template shells, poison gate, staging | yes | ≥ 85 | ≥ 14 | ≥ 79 | all inside the theme's declared floor (Chrome 111 / Safari 16.4 / Firefox 128) |

So the router's effective floor is Chrome/Edge 105, Safari 26.2, Firefox 147;
everything older keeps the theme's existing floor and behaviour. Verified
live in Chrome 151 (headless, `bench-spa.mjs`); Safari/Firefox by feature
detection only — the gate is the same API surface, not a UA sniff.

### OpenWrt / LuCI

The theme already requires OpenWrt 23.05+ (ucode templates). The router
touches only luci-base surfaces that exist unchanged in the `openwrt-23.05`,
`openwrt-24.10`, `openwrt-25.12` and `master` branches of `openwrt/luci`
(checked by source, 2026-08): `L.require` with instance caching and
`prototype.constructor`, `L.view`, `L.dom.content` and the `data-idref`
registry, `L.env.{scriptname, base_url, resource_version, media,
requestpath, dispatchpath, pathinfo, nodespec}`, `L.hasSystemFeature`,
`L.Poll.{queue, tick, timer, start, stop}` and the `poll-start/poll-stop`
events, `ui.menu.load()`'s session-cached tree with `satisfied` /
`firstchild_ineligible` / `wildcard` / `action.type` (`view`, `alias`,
`firstchild`, `template`), `ui.instantiateView`, `ui.hideIndicator`,
`ui.hideModal`, `uci.state.values` / `uci.unload()` / `uci.load()`,
`network.js`'s uci-backed state, `view.ut`'s `#view` + inline
`instantiateView` shell, and `dispatcher.uc`'s `resolve_firstchild` /
`node_weight` / alias re-dispatch semantics (ported verbatim). Live
verification so far: OpenWrt SNAPSHOT (2026-08, ipq60xx) — 23.05/24.10 by
inspection, not yet on device.

## What is intercepted

A `navigate` event is intercepted only when **all** hold:

- `event.canIntercept` (same-origin, not cross-document-only), not
  `hashChange`, no `downloadRequest`, no `formData`, `navigationType !== 'reload'`;
- the destination path (minus `L.env.scriptname`) resolves in the menu tree
  to a **serviceable node** (below);
- the document is not **poisoned** (below);
- the router **activated** in this document: it does so only when the page
  it booted on is itself serviceable. A `call`/`cbi`/`function` page carries
  scripts (legacy `XHR.poll`, inline timers) that only a document death
  retires; the first click away from one is always a full load.

Anything else falls through untouched: the browser performs the ordinary
full navigation, i.e. exactly what the theme did before. Modifier-clicks and
`target=_blank` never reach the event.

### Serviceable nodes

Resolved with a port of the dispatcher's own rules, not a paraphrase:

- `alias` → jump to `action.path` from the root and continue;
- `firstchild` → the same `resolve_firstchild()` / `node_weight()` the
  dispatcher runs: candidates are `satisfied` children with a `title` and an
  object `action`; weight `min(order ?? 9999, 9999)` +10000 for
  `auth.login`; a `firstchild` candidate counts only if it resolves further;
  `firstchild_ineligible` excluded; ties keep key order. The ACL check is
  skipped because `/admin/menu` is already filtered for the session;
- `wildcard` nodes accept trailing segments as request args;
- a hop counter breaks cycles in a foreign `menu.d`.

Two tracks are kept, as a full load keeps them: **requested** segments →
`L.env.requestpath`, `L.env.pathinfo`, `body[data-page]`; **resolved**
segments → `L.env.dispatchpath`, `L.env.nodespec`, the menu highlight, the
title. Pick a different child than the dispatcher would and a click opens
one page while F5 opens another — that is why the resolver is a port.

| node | served |
|---|---|
| `view` | yes — `view.<path>` |
| `alias`, `firstchild` | yes — resolved to a leaf, recursively |
| `template` whose page is a view shell (Status → Overview) | yes — shell fetched once, see below |
| Lua `template`, `call`, `function`, `cbi`, `rewrite` | no → full load |

`rewrite` is deliberately not resolved: it is not in the tree and a splice
mistake opens the wrong page, which is worse than the reload it falls back to.

### Template nodes: the server's own shell, never a hand port

`admin/status/overview` is a `template` whose server side defines page
globals (`progressbar`, `renderBox`, `renderBadge`), emits an `<h2>` and a
`div.includes` (server-rendered Lua includes), and then instantiates
`view.status.index`. A first version re-implemented those helpers in the
router and drifted on the first real page (the network badges lost their
labels: upstream's `renderBadge` takes extra `L.itemlist` arguments the port
did not know about). So the router does not port anything: when a link to a
template node is hovered or focused, its page is **fetched once per
document**, parsed with `DOMParser`, and the content region between `#tabmenu` and
`<footer>` is kept as the page's *shell* — every node cloned, `#view`
replaced by an empty div, the inline `instantiateView('…')` script read for
the class name, the remaining inline scripts (the helpers) replayed into
global scope on staging. luci-base's own bootstrap (`luci.js` and
`L = new LuCI(env)`) also lives in that region and is filtered out. If the
document *is* that template (the session started on Overview), the shell is
taken from the live region and no fetch happens. A template node is only
intercepted once its shell is known — so a Lua template page (no
`instantiateView` call) is remembered as unservable after one hover fetch
and never enters the router's error path, and a template clicked without a
prior hover is a plain full load that seeds the shell for the rest of the
document. Its status include modules are singletons carrying
`oneshot`/`hide` state that a full load would reset — verified against a
real full load, not against expectation.

## The navigation procedure

`intercept({ handler, focusReset: 'manual', scroll: 'after-transition' })`,
handler in order:

1. **Generation.** `gen = ++navGen`; every later DOM write is gated on it.
   `event.signal` aborts our own awaits, but it cannot cancel a LuCI XHR
   (`L.Request` never exposes its handle) or a `View.__init__` chain already
   running, so the generation is the correctness mechanism and the signal is
   hygiene.
2. **Teardown of the departing document state**, i.e. what a document
   death would have done for free:
   - `Poll`: `queue.length = 0; stop(); start()` — three steps. The flush
     drops the old view's pollers; `stop()` drops the tick; `start()` on an
     empty queue re-arms `tick = 0` so the incoming view's `poll.add()`
     auto-starts and fires immediately instead of waiting up to `interval`
     seconds for the surviving tick to align. Upstream's `initDOM()` does
     the same `Poll.start()` on an empty queue before the first view.
   - `uci`: `unload()` every loaded package (documents start with an empty
     cache; four shipped apps read `load()`'s return as an existence check
     and draw an error over the page when the cache answers `[]`). Then, if
     `L.network` has been loaded, `load(['network','wireless','luci'])` is
     re-issued and **awaited**: `network.js` fills its `_state` once and
     from then on answers out of the uci cache (`getWifiDevices()` *is*
     `uci.sections('wireless','wifi-device')`), so dropping those without
     refilling hands every consumer an empty config for the rest of the
     document. Unsaved local edits die with the page as they would on a
     full load; saved changes live on the server and the Unsaved-changes
     indicator is unaffected.
   - bare `setInterval`s registered since the router booted are cleared
     (`setInterval` is hooked at module eval; the one interval `L.Poll`
     owns is preserved). `setTimeout` and rAF are **not** touched: the
     core keeps tooltips, notification timeouts and a request timeout on
     `setTimeout`, and there is no self-rescheduling timeout in any
     shipped view.
   - `ui.hideModal()`, the theme's own surfaces (mega
     menu, mobile drawer, palette) close.
   - page-scoped patch CSS is disabled and its JS patch unmounted (below).
3. **Environment.** `L.env.requestpath/dispatchpath/pathinfo/nodespec`,
   `body[data-page]`, `document.title`. An alias is re-dispatched
   server-side, so `requestpath` and `data-page` carry the alias target while
   `pathinfo` keeps the URL as requested; a `firstchild` keeps the requested
   path in both. The title suffix (` - hostname`) is read off the initial
   document, so it matches whatever the template emitted. `nodespec` drives `L.hasViewPermission()` and therefore the
   Save/Apply footer's readonly state; `data-page` keys `ui.tabs` session
   state and the theme's page-scoped CSS.
4. **Chrome.** `menu-aurora.js` exposes `syncRoute()`: it re-marks
   `is-active-page`/`aria-current` from `L.env.dispatchpath` across every
   nav surface, expands the active sidebar/mobile group and collapses the
   rest, rebuilds the header crumb and re-renders `#tabmenu` for the new
   section. Menus are **not** rebuilt — the mega menu measures and binds on
   construction and the palette index is a flat array of the same model —
   only their state changes.
5. **Staging.** A fresh `<div id="view" class="view-staging">` is inserted
   right after `#tabmenu`, i.e. **first in tree order** —
   `getElementById('view')` returns the first match, so everything LuCI's
   view chain writes goes into the staged element while the outgoing page
   stays on screen (dimmed, `.view-leaving`). The stage is invisible but
   **laid out** (`visibility:hidden; height:0; overflow:hidden`, never
   `display:none`): the realtime graphs size themselves from
   `#view.offsetWidth` inside `render()`, and a `display:none` stage handed
   them a 0-wide canvas. Nothing is removed yet.
6. **Patches.** `header.ut` emits the installed on-demand patch stems as
   `body[data-patches]`; the router applies the same segment-prefix rule the
   template applies at render time: matching `patches/<stem>.css` links are
   ensured (`<link data-aurora-patch>`, enabled for the page on screen,
   `disabled` — not removed — for the rest, so a return costs nothing);
   matching `patches/<stem>.js` files are loaded once and their
   `window.aurora.patches[stem]` `{ mount, unmount }` pair is driven per
   visit — a JS patch that registers nothing is simply executed once,
   MPA-style.
7. **View.**
   - **cold** (`view.<path>` never required in this document):
     `window.L.require(className)` — the require *is* the render (LuCI
     instantiates on first require) and it must go through `window.L`, the
     runtime instance, never the prototypal `L` a module factory receives
     (`ui` hangs `itemlist`/`showModal` on `window.L`; a view required
     through the wrong `L` dies three modules down on `L.itemlist is not a
     function`, and because `require()` caches by name the binding is fixed
     by the *first* requirer);
   - **warm**: `require()` hands back the cached instance whose `__init__`
     already ran; LuCI's class system sets `prototype.constructor`, so
     `new instance.constructor()` runs a fresh `__init__` → `load()` →
     `render()` → `dom.content('#view')`, exactly what a full load starts
     from.
   - **completion** is observed, not assumed: a `MutationObserver` on the
     staged element resolves when a non-spinner child lands (or the spinner
     is removed for an empty render), bounded by a timeout. On completion —
     and only if this navigation is still the latest — the outgoing region
     (everything between `#tabmenu` and `<footer>` except the staged
     element) is removed and the staged view is unhidden inside
     `document.startViewTransition()` when available and reduced motion is
     off; the navigation's `finished` promise resolves after that swap.
   - **Renders are serialized.** Neither an in-flight LuCI XHR nor a running
     `View.__init__` chain can be cancelled (`L.Request` never exposes its
     handle), and every chain paints into *whichever* `#view` is first at
     paint time. So a navigation first awaits the previous one's completion
     (bounded by the same timeout) before it tears anything down or stages
     anything — the previous chain finishes into its own staged element,
     which is then discarded. Rapid A→B→C therefore never interleaves:
     B is skipped when C arrives before B ran (`event.signal` /
     generation), and C waits for whichever render is actually in flight.
     The document's initial LuCI-rendered view is tracked the same way, so a
     click during the first load cannot be painted over by it. The cost is
     that a click during a slow load waits for that load; the alternative —
     wrapping `prototype.render` per class and repairing stale cold renders
     by re-navigating — leaves a real window open and needs three mechanisms
     where one suffices.
8. **Focus.** `#maincontent` (`tabindex=-1`) with `preventScroll`.
9. Any exception → `console.error` (a silent fallback makes every router
   regression look like "the page is just slow") → `location.href =
   destination` — a hard full load, never a stuck page.

## The poison gate

A `<style>`/`<link rel=stylesheet>` a view writes into `<head>` dies with
the document on a full load and **survives** a same-document swap, painting
every page after it (a shipped file manager hides Save/Reset on every config
page with one unlayered `!important` rule). Removing it is not an option: a
library that imports CSS at module eval never runs again, so deletion is
one-way (an editor page came back as a black rectangle two million pixels
tall). Hence a gate, not a sweep: the head's stylesheet set is snapshotted at
boot; before intercepting, any sheet not in that snapshot and not marked
`data-aurora-patch` marks the document **poisoned** and the navigation is a
full load — the fresh document carries no view CSS, so the router resumes
immediately. Correctness over speed, never the other way. (Finer selector
analysis to let harmless sheets through is a possible refinement; it is not
needed for correctness.)

## Module prewarm on hover

Entering (`pointerover`/`focusin`/`pointerdown`) a link to a serviceable
node `fetch()`es its view module with `priority: 'low'` — not `require()`,
which would render it. The URL is built byte-for-byte as `LuCI.require()`
builds it (`<base_url>/<name with . → />.js?v=<resource_version>`) or it
misses the HTTP cache. The walk is transitive: the fetched body is scanned
for its leading `'require x'` string literals with a regex that is **not**
line-anchored (shipped files are minified onto one line), and dotted names
are warmed the same way; dotless names are either luci-base's file-less
built-ins (`view`, `baseclass`, `dom`, `poll`, `request`, `session`) or flat
libraries the chrome has already loaded, so they are declined outright.
Deduplicated per class name; stops once a navigation to that link has
committed. Cold navigations are the only place this shows; warm ones are
already 0-byte cache hits.

## What is deliberately not done

- **No history-API path.** See "Kernel".
- **No document prefetch while the router is active.** The
  `speculationrules` script is removed at boot when the router takes over —
  a hover prefetch of a document the router will never load is pure router
  CPU. Browsers without the Navigation API keep the rules and the MPA path.
- **No `unload`/`beforeunload`**, ever (bfcache).
- **No cancellation of in-flight XHR** — `L.Request` gives no handle; the
  generation gate makes it a waste, not a bug. Upstream-only.
- **No sweeping of a view's global listeners or timeouts** — one-way
  deletions of module-eval registrations. If a per-render offender ever
  appears, the answer is a targeted teardown, not a global hook.
- **`ui.changes.confirm/revert` and `awaitReconnect`** keep their hard
  `window.location` writes — a rollback/reboot boundary *should* be a fresh
  document.

## Verification matrix

- Unit (`.dev/tests/router.test.js`): resolver against a fixture tree
  (alias chain, nested firstchild, weights, ineligible, unsatisfied,
  wildcard args, cycle); URL → segments; patch prefix matching; pragma scan
  on a minified head.
- Device (`.claude/skills/aurora-performance/scripts/bench-spa.mjs`, CDP):
  1. full walk of every clickable node in each nav mode, each compared
     against a real full load of the same URL — `data-page`,
     `dispatchpath`, URL, title, tab count, footer presence, console clean;
  2. click → view painted, median of N, SPA vs MPA, warm and cold;
  3. soak: 60 navigations over 12 pages, heap / DOM nodes / listeners /
     poll queue length flat after the first pass;
  4. back/forward chain through alias and firstchild URLs — no reload;
  5. poison gate: visit a CSS-injecting page, next navigation is a full
     load, the one after is SPA again.
- The perf skill's N1 is rewritten to describe this router and its
  boundaries; N2 keeps document prefetch for the non-router path.
