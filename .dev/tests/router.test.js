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
    "rpc",
    source,
  )(window, document, window.L, { extend: (value) => value }, {}, {}, {});

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
            detail: view("system/detail", {
              order: 10,
              wildcard: true,
              wildcardaction: { type: "view", path: "system/detail-item" },
            }),
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

test("a wildcard node's wildcardaction serves the path with args, action the bare path", () => {
  const router = loadRouter({ tree });

  assert.equal(
    router.route("https://r/cgi-bin/luci/admin/system/detail").className,
    "view.system.detail",
  );
  assert.equal(
    router.route("https://r/cgi-bin/luci/admin/system/detail/c1").className,
    "view.system.detail-item",
  );
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

// dispatcher.uc folds every depends.acl along the dispatch path into one
// check_acl_depends() call, which is writable as soon as any group is
// writable — so a page is readonly only when every acl-bearing node on its
// path is readonly. The menu tree's per-node flag covers that node alone.
test("nodespec readonly is folded down the dispatch path like the dispatcher", () => {
  const acl = (readonly) => ({
    depends: { acl: ["luci-app-x"] },
    ...(readonly ? { readonly: true } : {}),
  });
  const t = {
    action: { type: "firstchild" },
    satisfied: true,
    children: {
      admin: {
        title: "Admin",
        satisfied: true,
        action: { type: "firstchild" },
        children: {
          ro: {
            title: "RO",
            satisfied: true,
            action: { type: "firstchild" },
            ...acl(true),
            children: {
              leaf: view("ro/leaf"),
              writable: view("ro/writable", acl(false)),
              alsoro: view("ro/alsoro", acl(true)),
            },
          },
          plain: {
            title: "Plain",
            satisfied: true,
            action: { type: "firstchild" },
            children: { leaf: view("plain/leaf") },
          },
        },
      },
    },
  };
  const router = loadRouter({ tree: t });
  const spec = (segs) => router.nodespec(router.resolve(segs));

  assert.equal(spec(["admin", "ro", "leaf"]).readonly, true);
  assert.equal(spec(["admin", "ro", "alsoro"]).readonly, true);
  assert.equal(spec(["admin", "ro", "writable"]).readonly, false);
  assert.equal(spec(["admin", "plain", "leaf"]).readonly, false);
  assert.equal(spec(["admin", "ro"]).readonly, true);
  // The tree's own node object is not mutated.
  assert.equal(t.children.admin.children.ro.children.leaf.readonly, undefined);
  assert.equal(spec(["admin", "ro", "leaf"]).action.path, "ro/leaf");
});

test("session expiry is recognised from the same signals luci-base uses", () => {
  const router = loadRouter({ tree });
  const res = (status, required) => ({
    status,
    headers: { get: (h) => (h === "X-LuCI-Login-Required" ? required : null) },
  });
  const probe = { object: "session", method: "access" };

  assert.equal(router.loginRequired(res(403, "yes")), true);
  assert.equal(router.loginRequired(res(403, null)), false);
  assert.equal(router.loginRequired(res(200, "yes")), false);

  assert.equal(router.sessionGone({ error: { code: -32002 } }, probe), true);
  assert.equal(
    router.sessionGone({ result: [0, { access: false }] }, probe),
    true,
  );
  assert.equal(
    router.sessionGone({ result: [0, { access: true }] }, probe),
    false,
  );
  // A denied call on any other object is an ACL matter, not an expiry.
  assert.equal(
    router.sessionGone(
      { error: { code: -32002 } },
      { object: "uci", method: "get" },
    ),
    false,
  );
  assert.equal(router.sessionGone(null, probe), false);
});

test("a menu.d node css is served for the resolved leaf only", () => {
  const t = {
    action: { type: "firstchild" },
    satisfied: true,
    children: {
      admin: {
        title: "Admin",
        satisfied: true,
        action: { type: "firstchild" },
        children: {
          styled: view("styled", { css: "view/styled/styled.css" }),
          group: {
            title: "Group",
            satisfied: true,
            action: { type: "firstchild" },
            css: "group.css",
            children: { leaf: view("group/leaf") },
          },
        },
      },
    },
  };
  const router = loadRouter({ tree: t });

  assert.equal(
    router.nodeCss(router.resolve(["admin", "styled"])),
    "view/styled/styled.css",
  );
  assert.equal(router.nodeCss(router.resolve(["admin", "group"])), null);
  assert.equal(
    router.nodeCss(router.resolve(["admin", "group", "leaf"])),
    null,
  );
});

test("the contract names every missing luci-base surface", () => {
  const router = loadRouter({ tree });
  const missing = router.contract();

  assert.ok(missing.includes("L.view"));
  assert.ok(missing.includes("poll.queue"));
  assert.ok(!missing.includes("L.env.base_url"));
});
