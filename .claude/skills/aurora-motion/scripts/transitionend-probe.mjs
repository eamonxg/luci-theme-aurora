#!/usr/bin/env node
/**
 * transitionend-probe.mjs — luci-base removes a dismissed notification and
 * moves dropdown focus into the list only on `transitionend`, so both break
 * silently when the theme has no running transition there. Checks both on a
 * real device, with and without prefers-reduced-motion. Writes nothing on
 * the device. Raw CDP, no npm deps, node >= 22. Exit 1 if a contract fails.
 *
 * env:
 *   HOST       http://192.168.1.1 (default: VITE_OPENWRT_HOST from .dev/.env)
 *   PAGE       path after /cgi-bin/luci/ (default admin/system/system)
 *   MAIN_CSS   file served as the theme's main.css (default: the device's own),
 *              e.g. htdocs/luci-static/aurora/main.css after `pnpm build`
 *   USER_NAME/PASS  login (default root / empty)
 *   CHROME_BIN
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "../../../..");
const envFile = join(root, ".dev/.env");
const dotenv = existsSync(envFile)
  ? Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split("=", 2)))
  : {};
const HOST = (process.env.HOST ?? (dotenv.VITE_OPENWRT_HOST ? `http://${dotenv.VITE_OPENWRT_HOST}` : "http://192.168.1.1")).replace(/\/+$/, "");
const PAGE = process.env.PAGE ?? "admin/system/system";
const MAIN_CSS = process.env.MAIN_CSS ? readFileSync(resolve(process.env.MAIN_CSS)) : null;
const CHROME = process.env.CHROME_BIN ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");

const login = await fetch(`${HOST}/cgi-bin/luci/`, {
  method: "POST",
  body: new URLSearchParams({ luci_username: process.env.USER_NAME ?? "root", luci_password: process.env.PASS ?? "" }),
  redirect: "manual",
});
const cookie = (login.headers.get("set-cookie") ?? "").match(/(sysauth[^=]*)=([^;]+)/);
if (!cookie) throw new Error(`login failed (${login.status})`);

const profile = mkdtempSync(join(tmpdir(), "cdp-transitionend-"));
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

async function probe(reduce) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, s)).result.value;
  await send("Page.enable", {}, s);
  await send("Network.setCookie", { name: cookie[1], value: cookie[2], domain: new URL(HOST).hostname, path: "/" }, s);
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, s);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] }, s);
  if (MAIN_CSS) {
    await send("Fetch.enable", { patterns: [{ urlPattern: "*/luci-static/aurora/main.css*", requestStage: "Request" }] }, s);
    handlers.add((m) => {
      if (m.sessionId !== s || m.method !== "Fetch.requestPaused") return;
      send("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/css" }, { name: "Cache-Control", value: "no-store" }], body: MAIN_CSS.toString("base64") }, s);
    });
  }
  await send("Page.navigate", { url: `${HOST}/cgi-bin/luci/${PAGE}` }, s);
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await ev(`!!(window.L?.loaded && document.querySelector('#view') && !document.querySelector('#view > .spinning'))`)) break;
  }

  // A stock single-select ui.Dropdown: open with ArrowDown, then ArrowDown again.
  await ev(`L.require('ui').then(ui => {
    const el = new ui.Dropdown('a', { a: 'A', b: 'B', c: 'C' }, {}).render();
    el.id = 'probe-dd';
    document.querySelector('#view').prepend(el);
    el.focus();
  })`);
  const key = async () => {
    for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 }, s);
    await sleep(500);
  };
  const focused = `(document.activeElement.closest('#probe-dd li')?.dataset.value ?? 'none')`;
  await key(); const first = await ev(focused);
  await key(); const second = await ev(focused);
  await ev(`document.querySelector('#probe-dd').remove()`);

  // ui.addNotification, dismissed after its entrance has finished.
  const note = await ev(`L.require('ui').then(ui => new Promise(res => {
    const n = ui.addNotification(null, E('p', 'probe'), 'info');
    setTimeout(() => {
      n.querySelector('button.btn').click();
      setTimeout(() => res({ removed: !n.isConnected, gapPx: n.isConnected ? n.offsetHeight : 0 }), 800);
    }, 400);
  }))`);
  await send("Target.closeTarget", { targetId });

  const dropdownOk = first === "a" && second === "b";
  console.log(JSON.stringify({ reducedMotion: reduce, dropdownFocus: `${first} -> ${second}`, dropdownOk, notification: note, notificationOk: note.removed }));
  return dropdownOk && note.removed;
}

let ok = true;
try {
  for (const reduce of [false, true]) ok = (await probe(reduce)) && ok;
} finally {
  chrome.kill();
  ws.close();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
process.exit(ok ? 0 : 1);
