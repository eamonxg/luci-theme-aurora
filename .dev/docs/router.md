# The client-side router

How the theme turns a menu click into an in-document view swap instead of a
full page load, where it deliberately does not, and the invariants a router
inside LuCI has to keep. Source: `.dev/src/resource/router-aurora.js`,
loaded from `footer.ut` next to `menu-aurora.js`. **No changes to luci-base
or to any view** — the router is additive theme JS plus three small template
hooks (a patch manifest, a `<footer>` boundary, and `data-aurora-*` markers
on the stylesheets header.ut itself renders).

## Prior art

Other LuCI themes solve the same problem, and reading one of them (credited
in the README) informed two pieces here: pausing `L.Poll` on a hidden tab,
and folding a view's read-only state along its dispatch path (both below).
The rest is independent, and one choice diverges deliberately. The common
approach drives navigation through the **History API**
(`pushState`/`popstate`) with its own scroll bookkeeping and a
`prototype.render` guard to repair stale renders; this router is built on
the **Navigation API** instead (see "Kernel"), which hands scroll, history
and supersession to the browser and needs none of that — at the cost of
running only on newer browsers, where the theme falls back to the plain MPA
it already is. On top of that shared base this router also adds a
session-expiry gate, reproduces `template` pages from the server's own shell
rather than hand-porting them, and cross-fades the swap with a view
transition — each its own section below.

## Why it pays, measured

One full-load navigation on an `ipq60xx` router (RE-SS-01) over plain
HTTP, median of 10 over the 8 sample pages below, this branch (2026-08-16):

| stage | ms | note |
|---|--:|---|
| dispatcher renders the page HTML | 106 | TTFB; menu tree + ACL + template |
| `admin/translations/<lang>` | 106→205 | a second dispatcher run, render-blocking, uncacheable |
| DOMContentLoaded | 211 | right behind the translations |
| view module + ubus calls + render | 211→313 | static assets are already 0-byte cache hits |

≈ 210 ms of the 313 is the router-side work of rebuilding a document whose
content is rendered client-side anyway. A same-document swap keeps only the
last row (view module from cache + data RPCs + render): the same 8 pages
land at a median of 99 ms warm. Speculation-rules prefetch cannot reach
that number on HTTP at all (secure-context API) and on HTTPS only hides the
first row.

End to end, click → view painted, median of 10 on the same device
(`bench-router.mjs timing`, RUNS=10, 2026-08-16):

| page | full load | router (warm) | faster |
|---|--:|--:|--:|
| status/routesj | 286 | 112 | 61 % |
| status/nftables | 277 | 85 | 69 % |
| status/logs | 309 | 124 | 60 % |
| status/processes | 455 | 251 | 45 % |
| status/channel_analysis | 412 | 63 | 85 % |
| status/realtime | 241 | 49 | 80 % |
| system/system | 544 | 194 | 64 % |
| system/admin | 268 | 63 | 76 % |

Median **67 % faster** (45–85 % across the sample). Absolute numbers move
with CPU, network and page; the ratio is the point — the same-document swap
skips the router-side rebuild above and keeps only the view render.

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

Why this API rather than the History API the other themes use:

- **The browser owns URL, history and scroll.** `pushState` puts the
  router in charge of all three and of keeping them consistent with what
  it rendered; here it only ever renders.
- **Supersession is built in.** A newer navigation aborts the older one's
  `event.signal`; the generation gate below is a check, not a state
  machine, and no `render` guard is needed to repair a stale paint.
- **Every navigation kind arrives at one listener** — link click,
  `location.assign`, back/forward to a same-document entry, our own
  `navigation.navigate()` — so there is exactly one path to keep correct.
- **The fallback is free.** Where the API is missing, the theme is the
  MPA it already was; nothing has to be polyfilled or feature-forked.

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
live in Chrome 151 (headless, `bench-router.mjs`); Safari/Firefox by feature
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
`network.js`'s uci-backed state, `Request.addInterceptor` /
`rpc.addInterceptor` and the `-32002` → `session.access` probe in
`setupDOM`, `dispatcher.uc`'s `ctx_append` acl folding and `node.css`
(schema since 7c6d8ff, 2026-08 — older trees simply carry no `css`),
`view.ut`'s `#view` + inline `instantiateView` shell, and `dispatcher.uc`'s `resolve_firstchild` /
`node_weight` / alias re-dispatch semantics (ported verbatim). Live
verification so far: OpenWrt SNAPSHOT (2026-08, ipq60xx) — 23.05/24.10 by
inspection, not yet on device.

That list is also executable: `contract()` in `router-aurora.js` looks every
one of those surfaces up at boot (`L.view`, `L.require`, `L.dom.content`,
`L.env.{base_url,resource,media}`, `L.Request.addInterceptor`,
`L.uci.{load,unload,state}`, `rpc.addInterceptor`,
`poll.{queue,start,stop,active}`, `ui.menu.load`, `ui.hideModal`,
`ui.hideIndicator`, `E`) and, if any is missing, logs which and does not
activate — the theme is the MPA it was, not a broken router, on a luci-base
that moved.

## What is intercepted

A `navigate` event is intercepted only when **all** hold:

- `event.canIntercept` (same-origin, not cross-document-only), not
  `hashChange`, no `downloadRequest`, no `formData`, `navigationType !== 'reload'`;
- the destination path (minus `L.env.scriptname`) resolves in the menu tree
  to a **serviceable node** (below);
- the document is not **poisoned** (below) and its session is not known to
  be **expired** (below);
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
- `wildcard` nodes accept trailing segments as request args, and — as the
  dispatcher does — run the node's `wildcardaction` (the `path/*` entry's
  own action) when args are present and `action` for the bare path;
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
document** (the in-flight request is shared by every intent event that
arrives before it resolves), parsed with `DOMParser`, and the content region between `#tabmenu` and
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
   - `uci`: `unload()` every package present in `state.values` **or**
     `uci.loaded` (documents start with an empty cache; four shipped apps
     read `load()`'s return as an existence check and draw an error over
     the page when the cache answers `[]`; and `uci.loaded` keeps a
     package's request promise — a rejected one included — until
     `unload()`, so a failed load left there would be handed to every later
     view). Then, if `L.network` has been loaded,
     `load(['network','wireless','luci'])` is re-issued and **awaited** —
     and a rejection propagates to the hard-load fallback rather than
     leaving `network.js` on an empty config: `network.js` fills its `_state` once and
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
   - `window`/`document` listeners a view registered **while it rendered**
     are removed. Several shipped views add them per render (statistics
     graphs: an anonymous `resize` that later throws against detached DOM;
     nlbwmon: `tooltip-open`/`touchstart`; the core's own dropdown widgets:
     one `window` click/touchstart per instance), so they accumulate and
     act on pages that are gone. The hook records registrations inside the
     render window only. A **warm** render evaluates no module, so its
     registrations are per-render by construction and go on the next
     teardown. A **cold** render also runs the module's top level, whose
     registrations must survive (removing them is one-way — an editor's
     module-eval listeners never come back), so cold registrations are only
     credited to the class and released when a later warm render of the
     same class registers the same target/type, which proves them
     per-render.
   - `ui.hideModal()`, the theme's own surfaces (mega
     menu, mobile drawer, palette) close.
   - page-scoped patch CSS is disabled and its JS patch unmounted (below).
3. **Environment.** `L.env.requestpath/dispatchpath/pathinfo/nodespec`,
   `body[data-page]`, `document.title`. An alias is re-dispatched
   server-side, so `requestpath` and `data-page` carry the alias target while
   `pathinfo` keeps the URL as requested; a `firstchild` keeps the requested
   path in both. The title suffix (` - hostname`) is read off the initial
   document, so it matches whatever the template emitted. `nodespec` drives
   `L.hasViewPermission()` and therefore the Save/Apply footer's readonly
   state — and its `readonly` is **folded down the dispatch path** the way
   `dispatcher.uc` does it: `ctx_append` collects every node's
   `depends.acl` and one `check_acl_depends()` over the union is writable as
   soon as *any* group is writable, so a page is readonly only when every
   acl-bearing node on its path is. The tree's per-node flag
   (`apply_tree_acls`) covers that node's own acl alone; handing the leaf
   node over as-is gave a read-only user a live Save & Apply on every page
   under a read-only group. The tree object is not mutated (`nodespec` is a
   copy). `data-page` keys `ui.tabs` session state and the theme's
   page-scoped CSS.
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
   visit (the list of stems to mount belongs to the navigation that computed
   it, so a superseded one mounts nothing later); URLs the router adds carry
   the same `?v=PKG_VERSION` luci.mk stamps on the template's own links,
   read from `body[data-asset-version]`, so they hit the same cache entry — a JS patch that registers nothing is simply executed once,
   MPA-style. A patch script mounts itself when it evaluates; if the user
   has navigated on before it arrives, its `load` handler checks whether
   the current page still wants that stem and unmounts it otherwise (a
   same-stem page reached meanwhile keeps it mounted).
   A menu.d node's own `css` (`header.ut` links `<resource>/<node.css>` for
   the dispatched node, marked `data-aurora-node-css`) is kept the same
   way: one `<link>` per stylesheet, enabled for the page whose resolved leaf
   declares it, `disabled` for every other page, never removed. Both
   attributes are exempt from the poison gate.
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
     is removed for an empty render). Not completing within 15 s is a
     **failure**, not a completion: committing the spinner and releasing the
     serialization would let the still-running chain paint into a later
     navigation's `#view`, so the timeout rejects and the catch path
     hard-loads the destination. On completion —
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
     click during the first load cannot be painted over by it — and a first
     render that never completes rejects that wait, so the first navigation
     takes the hard-load fallback instead of staging next to a chain that
     may still paint. That first render also runs inside a render window
     (opened after the router's own listeners are registered), so the
     listeners it adds are credited to its class like a cold render's; the
     ones it registered before the router loaded are out of reach. The cost is
     that a click during a slow load waits for that load; the alternative —
     wrapping `prototype.render` per class and repairing stale cold renders
     by re-navigating — leaves a real window open and needs three mechanisms
     where one suffices.
8. **Focus and announcement.** `#maincontent` (`tabindex=-1`) with
   `preventScroll`; the new `document.title` is written into
   `#aurora-nav-status` (`role=status`, `aria-live=polite`), since a
   same-document swap fires no load a screen reader would announce.
9. **Progress.** A navigation that outlives 150 ms shows `#aurora-nav-progress`,
   a hairline at the top that creeps right while the view renders and
   completes on commit (`data-state` active → done); shorter ones stay
   silent, overlapping ones share the bar. Reduced motion drops its
   transitions, not the bar.
10. Any exception → `console.error` (a silent fallback makes every router
   regression look like "the page is just slow") → `location.href =
   destination` — a hard full load, never a stuck page.

## The expiry gate

luci-base answers a dead session with `notifySessionExpiry()`: `Poll.stop()`
plus a modal whose only button is a hard reload. A same-document swap would
`hideModal()` and `Poll.start()` right through it and browse on, every page
erroring in turn (measured: `bench-router.mjs expiry` against the previous
router — `expiredFullLoad: false`). So the router listens for the same two
signals luci-base acts on — a `403` with `X-LuCI-Login-Required: yes` on any
`L.Request`, and the `session.access` probe luci-base fires after a
`-32002` coming back denied or errored — and from then on intercepts nothing:
the next click is a full load, which the dispatcher turns into the login
page. A denied call on any other object is an ACL matter and is ignored.
Nothing is reset: the flag dies with the document, as the session did. The
same flag keeps the visibility gate (below) from restarting a poll the
expiry stopped.

## Hidden tabs

luci-base keeps polling in a background tab. The router stops `Poll` on
`visibilitychange` → hidden when it was active and starts it again on
return — unless the user had paused it, or the session died meanwhile. On
a weak router that is RPC work nobody is looking at.

## The poison gate

A `<style>`/`<link rel=stylesheet>` a view writes into `<head>` dies with
the document on a full load and **survives** a same-document swap, painting
every page after it (a shipped file manager hides Save/Reset on every config
page with one unlayered `!important` rule). Removing it is not an option: a
library that imports CSS at module eval never runs again, so deletion is
one-way (an editor page came back as a black rectangle two million pixels
tall). Hence a gate, not a sweep: before intercepting, any sheet outside
`#view` that is not one of the theme's own — header.ut marks everything it
renders (`data-aurora-shell` on `main.css`, the font, custom and token
`<style>`s; `data-aurora-patch` on patches; `data-aurora-node-css` on the
menu.d node css) — marks the document **poisoned** and the navigation is a
full load — the fresh document carries no view CSS, so the router resumes
immediately. The markers, not a boot snapshot, define "own": the boot page's
modules load concurrently with the router, and a sheet they inserted before
it snapshotted would have counted as the theme's for the rest of the
document. Correctness over speed, never the other way.

An owner-based refinement (stamp each sheet with the inserting module off
the call stack, enable it for pages whose dependency closure holds that
module, `disabled` for the rest) was built, verified on the device and
**removed again**: on this device one view page inserts its own CSS, the
saving is one reload when leaving it, and the price was three monkeypatches
plus an inline template script whose failure mode — a page silently missing
a shared library's CSS — is worse than the reload it avoids. Revisit only
with a real corpus of self-styling view pages.

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
  on a minified head; readonly folding; expiry signals; node css of the
  resolved leaf; the contract check.
- Device (`.claude/skills/aurora-performance/scripts/bench-router.mjs`, CDP):
  1. full walk of every clickable node in each nav mode, each compared
     against a real full load of the same URL — `data-page`,
     `dispatchpath`, URL, title, tab count, footer presence, console clean;
  2. click → view painted, median of N, router vs full load, warm and cold;
  3. soak: 60 navigations over 12 pages, heap / DOM nodes / listeners /
     poll queue length flat after the first pass;
  4. back/forward chain through alias and firstchild URLs — no reload;
  5. poison gate: a foreign `<style>` in `<head>` makes the next
     navigation a full load, the one after is a same-document swap again;
  5b. sheets: the same, on every walked view page that really inserts its
     own sheets (found on the walk) instead of an injected one — reached
     same-document and landed on directly (its modules insert before the
     router boots), leaving is a full load either way;
  5c. hygiene: progress bar and live region present, live region carries the
     title, a hidden tab stops polling and a visible one resumes it;
  6. nodecss: a page whose menu.d node declares `css` — link enabled on
     arrival, disabled after leaving, re-enabled without a duplicate on
     return (skipped when no installed node declares one);
  7. expiry (last, destroys the session): logout fetched from inside the
     document, one failing RPC → luci-base's modal and `Poll.stop()`; the
     next navigation is a full load landing on the login form.
  The walk also compares `nodespec.readonly`, `L.hasViewPermission()`, the
  set of enabled node-css links and the live-region text against the full
  load, and reports which pages carry sheets that are not the theme's.
- The perf skill's N1 is rewritten to describe this router and its
  boundaries; N2 keeps document prefetch for the non-router path.
