import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMode } from "../tokens/resolve.js";

test("resolveMode(light) returns flat oklch for all tokens", () => {
  const out = resolveMode("light");
  // 10 inputs + 19 derived = 29 color tokens.
  for (const k of [
    "bg",
    "surface",
    "text",
    "brand",
    "text_muted",
    "surface_sunken",
    "hairline",
    "brand_subtle",
    "focus_ring",
    "progress_start",
    "progress_end",
    "info_surface",
    "scrim",
    "mega_menu_bg",
  ]) {
    assert.ok(out[k], `missing ${k}`);
    assert.ok(
      !out[k].includes("color-mix") && !out[k].includes("var("),
      `${k} not flat: ${out[k]}`,
    );
  }
});

test("progress_end aliases brand", () => {
  const out = resolveMode("light");
  assert.equal(out.progress_end, out.brand);
});

test("scrim uses one 60% alpha value in both modes", () => {
  assert.equal(resolveMode("light").scrim, "oklch(0% 0 0 / 0.6)");
  assert.equal(resolveMode("dark").scrim, "oklch(0% 0 0 / 0.6)");
});

test("menu panel is fully opaque (frost lives on the curtain, not the panel)", () => {
  const l = resolveMode("light");
  const d = resolveMode("dark");
  // The panel animates height, so it carries no backdrop-filter; and it is
  // fully opaque so the dimmed curtain never bleeds through to grey it off the
  // header tone or leak page content. The header lifts to this same colour on
  // open, so any alpha here would break the one-continuous-surface look.
  assert.ok(!l.mega_menu_bg.includes("/"), `light opaque: ${l.mega_menu_bg}`);
  assert.ok(!d.mega_menu_bg.includes("/"), `dark opaque: ${d.mega_menu_bg}`);
});

test("light bg is the Gray canvas; surface stays pure white", () => {
  const light = resolveMode("light");
  assert.equal(light.bg, "oklch(0.967 0.003 264)");
  assert.equal(light.surface, "oklch(1 0 0)");
});

test("dark brand and progress colors match the mobile navigation design", () => {
  const dark = resolveMode("dark");

  assert.equal(dark.brand, "oklch(0.6 0.13 188.745)");
  assert.equal(dark.on_brand, "oklch(1 0 0)");
  // Derived from brand like light: end aliases brand, start mixes toward sunken.
  assert.equal(dark.progress_start, "oklch(44.78% 0.0865 193.2)");
  assert.equal(dark.progress_end, dark.brand);
});

test("dark differs from light", () => {
  assert.notEqual(
    resolveMode("light").surface_sunken,
    resolveMode("dark").surface_sunken,
  );
});
