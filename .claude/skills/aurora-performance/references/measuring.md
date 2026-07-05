# Measuring

Every rule in server.md/loading.md/runtime.md ends in "Verify" and
"Quantify" for a reason: an unmeasured performance claim is an opinion. This
file documents the instrumentation those sections point at.

## `bench.mjs` — on-device HTTP bench

Run from `.dev/`:

```bash
cd .dev
node ../.claude/skills/aurora-performance/scripts/bench.mjs
BENCH_RUNS=20 node ../.claude/skills/aurora-performance/scripts/bench.mjs
```

**Setup.** Reads `.dev/.env` for `VITE_OPENWRT_HOST` (default
`http://192.168.1.1:80`), plus optionally `VITE_OPENWRT_SSH_HOST` and
`VITE_OPENWRT_SSH_KEY` for the device report. If `.env` is missing, it
aborts immediately with a one-line message telling you to copy
`.dev/.env.example` and set `VITE_OPENWRT_HOST`. If a target is unreachable
or returns an HTTP error status mid-run, it aborts with a one-line message
naming the target that failed — it does not silently skip it.

**What it measures.** `BENCH_RUNS` (default 10) samples per target via
`curl`, reduced to a median, against 5 fixed targets:

1. `GET /cgi-bin/luci` (the login page) — the honest unauthenticated target:
   it's the one page a bench script can hit without a session, and TTFB
   comparisons must compare like with like.
2. `main.css`, identity (no `Accept-Encoding`)
3. `main.css`, gzip-negotiated
4. `login.css`, gzip-negotiated
5. the theme's menu script, gzip-negotiated (example: aurora's `menu-aurora.js`)

Per target it reports TTFB, total time, transferred bytes, and HTTP status,
summarized as a Markdown table on stdout.

**Device report.** If `VITE_OPENWRT_SSH_HOST` is set, it also SSHes in for a
`## Device` section: `uhttpd` VmRSS (parsed from `/proc/<pid>/status`) and
theme flash usage (`du -sk`) on the static asset directories. If SSH is
unreachable, this section degrades to a one-line "⚠ SSH unreachable —
HTTP metrics only" instead of failing the whole run — the HTTP-only rows
still print.

**Output.** The whole report is Markdown: paste it straight into a PR
description, or archive it (see below).

## Measurement discipline

- **Median of ≥10 runs**, never a single sample — router-side variance
  (other requests, GC, thermal throttling) is real.
- **Hard refresh** before any browser-side recording; a warm cache measures
  the cache, not the change.
- **Pin the CPU throttle** (4× in the Performance panel) for every runtime
  recording so results are comparable across sessions and machines.
- **Track two numbers, not one**: the absolute value against the theme's
  budget table, *and* the delta versus the base branch. A budget pass on
  absolute numbers with a regression in the delta is still a regression.
- **Budgets come from baselines, never from intuition.** If a number isn't
  in the theme's budget sheet (`aurora-budgets.md`), it isn't a budget yet — propose
  one from a measured baseline, don't invent a round number.

## A/B delta protocol

For any change that touches server or loading plane performance:

```bash
git checkout <base-branch>
cd .dev && pnpm build && node ../.claude/skills/aurora-performance/scripts/bench.mjs > /tmp/bench-base.md
git checkout <working-branch>
cd .dev && pnpm build && node ../.claude/skills/aurora-performance/scripts/bench.mjs > /tmp/bench-branch.md
```

Put the two Markdown tables side by side in the PR. For a runtime-plane
change, pair this with one DevTools Performance recording (see runtime.md
R1/R2 Verify steps) on each branch, hard-refreshing between them — the dev
server re-proxies the new build automatically, but the browser cache does
not clear itself.

## Baseline archive

Save the bench output to the skill's `baselines/` directory as
`<version>-<device>.md` (`../baselines/` relative to this file) — the
directory is git-ignored because the report records the device model and LAN
address, so it stays local. Budget claims stay falsifiable across releases and
hardware. Any PR that proposes revising a budget number must add a new baseline
entry backing the revision — a budget change without an archived measurement is
not accepted.

## Field data

Lab measurements (this file, DevTools) catch regressions before ship; they
don't tell you what real users experience. If the theme ships the
[`web-vitals`](https://github.com/GoogleChrome/web-vitals) library, watch
the **P75** of INP/LCP/CLS, not the average — a P75 regression is a real
user-facing regression even when the lab numbers look fine.
