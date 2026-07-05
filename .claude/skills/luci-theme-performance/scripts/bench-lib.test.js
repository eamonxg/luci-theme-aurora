import { test } from "node:test";
import assert from "node:assert/strict";
import {
  median,
  parseCurlMetrics,
  summarize,
  parseEnv,
  parseVmRss,
  formatMarkdownTable,
  assertOkStatus,
} from "./bench-lib.js";

test("median: odd count returns middle value", () => {
  assert.equal(median([3, 1, 2]), 2);
});

test("median: even count returns mean of middle pair", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("median: does not mutate its input", () => {
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test("parseCurlMetrics: parses tab-separated curl -w output, seconds → ms", () => {
  const m = parseCurlMetrics("0.045123\t0.230500\t28083\t200\n");
  assert.equal(Math.round(m.ttfbMs), 45);
  assert.equal(Math.round(m.totalMs), 231);
  assert.equal(m.bytes, 28083);
  assert.equal(m.status, 200);
});

test("assertOkStatus: accepts 2xx and 3xx samples", () => {
  const sample = { ttfbMs: 10, totalMs: 20, bytes: 100, status: 302 };
  assert.equal(assertOkStatus(sample), sample);
});

test("assertOkStatus: rejects 404 samples", () => {
  assert.throws(
    () => assertOkStatus(parseCurlMetrics("0.010000\t0.020000\t123\t404\n")),
    /HTTP 404/,
  );
});

test("summarize: medians of times, first sample's bytes/status, run count", () => {
  const s = summarize([
    { ttfbMs: 50, totalMs: 200, bytes: 1000, status: 200 },
    { ttfbMs: 40, totalMs: 300, bytes: 1000, status: 200 },
    { ttfbMs: 60, totalMs: 100, bytes: 1000, status: 200 },
  ]);
  assert.equal(s.ttfbMs, 50);
  assert.equal(s.totalMs, 200);
  assert.equal(s.bytes, 1000);
  assert.equal(s.status, 200);
  assert.equal(s.runs, 3);
});

test("parseEnv: KEY=VALUE lines, skips comments and blanks", () => {
  const env = parseEnv(
    "# comment\nVITE_OPENWRT_HOST=http://10.0.0.1:80\n\nVITE_DEV_PORT=5173\n",
  );
  assert.deepEqual(env, {
    VITE_OPENWRT_HOST: "http://10.0.0.1:80",
    VITE_DEV_PORT: "5173",
  });
});

test("parseVmRss: extracts kB from /proc status text", () => {
  const text = "Name:\tuhttpd\nVmPeak:\t 5000 kB\nVmRSS:\t    3212 kB\n";
  assert.equal(parseVmRss(text), 3212);
});

test("parseVmRss: returns null when VmRSS absent", () => {
  assert.equal(parseVmRss("Name:\tuhttpd\n"), null);
});

test("formatMarkdownTable: header + one row per entry, rounded ms", () => {
  const out = formatMarkdownTable([
    { label: "login page", ttfbMs: 45.6, totalMs: 230.4, bytes: 28083, status: 200, runs: 10 },
  ]);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 3); // header, separator, one row
  assert.match(lines[0], /Target.*TTFB.*Total.*Bytes.*HTTP.*Runs/);
  assert.match(lines[2], /\| login page \| 46 \| 230 \| 28083 \| 200 \| 10 \|/);
});
