# The Wire

Between the router and the browser is a link that is usually the router's
own WiFi radio to a phone — slower and less reliable than a wired desktop
connection. Every request that has to happen before first paint is an RTT
the user watches. The conventions in a typical LuCI theme (a single import
manifest, no bundler) already steer you toward the right structural choice;
the gap is almost always in *quantifying* what you added and *verifying* it
with a waterfall, not in the structural decision itself.

## L1 — Kill render-blocking requests

**Why.** Each `<link rel="stylesheet">` or synchronous `<script>` in `<head>`
is a full round trip the browser must complete, over that same slow link,
before it can paint anything.

**Do / Don't.** Inline CSS under roughly 1 KB rather than adding a new
`<link>` (example: aurora's `aurora-font.css` is 188 bytes — too small to
justify its own blocking request). `preload` fonts that are needed for first
paint. `defer` scripts that can tolerate running after parse. Give
non-screen stylesheets (e.g. print) a `media` attribute so the browser
fetches them without blocking rendering — importing a print stylesheet into
the main CSS bundle only avoids blocking if the `@media print` boundary is
preserved; don't assume "no new `<link>`" alone settles the question.

**Verify.** DevTools Network waterfall with a pinned Slow 4G profile; count
how many requests block before first paint.

**Quantify.** Blocking-request count before first paint.

## L2 — Download once, cache forever

**Why.** LuCI performs a full page navigation on every click, not a SPA
route change. An unversioned asset costs at least a conditional request
(304) on every single click, forever, even when its bytes never change.

**Do / Don't.** Give assets a versioned URL (e.g. `?v=<hash-or-build-id>`)
paired with a long `Cache-Control`, so the browser skips the network
entirely on repeat visits. A 304 on every click for an asset that hasn't
changed is the counter-example this rule exists to prevent. For LuCI theme
templates, do not judge versioning from the source `.ut` file alone:
`luci.mk` rewrites quoted `{{ media }}/... .css` and
`{{ resource }}/... .js` links during package build to append
`?v=$(PKG_VERSION)` (or `PKG_SRC_VERSION`). `uhttpd` does not add this query
string; it only separates the query from the filesystem path and serves the
static file with validators such as `ETag` and `Last-Modified`. Verify the
installed package output or live page HTML before claiming an asset is
unversioned. A version query also is not a cache policy by itself: if
`uhttpd` still omits long-lived `Cache-Control`, repeat navigations can still
revalidate with 304s.

**Verify.** Repeat-visit Network waterfall shows ~0 asset requests (all
served from disk/memory cache).

**Quantify.** Repeat-visit request count.

## L3 — Ship compressed

**Why.** An uncompressed asset costs both wire time on the slow link (see
The Wire) and CPU on the slow server (see server.md S1) — compression is the
one change that helps both planes at once.

**Do / Don't.** Precompress at build time so `uhttpd` can serve `foo.gz`
verbatim (cross-reference server.md S1). Run shipped SVGs through SVGO
(example: aurora's `logo.svg`, which doubles as the favicon, ships at 45 KB —
an unoptimized SVG is a common place for dead editor metadata to hide).
Choose sane image formats (WebP/AVIF over unoptimized PNG/JPEG) for anything
that isn't vector.

**Verify.** `bench.mjs`'s gzip-negotiated rows; `du` on the build output
directory to catch anything that grew.

**Quantify.** Per-page transferred bytes (cold load); individual asset
sizes.

## Loading metrics at a glance

| Metric | Tool | Budget source |
|---|---|---|
| Blocking requests before first paint | DevTools Network (Slow 4G) | `aurora-budgets.md` |
| Repeat-visit request count | DevTools Network | `aurora-budgets.md` |
| Transferred bytes (cold, gzip) | `bench.mjs` | `aurora-budgets.md` |
| Individual asset size | `du` / `bench.mjs` | `aurora-budgets.md` |
