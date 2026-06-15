# Unified Sidebar Navigation States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Aurora's desktop sidebar and mobile drawer use one menu model, one accordion state contract, and the same active group/page visual language.

**Architecture:** Normalize the active LuCI menu branch once in `menu-aurora.js`, then render separate desktop and mobile DOM containers from that shared description. Add common structural/state classes and one surface-scoped accordion controller; keep only device sizing and layout overrides in `_layout.css` and `_overlay.css`.

**Tech Stack:** LuCI `E()` DOM API, JavaScript, Node.js `node:test`, TailwindCSS v4 with CSS nesting, Vite, pnpm

---

## File Structure

- `.dev/src/resource/menu-aurora.js`
  - Owns menu normalization, shared DOM construction, active-route state,
    accordion state updates, and mobile drawer lifecycle.
- `.dev/src/media/components/_nav.css`
  - Owns mode-independent navigation states, hierarchy line, active-page
    accent, chevron state, and accordion motion.
- `.dev/src/media/_layout.css`
  - Owns desktop sidebar dimensions, density, spacing, scrolling, and footer.
- `.dev/src/media/components/_overlay.css`
  - Owns mobile overlay layout, typography, touch targets, scrolling, and
    footer.
- `.dev/tests/navigation-model.test.js`
  - Exercises normalized menu data and shared accordion state behavior.
- `.dev/tests/navigation-rendering.test.js`
  - Enforces shared renderer semantics and removal of legacy split state.
- `.dev/tests/navigation-styles.test.js`
  - Enforces shared visual ownership and removal of device-specific active
    treatments.
- `.dev/package.json`
  - Includes navigation tests in the existing `pnpm test` command.
- `htdocs/luci-static/resources/menu-aurora.js`
  - Generated minified JavaScript.
- `htdocs/luci-static/aurora/main.css`
  - Generated minified CSS.

### Task 1: Normalize The Menu Once

**Files:**

- Create: `.dev/tests/navigation-model.test.js`
- Modify: `.dev/package.json:5-11`
- Modify: `.dev/src/resource/menu-aurora.js:372-378`

- [ ] **Step 1: Include navigation tests in the project test command**

Change `.dev/package.json`:

```json
"test": "node --test tokens/*.test.js tests/*.test.js"
```

- [ ] **Step 2: Write the failing menu-model test**

Create `.dev/tests/navigation-model.test.js`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/resource/menu-aurora.js", import.meta.url),
  "utf8",
);

function loadMenuModule(dispatchpath = ["admin", "network", "interfaces"]) {
  const factory = new Function(
    "baseclass",
    "ui",
    "E",
    "L",
    "_",
    "document",
    "window",
    "localStorage",
    source,
  );
  const ui = {
    changes: {},
    menu: {
      getChildren(node) {
        return Array.isArray(node?.children) ? node.children : [];
      },
    },
  };
  const L = {
    env: { dispatchpath, requestpath: [] },
    url: (...parts) => `/${parts.join("/")}`,
  };

  return factory(
    { extend: (definition) => definition },
    ui,
    () => null,
    L,
    (value) => value,
    {},
    {},
    {},
  );
}

test("buildNavigationModel normalizes active groups and pages", () => {
  const menu = loadMenuModule();
  const model = menu.buildNavigationModel(
    [
      {
        name: "network",
        title: "Network",
        children: [
          { name: "interfaces", title: "Interfaces" },
          { name: "wireless", title: "Wireless" },
        ],
      },
      { name: "status", title: "Status" },
      { name: "logout", title: "Logout" },
      { title: "Missing name" },
    ],
    "admin",
  );

  assert.equal(model.length, 3);
  assert.deepEqual(
    model.map((item) => ({
      name: item.name,
      href: item.href,
      hasChildren: item.hasChildren,
      isLogout: item.isLogout,
      isActiveGroup: item.isActiveGroup,
      isActivePage: item.isActivePage,
    })),
    [
      {
        name: "network",
        href: "/admin/network",
        hasChildren: true,
        isLogout: false,
        isActiveGroup: true,
        isActivePage: false,
      },
      {
        name: "status",
        href: "/admin/status",
        hasChildren: false,
        isLogout: false,
        isActiveGroup: false,
        isActivePage: false,
      },
      {
        name: "logout",
        href: "/admin/logout",
        hasChildren: false,
        isLogout: true,
        isActiveGroup: false,
        isActivePage: false,
      },
    ],
  );
  assert.equal(model[0].activePage, model[0].pages[0]);
  assert.deepEqual(model[0].pages[0], {
    name: "interfaces",
    title: "Interfaces",
    href: "/admin/network/interfaces",
    isActivePage: true,
  });
});

test("a current direct destination is an active page, not an active group", () => {
  const menu = loadMenuModule(["admin", "status"]);
  const [item] = menu.buildNavigationModel(
    [{ name: "status", title: "Status" }],
    "admin",
  );

  assert.equal(item.isActiveGroup, false);
  assert.equal(item.isActivePage, true);
  assert.equal(item.activePage, null);
});

test("an empty menu produces an empty navigation model", () => {
  const menu = loadMenuModule();

  assert.deepEqual(menu.buildNavigationModel([], "admin"), []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
cd .dev
pnpm test
```

Expected: FAIL with
`TypeError: menu.buildNavigationModel is not a function`.

- [ ] **Step 4: Add the normalized menu builder**

Add this method immediately after `isActivePath()` in
`.dev/src/resource/menu-aurora.js`:

```js
buildNavigationModel(children, url) {
  return children
    .filter((child) => child?.name)
    .map((child) => {
      const pages = ui.menu
        .getChildren(child)
        .filter((page) => page?.name)
        .map((page) => ({
          name: page.name,
          title: _(page.title),
          href: L.url(url, child.name, page.name),
          isActivePage: this.isActivePath(child.name, page.name),
        }));
      const hasChildren = pages.length > 0;
      const isCurrentTopLevel = this.isActivePath(child.name);

      return {
        name: child.name,
        title: _(child.title),
        href: L.url(url, child.name),
        hasChildren,
        isLogout: child.name === "logout",
        isActiveGroup: hasChildren && isCurrentTopLevel,
        isActivePage: !hasChildren && isCurrentTopLevel,
        activePage: pages.find((page) => page.isActivePage) || null,
        pages,
      };
    });
},
```

- [ ] **Step 5: Run the model tests**

Run:

```bash
cd .dev
pnpm test
```

Expected: all token tests and all three navigation-model tests PASS.

- [ ] **Step 6: Commit the menu model**

```bash
git add .dev/package.json .dev/tests/navigation-model.test.js \
  .dev/src/resource/menu-aurora.js
git commit -m "refactor: normalize sidebar navigation data"
```

### Task 2: Introduce One Accordion State Controller

**Files:**

- Modify: `.dev/tests/navigation-model.test.js`
- Modify: `.dev/src/resource/menu-aurora.js:380-405`

- [ ] **Step 1: Append the failing accordion behavior tests**

Append to `.dev/tests/navigation-model.test.js`:

```js
function createClassList(initial = []) {
  const values = new Set(initial);

  return {
    contains: (name) => values.has(name),
    toggle(name, force) {
      if (force) values.add(name);
      else values.delete(name);
    },
  };
}

function createGroup(initial = []) {
  const attributes = { toggle: {}, region: {} };
  const region = {
    setAttribute(name, value) {
      attributes.region[name] = value;
    },
    removeAttribute(name) {
      delete attributes.region[name];
    },
  };
  const toggle = {
    setAttribute(name, value) {
      attributes.toggle[name] = value;
    },
  };
  const group = {
    classList: createClassList(["navigation-group", ...initial]),
    querySelector(selector) {
      if (selector === ".navigation-group-toggle") return toggle;
      if (selector === ".navigation-group-region") return region;
      return null;
    },
  };

  return { attributes, group };
}

function createSurface(groups) {
  return {
    querySelector(selector) {
      if (selector === ".navigation-group.is-active-group") {
        return (
          groups.find((group) => group.classList.contains("is-active-group")) ||
          null
        );
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".navigation-group.is-expanded") {
        return groups.filter((group) =>
          group.classList.contains("is-expanded"),
        );
      }
      return [];
    },
  };
}

test("setNavigationGroupExpanded synchronizes class and accessibility state", () => {
  const menu = loadMenuModule();
  const { attributes, group } = createGroup(["is-active-group"]);

  menu.setNavigationGroupExpanded(group, true);
  assert.equal(group.classList.contains("is-expanded"), true);
  assert.equal(attributes.toggle["aria-expanded"], "true");
  assert.equal(attributes.region["aria-hidden"], "false");
  assert.equal("inert" in attributes.region, false);

  menu.setNavigationGroupExpanded(group, false);
  assert.equal(group.classList.contains("is-expanded"), false);
  assert.equal(group.classList.contains("is-active-group"), true);
  assert.equal(attributes.toggle["aria-expanded"], "false");
  assert.equal(attributes.region["aria-hidden"], "true");
  assert.equal(attributes.region.inert, "");
});

test("setExclusiveNavigationGroupExpanded keeps at most one group open", () => {
  const menu = loadMenuModule();
  const first = createGroup(["is-expanded"]).group;
  const second = createGroup().group;
  const surface = createSurface([first, second]);

  menu.setExclusiveNavigationGroupExpanded(surface, second, true);

  assert.equal(first.classList.contains("is-expanded"), false);
  assert.equal(second.classList.contains("is-expanded"), true);
});

test("expandActiveNavigationGroup reopens the route-derived group", () => {
  const menu = loadMenuModule();
  const active = createGroup(["is-active-group"]).group;
  const surface = createSurface([active]);

  menu.expandActiveNavigationGroup(surface);

  assert.equal(active.classList.contains("is-expanded"), true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd .dev
pnpm test
```

Expected: FAIL with
`TypeError: menu.setNavigationGroupExpanded is not a function`.

- [ ] **Step 3: Add the shared expansion helpers beside the current helpers**

Keep `setMobileSubmenuExpanded()` and `setSidebarSectionExpanded()` until
Task 3 switches both renderers in one working commit. Add:

```js
setNavigationGroupExpanded(item, expanded) {
  const toggle = item.querySelector(".navigation-group-toggle");
  const region = item.querySelector(".navigation-group-region");

  item.classList.toggle("is-expanded", expanded);
  toggle?.setAttribute("aria-expanded", expanded ? "true" : "false");
  region?.setAttribute("aria-hidden", expanded ? "false" : "true");

  if (expanded) region?.removeAttribute("inert");
  else region?.setAttribute("inert", "");
},

setExclusiveNavigationGroupExpanded(surface, item, expanded) {
  if (!surface || !item) return;

  if (expanded) {
    surface
      .querySelectorAll(".navigation-group.is-expanded")
      .forEach((expandedItem) => {
        if (expandedItem !== item) {
          this.setNavigationGroupExpanded(expandedItem, false);
        }
      });
  }

  this.setNavigationGroupExpanded(item, expanded);
},

resetNavigationGroups(surface) {
  surface
    ?.querySelectorAll(".navigation-group.is-expanded")
    .forEach((item) => this.setNavigationGroupExpanded(item, false));
},

expandActiveNavigationGroup(surface) {
  const activeGroup = surface?.querySelector(
    ".navigation-group.is-active-group",
  );

  if (activeGroup) {
    this.setExclusiveNavigationGroupExpanded(surface, activeGroup, true);
  }
},

bindNavigationAccordion(surface) {
  if (!surface || surface.dataset.accordionBound === "true") return;

  surface.dataset.accordionBound = "true";
  surface.addEventListener("click", (event) => {
    const toggle = event.target.closest(".navigation-group-toggle");
    const item = toggle?.closest(".navigation-group");

    if (!item || !surface.contains(item)) return;

    event.preventDefault();
    event.stopPropagation();
    this.setExclusiveNavigationGroupExpanded(
      surface,
      item,
      !item.classList.contains("is-expanded"),
    );
  });
},
```

- [ ] **Step 4: Run the accordion tests**

Run:

```bash
cd .dev
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the shared accordion controller**

```bash
git add .dev/tests/navigation-model.test.js \
  .dev/src/resource/menu-aurora.js
git commit -m "refactor: share navigation accordion state"
```

### Task 3: Render Desktop And Mobile From The Shared Model

**Files:**

- Create: `.dev/tests/navigation-rendering.test.js`
- Modify: `.dev/src/resource/menu-aurora.js:24-286`
- Modify: `.dev/src/resource/menu-aurora.js:339-525`
- Modify: `.dev/src/resource/menu-aurora.js:752-772`

- [ ] **Step 1: Write the failing rendering contract test**

Create `.dev/tests/navigation-rendering.test.js`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/resource/menu-aurora.js", import.meta.url),
  "utf8",
);

test("desktop and mobile use the shared navigation renderer and states", () => {
  for (const token of [
    "renderNavigationItem(item, mode)",
    "buildNavigationModel",
    '"navigation-group"',
    '"navigation-group-toggle"',
    '"navigation-group-region"',
    '"navigation-submenu-list"',
    '"navigation-sublink"',
    '"is-active-group"',
    '"is-expanded"',
    '"is-active-page"',
    '"aria-current"',
    "bindNavigationAccordion(list)",
  ]) {
    assert.ok(source.includes(token), `missing ${token}`);
  }
});

test("legacy device-specific state classes and helpers are removed", () => {
  for (const token of [
    "setMobileSubmenuExpanded",
    "setSidebarSectionExpanded",
    "submenu-expanded",
    "sidebar-group-open",
    "has-active",
  ]) {
    assert.equal(
      source.includes(token),
      false,
      `legacy token remains: ${token}`,
    );
  }
});

test("the active menu branch is normalized once before both renderers", () => {
  const modelBuilds = source.match(/buildNavigationModel\(/g) || [];

  assert.equal(modelBuilds.length, 2);
  assert.ok(source.includes("this.renderMobileMenu(navigationItems)"));
  assert.ok(
    source.includes(
      "this.renderMainMenu(activeChild, activeChild.name, 0, navigationItems)",
    ),
  );
});
```

The count is two because one occurrence is the method definition and one is
the single call from `renderModeMenu()`.

- [ ] **Step 2: Run the rendering test to verify it fails**

Run:

```bash
cd .dev
node --test tests/navigation-rendering.test.js
```

Expected: FAIL with `missing renderNavigationItem(item, mode)`.

- [ ] **Step 3: Add the shared item renderer**

Add after `buildNavigationModel()`:

```js
renderNavigationItem(item, mode) {
  const mobile = mode === "mobile";
  const itemClass = mobile ? "mobile-nav-item" : "";
  const directClass = mobile
    ? "navigation-direct mobile-nav-link"
    : "navigation-direct nav-link";

  if (!item.hasChildren) {
    const attributes = {
      class: `${directClass}${item.isActivePage ? " is-active-page" : ""}`,
      href: item.href,
    };

    if (item.isActivePage) attributes["aria-current"] = "page";

    return E("li", { class: itemClass }, [
      E("a", attributes, [item.title]),
    ]);
  }

  const submenuId = `${mode}-submenu-${String(item.name).replace(
    /[^A-Za-z0-9_-]/g,
    "-",
  )}`;
  const groupClasses = [
    "navigation-group",
    mobile ? "mobile-nav-item" : "sidebar-group",
    item.isActiveGroup ? "is-active-group" : "",
    item.isActiveGroup ? "is-expanded" : "",
  ].filter(Boolean);
  const toggleAttributes = {
    class: mobile
      ? "navigation-group-toggle mobile-nav-link mobile-nav-toggle"
      : "navigation-group-toggle nav-category",
    type: "button",
    "aria-expanded": item.isActiveGroup ? "true" : "false",
    "aria-controls": submenuId,
  };

  if (item.isActiveGroup) {
    toggleAttributes["aria-current"] = "location";
  }

  const list = E("ul", {
    class: mobile
      ? "navigation-submenu-list mobile-nav-submenu-list"
      : "navigation-submenu-list sidebar-submenu",
  });

  item.pages.forEach((page) => {
    const linkAttributes = {
      class: [
        "navigation-sublink",
        mobile ? "mobile-nav-sublink" : "",
        page.isActivePage ? "is-active-page" : "",
      ]
        .filter(Boolean)
        .join(" "),
      href: page.href,
    };

    if (page.isActivePage) linkAttributes["aria-current"] = "page";

    list.appendChild(
      E("li", { class: mobile ? "mobile-nav-subitem" : "" }, [
        E("a", linkAttributes, [page.title]),
      ]),
    );
  });

  const regionAttributes = {
    class: mobile
      ? "navigation-group-region mobile-nav-submenu"
      : "navigation-group-region sidebar-section",
    id: submenuId,
    "aria-hidden": item.isActiveGroup ? "false" : "true",
  };

  if (!item.isActiveGroup) regionAttributes.inert = "";

  return E("li", { class: groupClasses.join(" ") }, [
    E("button", toggleAttributes, [
      E("span", { class: "nav-category-label" }, [item.title]),
    ]),
    E("div", regionAttributes, [list]),
  ]);
},
```

- [ ] **Step 4: Make both containers consume the shared renderer**

Replace `renderMobileMenu(tree, url)` with:

```js
renderMobileMenu(items) {
  const list = document.querySelector("#mobile-nav-list");
  const footerAction = document.querySelector("#mobile-nav-footer-action");

  if (!list) return;

  list.innerHTML = "";
  if (footerAction) footerAction.innerHTML = "";

  items.forEach((item) => {
    if (item.isLogout) {
      if (footerAction) {
        footerAction.appendChild(
          E("a", { class: "mobile-nav-logout", href: item.href }, [
            item.title,
          ]),
        );
      }
      return;
    }

    list.appendChild(this.renderNavigationItem(item, "mobile"));
  });

  this.bindNavigationAccordion(list);
},
```

Replace `renderSidebar(children, url)` with:

```js
renderSidebar(items) {
  const list = document.querySelector("#sidebar-list");
  const footer = document.querySelector("#sidebar-footer");
  const crumb = [];

  if (!list) return;

  list.innerHTML = "";
  if (footer) footer.innerHTML = "";

  items.forEach((item) => {
    if (item.isActiveGroup || item.isActivePage) {
      crumb.push(item.title);
      if (item.activePage) crumb.push(item.activePage.title);
    }

    if (item.isLogout) {
      (footer || list).appendChild(
        E("a", { class: "nav-link", href: item.href }, [item.title]),
      );
      return;
    }

    list.appendChild(this.renderNavigationItem(item, "sidebar"));
  });

  this.bindNavigationAccordion(list);

  const crumbEl = document.querySelector("#header-crumb");
  if (crumbEl) crumbEl.innerHTML = "";

  crumb.forEach((title, index) => {
    if (index) crumbEl?.appendChild(E("li", { class: "crumb-sep" }, ["/"]));
    crumbEl?.appendChild(
      E("li", { class: index === crumb.length - 1 ? "current" : "" }, [
        title,
      ]),
    );
  });
},
```

- [ ] **Step 5: Build the model once in `renderModeMenu()`**

When `activeChild` is found, replace the two existing render calls with:

```js
const navigationItems = this.buildNavigationModel(
  ui.menu.getChildren(activeChild),
  activeChild.name,
);

this.renderMainMenu(activeChild, activeChild.name, 0, navigationItems);
this.renderMobileMenu(navigationItems);
```

Change the method signature:

```js
renderMainMenu(tree, url, level = 0, navigationItems = null) {
```

Change the sidebar branch:

```js
if (navType === "sidebar") {
  this.renderSidebar(navigationItems || []);
  return ul;
}
```

Recursive dropdown calls keep omitting the fourth argument.

- [ ] **Step 6: Use the shared controller for drawer reset and reopen**

In `initNavigationControls()`, cache:

```js
const mobileList = overlay.querySelector("#mobile-nav-list");
```

Replace the mobile reset and active expansion functions with:

```js
const resetMobileSubmenus = () => {
  this.resetNavigationGroups(mobileList);
};

const expandActiveMobileGroup = () => {
  this.expandActiveNavigationGroup(mobileList);
};
```

Delete the delegated `.mobile-nav-toggle` branch from the document click
handler because `bindNavigationAccordion()` owns it. Keep destination closing
with:

```js
const destination = e.target.closest(
  ".navigation-direct, .navigation-sublink, .mobile-nav-logout",
);

if (destination && overlay.contains(destination)) {
  setNavigationExpanded(false);
}
```

Keep `closeMobileNavigation()` resetting groups. This makes close/reopen and
desktop-breakpoint transitions recalculate expansion from
`.is-active-group`.

- [ ] **Step 7: Remove the superseded device-specific helpers**

Delete `setMobileSubmenuExpanded()` and `setSidebarSectionExpanded()` after
all call sites have moved to the shared controller. Also delete the old
sidebar delegated category click handler because
`bindNavigationAccordion(list)` replaces it.

- [ ] **Step 8: Run all JavaScript tests and parse the LuCI module**

Run:

```bash
cd .dev
pnpm test
node -e 'const fs=require("node:fs");new Function(fs.readFileSync("src/resource/menu-aurora.js","utf8"));'
```

Expected: all tests PASS and the parse command exits with status 0.

- [ ] **Step 9: Commit the shared rendering**

```bash
git add .dev/tests/navigation-rendering.test.js \
  .dev/src/resource/menu-aurora.js
git commit -m "refactor: share sidebar navigation rendering"
```

### Task 4: Move Active And Expanded Visuals Into Shared CSS

**Files:**

- Create: `.dev/tests/navigation-styles.test.js`
- Modify: `.dev/src/media/components/_nav.css`
- Modify: `.dev/src/media/_layout.css:278-317`
- Modify: `.dev/src/media/components/_overlay.css:19-67`

- [ ] **Step 1: Write the failing CSS ownership test**

Create `.dev/tests/navigation-styles.test.js`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nav = readFileSync(
  new URL("../src/media/components/_nav.css", import.meta.url),
  "utf8",
);
const layout = readFileSync(
  new URL("../src/media/_layout.css", import.meta.url),
  "utf8",
);
const overlay = readFileSync(
  new URL("../src/media/components/_overlay.css", import.meta.url),
  "utf8",
);
const sidebarNavigation = layout.slice(
  layout.indexOf("& .sidebar-list"),
  layout.indexOf("& .sidebar-footer"),
);
const mobileNavigation = overlay.slice(
  overlay.indexOf("& .mobile-nav-list"),
  overlay.indexOf("& .mobile-nav-footer"),
);

test("shared navigation CSS owns route and accordion states", () => {
  for (const token of [
    ".navigation-direct.is-active-page",
    ".navigation-group.is-active-group > .navigation-group-toggle",
    ".navigation-group.is-expanded > .navigation-group-toggle",
    ".navigation-group-region",
    ".navigation-group.is-expanded > .navigation-group-region",
    ".navigation-submenu-list",
    ".navigation-sublink.is-active-page",
    "before:bg-brand",
    "duration-[250ms]",
  ]) {
    assert.ok(nav.includes(token), `missing ${token}`);
  }
});

test("device CSS no longer owns active or expanded state", () => {
  for (const [name, source] of [
    ["layout", sidebarNavigation],
    ["overlay", mobileNavigation],
  ]) {
    for (const token of [
      ".nav-link-active",
      ".sidebar-group-open",
      ".submenu-expanded",
      ".has-active",
      "bg-brand-subtle",
    ]) {
      assert.equal(
        source.includes(token),
        false,
        `${name} still contains ${token}`,
      );
    }
  }
});
```

- [ ] **Step 2: Run the style test to verify it fails**

Run:

```bash
cd .dev
node --test tests/navigation-styles.test.js
```

Expected: FAIL with
`missing .navigation-direct.is-active-page`.

- [ ] **Step 3: Replace `_nav.css` with the shared state vocabulary**

Keep the file header, then use:

```css
.nav-link {
  @apply text-text hover:bg-hover-faint block rounded-xl px-3 py-1.5 no-underline transition-all duration-150;
}

.navigation-direct.is-active-page {
  @apply text-brand hover:text-brand font-medium;
}

.nav-category {
  @apply text-text-muted hover:text-text focus-visible:ring-focus-ring flex w-full cursor-pointer appearance-none items-center gap-2 rounded-lg border-0 bg-transparent px-3 py-2 text-left text-lg font-semibold tracking-wide shadow-none transition-colors duration-150 select-none focus-visible:ring-2 focus-visible:outline-none;
}

.nav-category-label {
  @apply min-w-0 flex-1 truncate;
}

.navigation-group-toggle {
  @apply after:size-3.5 after:shrink-0 after:bg-current after:opacity-55 after:transition-transform after:duration-[250ms] after:content-[''] after:[mask:url('@assets/icons/arrow-right.svg')_center/cover_no-repeat] hover:after:opacity-100;
}

.navigation-group.is-expanded > .navigation-group-toggle {
  @apply text-text after:rotate-90;
}

.navigation-group.is-active-group > .navigation-group-toggle {
  @apply text-brand hover:text-brand;
}

.navigation-group-region {
  @apply grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-[250ms] ease-out;
}

.navigation-group.is-expanded > .navigation-group-region {
  @apply grid-rows-[1fr] opacity-100;
}

.navigation-submenu-list {
  @apply before:bg-hairline relative min-h-0 list-none overflow-hidden before:absolute before:top-1 before:bottom-1 before:left-0 before:w-px before:origin-top before:scale-y-0 before:transition-transform before:duration-[250ms] before:ease-out before:content-[''];
}

.navigation-group.is-expanded .navigation-submenu-list {
  @apply before:scale-y-100;
}

.navigation-sublink {
  @apply text-text-muted hover:text-text relative flex no-underline transition-colors duration-150;
}

.navigation-sublink.is-active-page {
  @apply text-brand hover:text-brand font-semibold;
  @apply before:bg-brand before:absolute before:top-1.5 before:bottom-1.5 before:-left-4 before:w-0.5 before:rounded-full before:content-[''];
}
```

Do not add a filled background to active direct links, groups, or child pages.

- [ ] **Step 4: Reduce desktop CSS to density and layout**

Replace the navigation portion of the sidebar block with:

```css
& .sidebar-list {
  @apply m-0 flex-1 list-none space-y-0.5 overflow-y-auto p-3;

  & li {
    @apply m-0 list-none;
  }
}

& .sidebar-list .navigation-direct {
  @apply truncate text-lg;
}

& .sidebar-submenu {
  @apply m-0 min-h-0 list-none space-y-0.5 overflow-hidden p-0 pl-4;
}

& .sidebar-submenu .navigation-sublink {
  @apply rounded-lg px-3 py-1.5 text-sm;
}
```

Keep `.sidebar-footer` unchanged. Remove desktop selectors for
`.sidebar-section`, `.sidebar-group-open`, and `.nav-link-active`.

- [ ] **Step 5: Reduce mobile CSS to typography and touch layout**

Inside `.mobile-nav-item`, keep `.mobile-nav-link` but remove its nested
`.nav-link-active` rule.

Delete mobile selectors for `.has-submenu`, `.submenu-expanded`, and active
page styling. Keep these device-only rules:

```css
& .mobile-nav-submenu-list {
  @apply max-md:mx-0 max-md:mt-0 max-md:mb-2 max-md:py-1 max-md:pr-0 max-md:pl-4;
}

& .mobile-nav-subitem {
  & .mobile-nav-sublink {
    @apply max-md:min-h-10 max-md:w-full max-md:items-center max-md:py-2 max-md:text-[0.9375rem] max-md:font-medium;
  }
}
```

The shared `_nav.css` rules now own chevrons, expansion, hierarchy lines,
active text, and the short brand accent.

- [ ] **Step 6: Run all source tests**

Run:

```bash
cd .dev
pnpm test
```

Expected: all token and navigation tests PASS.

- [ ] **Step 7: Commit the unified visual states**

```bash
git add .dev/tests/navigation-styles.test.js \
  .dev/src/media/components/_nav.css \
  .dev/src/media/_layout.css \
  .dev/src/media/components/_overlay.css
git commit -m "style: unify sidebar navigation states"
```

### Task 5: Format, Build, And Verify The Complete Navigation

**Files:**

- Modify: `.dev/src/resource/menu-aurora.js`
- Modify: `.dev/src/media/components/_nav.css`
- Modify: `.dev/src/media/_layout.css`
- Modify: `.dev/src/media/components/_overlay.css`
- Modify: `.dev/tests/navigation-model.test.js`
- Modify: `.dev/tests/navigation-rendering.test.js`
- Modify: `.dev/tests/navigation-styles.test.js`
- Generated: `htdocs/luci-static/resources/menu-aurora.js`
- Generated: `htdocs/luci-static/aurora/main.css`

- [ ] **Step 1: Format all touched source and test files**

Run:

```bash
cd .dev
pnpm exec prettier --write \
  package.json \
  src/resource/menu-aurora.js \
  src/media/components/_nav.css \
  src/media/_layout.css \
  src/media/components/_overlay.css \
  tests/navigation-model.test.js \
  tests/navigation-rendering.test.js \
  tests/navigation-styles.test.js
```

Expected: Prettier exits successfully.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
cd .dev
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Build production assets**

Run:

```bash
cd .dev
pnpm build
```

Expected: Vite exits successfully and regenerates:

- `htdocs/luci-static/resources/menu-aurora.js`
- `htdocs/luci-static/aurora/main.css`

- [ ] **Step 4: Parse source and generated JavaScript**

Run from the repository root:

```bash
node - <<'NODE'
const fs = require("node:fs");

for (const file of [
  ".dev/src/resource/menu-aurora.js",
  "htdocs/luci-static/resources/menu-aurora.js",
]) {
  new Function(fs.readFileSync(file, "utf8"));
  console.log(`parsed ${file}`);
}
NODE
```

Expected:

```text
parsed .dev/src/resource/menu-aurora.js
parsed htdocs/luci-static/resources/menu-aurora.js
```

- [ ] **Step 5: Verify generated assets contain only the new state vocabulary**

Run from the repository root:

```bash
node - <<'NODE'
const fs = require("node:fs");
const js = fs.readFileSync(
  "htdocs/luci-static/resources/menu-aurora.js",
  "utf8",
);
const css = fs.readFileSync(
  "htdocs/luci-static/aurora/main.css",
  "utf8",
);

for (const token of [
  "navigation-group",
  "is-active-group",
  "is-expanded",
  "is-active-page",
  "aria-current",
]) {
  if (!js.includes(token)) throw new Error(`generated JS missing ${token}`);
}

for (const token of [
  "navigation-group.is-active-group",
  "navigation-sublink.is-active-page",
]) {
  if (!css.includes(token)) throw new Error(`generated CSS missing ${token}`);
}

for (const token of [
  "submenu-expanded",
  "sidebar-group-open",
  "has-active",
]) {
  if (js.includes(token) || css.includes(token)) {
    throw new Error(`legacy state remains: ${token}`);
  }
}
NODE
```

Expected: command exits with status 0 and no output.

- [ ] **Step 6: Check the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. The status contains only the intended source,
test, package script, and generated asset changes.

- [ ] **Step 7: Visually verify desktop sidebar behavior**

With `.dev/.env` pointing to a reachable OpenWrt device, run:

```bash
cd .dev
pnpm dev
```

Open `http://127.0.0.1:5173/cgi-bin/luci/admin/network/network` at a viewport
at least 768px wide and verify:

1. The current top-level group uses brand text and starts expanded.
2. The current child uses brand semibold text and a short left accent.
3. Neither active level has a filled background.
4. Clicking the active group collapses its children but leaves the group
   brand-colored.
5. Opening another group closes the previous group.
6. `Tab`, `Enter`, and `Space` operate the native group buttons.
7. Collapsing and restoring the whole sidebar still persists through
   `aurora.sidebarCollapsed`.
8. Light and dark themes keep the hierarchy and accent visible.

- [ ] **Step 8: Visually verify mobile drawer and breakpoint behavior**

At 320px, 390px, and 767px widths, verify:

1. Opening the drawer expands the current group.
2. The active group and active child match the desktop visual language.
3. Mobile retains 24px parent labels and at least 40px child touch targets.
4. The active group can be collapsed and another group can be opened.
5. Closing and reopening the drawer restores the route-derived active group.
6. Direct links, child links, logout, `Escape`, and overlay clicks close the
   drawer and restore body scrolling.
7. Crossing to 768px while open closes the drawer and restores body scrolling.
8. In reduced-motion mode, state changes remain usable without accordion or
   chevron animation.

- [ ] **Step 9: Commit generated assets and final formatting**

```bash
git add .dev/package.json \
  .dev/src/resource/menu-aurora.js \
  .dev/src/media/components/_nav.css \
  .dev/src/media/_layout.css \
  .dev/src/media/components/_overlay.css \
  .dev/tests/navigation-model.test.js \
  .dev/tests/navigation-rendering.test.js \
  .dev/tests/navigation-styles.test.js \
  htdocs/luci-static/resources/menu-aurora.js \
  htdocs/luci-static/aurora/main.css
git commit -m "build: regenerate unified navigation assets"
```

## Self-Review

- **Spec coverage:** Tasks 1-3 cover the shared model, separate DOM containers,
  route-derived initial state, manual collapse, single-open accordion,
  drawer reset/reopen behavior, breakpoint cleanup, `aria-current`,
  `aria-expanded`, `aria-hidden`, and `inert`. Task 4 covers the brand-text
  active group, short child accent, hierarchy line, no filled active
  background, 250ms motion, and device-specific sizing boundaries. Task 5
  covers generated assets and desktop/mobile/light/dark/reduced-motion checks.
- **Scope control:** Mega-menu, boxed dropdown, breadcrumb layout, logout
  placement, theme switcher, and whole-sidebar persistence remain unchanged.
- **Type consistency:** The plan consistently uses `buildNavigationModel()`,
  `renderNavigationItem()`, `setNavigationGroupExpanded()`,
  `setExclusiveNavigationGroupExpanded()`, `resetNavigationGroups()`,
  `expandActiveNavigationGroup()`, `bindNavigationAccordion()`,
  `.is-active-group`, `.is-expanded`, and `.is-active-page`.
