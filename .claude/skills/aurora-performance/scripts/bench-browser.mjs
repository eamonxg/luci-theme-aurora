#!/usr/bin/env node
/**
 * bench-browser.mjs <label> — real-browser navigation metrics for a LuCI
 * theme, driven over raw CDP (headless Chrome, zero npm dependencies;
 * needs node >= 22 for the global WebSocket). Companion to bench.mjs: that
 * one measures what curl can see, this one measures what only a browser
 * can (prefetch hits, bfcache restores, polling behavior).
 *
 * env: HOST (default http://192.168.1.1), COOKIE_NAME, COOKIE_VALUE,
 *      CHROME_BIN, RUNS (default 10),
 *      ONLY (doc|click|back|polling|vt — run one scenario)
 *
 * Auth: obtain a session cookie first, then pass it in:
 *   curl -k -c jar.txt -d 'luci_username=root&luci_password=…' $HOST/cgi-bin/luci/
 *   COOKIE_NAME=sysauth_https COOKIE_VALUE=<from jar> …
 *
 * Scenarios:
 *   S1 document navigation timing (median of RUNS)
 *   S2 link click with 450 ms hover first vs immediate click (speculation
 *      rules fire on hover; deliveryType 'navigational-prefetch' proves a
 *      prefetch hit)
 *   S3 back/forward: bfcache restore + time to first /ubus request after
 *      restore (poll freshness)
 *   S4 polling rate, visible vs synthetically-hidden (20 s windows)
 *   S5 cross-document view-transition activation: `pagereveal.viewTransition`
 *      is non-null only when a transition actually runs — checked normally
 *      and under emulated prefers-reduced-motion (must be off there)
 *
 * Measurement caveats (learned the hard way — see measuring.md):
 *   - Speculation Rules are a secure-context API: over plain HTTP the
 *     rules parse but never fire. Run S2 against https:// (a self-signed
 *     uhttpd cert is enough; the launcher passes
 *     --ignore-certificate-errors).
 *   - Headless Chrome suspends timers in non-active tabs wholesale, which
 *     zeroes S4 for BOTH states; the synthetic visibilitychange on the
 *     active tab is what isolates the theme's own pause handler.
 *   - S2 needs a *visible* target link (mega-menu panel links are hidden
 *     until the menu opens and cannot be hovered by coordinates).
 */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  assertAuthenticatedPage,
  authCookie,
  chromeExecutable,
  median,
  normalizeHttpOrigin,
  parseRunCount,
  parseScenario,
  rejectPendingRequests,
  withCleanup,
} from "./bench-lib.js";

const HOST = normalizeHttpOrigin(process.env.HOST ?? "http://192.168.1.1");
const LABEL = process.argv[2] ?? "run";
const RUNS = parseRunCount(process.env.RUNS);
const ONLY = parseScenario(process.env.ONLY);
const CHROME = chromeExecutable(process.env, process.platform);
const COOKIE = authCookie(process.env.COOKIE_NAME, process.env.COOKIE_VALUE, HOST);
const PAGE_A_PATH = "/cgi-bin/luci/admin/system/system";
const PAGE_B_PATH = "/cgi-bin/luci/admin/system/admin";
const PAGE_A = new URL(PAGE_A_PATH, HOST).href;
const PAGE_B = new URL(PAGE_B_PATH, HOST).href;
const PAGE_B_MATCH = PAGE_B_PATH.replace("/cgi-bin/luci", "");

let chrome = null;
let pending = new Map();
let profile = null;
let waiters = new Set();
let ws = null;

await withCleanup(async () => {
/* ---------- launch chrome ---------- */
profile = mkdtempSync(join(tmpdir(), "cdp-aurora-"));
chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
   "--no-first-run", "--no-default-browser-check",
   "--ignore-certificate-errors", "about:blank"],
  { stdio: ["ignore", "ignore", "ignore"] },
);
let launchError = null;
chrome.once("error", (error) => { launchError = error; });
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  if (launchError)
    throw new Error(`chrome: failed to launch ${CHROME}: ${launchError.message}`);
  const f = join(profile, "DevToolsActivePort");
  if (existsSync(f)) port = +readFileSync(f, "utf8").split("\n")[0];
}
if (!port) throw new Error("chrome: no DevToolsActivePort");
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

/* ---------- minimal CDP client ---------- */
ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", () => reject(new Error("CDP connection failed")), { once: true });
});
let mid = 0;
const handlers = new Set();
const disconnect = () => {
  const error = new Error("CDP disconnected");
  rejectPendingRequests(pending, error);
  rejectPendingRequests(waiters, error);
};
ws.addEventListener("close", disconnect);
ws.addEventListener("error", disconnect);
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(`${m.error.message}`)) : res(m.result);
  } else for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    if (ws.readyState !== WebSocket.OPEN) return rej(new Error("CDP disconnected"));
    const id = ++mid;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const isDisconnected = (error) => /CDP disconnected/.test(error?.message);
const waitEvent = (method, sessionId, timeout = 25000) =>
  new Promise((res, rej) => {
    let timer, handler, waiter;
    const finish = (callback, value) => {
      clearTimeout(timer); handlers.delete(handler); waiters.delete(waiter); callback(value);
    };
    timer = setTimeout(() => finish(rej, new Error(`timeout ${method}`)), timeout);
    waiter = { rej: (error) => finish(rej, error) };
    handler = (m) => {
      if (m.method === method && m.sessionId === sessionId) finish(res, m.params);
    };
    handlers.add(handler);
    waiters.add(waiter);
  });

async function newPage() {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  return { targetId, sessionId };
}
async function evaljs(sessionId, expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "evaluate failed");
  return r.result.value;
}
async function assertAuthenticated(sessionId) {
  const state = await evaljs(sessionId, `JSON.stringify({
    hasLoginForm:!!document.querySelector('input[name="luci_username"]'),
    hasMainContent:!!document.querySelector('#maincontent'),url:location.href})`);
  assertAuthenticatedPage(JSON.parse(state));
}
async function nav(sessionId, url) {
  const load = waitEvent("Page.loadEventFired", sessionId);
  await send("Page.navigate", { url }, sessionId);
  await load;
  await assertAuthenticated(sessionId);
}
async function waitForValue(sessionId, expression, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await evaljs(sessionId, expression);
      if (value != null) return value;
    } catch (error) {
      if (isDisconnected(error)) throw error;
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for page state");
}
const navEntry = (sessionId) =>
  evaljs(sessionId, `(()=>{const e=performance.getEntriesByType('navigation')[0];
    return JSON.stringify({ttfb:e.responseStart,dur:e.duration,transfer:e.transferSize,
      type:e.type,delivery:e.deliveryType??''})})()`).then(JSON.parse);
const roundedMedian = (values) => +median(values).toFixed(1);

/* ---------- auth cookie ---------- */
await send("Storage.setCookies", { cookies: [COOKIE] });

const out = { label: LABEL };

/* ---------- S1: document navigation timing ---------- */
if (!ONLY || ONLY === "doc") {
  const p = await newPage();
  const t = [], d = [], tr = [], types = {};
  // Same-URL Page.navigate becomes a reload (revalidates every subresource);
  // alternate targets so every run is a plain navigation.
  for (let i = 0; i < RUNS; i++) {
    await nav(p.sessionId, i % 2 ? PAGE_B : PAGE_A);
    const e = await navEntry(p.sessionId);
    t.push(e.ttfb); d.push(e.dur); tr.push(e.transfer);
    types[e.type] = (types[e.type] ?? 0) + 1;
  }
  out.doc = { ttfb: roundedMedian(t), loadDur: roundedMedian(d),
    transfer: roundedMedian(tr), n: t.length, types };
  await send("Target.closeTarget", { targetId: p.targetId });
}

/* ---------- S2: hover-prefetch click vs immediate click ---------- */
async function clickNav(sessionId, hoverMs) {
  await nav(sessionId, PAGE_A);
  const raw = await waitForValue(sessionId, `(()=>{
    const a=[...document.querySelectorAll('a[href*="${PAGE_B_MATCH}"]')]
      .find(x=>x.getBoundingClientRect().width>0);
    if(!a)return null; a.scrollIntoView({block:'center'});
    const r=a.getBoundingClientRect();
    return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height});})()`);
  const rect = JSON.parse(raw);
  if (hoverMs) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y }, sessionId);
    await sleep(hoverMs);
  }
  const load = waitEvent("Page.loadEventFired", sessionId);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 }, sessionId);
  await load;
  await assertAuthenticated(sessionId);
  return navEntry(sessionId);
}
if (!ONLY || ONLY === "click") {
  const p = await newPage();
  const hov = [], plain = [];
  let hovPrefetched = 0, plainPrefetched = 0;
  for (let i = 0; i < RUNS; i++) {
    const e = await clickNav(p.sessionId, 450);
    hov.push(e.ttfb); if (e.delivery === "navigational-prefetch") hovPrefetched++;
  }
  for (let i = 0; i < RUNS; i++) {
    const e = await clickNav(p.sessionId, 0);
    plain.push(e.ttfb); if (e.delivery === "navigational-prefetch") plainPrefetched++;
  }
  out.click = {
    hoverTtfb: roundedMedian(hov), hoverPrefetchHits: `${hovPrefetched}/${hov.length}`,
    plainTtfb: roundedMedian(plain), plainPrefetchHits: `${plainPrefetched}/${plain.length}`,
  };
  await send("Target.closeTarget", { targetId: p.targetId });
}

/* ---------- S3: back/forward + poll freshness ---------- */
if (!ONLY || ONLY === "back") {
  const p = await newPage();
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__ps=null;addEventListener('pageshow',e=>{window.__ps={p:e.persisted,t:Date.now()}})",
  }, p.sessionId);
  const ubusTimes = [];
  const netH = (m) => {
    if (m.method === "Network.requestWillBeSent" && m.sessionId === p.sessionId
        && m.params.request.url.includes("/ubus")) ubusTimes.push(Date.now());
  };
  handlers.add(netH);
  await nav(p.sessionId, PAGE_A);
  await sleep(1200);
  await nav(p.sessionId, PAGE_B);
  await sleep(1200);
  const backAt = Date.now();
  await evaljs(p.sessionId, "history.back()");
  let restored = null;
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    try {
      const ps = await evaljs(p.sessionId, "JSON.stringify(window.__ps)");
      const v = ps && JSON.parse(ps);
      if (v && v.t >= backAt - 5) { restored = v; break; }
    } catch (error) {
      if (isDisconnected(error)) throw error;
    }
  }
  if (!restored) throw new Error("back navigation did not produce pageshow");
  await assertAuthenticated(p.sessionId);
  let firstUbus = null;
  if (restored) {
    for (let i = 0; i < 120 && firstUbus == null; i++) {
      await sleep(50);
      const hit = ubusTimes.find((t) => t >= restored.t);
      if (hit) firstUbus = hit;
    }
  }
  out.back = {
    bfcacheRestored: restored ? restored.p : null,
    restoreMs: restored ? restored.t - backAt : null,
    firstUbusAfterBackMs: firstUbus ? firstUbus - backAt : null,
  };
  handlers.delete(netH);
  await send("Target.closeTarget", { targetId: p.targetId });
}

/* ---------- S4: polling rate, visible vs synthetically-hidden ----------
 * The tab stays ACTIVE throughout: backgrounding a headless tab suspends
 * its timers wholesale, which zeroes both A and B states and hides the
 * handler under test. A synthetic visibilitychange on the active tab
 * keeps timers running, so only the theme's own pause handler (if any)
 * can stop the polling. */
if (!ONLY || ONLY === "polling") {
  const p = await newPage();
  let count = 0;
  const netH = (m) => {
    if (m.method === "Network.requestWillBeSent" && m.sessionId === p.sessionId
        && m.params.request.url.includes("/ubus")) count++;
  };
  handlers.add(netH);
  await nav(p.sessionId, PAGE_A);
  await send("Target.activateTarget", { targetId: p.targetId });
  await sleep(2000);
  count = 0;
  await sleep(20000);
  const visibleCount = count;

  await evaljs(p.sessionId, `
    Object.defineProperty(document,'visibilityState',{get:()=>'hidden',configurable:true});
    Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});
    document.dispatchEvent(new Event('visibilitychange')); 'ok'`);
  await sleep(1000);
  count = 0;
  await sleep(20000);
  out.polling = { visible20s: visibleCount, hiddenSynthetic20s: count };
  handlers.delete(netH);
  await send("Target.closeTarget", { targetId: p.targetId });
}

/* ---------- S5: view-transition activation ---------- */
if (!ONLY || ONLY === "vt") {
  const p = await newPage();
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "addEventListener('pagereveal',e=>{window.__vt = !!e.viewTransition})",
  }, p.sessionId);
  // Cross-document transitions only run for navigations initiated from
  // inside the page (link clicks, location.assign) — browser-UI-initiated
  // ones, which CDP's Page.navigate counts as, are skipped by spec. So the
  // measured hop must be script-initiated.
  const scriptNav = async (url) => {
    const load = waitEvent("Page.loadEventFired", p.sessionId);
    await evaljs(p.sessionId, `location.assign(${JSON.stringify(url)})`);
    await load;
    await assertAuthenticated(p.sessionId);
  };
  await nav(p.sessionId, PAGE_A);
  await scriptNav(PAGE_B);
  const vtNormal = await evaljs(p.sessionId, "window.__vt === true");
  out.vtDiag = JSON.parse(await evaljs(p.sessionId, `JSON.stringify({
    vtRaw: String(window.__vt),
    pagerevealSupported: 'onpagereveal' in window,
    ruleInCSSOM: [...document.styleSheets].some(s => {
      try { return [...(s.cssRules || [])].some(r => r.constructor?.name === 'CSSViewTransitionRule'); }
      catch { return false; }
    }),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    ua: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] ?? navigator.userAgent,
  })`));
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  }, p.sessionId);
  await scriptNav(PAGE_A);
  const vtReduced = await evaljs(p.sessionId, "window.__vt === true");
  out.viewTransition = { activates: vtNormal, disabledUnderReducedMotion: !vtReduced };
  await send("Target.closeTarget", { targetId: p.targetId });
}

console.log(JSON.stringify(out, null, 2));
}, async () => {
  rejectPendingRequests(pending, new Error("benchmark cleanup"));
  rejectPendingRequests(waiters, new Error("benchmark cleanup"));
  if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  if (chrome?.pid && chrome.exitCode == null && chrome.signalCode == null) {
    const exited = once(chrome, "exit");
    chrome.kill();
    await Promise.race([exited, sleep(2000)]);
  }
  if (profile) rmSync(profile, { recursive: true, force: true });
});
