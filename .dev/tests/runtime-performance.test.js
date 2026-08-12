import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

test("speculative prefetch stays side-effect-safe", () => {
  const header = source("ucode/template/themes/aurora/header.ut");

  assert.match(header, /<script type="speculationrules">/);
  // A prefetch is a real GET with session cookies: logout must stay
  // excluded, and the prerender action must never appear in the rules.
  assert.match(header, /logout/);
  assert.doesNotMatch(header, /"prerender"/);
});

test("poll pauses on hidden tabs and refreshes on bfcache restore", () => {
  const menu = source(".dev/src/resource/menu-aurora.js");

  assert.match(menu, /visibilitychange/);
  assert.match(menu, /pageshow/);
});

test("navigation transitions avoid blanket and full-page layout animation", () => {
  const nav = source(".dev/src/media/components/_nav.css");
  const layout = source(".dev/src/media/_layout.css");

  assert.doesNotMatch(nav, /\btransition-all\b/);
  assert.doesNotMatch(layout, /transition-\[grid-template-columns\]/);
});

test("login effects do not reserve compositor layers permanently", () => {
  const login = source(".dev/src/media/login.css");
  assert.doesNotMatch(login, /\[will-change:opacity\]/);
});

test("login template reuses server data when including the header", () => {
  const sysauth = source("ucode/template/themes/aurora/sysauth.ut");
  const header = source("ucode/template/themes/aurora/header.ut");

  assert.match(
    sysauth,
    /include\('header',\s*\{[^}]*prefetched_boardinfo:\s*boardinfo[^}]*prefetched_tokens:\s*themeTokens[^}]*\}\)/s,
  );
  assert.match(header, /prefetched_boardinfo\s*\?\?/);
  assert.match(header, /prefetched_tokens\s*\?\?/);
});
