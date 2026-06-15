import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const overlayCss = await readFile(
  new URL("../src/media/components/_overlay.css", import.meta.url),
  "utf8",
);
const layoutCss = await readFile(
  new URL("../src/media/_layout.css", import.meta.url),
  "utf8",
);

test("mobile and mega navigation share the translucent menu background", () => {
  const overlayRule = overlayCss.match(
    /\.mobile-menu-overlay\s*\{([\s\S]*?)\n\s*\.mobile-nav\s*\{/,
  )?.[1];
  const navRule = overlayCss.match(
    /\.mobile-nav\s*\{\s*@apply\s+([^;]+);/,
  )?.[1];

  assert.ok(overlayRule?.includes("max-md:bg-mega-menu-bg"));
  assert.ok(!overlayRule?.includes("max-md:bg-scrim"));
  assert.ok(!overlayRule?.includes("max-md:p-1"));
  assert.ok(!navRule?.includes("max-md:bg-"));
  assert.match(layoutCss, /\bbg-mega-menu-bg\b/);
});
