---
name: luci-dom-compat
description: Use whenever a request is about how one LuCI page renders under this theme — a cell that wraps or overflows, misaligned controls, a mobile card layout, a screenshot of a page, a data-page value, a package name (luci-app-*), or an issue about a plugin. Stock LuCI pages count as much as third-party apps. Reads the DOM compat ledger before any CSS is touched and writes the entry (and a geometry fixture) after.
argument-hint: <page, package, symptom or issue>
---

# luci-dom-compat $ARGUMENTS

The ledger lives in `.dev/compat/` (format in its README). It answers "why
is this rule here" for every page-scoped rule in the theme, and
`tests/compat.test.js` runs the fixtures that guard the geometric ones.
This skill does not replace `/luci-change`: the edit itself still goes
through that gate; this is what happens before and after.

## 1. Locate — write the quadruple down before touching CSS

| what | where to get it |
|---|---|
| `data-page` | `body[data-page]` on the page; or the URL segments after `/cgi-bin/luci/` joined with `-` |
| package | on the device: `apk list -I \| grep -i <name>` or `opkg list-installed \| grep -i <name>`; stock pages are `luci-mod-*`/`luci-app-*` from openwrt/luci |
| menu path | `/usr/share/luci/menu.d/*.json` (`grep -o '"admin/[^"]*"'` + the `title` fields) or the breadcrumb on the page |
| DOM element | the selector, plus any inline `style`/attribute the layout depends on (`table-layout:fixed`, `white-space:nowrap`, `width:`) — that is usually the cause |

## 2. Read the ledger first

```
ls .dev/compat/pages/ | grep <prefix>            # this page
grep -rln "<file you will edit>" .dev/compat/pages/
grep -rln "<selector you will touch>" .dev/compat/pages/
```

For every hit, state in the plan whether the change keeps, changes or
removes that entry's behaviour. A rule that looks pointless usually has an
entry; if it has none, that is the first thing to add.

## 3. Evidence

Device reachable (`VITE_OPENWRT_HOST` in `.dev/.env`, empty root password
over http on the dev routers): `node .claude/skills/luci-dom-compat/scripts/compat-probe.mjs`.
It logs in, opens each page in headless Chrome, serves the *before* CSS
through `Fetch` interception, measures, hot-swaps the *after* CSS into the
same document, measures again, and prints per-element computed-style
diffs on `.table` subtrees, wrap/overflow counts for `SELECTOR`, and
screenshots. Nothing on the device is written. Env: `HOST`, `PAGES`
(comma-separated `admin/...` paths), `WIDTHS`, `BEFORE`/`AFTER` (css files;
default before = the file the device serves, after = `htdocs/.../main.css`),
`SELECTOR`, `OUT`, `PRESET_LS` (a `localStorage` key=value the page needs,
e.g. the selected disk).

Device unreachable: a `.dev/mocks/` snapshot through `pnpm dev`
(`/mocks/`), or an existing fixture. Compare against luci-theme-bootstrap
(`../luci-theme-bootstrap/htdocs/luci-static/bootstrap/cascade.css`) when
the question is "what does upstream do here" — serve it as `AFTER` to the
same page.

Wrap detection that survives inline swatches and checkboxes: walk the
cell's text nodes, collect client-rect tops, and treat "text starts below
the inline indicator" as a wrap (`nowrap` in `tests/compat.test.js`).

## 4. Fix

Through `/luci-change`. Prefer the component partial over a `patches/`
file when the cause is a theme rule blocking what the page asked for
(#65: a font size on `td` blocked the table's own); a patch is for markup
the theme cannot reasonably absorb.

## 5. Sink — same commit as the fix

1. Append the entry to `.dev/compat/pages/<data-page prefix>.md` in the
   README format. `verified:` carries the numbers from step 3.
2. Symptom geometric (wrap, overflow, width, height)? Trim the DOM to a
   fixture in `.dev/compat/fixtures/<data-page>--<slug>.html`: the block,
   the page's own injected `<style>`, a `max-width` wrapper matching the
   measured content width if the wrap depends on it, and the `#compat`
   checks. The theme font is injected by the runner. Confirm the fixture
   **fails against the pre-fix CSS** (rebuild from the previous commit, or
   swap the utility back) before committing it.
3. `mirror: pending` until the same change lands in luci-theme-shadcn.
