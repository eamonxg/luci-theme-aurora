#!/usr/bin/env node
/**
 * compat-probe.mjs — before/after a theme CSS change on real device pages,
 * in one page load per page: log in, open the page in headless Chrome,
 * serve BEFORE as the theme's main.css through Fetch interception, measure,
 * hot-swap AFTER into the same document, measure again. Writes nothing on
 * the device. Raw CDP, no npm deps, node >= 22.
 *
 * env:
 *   HOST      http://192.168.8.1 (default: VITE_OPENWRT_HOST from .dev/.env)
 *   PAGES     comma-separated paths after /cgi-bin/luci/ (default: a stock set)
 *   WIDTHS    viewport widths, default 1280,390
 *   BEFORE    css file served as main.css first (default: fetch the device's own)
 *   AFTER     css file swapped in (default: htdocs/luci-static/aurora/main.css)
 *   SELECTOR  elements whose wrap/overflow are counted (default: .table td, .table .td)
 *   PRESET_LS key=value stored in localStorage before load (e.g. the disk a plugin remembers)
 *   OUT       output directory for screenshots + report (default: ./compat-probe-out)
 *   USER/PASS login (default root / empty)
 *   CHROME_BIN
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../../../..");
const envFile = join(root, ".dev/.env");
const dotenv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split("=", 2)))
  : {};
const HOST = (process.env.HOST ?? (dotenv.VITE_OPENWRT_HOST ? `http://${dotenv.VITE_OPENWRT_HOST}` : "http://192.168.1.1")).replace(/\/+$/, "");
const PAGES = (process.env.PAGES ?? "admin/status/overview,admin/network/network,admin/network/firewall,admin/network/dhcp,admin/system/mounts").split(",");
const WIDTHS = (process.env.WIDTHS ?? "1280,390").split(",").map(Number);
const AFTER = readFileSync(process.env.AFTER ?? join(root, "htdocs/luci-static/aurora/main.css"));
const BEFORE = process.env.BEFORE ? readFileSync(process.env.BEFORE) : null;
const SELECTOR = process.env.SELECTOR ?? ".table td, .table .td";
const OUT = resolve(process.env.OUT ?? "compat-probe-out");
const CHROME = process.env.CHROME_BIN ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
mkdirSync(OUT, { recursive: true });

const login = await fetch(`${HOST}/cgi-bin/luci/`, {
  method: "POST",
  body: new URLSearchParams({ luci_username: process.env.USER_NAME ?? "root", luci_password: process.env.PASS ?? "" }),
  redirect: "manual",
});
const cookie = (login.headers.get("set-cookie") ?? "").match(/(sysauth[^=]*)=([^;]+)/);
if (!cookie) throw new Error(`login failed (${login.status})`);

let before = BEFORE;
if (!before) {
  const r = await fetch(`${HOST}/luci-static/aurora/main.css`, { headers: { cookie: `${cookie[1]}=${cookie[2]}` } });
  if (!r.ok) throw new Error(`device main.css: ${r.status}`);
  before = Buffer.from(await r.arrayBuffer());
}

const profile = mkdtempSync(join(tmpdir(), "cdp-compat-probe-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  const f = join(profile, "DevToolsActivePort");
  if (existsSync(f)) port = +readFileSync(f, "utf8").split("\n")[0];
}
if (!port) throw new Error("chrome: no DevToolsActivePort");
const ws = new WebSocket((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", () => rej(new Error("CDP connect failed")), { once: true }); });
let mid = 0; const pending = new Map(); const handlers = new Set();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  else for (const h of handlers) h(m);
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const id = ++mid; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params, sessionId })); });

// Computed font-size/line-height per element under every .table, plus the
// wrap/overflow state of SELECTOR — the two things a table change moves.
const MEASURE = `(() => {
  const pick = (el, pseudo) => { const s = getComputedStyle(el, pseudo); return s.fontSize + '/' + s.lineHeight + ' ' + s.whiteSpace; };
  const path = (el) => { const p = []; for (let e = el; e && e !== document.body; e = e.parentElement) p.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList[0] ? '.' + e.classList[0] : '')); return p.slice(-4).join('>'); };
  const styles = [];
  [...document.querySelectorAll('table.table, .table')].forEach((t, ti) => {
    styles.push(['T' + ti, path(t), pick(t)]);
    t.querySelectorAll('*').forEach((el, i) => {
      if (el.closest('.table') !== t) return;
      const txt = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      styles.push(['T' + ti + '#' + i + (txt ? ' txt' : ''), path(el), pick(el)]);
    });
  });
  const wrapped = [], overflow = [];
  for (const el of document.querySelectorAll(${JSON.stringify(SELECTOR)})) {
    const tops = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { if (!n.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(n); for (const x of r.getClientRects()) if (x.width > 0) tops.push(x.top); }
    const ind = el.querySelector('input, img, svg, [class*=indicator]');
    if (tops.some(t => Math.abs(t - tops[0]) > 3) || (ind && tops.length && tops[0] >= ind.getBoundingClientRect().bottom - 1)) wrapped.push(el.textContent.trim().slice(0, 30));
    if (el.scrollWidth > el.clientWidth + 1) overflow.push(el.textContent.trim().slice(0, 30));
  }
  return { page: document.body.dataset.page, styles, wrapped, overflow, pageOverflow: document.documentElement.scrollWidth > innerWidth };
})()`;

const report = [];
try {
  for (const width of WIDTHS) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    await send("Network.enable", {}, sessionId);
    await send("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
    await send("Network.setCookie", { name: cookie[1], value: cookie[2], domain: new URL(HOST).hostname, path: "/" }, sessionId);
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }, sessionId);
    if (process.env.PRESET_LS) {
      const [k, v] = process.env.PRESET_LS.split("=", 2);
      await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})` }, sessionId);
    }
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/luci-static/aurora/main.css*", requestStage: "Request" }] }, sessionId);
    handlers.add((m) => {
      if (m.sessionId !== sessionId || m.method !== "Fetch.requestPaused") return;
      const body = m.params.request.url.includes("variant=after") ? AFTER : before;
      send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/css" }, { name: "Cache-Control", value: "no-store" }], body: body.toString("base64") }, sessionId);
    });
    const evaljs = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const shot = async (name) => {
      const s = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(join(OUT, name), Buffer.from(s.data, "base64"));
    };
    for (const page of PAGES) {
      await send("Page.navigate", { url: `${HOST}/cgi-bin/luci/${page}` }, sessionId);
      for (let i = 0; i < 80; i++) {
        await sleep(250);
        const ready = await evaljs(`document.readyState === 'complete' && !document.querySelector('#view > .spinning') && !!document.querySelector('#view > :not(script)')`).catch(() => false);
        if (ready) break;
      }
      await sleep(2000);
      if (await evaljs(`!!document.querySelector('input[name="luci_username"]')`)) throw new Error(`landed on the login form for ${page}`);
      // Device on another theme: swap its shell stylesheets for aurora's so the
      // content region can still be measured. Header/nav markup stays foreign,
      // so only in-view numbers mean anything then.
      const foreign = await evaljs(`!document.querySelector('link[rel=stylesheet][href*="/luci-static/aurora/main.css"]')`);
      if (foreign) {
        console.log(`  (device is not on aurora for ${page}: aurora main.css injected over the active theme; compare the content region only)`);
        await evaljs(`new Promise(r => {
          document.querySelectorAll('link[rel=stylesheet][href*="/luci-static/"]').forEach(l => { if (!/\\/resources\\//.test(l.href)) l.remove(); });
          const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/luci-static/aurora/main.css?probe=before', onload: r });
          document.head.append(l);
        })`);
        await sleep(400);
      }
      const b = await evaljs(MEASURE);
      const slug = page.replaceAll("/", "-");
      await shot(`${slug}-${width}-before.png`);
      await evaljs(`new Promise(r => { const l = [...document.querySelectorAll('link[rel=stylesheet]')].find(l => l.href.includes('/aurora/main.css')); const n = l.cloneNode(); n.href = '/luci-static/aurora/main.css?variant=after'; n.onload = () => { l.remove(); r(); }; l.after(n); })`);
      await sleep(400);
      const a = await evaljs(MEASURE);
      await shot(`${slug}-${width}-after.png`);
      const diffs = [];
      const n = Math.min(b.styles.length, a.styles.length);
      for (let i = 0; i < n; i++) {
        if (b.styles[i][0] !== a.styles[i][0]) { diffs.push(`structure changed at ${i}`); break; }
        if (b.styles[i][2] !== a.styles[i][2]) diffs.push(`${b.styles[i][0]} ${b.styles[i][1]}: ${b.styles[i][2]} -> ${a.styles[i][2]}`);
      }
      const textDiffs = diffs.filter((d) => / txt /.test(d) || d.startsWith("structure"));
      report.push({ width, page, dataPage: b.page, elements: b.styles.length, diffs: diffs.length, textDiffs: textDiffs.length, wrapped: [b.wrapped.length, a.wrapped.length], overflow: [b.overflow.length, a.overflow.length], pageOverflow: [b.pageOverflow, a.pageOverflow] });
      console.log(`[${width}] ${page} (${b.page}) els=${b.styles.length} styleDiffs=${diffs.length} textDiffs=${textDiffs.length} wrapped ${b.wrapped.length}->${a.wrapped.length} overflow ${b.overflow.length}->${a.overflow.length} pageOverflow ${b.pageOverflow}->${a.pageOverflow}`);
      for (const d of textDiffs.slice(0, 6)) console.log("   ", d);
      const uniq = [...new Set(diffs.filter((d) => !textDiffs.includes(d)).map((d) => d.replace(/^T\d+#\d+ /, "")))];
      for (const d of uniq.slice(0, 4)) console.log("    (no text)", d);
      if (a.wrapped.length) console.log("    still wrapped:", a.wrapped.slice(0, 8).join(" | "));
    }
    await send("Target.closeTarget", { targetId });
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`report: ${join(OUT, "report.json")}`);
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
