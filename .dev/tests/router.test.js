import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(
  resolve(import.meta.dirname, "../src/resource/router-aurora.js"),
  "utf8",
);

// The module returns a class from its top level (LuCI factory shape); the
// factory is built without a Navigation API so __init__ stays inert.
const loadRouter = ({ tree, scriptname = "/cgi-bin/luci" } = {}) => {
  const window = {
    location: new URL("https://r/cgi-bin/luci/admin/status/overview"),
    L: {
      env: {
        scriptname,
        base_url: "/luci-static/resources",
        resource_version: "1",
      },
    },
  };
  const document = { querySelector: () => null, querySelectorAll: () => [] };
  const router = new Function(
    "window",
    "document",
    "L",
    "baseclass",
    "ui",
    "poll",
    source,
  )(window, document, window.L, { extend: (value) => value }, {}, {});

  router.tree = tree;
  return router;
};

const view = (path, extra = {}) => ({
  title: path,
  satisfied: true,
  action: { type: "view", path },
  ...extra,
});

const tree = {
  action: { type: "firstchild" },
  satisfied: true,
  children: {
    admin: {
      title: "Admin",
      satisfied: true,
      action: { type: "firstchild" },
      children: {
        status: {
          title: "Status",
          satisfied: true,
          order: 10,
          action: { type: "firstchild" },
          children: {
            overview: {
              title: "Overview",
              satisfied: true,
              order: 1,
              action: { type: "template", path: "admin_status/index" },
            },
            logs: {
              title: "Logs",
              satisfied: true,
              order: 5,
              action: { type: "firstchild" },
              children: {
                syslog: view("status/logs/syslog", { order: 1 }),
                dmesg: view("status/logs/dmesg", { order: 2 }),
              },
            },
            realtime: {
              title: "Realtime",
              satisfied: true,
              action: { type: "alias", path: "admin/status/logs" },
            },
            unreachable: {
              title: "Loop",
              satisfied: true,
              action: { type: "alias", path: "admin/status/unreachable" },
            },
            hidden: view("status/hidden", { title: null, order: 0 }),
          },
        },
        system: {
          title: "System",
          satisfied: true,
          order: 20,
          action: { type: "firstchild" },
          children: {
            reboot: view("system/reboot", {
              order: 1,
              firstchild_ineligible: true,
            }),
            system: view("system/system", { order: 2, auth: { login: true } }),
            admin: view("system/admin", { order: 3 }),
            flash: view("system/flash", { order: 4, satisfied: false }),
            wild: view("system/wild", { order: 9, wildcard: true }),
            legacy: {
              title: "Legacy",
              satisfied: true,
              action: { type: "call", path: "legacy" },
            },
          },
        },
        logout: {
          title: "Logout",
          satisfied: true,
          action: { type: "function", name: "logout" },
        },
      },
    },
  },
};

test("a view node resolves to its class with request and dispatch tracks", () => {
  const router = loadRouter({ tree });
  const r = router.route("https://r/cgi-bin/luci/admin/system/admin");

  assert.equal(r.className, "view.system.admin");
  assert.deepEqual(r.segs, ["admin", "system", "admin"]);
  assert.deepEqual(r.path, ["admin", "system", "admin"]);
  assert.deepEqual(r.args, []);
});

test("firstchild follows the dispatcher's weights and eligibility rules", () => {
  const router = loadRouter({ tree });
  // reboot is ineligible, system carries auth.login (+10000), so admin wins.
  const r = router.route("https://r/cgi-bin/luci/admin/system");

  assert.equal(r.className, "view.system.admin");
  assert.deepEqual(r.segs, ["admin", "system"]);
  assert.deepEqual(r.request, ["admin", "system"]);
  assert.deepEqual(r.path, ["admin", "system", "admin"]);
});

test("nested firstchild resolves through the whole descent", () => {
  const router = loadRouter({ tree });
  // status (order 10) beats system (20); inside status the overview template
  // (order 1) is the lightest eligible child — a template node, routed only
  // once its page is known to be a view shell (hover fetch or seeded).
  assert.equal(router.route("https://r/cgi-bin/luci/"), null);
  const r = router.route("https://r/cgi-bin/luci/", { intent: true });
  assert.equal(r.className, null);
  assert.equal(r.template, "admin_status/index");
  assert.deepEqual(r.path, ["admin", "status", "overview"]);
  router.templates = new Map([["admin_status/index", {}]]);
  assert.equal(
    router.route("https://r/cgi-bin/luci/").template,
    "admin_status/index",
  );
});

test("firstchild ignores untitled children", () => {
  const router = loadRouter({ tree });
  const r = router.route("https://r/cgi-bin/luci/admin/status/logs");

  assert.equal(r.className, "view.status.logs.syslog");
});

test("alias restarts from the root and keeps request segments intact", () => {
  const router = loadRouter({ tree });
  const r = router.route("https://r/cgi-bin/luci/admin/status/realtime");

  assert.equal(r.className, "view.status.logs.syslog");
  assert.deepEqual(r.segs, ["admin", "status", "realtime"]);
  assert.deepEqual(r.request, ["admin", "status", "logs"]);
  assert.deepEqual(r.path, ["admin", "status", "logs", "syslog"]);
});

test("an alias cycle resolves to nothing instead of hanging", () => {
  const router = loadRouter({ tree });

  assert.equal(
    router.route("https://r/cgi-bin/luci/admin/status/unreachable"),
    null,
  );
});

test("wildcard nodes carry trailing segments as request args", () => {
  const router = loadRouter({ tree });
  const r = router.route("https://r/cgi-bin/luci/admin/system/wild/eth0/x");

  assert.equal(r.className, "view.system.wild");
  assert.deepEqual(r.path, ["admin", "system", "wild"]);
  assert.deepEqual(r.args, ["eth0", "x"]);
  assert.deepEqual(r.segs, ["admin", "system", "wild", "eth0", "x"]);
});

test("unsatisfied, non-view, unknown and foreign URLs are not routed", () => {
  const router = loadRouter({ tree });

  for (const url of [
    "https://r/cgi-bin/luci/admin/system/flash",
    "https://r/cgi-bin/luci/admin/system/legacy",
    "https://r/cgi-bin/luci/admin/logout",
    "https://r/cgi-bin/luci/admin/nowhere",
    "https://r/cgi-bin/luci/admin/system/admin/extra",
    "https://r/other/admin/system/admin",
    "https://elsewhere/cgi-bin/luci/admin/system/admin",
  ])
    assert.equal(router.route(url), null, url);
});

test("patch prefixes follow the header's segment-boundary rule", () => {
  const router = loadRouter({ tree });

  assert.deepEqual(router.patchPrefixes(["admin", "status", "logs", "dmesg"]), [
    "admin",
    "admin-status",
    "admin-status-logs",
    "admin-status-logs-dmesg",
  ]);
});

test("module dependencies are read from a minified one-line head", () => {
  const router = loadRouter({ tree });
  const minified =
    `"use strict";"require view";"require dom";"require tools.widgets as widgets";` +
    `"require network";return view.extend({"require fake":1})`;

  assert.deepEqual(router.moduleDeps(minified), [
    "view",
    "dom",
    "tools.widgets",
    "network",
  ]);
  assert.deepEqual(router.moduleDeps("(function(){'require x'})()"), []);
});
