import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Color from "colorjs.io";
import { resolveMode } from "../tokens/resolve.js";

// [L, C, H] in oklch; alpha separate.
const lch = (s) => {
  const c = new Color(s).to("oklch");
  return { L: c.coords[0], C: c.coords[1], H: c.coords[2] || 0, a: c.alpha };
};
const nearHue = (s, h, tol = 8) => {
  const H = lch(s).H;
  const d = Math.abs(((H - h + 540) % 360) - 180);
  return d <= tol;
};
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("light low-emphasis surfaces carry the Gray tint (chroma > 0)", () => {
  const l = resolveMode("light");
  assert.ok(lch(l.surface_sunken).C > 0.001, `sunken flat: ${l.surface_sunken}`);
  assert.ok(lch(l.surface_overlay).C > 0.001, `overlay flat: ${l.surface_overlay}`);
});

test("light bg, sunken and overlay share one hue family (~264)", () => {
  const l = resolveMode("light");
  for (const k of ["bg", "surface_sunken", "surface_overlay"]) {
    assert.ok(nearHue(l[k], 264), `${k} hue off: ${l[k]}`);
  }
});

test("light sunken is darker than bg, overlay is lighter (toward white)", () => {
  const l = resolveMode("light");
  assert.ok(lch(l.surface_sunken).L < lch(l.bg).L, "sunken not below bg");
  assert.ok(lch(l.surface_overlay).L > lch(l.bg).L, "overlay not above bg");
});

test("dark surfaces are the Gray family (~264), not zinc (286)", () => {
  const d = resolveMode("dark");
  for (const k of ["bg", "surface", "surface_sunken", "text_muted"]) {
    assert.ok(nearHue(d[k], 264, 10), `${k} hue off: ${d[k]}`);
  }
});

test("dark layering: page < card, sunken between page and card", () => {
  const d = resolveMode("dark");
  const bg = lch(d.bg).L, surf = lch(d.surface).L, sunk = lch(d.surface_sunken).L;
  assert.ok(bg < surf, "page not darker than card");
  assert.ok(sunk >= bg && sunk < surf, `sunken not between page and card: ${d.surface_sunken}`);
});

test("mega-menu frost lives on the curtain, not the height-animating panel", () => {
  const layout = read("../src/media/_layout.css");
  const overlay = read("../src/media/components/_overlay.css");
  // The panel animates geometry (height) for the drawer open/close, so it must
  // carry NO backdrop-filter — blurring a resizing box re-rasterises every
  // frame (the old clip-path flicker). The frost moved entirely to the curtain.
  const panel = layout.split("\n").find((l) => l.includes("bg-mega-menu-bg"));
  assert.ok(!panel?.includes("backdrop-blur"), `panel must not blur: ${panel}`);
  assert.ok(
    panel?.includes("transition-[height,visibility]"),
    `panel animates height: ${panel}`,
  );
  // The curtain carries the blur permanently (Apple's globalnav-curtain) and
  // fades it with opacity/visibility, never snapping it on/off via .active.
  assert.ok(overlay.includes("max-md:backdrop-blur-lg"), "mobile overlay blur");
  const curtain = overlay
    .split("\n")
    .find((l) => l.includes("bg-mega-menu-scrim"));
  assert.ok(curtain?.includes("backdrop-blur-lg"), `desktop curtain blur: ${curtain}`);
});

test("maincontent cards use a hairline border, not heavy shadow", () => {
  const card = read("../src/media/components/_card.css");
  const rule = card.match(/#maincontent &\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";
  assert.ok(rule.includes("border-hairline"), `no hairline: ${rule}`);
  assert.ok(rule.includes("border"), `no border: ${rule}`);
  assert.ok(!rule.includes("shadow-lg"), `still shadow-lg: ${rule}`);
});

test("main view does not create an animation stacking context", () => {
  const layout = read("../src/media/_layout.css");
  const rule = layout.match(/#view\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";

  for (const utility of [
    "animate-in",
    "fade-in-0",
    "slide-in-from-top-2",
    "fill-mode-backwards",
    "fill-mode-both",
  ]) {
    assert.ok(!rule.includes(utility), `view still uses ${utility}: ${rule}`);
  }
});

test("content dropdowns stay above the closed header and below the open mega-menu", () => {
  const layer = (value) => ["z", value].join("-");
  const layout = read("../src/media/_layout.css");
  const dropdown = read("../src/media/components/_dropdown.css");
  const message = read("../src/media/components/_message.css");
  const overlay = read("../src/media/components/_overlay.css");
  const headerRule = layout.match(/^header\s*\{\s*@apply\s+([^;]+);/m)?.[1] ?? "";
  const activeHeaderRule =
    layout.match(
      /\[data-nav-type="mega-menu"\]\s*&:has\([\s\S]*?\.desktop-menu-container[\s\S]*?\.active[\s\S]*?\)\s*\{\s*@apply\s+([^;]+);/,
    )?.[1] ?? "";
  const dropdownRule = dropdown.match(/&\.dropdown\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";
  const messageRule = message.match(/\.alert-message\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";
  const overlayRule =
    overlay.match(/& \.desktop-menu-overlay\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";

  assert.ok(messageRule.includes(layer(30)), `message layer changed: ${messageRule}`);
  assert.ok(headerRule.includes(layer(40)), `closed header layer changed: ${headerRule}`);
  assert.ok(dropdownRule.includes(layer(50)), `dropdown layer changed: ${dropdownRule}`);
  assert.ok(overlayRule.includes(layer(60)), `menu overlay layer changed: ${overlayRule}`);
  assert.ok(
    activeHeaderRule.includes(layer(70)),
    `open mega-menu layer changed: ${activeHeaderRule}`,
  );
});

test("tables get a hairline frame + sunken header, body stays unclipped", () => {
  const t = read("../src/media/components/_table.css");
  const root = t.match(/table\.table,\s*\.table\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";
  assert.ok(root.includes("border-hairline") && root.includes("border"), `no frame: ${root}`);
  assert.ok(root.includes("rounded-2xl"), `no radius: ${root}`);
  // Dropdowns inside cells must not be clipped: no global overflow-hidden on the table.
  assert.ok(!root.includes("overflow-hidden"), `body clipped: ${root}`);
  assert.ok(root.includes("overflow-visible"), `not overflow-visible: ${root}`);
  // Header carries the sunken surface.
  const th = t.match(/&\s*th,\s*&\s*\.th\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";
  assert.ok(th.includes("bg-surface-sunken"), `header not sunken: ${th}`);
});
