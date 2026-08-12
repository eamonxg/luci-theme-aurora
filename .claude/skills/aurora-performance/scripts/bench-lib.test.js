import { test } from "node:test";
import assert from "node:assert/strict";
import * as benchLib from "./bench-lib.js";

const {
  median,
  parseCurlMetrics,
  summarize,
  parseEnv,
  parseVmRss,
  formatMarkdownTable,
  assertOkStatus,
} = benchLib;

const helper = (name) => {
  assert.equal(typeof benchLib[name], "function", `missing ${name} helper`);
  return benchLib[name];
};

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

test("assertOkStatus: permits an explicitly expected login-page 403", () => {
  const sample = parseCurlMetrics("0.010000\t0.020000\t5788\t403\n");
  assert.equal(assertOkStatus(sample, [403]), sample);
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

test("parseRunCount: defaults to ten and rejects empty or undersized runs", () => {
  const parseRunCount = helper("parseRunCount");

  assert.equal(parseRunCount(undefined), 10);
  assert.equal(parseRunCount("15"), 15);
  for (const invalid of ["", "7", "10.5", "nope"]) {
    assert.throws(() => parseRunCount(invalid), /RUNS.*integer.*10/);
  }
});

test("normalizeHttpOrigin: canonicalizes trailing slashes and IPv6 hosts", () => {
  const normalizeHttpOrigin = helper("normalizeHttpOrigin");

  assert.equal(
    normalizeHttpOrigin("https://router.test/"),
    "https://router.test",
  );
  assert.equal(
    normalizeHttpOrigin("http://[fd00::1]:8080"),
    "http://[fd00::1]:8080",
  );
  assert.throws(
    () => normalizeHttpOrigin("https://router.test/unexpected/path"),
    /HOST.*origin/,
  );
});

test("authCookie: scopes credentials with a URL instead of a parsed domain", () => {
  const authCookie = helper("authCookie");

  assert.deepEqual(authCookie("sysauth_https", "secret", "http://[fd00::1]"), {
    name: "sysauth_https",
    value: "secret",
    url: "http://[fd00::1]/cgi-bin/luci/",
  });
  assert.throws(
    () => authCookie("sysauth_https", "", "https://router.test"),
    /COOKIE_NAME.*COOKIE_VALUE/,
  );
});

test("parseScenario: accepts known scenarios and rejects silent no-op typos", () => {
  const parseScenario = helper("parseScenario");

  assert.equal(parseScenario(undefined), null);
  assert.equal(parseScenario("vt"), "vt");
  assert.throws(() => parseScenario("view-transition"), /ONLY.*doc.*vt/);
});

test("chromeExecutable: honors CHROME_BIN before platform defaults", () => {
  const chromeExecutable = helper("chromeExecutable");

  assert.equal(
    chromeExecutable({ CHROME_BIN: "/opt/chrome-canary" }, "linux"),
    "/opt/chrome-canary",
  );
  assert.equal(chromeExecutable({}, "linux"), "google-chrome");
  assert.match(chromeExecutable({}, "darwin"), /Google Chrome/);
});

test("assertAuthenticatedPage: rejects a plausible-looking login response", () => {
  const assertAuthenticatedPage = helper("assertAuthenticatedPage");

  assert.throws(
    () =>
      assertAuthenticatedPage({
        hasLoginForm: true,
        hasMainContent: false,
        url: "https://router.test/cgi-bin/luci/admin/system/system",
      }),
    /authentication failed/,
  );
  assert.doesNotThrow(() =>
    assertAuthenticatedPage({
      hasLoginForm: false,
      hasMainContent: true,
      url: "https://router.test/cgi-bin/luci/admin/system/system",
    }),
  );
});

test("withCleanup: releases resources when the measured action throws", async () => {
  const withCleanup = helper("withCleanup");
  let cleaned = 0;

  await assert.rejects(
    withCleanup(
      async () => {
        throw new Error("measurement failed");
      },
      async () => {
        cleaned++;
      },
    ),
    /measurement failed/,
  );
  assert.equal(cleaned, 1);
});

test("rejectPendingRequests: settles every CDP request on disconnect", async () => {
  const rejectPendingRequests = helper("rejectPendingRequests");
  const pending = new Map();
  const requests = [1, 2].map(
    (id) =>
      new Promise((resolve, reject) => {
        pending.set(id, { res: resolve, rej: reject });
      }),
  );

  rejectPendingRequests(pending, new Error("CDP disconnected"));

  await Promise.all(
    requests.map((request) => assert.rejects(request, /CDP disconnected/)),
  );
  assert.equal(pending.size, 0);
});
