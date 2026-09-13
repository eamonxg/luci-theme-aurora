// Geometry checks for the DOM compat fixtures (see ../compat/README.md).
// Each fixture is a trimmed page that links the built main.css and declares
// its checks in <script type="application/json" id="compat">. They run in
// headless Chrome over raw CDP — no npm dependency, same approach as the
// performance skill's bench scripts.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const fixtureDir = resolve(import.meta.dirname, "../compat/fixtures");
const output = resolve(import.meta.dirname, "../../htdocs/luci-static/aurora");
// header.ut inlines fonts/aurora-font.css; its absolute /luci-static/ URL
// cannot resolve under file://, so the runner injects it with a file URL.
// Without the theme font the fallback metrics differ enough to flip a wrap.
const fontCss = existsSync(join(output, "fonts/aurora-font.css"))
  ? readFileSync(join(output, "fonts/aurora-font.css"), "utf8")
      .replaceAll("/luci-static/aurora/", pathToFileURL(output).href + "/")
  : "";
const fixtures = existsSync(fixtureDir)
  ? readdirSync(fixtureDir).filter((f) => f.endsWith(".html")).sort()
  : [];

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf8" }).trim() || null;
    } catch {}
  }
  return null;
}

const chromeBin = findChrome();
const skipReason =
  fixtures.length === 0
    ? "no fixtures in compat/fixtures"
    : chromeBin
      ? null
      : "no Chrome found (set CHROME_BIN); required when CI is set";

if (skipReason && process.env.CI && fixtures.length > 0) {
  test("compat fixtures need a browser on CI", () => assert.fail(skipReason));
}

// The checks run inside the page; `sel` is the selector from the fixture.
const CHECKS = {
  // Every matched element's text sits on one line, and no text starts below
  // an inline checkbox/indicator inside it (the "label under the icon" wrap).
  nowrap: (sel) => `(() => {
    const bad = [];
    for (const el of document.querySelectorAll(${JSON.stringify(sel)})) {
      const tops = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) {
        if (!n.textContent.trim()) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        for (const x of r.getClientRects()) if (x.width > 0) tops.push(x.top);
      }
      const ind = el.querySelector('input, .partition-color-indicator, img, svg');
      const wrapped = tops.some((t) => Math.abs(t - tops[0]) > 3) ||
        (ind && tops.length && tops[0] >= ind.getBoundingClientRect().bottom - 1);
      if (wrapped) bad.push(el.textContent.trim().slice(0, 40));
    }
    return bad;
  })()`,
  // No horizontal overflow inside, and the box stays inside its parent.
  fits: (sel) => `(() => {
    const bad = [];
    for (const el of document.querySelectorAll(${JSON.stringify(sel)})) {
      const r = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 || r.right > p.right + 1)
        bad.push((el.id || el.className || el.tagName) + ' ' + Math.round(el.scrollWidth) + '/' + Math.round(el.clientWidth) + ' right ' + Math.round(r.right) + '>' + Math.round(p.right));
    }
    return bad;
  })()`,
  js: (expr) => `(() => { const v = (${expr}); return v ? [] : ['expression was ' + JSON.stringify(v)]; })()`,
};

function readSpec(file) {
  const html = readFileSync(join(fixtureDir, file), "utf8");
  const m = html.match(/<script[^>]*id="compat"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, `${file}: missing <script id="compat"> block`);
  const spec = JSON.parse(m[1]);
  assert.ok(Array.isArray(spec.checks) && spec.checks.length, `${file}: no checks`);
  return spec;
}

test("compat fixtures keep their geometry", { skip: skipReason ?? false }, async (t) => {
  const profile = mkdtempSync(join(tmpdir(), "cdp-compat-"));
  const chrome = spawn(
    chromeBin,
    ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
     "--no-first-run", "--no-default-browser-check", "--allow-file-access-from-files", "about:blank"],
    { stdio: "ignore" },
  );
  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const f = join(profile, "DevToolsActivePort");
    if (existsSync(f)) port = +readFileSync(f, "utf8").split("\n")[0];
  }
  assert.ok(port, "chrome did not expose a DevTools port");
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
      const id = ++mid;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  try {
    for (const file of fixtures) {
      const spec = readSpec(file);
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      await send("Page.enable", {}, sessionId);
      if (fontCss)
        await send("Page.addScriptToEvaluateOnNewDocument", { source: `
          document.addEventListener('DOMContentLoaded', () => {
            const s = document.createElement('style');
            s.textContent = ${JSON.stringify(fontCss)};
            document.head.prepend(s);
          });` }, sessionId);
      const evaljs = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      };
      for (const width of spec.viewports ?? [1280]) {
        await send("Emulation.setDeviceMetricsOverride",
          { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 }, sessionId);
        const loaded = new Promise((res) => {
          const h = (m) => { if (m.method === "Page.loadEventFired" && m.sessionId === sessionId) { handlers.delete(h); res(); } };
          handlers.add(h);
        });
        await send("Page.navigate", { url: pathToFileURL(join(fixtureDir, file)).href }, sessionId);
        await loaded;
        // Force the theme font to load before measuring (font-display: swap
        // would otherwise measure the fallback), then give layout one frame.
        await evaljs(`document.fonts.load('12px "Lato"').then(() => document.fonts.ready)
          .then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`);
        const fontOk = await evaljs(`!${JSON.stringify(!!fontCss)} || document.fonts.check('12px "Lato"')`);
        assert.ok(fontOk, `${file}: theme font did not load from ${output}/fonts`);
        const sheets = await evaljs("[...document.styleSheets].map(s => { try { return s.cssRules.length } catch { return -1 } })");
        assert.ok(sheets.some((n) => n > 100), `${file}: main.css did not load (rules per sheet: ${sheets}) — run pnpm build`);
        for (const check of spec.checks) {
          if (check.viewports && !check.viewports.includes(width)) continue;
          const [kind, arg] = Object.entries(check).find(([k]) => k in CHECKS) ?? [];
          assert.ok(kind, `${file}: unknown check ${JSON.stringify(check)}`);
          const bad = await evaljs(CHECKS[kind](arg));
          assert.deepEqual(bad, [], `${file} @${width} ${kind} ${JSON.stringify(arg)} (ledger ${spec.ledger}): ${bad.join("; ")}`);
        }
      }
      await send("Target.closeTarget", { targetId });
    }
  } finally {
    ws.close();
    chrome.kill();
    await sleep(200);
    rmSync(profile, { recursive: true, force: true });
  }
});
