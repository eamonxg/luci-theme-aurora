import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../src/resource/menu-aurora.js", import.meta.url),
  "utf8",
);

const getMethodSource = (name) => {
  const start = source.indexOf(`  ${name}(`);

  if (start === -1) return "";

  const rest = source.slice(start + 2);
  const nextMethod = rest.slice(name.length).search(/^  [A-Za-z_$][\w$]*\(/m);

  return nextMethod === -1
    ? source.slice(start)
    : source.slice(start, start + 2 + name.length + nextMethod);
};

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(...classNames) {
    classNames.forEach((className) => this.values.add(className));
    this.sync();
  }

  contains(className) {
    return this.values.has(className);
  }

  remove(...classNames) {
    classNames.forEach((className) => this.values.delete(className));
    this.sync();
  }

  replace(classNames) {
    this.values = new Set(classNames.split(/\s+/).filter(Boolean));
  }

  sync() {
    this.element.attributes.set("class", [...this.values].join(" "));
  }

  toggle(className, force) {
    const enabled = force ?? !this.values.has(className);

    if (enabled) this.values.add(className);
    else this.values.delete(className);
    this.sync();

    return enabled;
  }
}

class FakeElement {
  constructor(tagName, attributes = {}, children = []) {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList(this);
    this.dataset = {};
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {
      display: "",
      properties: new Map(),
      removeProperty: (name) => this.style.properties.delete(name),
      setProperty: (name, value) => this.style.properties.set(name, value),
    };

    Object.entries(attributes).forEach(([name, value]) => {
      this.setAttribute(name, value);
    });
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    this.children.push(child);
    if (child instanceof FakeElement) child.parentElement = this;
    return child;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];

    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  closest(selector) {
    let current = this;

    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentElement;
    }

    return null;
  }

  contains(element) {
    if (element === this) return true;

    return this.children.some(
      (child) => child instanceof FakeElement && child.contains(element),
    );
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  listenerCount(type) {
    return this.listeners.get(type)?.length ?? 0;
  }

  matches(selector) {
    if (selector.startsWith("#")) {
      return this.getAttribute("id") === selector.slice(1);
    }

    if (selector.startsWith(".")) {
      return selector
        .slice(1)
        .split(".")
        .every((className) => this.classList.contains(className));
    }

    return this.tagName === selector;
  }

  querySelector(selector) {
    for (const child of this.children) {
      if (!(child instanceof FakeElement)) continue;
      if (child.matches(selector)) return child;

      const descendant = child.querySelector(selector);
      if (descendant) return descendant;
    }

    return null;
  }

  querySelectorAll(selector) {
    const matches = [];

    for (const child of this.children) {
      if (!(child instanceof FakeElement)) continue;
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }

    return matches;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "class") this.classList.replace("");
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.classList.replace(String(value));
    if (name.startsWith("data-")) {
      const dataName = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[dataName] = String(value);
    }
  }

  set innerHTML(value) {
    assert.equal(value, "");
    this.children = [];
  }
}

const E = (tagName, attributes, children) =>
  new FakeElement(tagName, attributes, children);

const getMenuChildren = (item) =>
  Object.entries(item?.children ?? {}).map(([name, child]) => ({
    ...child,
    name,
  }));

const createFakeDocument = ({ elements = {}, navType = "mega-menu" } = {}) => ({
  body: {
    dataset: { navType },
  },
  querySelector(selector) {
    return elements[selector] ?? null;
  },
  querySelectorAll() {
    return [];
  },
});

const loadMenuModule = ({
  dispatchpath = [],
  document = createFakeDocument(),
  getChildren = getMenuChildren,
  requestpath = [],
  translate = (value) => value,
} = {}) => {
  const baseclass = {
    extend(module) {
      return module;
    },
  };
  const ui = { menu: { getChildren } };
  const L = {
    env: { dispatchpath, requestpath },
    url: (...segments) => `/${segments.join("/")}`,
  };

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
  )(baseclass, ui, E, L, translate, document, {}, {});
};

const textContent = (element) =>
  element.children
    .map((child) =>
      child instanceof FakeElement ? textContent(child) : String(child),
    )
    .join("");

const directItem = (overrides = {}) => ({
  name: "status",
  title: "Status",
  href: "/admin/status",
  hasChildren: false,
  isLogout: false,
  isActiveGroup: false,
  isActivePage: false,
  activePage: null,
  pages: [],
  ...overrides,
});

const groupItem = (overrides = {}) => ({
  name: "network",
  title: "Network",
  href: "/admin/network",
  hasChildren: true,
  isLogout: false,
  isActiveGroup: false,
  isActivePage: false,
  activePage: null,
  pages: [],
  ...overrides,
});

test("defines the shared navigation renderer and emits its common contract", () => {
  const renderer = getMethodSource("renderNavigationItem");

  assert.match(renderer, /renderNavigationItem\(item, mode\)/);
  [
    "navigation-group",
    "navigation-group-toggle",
    "navigation-group-region",
    "navigation-submenu-list",
    "navigation-sublink",
    "navigation-direct",
    "is-active-group",
    "is-expanded",
    "is-active-page",
  ].forEach((className) => assert.match(renderer, new RegExp(className)));
  assert.match(renderer, /aria-current/);
});

test("renders both navigation surfaces through the shared renderer and accordion", () => {
  const mobile = getMethodSource("renderMobileMenu");
  const sidebar = getMethodSource("renderSidebar");

  assert.match(mobile, /renderNavigationItem\(item,\s*"mobile"\)/);
  assert.match(mobile, /bindNavigationAccordion\(list\)/);
  assert.match(sidebar, /renderNavigationItem\(item,\s*"sidebar"\)/);
  assert.match(sidebar, /bindNavigationAccordion\(list\)/);
});

test("removes legacy navigation state helpers and class tokens", () => {
  [
    "setMobileSubmenuExpanded",
    "setSidebarSectionExpanded",
    "submenu-expanded",
    "sidebar-group-open",
    "has-active",
  ].forEach((token) => assert.doesNotMatch(source, new RegExp(token)));
});

test("builds the navigation model once and passes the same items to both surfaces", () => {
  const renderModeMenu = getMethodSource("renderModeMenu");

  assert.equal(source.match(/\bbuildNavigationModel\(/g)?.length, 2);
  assert.match(
    renderModeMenu,
    /const navigationItems = this\.buildNavigationModel\(\s*ui\.menu\.getChildren\(activeChild\),\s*activeChild\.name,\s*\)/,
  );
  assert.match(
    renderModeMenu,
    /this\.renderMainMenu\(activeChild,\s*activeChild\.name,\s*0,\s*navigationItems\)/,
  );
  assert.match(renderModeMenu, /this\.renderMobileMenu\(navigationItems\)/);
});

test("renders an active direct item with shared and mode-specific state", () => {
  const menu = loadMenuModule();
  const item = menu.renderNavigationItem(
    {
      name: "status",
      title: "Status",
      href: "/admin/status",
      hasChildren: false,
      isActivePage: true,
    },
    "mobile",
  );
  const anchor = item.children[0];

  assert.equal(item.getAttribute("class"), "mobile-nav-item");
  assert.equal(
    anchor.getAttribute("class"),
    "navigation-direct mobile-nav-link is-active-page",
  );
  assert.equal(anchor.getAttribute("href"), "/admin/status");
  assert.equal(anchor.getAttribute("aria-current"), "page");
});

test("renders an active group expanded with active page semantics", () => {
  const menu = loadMenuModule();
  const item = menu.renderNavigationItem(
    {
      name: "network",
      title: "Network",
      hasChildren: true,
      isActiveGroup: true,
      pages: [
        {
          title: "Wireless",
          href: "/admin/network/wireless",
          isActivePage: true,
        },
      ],
    },
    "sidebar",
  );
  const [toggle, region] = item.children;
  const list = region.children[0];
  const activeLink = list.children[0].children[0];

  assert.equal(
    item.getAttribute("class"),
    "navigation-group sidebar-group is-active-group is-expanded",
  );
  assert.equal(toggle.getAttribute("aria-controls"), "sidebar-submenu-network");
  assert.equal(toggle.getAttribute("aria-current"), "location");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(region.getAttribute("aria-hidden"), "false");
  assert.equal(region.hasAttribute("inert"), false);
  assert.equal(
    activeLink.getAttribute("class"),
    "navigation-sublink is-active-page",
  );
  assert.equal(activeLink.getAttribute("aria-current"), "page");
});

test("renders the active desktop submenu link with current-page semantics", () => {
  const menu = loadMenuModule({
    dispatchpath: ["admin", "network", "wireless"],
  });
  const list = menu.renderMainMenu(
    {
      name: "network",
      children: {
        interfaces: { title: "Interfaces" },
        wireless: { title: "Wireless" },
      },
    },
    "admin/network",
    1,
  );
  const [inactiveItem, activeItem] = list.children;
  const inactiveLink = inactiveItem.children[0];
  const activeLink = activeItem.children[0];

  assert.equal(inactiveLink.hasAttribute("aria-current"), false);
  assert.equal(activeLink.getAttribute("class"), "is-active-page");
  assert.equal(activeLink.getAttribute("aria-current"), "page");
});

test("renders an inactive group collapsed and inert", () => {
  const menu = loadMenuModule();
  const item = menu.renderNavigationItem(
    {
      name: "system/tools",
      title: "System",
      hasChildren: true,
      isActiveGroup: false,
      pages: [],
    },
    "mobile",
  );
  const [toggle, region] = item.children;

  assert.equal(item.getAttribute("class"), "navigation-group mobile-nav-item");
  assert.equal(
    toggle.getAttribute("aria-controls"),
    "mobile-submenu-system%2Ftools",
  );
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.hasAttribute("aria-current"), false);
  assert.equal(region.getAttribute("aria-hidden"), "true");
  assert.equal(region.getAttribute("inert"), "");
});

test("renders mode and mobile navigation without desktop containers", () => {
  const mobileList = new FakeElement("ul");
  const mobileFooter = new FakeElement("div");
  const document = createFakeDocument({
    elements: {
      "#mobile-nav-footer-action": mobileFooter,
      "#mobile-nav-list": mobileList,
    },
  });
  const menu = loadMenuModule({
    dispatchpath: ["admin", "status"],
    document,
    requestpath: ["admin"],
    translate: (value) => `translated:${value}`,
  });
  const tree = {
    children: {
      admin: {
        title: "Administration",
        children: {
          status: { title: "Status" },
        },
      },
      services: {
        title: "Services",
        children: {
          dns: { title: "DNS" },
        },
      },
    },
  };
  const originalBuildNavigationModel = menu.buildNavigationModel.bind(menu);
  const originalRenderMainMenu = menu.renderMainMenu.bind(menu);
  const originalRenderMobileMenu = menu.renderMobileMenu.bind(menu);
  const desktopCalls = [];
  const mobileCalls = [];
  let buildCount = 0;

  menu.buildNavigationModel = (...args) => {
    buildCount += 1;
    return originalBuildNavigationModel(...args);
  };
  menu.renderMainMenu = (...args) => {
    desktopCalls.push(args);
    return originalRenderMainMenu(...args);
  };
  menu.renderMobileMenu = (...args) => {
    mobileCalls.push(args);
    return originalRenderMobileMenu(...args);
  };

  assert.doesNotThrow(() => menu.renderModeMenu(tree));
  assert.equal(buildCount, 1);
  assert.equal(desktopCalls.length, 1);
  assert.equal(desktopCalls[0][0].name, "admin");
  assert.equal(mobileCalls.length, 1);
  assert.strictEqual(desktopCalls[0][3], mobileCalls[0][0]);
  assert.deepEqual(mobileCalls[0][0], [
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
  ]);
  assert.equal(mobileList.children.length, 1);
});

test("skips mega-menu initialization when the top menu is missing", () => {
  const menu = loadMenuModule({
    document: createFakeDocument({ navType: "mega-menu" }),
  });
  const tree = {
    children: {
      status: { title: "Status" },
    },
  };
  let calls = 0;
  let result;

  menu.initMegaMenu = () => {
    calls += 1;
  };

  assert.doesNotThrow(() => {
    result = menu.renderMainMenu(tree, "admin");
  });
  assert.equal(calls, 0);
  assert.ok(result instanceof FakeElement);
});

test("measures mega-menu canvas from the viewport-bounded panel height", () => {
  const initMegaMenu = getMethodSource("initMegaMenu");

  assert.match(initMegaMenu, /nav\.offsetHeight/);
  assert.doesNotMatch(initMegaMenu, /nav\.scrollHeight/);
});

test("skips boxed-dropdown initialization when the top menu is missing", () => {
  const menu = loadMenuModule({
    document: createFakeDocument({ navType: "boxed-dropdown" }),
  });
  const tree = {
    children: {
      status: { title: "Status" },
    },
  };
  let calls = 0;
  let result;

  menu.initBoxedDropdown = () => {
    calls += 1;
  };

  assert.doesNotThrow(() => {
    result = menu.renderMainMenu(tree, "admin");
  });
  assert.equal(calls, 0);
  assert.ok(result instanceof FakeElement);
});

test("renders sidebar items when the top menu is missing", () => {
  const menu = loadMenuModule({
    document: createFakeDocument({ navType: "sidebar" }),
  });
  const tree = {
    children: {
      status: { title: "Status" },
    },
  };
  const items = [directItem()];
  let renderedItems = null;
  let result;

  menu.renderSidebar = (navigationItems) => {
    renderedItems = navigationItems;
  };

  assert.doesNotThrow(() => {
    result = menu.renderMainMenu(tree, "admin", 0, items);
  });
  assert.strictEqual(renderedItems, items);
  assert.ok(result instanceof FakeElement);
});

test("generates stable collision-safe submenu IDs", () => {
  const menu = loadMenuModule();

  assert.equal(
    menu.navigationSubmenuId("mobile", "system/tools"),
    "mobile-submenu-system%2Ftools",
  );
  assert.equal(
    menu.navigationSubmenuId("mobile", "system-tools"),
    "mobile-submenu-system-tools",
  );
  assert.equal(
    menu.navigationSubmenuId("mobile", "system.tools"),
    "mobile-submenu-system.tools",
  );
});

test("renders unique submenu controls for punctuation-distinct group names", () => {
  const menu = loadMenuModule();
  const names = ["system/tools", "system-tools", "system.tools"];
  const rendered = names.map((name) =>
    menu.renderNavigationItem(groupItem({ name }), "mobile"),
  );
  const controlIds = rendered.map((item) =>
    item.children[0].getAttribute("aria-controls"),
  );
  const regionIds = rendered.map((item) => item.children[1].getAttribute("id"));

  assert.deepEqual(controlIds, [
    "mobile-submenu-system%2Ftools",
    "mobile-submenu-system-tools",
    "mobile-submenu-system.tools",
  ]);
  assert.deepEqual(regionIds, controlIds);
  assert.equal(new Set(controlIds).size, names.length);
});

test("renders mobile items and logout repeatedly without duplicate listeners", () => {
  const list = new FakeElement("ul", {}, [new FakeElement("li")]);
  const footer = new FakeElement("div", {}, [new FakeElement("a")]);
  const document = createFakeDocument({
    elements: {
      "#mobile-nav-footer-action": footer,
      "#mobile-nav-list": list,
    },
  });
  const menu = loadMenuModule({ document });
  const items = [
    directItem(),
    groupItem(),
    directItem({
      name: "logout",
      title: "Logout",
      href: "/admin/logout",
      isLogout: true,
    }),
  ];

  menu.renderMobileMenu(items);
  menu.renderMobileMenu(items);

  assert.equal(list.children.length, 2);
  assert.equal(
    list.children[0].children[0].getAttribute("class"),
    "navigation-direct mobile-nav-link",
  );
  assert.equal(
    list.children[1].getAttribute("class"),
    "navigation-group mobile-nav-item",
  );
  assert.equal(footer.children.length, 1);
  assert.equal(footer.children[0].getAttribute("class"), "mobile-nav-logout");
  assert.equal(footer.children[0].getAttribute("href"), "/admin/logout");
  assert.equal(textContent(footer.children[0]), "Logout");
  assert.equal(list.dataset.accordionBound, "true");
  assert.equal(list.listenerCount("click"), 1);
});

test("renders sidebar items, logout, and translated crumbs without duplication", () => {
  const list = new FakeElement("ul", {}, [new FakeElement("li")]);
  const footer = new FakeElement("div", {}, [new FakeElement("a")]);
  const crumb = new FakeElement("ol", {}, [new FakeElement("li")]);
  const document = createFakeDocument({
    elements: {
      "#header-crumb": crumb,
      "#sidebar-footer": footer,
      "#sidebar-list": list,
    },
    navType: "sidebar",
  });
  const menu = loadMenuModule({
    dispatchpath: ["admin", "network", "wireless"],
    document,
    translate: (value) => `translated:${value}`,
  });
  const tree = {
    children: {
      network: {
        title: "Network",
        children: {
          wireless: { title: "Wireless" },
        },
      },
      status: { title: "Status" },
      logout: { title: "Logout" },
    },
  };
  const items = menu.buildNavigationModel(getMenuChildren(tree), "admin");

  menu.renderSidebar(items);
  menu.renderSidebar(items);

  assert.equal(list.children.length, 2);
  assert.equal(
    list.children[0].getAttribute("class"),
    "navigation-group sidebar-group is-active-group is-expanded",
  );
  assert.equal(
    list.children[1].children[0].getAttribute("class"),
    "navigation-direct nav-link",
  );
  assert.equal(footer.children.length, 1);
  assert.equal(footer.children[0].getAttribute("class"), "nav-link");
  assert.equal(footer.children[0].getAttribute("href"), "/admin/logout");
  assert.equal(textContent(footer.children[0]), "translated:Logout");
  assert.equal(crumb.children.length, 3);
  assert.deepEqual(
    crumb.children.map((child) => textContent(child)),
    ["translated:Network", "/", "translated:Wireless"],
  );
  assert.equal(crumb.children[2].getAttribute("class"), "current");
  assert.equal(list.dataset.accordionBound, "true");
  assert.equal(list.listenerCount("click"), 1);
});

test("renders an active group expanded when an open mobile list was initially empty", () => {
  const list = new FakeElement("ul");
  const overlay = new FakeElement("div", { class: "mobile-menu-open" }, [list]);
  const document = createFakeDocument({
    elements: {
      "#mobile-menu-overlay": overlay,
      "#mobile-nav-list": list,
    },
  });
  const menu = loadMenuModule({ document });

  menu.renderMobileMenu([
    groupItem({
      isActiveGroup: true,
      pages: [
        {
          title: "Wireless",
          href: "/admin/network/wireless",
          isActivePage: true,
        },
      ],
    }),
  ]);

  const item = list.children[0];
  const [toggle, region] = item.children;

  assert.equal(overlay.classList.contains("mobile-menu-open"), true);
  assert.equal(item.classList.contains("is-expanded"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(region.getAttribute("aria-hidden"), "false");
  assert.equal(region.hasAttribute("inert"), false);
});
