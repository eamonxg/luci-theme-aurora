# The Router

The router is the slowest, most memory-constrained machine in this whole
system, and it is a *shared* machine: `uhttpd` serves every page view on the
same 1–2 cores and 64–512 MB of RAM as the rest of OpenWrt. Nothing here is
"fast enough" by desktop instinct — it has to be measured.

## S1 — Compute at build time, never at request time

**Why.** Request-time work repeats on every single page view, on a SoC that
is already slow. Anything that can be computed once, at build time, should
never run again inside a request handler.

**Do / Don't.** Precompress assets at build time and let `uhttpd` serve the
precompressed file verbatim when the client sends `Accept-Encoding: gzip` —
this makes the request-time cost *decrease*, since `uhttpd` has no dynamic
compression of its own. Generate derived CSS/config/tokens at build time,
never per-request (example: aurora's generated `_tokens.css`, built from
`.dev/tokens/` and never touched at runtime). When a genuinely per-request
computation is unavoidable, record the accepted exception with its rationale
in the theme budget sheet (`aurora-budgets.md`) so a future session doesn't re-litigate it
(example: aurora's per-request `lsdir()` patch discovery in `header.ut` — one
cheap readdir, measured negligible and accepted as-is).

**Verify.** `top` on the device shows no request-time compression process;
`curl -H 'Accept-Encoding: gzip' -w '%{size_download}'` against the asset
shows the byte drop versus an uncompressed request.

**Quantify.** Transferred bytes; package/flash size delta.

## S2 — Per-request ubus/uci/fs calls are a budget

**Why.** Each `ubus` call, `uci` read, or filesystem stat is a cross-process
round trip on the router, and it happens on *every* page view, not once.
Templates accrete these calls quietly over time if nobody counts them.

**Do / Don't.** Count the ubus/uci/fs calls in a template diff before
merging it. A new call needs a stated reason in the PR description, not an
appeal to consistency with an existing pattern — "this theme always
server-renders per navigation" is not a cost justification for adding one
more call. Batch calls, or use data the dispatcher already fetched, wherever
possible (example inventory: aurora's `header.ut` currently costs 1 ubus
call + 1 uci `get_all` + 1 uci `foreach` + 1 `lsdir` per request — any
addition should be weighed against that baseline, not treated as free).

**Verify.** Static count of ubus/uci/fs calls on the diff, plus an on-device
TTFB A/B using the skill's `bench.mjs` harness (see measuring.md) comparing
the branch against the base.

**Quantify.** Call count per request; TTFB median (base vs. branch).

## S3 — Every byte sent is router CPU

**Why.** Moving data through the kernel network stack costs real CPU on a
slow link, and it costs it on every page view — this is not "just bandwidth,"
it's compute on the same constrained cores serving the request.

**Do / Don't.** Set (and respect) a per-page transferred-bytes budget.
Prefer gzip-negotiated transfer over raw bytes wherever the client supports
it (example: aurora's `main.css` is 211,725 B raw but ~28 KB gzip — always
measure and budget the negotiated size, not the raw one).

**Verify.** The `bench.mjs` bytes column, compared against the theme's own
budget table.

**Quantify.** Transferred bytes per page, cold and repeat.

## S4 — Memory has a ceiling

**Why.** `uhttpd` and `ucode` share as little as 64 MB with the rest of the
OS. A template that builds a large string or data structure at request time
can push the whole box toward OOM on the smallest supported hardware.

**Do / Don't.** Don't accumulate large strings or arrays inside a template
render path; stream or slice instead of buffering everything in memory.

**Verify.** `uhttpd` VmRSS via `bench.mjs`'s device report, taken before and
after the change.

**Quantify.** VmRSS delta (kB).

## Server metrics at a glance

| Metric | Tool | Budget source |
|---|---|---|
| TTFB | `bench.mjs` | `aurora-budgets.md` |
| ubus/uci/fs call count | diff review | `aurora-budgets.md` |
| Transferred bytes (gzip) | `bench.mjs` | `aurora-budgets.md` |
| uhttpd VmRSS | `bench.mjs` device report | `aurora-budgets.md` |
