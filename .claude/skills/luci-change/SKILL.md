---
name: luci-change
description: Change this theme with two gates — the user's approval of a written plan before any edit, and a vertical agent review after implementation. Use for any request that touches .dev/src, ucode/, htdocs/, root/, Makefile, vite.config.ts or CI.
argument-hint: <what to change>
disable-model-invocation: true
---

# /luci-change $ARGUMENTS

Gate 1 is the user's explicit approval; gate 2 is the `luci-vertical-review`
workflow. No edit to a shipped or source path happens before gate 1, and the
`guard-edits` hook refuses it mechanically.

0. **Scope.** If the fix belongs in luci-base, uhttpd, rpcd or the feed, stop
   and run `/upstream-rfc "<topic>"` instead. If it only touches `.dev/docs/`,
   skip to step 4 (docs are not guarded).
1. **Research (read-only).** Load `luci-knowledge`; read
   `references/aurora-contract.md` and the section relevant to the files
   involved; `git log -8 --oneline -- <files>`; the tests and budgets that
   cover them. If the request names a page, a package, a DOM element or
   shows a page screenshot, load `luci-dom-compat` and complete its steps
   1–2 (locate the page, read `.dev/compat/pages/` for the files and
   selectors about to change) before planning.
2. **Plan.** Call `EnterPlanMode`. The plan states: files to change; the
   approach in ≤ 10 lines; budget impact (bytes per `tests/build-performance.test.js`,
   per-request ubus/uci/fs calls, dispatches per navigation); floor it
   depends on (OpenWrt/browser); risk and rollback; verification
   (`pnpm test`, `pnpm build`, which bench if a device is reachable); that
   it is one logical commit. Call `ExitPlanMode` — the user's selection is
   gate 1. If plan mode is unavailable, put the same plan in
   `AskUserQuestion` with options "Approve" / "Change the plan" and proceed
   only on "Approve".
3. **Arm the guard.** `printf '%s\n' <approved path prefixes> > .claude/.change-approved`
   (one prefix per line, exactly the paths in the approved plan).
4. **Implement.** Minimal diff, no unrelated cleanup, comments of one or
   two lines. `htdocs/` only through `cd .dev && pnpm build`.
5. **Verify.** `cd .dev && pnpm test && pnpm build`; if budgets moved, update
   the number in `tests/build-performance.test.js` **and**
   `.claude/skills/aurora-performance/references/aurora-budgets.md` in the
   same change with the measured value. Run the relevant bench when
   `.dev/.env` names a reachable device; otherwise write "not measured on
   device" in the report.
6. **Gate 2.** Run the workflow `luci-vertical-review` with
   `{ base: "HEAD", scope: ".claude/.change-approved" }`. Fix every
   `blocker`/`major` it confirms; list `minor` ones. If a fix changed
   behaviour, run it once more (two rounds maximum).
7. **Report and disarm.** What changed (files), findings and what was done
   with each, measurements or the explicit "not measured", anything left
   out and why. Write the same report as a decision record to
   `.dev/decisions/<YYYY-MM-DD>-<slug>.md` (git-ignored; header lines
   `Request`, `Decision: implemented | reverted | deferred`, `Commit:` once
   one exists) so the ledger outlives the session. A page-scoped change also
   appends its entry to `.dev/compat/pages/<data-page prefix>.md` (and a
   fixture under `.dev/compat/fixtures/` when the symptom is geometric —
   `luci-dom-compat` step 5) in the same commit. `rm -f
   .claude/.change-approved`. Commit only when the user asks: one logical
   change, short conventional subject, body carries the reasoning, no
   session trailers. Never push.
