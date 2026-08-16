/**
 * Copyright (C) 2025 eamonxg <eamonxiong@gmail.com>
 * Licensed under the Apache License, Version 2.0.
 */

import tailwindcss from "@tailwindcss/vite";
import browserslist from "browserslist";
import { exec } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import type { IncomingMessage, ServerResponse } from "http";
import {
  browserslistToTargets,
  transform as lightningcssTransform,
} from "lightningcss";
import { basename, dirname, join, relative, resolve, sep } from "path";
import { minify as terserMinify } from "terser";
import { promisify } from "util";
import {
  defineConfig,
  loadEnv,
  Plugin,
  ResolvedConfig,
  ViteDevServer,
} from "vite";

const execAsync = promisify(exec);

const CURRENT_DIR = process.cwd();
const PROJECT_ROOT = resolve(CURRENT_DIR, "..");
const BUILD_OUTPUT = resolve(PROJECT_ROOT, "htdocs/luci-static");

const LIGHTNINGCSS_TARGETS = browserslistToTargets(
  browserslist("last 4 versions, Firefox ESR, not dead"),
);

function createLuciJsCompressPlugin(): Plugin {
  let outDir: string;

  return {
    name: "luci-js-compress",
    apply: "build",
    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir;
    },
    async generateBundle() {
      const srcDir = resolve(CURRENT_DIR, "src/resource");
      const jsFiles = (await readdir(srcDir, { recursive: true })).filter((f) =>
        f.endsWith(".js"),
      );
      await Promise.all(
        jsFiles.map(async (relPath) => {
          const normalized = relPath.replace(/\\/g, "/");
          try {
            const sourceCode = await readFile(join(srcDir, relPath), "utf-8");
            const compressed = await terserMinify(sourceCode, {
              parse: { bare_returns: true },
              /* LuCI dependency declarations are string directives. Keep
                 them while enabling normal compression and local mangling. */
              compress: { directives: false, passes: 2 },
              mangle: true,
              format: { comments: false, beautify: false },
            });
            // patches/* are payloads of the on-demand patches mechanism and
            // ship next to the CSS patches (media dir), not under resources/.
            const stem = normalized.startsWith("patches/")
              ? normalized.slice("patches/".length, -".js".length)
              : null;
            const outputPaths = stem
              ? [stem, ...(PATCH_ALIASES[stem] ?? [])].map((p) =>
                  join(outDir, "aurora", "patches", `${p}.js`),
                )
              : [join(outDir, "resources", normalized)];
            for (const outputPath of outputPaths) {
              await mkdir(dirname(outputPath), { recursive: true });
              await writeFile(
                outputPath,
                compressed.code || sourceCode,
                "utf-8",
              );
            }
          } catch (error: any) {
            console.error(
              `${tag("JS Compress")} src/resource/${normalized}: ${error?.message}`,
            );
          }
        }),
      );
    },
  };
}

/* Duplicate built CSS patches under their PATCH_ALIASES names (JS aliases are
   handled inside the compress plugin). Runs post-bundle because the sources
   are Rollup entries. */
function createPatchAliasPlugin(): Plugin {
  return {
    name: "patch-alias",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      for (const [stem, aliases] of Object.entries(PATCH_ALIASES)) {
        const source = resolve(BUILD_OUTPUT, `aurora/patches/${stem}.css`);
        if (!existsSync(source)) continue;
        const css = await readFile(source, "utf-8");
        for (const alias of aliases)
          await writeFile(
            resolve(BUILD_OUTPUT, `aurora/patches/${alias}.css`),
            css,
            "utf-8",
          );
      }
    },
  };
}

async function removeMacOsMetadata(dir: string): Promise<void> {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await removeMacOsMetadata(path);
    else if (entry.name === ".DS_Store") await rm(path, { force: true });
  }
}

/* login.css imports the full shared token sheet but the login page consumes
   only a fraction of it. Prune every custom-property declaration (and --tw-*
   @property registration) that no var() reference can reach, following
   declaration-value chains (--a: var(--b) keeps --b alive). --login-bg and
   --login-bg-lqip stay consumed-without-declaration by design: header.ut
   injects them from UCI at render time, so pruning never touches consumers. */
function createLoginCssPrunePlugin(): Plugin {
  return {
    name: "login-css-prune",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      const path = resolve(BUILD_OUTPUT, "aurora/login.css");
      if (!existsSync(path)) return;
      const css = await readFile(path, "utf-8");

      // Roots are vars consumed by normal declarations; custom-property
      // declarations only contribute edges to the reachability walk.
      const VALUE = `(?:"[^"]*"|'[^']*'|[^;{}"'])*`;
      const roots = new Set<string>();
      const edges = new Map<string, Set<string>>();
      for (const [, name, value] of css.matchAll(
        new RegExp(`(?<=[{;])(--[\\w-]+|[a-zA-Z-]+):(${VALUE})`, "g"),
      )) {
        const refs = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(
          (m) => m[1],
        );
        if (!name.startsWith("--")) refs.forEach((r) => roots.add(r));
        else {
          const deps = edges.get(name) ?? new Set<string>();
          refs.forEach((r) => deps.add(r));
          edges.set(name, deps);
        }
      }
      const keep = new Set(roots);
      const stack = [...roots];
      while (stack.length) {
        for (const dep of edges.get(stack.pop()!) ?? []) {
          if (!keep.has(dep)) {
            keep.add(dep);
            stack.push(dep);
          }
        }
      }

      const pruned = css
        .replace(
          new RegExp(`(?<=[{;])(--[\\w-]+):${VALUE};?`, "g"),
          (decl, name) => (keep.has(name) ? decl : ""),
        )
        .replace(/@property\s+(--[\w-]+)\{[^{}]*\}/g, (rule, name) =>
          keep.has(name) ? rule : "",
        );

      // Re-minify with the shared targets: validates the edited syntax and
      // drops any rule the pruning emptied out.
      const { code } = lightningcssTransform({
        filename: "login.css",
        code: Buffer.from(pruned),
        minify: true,
        targets: LIGHTNINGCSS_TARGETS,
      });
      await writeFile(path, code);
    },
  };
}

function createPackageHygienePlugin(): Plugin {
  return {
    name: "package-hygiene",
    apply: "build",
    enforce: "post",
    async closeBundle() {
      await Promise.all([
        removeMacOsMetadata(resolve(PROJECT_ROOT, "htdocs")),
        removeMacOsMetadata(resolve(PROJECT_ROOT, "ucode")),
      ]);
    },
  };
}

// On-demand third-party patches: serve src/media/patches/<page>.css at
// /luci-static/aurora/patches/<page>.css in dev. Without this, header.ut's patch
// <link> falls through to the OpenWrt proxy (404 / stale router asset) and patch
// edits don't trigger HMR. Matched per request so new patch files work without
// a dev-server restart.
const PATCH_PUBLIC_PREFIX = "/luci-static/aurora/patches/";
const PATCH_SRC_DIR = resolve(CURRENT_DIR, "src/media/patches");

// JS payloads of the same on-demand mechanism: src/resource/patches/<page>.js
// builds to aurora/patches/<page>.js so header.ut's single lsdir() discovers
// CSS and JS patches together.
const JS_PATCH_SRC_DIR = resolve(CURRENT_DIR, "src/resource/patches");

// A built payload (CSS or JS) can serve several pages via aliases, keyed by
// source stem. Prefix matching is per-page, and naming one file after a
// shorter shared prefix (e.g. `admin-status`) would load it on every status
// subpage — including the busiest overview page — so the built output is
// duplicated under each alias instead. Two identical CSS *entries* would not
// work either: Rollup deduplicates same-content assets into a single file.
// Currently empty: the log viewer needs only admin-status-logs — every
// supported release (23.05/24.10/master) mounts both log pages under
// admin/status/logs/*, so the prefix covers System Log, Kernel Log and the
// bare /logs alias with one name.
const PATCH_ALIASES: Record<string, string[]> = {};
const patchAliasSource = (stem: string): string | undefined =>
  Object.entries(PATCH_ALIASES).find(([, aliases]) =>
    aliases.includes(stem),
  )?.[0];

// Theme assets (public/aurora/**: images, fonts): serve the copy in this
// checkout at /luci-static/aurora/<path>. Without this, header.ut's logo,
// favicon, webmanifest and font references fall through to the OpenWrt proxy
// and resolve against the *installed* package, so an icon or font added here
// 404s until the package is rebuilt and reinstalled. Only files that exist
// locally are rewritten — everything else still proxies through.
const ASSET_PUBLIC_PREFIX = "/luci-static/aurora/";
const ASSET_SRC_DIR = resolve(CURRENT_DIR, "public/aurora");

// Resolves a request path under public/aurora/, or null when it escapes the
// directory (../) or names something that is not a file there.
function localAsset(relPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relPath);
  } catch {
    return null;
  }
  const file = resolve(ASSET_SRC_DIR, decoded);
  if (!file.startsWith(ASSET_SRC_DIR + sep)) return null;

  return existsSync(file) && statSync(file).isFile() ? decoded : null;
}

function createLocalServePlugin(): Plugin {
  const cssRoutes: Record<string, string> = {
    "/luci-static/aurora/main.css": "/src/media/main.css",
    "/luci-static/aurora/login.css": "/src/media/login.css",
  };
  const jsRoutes: Record<string, string> = {
    "/luci-static/resources/view/aurora/sysauth.js":
      "src/resource/view/aurora/sysauth.js",
    "/luci-static/resources/menu-aurora.js": "src/resource/menu-aurora.js",
    "/luci-static/resources/router-aurora.js": "src/resource/router-aurora.js",
  };

  // Any theme CSS (entries, partials, patches) or served JS change must force
  // a full reload: proxied LuCI pages link /luci-static/... URLs, so Vite's
  // granular css-update never matches them and would silently do nothing.
  const MEDIA_SRC_DIR = resolve(CURRENT_DIR, "src/media").replace(/\\/g, "/");
  const reloadJsFiles = new Set(
    Object.values(jsRoutes).map((src) =>
      resolve(CURRENT_DIR, src).replace(/\\/g, "/"),
    ),
  );

  return {
    name: "local-serve-plugin",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const [pathname, search] = req.url.split("?");
        const cssTarget = cssRoutes[pathname];
        if (cssTarget) {
          req.url = cssTarget + (search ? `?${search}` : "");
          return next();
        }
        if (
          pathname.startsWith(PATCH_PUBLIC_PREFIX) &&
          pathname.endsWith(".css")
        ) {
          // Aliases resolve to their shared source, mirroring the build-time
          // duplication.
          const stem = basename(pathname, ".css");
          const source = existsSync(join(PATCH_SRC_DIR, `${stem}.css`))
            ? stem
            : patchAliasSource(stem);
          if (source && existsSync(join(PATCH_SRC_DIR, `${source}.css`))) {
            req.url =
              `/src/media/patches/${source}.css` + (search ? `?${search}` : "");
            return next();
          }
        }
        if (
          pathname.startsWith(PATCH_PUBLIC_PREFIX) &&
          pathname.endsWith(".js")
        ) {
          const stem = basename(pathname, ".js");
          const source = existsSync(join(JS_PATCH_SRC_DIR, `${stem}.js`))
            ? stem
            : patchAliasSource(stem);
          if (source && existsSync(join(JS_PATCH_SRC_DIR, `${source}.js`))) {
            try {
              const code = await readFile(
                join(JS_PATCH_SRC_DIR, `${source}.js`),
                "utf-8",
              );
              res.setHeader("Content-Type", "text/javascript");
              res.setHeader("Cache-Control", "no-store");
              res.statusCode = 200;
              res.end(code);
              return;
            } catch (err: any) {
              console.error(
                `${tag("Serve")} ${pathname} → cannot read patches/${source}.js: ${err?.message ?? err}`,
              );
            }
          }
        }
        if (pathname.startsWith(ASSET_PUBLIC_PREFIX)) {
          const asset = localAsset(pathname.slice(ASSET_PUBLIC_PREFIX.length));
          if (asset) {
            req.url = `/aurora/${asset}` + (search ? `?${search}` : "");
            return next();
          }
        }
        const jsPath = jsRoutes[pathname];
        if (jsPath) {
          try {
            const code = await readFile(resolve(CURRENT_DIR, jsPath), "utf-8");
            res.setHeader("Content-Type", "text/javascript");
            res.setHeader("Cache-Control", "no-store");
            res.statusCode = 200;
            res.end(code);
            return;
          } catch (err: any) {
            console.error(
              `${tag("Serve")} ${pathname} → cannot read ${jsPath}: ${err?.message ?? err}`,
            );
          }
        }
        next();
      });
    },
    handleHotUpdate({ file, server }) {
      const nf = file.replace(/\\/g, "/");
      const isThemeCss =
        nf.startsWith(MEDIA_SRC_DIR + "/") && nf.endsWith(".css");
      const isJsPatch =
        nf.startsWith(JS_PATCH_SRC_DIR.replace(/\\/g, "/") + "/") &&
        nf.endsWith(".js");
      if (isThemeCss || isJsPatch || reloadJsFiles.has(nf)) {
        console.log(
          `${tag("Serve")} ${relative(CURRENT_DIR, file)} → full reload`,
        );
        server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }
    },
  };
}

// Mock pages: render saved LuCI page snapshots against the live theme, so a
// third-party app's page can be styled without the app (or a device) installed.
// Snapshots live in .dev/mocks/*.html and are served at /mocks/<name>.html
// with the Vite HMR client injected, so theme edits (main.css, components,
// patches/*.css, served JS) trigger the existing full-reload in handleHotUpdate.
// Any third-party asset a snapshot needs (the app's own css/js, e.g.
// qmodem-next.css) goes under .dev/mocks/static/ mirroring its /luci-static/…
// URL and is served as-is (no HMR). Both served snapshots and proxied device
// pages get scripts/mock-bar.client.js — a floating bar that lists the
// snapshots, opens the one matching the open page, captures the open device
// page (POST /mocks/__save), and inside a snapshot takes over its LuCI links.
// See "Mock Pages" in .dev/docs/DEVELOPMENT.md.
const MOCK_ROUTE = "/mocks";
const MOCKS_DIR = resolve(CURRENT_DIR, "mocks");
const MOCKS_STATIC_DIR = join(MOCKS_DIR, "static");
const MOCK_BAR_CLIENT = resolve(CURRENT_DIR, "scripts/mock-bar.client.js");
// A captured LuCI page is tens of KB — anything past this is not a page.
const MOCK_SAVE_LIMIT = 20 * 1024 * 1024;

const MOCK_MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function mockContentType(file: string): string {
  const ext = file.slice(file.lastIndexOf("."));
  return MOCK_MIME[ext] ?? "application/octet-stream";
}

// document.documentElement.outerHTML (the documented manual capture) drops the
// doctype; without one the browser renders the mock in quirks mode and layout
// no longer matches the real page. Every serve and save path funnels through
// this.
function ensureDoctype(html: string): string {
  return /^\s*<!doctype/i.test(html) ? html : `<!doctype html>\n${html}`;
}

const escapeHtml = (s: string): string =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

// Inject the Vite HMR client so a served snapshot joins the WS channel and
// receives handleHotUpdate's full-reload broadcast on any theme source change.
function injectHmrClient(html: string): string {
  if (html.includes("/@vite/client")) return html;
  const tag = `\n    <script type="module" src="/@vite/client"></script>\n`;
  return html.includes("</head>")
    ? html.replace("</head>", `${tag}  </head>`)
    : tag + html;
}

// A snapshot is static DOM. Left alone, LuCI's runtime (luci.js + the inline
// `new LuCI(...)` bootstrap) boots, polls the backend, gets 403 (no session)
// and pops the "Session expired" modal. Neutralise it for mock rendering:
// strip the scripts that phone home (luci.js/cbi.js/xhr.js and /cgi-bin/
// endpoints) and pre-define a no-op `L`/`LuCI`/`XHR` stub so the remaining
// inline bootstraps (`new LuCI(...)`, `L.require(...)`, legacy `XHR.poll(...)`)
// run harmlessly. Theme CSS/JS and the theme's own inline scripts (dark mode,
// toolbar) are untouched; framework-dependent theme JS such as menu-aurora
// simply no-ops — the captured DOM is already fully rendered, so a static
// review still looks right.
const MOCK_RUNTIME_GUARD = `<script>
    (function () {
      var stub = new Proxy(function () {}, {
        get: function () { return stub; },
        apply: function () { return stub; },
        construct: function () { return stub; },
      });
      window.L = stub;
      window.LuCI = stub;
      window.XHR = stub;
    })();
    </script>`;

function neutralizeLuciRuntime(html: string): string {
  const stripped = html.replace(
    /<script\b[^>]*\bsrc="[^"]*(?:\/luci-static\/resources\/(?:luci|cbi|xhr)\.js|\/cgi-bin\/)[^"]*"[^>]*>\s*<\/script>/gi,
    "",
  );
  return stripped.includes("</head>")
    ? stripped.replace(
        /<head\b[^>]*>/i,
        (m) => `${m}\n    ${MOCK_RUNTIME_GUARD}`,
      )
    : MOCK_RUNTIME_GUARD + stripped;
}

// Snapshot inventory for the index and for in-mock navigation. A snapshot's
// identity is its <body data-page> (filenames are free), so each file is
// scanned for it once and re-read only when its mtime changes.
interface MockEntry {
  file: string;
  page: string | null;
  mtimeMs: number;
}
const mockMeta = new Map<string, { mtimeMs: number; page: string | null }>();

function listMocks(): MockEntry[] {
  if (!existsSync(MOCKS_DIR)) return [];
  return readdirSync(MOCKS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".html"))
    .map((d) => {
      const path = join(MOCKS_DIR, d.name);
      const mtimeMs = statSync(path).mtimeMs;
      let meta = mockMeta.get(d.name);
      if (!meta || meta.mtimeMs !== mtimeMs) {
        const page = readFileSync(path, "utf-8").match(
          /<body\b[^>]*\bdata-page="([^"]*)"/i,
        )?.[1];
        meta = { mtimeMs, page: page || null };
        mockMeta.set(d.name, meta);
      }
      return { file: d.name, page: meta.page, mtimeMs };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

// Handing the snapshot list to the page is what makes the bar work in both
// contexts: inside a snapshot it also drives the link takeover, on a device
// page it tells the bar which snapshots exist (`current` is null there — a
// live page is not one of them). data-aurora-mock marks every tag this server
// injects so a capture can strip them back out.
function injectMockBar(html: string, current: string | null): string {
  const payload = JSON.stringify({
    current,
    mocks: listMocks().map(({ file, page }) => ({ file, page })),
  }).replace(/</g, "\\u003c");
  const tags =
    `<script data-aurora-mock>window.__AURORA_MOCKS__ = ${payload};</script>\n` +
    `    <script data-aurora-mock defer src="${MOCK_ROUTE}/__bar.js"></script>\n  `;
  return html.includes("</head>")
    ? html.replace("</head>", `${tags}</head>`)
    : html + tags;
}

function readRequestBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function relTime(mtimeMs: number): string {
  const mins = Math.round((Date.now() - mtimeMs) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / (60 * 24))}d`;
}

function renderMockIndex(entries: MockEntry[]): string {
  const rows = entries.length
    ? entries
        .map((e) => {
          const meta = [e.page ?? "no data-page", relTime(e.mtimeMs)]
            .map(escapeHtml)
            .join(" · ");
          return (
            `<li><a href="${MOCK_ROUTE}/${encodeURIComponent(e.file)}">` +
            `${escapeHtml(e.file)}<span class="meta">${meta}</span></a></li>`
          );
        })
        .join("\n      ")
    : `<li class="empty">No snapshots yet — open a page through the dev proxy and press <code>Alt/Option+Shift+S</code>, or drop a page's HTML into <code>.dev/mocks/</code></li>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Aurora mock pages</title>
  <style>
    body{font:15px/1.6 system-ui,-apple-system,sans-serif;max-width:680px;margin:48px auto;padding:0 20px;color:#1a1a1a}
    h1{font-size:20px;margin:0 0 4px}
    p.sub{color:#888;font-size:13px;margin:0 0 24px}
    ul{list-style:none;padding:0;margin:0}
    li{margin:8px 0}
    li a{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:8px 14px;border:1px solid #d0d0d0;border-radius:8px;text-decoration:none;color:#0a7d4b;font-weight:500}
    li a .meta{color:#888;font-size:12px;font-weight:400;white-space:nowrap}
    li a:hover{background:#f5f5f5}
    li.empty{color:#888}
    code{background:#f0f0f0;padding:1px 6px;border-radius:4px;font-size:13px}
    @media(prefers-color-scheme:dark){body{background:#111;color:#eee}li a{border-color:#333;color:#4ade80}li a:hover{background:#1c1c1c}code{background:#222}}
  </style>
</head>
<body>
  <h1>Aurora mock pages</h1>
  <p class="sub">Saved snapshots served against the live theme. Edit theme CSS/JS → the open page hot-reloads; links between captured pages navigate in place.</p>
  <ul>
      ${rows}
  </ul>
</body>
</html>`;
}

function createMockPlugin(): Plugin {
  const sendJson = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  };
  // Each missing mock asset gets one terminal hint, not one per reload.
  const mockMissLogged = new Set<string>();

  return {
    name: "mock-pages-plugin",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();
        const [pathname] = req.url.split("?");
        const inMocks =
          pathname === MOCK_ROUTE || pathname.startsWith(`${MOCK_ROUTE}/`);
        if (!inMocks && !pathname.startsWith("/luci-static/")) return next();

        // Every branch answers inside this try: a stray request (malformed
        // %-encoding, a directory named *.html, …) must degrade to an error
        // response — thrown, it becomes an unhandled rejection and takes the
        // whole dev server down with it.
        try {
          // Dev-helper client script (kept as a real file for editability).
          if (pathname === `${MOCK_ROUTE}/__bar.js`) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(await readFile(MOCK_BAR_CLIENT, "utf-8"));
            return;
          }

          // Capture endpoint, written to by mock-bar.client.js from proxied
          // device pages. The custom header doubles as a CORS gate: a
          // foreign origin can't send it without a preflight this server never
          // approves, so drive-by cross-site POSTs are rejected.
          if (pathname === `${MOCK_ROUTE}/__save`) {
            if (req.method !== "POST")
              return sendJson(res, 405, { error: "POST only" });
            if (req.headers["x-aurora-capture"] !== "1")
              return sendJson(res, 403, { error: "missing capture header" });
            const html = (await readRequestBody(req, MOCK_SAVE_LIMIT))
              // The live DOM carries the dev-only tags this server injected;
              // a snapshot must stay a clean capture of the real page. The
              // snapshot list in particular must not be baked in — it is
              // re-injected, current, on every serve.
              .replace(
                /<script\b[^>]*\bdata-aurora-mock\b[^>]*>[\s\S]*?<\/script>\s*/gi,
                "",
              )
              .replace(
                /<script[^>]*\bsrc="\/@vite\/client"[^>]*>\s*<\/script>\s*/gi,
                "",
              );
            const page =
              html.match(/<body\b[^>]*\bdata-page="([^"]*)"/i)?.[1] ?? "";
            const safe = page.replace(/[^\w.-]/g, "-").replace(/^\.+/, "");
            const name = `${safe.slice(0, 120) || `snapshot-${Date.now()}`}.html`;
            await mkdir(MOCKS_DIR, { recursive: true });
            await writeFile(
              join(MOCKS_DIR, name),
              ensureDoctype(html),
              "utf-8",
            );
            console.log(
              `${tag("Mocks")} captured ${name}${page ? ` (${page})` : ""}`,
            );
            return sendJson(res, 200, { file: name, page: page || null });
          }

          // Index of available snapshots.
          if (pathname === MOCK_ROUTE || pathname === `${MOCK_ROUTE}/`) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(renderMockIndex(listMocks()));
            return;
          }

          // A single snapshot: LuCI runtime neutralised, HMR client + mock bar
          // injected, doctype restored.
          if (inMocks && pathname.endsWith(".html")) {
            const name = basename(decodeURIComponent(pathname));
            const file = resolve(MOCKS_DIR, name);
            if (
              !file.startsWith(MOCKS_DIR + sep) ||
              !existsSync(file) ||
              !statSync(file).isFile()
            ) {
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(
                `<!doctype html><meta charset="utf-8"><p>Mock not found: ${escapeHtml(name)} — <a href="${MOCK_ROUTE}/">back to index</a>`,
              );
              return;
            }
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            const snapshot = await readFile(file, "utf-8");
            res.end(
              ensureDoctype(
                injectMockBar(
                  injectHmrClient(neutralizeLuciRuntime(snapshot)),
                  name,
                ),
              ),
            );
            return;
          }

          // Third-party static drop-ins the snapshot references (the app's own
          // css/js) — reached only when local-serve didn't already claim the
          // path.
          if (pathname.startsWith("/luci-static/")) {
            const file = resolve(
              MOCKS_STATIC_DIR,
              decodeURIComponent(pathname.slice(1)),
            );
            if (
              file.startsWith(MOCKS_STATIC_DIR + sep) &&
              existsSync(file) &&
              statSync(file).isFile()
            ) {
              res.statusCode = 200;
              res.setHeader("Content-Type", mockContentType(file));
              res.setHeader("Cache-Control", "no-store");
              res.end(await readFile(file));
              return;
            }
            // A miss requested BY a mock page must fail fast, not fall
            // through to the device proxy: with no reachable router the
            // request just hangs, pinning the tab's load event for minutes
            // (device-only assets like a custom logo hit this). Real proxied
            // pages keep their normal fallthrough.
            const referer = req.headers.referer ?? "";
            if (
              new URL(referer, "http://_").pathname.startsWith(`${MOCK_ROUTE}/`)
            ) {
              if (!mockMissLogged.has(pathname)) {
                mockMissLogged.add(pathname);
                console.log(
                  `${tag("Mocks")} miss ${pathname} → 404 (mirror it at .dev/mocks/static${pathname} to serve it)`,
                );
              }
              res.statusCode = 404;
              res.setHeader("Cache-Control", "no-store");
              res.end();
              return;
            }

            // Whatever else reaches here on /luci-static/ is destined for the
            // device proxy. Static files answer in milliseconds on a real
            // router, so bound the wait: CSS-initiated requests (nav icons)
            // carry the stylesheet's URL as referer and dodge the mock 404
            // above — with no reachable device they would otherwise pin the
            // tab's load event for minutes. Vite's proxy error handler
            // tolerates an already-ended response, and /cgi-bin is untouched
            // (dynamic endpoints can be legitimately slow).
            const deadline = setTimeout(() => {
              if (!res.headersSent && res.writable) {
                console.log(
                  `${tag("Proxy")} ${pathname} → 504 after 5s (router unreachable?)`,
                );
                res.statusCode = 504;
                res.end();
              }
            }, 5000);
            res.on("close", () => clearTimeout(deadline));
          }

          next();
        } catch (err: any) {
          const status =
            err?.statusCode ?? (err instanceof URIError ? 400 : 500);
          console.error(`${tag("Mocks")} ${req.url}: ${err?.message ?? err}`);
          if (res.headersSent) {
            res.destroy();
            return;
          }
          if (pathname === `${MOCK_ROUTE}/__save`) {
            sendJson(res, status, { error: String(err?.message ?? err) });
          } else {
            res.statusCode = status;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end(status === 400 ? "Bad request" : "Mock route error");
          }
        }
      });
    },
  };
}

const UT_TEMPLATE_DIR = resolve(PROJECT_ROOT, "ucode/template/themes/aurora");
const UT_REMOTE_DIR = "/usr/share/ucode/luci/template/themes/aurora";

// Key selection is ssh's own job: ssh-agent or a Host block in ~/.ssh/config.
// ConnectTimeout applies to every ssh call: template pushes gate /cgi-bin page
// loads, so an unreachable device must fail fast instead of hanging them.
const SSH_ARGS =
  "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5";

function tag(name: string): string {
  return `${new Date().toLocaleTimeString("en-US")} [${name}]`;
}

const utTag = () => tag("UT Sync");

const parseHost = (sshHost: string): string => sshHost.split("@").pop()!;

function reportSshError(err: any, sshHost: string): void {
  const host = parseHost(sshHost);
  const stderr = err?.stderr || err?.message || "";

  if (
    stderr.includes("Host key verification failed") ||
    stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")
  ) {
    console.error(`\n${utTag()} SSH host key mismatch for ${host}.`);
    console.error(`${utTag()} The device may have been reflashed. Run:\n`);
    console.error(`  ssh-keygen -R ${host}\n`);
  } else if (
    stderr.includes("Permission denied") ||
    stderr.includes("Authentication failed")
  ) {
    console.error(`\n${utTag()} SSH authentication failed for ${sshHost}.`);
    console.error(
      `${utTag()} Run \`pnpm setup:router\` to configure passwordless login.\n`,
    );
  } else if (
    stderr.includes("Connection refused") ||
    stderr.includes("Connection timed out") ||
    stderr.includes("No route to host")
  ) {
    console.error(
      `\n${utTag()} Cannot reach ${host}. Check that the device is online and SSH is enabled.\n`,
    );
  } else {
    console.error(`\n${utTag()} SSH connection failed: ${stderr}\n`);
  }
}

async function checkSshConnection(sshHost: string): Promise<boolean> {
  try {
    await execAsync(`ssh ${SSH_ARGS} "${sshHost}" echo ok`);
    console.log(`${utTag()} SSH connection to ${sshHost} verified.`);
    return true;
  } catch (err: any) {
    reportSshError(err, sshHost);
    return false;
  }
}

function createUtSyncPlugin(sshHost: string): Plugin {
  let dirty = false;
  let flushing: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Filenames whose change events triggered the pending sync — the push itself
  // is always the whole directory, this only makes the log say what changed.
  const pending = new Set<string>();

  // The templates are tiny, so every sync just pushes the whole directory in
  // one tarball streamed over ssh stdin — OpenSSH 9+ scp defaults to the SFTP
  // protocol, which Dropbear on OpenWrt does not ship a server for. Note the
  // tar extract only adds/overwrites: deleting or renaming a local .ut leaves
  // the old file on the device until a reinstall or manual cleanup.
  const pushAll = () =>
    execAsync(
      `tar -C "${UT_TEMPLATE_DIR}" -cf - . | ssh ${SSH_ARGS} "${sshHost}" "mkdir -p '${UT_REMOTE_DIR}' && tar -xf - -C '${UT_REMOTE_DIR}'"`,
    );

  const flush = (server: ViteDevServer): Promise<void> => {
    if (!flushing) {
      flushing = (async () => {
        while (dirty) {
          dirty = false;
          const files = [...pending];
          pending.clear();
          const started = Date.now();
          try {
            await pushAll();
            const what = files.length ? files.join(", ") : "all templates";
            console.log(
              `${utTag()} ${what} → ${sshHost} (${Date.now() - started}ms)`,
            );
            server.ws.send({ type: "full-reload", path: "*" });
          } catch (err: any) {
            files.forEach((f) => pending.add(f));
            reportSshError(err, sshHost);
            break;
          }
        }
        flushing = null;
      })();
    }
    return flushing;
  };

  const markDirty = (server: ViteDevServer) => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(server), 150);
  };

  return {
    name: "ut-sync-plugin",
    apply: "serve",
    configureServer(server) {
      console.log(
        `${utTag()} ${relative(PROJECT_ROOT, UT_TEMPLATE_DIR)}/*.ut → ${sshHost}:${UT_REMOTE_DIR}`,
      );

      // Full push on startup so edits made while the server was down (or a
      // freshly flashed device) can't leave the router stale.
      checkSshConnection(sshHost).then((ok) => {
        if (ok) markDirty(server);
      });

      server.watcher.add(UT_TEMPLATE_DIR);
      const onTemplateEvent = (file: string) => {
        if (file.startsWith(UT_TEMPLATE_DIR) && file.endsWith(".ut")) {
          pending.add(basename(file));
          markDirty(server);
        }
      };
      server.watcher.on("add", onTemplateEvent);
      server.watcher.on("change", onTemplateEvent);

      // Hold page loads until pending template pushes land, so a proxied
      // render never uses a stale template.
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/cgi-bin") || (!dirty && !flushing)) {
          return next();
        }
        if (timer) clearTimeout(timer);
        console.log(`${utTag()} Holding ${req.url} until templates sync…`);
        flush(server).then(
          () => next(),
          () => next(),
        );
      });
    },
  };
}

function createRedirectPlugin(): Plugin {
  return {
    name: "redirect-plugin",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/" || req.url === "/index.html") {
          res.writeHead(302, { Location: "/cgi-bin/luci" });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, CURRENT_DIR);
  // VITE_OPENWRT_HOST is just the router address — a bare IP/hostname like
  // 192.168.1.1 (host:port and http:// URL forms also work). The web proxy
  // target and the .ut-sync ssh target are both derived from it; ssh key
  // selection etc. belongs in ~/.ssh/config, not here.
  const OPENWRT_RAW = env.VITE_OPENWRT_HOST || "192.168.1.1";
  const OPENWRT = new URL(
    /^https?:\/\//.test(OPENWRT_RAW) ? OPENWRT_RAW : `http://${OPENWRT_RAW}`,
  );
  const OPENWRT_URL = OPENWRT.origin;
  const OPENWRT_SSH_HOST = `root@${OPENWRT.hostname}`;
  const DEV_HOST = env.VITE_DEV_HOST || "127.0.0.1";
  const DEV_PORT = Number(env.VITE_DEV_PORT) || 5173;

  return {
    plugins: [
      tailwindcss(),
      createRedirectPlugin(),
      createLocalServePlugin(),
      createMockPlugin(),
      createUtSyncPlugin(OPENWRT_SSH_HOST),
      createLuciJsCompressPlugin(),
      createLoginCssPrunePlugin(),
      createPatchAliasPlugin(),
      createPackageHygienePlugin(),
    ],
    css: {
      lightningcss: {
        targets: LIGHTNINGCSS_TARGETS,
      },
    },
    build: {
      outDir: BUILD_OUTPUT,
      emptyOutDir: false,
      cssMinify: "lightningcss",
      rollupOptions: {
        input: {
          main: resolve(CURRENT_DIR, "src/media/main.css"),
          login: resolve(CURRENT_DIR, "src/media/login.css"),
          // On-demand third-party patches: one entry per page, output to
          // aurora/patches/<page>.css (the `patches/` key prefix lands them there
          // via assetFileNames below). header.ut links the matching one per page.
          // `_`-prefixed files are shared partials @imported by entries, not
          // entries themselves (they'd otherwise ship as never-matching patches).
          ...Object.fromEntries(
            (existsSync(PATCH_SRC_DIR) ? readdirSync(PATCH_SRC_DIR) : [])
              .filter((f) => f.endsWith(".css") && !f.startsWith("_"))
              .map((f) => [
                `patches/${f.slice(0, -4)}`,
                join(PATCH_SRC_DIR, f),
              ]),
          ),
        },
        output: { assetFileNames: "aurora/[name].[ext]" },
      },
    },
    server: {
      host: DEV_HOST,
      port: DEV_PORT,
      proxy: {
        "/luci-static": {
          target: OPENWRT_URL,
          changeOrigin: true,
          secure: false,
        },
        "/cgi-bin": {
          target: OPENWRT_URL,
          changeOrigin: true,
          secure: false,
          // We write every response ourselves in `proxyRes` below, so the Vite
          // client can be injected into proxied LuCI HTML.
          selfHandleResponse: true,
          configure: (proxy) => {
            // Force an uncompressed upstream response: the HTML injection below
            // treats the body as UTF-8 text and would corrupt a gzipped payload.
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.removeHeader("accept-encoding");
            });
            proxy.on("proxyRes", (proxyRes, req, res) => {
              const status = proxyRes.statusCode ?? 200;
              const ct = proxyRes.headers["content-type"] || "";
              if (!ct.includes("text/html")) {
                res.writeHead(status, proxyRes.headers);
                proxyRes.pipe(res);
                return;
              }
              const chunks: Buffer[] = [];
              proxyRes.on("data", (c: Buffer) => chunks.push(c));
              proxyRes.on("end", () => {
                let html = Buffer.concat(chunks).toString("utf-8");
                const client = `<script type="module" src="/@vite/client"></script>`;
                if (
                  html.includes("</head>") &&
                  !html.includes("/@vite/client")
                ) {
                  html = html.replace("</head>", `${client}\n\t</head>`);
                }
                // Real device pages also get the mock bar, so the snapshot
                // workflow is one click away instead of a URL to remember:
                // it lists what .dev/mocks/ holds, opens this page's own
                // snapshot when there is one, and captures the open page
                // (same as Alt/Option+Shift+S). `current` is null — a live
                // page is not itself a snapshot.
                if (html.includes("</head>") && !html.includes("/__bar.js")) {
                  html = injectMockBar(html, null);
                }
                const { "transfer-encoding": _, ...headers } = proxyRes.headers;
                res.writeHead(status, {
                  ...headers,
                  "content-length": Buffer.byteLength(html),
                });
                res.end(html);
              });
            });
          },
        },
      },
      headers: { "Cache-Control": "no-store" },
    },
    resolve: {
      alias: {
        "@": resolve(CURRENT_DIR, "src"),
        "@assets": resolve(CURRENT_DIR, "src/assets"),
      },
    },
  };
});
