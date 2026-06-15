import { test } from "node:test";
import assert from "node:assert/strict";
import Color from "colorjs.io";
import { mix, shade, set, alpha, konst, toOklch } from "../tokens/engine.js";

const l = (v) => new Color(toOklch(v)).to("oklch").coords[0];
const aOf = (v) => {
  const c = new Color(toOklch(v));
  return c.alpha;
};

test("mix: 50% white + black ≈ mid gray", () => {
  const L = l(mix("white", "black", 0.5));
  assert.ok(L > 0.4 && L < 0.6, `L=${L}`);
});

test("shade: lowers lightness by delta", () => {
  const L = l(shade("oklch(0.5 0.1 200)", -0.1));
  assert.ok(Math.abs(L - 0.4) < 0.02, `L=${L}`);
});

test("set: fixes L and C, keeps hue", () => {
  const c = new Color(
    toOklch(set("oklch(0.5 0.1 200)", 0.9, 0.05)),
  ).to("oklch");
  assert.ok(Math.abs(c.coords[0] - 0.9) < 0.001);
  assert.ok(Math.abs(c.coords[1] - 0.05) < 0.001);
  assert.ok(Math.abs(c.coords[2] - 200) < 0.5);
});

test("alpha: sets opacity", () => {
  assert.ok(
    Math.abs(aOf(alpha("oklch(0.6 0.1 200)", 0.5)) - 0.5) < 0.001,
  );
});

test("toOklch: serializes without color-mix/var", () => {
  const s = toOklch(mix("oklch(0.68 0.11 233)", "white", 0.15));
  assert.ok(s.startsWith("oklch("));
  assert.ok(!s.includes("color-mix") && !s.includes("var("));
});
