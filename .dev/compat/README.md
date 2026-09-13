# DOM compat ledger

Every page-scoped rule in the theme exists because some page's DOM did not
sit right under Aurora. This directory records which page, which package,
where in the menu, which element, what went wrong, why the rule is written
the way it is, and how it was verified — so the next edit to `_table.css`
can see what it is about to undo.

"compat" means page DOM ↔ theme. Stock LuCI pages (Software, Mount Points,
Wireless) count as much as third-party apps.

```
pages/<data-page prefix>.md   one file per page prefix; entries appended in time order
fixtures/<data-page>--<slug>.html   trimmed DOM + checks, run by tests/compat.test.js
```

The page prefix follows the same rule as `media/patches/`: the file
`admin-system-diskman.md` also covers `admin-system-diskman-partition-…`.
Rules that are not tied to one page but were added for one (`.td.cbi-value-field`
for Dockerman) go under the page that motivated them, and the `dom:` line
names the selector so a grep for the selector finds the entry.

## Entry format

```
## <slug> — <one line: what the rule does>
- page: <data-page> · <Menu → Path as shown in the UI>
- package: <luci-app-x (author)> | stock <luci-mod-x>
- dom: <selector / element, plus the inline style or attribute the fix depends on>
- symptom: <what the user sees>
- cause: <why, one or two lines> | unknown (<what the record lacks>)
- fix: <file> `<selector>` <utilities> · <commit> · <version>
- verified: <device/fixture, method, numbers before → after> | not measured
- fixture: fixtures/<name>.html | none (<why>)
- issue: #n | — · mirror: shadcn <commit> | pending | n/a · status: active | removed <commit>
```

Facts only. A cause that cannot be recovered from history is written as
`unknown`, never guessed. `status: removed` entries stay: a removed rule is
the one most likely to be re-added blindly.

Before editing a component partial or a patch, grep here for the file and
every selector you touch:

```
grep -rn "_table.css" .dev/compat/pages/
grep -rln "status_leases" .dev/compat/pages/
```

## Fixtures

A fixture is a trimmed copy of the real page: `<body data-page="…">`,
`#maincontent > #view`, only the offending block (three table rows are
enough), any `<style>` the page injects itself, and the theme CSS by relative
path. Keep the viewport meta: without it a mobile viewport lays out at 980px
and the `max-md:` card rules never apply. When the wrap depends on the
content width, put the width measured on the device as `max-width` on the
block's own container (not on `.cbi-section`, whose padding eats into it).
The runner injects the theme font itself.

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="../../../htdocs/luci-static/aurora/main.css">
<!-- add ../../../htdocs/luci-static/aurora/patches/<prefix>.css when the page has one -->
<script type="application/json" id="compat">
{ "ledger": "#65", "viewports": [1280, 390],
  "checks": [ { "nowrap": "table[id^=partition-table] td" },
              { "fits":   "table[id^=partition-table]" } ] }
</script>
```

Checks:

| check | passes when |
|---|---|
| `nowrap: <sel>` | every matched element's text sits on one line, and no text starts below an inline checkbox/indicator inside it |
| `fits: <sel>` | `scrollWidth ≤ clientWidth + 1` and the element's right edge is inside its parent's |
| `js: "<expr>"` | the expression is truthy in the page — escape hatch; the ledger entry says why |

A check may carry its own `"viewports": [...]` (a mobile card layout wraps on
purpose). Capture the DOM from a device running this theme (`.dev/mocks/`
snapshot, DevTools `copy(el.outerHTML)`, or the probe script in
`.claude/skills/luci-dom-compat/scripts/`), strip it down, and confirm the
check fails against the pre-fix CSS before committing it.

## Running

`cd .dev && pnpm build && pnpm test` — `tests/compat.test.js` opens each
fixture in headless Chrome over CDP (`CHROME_BIN`, then the macOS app path,
then `google-chrome`/`chromium` on PATH). Without Chrome the test skips with
a hint; with `CI` set it fails.
