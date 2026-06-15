import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../src/resource/menu-aurora.js", import.meta.url),
  "utf8",
);

const menuOrder = (item) => (Number.isFinite(item.order) ? item.order : 1000);

const compareMenuItems = (a, b) => {
  const orderDifference = menuOrder(a) - menuOrder(b);

  if (orderDifference) return orderDifference;
  if (a.name === b.name) return 0;

  return a.name < b.name ? -1 : 1;
};

const getMenuChildren = (children = {}) =>
  Object.entries(children)
    .filter(([, child]) => child?.satisfied !== false && child?.title)
    .map(([name, child]) => ({ ...child, name }))
    .sort(compareMenuItems);

const loadMenuModule = (
  dispatchpath,
  getChildren = (item) => getMenuChildren(item?.children),
) => {
  const baseclass = {
    extend(module) {
      return module;
    },
  };
  const ui = { menu: { getChildren } };
  const E = () => ({});
  const L = {
    env: { dispatchpath },
    url: (...segments) => `/${segments.join("/")}`,
  };
  const translate = (title) => `translated:${title}`;
  const document = {};
  const window = {};
  const localStorage = {};

  return new Function(
    "baseclass",
    "ui",
    "E",
    "L",
    "_",
    "document",
    "window",
    "localStorage",
    source,
  )(baseclass, ui, E, L, translate, document, window, localStorage);
};

test("normalizes, orders, and filters a mixed navigation model", () => {
  const menu = loadMenuModule(["admin", "network", "wireless"]);
  const tree = {
    children: {
      logout: { title: "Logout", order: 30 },
      titleless: { order: 5 },
      status: { title: "Status", order: 20 },
      unavailable: { title: "Unavailable", order: 4, satisfied: false },
      network: {
        title: "Network",
        order: 10,
        children: {
          wireless: { title: "Wireless", order: 10 },
          hidden: { title: "Hidden", order: 5, satisfied: false },
          titleless: { order: 6 },
          interfaces: { title: "Interfaces", order: 10 },
        },
      },
    },
  };

  assert.deepEqual(
    menu.buildNavigationModel(getMenuChildren(tree.children), "admin"),
    [
      {
        name: "network",
        title: "translated:Network",
        href: "/admin/network",
        hasChildren: true,
        isLogout: false,
        isActiveGroup: true,
        isActivePage: false,
        activePage: {
          name: "wireless",
          title: "translated:Wireless",
          href: "/admin/network/wireless",
          isActivePage: true,
        },
        pages: [
          {
            name: "interfaces",
            title: "translated:Interfaces",
            href: "/admin/network/interfaces",
            isActivePage: false,
          },
          {
            name: "wireless",
            title: "translated:Wireless",
            href: "/admin/network/wireless",
            isActivePage: true,
          },
        ],
      },
      {
        name: "status",
        title: "translated:Status",
        href: "/admin/status",
        hasChildren: false,
        isLogout: false,
        isActiveGroup: false,
        isActivePage: false,
        activePage: null,
        pages: [],
      },
      {
        name: "logout",
        title: "translated:Logout",
        href: "/admin/logout",
        hasChildren: false,
        isLogout: true,
        isActiveGroup: false,
        isActivePage: false,
        activePage: null,
        pages: [],
      },
    ],
  );
});

test("marks a direct current destination as an active page, not a group", () => {
  const menu = loadMenuModule(["admin", "status"]);
  const tree = {
    children: {
      status: { title: "Status" },
    },
  };

  assert.deepEqual(
    menu.buildNavigationModel(getMenuChildren(tree.children), "admin"),
    [
      {
        name: "status",
        title: "translated:Status",
        href: "/admin/status",
        hasChildren: false,
        isLogout: false,
        isActiveGroup: false,
        isActivePage: true,
        activePage: null,
        pages: [],
      },
    ],
  );
});

test("omits invalid top-level items without a name", () => {
  const menu = loadMenuModule(["admin", "status"]);

  assert.deepEqual(
    menu.buildNavigationModel(
      [
        { title: "Invalid", children: {} },
        ...getMenuChildren({
          status: { title: "Status" },
        }),
      ],
      "admin",
    ),
    [
      {
        name: "status",
        title: "translated:Status",
        href: "/admin/status",
        hasChildren: false,
        isLogout: false,
        isActiveGroup: false,
        isActivePage: true,
        activePage: null,
        pages: [],
      },
    ],
  );
});

test("omits pages without a name returned by the menu API", () => {
  const getChildren = () => [
    { title: "Invalid" },
    { name: "wireless", title: "Wireless" },
  ];
  const menu = loadMenuModule(["admin", "network", "wireless"], getChildren);

  assert.deepEqual(
    menu.buildNavigationModel(
      [{ name: "network", title: "Network" }],
      "admin",
    )[0].pages,
    [
      {
        name: "wireless",
        title: "translated:Wireless",
        href: "/admin/network/wireless",
        isActivePage: true,
      },
    ],
  );
});

test("returns an empty navigation model for empty input", () => {
  const menu = loadMenuModule(["admin"]);

  assert.deepEqual(menu.buildNavigationModel([], "admin"), []);
});

const createClassList = (...classes) => {
  const values = new Set(classes);

  return {
    contains(className) {
      return values.has(className);
    },
    toggle(className, force) {
      const enabled = force ?? !values.has(className);

      if (enabled) values.add(className);
      else values.delete(className);

      return enabled;
    },
  };
};

const createFakeElement = (...classes) => {
  const attributes = new Map();

  const element = {
    classList: createClassList(...classes),
    parentElement: null,
    closest(selector) {
      if (!selector.startsWith(".")) return null;

      const className = selector.slice(1);
      let current = element;

      while (current) {
        if (current.classList?.contains(className)) return current;
        current = current.parentElement;
      }

      return null;
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    querySelector() {
      return null;
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };

  return element;
};

const createNavigationGroup = (...classes) => {
  const item = createFakeElement("navigation-group", ...classes);
  const toggle = createFakeElement("navigation-group-toggle");
  const region = createFakeElement("navigation-group-region");

  toggle.parentElement = item;
  region.parentElement = item;
  item.querySelector = (selector) => {
    if (selector === ".navigation-group-toggle") return toggle;
    if (selector === ".navigation-group-region") return region;
    return null;
  };

  return { item, region, toggle };
};

const createNavigationSurface = (groups) => {
  const items = groups.map((group) => group.item);
  const listeners = new Map();

  return {
    dataset: {},
    addEventListener(type, listener) {
      const typeListeners = listeners.get(type) ?? [];

      typeListeners.push(listener);
      listeners.set(type, typeListeners);
    },
    contains(item) {
      return items.includes(item);
    },
    dispatch(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    listenerCount(type) {
      return listeners.get(type)?.length ?? 0;
    },
    querySelector(selector) {
      if (selector === ".navigation-group.is-active-group") {
        return (
          items.find((item) => item.classList.contains("is-active-group")) ??
          null
        );
      }

      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".navigation-group.is-expanded") {
        return items.filter((item) => item.classList.contains("is-expanded"));
      }

      return [];
    },
  };
};

test("sets one navigation group expanded while preserving active state", () => {
  const menu = loadMenuModule(["admin"]);
  const { item, region, toggle } = createNavigationGroup(
    "is-active-group",
    "custom-state",
  );

  region.setAttribute("aria-hidden", "true");
  region.setAttribute("inert", "");

  menu.setNavigationGroupExpanded(item, true);

  assert.equal(item.classList.contains("is-expanded"), true);
  assert.equal(item.classList.contains("is-active-group"), true);
  assert.equal(item.classList.contains("custom-state"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(region.getAttribute("aria-hidden"), "false");
  assert.equal(region.hasAttribute("inert"), false);

  menu.setNavigationGroupExpanded(item, false);

  assert.equal(item.classList.contains("is-expanded"), false);
  assert.equal(item.classList.contains("is-active-group"), true);
  assert.equal(item.classList.contains("custom-state"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(region.getAttribute("aria-hidden"), "true");
  assert.equal(region.getAttribute("inert"), "");
});

test("sets an expanded navigation group when controls or regions are missing", () => {
  const menu = loadMenuModule(["admin"]);
  const item = createFakeElement("navigation-group");

  assert.doesNotThrow(() => menu.setNavigationGroupExpanded(item, true));
  assert.equal(item.classList.contains("is-expanded"), true);
});

test("exclusively expands one navigation group", () => {
  const menu = loadMenuModule(["admin"]);
  const first = createNavigationGroup();
  const second = createNavigationGroup();
  const surface = createNavigationSurface([first, second]);

  menu.setNavigationGroupExpanded(first.item, true);
  menu.setExclusiveNavigationGroupExpanded(surface, second.item, true);

  assert.equal(first.item.classList.contains("is-expanded"), false);
  assert.equal(first.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(first.region.getAttribute("aria-hidden"), "true");
  assert.equal(first.region.hasAttribute("inert"), true);
  assert.equal(second.item.classList.contains("is-expanded"), true);
  assert.equal(second.toggle.getAttribute("aria-expanded"), "true");
  assert.equal(second.region.getAttribute("aria-hidden"), "false");
  assert.equal(second.region.hasAttribute("inert"), false);
});

test("collapses only the requested navigation group", () => {
  const menu = loadMenuModule(["admin"]);
  const first = createNavigationGroup();
  const second = createNavigationGroup();
  const surface = createNavigationSurface([first, second]);

  menu.setNavigationGroupExpanded(first.item, true);
  menu.setNavigationGroupExpanded(second.item, true);
  menu.setExclusiveNavigationGroupExpanded(surface, second.item, false);

  assert.equal(first.item.classList.contains("is-expanded"), true);
  assert.equal(first.toggle.getAttribute("aria-expanded"), "true");
  assert.equal(second.item.classList.contains("is-expanded"), false);
  assert.equal(second.toggle.getAttribute("aria-expanded"), "false");
});

test("ignores missing exclusive navigation group arguments", () => {
  const menu = loadMenuModule(["admin"]);
  const group = createNavigationGroup();
  const surface = createNavigationSurface([group]);

  assert.doesNotThrow(() =>
    menu.setExclusiveNavigationGroupExpanded(null, group.item, true),
  );
  assert.doesNotThrow(() =>
    menu.setExclusiveNavigationGroupExpanded(surface, null, true),
  );
  assert.equal(group.item.classList.contains("is-expanded"), false);
});

test("resets every expanded navigation group", () => {
  const menu = loadMenuModule(["admin"]);
  const first = createNavigationGroup();
  const second = createNavigationGroup();
  const collapsed = createNavigationGroup();
  const surface = createNavigationSurface([first, second, collapsed]);

  menu.setNavigationGroupExpanded(first.item, true);
  menu.setNavigationGroupExpanded(second.item, true);
  menu.resetNavigationGroups(surface);

  assert.equal(first.item.classList.contains("is-expanded"), false);
  assert.equal(first.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(first.region.hasAttribute("inert"), true);
  assert.equal(second.item.classList.contains("is-expanded"), false);
  assert.equal(second.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(second.region.hasAttribute("inert"), true);
  assert.equal(collapsed.item.classList.contains("is-expanded"), false);
  assert.equal(collapsed.toggle.getAttribute("aria-expanded"), null);
  assert.doesNotThrow(() => menu.resetNavigationGroups(null));
});

test("expands the active navigation group exclusively", () => {
  const menu = loadMenuModule(["admin"]);
  const first = createNavigationGroup();
  const active = createNavigationGroup("is-active-group");
  const surface = createNavigationSurface([first, active]);

  menu.setNavigationGroupExpanded(first.item, true);
  menu.expandActiveNavigationGroup(surface);

  assert.equal(first.item.classList.contains("is-expanded"), false);
  assert.equal(active.item.classList.contains("is-expanded"), true);
  assert.equal(active.item.classList.contains("is-active-group"), true);
  assert.equal(active.toggle.getAttribute("aria-expanded"), "true");
  assert.equal(active.region.hasAttribute("inert"), false);
});

test("ignores missing active navigation groups", () => {
  const menu = loadMenuModule(["admin"]);
  const surface = createNavigationSurface([createNavigationGroup()]);

  assert.doesNotThrow(() => menu.expandActiveNavigationGroup(surface));
  assert.doesNotThrow(() => menu.expandActiveNavigationGroup(null));
});

test("binds one delegated navigation accordion listener", () => {
  const menu = loadMenuModule(["admin"]);
  const first = createNavigationGroup();
  const second = createNavigationGroup();
  const surface = createNavigationSurface([first, second]);
  let prevented = 0;
  let stopped = 0;

  menu.setNavigationGroupExpanded(first.item, true);
  menu.bindNavigationAccordion(surface);
  menu.bindNavigationAccordion(surface);

  assert.equal(surface.dataset.accordionBound, "true");
  assert.equal(surface.listenerCount("click"), 1);

  surface.dispatch("click", {
    target: second.toggle,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {
      stopped += 1;
    },
  });

  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(first.item.classList.contains("is-expanded"), false);
  assert.equal(second.item.classList.contains("is-expanded"), true);

  surface.dispatch("click", {
    target: createFakeElement("outside"),
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {
      stopped += 1;
    },
  });

  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(second.item.classList.contains("is-expanded"), true);
  assert.doesNotThrow(() => menu.bindNavigationAccordion(null));
});

test("ignores delegated clicks from targets without closest", () => {
  const menu = loadMenuModule(["admin"]);
  const group = createNavigationGroup();
  const surface = createNavigationSurface([group]);
  let prevented = 0;
  let stopped = 0;

  menu.bindNavigationAccordion(surface);

  assert.doesNotThrow(() =>
    surface.dispatch("click", {
      target: {},
      preventDefault() {
        prevented += 1;
      },
      stopPropagation() {
        stopped += 1;
      },
    }),
  );
  assert.equal(prevented, 0);
  assert.equal(stopped, 0);
  assert.equal(group.item.classList.contains("is-expanded"), false);
});

test("handles delegated clicks from inside a navigation group toggle", () => {
  const menu = loadMenuModule(["admin"]);
  const first = createNavigationGroup();
  const second = createNavigationGroup();
  const surface = createNavigationSurface([first, second]);
  const label = createFakeElement("navigation-group-label");
  const span = createFakeElement("navigation-group-label-text");
  let prevented = 0;
  let stopped = 0;

  label.parentElement = second.toggle;
  span.parentElement = label;
  menu.setNavigationGroupExpanded(first.item, true);
  menu.bindNavigationAccordion(surface);

  surface.dispatch("click", {
    target: span,
    preventDefault() {
      prevented += 1;
    },
    stopPropagation() {
      stopped += 1;
    },
  });

  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(first.item.classList.contains("is-expanded"), false);
  assert.equal(second.item.classList.contains("is-expanded"), true);
});
