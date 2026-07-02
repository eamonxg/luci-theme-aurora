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
  const expandedToggle = getBlock(
    navigationStyles,
    ".navigation-group.is-expanded > .navigation-group-toggle",
  );
  const activeGroupToggle = getBlock(
    navigationStyles,
    ".navigation-group.is-active-group > .navigation-group-toggle",
  );
  const activeSublink = getBlock(
    navigationStyles,
    ".navigation-sublink.is-active-page",
  );
  const sublink = getBlock(navigationStyles, ".navigation-sublink");

  assertIncludesUtilities(direct, ["text-text", "hover:text-text"]);
  // Active page is a filled brand pill on both direct links and sublinks.
  assertIncludesUtilities(directActive, [
    "text-brand",
    "hover:text-brand",
    "font-medium",
    "bg-brand-subtle",
  ]);
  // An expanded group's label turns brand and rotates its arrow open.
  assertIncludesUtilities(expandedToggle, ["after:rotate-90", "text-brand"]);
  // The active group keeps a brand label even when manually collapsed, so the
  // current section stays marked while its pill is hidden — but it must not
  // rotate the arrow open in that collapsed state.
  assertIncludesUtilities(activeGroupToggle, ["text-brand"]);
  assert.doesNotMatch(activeGroupToggle, /after:rotate-90/);
  // The pill shape lives with the pill fill in the shared recipe, so the
  // hover/active background is rounded the same way on desktop and mobile.
  assertIncludesUtilities(sublink, [
    "font-medium",
    "hover:bg-hover-faint",
    "rounded-lg",
  ]);
  assertIncludesUtilities(activeSublink, [
    "text-brand",
    "hover:text-brand",
    "font-semibold",
    "bg-brand-subtle",
  ]);
  // The left accent bar is gone — no before:* rail on the active sublink.
  assert.doesNotMatch(activeSublink, /before:/);
});

test("shared navigation styles own accordion animation without a guide rail", () => {
  const toggle = getBlock(navigationStyles, ".navigation-group-toggle");
  const region = getBlock(navigationStyles, ".navigation-group-region");
  const expandedRegion = getBlock(
    navigationStyles,
    ".navigation-group.is-expanded > .navigation-group-region",
  );
  const submenu = getBlock(navigationStyles, ".navigation-submenu-list");

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
  // The vertical guide rail is removed: the submenu list carries no before:*
  // hairline anymore.
  assert.doesNotMatch(submenu, /before:bg-hairline/);
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
    "max-md:px-3",
    "max-md:py-2",
    "max-md:text-base",
  ]);
  assert.doesNotMatch(sublink, /max-md:font-(?:normal|medium|semibold|bold)/);
  assert.doesNotMatch(
    drawer,
    /has-submenu|submenu-expanded|nav-link-active|has-active/,
  );
  assert.doesNotMatch(drawer, /bg-brand-subtle/);
});

test("mega-menu panels scroll within the viewport", () => {
  const megaMenu = getBlock(layoutStyles, '[data-nav-type="mega-menu"] &');
  const panel = getBlock(megaMenu, "& .desktop-nav");

  assert.ok(panel.includes("max-h-[calc(100dvh-3.5rem)]"));
  assertIncludesUtilities(panel, ["overflow-y-auto", "overscroll-contain"]);
});

test("mega-menu reveal and retract share the page-top origin", () => {
  const megaMenu = getBlock(layoutStyles, '[data-nav-type="mega-menu"] &');
  const headerContent = getBlock(layoutStyles, "& .header-content");
  const container = getBlock(megaMenu, "& .desktop-menu-container");
  const sheet = getBlock(container, "& .desktop-menu-sheet");
  const canvas = getBlock(container, "& .desktop-menu-canvas");
  const panel = getBlock(megaMenu, "& .desktop-nav");
  const headerLift = layoutStyles.match(
    /The bar must sit above[\s\S]*?(\[data-nav-type="mega-menu"\][\s\S]*?)\n\s*\.brand/,
  )?.[1];

  assertIncludesUtilities(headerContent, ["z-10"]);
  assertIncludesUtilities(container, ["top-0", "z-0"]);
  assert.doesNotMatch(
    container,
    /@apply bg-mega-menu-bg pointer-events-none absolute inset-x-0 top-0 h-14/,
  );
  assert.match(
    container,
    /&\.active,\s*&\.closing\s*\{[\s\S]*@apply[^;]*\bvisible\b/,
  );
  assert.match(
    container,
    /&\.closing\s*\{[\s\S]*@apply[^;]*\bopacity-0\b[^;]*\btransition-opacity\b[^;]*\bduration-\[220ms\]/,
  );
  assert.match(
    container,
    /&\.active\s*\{[\s\S]*@apply[^;]*pointer-events-auto/,
  );
  assertIncludesUtilities(sheet, ["top-0", "-translate-y-full"]);
  assert.match(
    sheet,
    /h-\[calc\(var\(--mega-menu-height,0px\)\+3\.5rem\)\]/,
  );
  assertIncludesUtilities(canvas, ["translate-y-full"]);
  assertIncludesUtilities(panel, ["top-14"]);
  // z-70 must span the retract too (or the curtain dims the closing panel).
  assert.match(
    headerLift ?? "",
    /desktop-menu-container:is\(\.active, \.closing\)\)\s*\{\s*@apply[^;]*z-70/,
  );
  // The bar no longer performs its own background transition. The flyout sheet
  // owns the opened surface and retracts fully to page top before hiding.
  assert.doesNotMatch(headerLift ?? "", /bg-mega-menu-bg/);
});

test("mega-menu category masks use Tailwind arbitrary utilities", () => {
  const title = getBlock(layoutStyles, "& .desktop-nav-title");
  const icon = getBlock(title, "&::before");

  assert.match(
    icon,
    /@apply[^;]*\[mask:var\(--menu-icon,url\(["']@assets\/icons\/category\.svg["']\)\)_center\/contain_no-repeat\]/,
  );
  assert.doesNotMatch(layoutStyles, /^\s*mask\s*:/m);
});
