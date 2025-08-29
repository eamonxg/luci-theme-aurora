/**
 * Copyright (C) 2025 eamonxg <eamonxiong@gmail.com>
 * Licensed under the Apache License, Version 2.0.
 */

import tailwindcss from "@tailwindcss/vite";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { minify as terserMinify } from "terser";
import { defineConfig, loadEnv, Plugin, ResolvedConfig } from "vite";

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
      for (const filePath of jsFiles) {
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
      }
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
  const OPENWRT_HOST = env.VITE_OPENWRT_HOST || "http://192.168.1.1:80";
  const DEV_HOST = env.VITE_DEV_HOST || "127.0.0.1";
  const DEV_PORT = Number(env.VITE_DEV_PORT) || 5173;

  const proxyConfig = {
    "/luci-static/aurora/main.css": {
      target: `http://localhost:${DEV_PORT}`,
      changeOrigin: true,
      rewrite: (_path: string) => "/src/media/main.css",
    },
    "/luci-static": {
      target: OPENWRT_HOST,
      changeOrigin: true,
      secure: false,
    },
    "/cgi-bin": {
      target: OPENWRT_HOST,
      changeOrigin: true,
      secure: false,
    },
  } as const;

  const aliasConfig = {
    "@": resolve(CURRENT_DIR, "src"),
    "@assets": resolve(CURRENT_DIR, "src/assets"),
  } as const;

  return {
    plugins: [
      tailwindcss(),
      createLuciJsCompressPlugin(),
      createRedirectPlugin(),
    ],

    build: {
      outDir: BUILD_OUTPUT,
      cssMinify: "lightningcss",

      rollupOptions: {
        input: {
          main: resolve(CURRENT_DIR, "src/media/main.css"),
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
    },

    resolve: {
      alias: aliasConfig,
    },
  };
});
