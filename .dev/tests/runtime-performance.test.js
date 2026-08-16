import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "../..");
const source = (path) => readFileSync(resolve(projectRoot, path), "utf8");

const speculationRules = () => {
  const header = source("ucode/template/themes/aurora/header.ut");
  const script = header.match(
    /<script type="speculationrules">\s*([\s\S]*?)\s*<\/script>/,
  );

  assert.ok(script, "missing speculationrules script");

  return JSON.parse(
    script[1].replace(
      /\{\{\s*dispatcher\.build_url\('admin'\)\s*\}\}/g,
      "/cgi-bin/luci/admin",
    ),
  );
};

const condition = (rules, name) =>
  rules.prefetch[0].where.and.find((entry) => name in entry)?.[name];

const createEventTarget = (properties = {}) => {
  const listeners = new Map();

  return Object.assign(properties, {
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? [];

      registered.push(listener);
      listeners.set(type, registered);
    },
    dispatch(type, properties = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener({ type, ...properties });
      }
    },
  });
};

const loadPollLifecycle = ({ active = true, hidden = false, ui = {} } = {}) => {
  const document = createEventTarget({ hidden });
  const window = createEventTarget();
  const calls = [];
  let pollActive = active;
  const poll = {
    active: () => pollActive,
    start() {
      calls.push(["start", !pollActive]);
      if (pollActive) return false;
      pollActive = true;
      document.dispatch("poll-start");
      return true;
    },
    stop() {
      calls.push(["stop", pollActive]);
      if (!pollActive) return false;
      pollActive = false;
      document.dispatch("poll-stop");
      return true;
    },
  };
  const menuSource = source(".dev/src/resource/menu-aurora.js");
  const menu = new Function(
    "baseclass",
    "ui",
    "poll",
    "document",
    "window",
    menuSource,
  )({ extend: (value) => value }, ui, poll, document, window);

  menu.initPollLifecycle();

  return {
    calls,
    document,
    poll,
    successfulCalls(name) {
      return calls.filter(([method, succeeded]) => method === name && succeeded)
        .length;
    },
    window,
  };
};

test("speculation rules are valid JSON and never prerender", () => {
  const rules = speculationRules();

  assert.equal(rules.prefetch.length, 1);
  assert.equal(rules.prerender, undefined);
});

test("speculative prefetch excludes logout with a root-relative pattern", () => {
  const rules = speculationRules();
  const exclusion = rules.prefetch[0].where.and.find((entry) => entry.not);

  assert.equal(exclusion.not.href_matches, "/cgi-bin/luci/admin/logout*");
});

test("speculative prefetch is restricted to leaf links in theme navigation", () => {
  const selector = condition(speculationRules(), "selector_matches");
  const menu = source(".dev/src/resource/menu-aurora.js");
  const containers = selector.match(
    /^:is\((.+)\) a:not\(\[href\^="#"\], \[aria-current\]\)$/,
  );

  assert.ok(containers, `unexpected selector shape: ${selector}`);
  for (const container of containers[1].split(/,\s*/)) {
    const name = container.slice(1);

    assert.ok(
      menu.includes(`"${container}"`) || menu.includes(`"${name}"`),
      `${container} is not rendered by menu-aurora.js`,
    );
  }
});

test("pageshow resumes a hidden-page pause exactly once", () => {
  const lifecycle = loadPollLifecycle();

  lifecycle.document.hidden = true;
  lifecycle.document.dispatch("visibilitychange");
  assert.equal(lifecycle.poll.active(), false);

  lifecycle.document.hidden = false;
  lifecycle.window.dispatch("pageshow", { persisted: true });
  assert.equal(
    lifecycle.poll.active(),
    true,
    "pageshow did not resume polling",
  );
  lifecycle.document.dispatch("visibilitychange");

  assert.equal(lifecycle.successfulCalls("stop"), 1);
  assert.equal(lifecycle.successfulCalls("start"), 1);
});

test("visibility restore followed by pageshow does not run a second poll step", () => {
  const lifecycle = loadPollLifecycle();

  lifecycle.document.hidden = true;
  lifecycle.document.dispatch("visibilitychange");
  lifecycle.document.hidden = false;
  lifecycle.document.dispatch("visibilitychange");
  lifecycle.window.dispatch("pageshow", { persisted: true });

  assert.equal(lifecycle.successfulCalls("stop"), 1);
  assert.equal(lifecycle.successfulCalls("start"), 1);
});

test("pageshow does not refresh a restored page while it is still hidden", () => {
  const lifecycle = loadPollLifecycle();

  lifecycle.document.hidden = true;
  lifecycle.document.dispatch("visibilitychange");
  lifecycle.window.dispatch("pageshow", { persisted: true });

  assert.equal(lifecycle.poll.active(), false);
  assert.equal(lifecycle.successfulCalls("start"), 0);

  lifecycle.document.hidden = false;
  lifecycle.document.dispatch("visibilitychange");
  assert.equal(lifecycle.successfulCalls("start"), 1);
});

test("a tab opened hidden stops the first poll loop until visible", () => {
  const lifecycle = loadPollLifecycle({ active: false, hidden: true });

  lifecycle.poll.start();
  assert.equal(lifecycle.poll.active(), false);

  lifecycle.document.hidden = false;
  lifecycle.document.dispatch("visibilitychange");
  assert.equal(lifecycle.poll.active(), true);
});

test("a later external stop cancels the theme-owned resume", () => {
  const lifecycle = loadPollLifecycle();

  lifecycle.document.hidden = true;
  lifecycle.document.dispatch("visibilitychange");
  lifecycle.document.hidden = false;
  assert.equal(lifecycle.poll.start(), true);
  assert.equal(lifecycle.poll.stop(), true);
  lifecycle.document.dispatch("visibilitychange");

  assert.equal(lifecycle.poll.active(), false);
  assert.equal(lifecycle.successfulCalls("start"), 1);
});

test("bfcache restore preserves a poll that was already paused", () => {
  const lifecycle = loadPollLifecycle({ active: false });

  lifecycle.window.dispatch("pageshow", { persisted: true });

  assert.equal(lifecycle.poll.active(), false);
  assert.equal(lifecycle.successfulCalls("start"), 0);
});

test("navigation transitions avoid blanket and full-page layout animation", () => {
  const nav = source(".dev/src/media/components/_nav.css");
  const layout = source(".dev/src/media/_layout.css");

  assert.doesNotMatch(nav, /\btransition-all\b/);
  assert.doesNotMatch(layout, /transition-\[grid-template-columns\]/);
});

test("login effects do not reserve compositor layers permanently", () => {
  const login = source(".dev/src/media/login.css");
  assert.doesNotMatch(login, /\[will-change:opacity\]/);
});

test("login template reuses server data when including the header", () => {
  const sysauth = source("ucode/template/themes/aurora/sysauth.ut");
  const header = source("ucode/template/themes/aurora/header.ut");

  assert.match(
    sysauth,
    /include\('header',\s*\{[^}]*prefetched_boardinfo:\s*boardinfo[^}]*prefetched_tokens:\s*themeTokens[^}]*\}\)/s,
  );
  assert.match(header, /prefetched_boardinfo\s*\?\?/);
  assert.match(header, /prefetched_tokens\s*\?\?/);
});

test("awaitReconnect keeps polling in a hidden tab", () => {
  const ui = { awaitReconnect: () => "original" };
  const lifecycle = loadPollLifecycle({ ui });

  lifecycle.document.hidden = true;
  lifecycle.document.dispatch("visibilitychange");
  assert.equal(lifecycle.poll.active(), false);

  assert.equal(ui.awaitReconnect(), "original");
  lifecycle.poll.start();
  assert.equal(lifecycle.poll.active(), true, "reconnect poll was paused");
});
