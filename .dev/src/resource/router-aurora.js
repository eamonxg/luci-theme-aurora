"use strict";
"require baseclass";
"require ui";
"require poll";
"require rpc";

// Same-document navigation for LuCI view pages. Design, boundaries and the
// invariants each step keeps: .dev/docs/router.md.
const RT = window.L;
const RENDER_TIMEOUT = 15000;
const PATCH_ATTR = "data-aurora-patch";
const NODE_CSS_ATTR = "data-aurora-node-css";
const SHELL_ATTR = "data-aurora-shell";
// A navigation shorter than this stays silent; longer ones show the top bar.
const PROGRESS_DELAY = 150;
const INSTANTIATE = /instantiateView\(\s*['"]([^'"]+)['"]/;

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

// dispatcher.uc pushes every depends.acl along the dispatch path into one
// check_acl_depends() call, which is writable as soon as any group is
// writable; the tree's per-node readonly flag covers that node's acl alone.
function readonlyAlong(tree, path) {
  const gated = [];
  let node = tree;

  for (const name of path) {
    node = node?.children?.[name];
    if (node?.depends?.acl?.length) gated.push(node);
  }

  return gated.length > 0 && gated.every((n) => n.readonly === true);
}

// dispatcher.uc keeps a `path/*` entry's action apart as wildcardaction and
// runs it only when request args are present; the bare path keeps action.
const actionOf = (node, args) =>
  args.length && typeof node?.wildcardaction === "object"
    ? node.wildcardaction
    : node?.action;

function viewClass(action) {
  if (action?.type === "view" && action.path)
    return `view.${action.path.replace(/\//g, ".")}`;

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

// luci.mk appends ?v=PKG_VERSION to the theme's quoted asset URLs at package
// time; header.ut exposes the same value so links the router adds match.
const assetUrl = (path) => {
  const v = document.body.dataset.assetVersion;
  return v ? `${path}?v=${v}` : path;
};

const moduleUrl = (name) =>
  `${RT.env.base_url}/${name.replace(/\./g, "/")}.js${
    RT.env.resource_version ? `?v=${RT.env.resource_version}` : ""
  }`;

return baseclass.extend({
  __init__() {
    if (!supported() || !RT?.env?.scriptname) return;
    const missing = this.contract();
    if (missing.length) {
      console.warn(
        `router-aurora: luci-base surface missing, staying MPA: ${missing.join(", ")}`,
      );
      return;
    }

    this.gen = 0;
    this.seen = new Set();
    this.warmed = new Set();
    this.inflight = Promise.resolve();
    this.intervals = new Set();
    // Only the sheets header.ut rendered are known; anything else present at
    // boot was injected by the page's own modules before the router ran.
    this.knownSheets = new WeakSet(
      this.sheets().filter(
        (el) =>
          el.hasAttribute(SHELL_ATTR) ||
          el.hasAttribute(PATCH_ATTR) ||
          el.hasAttribute(NODE_CSS_ATTR),
      ),
    );
    this.hostname =
      document.querySelector(".brand")?.textContent?.trim() || document.title;
    this.hookIntervals();
    this.hookListeners();
    this.hookSession();
    this.hookVisibility();

    Promise.all([ui.menu.load(), RT.require("menu-aurora")]).then(
      ([tree, menu]) => {
        this.tree = tree;
        this.menu = menu;
        const current = this.initialRoute();
        if (!current) return;
        document.querySelector('script[type="speculationrules"]')?.remove();
        this.bar = document.body.appendChild(
          E("div", { id: "aurora-nav-progress", "aria-hidden": "true" }),
        );
        this.status = document.body.appendChild(
          E("div", {
            id: "aurora-nav-status",
            role: "status",
            "aria-live": "polite",
            "aria-atomic": "true",
          }),
        );
        navigation.addEventListener("navigate", (ev) => this.onNavigate(ev));
        document.addEventListener("pointerover", (ev) => this.onIntent(ev));
        document.addEventListener("pointerdown", (ev) => this.onIntent(ev));
        document.addEventListener("focusin", (ev) => this.onIntent(ev));
        this.watchInitialRender(current);
      },
    );
  },

  // Every luci-base surface the router leans on, by name. A missing one means
  // upstream moved and the safe answer is the MPA the theme was before — with
  // a warning, not a broken page. Kept in step with router.md.
  contract() {
    const roots = { L: RT, rpc, poll, ui, window };
    const need = [
      "L.view",
      "L.require",
      "L.dom.content",
      "L.env.base_url",
      "L.env.resource",
      "L.env.media",
      "L.Request.addInterceptor",
      "L.uci.load",
      "L.uci.unload",
      "L.uci.state",
      "rpc.addInterceptor",
      "poll.queue",
      "poll.start",
      "poll.stop",
      "poll.active",
      "ui.menu.load",
      "ui.hideModal",
      "ui.hideIndicator",
      "window.E",
    ];
    const lookup = (path) =>
      path.split(".").reduce((o, k) => (o == null ? o : o[k]), roots);

    return need.filter((path) => lookup(path) == null);
  },

  // A hidden tab keeps polling on a full load; on a weak router that is
  // RPC work nobody sees. Stopped while hidden, resumed on return unless the
  // user paused it or the session died meanwhile.
  hookVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.pausedByVisibility = poll.active();
        if (this.pausedByVisibility) poll.stop();
      } else if (this.pausedByVisibility) {
        this.pausedByVisibility = false;
        if (!this.expired) poll.start();
      }
    });
  },

  progressStart() {
    this.pending = (this.pending ?? 0) + 1;
    clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(
      () => (this.bar.dataset.state = "active"),
      PROGRESS_DELAY,
    );
  },

  progressEnd() {
    if (--this.pending > 0) return;
    clearTimeout(this.progressTimer);
    if (this.bar.dataset.state !== "active") return;
    this.bar.dataset.state = "done";
    this.progressTimer = setTimeout(() => {
      if (this.bar.dataset.state === "done") delete this.bar.dataset.state;
    }, 300);
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
        !this.knownSheets.has(el) &&
        !el.hasAttribute(PATCH_ATTR) &&
        !el.hasAttribute(NODE_CSS_ATTR),
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

  // window/document listeners registered while a view renders. A warm render
  // evaluates no module, so everything it registers is per-render and is
  // removed on the next teardown. A cold render also evaluates the module,
  // whose top-level registrations must survive (removing them is one-way),
  // so its listeners are only credited to the class — and released the
  // moment a warm render of the same class registers the same target/type,
  // which proves them per-render too.
  hookListeners() {
    const self = this;
    for (const target of [window, document]) {
      const add = target.addEventListener;
      const remove = target.removeEventListener;
      target.addEventListener = function (type, fn, opts) {
        self.renderWindow?.push({ target, type, fn, opts });
        return add.call(this, type, fn, opts);
      };
      target.removeEventListener = function (type, fn, opts) {
        if (self.renderWindow)
          self.renderWindow = self.renderWindow.filter(
            (e) => e.fn !== fn || e.type !== type,
          );
        return remove.call(this, type, fn, opts);
      };
    }
    this.pageListeners = [];
    this.coldListeners = new Map();
  },

  // luci-base answers an expired session with a modal and Poll.stop(); a
  // same-document swap would dismiss both and browse on. The signals are the
  // ones luci-base itself acts on: a 403 asking for login, or the
  // session.access probe it fires after any -32002 coming back denied.
  hookSession() {
    RT.Request?.addInterceptor?.((res) => {
      if (this.loginRequired(res)) this.expired = true;
    });
    rpc?.addInterceptor?.((msg, req) => {
      if (this.sessionGone(msg, req)) this.expired = true;
    });
  },

  loginRequired(res) {
    return (
      res?.status === 403 && res.headers?.get("X-LuCI-Login-Required") === "yes"
    );
  },

  sessionGone(msg, req) {
    if (req?.object !== "session" || req?.method !== "access" || !msg)
      return false;
    if (msg.error) return true;
    const data = Array.isArray(msg.result) ? msg.result[1] : msg.result;
    return data?.access === false;
  },

  nodespec(r) {
    return { ...r.node, readonly: readonlyAlong(this.tree, r.path) };
  },

  nodeCss(r) {
    return typeof r.node.css === "string" && r.node.css ? r.node.css : null;
  },

  openRenderWindow() {
    this.renderWindow = [];
  },

  closeRenderWindow(className, cold) {
    const entries = this.renderWindow ?? [];
    this.renderWindow = null;
    if (cold) {
      this.coldListeners.set(className, entries);
      this.pageListeners = [];
      return;
    }
    const stale = this.coldListeners.get(className) ?? [];
    for (const e of entries)
      for (const c of stale.filter(
        (c) => c.target === e.target && c.type === e.type,
      ))
        c.target.removeEventListener(c.type, c.fn, c.opts);
    this.coldListeners.set(
      className,
      stale.filter(
        (c) => !entries.some((e) => e.target === c.target && e.type === c.type),
      ),
    );
    this.pageListeners = entries;
  },

  clearViewListeners() {
    for (const e of this.pageListeners)
      e.target.removeEventListener(e.type, e.fn, e.opts);
    this.pageListeners = [];
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

  // A view node is served directly. A template node is served once its
  // server-rendered page is known to be a view shell (its region contains an
  // instantiateView call): the shell is fetched on hover/focus (onIntent) or
  // seeded from the document itself, so the decision here stays synchronous
  // and a Lua template page never costs a wasted fetch or an error path.
  route(url, { intent = false } = {}) {
    const segs = this.segsFromURL(url);
    const resolved = segs && this.resolve(segs);
    if (!resolved) return null;
    const action = actionOf(resolved.node, resolved.args);
    const className = viewClass(action);
    const path = action?.path;
    const template =
      action?.type === "template" &&
      (intent ? !this.unservable?.has(path) : this.templates?.has(path));

    return className || template
      ? { segs, className, template: template && path, url, ...resolved }
      : null;
  },

  // Fetch a template page once per document and keep the content region the
  // server rendered — the page's own helper scripts, <h2>, Lua includes —
  // instead of re-implementing them by hand. Not a view shell → remembered
  // as unservable so it is not fetched again this document.
  template(r) {
    this.templates ??= new Map();
    if (this.templates.has(r.template))
      return Promise.resolve(this.templates.get(r.template));
    // One request per template per document, however many intent events
    // (pointerover, pointerdown, focusin) arrive before it resolves.
    this.templateLoads ??= new Map();
    if (!this.templateLoads.has(r.template))
      this.templateLoads.set(
        r.template,
        fetch(r.url, { credentials: "same-origin" })
          .then((res) => res.text())
          .then((html) => {
            const doc = new DOMParser().parseFromString(html, "text/html");
            const main = doc.getElementById("maincontent");
            const start = main?.querySelector("#tabmenu");
            const end = main?.querySelector(":scope > footer");
            const nodes = [];

            for (let n = start?.nextSibling; n && n !== end; n = n.nextSibling)
              nodes.push(n);

            return this.rememberShell(r.template, nodes);
          })
          .finally(() => this.templateLoads.delete(r.template)),
      );

    return this.templateLoads.get(r.template);
  },

  // Region nodes → { className, nodes, scripts }: inline scripts are split
  // into the instantiateView call (which names the class) and the helpers,
  // #view is replaced by an empty shell, everything else is cloned.
  rememberShell(path, nodes) {
    const shell = { className: null, nodes: [], scripts: [] };

    for (const n of nodes) {
      if (n.nodeName === "SCRIPT") {
        // luci-base's own bootstrap (luci.js + `L = new LuCI(env)`) sits in
        // this region too; only the template's inline helpers are replayed.
        const m = n.textContent.match(INSTANTIATE);
        if (m) shell.className = `view.${m[1].replace(/\//g, ".")}`;
        else if (
          !n.src &&
          n.textContent.trim() &&
          !/new LuCI\(/.test(n.textContent)
        )
          shell.scripts.push(n.textContent);
      } else if (n.nodeType === 1 && n.id === "view") {
        shell.nodes.push(E("div", { id: "view" }));
      } else if (n.nodeType === 1 && n.querySelector("#view")) {
        shell.className = null;
        break;
      } else shell.nodes.push(document.importNode(n, true));
    }

    if (shell.className) this.templates.set(path, shell);
    else (this.unservable ??= new Set()).add(path);

    return shell.className ? shell : null;
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
  initialRoute() {
    const current = this.route(window.location.href, { intent: true });

    if (!current) return null;
    if (current.template) {
      // The document IS the rendered template: keep its region as the shell
      // so a later visit needs no fetch.
      this.templates ??= new Map();
      const shell = this.rememberShell(current.template, this.region().nodes);
      if (!shell) return null;
      current.className = shell.className;
    }
    this.seen.add(current.className);
    const title = current.node.title ? _(current.node.title) : "";
    this.titleTail = document.title.startsWith(title)
      ? document.title.slice(title.length)
      : ` - ${this.hostname}`;
    return current;
  },

  // A first render that never completes is a failure like any other: the
  // first navigation's `await previous` rejects into the hard-load fallback
  // instead of staging next to a chain that may still paint. Its listeners
  // are credited to the class as a cold render's, released by the first
  // warm render of the same class — as far as the router can see them: the
  // ones registered before it loaded are out of reach.
  watchInitialRender(current) {
    const view = document.getElementById("view");
    if (!view) return;
    this.openRenderWindow();
    this.inflight = this.rendered(view).finally(() =>
      this.closeRenderWindow(current.className, true),
    );
    this.inflight.catch(() => {});
  },

  rendered(view) {
    const done = (v) =>
      v.querySelector(":scope > :not(.spinning):not(script)") ||
      (v.childElementCount === 0 && v.dataset.auroraStarted);
    if (done(view)) return Promise.resolve();

    // A render that never completes is a failure, not a completion: committing
    // a spinner and releasing the serialization would let the still-running
    // chain paint into a later navigation's #view.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(reject, new Error("view did not render in time")),
        RENDER_TIMEOUT,
      );
      const observer = new MutationObserver(() => {
        if (done(view)) finish(resolve);
      });
      function finish(settle, value) {
        clearTimeout(timer);
        observer.disconnect();
        settle(value);
      }
      view.dataset.auroraStarted = "1";
      observer.observe(view, { childList: true });
    });
  },

  onIntent(ev) {
    const a = ev.target?.closest?.("a[href]");
    if (!a || a.target || a.hasAttribute("download")) return;

    const r = this.route(a.href, { intent: true });
    if (!r) return;
    if (r.template)
      this.template(r)
        .then((tpl) => tpl && this.warm(tpl.className))
        .catch(() => {});
    else if (!this.seen.has(r.className)) this.warm(r.className);
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
    if (!r || this.expired || this.poisoned()) return;

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
    this.progressStart();

    try {
      await previous;
      if (gen !== this.gen || ev.signal.aborted) return;

      const tpl = r.template ? await this.template(r) : null;
      if (tpl) r.className = tpl.className;
      if (gen !== this.gen || ev.signal.aborted) return;

      this.teardown();
      await this.flushUci();
      if (gen !== this.gen || ev.signal.aborted) return;

      this.setEnvironment(r);
      this.menu.syncRoute();
      const patches = this.applyPatches(r.request);
      this.applyNodeCss(this.nodeCss(r));

      const view = this.stage(tpl);
      const done = this.rendered(view);
      const cold = !this.seen.has(r.className);
      this.seen.add(r.className);

      this.openRenderWindow();
      try {
        const instance = await RT.require(r.className);
        if (!(instance instanceof RT.view))
          throw new TypeError(`${r.className} is not a LuCI.view`);
        if (!cold) new instance.constructor();
        await done;
      } finally {
        this.closeRenderWindow(r.className, cold);
      }
      if (gen !== this.gen) return;
      await this.commit(view);
      this.mountPatches(patches);
      this.status.textContent = document.title;
      document.getElementById("maincontent")?.focus({ preventScroll: true });
    } catch (err) {
      console.error("router-aurora:", err);
      if (gen !== this.gen) return;
      this.bypass = true;
      window.location.href = ev.destination.url;
      await new Promise(() => {});
    } finally {
      this.progressEnd();
      release();
    }
  },

  teardown() {
    poll.queue.length = 0;
    poll.stop();
    poll.start();
    ui.hideIndicator("poll-status");
    this.clearViewIntervals();
    this.clearViewListeners();
    ui.hideModal();
    this.menu.closeSurfaces();
    this.unmountPatches();
  },

  // Documents start with an empty uci cache; network.js answers out of it
  // for the whole document, so its packages are refilled and awaited.
  async flushUci() {
    const uci = RT.uci;
    if (!uci?.state) return;

    // uci.loaded keeps a package's request promise — a rejected one too —
    // until unload(); flush it as well or every later view inherits the
    // rejection.
    const loaded = Object.keys({ ...uci.state.values, ...uci.loaded });
    if (loaded.length) uci.unload(loaded);

    if (RT.network) {
      const pkgs = ["network", "luci"];
      if (RT.hasSystemFeature?.("wifi")) pkgs.push("wireless");
      // A failed refill propagates: the catch in navigate() hard-loads the
      // destination rather than leaving network.js on an empty config.
      await uci.load(pkgs);
    }
  },

  // An alias is re-dispatched server-side, so requestpath and data-page carry
  // the alias target while pathinfo keeps the URL as requested.
  setEnvironment(r) {
    RT.env.requestpath = r.request;
    RT.env.dispatchpath = r.path;
    RT.env.pathinfo = `/${r.segs.join("/")}`;
    RT.env.nodespec = this.nodespec(r);
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

  // The incoming view renders into an invisible but laid-out #view placed
  // first in tree order (getElementById returns the first), so the outgoing
  // page stays on screen until the new one is ready. Laid out, not
  // display:none: views size their graphs from #view.offsetWidth in render().
  stage(tpl) {
    const { main, start, end } = this.region();
    const wrapper = E("div", { class: "view-staging" });

    for (const old of main.querySelectorAll(":scope > #view"))
      old.classList.add("view-leaving");
    if (tpl) {
      for (const n of tpl.nodes) wrapper.appendChild(n.cloneNode(true));
      // Inline scripts of a parsed document never run on adoption; re-create
      // them so the template's helpers land in global scope as on a full load.
      for (const text of tpl.scripts)
        wrapper.appendChild(E("script", {}, text));
    } else wrapper.appendChild(E("div", { id: "view" }));
    main.insertBefore(wrapper, start ? start.nextSibling : (end ?? null));

    return wrapper.querySelector("#view");
  },

  commit(view) {
    const wrapper = view.parentNode;
    const swap = () => {
      for (const n of this.region().nodes) {
        if (n === wrapper) continue;
        // dom.content() drops the data-idref registry entries that would
        // otherwise keep the departed subtree (and its class instances) alive.
        if (n.nodeType === 1) RT.dom.content(n, null);
        n.remove();
      }
      wrapper.replaceWith(...wrapper.childNodes);
    };
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (document.startViewTransition && !reduce)
      return document.startViewTransition(swap).updateCallbackDone;
    swap();
  },

  // menu.d `css` is linked by header.ut for the dispatched node; the same
  // link is kept per page here — disabled, not removed, when leaving.
  applyNodeCss(css) {
    for (const link of document.querySelectorAll(`link[${NODE_CSS_ATTR}]`))
      link.disabled = link.getAttribute(NODE_CSS_ATTR) !== css;
    if (css && !document.querySelector(`link[${NODE_CSS_ATTR}="${css}"]`))
      document.head.appendChild(
        E("link", {
          rel: "stylesheet",
          href: `${RT.env.resource}/${css}`,
          [NODE_CSS_ATTR]: css,
        }),
      );
  },

  installed() {
    return (document.body.dataset.patches ?? "").split(/\s+/).filter(Boolean);
  },

  applyPatches(segs) {
    const want = new Set(prefixes(segs));
    const media = RT.env.media;
    const pending = [];

    for (const file of this.installed()) {
      const stem = file.replace(/\.(css|js)$/, "");
      const needed = want.has(stem);

      if (file.endsWith(".css")) {
        let link = document.querySelector(`link[${PATCH_ATTR}="${stem}"]`);
        if (!link && needed) {
          link = E("link", {
            rel: "stylesheet",
            href: assetUrl(`${media}/patches/${stem}.css`),
            [PATCH_ATTR]: stem,
          });
          document.head.appendChild(link);
        } else if (link) link.disabled = !needed;
      } else if (needed) pending.push(stem);
    }

    return pending;
  },

  mountPatches(pending) {
    const registry = window.aurora?.patches ?? {};
    this.live = new Set(pending);

    for (const stem of pending) {
      const script = document.querySelector(`script[${PATCH_ATTR}="${stem}"]`);
      if (!script) {
        const el = E("script", {
          src: assetUrl(`${RT.env.media}/patches/${stem}.js`),
          [PATCH_ATTR]: stem,
        });
        // The patch mounts itself on evaluation; if the user has already
        // navigated to a page without it by then, that mount is stale.
        el.addEventListener("load", () => {
          if (!this.live.has(stem)) window.aurora?.patches?.[stem]?.unmount?.();
        });
        document.head.appendChild(el);
      } else registry[stem]?.mount?.();
    }
  },

  unmountPatches() {
    this.live = new Set();
    for (const stem in window.aurora?.patches ?? {})
      window.aurora.patches[stem].unmount?.();
  },
});
