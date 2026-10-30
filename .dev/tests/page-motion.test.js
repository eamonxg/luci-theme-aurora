import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const css = readFileSync(resolve(root, "htdocs/luci-static/aurora/main.css"), "utf8");
const header = readFileSync(resolve(root, "ucode/template/themes/aurora/header.ut"), "utf8");

test("only the typed theme toggle captures the page in a view transition", () => {
  assert.match(header, /ViewTransitionTypeSet \? \{ update: apply, types: \['theme'\] \} : apply/);
  // Standalone rule: merged into a selector list, an engine without
  // :active-view-transition-type() would drop its neighbours too.
  assert.match(css, /\}:root:not\(:active-view-transition-type\(theme\)\)\{view-transition-name:none\}/);
});

test("page content appears without decorative entry fades", () => {
  assert.ok(!css.includes("aurora-fade-in"), "decorative entry keyframe remains");
  assert.ok(!/#view>:not\(\.spinning\)[^{]*\{[^}]*\banimation:/.test(css), "view contents still animate on entry");
});

test("a collapsed sidebar is restored before anything resolves body's style", () => {
  // The sidebar column transitions; a class landing after a style flush
  // (the page-bg script's getComputedStyle) would ease it shut on load.
  const restore = header.indexOf("aurora.sidebarCollapsed");
  assert.ok(restore > header.indexOf("<body"), "restore runs inside body");
  assert.ok(
    restore < header.indexOf("getComputedStyle"),
    "restore precedes the page-bg style read",
  );
  assert.ok(
    restore < header.indexOf("<header>"),
    "restore precedes the header markup",
  );
});
