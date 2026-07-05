#!/usr/bin/env node
/**
 * On-device performance bench (see this skill's references/measuring.md, and
 * references/aurora-budgets.md for the budget table).
 *
 * Measures TTFB / total time / transferred bytes against the OpenWrt device
 * configured in .env (median of N runs), plus uhttpd RSS and theme flash
 * usage over SSH when reachable. Output is a Markdown report — paste it into
 * a PR or archive it under the skill's git-ignored baselines/ directory.
 *
 * Run directly from .dev/ — the .env is located relative to the working
 * directory (.dev/.env), not this script's own path, so the harness keeps
 * working if the skill is later moved or packaged as a plugin.
 *
 * Usage:  node ../.claude/skills/aurora-performance/scripts/bench.mjs
 *         BENCH_RUNS=20 node ../.claude/skills/aurora-performance/scripts/bench.mjs
 */

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  parseCurlMetrics,
  summarize,
  parseEnv,
  parseVmRss,
  formatMarkdownTable,
  assertOkStatus,
} from "./bench-lib.js";

const execFileAsync = promisify(execFile);

let env;
try {
  env = parseEnv(readFileSync(resolve(process.cwd(), ".env"), "utf-8"));
} catch (err) {
  console.error("bench: .env not found in the current directory — run from .dev/ (copy .env.example and set VITE_OPENWRT_HOST first).");
  process.exit(1);
}
const HOST = env.VITE_OPENWRT_HOST || "http://192.168.1.1:80";
const SSH_HOST = env.VITE_OPENWRT_SSH_HOST || "";
const SSH_KEY = env.VITE_OPENWRT_SSH_KEY || "";
const RUNS = Number(process.env.BENCH_RUNS) || 10;

const CURL_FORMAT = "%{time_starttransfer}\\t%{time_total}\\t%{size_download}\\t%{http_code}";

// The login page is the honest server-side render target: it is what an
// unauthenticated bench can measure, and TTFB comparisons must compare like
// with like (spec: error handling / edge cases).
const TARGETS = [
  { label: "GET /cgi-bin/luci (login page)", path: "/cgi-bin/luci" },
  { label: "main.css (identity)", path: "/luci-static/aurora/main.css" },
  { label: "main.css (gzip negotiated)", path: "/luci-static/aurora/main.css", gzip: true },
  { label: "login.css (gzip negotiated)", path: "/luci-static/aurora/login.css", gzip: true },
  { label: "menu-aurora.js (gzip negotiated)", path: "/luci-static/resources/menu-aurora.js", gzip: true },
];

async function measureOnce(target) {
  const args = [
    "-o", "/dev/null",
    "-s",
    "-w", CURL_FORMAT,
    "--max-time", "30",
  ];
  if (target.gzip) args.push("-H", "Accept-Encoding: gzip");
  args.push(`${HOST}${target.path}`);
  const { stdout } = await execFileAsync("curl", args);
  return assertOkStatus(parseCurlMetrics(stdout));
}

async function measureTarget(target) {
  const samples = [];
  for (let i = 0; i < RUNS; i++) samples.push(await measureOnce(target));
  return { label: target.label, ...summarize(samples) };
}

function sshArgs(command) {
  const args = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=5"];
  if (SSH_KEY) args.push("-i", SSH_KEY);
  args.push(SSH_HOST, command);
  return args;
}

async function deviceReport() {
  if (!SSH_HOST) return "⚠ VITE_OPENWRT_SSH_HOST not set — HTTP metrics only.";
  try {
    const { stdout: status } = await execFileAsync(
      "ssh",
      sshArgs('cat /proc/$(pidof uhttpd | cut -d" " -f1)/status'),
    );
    const { stdout: du } = await execFileAsync(
      "ssh",
      sshArgs("du -sk /www/luci-static/aurora /www/luci-static/resources/menu-aurora.js"),
    );
    const rss = parseVmRss(status);
    return [
      "## Device",
      "",
      `- uhttpd VmRSS: ${rss !== null ? `${rss} kB` : "unavailable"}`,
      "- Theme flash usage:",
      "",
      "```",
      du.trim(),
      "```",
    ].join("\n");
  } catch (err) {
    return `⚠ SSH unreachable (${err?.code ?? "error"}) — HTTP metrics only.`;
  }
}

const rows = [];
try {
  for (const target of TARGETS) {
    process.stderr.write(`bench: ${target.label} ×${RUNS}\n`);
    rows.push(await measureTarget(target));
  }
} catch (err) {
  console.error(`bench: aborted — ${TARGETS[rows.length].label} failed (${err.message})`);
  process.exit(1);
}

console.log(`# Bench — ${HOST} (median of ${RUNS} runs)`);
console.log("");
console.log(formatMarkdownTable(rows));
console.log("");
console.log(await deviceReport());
