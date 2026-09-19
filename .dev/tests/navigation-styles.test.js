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
    "bg-brand-subtle",
  ]);
  // Weight is the surface's call — the two run different scales.
  assert.doesNotMatch(directActive, /font-(?:normal|medium|semibold|bold)/);
  // An expanded group's label turns brand and rotates its arrow open.
  assertIncludesUtilities(expandedToggle, ["text-brand"]);
  assertIncludesUtilities(getBlock(expandedToggle, "&::after"), ["rotate-90"]);
  // The active group keeps a brand label even when manually collapsed, so the
  // current section stays marked while its pill is hidden — but it must not
  // rotate the arrow open in that collapsed state.
  assertIncludesUtilities(activeGroupToggle, ["text-brand"]);
  assert.doesNotMatch(activeGroupToggle, /rotate-90/);
  // The pill shape lives with the pill fill in the shared recipe, so the
  // hover/active background is rounded the same way on desktop and mobile.
  assertIncludesUtilities(sublink, [
    "font-medium",
    "hover:bg-hover-faint",
    "rounded-xl",
  ]);
  assertIncludesUtilities(activeSublink, [
    "text-brand",
    "hover:text-brand",
    "font-semibold",
    "bg-brand-subtle",
  ]);
  // The left accent bar is gone — no ::before rail on the active sublink.
  assert.doesNotMatch(activeSublink, /before/);
});

test("one first-level row recipe serves both kinds on both surfaces", () => {
  const row = getBlock(navigationStyles, ".nav-row");

  // Defined once, so a group toggle and a direct destination cannot come
  // out with different frames (#97).
  assertIncludesUtilities(row, [
    "flex",
    "w-full",
    "items-center",
    "appearance-none",
    "border-0",
    "bg-transparent",
    "shadow-none",
    "no-underline",
  ]);
  // Mode files consume it; no per-kind or per-surface box class survives.
  assert.match(layoutStyles, /& \.sidebar-list \.nav-row \{/);
  assert.match(overlayStyles, /& \.nav-row \{/);
  assert.doesNotMatch(overlayStyles, /mobile-nav-link/);
  assert.doesNotMatch(navigationStyles, /nav-category \{/);

  // :where() keeps the resting treatment at (0,1,0), below every state.
  const sidebarResting = getBlock(navigationStyles, ":where(.sidebar-list)");

  assertIncludesUtilities(getBlock(sidebarResting, "& .nav-row"), [
    "text-text-muted",
    "hover:text-text",
  ]);
  assertIncludesUtilities(getBlock(sidebarResting, "& .navigation-direct"), [
    "hover:bg-hover-faint",
  ]);
});

test("the drawer collapses a group to nothing so the row rhythm is declared", () => {
  const drawer = getBlock(overlayStyles, ".mobile-menu-overlay");
  const list = getBlock(drawer, "& .mobile-nav-list");
  const submenu = getBlock(drawer, "& .mobile-nav-submenu-list");

  // The rhythm is the list's own gap, not a collapsed group's leftover box.
  assertIncludesUtilities(list, ["max-md:gap-y-4"]);
  // Full-bleed square rows must keep suppressing the shared selected fill.
  assertIncludesUtilities(getBlock(drawer, "& .nav-row"), [
    "max-md:bg-transparent",
  ]);
  // Direct child of the 0fr track: its own box outlives the collapse.
  assertIncludesUtilities(submenu, ["max-md:m-0", "max-md:p-0"]);
  assert.doesNotMatch(submenu, /max-md:(?:mb-|py-|mt-|mx-|pt-|pb-)/);
});

test("shared navigation styles own accordion animation without a guide rail", () => {
  const toggle = getBlock(navigationStyles, ".navigation-group-toggle");
  const region = getBlock(navigationStyles, ".navigation-group-region");
  const expandedRegion = getBlock(
    navigationStyles,
    ".navigation-group.is-expanded > .navigation-group-region",
  );
  const submenu = getBlock(navigationStyles, ".navigation-submenu-list");

  assertIncludesUtilities(getBlock(toggle, "&::after"), [
    "transition-[transform,opacity]",
    "duration-[250ms]",
  ]);
  assert.match(toggle, /var\(--icon-arrow-right\)/);
  assertIncludesUtilities(region, [
    "grid",
    "grid-rows-[0fr]",
    "opacity-0",
    "transition-[grid-template-rows,opacity]",
    "duration-[250ms]",
  ]);
  assertIncludesUtilities(expandedRegion, ["grid-rows-[1fr]", "opacity-100"]);
  // The vertical guide rail is removed: the submenu list carries no ::before
  // hairline anymore.
  assert.doesNotMatch(submenu, /before/);
});

test("desktop sidebar styles only provide desktop navigation density", () => {
  const sidebar = getBlock(layoutStyles, 'body[data-nav-type="sidebar"]');
  const row = getBlock(sidebar, "& .sidebar-list .nav-row");
  const icon = getBlock(sidebar, "& .sidebar-list .nav-icon");
  const submenu = getBlock(sidebar, "& .sidebar-submenu");
  const sublink = getBlock(sidebar, "& .sidebar-submenu .navigation-sublink");

  // Density for both first-level kinds at once.
  assertIncludesUtilities(row, [
    "gap-2",
    "px-3",
    "py-2",
    "text-lg",
    "font-semibold",
    "tracking-wide",
  ]);
  // The frame is the shared recipe's; the mode file must not restate it.
  assert.doesNotMatch(row, /(^|\s)(?:flex|items-center|w-full)($|\s|;)/);
  // Nor colour: nesting under body[data-nav-type] would outrank the states.
  assert.doesNotMatch(row, /text-text|text-brand|bg-/);
  assertIncludesUtilities(icon, ["size-4.5"]);
  // pl-6.5 hangs sublink text off the parent label (px-3 + icon + gap −
  // the sublink's own px-3), not the row edge.
  assertIncludesUtilities(submenu, ["pl-6.5"]);
  assertIncludesUtilities(sublink, ["px-3", "py-1.5", "text-sm"]);
  assert.doesNotMatch(
    sidebar,
    /sidebar-section|sidebar-group-open|nav-link-active|has-active/,
  );
  assert.doesNotMatch(sidebar, /bg-brand-subtle/);
});

test("desktop sidebar toggles move the column and the panel as one", () => {
  const sidebar = getBlock(layoutStyles, 'body[data-nav-type="sidebar"]');
  const easing = "250ms_var(--ease-in-out)";

  // The column width and the panel's translate share one curve and length,
  // so the content edge stays on the sidebar edge in every frame.
  assert.ok(
    sidebar.includes(`md:[transition:grid-template-columns_${easing}]`),
  );
  assert.ok(
    getBlock(sidebar, "& .sidebar-panel-inner {").includes(
      `[transition:translate_${easing}]`,
    ),
  );
  // Hidden only after the slide-out, shown at once on the way in.
  assertIncludesUtilities(
    getBlock(sidebar, "&.sidebar-collapsed .sidebar-panel {"),
    ["invisible", "[transition:visibility_0s_250ms]"],
  );
  assert.doesNotMatch(layoutStyles, /sidebar-anim|sidebar-run-/);
});

test("mobile drawer styles only provide mobile navigation density", () => {
  const drawer = getBlock(overlayStyles, ".mobile-menu-overlay");
  const icon = getBlock(drawer, "& .nav-icon");
  const submenu = getBlock(drawer, "& .mobile-nav-submenu-list");
  const sublink = getBlock(drawer, "& .mobile-nav-sublink");

  // Row icons at drawer scale, against the text-2xl labels.
  assertIncludesUtilities(icon, ["max-md:size-6"]);
  // pl-6 hangs sublink text off the parent label (rows are px-0: icon +
  // gap − the sublink's own px-3).
  assertIncludesUtilities(submenu, ["max-md:pl-6"]);
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

test("theme flips repaint the bar in the same frame as the page", () => {
  const headerDeclaration = layoutStyles.match(
    /^header \{\s*@apply ([^;]+);/m,
  )?.[1];

  assert.ok(headerDeclaration, "Missing header root declaration");
  assertIncludesUtilities(headerDeclaration, ["bg-bg", "sticky"]);
  // A colour transition on the bar itself would ease its bg/text over
  // --mega-menu-duration on every data-darkmode flip, lagging the bar behind
  // the untransitioned page in all three nav modes. The mega-menu wipe colour
  // lives on .desktop-menu-sheet, which carries its own transition.
  assert.doesNotMatch(headerDeclaration, /\btransition/);
});

test("mega-menu category masks use Tailwind arbitrary utilities", () => {
  const title = getBlock(layoutStyles, "& .desktop-nav-title");
  const icon = getBlock(title, "&::before");

  assert.match(
    icon,
    /@apply[^;]*\[mask:var\(--menu-icon,var\(--icon-category\)\)_center\/contain_no-repeat\]/,
  );
  // The default lives in the var() fallback only. Declaring --menu-icon on
  // the title compiles into a (0,5,1) selector chain that outranks every
  // .desktop-nav-title[data-section=…] (0,2,0) mapping in _nav.css.
  assert.doesNotMatch(title, /--menu-icon:/);
  assert.doesNotMatch(layoutStyles, /^\s*mask\s*:/m);
});
