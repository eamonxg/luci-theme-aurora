"use strict";
"require baseclass";
"require ui";
"require poll";

// Same-document navigation for LuCI view pages. Design, boundaries and the
// invariants each step keeps: .dev/docs/spa-router.md.
const RT = window.L;
const RENDER_TIMEOUT = 8000;
const OVERVIEW_TEMPLATE = "admin_status/index";

const supported = () =>
  typeof navigation === "object" &&
  navigation !== null &&
  typeof navigation.addEventListener === "function" &&
  typeof NavigateEvent === "function" &&
  "intercept" in NavigateEvent.prototype;

const nodeWeight = (node) =>
  Math.min(node.order ?? 9999, 9999) + (node.auth?.login ? 10000 : 0);

// Port of dispatcher.uc resolve_firstchild(): the ACL check is skipped
// because /admin/menu is already filtered for the session.
function firstChild(node) {
  let candidate = null;

  for (const [name, child] of Object.entries(node.children ?? {})) {
    if (!child.satisfied || !child.title || typeof child.action !== "object")
      continue;

    if (child.action?.type === "firstchild") {
      if (candidate && nodeWeight(candidate.node) <= nodeWeight(child))
        continue;
      if (firstChild(child)) candidate = { name, node: child };
    } else if (!child.firstchild_ineligible) {
      if (!candidate || nodeWeight(candidate.node) > nodeWeight(child))
        candidate = { name, node: child };
    }
  }

  return candidate;
}

// segs (as requested) → { node, path (dispatch), args }, or null.
function resolve(tree, segs) {
  let node = tree;
  let path = [];
  let args = [];
  let i = 0;

  for (let hops = 0; hops < 32; hops++) {
    while (i < segs.length) {
      const child = node.children?.[segs[i]];

      if (child && child.satisfied === false) return null;
      if (!child) {
        if (!node.wildcard) return null;
        args = segs.slice(i);
        i = segs.length;
        break;
      }

      node = child;
      path.push(segs[i++]);
    }

    const type = node.action?.type;

    if (type === "alias") {
      segs = [
        ...String(node.action.path ?? "")
          .split("/")
          .filter(Boolean),
        ...args,
      ];
      node = tree;
      path = [];
      args = [];
      i = 0;
    } else if (type === "firstchild") {
      const pick = firstChild(node);

      if (!pick) return null;
      node = pick.node;
      path.push(pick.name);
    } else {
      return { node, path, args, request: segs };
    }
  }

  return null;
}

function viewClass(node) {
  const action = node?.action;

  if (action?.type === "view" && action.path)
    return `view.${action.path.replace(/\//g, ".")}`;
  if (action?.type === "template" && action.path === OVERVIEW_TEMPLATE)
    return "view.status.index";

  return null;
}

const prefixes = (segs) => {
  const out = [];
  let acc = null;

  for (const seg of segs) out.push((acc = acc == null ? seg : `${acc}-${seg}`));

  return out;
};

const PRAGMA_HEAD = /^(?:\s*["'](?:use strict|require\s[^"']+)["'];)+/;
const PRAGMA = /["']require\s+([^\s"']+)/g;

function pragmaDeps(source) {
  const head = source.slice(0, 4096).match(PRAGMA_HEAD)?.[0] ?? "";

  return [...head.matchAll(PRAGMA)].map((m) => m[1]);
}

const moduleUrl = (name) =>
  `${RT.env.base_url}/${name.replace(/\./g, "/")}.js${
    RT.env.resource_version ? `?v=${RT.env.resource_version}` : ""
  }`;

// luci-mod-status's page helpers, defined by its template on a full load.
// Only the missing ones are defined; the names stay theirs.
function ensureOverviewHelpers() {
  window.progressbar ??= function (query, value, max, byte) {
    const pg = document.querySelector(query);
    const vn = parseInt(value) || 0;
    const mn = parseInt(max) || 100;
    const fv = byte ? String.format("%1024.2mB", value) : value;
    const fm = byte ? String.format("%1024.2mB", max) : max;
    const pc = Math.floor((100 / mn) * vn);

    if (pg) {
      pg.firstElementChild.style.width = `${pc}%`;
      pg.setAttribute("title", `${fv} / ${fm} (${pc}%)`);
    }
  };
  window.renderBox ??= function (title, active, childs) {
    childs = childs || [];
    childs.unshift(
      E("span", { class: "ifacebadge large" }, [
        E("img", { src: L.resource("icons/ethernet.svg") }),
        active ? "" : E("em", {}, _("Not connected")),
      ]),
    );
    return E("div", { class: "ifacebox" }, [
      E("div", { class: "ifacebox-head" }, [E("strong", {}, title)]),
      E("div", { class: "ifacebox-body" }, childs),
    ]);
  };
  window.renderBadge ??= function (icon, title) {
    return E("span", { class: "ifacebadge" }, [
      E("img", { src: icon, title: title || "" }),
      title ? " " + title : "",
    ]);
  };
}

return baseclass.extend({
  __init__() {
    if (!supported() || !RT?.env?.scriptname) return;

    this.gen = 0;
    this.seen = new Set();
    this.warmed = new Set();
    this.inflight = Promise.resolve();
    this.intervals = new Set();
    this.knownSheets = new WeakSet(this.sheets());
    this.hostname =
      document.querySelector(".brand")?.textContent?.trim() || document.title;
    this.hookIntervals();

    Promise.all([ui.menu.load(), RT.require("menu-aurora")]).then(
      ([tree, menu]) => {
        this.tree = tree;
        this.menu = menu;
        if (!this.trackInitialRender()) return;
        document.querySelector('script[type="speculationrules"]')?.remove();
        navigation.addEventListener("navigate", (ev) => this.onNavigate(ev));
        document.addEventListener("pointerover", (ev) => this.onIntent(ev));
        document.addEventListener("pointerdown", (ev) => this.onIntent(ev));
        document.addEventListener("focusin", (ev) => this.onIntent(ev));
      },
    );
  },

  sheets() {
    const view = document.getElementById("view");

    return [
      ...document.querySelectorAll('style, link[rel~="stylesheet"]'),
    ].filter((el) => !view?.contains(el));
  },

  poisoned() {
    return this.sheets().some(
      (el) =>
        !this.knownSheets.has(el) && !el.hasAttribute("data-aurora-patch"),
    );
  },

  hookIntervals() {
    const set = window.setInterval;
    const clear = window.clearInterval;
    const ids = this.intervals;

    window.setInterval = function (...args) {
      const id = set.apply(window, args);
      ids.add(id);
      return id;
    };
    window.clearInterval = function (id) {
      ids.delete(id);
      return clear.call(window, id);
    };
    this.nativeClearInterval = clear;
  },

  clearViewIntervals() {
    for (const id of this.intervals) {
      if (id === poll.timer) continue;
      this.nativeClearInterval.call(window, id);
      this.intervals.delete(id);
    }
  },

  segsFromURL(url) {
    const u = new URL(url, window.location.href);
    const base = RT.env.scriptname;

    if (u.origin !== window.location.origin || !u.pathname.startsWith(base))
      return null;

    return u.pathname
      .slice(base.length)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  },

  route(url) {
    const segs = this.segsFromURL(url);
    const resolved = segs && this.resolve(segs);
    const className = resolved && viewClass(resolved.node);

    return className ? { segs, className, ...resolved } : null;
  },

  resolve(segs) {
    return resolve(this.tree, segs);
  },

  moduleDeps(source) {
    return pragmaDeps(source);
  },

  patchPrefixes(segs) {
    return prefixes(segs);
  },

  // The document's first view is LuCI's; wait for it like any other render
  // so a click during its load cannot be painted over by it. A document the
  // router could not have rendered (call/cbi/function pages) carries scripts
  // only a document death retires, so the router never takes over from one.
  trackInitialRender() {
    const current = this.route(window.location.href);

    if (!current) return false;
    this.seen.add(current.className);
    const title = current.node.title ? _(current.node.title) : "";
    this.titleTail = document.title.startsWith(title)
      ? document.title.slice(title.length)
      : ` - ${this.hostname}`;
    const view = document.getElementById("view");
    if (view) this.inflight = this.rendered(view);
    return true;
  },

  rendered(view) {
    const done = (v) =>
      v.querySelector(":scope > :not(.spinning):not(script)") ||
      (v.childElementCount === 0 && v.dataset.auroraStarted);
    if (done(view)) return Promise.resolve();

    return new Promise((resolve) => {
      const timer = setTimeout(finish, RENDER_TIMEOUT);
      const observer = new MutationObserver(() => {
        if (done(view)) finish();
      });
      function finish() {
        clearTimeout(timer);
        observer.disconnect();
        resolve();
      }
      view.dataset.auroraStarted = "1";
      observer.observe(view, { childList: true });
    });
  },

  onIntent(ev) {
    const a = ev.target?.closest?.("a[href]");
    if (!a || a.target || a.hasAttribute("download")) return;

    const r = this.route(a.href);
    if (r && !this.seen.has(r.className)) this.warm(r.className);
  },

  warm(name) {
    if (this.warmed.has(name)) return;
    this.warmed.add(name);
    fetch(moduleUrl(name), { priority: "low", credentials: "same-origin" })
      .then((res) => (res.ok ? res.text() : ""))
      .then((src) => {
        for (const dep of pragmaDeps(src))
          if (dep.includes(".")) this.warm(dep);
      })
      .catch(() => {});
  },

  onNavigate(ev) {
    if (this.bypass) {
      this.bypass = false;
      return;
    }
    if (
      !ev.canIntercept ||
      ev.hashChange ||
      ev.downloadRequest !== null ||
      ev.formData ||
      ev.navigationType === "reload"
    )
      return;

    const r = this.route(ev.destination.url);
    if (!r || this.poisoned()) return;

    ev.intercept({
      focusReset: "manual",
      scroll: "after-transition",
      handler: () => this.navigate(r, ev),
    });
  },

  async navigate(r, ev) {
    const gen = ++this.gen;
    const previous = this.inflight;
    let release;
    this.inflight = new Promise((res) => (release = res));

    try {
      await previous;
      if (gen !== this.gen || ev.signal.aborted) return;

      this.teardown();
      await this.flushUci();
      if (gen !== this.gen || ev.signal.aborted) return;

      this.setEnvironment(r);
      this.menu.syncRoute();
      this.applyPatches(r.request);

      const view = this.stage(r);
      const done = this.rendered(view);
      const cold = !this.seen.has(r.className);
      this.seen.add(r.className);

      const instance = await RT.require(r.className);
      if (!(instance instanceof RT.view))
        throw new TypeError(`${r.className} is not a LuCI.view`);
      if (!cold) new instance.constructor();
      await done;
      if (gen !== this.gen) return;
      await this.commit(view, r);
      this.mountPatches();
      document.getElementById("maincontent")?.focus({ preventScroll: true });
    } catch (err) {
      console.error("router-aurora:", err);
      this.bypass = true;
      window.location.href = ev.destination.url;
      await new Promise(() => {});
    } finally {
      release();
    }
  },

  teardown() {
    poll.queue.length = 0;
    poll.stop();
    poll.start();
    ui.hideIndicator("poll-status");
    this.clearViewIntervals();
    ui.hideModal();
    this.menu.closeSurfaces();
    this.unmountPatches();
  },

  // Documents start with an empty uci cache; network.js answers out of it
  // for the whole document, so its packages are refilled and awaited.
  async flushUci() {
    const uci = RT.uci;
    if (!uci?.state) return;

    const loaded = Object.keys(uci.state.values);
    if (loaded.length) uci.unload(loaded);

    if (RT.network) {
      const pkgs = ["network", "luci"];
      if (RT.hasSystemFeature?.("wifi")) pkgs.push("wireless");
      await uci.load(pkgs).catch(() => {});
    }
  },

  // An alias is re-dispatched server-side, so requestpath and data-page carry
  // the alias target while pathinfo keeps the URL as requested.
  setEnvironment(r) {
    RT.env.requestpath = r.request;
    RT.env.dispatchpath = r.path;
    RT.env.pathinfo = `/${r.segs.join("/")}`;
    RT.env.nodespec = r.node;
    document.body.dataset.page = r.request.join("-");
    document.title = r.node.title
      ? `${_(r.node.title)}${this.titleTail}`
      : this.hostname;
  },

  region() {
    const main = document.getElementById("maincontent");
    const start = document.getElementById("tabmenu");
    const end = main.querySelector(":scope > footer");
    const nodes = [];

    for (let n = start ? start.nextSibling : main.firstChild; n && n !== end; )
      (nodes.push(n), (n = n.nextSibling));

    return { main, start, end, nodes };
  },

  // The incoming view renders into a hidden #view placed first in tree
  // order (getElementById returns the first), so the outgoing page stays on
  // screen until the new one is ready.
  stage(r) {
    const { main, start, end } = this.region();
    const view = E("div", { id: "view", hidden: "" });

    for (const old of main.querySelectorAll(":scope > #view"))
      old.classList.add("view-leaving");
    main.insertBefore(view, start ? start.nextSibling : (end ?? null));

    if (r.className === "view.status.index") ensureOverviewHelpers();

    return view;
  },

  commit(view, r) {
    const swap = () => {
      for (const n of this.region().nodes) {
        if (n === view) continue;
        // dom.content() drops the data-idref registry entries that would
        // otherwise keep the departed subtree (and its class instances) alive.
        if (n.nodeType === 1) RT.dom.content(n, null);
        n.remove();
      }
      view.hidden = false;
      if (r.className === "view.status.index")
        view.before(E("h2", { name: "content" }, _("Status")));
    };
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (document.startViewTransition && !reduce)
      return document.startViewTransition(swap).updateCallbackDone;
    swap();
  },

  installed() {
    return (document.body.dataset.patches ?? "").split(/\s+/).filter(Boolean);
  },

  applyPatches(segs) {
    const want = new Set(prefixes(segs));
    const media = RT.env.media;

    for (const file of this.installed()) {
      const stem = file.replace(/\.(css|js)$/, "");
      const needed = want.has(stem);

      if (file.endsWith(".css")) {
        let link = document.querySelector(`link[data-aurora-patch="${stem}"]`);
        if (!link && needed) {
          link = E("link", {
            rel: "stylesheet",
            href: `${media}/patches/${stem}.css`,
            "data-aurora-patch": stem,
          });
          document.head.appendChild(link);
        } else if (link) link.disabled = !needed;
      } else if (needed) {
        this.pendingPatches ??= [];
        this.pendingPatches.push(stem);
      }
    }
  },

  mountPatches() {
    const registry = window.aurora?.patches ?? {};

    for (const stem of this.pendingPatches ?? []) {
      const script = document.querySelector(
        `script[data-aurora-patch="${stem}"]`,
      );
      if (!script) {
        document.head.appendChild(
          E("script", {
            src: `${RT.env.media}/patches/${stem}.js`,
            "data-aurora-patch": stem,
          }),
        );
      } else registry[stem]?.mount?.();
    }
    this.pendingPatches = [];
  },

  unmountPatches() {
    for (const stem in window.aurora?.patches ?? {})
      window.aurora.patches[stem].unmount?.();
  },
});
