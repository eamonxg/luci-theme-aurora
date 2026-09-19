import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "../..");
const output = resolve(projectRoot, "htdocs/luci-static");

const asset = (path) => resolve(output, path);
const bytes = (path) => statSync(asset(path)).size;

test("production assets stay within raw-transfer budgets", () => {
  const main = bytes("aurora/main.css");
  const login = bytes("aurora/login.css");
  const menu = bytes("resources/menu-aurora.js");
  const router = bytes("resources/router-aurora.js");
  const font = bytes("aurora/fonts/lato-v24-latin-regular.woff2");
  const logo = bytes("aurora/images/logo.svg");

  // 187K: pseudo-elements are nested rules, one content declaration each.
  assert.ok(main <= 187_000, "main.css exceeds 187 KB");
  assert.ok(login <= 12_000, "login.css exceeds 12 KB");
  // 22K: palette recents (record on pick, pure-LRU browse order, storage
  // validation) added ~0.8 KB and the ">" logout command ~0.2 KB. The total
  // budget below moved by the same amount.
  // 23K: palette tabs (third-level nodes, redirect-parent folding, legacy
  // recents mapping, parent-aware scoring, per-segment path words) added
  // ~1.3 KB; the total budget below still holds.
  assert.ok(menu <= 23_000, "menu-aurora.js exceeds 23 KB");
  // 15K: the expiry gate, readonly folding, menu.d node css, wildcard
  // actions, progress bar, visibility gate and contract check added ~3 KB
  // over the first cut; the total-transfer budget below moved by the same
  // amount. Mirrored in the perf skill's aurora-budgets.md.
  // 16K: the router now ships from @eamonxg/luci-theme-devkit — theme hooks
  // as document events, the title format read off the document, and the
  // inner-scroller restoration shared with shadcn (+0.8 KB raw, +0.3 KB gz).
  assert.ok(router <= 16_000, "router-aurora.js exceeds 16 KB");
  assert.ok(logo <= 16_000, "logo.svg exceeds 16 KB");
  assert.ok(
    main + menu + router + font + logo <= 264_000,
    "admin assets exceed 264 KB",
  );
  assert.ok(login + font + logo <= 55_000, "login assets exceed 55 KB");
});

test("compressed LuCI JS preserves its loader directives", () => {
  const js = readFileSync(asset("resources/menu-aurora.js"), "utf8");
  assert.match(js, /["']require baseclass["'];["']require ui["'];/);

  const module = new Function("baseclass", "ui", js)(
    { extend: (value) => value },
    {},
  );
  assert.equal(typeof module.__init__, "function");
});

test("compiled CSS does not duplicate SVG payloads for every mask property", () => {
  const css = readFileSync(asset("aurora/main.css"), "utf8");
  const dataUrls = css.match(/data:image\/svg\+xml,[^"]+/g) ?? [];
  const encodedBytes = dataUrls.reduce((sum, value) => sum + value.length, 0);

  assert.equal(
    dataUrls.length,
    new Set(dataUrls).size,
    "duplicate SVG data URL",
  );
  assert.ok(encodedBytes <= 17_000, `SVG data URLs occupy ${encodedBytes} B`);
});

test("pruned login.css keeps every consumed variable resolvable", () => {
  const css = readFileSync(asset("aurora/login.css"), "utf8");
  const declared = new Set(
    [...css.matchAll(/[{;](--[\w-]+):/g)].map((m) => m[1]),
  );
  const registered = new Set(
    [...css.matchAll(/@property\s+(--[\w-]+)/g)].map((m) => m[1]),
  );
  // header.ut injects these from UCI at render time — consumed here, never
  // declared here.
  const injected = new Set(["--login-bg", "--login-bg-lqip"]);

  const unresolvable = [];
  for (const [, name, delim] of css.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
    const hasFallback = delim === ",";
    if (
      !declared.has(name) &&
      !registered.has(name) &&
      !injected.has(name) &&
      !hasFallback
    ) {
      unresolvable.push(name);
    }
  }
  assert.deepEqual(unresolvable, []);

  // The prune must actually strip admin-only tokens from the shared sheet.
  for (const adminOnly of ["--mega-menu-bg", "--icon-", "--sidebar"]) {
    assert.ok(!css.includes(adminOnly), `${adminOnly} should be pruned`);
  }
  // And the login page's own consumed tokens must survive, light and dark.
  for (const kept of ["--surface:", "--brand:", "--control-bg:"]) {
    const count = css.split(kept).length - 1;
    assert.ok(count >= 2, `${kept} should be declared for both modes`);
  }
});

test("package roots contain no macOS metadata", () => {
  const offenders = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.name === ".DS_Store") offenders.push(path);
      else if (entry.isDirectory()) visit(path);
    }
  };

  visit(resolve(projectRoot, "htdocs"));
  visit(resolve(projectRoot, "ucode"));
  assert.deepEqual(offenders, []);
});

test("the web manifest's icons exist in the package", () => {
  const manifest = JSON.parse(readFileSync(asset("aurora/images/app.webmanifest"), "utf8"));
  assert.ok(manifest.icons.length > 0);
  for (const { src } of manifest.icons) {
    assert.match(src, /^\/luci-static\//);
    assert.ok(statSync(asset(src.replace(/^\/luci-static\//, ""))).isFile(), src);
  }
});

test("login.css keeps the Safari 16.4 backdrop-filter prefix", () => {
  const css = readFileSync(asset("aurora/login.css"), "utf8");
  const count = (needle) => css.split(needle).length - 1;
  const prefixed = count("-webkit-backdrop-filter:");
  assert.ok(prefixed > 0);
  assert.equal(count("backdrop-filter:") - prefixed, prefixed);
});

test("no rule repeats a declaration, vendor-prefixed ones aside", () => {
  for (const sheet of ["aurora/main.css", "aurora/login.css"]) {
    const css = readFileSync(asset(sheet), "utf8");
    const repeated = [];
    const blocks = [[]];
    let quote = "";
    let parens = 0;
    let start = 0;
    const close = (end) => {
      const declaration = css.slice(start, end).trim();
      const seen = blocks.at(-1);
      if (declaration && !declaration.startsWith("-webkit-")) {
        if (seen.includes(declaration)) repeated.push(declaration);
        seen.push(declaration);
      }
      start = end + 1;
    };
    for (let i = 0; i < css.length; i++) {
      const char = css[i];
      if (quote) {
        if (char === "\\") i++;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "(") parens++;
      else if (char === ")") parens--;
      else if (parens) continue;
      else if (char === ";") close(i);
      else if (char === "{") {
        blocks.push([]);
        start = i + 1;
      } else if (char === "}") {
        close(i);
        blocks.pop();
      }
    }
    assert.deepEqual(repeated, [], sheet);
  }
});
