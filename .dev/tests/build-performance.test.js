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
  const font = bytes("aurora/fonts/lato-v24-latin-regular.woff2");
  const logo = bytes("aurora/images/logo.svg");

  assert.ok(main <= 190_000, "main.css exceeds 190 KB");
  assert.ok(login <= 12_000, "login.css exceeds 12 KB");
  assert.ok(menu <= 20_000, "menu-aurora.js exceeds 20 KB");
  assert.ok(logo <= 16_000, "logo.svg exceeds 16 KB");
  assert.ok(main + menu + font + logo <= 250_000, "admin assets exceed 250 KB");
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
