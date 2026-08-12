# The Click

Every page change in LuCI is a full document navigation. That is the design,
not a limitation to engineer away: the browser tears the old document down
and rebuilds the new one, and in doing so disposes — for free — of
everything a page accumulated: timers, event listeners, injected styles,
and the singleton data caches inside luci-base that are *documented* to
assume it (`uci.js` caches loaded configs "only once" until `unload()`;
`L.require()` instantiates a view as a side effect of loading it and caches
the instance). Taking navigation over in theme JS means re-implementing
that disposal by hand, against framework internals the theme does not own
and an open ecosystem of third-party pages all written assuming document
death. This file encodes the opposite strategy: **stay MPA, spend a few
hundred bytes letting the platform hide what it can, and protect the caches
the browser gives away.**

Vocabulary used below:

- **First load** — the session's first document; shell CSS/JS/fonts are all
  cold. Biggest single cost; governed by loading.md.
- **Cold navigation** — first visit to a page this session: its view module
  and the modules it `require`s must arrive before data can even be
  requested.
- **Warm navigation** — revisiting a page: code comes from HTTP and
  bytecode caches; what remains is the dispatcher run, the document
  rebuild, and the data RPCs.
- Data RPCs are fetched fresh on every navigation under every model — that
  is the floor nothing removes.

## What one navigation costs

| # | Cost | Status | Removed / hidden by |
|---|---|---|---|
| 1 | One dispatcher run on the router (menu tree + ACL + template render) — the TTFB | hideable | speculation-rules prefetch inside the hover→click gap (N2) |
| 2 | Menu JSON fetch | already removed upstream | `ui.menu.load()` serves the tree from `sessionStorage` after the session's first page (`session.getLocalData('menu')`); `rpcBaseURL` and `features` are cached the same way — never re-fetch these (N3) |
| 3 | Translations catalog (`admin/translations/<lang>`) — a second dispatcher run per page, render-blocking in `<head>`, and effectively uncacheable (`Cache-Control: no-cache` with no `ETag`/`Last-Modified`, so revalidation is impossible and the full catalog re-transfers on every click; live-measured 2026-08: a zh-cn catalog is 229,688 B at ~64 ms TTFB — 36× the login page's HTML) | upstream-only | a theme cannot add response headers, and document prefetch does not cover subresources. Do **not** defer the script as a workaround: on warm loads the menu module can render off microtasks before deferred scripts run, so menus race a deferred catalog and silently fall back to msgids. The real fix is a tiny luci-base change (validators + a versioned URL, like luci.js already has) |
| 4 | Asset refetch / revalidation | mostly removed | `?v=` versioning (loading.md L2) plus browser caching; heuristic freshness only — verify on device |
| 5 | JS parse | mostly removed | browser bytecode cache on stable URLs |
| 6 | JS top-level re-execution (luci.js, ui.js, form.js, …) | **floor** | — (tens of ms on phone-class CPUs) |
| 7 | Document rebuild + first full paint | **floor**, maskable | cross-document View Transitions (N4) |
| 8 | View module fetch (cold navigations only) | removable | hover prewarm of the module and its require closure (N2, measure first) |
| 9 | Data RPCs | **floor** under every model | — |

Rows 6, 7 and 9 are the whole price of staying MPA (row 3 is an upstream
repair, not a theme cost to carry). Everything else can be removed or
hidden for a few hundred bytes — which is why a client-side router, whose
entire yield is rows 6–7 minus its own overhead, does not buy its cost
here.

A load-order constraint that bounds `defer` ambitions: luci-base includes
the theme header first, then loads luci.js and runs `new LuCI(env)`
**synchronously** — and that constructor captures `window.cbi_init` at
call time, while `initDOM()` later invokes the captured value unguarded.
`cbi.js` therefore must stay a synchronous script that executes before the
inline `new LuCI(env)` call; deferring it leaves the capture undefined and
kills the page at DOMContentLoaded (no `Poll.start()`, no `luci-loaded`).

## N1 — Navigation is MPA plus platform enhancements

**Why.** Client-side routing means owning state luci-base does not hand
over: views instantiate inside `require()` and are cached as instances;
`Request` keeps its XHR private with no abort path; `Poll` teardown has
exact ordering; `uci.js` / `network.js` singletons cache data on the
assumption that document death resets them; third-party pages inject
`<head>` styles and raw `setInterval`s on the same assumption. All of that
must be re-implemented, then re-verified against every luci-base release
and every third-party page, forever. Meanwhile the browser ships MPA wins —
bfcache, paint holding, bytecode caching, cross-document View Transitions,
speculation rules — for free, every year.

**Do / Don't.** Use the mechanisms in this file; never intercept link
clicks into a theme router, never keep view or form state alive across
documents, never re-derive dispatcher routing client-side. If luci-base
itself ever ships a supported client-navigation API, adopt that instead.

**Verify.** Absence: no `pushState`/`popstate` navigation handling in theme
JS; menu links stay plain `<a href>`.

**Quantify.** Theme JS devoted to navigation ≈ the few hundred bytes of the
mechanisms below.

## N2 — Speculative loading must be side-effect-safe

**Why.** A prefetch is a real GET carrying session cookies, executed on the
router. LuCI's logout is a plain GET — prefetching it logs the user out at
hover. Prerender is worse: it executes the target page's JS, firing its
full RPC load for pages never opened, on 1–2 shared cores.

**Do / Don't.** Prefetch documents with an inline
`<script type="speculationrules">`: `"eagerness": "moderate"`
(hover/pointerdown-triggered), match the admin URL space, and exclude
`*/logout*` — audit for any other state-changing GET before widening the
match. Never use `prerender`. Don't add a Save-Data gate; Chrome already
suppresses speculative loading under Save-Data, and unsupporting browsers
ignore the script type. If cold-navigation measurements justify module
prewarm: fetch view modules with `{ priority: 'low' }`, discover
dependencies by scanning the file head for `'require x'` string literals
with a regex that is **not** line-anchored (shipped files are minified onto
one line), and skip the class names luci-base seeds without files
(`baseclass`, `dom`, `poll`, `request`, `session`, `view`).

**Know the activation boundary.** Speculation Rules are a secure-context
API: on a plain-HTTP router UI the rules parse but never fire — verified
live (hover produced no prefetch over `http://`, empty deliveryType,
unchanged TTFB; the identical click over `https://` hit
`navigational-prefetch` with document arrival 88 → 6 ms). Any LuCI served
over HTTPS — a self-signed uhttpd certificate included — is a secure
context, so the ~200 B of rules are the right bet as shipped defaults; just
never claim the win on an HTTP deployment. Related live observation: the
uhttpd TLS handshake itself costs ~+160 ms document TTFB on router-class
CPUs, which prefetch also hides on the hover path.

**Verify.** `bench-browser.mjs` S2 (see measuring.md): hover click must
report `deliveryType: navigational-prefetch`; no prefetch request may ever
hit logout. Warm-navigation median A/B via bench.mjs.

**Quantify.** Document-arrival ms, hover-hit vs plain (live A/B 2026-08:
88 → 6 ms, −93%); mispredicted dispatcher runs per session.

## N3 — Protect the free caches

**Why.** The two largest navigation wins cost nothing and are lost
silently. bfcache makes back/forward a 0 ms full-document restore —
rendered data included, no RPC — but a single `unload`/`beforeunload`
listener or a `no-store` header forfeits it. And luci-base already
session-caches the menu tree, RPC base URL and feature flags; fetching any
of them again pays a dispatcher run for nothing.

**Do / Don't.** Never register `unload`/`beforeunload` (verified absent
from luci-base resources and this theme as of 2026-08 — treat introducing
one as a regression). Never add `no-store`: dynamic responses already
default to `Cache-Control: no-cache` + `Expires: 0` (luci-base `http.uc`
`write_headers()`, live-verified 2026-08), which still permits bfcache and
speculation-rules prefetch — `no-store` is the header that forfeits both.
Static assets get `ETag`/`Last-Modified` from uhttpd; a conditional request
answers 304 with zero body bytes (live-verified). Never re-fetch what
`session.getLocalData` already holds. Add a `pageshow` handler: when
`event.persisted`, run one immediate poll step so a restored page shows
fresh data. Pause polling on `visibilitychange` → hidden and resume on
visible — but only resume a poll the theme itself paused, never one the
user paused through the poll indicator.

**Verify.** DevTools → Application → Back/forward cache → Test succeeds on
the device; repeat-visit waterfall shows ≈ 0 asset requests; a restored
page refreshes within one poll interval; a hidden tab's ubus call rate
drops to zero.

**Quantify.** Back/forward restore time; background-tab RPC rate.

## N4 — Mask the document seam

**Why.** Rows 5–6 of the cost table — re-execution and rebuild — cannot be
removed, but their visible symptom, a blank frame between documents, can.
Perceived continuity is most of what a client-side router would have
bought.

**Do / Don't.** Opt both documents into cross-document View Transitions —
`@view-transition { navigation: auto }` — in the stylesheet the login and
admin entries share, so the login→admin hop transitions too. Keep the root
crossfade (compositor-only opacity, R1-compliant); provide the off-switch
under `@media (prefers-reduced-motion: reduce)` (R3). Know what it does:
the transition targets the new document's *first frame*, so it removes the
flash, not the wait — it complements prefetch (N2), which removes the wait.
Unsupporting browsers ignore the at-rule; that is the intended degradation.

**Verify.** Device screen recording: no white frame between documents;
`prefers-reduced-motion` disables it; dark-mode pages don't flash a
light-themed first frame mid-transition.

**Quantify.** CSS bytes added (~200 B) against the main.css budget.

## Verifying navigation work

Two habits from measuring.md apply with extra force here. First, compare
any anomaly against a real full load of the same URL before calling it a
regression — some pages spin, poll, or repaint by themselves. Second,
navigation gains are medians over many clicks, cold and warm measured
separately, on the device — a single hand-timed click proves nothing.
