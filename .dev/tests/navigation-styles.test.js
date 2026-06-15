import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const readStylesheet = (path) =>
  readFile(new URL(`../src/media/${path}`, import.meta.url), "utf8");

const [navigationStyles, layoutStyles, overlayStyles] = await Promise.all([
  readStylesheet("components/_nav.css"),
  readStylesheet("_layout.css"),
  readStylesheet("components/_overlay.css"),
]);

const getBlock = (source, selector) => {
  const selectorIndex = source.indexOf(selector);

  assert.notEqual(selectorIndex, -1, `Missing selector: ${selector}`);

  const blockStart = source.indexOf("{", selectorIndex);

  assert.notEqual(blockStart, -1, `Missing block for selector: ${selector}`);

  let depth = 1;

  for (let index = blockStart + 1; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;

    if (depth === 0) return source.slice(blockStart + 1, index);
  }

  assert.fail(`Unclosed block for selector: ${selector}`);
};

const assertIncludesUtilities = (block, utilities) => {
  for (const utility of utilities) {
    assert.match(
      block,
      new RegExp(
        `(^|\\s)${utility.replaceAll("[", "\\[").replaceAll("]", "\\]")}($|\\s|;)`,
      ),
    );
  }
};

test("shared navigation styles define active and expanded states", () => {
  const direct = getBlock(navigationStyles, ".navigation-direct");
  const directActive = getBlock(
    navigationStyles,
    ".navigation-direct.is-active-page",
  );
  const activeGroup = getBlock(
    navigationStyles,
    ".navigation-group.is-active-group > .navigation-group-toggle",
  );
  const expandedToggle = getBlock(
    navigationStyles,
    ".navigation-group.is-expanded > .navigation-group-toggle",
  );
  const activeSublink = getBlock(
    navigationStyles,
    ".navigation-sublink.is-active-page",
  );
  const sublink = getBlock(navigationStyles, ".navigation-sublink");

  assertIncludesUtilities(direct, ["text-text", "hover:text-text"]);
  assertIncludesUtilities(directActive, [
    "text-brand",
    "hover:text-brand",
    "font-medium",
  ]);
  assertIncludesUtilities(activeGroup, ["text-brand", "hover:text-brand"]);
  assertIncludesUtilities(expandedToggle, ["after:rotate-90"]);
  assertIncludesUtilities(sublink, ["font-medium"]);
  assertIncludesUtilities(activeSublink, [
    "text-brand",
    "hover:text-brand",
    "font-semibold",
    "before:bg-brand",
    "before:-left-4",
    "before:w-0.5",
  ]);

  for (const block of [directActive, activeGroup, activeSublink]) {
    assert.doesNotMatch(block, /bg-brand-subtle/);
  }
});

test("shared navigation styles own accordion animation and guide rail", () => {
  const toggle = getBlock(navigationStyles, ".navigation-group-toggle");
  const region = getBlock(navigationStyles, ".navigation-group-region");
  const expandedRegion = getBlock(
    navigationStyles,
    ".navigation-group.is-expanded > .navigation-group-region",
  );
  const submenu = getBlock(navigationStyles, ".navigation-submenu-list");
  const expandedSubmenu = getBlock(
    navigationStyles,
    ".navigation-group.is-expanded .navigation-submenu-list",
  );

  assertIncludesUtilities(toggle, [
    "after:transition-[transform,opacity]",
    "after:duration-[250ms]",
  ]);
  assert.match(toggle, /arrow-right\.svg/);
  assertIncludesUtilities(region, [
    "grid",
    "grid-rows-[0fr]",
    "opacity-0",
    "transition-[grid-template-rows,opacity]",
    "duration-[250ms]",
  ]);
  assertIncludesUtilities(expandedRegion, ["grid-rows-[1fr]", "opacity-100"]);
  assertIncludesUtilities(submenu, [
    "before:bg-hairline",
    "before:scale-y-0",
    "before:duration-[250ms]",
  ]);
  assertIncludesUtilities(expandedSubmenu, ["before:scale-y-100"]);
});

test("desktop sidebar styles only provide desktop navigation density", () => {
  const sidebar = getBlock(layoutStyles, 'body[data-nav-type="sidebar"]');
  const direct = getBlock(sidebar, "& .sidebar-list .navigation-direct");
  const submenu = getBlock(sidebar, "& .sidebar-submenu");
  const sublink = getBlock(sidebar, "& .sidebar-submenu .navigation-sublink");

  assertIncludesUtilities(direct, ["truncate", "text-lg"]);
  assertIncludesUtilities(submenu, ["pl-4"]);
  assertIncludesUtilities(sublink, ["px-3", "py-1.5", "text-sm"]);
  assert.doesNotMatch(
    sidebar,
    /sidebar-section|sidebar-group-open|nav-link-active|has-active/,
  );
  assert.doesNotMatch(sidebar, /bg-brand-subtle/);
});

test("mobile drawer styles only provide mobile navigation density", () => {
  const drawer = getBlock(overlayStyles, ".mobile-menu-overlay");
  const submenu = getBlock(drawer, "& .mobile-nav-submenu-list");
  const sublink = getBlock(drawer, "& .mobile-nav-sublink");

  assertIncludesUtilities(submenu, ["max-md:pl-4"]);
  assertIncludesUtilities(sublink, [
    "max-md:min-h-10",
    "max-md:py-2",
    "max-md:text-[0.9375rem]",
  ]);
  assert.doesNotMatch(sublink, /max-md:font-(?:normal|medium|semibold|bold)/);
  assert.doesNotMatch(
    drawer,
    /has-submenu|submenu-expanded|nav-link-active|has-active/,
  );
  assert.doesNotMatch(drawer, /bg-brand-subtle/);
});
