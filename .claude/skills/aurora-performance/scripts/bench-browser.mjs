#!/usr/bin/env node
/**
 * bench-browser.mjs <label> — real-browser navigation metrics for a LuCI
 * theme, driven over raw CDP (headless Chrome, zero npm dependencies;
 * needs node >= 22 for the global WebSocket). Companion to bench.mjs: that
 * one measures what curl can see, this one measures what only a browser
 * can (prefetch hits, bfcache restores, polling behavior).
 *
 * env: HOST (default http://192.168.1.1), COOKIE_NAME, COOKIE_VALUE,
 *      RUNS (default 7), ONLY (doc|click|back|polling — run one scenario)
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
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const HOST = process.env.HOST ?? "http://192.168.1.1";
const LABEL = process.argv[2] ?? "run";
const RUNS = +(process.env.RUNS ?? 7);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE_A = `${HOST}/cgi-bin/luci/admin/system/system`;
const PAGE_B_MATCH = "/admin/system/admin";

/* ---------- launch chrome ---------- */
const profile = mkdtempSync(join(tmpdir(), "cdp-aurora-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
   "--no-first-run", "--no-default-browser-check",
   "--ignore-certificate-errors", "about:blank"],
  { stdio: ["ignore", "ignore", "ignore"] },
);
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  const f = join(profile, "DevToolsActivePort");
  if (existsSync(f)) port = +readFileSync(f, "utf8").split("\n")[0];
}
if (!port) { chrome.kill(); throw new Error("chrome: no DevToolsActivePort"); }
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

/* ---------- minimal CDP client ---------- */
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let mid = 0;
const pending = new Map();
const handlers = new Set();
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
    const id = ++mid;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const waitEvent = (method, sessionId, timeout = 25000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => { handlers.delete(h); rej(new Error(`timeout ${method}`)); }, timeout);
    const h = (m) => {
      if (m.method === method && m.sessionId === sessionId) {
        clearTimeout(t); handlers.delete(h); res(m.params);
      }
    };
    handlers.add(h);
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
async function nav(sessionId, url) {
  const load = waitEvent("Page.loadEventFired", sessionId);
  await send("Page.navigate", { url }, sessionId);
  await load;
}
const navEntry = (sessionId) =>
  evaljs(sessionId, `(()=>{const e=performance.getEntriesByType('navigation')[0];
    return JSON.stringify({ttfb:e.responseStart,dur:e.duration,transfer:e.transferSize,
      type:e.type,delivery:e.deliveryType??''})})()`).then(JSON.parse);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(1) : null; };

/* ---------- auth cookie ---------- */
if (process.env.COOKIE_NAME) {
  await send("Storage.setCookies", { cookies: [{
    name: process.env.COOKIE_NAME, value: process.env.COOKIE_VALUE,
    domain: HOST.replace(/^https?:\/\//, "").replace(/:.*/, ""), path: "/cgi-bin/luci",
  }] });
}

const out = { label: LABEL };

/* ---------- S1: document navigation timing ---------- */
if (!process.env.ONLY || process.env.ONLY === "doc") {
  const p = await newPage();
  const t = [], d = [], tr = [];
  for (let i = 0; i < RUNS; i++) {
    await nav(p.sessionId, PAGE_A);
    const e = await navEntry(p.sessionId);
    t.push(e.ttfb); d.push(e.dur); tr.push(e.transfer);
  }
  out.doc = { ttfb: median(t), loadDur: median(d), transfer: median(tr), n: t.length };
  await send("Target.closeTarget", { targetId: p.targetId });
}

/* ---------- S2: hover-prefetch click vs immediate click ---------- */
async function clickNav(sessionId, hoverMs) {
  await nav(sessionId, PAGE_A);
  await sleep(900); // menus render client-side
  const raw = await evaljs(sessionId, `(()=>{
    const a=document.querySelector('#maincontent a[href*="${PAGE_B_MATCH}"]')
         ??[...document.querySelectorAll('a[href*="${PAGE_B_MATCH}"]')]
             .find(x=>x.getBoundingClientRect().width>0);
    if(!a)return null; a.scrollIntoView({block:'center'});
    const r=a.getBoundingClientRect();
    return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height});})()`);
  const rect = raw && JSON.parse(raw);
  if (!rect || !rect.w) return null;
  if (hoverMs) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y }, sessionId);
    await sleep(hoverMs);
  }
  const load = waitEvent("Page.loadEventFired", sessionId);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 }, sessionId);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 }, sessionId);
  await load;
  return navEntry(sessionId);
}
if (!process.env.ONLY || process.env.ONLY === "click") {
  const p = await newPage();
  const hov = [], plain = [];
  let hovDelivery = "", plainDelivery = "";
  for (let i = 0; i < 5; i++) {
    const e = await clickNav(p.sessionId, 450);
    if (e) { hov.push(e.ttfb); if (e.delivery) hovDelivery = e.delivery; }
  }
  for (let i = 0; i < 5; i++) {
    const e = await clickNav(p.sessionId, 0);
    if (e) { plain.push(e.ttfb); if (e.delivery) plainDelivery = e.delivery; }
  }
  out.click = {
    hoverTtfb: median(hov), hoverDelivery: hovDelivery || "(none)",
    plainTtfb: median(plain), plainDelivery: plainDelivery || "(none)",
    n: [hov.length, plain.length],
  };
  await send("Target.closeTarget", { targetId: p.targetId });
}

/* ---------- S3: back/forward + poll freshness ---------- */
if (!process.env.ONLY || process.env.ONLY === "back") {
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
  await nav(p.sessionId, `${HOST}/cgi-bin/luci/admin/system/admin`);
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
    } catch { /* transient during swap */ }
  }
  let firstUbus = null;
  if (restored) {
    for (let i = 0; i < 120 && firstUbus == null; i++) {
      await sleep(50);
      const hit = ubusTimes.find((t) => t >= backAt);
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
if (!process.env.ONLY || process.env.ONLY === "polling") {
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
if (!process.env.ONLY || process.env.ONLY === "vt") {
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
  };
  await nav(p.sessionId, PAGE_A);
  await scriptNav(`${HOST}/cgi-bin/luci/admin/system/admin`);
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
chrome.kill();
process.exit(0);
