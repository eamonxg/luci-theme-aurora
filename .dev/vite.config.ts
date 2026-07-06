/**
 * Copyright (C) 2025 eamonxg <eamonxiong@gmail.com>
 * Licensed under the Apache License, Version 2.0.
 */

import tailwindcss from "@tailwindcss/vite";
import browserslist from "browserslist";
import { exec } from "child_process";
import { existsSync, readdirSync } from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { browserslistToTargets } from "lightningcss";
import { basename, dirname, join, relative, resolve } from "path";
import { minify as terserMinify } from "terser";
import { promisify } from "util";
import { defineConfig, loadEnv, Plugin, ResolvedConfig } from "vite";

const execAsync = promisify(exec);

const CURRENT_DIR = process.cwd();
const PROJECT_ROOT = resolve(CURRENT_DIR, "..");
const BUILD_OUTPUT = resolve(PROJECT_ROOT, "htdocs/luci-static");

async function scanFiles(
  dir: string,
  extensions: string[] = [],
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await scanFiles(fullPath, extensions)));
    } else if (
      entry.isFile() &&
      (!extensions.length || extensions.some((ext) => fullPath.endsWith(ext)))
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function createLuciJsCompressPlugin(): Plugin {
  let outDir: string;
  let jsFiles: string[] = [];

  return {
    name: "luci-js-compress",
    apply: "build",

    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir;
    },

    async buildStart() {
      const srcDir = resolve(CURRENT_DIR, "src/resource");
      jsFiles = await scanFiles(srcDir, [".js"]);
    },

    async generateBundle() {
      await Promise.all(
        jsFiles.map(async (filePath) => {
          try {
            const sourceCode = await readFile(filePath, "utf-8");
            const compressed = await terserMinify(sourceCode, {
              parse: { bare_returns: true },
              compress: false,
              mangle: false,
              format: { comments: false, beautify: false },
            });

            const relativePath = relative(
              resolve(CURRENT_DIR, "src/resource"),
              filePath,
            ).replace(/\\/g, "/");
            const outputPath = join(outDir, "resources", relativePath);

            await mkdir(dirname(outputPath), { recursive: true });
            await writeFile(outputPath, compressed.code || sourceCode, "utf-8");
          } catch (error: any) {
            console.error(`JS compress failed: ${filePath}`, error?.message);
          }
        }),
      );
    },
  };
}

interface RouteConfig {
  routes: Record<string, string>;
  hmrMessage: string;
}

interface ResourceConfig {
  css: RouteConfig;
  js: RouteConfig;
}

// On-demand third-party patches: serve src/media/patches/<page>.css at
// /luci-static/aurora/patches/<page>.css in dev. Without this, header.ut's patch
// <link> falls through to the OpenWrt proxy (404 / stale router asset) and patch
// edits don't trigger HMR. Matched per request so new patch files work without
// a dev-server restart.
const PATCH_PUBLIC_PREFIX = "/luci-static/aurora/patches/";
const PATCH_SRC_DIR = resolve(CURRENT_DIR, "src/media/patches");

function createLocalServePlugin(): Plugin {
  const resourceConfig: ResourceConfig = {
    css: {
      routes: {
        "/luci-static/aurora/main.css": "/src/media/main.css",
        "/luci-static/aurora/login.css": "/src/media/login.css",
      },
      hmrMessage: "CSS file changed",
    },
    js: {
      routes: {
        "/luci-static/resources/view/aurora/sysauth.js":
          "src/resource/view/aurora/sysauth.js",
        "/luci-static/resources/menu-aurora.js": "src/resource/menu-aurora.js",
      },
      hmrMessage: "JS file changed",
    },
  };

  const buildHmrMap = (routes: Record<string, string>, isVitePath: boolean) => {
    const map: Record<string, string> = {};
    Object.entries(routes).forEach(([publicPath, sourcePath]) => {
      const filePath = isVitePath
        ? resolve(CURRENT_DIR, sourcePath.replace(/^\//, ""))
        : resolve(CURRENT_DIR, sourcePath);
      map[filePath.replace(/\\/g, "/")] = publicPath;
    });
    return map;
  };

  const cssHmrMap = buildHmrMap(resourceConfig.css.routes, true);
  const jsHmrMap = buildHmrMap(resourceConfig.js.routes, false);

  return {
    name: "local-serve-plugin",
    apply: "serve",
    enforce: "pre",

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) return next();

        const [pathname, search] = req.url.split("?");

        const cssTarget = resourceConfig.css.routes[pathname];
        if (cssTarget) {
          req.url = cssTarget + (search ? `?${search}` : "");
          return next();
        }

        if (pathname.startsWith(PATCH_PUBLIC_PREFIX) && pathname.endsWith(".css")) {
          const file = basename(pathname);
          if (existsSync(join(PATCH_SRC_DIR, file))) {
            req.url = `/src/media/patches/${file}` + (search ? `?${search}` : "");
            return next();
          }
        }

        const jsPath = resourceConfig.js.routes[pathname];
        if (jsPath) {
          try {
            const file = resolve(CURRENT_DIR, jsPath);
            const code = await readFile(file, "utf-8");
            res.setHeader("Content-Type", "text/javascript");
            res.setHeader("Cache-Control", "no-store");
            res.statusCode = 200;
            res.end(code);
            return;
          } catch (err) {
            console.error(`[JS Error] Failed to read ${jsPath}:`, err);
          }
        }

        next();
      });
    },

    handleHotUpdate({ file, server }) {
      const normalizedFile = file.replace(/\\/g, "/");

      if (
        normalizedFile.startsWith(PATCH_SRC_DIR.replace(/\\/g, "/") + "/") &&
        normalizedFile.endsWith(".css")
      ) {
        console.log(`[HMR] Patch CSS changed: ${basename(normalizedFile)}`);
        server.ws.send({ type: "full-reload", path: "*" });
        return [];
      }

      const resources = [
        { map: cssHmrMap, config: resourceConfig.css },
        { map: jsHmrMap, config: resourceConfig.js },
      ];

      for (const { map, config } of resources) {
        const publicPath = map[normalizedFile];
        if (publicPath) {
          console.log(`[HMR] ${config.hmrMessage}: ${publicPath} (tracked: ${normalizedFile})`);
          server.ws.send({ type: "full-reload", path: "*" });
          return [];
        }
      }
    },
  };
}

const UT_TEMPLATE_DIR = resolve(PROJECT_ROOT, "ucode/template/themes/aurora");
const UT_REMOTE_DIR = "/usr/share/ucode/luci/template/themes/aurora";

// Key selection is ssh's own job: ssh-agent or a Host block in ~/.ssh/config.
const SSH_ARGS = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null";

function parseHost(sshHost: string): string {
  const atIndex = sshHost.lastIndexOf("@");
  return atIndex !== -1 ? sshHost.slice(atIndex + 1) : sshHost;
}

function reportSshError(err: any, sshHost: string): void {
  const host = parseHost(sshHost);
  const stderr = err?.stderr || err?.message || "";

  if (stderr.includes("Host key verification failed") || stderr.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) {
    console.error(`\n[UT Sync] SSH host key mismatch for ${host}.`);
    console.error(`[UT Sync] The device may have been reflashed. Run this to fix:\n`);
    console.error(`  ssh-keygen -R ${host}\n`);
  } else if (stderr.includes("Permission denied") || stderr.includes("Authentication failed")) {
    console.error(`\n[UT Sync] SSH authentication failed for ${sshHost}.`);
    console.error(`[UT Sync] Run \`pnpm setup\` to configure passwordless login.\n`);
  } else if (stderr.includes("Connection refused") || stderr.includes("Connection timed out") || stderr.includes("No route to host")) {
    console.error(`\n[UT Sync] Cannot reach ${host}. Check that the device is online and SSH is enabled.\n`);
  } else {
    console.error(`\n[UT Sync] SSH connection failed: ${stderr}\n`);
  }
}

async function checkSshConnection(sshHost: string): Promise<boolean> {
  try {
    await execAsync(`ssh ${SSH_ARGS} -o ConnectTimeout=5 "${sshHost}" echo ok`);
    console.log(`[UT Sync] SSH connection verified.`);
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

  // The templates are tiny (3 files), so every sync just pushes the whole
  // directory in one tarball streamed over ssh stdin — OpenSSH 9+ scp defaults
  // to the SFTP protocol, which Dropbear on OpenWrt does not ship a server for.
  const pushAll = () =>
    execAsync(
      `tar -C "${UT_TEMPLATE_DIR}" -cf - . | ssh ${SSH_ARGS} "${sshHost}" "mkdir -p '${UT_REMOTE_DIR}' && tar -xf - -C '${UT_REMOTE_DIR}'"`,
    );

  const flush = (server: any): Promise<void> => {
    if (!flushing) {
      flushing = (async () => {
        while (dirty) {
          dirty = false;
          try {
            await pushAll();
            console.log(`[UT Sync] Templates synced to ${sshHost}.`);
            server.ws.send({ type: "full-reload", path: "*" });
          } catch (err: any) {
            reportSshError(err, sshHost);
            break;
          }
        }
        flushing = null;
      })();
    }
    return flushing;
  };

  const markDirty = (server: any) => {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => flush(server), 150);
  };

  return {
    name: "ut-sync-plugin",
    apply: "serve",

    configureServer(server) {
      console.log(`[UT Sync] Watching ${UT_TEMPLATE_DIR}`);
      console.log(`[UT Sync] Target: ${sshHost}:${UT_REMOTE_DIR}`);

      // Full push on startup so edits made while the server was down (or a
      // freshly flashed device) can't leave the router stale.
      checkSshConnection(sshHost).then((ok) => {
        if (ok) markDirty(server);
      });

      server.watcher.add(UT_TEMPLATE_DIR);
      const onTemplateEvent = (file: string) => {
        if (file.startsWith(UT_TEMPLATE_DIR) && file.endsWith(".ut")) {
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
  const env = loadEnv(mode, CURRENT_DIR, "");
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

  const proxyConfig = {
    "/luci-static": {
      target: OPENWRT_URL,
      changeOrigin: true,
      secure: false,
    },
    "/cgi-bin": {
      target: OPENWRT_URL,
      changeOrigin: true,
      secure: false,
      configure: (proxy: any) => {
        // Force an uncompressed upstream response: the HTML injection below
        // treats the body as UTF-8 text and would corrupt a gzipped payload.
        proxy.on("proxyReq", (proxyReq: any) => {
          proxyReq.removeHeader("accept-encoding");
        });

        proxy.on("proxyRes", (proxyRes: any, req: any, res: any) => {
          const contentType = proxyRes.headers["content-type"] || "";

          if (contentType.includes("text/html")) {
            const chunks: Buffer[] = [];

            proxyRes.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });

            proxyRes.on("end", () => {
              let html = Buffer.concat(chunks).toString("utf-8");

              const viteClient = `<script type="module" src="/@vite/client"></script>`;
              if (html.includes("</head>") && !html.includes("/@vite/client")) {
                html = html.replace("</head>", `${viteClient}\n\t</head>`);
                console.log("[HMR] Injected Vite client into proxied HTML");
              }

              res.removeAllListeners("end");

              res.setHeader("Content-Length", Buffer.byteLength(html));
              res.end(html);
            });

            proxyRes.pipe = () => proxyRes;
          }
        });
      },
    },
  } as const;

  const aliasConfig = {
    "@": resolve(CURRENT_DIR, "src"),
    "@assets": resolve(CURRENT_DIR, "src/assets"),
  } as const;

  return {
    plugins: [
      tailwindcss(),
      createRedirectPlugin(),
      createLocalServePlugin(),
      createUtSyncPlugin(OPENWRT_SSH_HOST),
      createLuciJsCompressPlugin(),
    ],

    css: {
      lightningcss: {
        targets: browserslistToTargets(
          browserslist("last 4 versions, Firefox ESR, not dead"),
        ),
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
          ...Object.fromEntries(
            readdirSync(PATCH_SRC_DIR)
              .filter((f) => f.endsWith(".css"))
              .map((f) => [
                `patches/${f.slice(0, -4)}`,
                join(PATCH_SRC_DIR, f),
              ]),
          ),
        },
        output: {
          assetFileNames: "aurora/[name].[ext]",
        },
      },
    },

    server: {
      host: DEV_HOST,
      port: DEV_PORT,
      proxy: proxyConfig,
      headers: {
        "Cache-Control": "no-store",
      },
    },

    resolve: {
      alias: aliasConfig,
    },
  };
});
