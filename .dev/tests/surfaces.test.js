import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Color from "colorjs.io";
import { resolveMode } from "@eamonxg/aurora-tokens";

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

test("light bg, sunken and overlay share one hue family (~235)", () => {
  const l = resolveMode("light");
  for (const k of ["bg", "surface_sunken", "surface_overlay"]) {
    assert.ok(nearHue(l[k], 235), `${k} hue off: ${l[k]}`);
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

test("mega-menu reveal is compositor-only and the frost never overlaps it", () => {
  const layout = read("../src/media/_layout.css");
  const overlay = read("../src/media/components/_overlay.css");
  // The sheet is the moving surface, so it must carry NO backdrop-filter —
  // blurring an animating box re-rasterises every frame (the old clip-path
  // flicker) — and must animate translate, not height: a height transition
  // pays main-thread layout + repaint per frame (the low-end hover jank).
  const sheet =
    layout.match(/& \.desktop-menu-sheet\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  assert.ok(!sheet?.includes("backdrop-blur"), `sheet must not blur: ${sheet}`);
  assert.ok(
    !layout.includes(
      "@apply bg-mega-menu-bg pointer-events-none absolute inset-x-0 top-0 h-14",
    ),
    "header band must not be static",
  );
  // Apple-style geometry: the sheet is the whole opened surface, including the
  // header-height band. Its closed bottom edge is page top, matching the
  // reveal origin.
  assert.ok(
    sheet?.includes("transition-[translate]") &&
      sheet?.includes("top-0") &&
      sheet?.includes("h-[calc(var(--mega-menu-height,0px)+3.5rem)]") &&
      sheet?.includes("-translate-y-full"),
    `sheet must move from and to page top: ${sheet}`,
  );
  const containerRule =
    layout.match(/& \.desktop-menu-container\s*\{\s*@apply\s+([^;]+);/)?.[1] ??
    "";
  assert.ok(
    !containerRule.includes("transition") &&
      !containerRule.includes("will-change"),
    `container is a static frame, it must not animate: ${containerRule}`,
  );
  // A translated sheet moves inside a static clip frame rooted at the page top.
  // The container adds shadow slack below the travel but does not move itself.
  assert.ok(
    containerRule.includes("top-0") &&
      containerRule.includes("h-[calc(var(--mega-menu-height,0px)+3.5rem+3rem)]") &&
      containerRule.includes("overflow-clip"),
    `container must clip the page-top retract: ${containerRule}`,
  );
  assert.match(
    layout,
    /&\.closing\s*\{[\s\S]*?@apply[^;]*opacity-0[^;]*transition-opacity[^;]*duration-\[220ms\]/,
  );
  // The counter-transformed canvas must mirror the sheet's endpoints and
  // timing exactly or the content drifts during the wipe; both take the
  // distance-adaptive duration from the same variable.
  const canvasRule =
    layout.match(/& \.desktop-menu-canvas\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  for (const token of [
    "transition-[translate]",
    "duration-(--mega-menu-duration,300ms)",
    "translate-y-full",
  ]) {
    assert.ok(canvasRule.includes(token), `canvas missing ${token}: ${canvasRule}`);
  }
  assert.ok(
    sheet?.includes("duration-(--mega-menu-duration,300ms)"),
    `sheet must share the adaptive duration: ${sheet}`,
  );
  // The curtain carries the blur permanently (Apple's globalnav-curtain) and
  // fades it with opacity/visibility. Close must start that fade immediately;
  // delaying the curtain left blur visible after the sheet had collapsed.
  assert.ok(overlay.includes("max-md:backdrop-blur-lg"), "mobile overlay blur");
  const curtain = overlay
    .split("\n")
    .find((l) => l.includes("bg-mega-menu-scrim"));
  assert.ok(
    curtain?.includes("backdrop-blur-lg"),
    `desktop curtain blur: ${curtain}`,
  );
  assert.ok(
    curtain?.includes("duration-[220ms]") && !curtain.includes("delay-"),
    `desktop curtain exit must be immediate: ${curtain}`,
  );
  assert.ok(!overlay.includes(".settled"), "settle-gated frost must stay gone");
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
  const thRules = [...t.matchAll(/&\s*th,\s*&\s*\.th\s*\{\s*@apply\s+([^;]+);/g)].map((m) => m[1]);
  const th = thRules.find((rule) => rule.includes("bg-surface-sunken")) ?? "";
  assert.ok(th, `header not sunken: ${thRules.join(" | ")}`);
  // Top corners round only on the table's first row; a second header row
  // (e.g. .cbi-section-table-descr) must stay square.
  assert.ok(!th.includes("rounded-t"), `generic header cells carry corner radius: ${th}`);
  const firstRow =
    t.match(/&:first-child\s*\{\s*&\s*th,\s*&\s*\.th\s*\{\s*@apply\s+([^;]+);/)?.[1] ?? "";
  assert.ok(
    firstRow.includes("first:rounded-tl-2xl") && firstRow.includes("last:rounded-tr-2xl"),
    `first-row corner radius missing: ${firstRow}`,
  );
});
