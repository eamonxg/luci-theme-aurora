import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const header = readFileSync(
  resolve(import.meta.dirname, "../../ucode/template/themes/aurora/header.ut"),
  "utf8",
);

// Just enough ucode for these scripts: comments and the nav-type branches.
const renderFor = (source, navType) =>
  source
    .replace(/\{#[\s\S]*?#\}/g, "")
    .replace(
      /\{% if \(nav_type == 'sidebar'\): %\}([\s\S]*?)\{% endif %\}/g,
      (_, body) => (navType === "sidebar" ? body : ""),
    );

const replaySource = header.match(
  /<script>\s*(\{% if \(nav_type == 'sidebar'\): %\}\s*\{#[^#]*#\}\s*function auroraCrumb[\s\S]*?)<\/script>/,
)?.[1];
const loginSource = header.match(
  /\{% if \(blank_page\): %\}\s*<script>([\s\S]*?)<\/script>/,
)?.[1];

const classes = (...initial) => {
  const set = new Set(initial);
  return {
    set,
    contains: (name) => set.has(name),
    toggle: (name, on) => (on ? set.add(name) : set.delete(name), on),
  };
};

const surface = (extra = {}) => {
  const el = { style: { display: "none" }, dataset: {}, html: null, ...extra };
  Object.defineProperty(el, "innerHTML", {
    set(value) {
      el.html = value;
    },
  });
  return el;
};

// A sidebar as the snapshot left it: System was the active group then.
const sidebarFixture = (activePath) => {
  const group = (name, label, links) => {
    const item = { classList: classes(), lastChild: {} };
    if (name === "system")
      item.classList.set.add("is-active-group").add("is-expanded");
    item.toggle = {
      tagName: "BUTTON",
      dataset: { section: name },
      parentNode: item,
    };
    item.label = { textContent: label };
    item.links = links.map(([page, text]) => ({
      pathname: `/cgi-bin/luci/admin/${name}/${page}`,
      textContent: text,
      classList: classes(
        ...(name === "system" && page === "system" ? ["is-active-page"] : []),
      ),
    }));
    item.querySelector = (sel) =>
      sel === ".nav-category-label" ? item.label : null;
    return item;
  };
  const direct = {
    tagName: "A",
    dataset: { section: "status" },
    textContent: "Status",
    classList: classes(),
  };
  const groups = [
    group("network", "Network", [
      ["wireless", "Wireless"],
      ["network", "Interfaces"],
    ]),
    group("system", "System", [
      ["system", "System"],
      ["admin", "Administration"],
    ]),
  ];
  const links = [direct, ...groups.flatMap((g) => g.links)];
  const list = surface({
    dataset: { activePath },
    querySelectorAll: (sel) =>
      sel === "[data-section]"
        ? [direct, ...groups.map((g) => g.toggle)]
        : sel === ".navigation-sublink"
          ? groups.flatMap((g) => g.links)
          : [],
    querySelector: (sel) =>
      sel === ".is-active-group"
        ? (groups.find((g) => g.classList.contains("is-active-group")) ?? null)
        : sel === ".is-active-page"
          ? (links.find((l) => l.classList.contains("is-active-page")) ?? null)
          : null,
  });
  return { list, direct, groups };
};

const run = ({
  navType,
  stamp = "s",
  cached = "s",
  luciMenu = true,
  elements,
}) => {
  const store = {
    "aurora.nav": JSON.stringify([
      cached,
      Object.fromEntries(
        Object.keys(elements)
          .filter((id) => id !== "header-crumb")
          .map((id) => [id, `<${id}>`]),
      ),
    ]),
    "luci-session-store": JSON.stringify({ sid: luciMenu ? { menu: {} } : {} }),
  };
  const document = {
    body: { dataset: { navStamp: stamp } },
    getElementById: (id) => elements[id] ?? null,
    createElement: () => ({}),
  };
  new Function("document", "sessionStorage", renderFor(replaySource, navType))(
    document,
    {
      getItem: (key) => store[key] ?? null,
    },
  );
};

test("header.ut carries the replay and the login-page clear", () => {
  assert.ok(replaySource, "replay script not found");
  assert.ok(loginSource, "login-page script not found");
});

test("a sidebar replay paints inert and re-marks the current page", () => {
  const { list, direct, groups } = sidebarFixture("network/wireless");
  const footer = surface();
  const crumb = { replaceChildren: (...items) => (crumb.items = items) };

  run({
    navType: "sidebar",
    elements: {
      "sidebar-list": list,
      "sidebar-footer": footer,
      "header-crumb": crumb,
    },
  });

  for (const el of [list, footer]) {
    assert.equal(
      el.html,
      `<${el === list ? "sidebar-list" : "sidebar-footer"}>`,
    );
    assert.equal(el.inert, true);
    assert.equal(el.dataset.restored, "");
  }
  const [network, system] = groups;
  assert.deepEqual(
    [...network.classList.set],
    ["is-active-group", "is-expanded"],
  );
  assert.deepEqual([...system.classList.set], []);
  assert.equal(direct.classList.contains("is-active-page"), false);
  assert.deepEqual(
    groups
      .flatMap((g) => g.links)
      .filter((l) => l.classList.contains("is-active-page"))
      .map((l) => l.textContent),
    ["Wireless"],
  );
  assert.deepEqual(
    crumb.items.map((li) => [li.className, li.textContent]),
    [
      ["", "Network"],
      ["crumb-sep", "/"],
      ["current", "Wireless"],
    ],
  );
});

test("a direct row is marked on its own section, with no sublink", () => {
  const { list, direct, groups } = sidebarFixture("status");
  const crumb = { replaceChildren: (...items) => (crumb.items = items) };

  run({
    navType: "sidebar",
    elements: { "sidebar-list": list, "header-crumb": crumb },
  });

  assert.equal(direct.classList.contains("is-active-page"), true);
  assert.ok(groups.every((g) => g.classList.set.size === 0));
  assert.ok(
    groups
      .flatMap((g) => g.links)
      .every((l) => !l.classList.contains("is-active-page")),
  );
  assert.deepEqual(
    crumb.items.map((li) => [li.className, li.textContent]),
    [["current", "Status"]],
  );
});

test("a top menu replay only paints, inert", () => {
  const topmenu = surface();

  run({ navType: "mega-menu", elements: { topmenu } });

  assert.equal(topmenu.html, "<topmenu>");
  assert.equal(topmenu.style.display, "");
  assert.equal(topmenu.inert, true);
});

test("nothing is replayed for another stamp or after luci-base flushed its menu", () => {
  for (const options of [{ cached: "other user" }, { luciMenu: false }]) {
    const topmenu = surface();
    run({ navType: "mega-menu", elements: { topmenu }, ...options });
    assert.equal(topmenu.html, null, JSON.stringify(options));
    assert.equal(topmenu.inert, undefined);
  }
});

test("the login page drops the cached nav", () => {
  const removed = [];
  new Function(
    "localStorage",
    "sessionStorage",
    "window",
    "document",
    renderFor(loginSource),
  )(
    { getItem: () => null },
    { removeItem: (key) => removed.push(key) },
    { matchMedia: () => ({ matches: false }) },
    { documentElement: { setAttribute() {} } },
  );
  assert.deepEqual(removed, ["aurora.nav"]);
});
