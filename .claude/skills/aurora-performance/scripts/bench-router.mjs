#!/usr/bin/env node
/**
 * bench-router.mjs <label> — verifies and measures the theme's client-side
 * router (router-aurora.js) against real full loads on the device, over raw
 * CDP (headless Chrome, no npm deps, node >= 22).
 *
 * env: HOST (default http://192.168.1.1), COOKIE_NAME, COOKIE_VALUE,
 *      CHROME_BIN, RUNS (default and minimum 10), ONLY (walk|timing|soak|back|poison|sheets|hygiene|nodecss|expiry),
 *      MATCH (regex; walk only these pages), SETTLE (ms after the view settled before
 *      a snapshot, default 300 — raise it for pages whose tables fill on the first poll)
 *
 * Scenarios:
 *   walk   every page the navigation model links to (menu + each page's
 *          tab strip): same-document navigate, then a full load of the same
 *          URL; compare title, data-page, dispatchpath, tab count, footer
 *          presence, view child count. Reports divergences and fallbacks.
 *   timing click → view painted, median of RUNS: router (warm and cold)
 *          vs full load, same pages.
 *   soak   60 navigations over the walked pages; heap, DOM nodes, poll queue
 *          and view intervals sampled on the same page each lap.
 *   back   traverse back through a chain that deliberately includes alias
 *          and firstchild URLs (read from the menu tree): same document,
 *          correct URL/data-page each step.
 *   poison a foreign <style> in <head> makes the next navigation a full
 *          load, and the one after (fresh document) is same-document again.
 *   sheets  every walked view page that inserts its own <style>/<link> (found
 *          on the walk): reached same-document, the navigation away is a
 *          full load (poison gate), the one after is same-document again.
 *          Skipped when the walk found no such page.
 *   hygiene progress bar and live region exist; a hidden tab stops polling
 *          and a visible one resumes it; the live region carries the title.
 *   nodecss a page whose menu.d node declares `css`: its link is enabled on
 *          arrival, disabled (not removed) after leaving, re-enabled without
 *          a duplicate on return. Skipped when no such node is installed.
 *   expiry the session is destroyed from inside the document (logout fetch)
 *          and a poll fails: the next navigation must be a full load that
 *          lands on the login form. Destroys the session — always runs last.
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const HOST = (process.env.HOST ?? "http://192.168.1.1").replace(/\/+$/, "");
const LABEL = process.argv[2] ?? "run";
// measuring.md: medians of at least 10 runs.
const RUNS = Math.max(10, +(process.env.RUNS ?? 10) || 10);
const ONLY = process.env.ONLY || null;
const MATCH = process.env.MATCH ? new RegExp(process.env.MATCH) : null;
const SETTLE = +(process.env.SETTLE ?? 300) || 300;
const CHROME =
  process.env.CHROME_BIN ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
if (!process.env.COOKIE_NAME || !process.env.COOKIE_VALUE)
  throw new Error("COOKIE_NAME and COOKIE_VALUE are required");
const COOKIE = {
  name: process.env.COOKIE_NAME,
  value: process.env.COOKIE_VALUE,
  domain: new URL(HOST).hostname,
  path: "/",
};
const START = `${HOST}/cgi-bin/luci/admin/status/overview`;

const median = (v) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* ---------- chrome + CDP ---------- */
const profile = mkdtempSync(join(tmpdir(), "cdp-aurora-router-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
   "--no-first-run", "--no-default-browser-check", "--ignore-certificate-errors",
   "--js-flags=--expose-gc", "about:blank"],
  { stdio: "ignore" },
);
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  const f = join(profile, "DevToolsActivePort");
  if (existsSync(f)) port = +readFileSync(f, "utf8").split("\n")[0];
}
if (!port) throw new Error("chrome: no DevToolsActivePort");
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", () => rej(new Error("CDP connect failed")), { once: true });
});
let mid = 0;
const pending = new Map();
const handlers = new Set();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  } else for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    if (ws.readyState !== WebSocket.OPEN) return rej(new Error("CDP disconnected"));
    const id = ++mid;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const waitEvent = (method, sessionId, timeout = 25000) =>
  new Promise((res, rej) => {
    const timer = setTimeout(() => { handlers.delete(h); rej(new Error(`timeout ${method}`)); }, timeout);
    const h = (m) => {
      if (m.method === method && m.sessionId === sessionId) {
        clearTimeout(timer); handlers.delete(h); res(m.params);
      }
    };
    handlers.add(h);
  });

const consoleErrors = [];
let p = null;
async function recover(reason) {
  process.stderr.write(`recover: ${reason}\n`);
  try { await send("Target.closeTarget", { targetId: p.targetId }); } catch {}
  p = await newPage();
  await fullLoad(p.sessionId, START);
  await evaljs(p.sessionId, "window.__sameDocMarker = 1");
}
async function newPage() {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Log.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride",
    { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
  handlers.add((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.exceptionThrown")
      consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
      consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error"
        && !/favicon|ERR_/.test(m.params.entry.text))
      consoleErrors.push(m.params.entry.text);
  });
  // View-paint clock for full loads: first non-spinner child of #view.
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    window.__viewReady = null;
    new MutationObserver(() => {
      const v = document.getElementById('view');
      if (v && v.querySelector(':scope > :not(.spinning):not(script)') && window.__viewReady == null)
        window.__viewReady = performance.now();
    }).observe(document, { childList: true, subtree: true });` }, sessionId);
  return { targetId, sessionId };
}
async function evaljs(sessionId, expression, awaitPromise = false, timeout = 30000) {
  const r = await Promise.race([
    send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, sessionId),
    new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate stalled (renderer busy?)")), timeout)),
  ]);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function fullLoad(sessionId, url) {
  const load = waitEvent("Page.loadEventFired", sessionId);
  await send("Page.navigate", { url }, sessionId);
  await load;
  await waitViewSettled(sessionId);
  const login = await evaljs(sessionId, `!!document.querySelector('input[name="luci_username"]')`);
  if (login) throw new Error(`landed on the login form for ${url}`);
}
async function waitViewSettled(sessionId, timeout = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await evaljs(sessionId, `(() => {
      const v = document.getElementById('view');
      return !v || !!v.querySelector(':scope > :not(.spinning):not(script)') ||
        (v.childElementCount === 0 && document.readyState === 'complete' && (window.L?.loaded ?? false));
    })()`);
    if (ok) return;
    await sleep(50);
  }
}
const SNAPSHOT = `(() => JSON.stringify({
  url: location.pathname,
  title: document.title,
  page: document.body.dataset.page,
  dispatch: (L.env.dispatchpath || []).join('/'),
  request: (L.env.requestpath || []).join('/'),
  tabs: document.querySelectorAll('#tabmenu a').length,
  activeTab: document.querySelector('#tabmenu li.active a')?.textContent ?? null,
  activeNav: [...document.querySelectorAll('#sidebar-list a.is-active-page, #mobile-nav-list a.is-active-page, .desktop-menu-canvas a.is-active-page, #topmenu a.is-active-page')].map(a => a.getAttribute('href'))[0] ?? null,
  footer: !!document.querySelector('#view .cbi-page-actions'),
  readonly: L.env.nodespec?.readonly === true,
  perm: L.hasViewPermission(),
  foreign: [...document.querySelectorAll('style, link[rel~="stylesheet"]')].filter(l => !document.getElementById('view')?.contains(l) && !l.hasAttribute('data-aurora-shell') && !l.hasAttribute('data-aurora-patch') && !l.hasAttribute('data-aurora-node-css')).map(l => l.tagName + (l.href ? ':' + l.href.replace(HOST, '') : '')),
  status: document.getElementById('aurora-nav-status')?.textContent ?? null,
  nodeCss: [...document.querySelectorAll('link[data-aurora-node-css]')].filter(l => !l.disabled).map(l => l.getAttribute('data-aurora-node-css')).sort().join(','),
  viewChildren: document.getElementById('view')?.childElementCount ?? -1,
  viewIds: document.querySelectorAll('[id="view"]').length,
  h1: document.querySelector('#view h2, #maincontent > h2')?.textContent ?? null,
  svgLines: document.querySelectorAll('#view svg line').length,
  // DOM shape of the rendered view: per tag+class, [elements, elements with text].
  shape: (() => { const m = {}; for (const el of document.querySelectorAll('#view *')) {
    const k = el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).sort().join('.') : '');
    (m[k] ??= [0, 0]); m[k][0]++; if (el.textContent.trim()) m[k][1]++; } return m; })(),
  marker: window.__sameDocMarker ?? null,
}))()`;
async function snapshot(sessionId) { return JSON.parse(await evaljs(sessionId, SNAPSHOT)); }
// A navigation the router does not take becomes a real document load, which
// tears down the evaluation ("Inspected target navigated"): report it as a
// fallback after the new document has loaded.
async function spaNavigate(sessionId, url) {
  const load = waitEvent("Page.loadEventFired", sessionId, 25000);
  load.catch(() => {});
  try {
    const r = JSON.parse(await evaljs(sessionId, `(async () => {
      // A user hovers before clicking; the router prewarms (and, for template
      // nodes, fetches the shell) on that intent.
      const link = [...document.querySelectorAll('a[href]')].find(a => a.href === ${JSON.stringify(url)});
      if (link) { link.dispatchEvent(new Event('pointerover', { bubbles: true })); await new Promise(r => setTimeout(r, 400)); }
      const t0 = performance.now();
      let error = null;
      try {
        await Promise.race([navigation.navigate(${JSON.stringify(url)}).finished,
          new Promise((_, rej) => setTimeout(() => rej(new Error("router did not finish in 20 s")), 20000))]);
      } catch (e) { error = String(e); }
      return JSON.stringify({ ms: performance.now() - t0, error, sameDoc: window.__sameDocMarker === 1,
        state: { views: document.querySelectorAll('[id="view"]').length, page: document.body.dataset.page } });
    })()`, true));
    if (r.sameDoc) return r;
    await load; await waitViewSettled(sessionId);
    await evaljs(sessionId, "window.__sameDocMarker = 1");
    return r;
  } catch (e) {
    if (!/navigated or closed/.test(e.message)) throw e;
    await load; await waitViewSettled(sessionId);
    await evaljs(sessionId, "window.__sameDocMarker = 1");
    return { ms: null, error: null, sameDoc: false };
  }
}

/* ---------- discover pages ---------- */
await send("Storage.setCookies", { cookies: [COOKIE] });
p = await newPage();
await fullLoad(p.sessionId, START);
await evaljs(p.sessionId, "window.__sameDocMarker = 1");
const routerActive = await evaljs(p.sessionId,
  `!!window.navigation && performance.getEntriesByType('resource').some(e => /router-aurora\.js/.test(e.name))`);
const menuLinks = JSON.parse(await evaljs(p.sessionId, `JSON.stringify([...new Set(
  [...document.querySelectorAll('#mobile-nav-list a[href], #sidebar-list a[href]')]
    .map(a => a.href).filter(h => /\\/cgi-bin\\/luci\\/admin\\//.test(h) && !/logout/.test(h)))])`));
const pages = new Set(menuLinks);
process.stderr.write(`router active: ${routerActive}, menu links: ${menuLinks.length}\n`);
for (const url of menuLinks) {
  process.stderr.write(`discover ${url.replace(HOST, "")}\n`);
  const r = await spaNavigate(p.sessionId, url).catch((e) => ({ error: e.message }));
  process.stderr.write(`  -> ${JSON.stringify(r)}\n`);
  if (/stalled/.test(r.error ?? "")) await recover(`discover ${url}`);
  if (r.error) continue;
  const tabs = JSON.parse(await evaljs(p.sessionId,
    `JSON.stringify([...document.querySelectorAll('#tabmenu a[href]')].map(a => a.href))`));
  for (const t of tabs) pages.add(t);
}
const PAGES = [...pages];
process.stderr.write(`discovered ${PAGES.length} pages\n`);
const out = { label: LABEL, host: HOST, routerActive, pages: PAGES.length };

/* ---------- walk ---------- */
if (!ONLY || ONLY === "walk") {
  const divergences = [], fallbacks = [], ok = [], errors = [], injectors = [];
  for (const url of PAGES.filter((u) => !MATCH || MATCH.test(u))) {
   const t0 = Date.now();
   try {
    consoleErrors.length = 0;
    await fullLoad(p.sessionId, START);
    await evaljs(p.sessionId, "window.__sameDocMarker = 1");
    const nav = await spaNavigate(p.sessionId, url);
    if (!nav.sameDoc) { fallbacks.push(url.replace(HOST, "")); continue; }
    await waitViewSettled(p.sessionId);
    await sleep(SETTLE);
    const soft = await snapshot(p.sessionId);
    const softErrors = [...consoleErrors]; consoleErrors.length = 0;
    await fullLoad(p.sessionId, url);
    await sleep(SETTLE);
    const full = await snapshot(p.sessionId);
    // a page's own console errors (missing binaries, 404s) show on both paths
    const fullErrors = new Set(consoleErrors.map((e) => e.split("\n")[0]));
    const routerErrors = softErrors.filter((e) => !fullErrors.has(e.split("\n")[0]));
    const diffs = [];
    for (const k of ["url", "title", "page", "dispatch", "request", "tabs", "activeTab", "activeNav", "footer", "readonly", "perm", "nodeCss", "h1", "svgLines"])
      if (String(soft[k]) !== String(full[k])) diffs.push(`${k}: router=${soft[k]} full=${full[k]}`);
    if (soft.viewIds !== 1) diffs.push(`viewIds=${soft.viewIds}`);
    for (const k of new Set([...Object.keys(soft.shape), ...Object.keys(full.shape)])) {
      const a = soft.shape[k] ?? [0, 0], b = full.shape[k] ?? [0, 0];
      // tolerate small count drift (live tables), flag missing kinds and lost text
      if (Math.abs(a[0] - b[0]) > Math.max(2, b[0] * 0.25) || (b[1] > 0 && a[1] === 0 && b[0] <= 20 && a[0] > 0))
        diffs.push(`shape ${k}: router=${a} full=${b}`);
    }
    if (soft.viewChildren <= 0 && full.viewChildren > 0) diffs.push("view empty under router");
    if (soft.status !== soft.title) diffs.push(`live region: ${soft.status}`);
    if (full.foreign.length) injectors.push({ url: url.replace(HOST, ""), foreign: full.foreign });
    if (routerErrors.length) diffs.push(`console: ${routerErrors.slice(0, 2).join(" | ").slice(0, 200)}`);
    (diffs.length ? divergences : ok).push({ url: url.replace(HOST, ""), diffs });
   } catch (e) {
     errors.push({ url: url.replace(HOST, ""), error: e.message });
     if (/stalled/.test(e.message)) await recover(`walk ${url}`);
   }
   process.stderr.write(`walk ${url.replace(HOST, "")} ${Date.now() - t0} ms\n`);
  }
  out.walk = { ok: ok.length, fallbacks, divergences, errors, injectors };
}

/* ---------- timing ---------- */
if (!ONLY || ONLY === "timing") {
  const sample = PAGES.filter((u) => !/overview/.test(u)).slice(0, 8);
  const rows = [];
  for (const url of sample) {
    // full load: navigation start → first non-spinner content in #view
    const full = [];
    for (let i = 0; i < RUNS; i++) {
      await fullLoad(p.sessionId, i % 2 ? START : `${HOST}/cgi-bin/luci/admin/system/system`);
      await fullLoad(p.sessionId, url);
      const t = await evaljs(p.sessionId, "window.__viewReady");
      if (t != null) full.push(t);
    }
    // router, cold (fresh document, module never required) then warm
    await fullLoad(p.sessionId, START);
    await evaljs(p.sessionId, "window.__sameDocMarker = 1");
    const cold = await spaNavigate(p.sessionId, url);
    const warm = [];
    for (let i = 0; i < RUNS; i++) {
      await spaNavigate(p.sessionId, START);
      const r = await spaNavigate(p.sessionId, url);
      if (!r.error && r.sameDoc) warm.push(r.ms);
    }
    rows.push({ page: url.replace(`${HOST}/cgi-bin/luci`, ""),
      fullLoadMs: +median(full).toFixed(0), spaColdMs: +cold.ms.toFixed(0),
      spaWarmMs: +median(warm).toFixed(0), n: [full.length, warm.length] });
  }
  out.timing = rows;
}

/* ---------- soak ---------- */
if (!ONLY || ONLY === "soak") {
  await fullLoad(p.sessionId, START);
  await evaljs(p.sessionId, "window.__sameDocMarker = 1");
  const laps = 5, ring = PAGES.slice(0, 12);
  const samples = [];
  const measure = async () => {
    await evaljs(p.sessionId, "typeof gc === 'function' && gc()");
    await sleep(200);
    const m = await send("Performance.getMetrics", {}, p.sessionId).catch(() => null);
    const g = (n) => m?.metrics.find((x) => x.name === n)?.value ?? null;
    const inpage = JSON.parse(await evaljs(p.sessionId, `JSON.stringify({
      pollQueue: L.Poll.queue.length, viewIds: document.querySelectorAll('[id="view"]').length,
      sheets: document.querySelectorAll('style, link[rel~=stylesheet]').length })`));
    samples.push({ heapMB: +((g("JSHeapUsedSize") ?? 0) / 1048576).toFixed(2), nodes: g("Nodes"),
      listeners: g("JSEventListeners"), ...inpage });
  };
  await send("Performance.enable", {}, p.sessionId);
  await measure();
  for (let lap = 0; lap < laps; lap++) {
    for (const url of ring) { const r = await spaNavigate(p.sessionId, url); if (!r.sameDoc) break; }
    await spaNavigate(p.sessionId, START);
    await measure();
  }
  out.soak = { navigations: laps * (ring.length + 1), samples };
}

/* ---------- back ---------- */
if (!ONLY || ONLY === "back") {
  await fullLoad(p.sessionId, START);
  await evaljs(p.sessionId, "window.__sameDocMarker = 1");
  // Two alias/firstchild URLs (from the menu tree, resolved client-side by
  // the router) interleaved with two view URLs.
  const redirecting = JSON.parse(await evaljs(p.sessionId, `(async () => {
    const tree = await L.require('ui').then(ui => ui.menu.load());
    const out = [];
    (function walk(node, segs) {
      for (const [name, child] of Object.entries(node.children ?? {})) {
        const path = [...segs, name];
        const t = child.action?.type;
        if (child.satisfied && child.title && (t === 'alias' || t === 'firstchild') && path[0] === 'admin' && path.length >= 3)
          out.push(L.url(...path));
        walk(child, path);
      }
    })(tree, []);
    return JSON.stringify(out.map(u => new URL(u, location.href).href));
  })()`, true)).filter((u) => PAGES.includes(u) && /\/admin\/(status|network)\//.test(u)).slice(0, 2);
  const views = PAGES.filter((u) => !redirecting.includes(u) && u !== START).slice(0, 2);
  const chain = [redirecting[0], views[0], redirecting[1], views[1]].filter(Boolean);
  process.stderr.write(`back chain: ${chain.map((u) => u.replace(HOST, "")).join(" → ")}\n`);
  if (redirecting.length < 2) process.stderr.write("back: fewer than 2 alias/firstchild pages found\n");
  for (const url of chain) {
    const r = await spaNavigate(p.sessionId, url);
    process.stderr.write(`  ${url.replace(HOST, "")} sameDoc=${r.sameDoc}\n`);
  }
  const steps = [];
  for (let i = chain.length - 1; i >= 0; i--) {
    let r;
    try {
      r = JSON.parse(await evaljs(p.sessionId, `(async () => {
        const t0 = performance.now();
        try { await navigation.back().finished; } catch (e) { return JSON.stringify({ error: String(e) }); }
        return JSON.stringify({ ms: performance.now() - t0, sameDoc: window.__sameDocMarker === 1,
          url: location.pathname, page: document.body.dataset.page });
      })()`, true));
    } catch (e) {
      if (!/navigated or closed/.test(e.message)) throw e;
      // cross-document traversal: a bfcache restore fires no load event, so
      // poll until the (restored or new) document answers
      for (let t = 0; t < 100; t++) {
        try { if (await evaljs(p.sessionId, "document.readyState") === "complete") break; } catch {}
        await sleep(100);
      }
      await waitViewSettled(p.sessionId);
      await evaljs(p.sessionId, "window.__sameDocMarker = 1");
      r = { sameDoc: false, url: await evaljs(p.sessionId, "location.pathname"), page: await evaljs(p.sessionId, "document.body.dataset.page") };
    }
    const expected = i > 0 ? chain[i - 1] : START;
    steps.push({ ...r, ok: r.sameDoc && `${HOST}${r.url}` === expected.split("?")[0] });
  }
  out.back = { chain: chain.map((u) => u.replace(HOST, "")), redirectingInChain: redirecting.length,
    steps: steps.length, allSameDocument: steps.every((s) => s.sameDoc),
    allCorrect: steps.every((s) => s.ok), detail: steps };
}

/* ---------- poison gate ---------- */
if (!ONLY || ONLY === "poison") {
  await fullLoad(p.sessionId, START);
  await evaljs(p.sessionId, "window.__sameDocMarker = 1");
  const [a, b] = PAGES.filter((u) => u !== START).slice(0, 2);
  const before = await spaNavigate(p.sessionId, a);
  // what a foreign view does: an unlayered <style> straight into <head>
  await evaljs(p.sessionId, `document.head.appendChild(Object.assign(document.createElement('style'),
    { textContent: '.cbi-button-save{display:none!important}' })).id = 'poison'`);
  const poisoned = await spaNavigate(p.sessionId, b);          // must be a full load
  const stillPoisoned = await evaljs(p.sessionId, "!!document.getElementById('poison')");
  const after = await spaNavigate(p.sessionId, a);             // fresh document → router again
  out.poison = { beforeSameDoc: before.sameDoc, poisonedFullLoad: !poisoned.sameDoc,
    styleGoneAfterFullLoad: !stillPoisoned, afterSameDoc: after.sameDoc,
    ok: before.sameDoc && !poisoned.sameDoc && !stillPoisoned && after.sameDoc };
}

/* ---------- foreign sheets ---------- */
if (!ONLY || ONLY === "sheets") {
  const FOREIGN = `[...document.querySelectorAll('style, link[rel~="stylesheet"]')].filter(l => !document.getElementById('view')?.contains(l) && !l.hasAttribute('data-aurora-shell') && !l.hasAttribute('data-aurora-patch') && !l.hasAttribute('data-aurora-node-css')).length`;
  const injecting = out.walk?.injectors?.map((i) => HOST + i.url) ?? [];
  if (!injecting.length && ONLY === "sheets")
    for (const url of PAGES.filter((u) => u !== START)) {
      await fullLoad(p.sessionId, url);
      if (await evaljs(p.sessionId, FOREIGN)) injecting.push(url);
      if (injecting.length >= 3) break;
    }
  const cases = [];
  for (const a of injecting.slice(0, 3)) {
    const [b, c] = PAGES.filter((u) => u !== START && u !== a);
    await fullLoad(p.sessionId, START);
    await evaljs(p.sessionId, "window.__sameDocMarker = 1");
    const arrive = await spaNavigate(p.sessionId, a);
    // A page the router does not serve (Lua, call) is a full load either way.
    if (!arrive.sameDoc) { cases.push({ a: a.replace(HOST, ""), skipped: "not a view page" }); continue; }
    await waitViewSettled(p.sessionId); await sleep(300);
    const foreign = await evaljs(p.sessionId, FOREIGN);
    const leave = await spaNavigate(p.sessionId, b);          // poison gate → full load
    const after = await spaNavigate(p.sessionId, c);          // fresh document → router again
    // Landing on the page itself: its modules insert before the router boots;
    // the markers, not a snapshot, must still tell those sheets apart.
    await fullLoad(p.sessionId, a);
    await evaljs(p.sessionId, "window.__sameDocMarker = 1");
    const fromBoot = await spaNavigate(p.sessionId, b);
    cases.push({ a: a.replace(HOST, ""), foreign, arriveSameDoc: arrive.sameDoc, leaveFullLoad: !leave.sameDoc, afterSameDoc: after.sameDoc,
      leaveFromBootFullLoad: !fromBoot.sameDoc,
      ok: arrive.sameDoc && foreign > 0 && !leave.sameDoc && after.sameDoc && !fromBoot.sameDoc });
  }
  const tested = cases.filter((c) => !c.skipped);
  out.sheets = tested.length ? { cases, ok: tested.every((c) => c.ok) } : { skipped: "no walked view page inserts a stylesheet", cases };
}

/* ---------- hygiene ---------- */
if (!ONLY || ONLY === "hygiene") {
  await fullLoad(p.sessionId, START);
  await evaljs(p.sessionId, "window.__sameDocMarker = 1");
  const b = PAGES.find((u) => u !== START);
  const nav = await spaNavigate(p.sessionId, b);
  await waitViewSettled(p.sessionId); await sleep(300);
  // Back on Overview, which polls, so the visibility gate has a timer to stop.
  const home = await spaNavigate(p.sessionId, START);
  await waitViewSettled(p.sessionId); await sleep(1500);
  const r = JSON.parse(await evaljs(p.sessionId, `(async () => {
    const bar = !!document.getElementById('aurora-nav-progress');
    const status = document.getElementById('aurora-nav-status')?.textContent;
    const wasActive = L.Poll.active();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hiddenActive = L.Poll.active();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    const shownActive = L.Poll.active();
    return JSON.stringify({ bar, status, title: document.title, wasActive, hiddenActive, shownActive });
  })()`, true));
  out.hygiene = { ...r, sameDoc: nav.sameDoc && home.sameDoc,
    ok: nav.sameDoc && home.sameDoc && r.bar && r.status === r.title && r.wasActive && !r.hiddenActive && r.shownActive };
}

/* ---------- menu.d node css ---------- */
if (!ONLY || ONLY === "nodecss") {
  const LINKS = `JSON.stringify([...document.querySelectorAll('link[data-aurora-node-css]')].map(l => [l.getAttribute('data-aurora-node-css'), !l.disabled]))`;
  let styled = null;
  for (const url of PAGES.filter((u) => u !== START)) {
    await fullLoad(p.sessionId, url);
    if (JSON.parse(await evaljs(p.sessionId, LINKS)).length) { styled = url; break; }
  }
  if (!styled) out.nodecss = { skipped: "no installed menu.d node declares css" };
  else {
    const other = PAGES.find((u) => u !== START && u !== styled);
    await fullLoad(p.sessionId, START);
    await evaljs(p.sessionId, "window.__sameDocMarker = 1");
    const arrive = await spaNavigate(p.sessionId, styled);
    const onArrival = JSON.parse(await evaljs(p.sessionId, LINKS));
    const leave = await spaNavigate(p.sessionId, other);
    const afterLeave = JSON.parse(await evaljs(p.sessionId, LINKS));
    const back = await spaNavigate(p.sessionId, styled);
    const onReturn = JSON.parse(await evaljs(p.sessionId, LINKS));
    out.nodecss = { page: styled.replace(HOST, ""), onArrival, afterLeave, onReturn,
      ok: arrive.sameDoc && leave.sameDoc && back.sameDoc &&
        onArrival.length === 1 && onArrival[0][1] === true &&
        afterLeave.length === 1 && afterLeave[0][1] === false &&
        onReturn.length === 1 && onReturn[0][1] === true };
  }
}

/* ---------- session expiry ---------- */
if (!ONLY || ONLY === "expiry") {
  await fullLoad(p.sessionId, START);
  await evaljs(p.sessionId, "window.__sameDocMarker = 1");
  const [a, b] = PAGES.filter((u) => u !== START).slice(0, 2);
  const before = await spaNavigate(p.sessionId, a);
  // What a real expiry looks like from inside the document: the session is
  // gone server-side and the next RPC comes back -32002; luci-base probes
  // session.access, then shows its modal and stops polling.
  const seen = JSON.parse(await evaljs(p.sessionId, `(async () => {
    await fetch(L.url('admin/logout'), { credentials: 'same-origin' }).catch(() => {});
    const rpc = await L.require('rpc');
    await rpc.declare({ object: 'system', method: 'board' })().catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    return JSON.stringify({ modal: !!document.querySelector('.modal'), pollActive: L.Poll.active() });
  })()`, true));
  const nav = await spaNavigate(p.sessionId, b);              // must be a full load
  const login = await evaljs(p.sessionId, `!!document.querySelector('input[name="luci_username"]')`);
  out.expiry = { beforeSameDoc: before.sameDoc, modalShown: seen.modal, pollStopped: !seen.pollActive,
    expiredFullLoad: !nav.sameDoc, landedOnLogin: login,
    ok: before.sameDoc && seen.modal && !nav.sameDoc && login };
}

console.log(JSON.stringify(out, null, 2));
ws.close();
if (chrome.exitCode == null) { const exited = once(chrome, "exit"); chrome.kill(); await Promise.race([exited, sleep(2000)]); }
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
