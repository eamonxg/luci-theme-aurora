/**
 * Pure helpers for the HTTP and browser bench harnesses.
 * Everything here is deterministic and unit-tested; all I/O lives in the CLI.
 */

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// One line of `curl -w '%{time_starttransfer}\t%{time_total}\t%{size_download}\t%{http_code}'`.
export function parseCurlMetrics(line) {
  const [ttfb, total, bytes, status] = line.trim().split("\t");
  return {
    ttfbMs: Number(ttfb) * 1000,
    totalMs: Number(total) * 1000,
    bytes: Number(bytes),
    status: Number(status),
  };
}

export function assertOkStatus(sample, allowedStatuses = []) {
  if (
    !Number.isInteger(sample.status) ||
    (!(sample.status >= 200 && sample.status < 400) &&
      !allowedStatuses.includes(sample.status))
  ) {
    throw new Error(`HTTP ${sample.status}`);
  }
  return sample;
}

export function summarize(samples) {
  return {
    ttfbMs: median(samples.map((s) => s.ttfbMs)),
    totalMs: median(samples.map((s) => s.totalMs)),
    bytes: samples[0].bytes,
    status: samples[0].status,
    runs: samples.length,
  };
}

export function parseEnv(text) {
  const env = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return env;
}

export function parseVmRss(procStatusText) {
  const m = procStatusText.match(/^VmRSS:\s+(\d+)\s+kB/m);
  return m ? Number(m[1]) : null;
}

export function formatMarkdownTable(rows) {
  const lines = [
    "| Target | TTFB (ms, median) | Total (ms, median) | Bytes | HTTP | Runs |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.label} | ${Math.round(r.ttfbMs)} | ${Math.round(r.totalMs)} | ${r.bytes} | ${r.status} | ${r.runs} |`,
    ),
  ];
  return lines.join("\n");
}

export function parseRunCount(value, fallback = 10) {
  const runs = value == null ? fallback : Number(value);

  if (!Number.isInteger(runs) || runs < 10)
    throw new Error("RUNS must be an integer greater than or equal to 10");

  return runs;
}

export function normalizeHttpOrigin(value) {
  let url;

  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("HOST must be an absolute HTTP(S) origin");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("HOST must be an absolute HTTP(S) origin");
  }

  return url.origin;
}

export function authCookie(name, value, origin) {
  if (!name || !value)
    throw new Error("COOKIE_NAME and COOKIE_VALUE must both be set");

  return {
    name,
    value,
    url: new URL("/cgi-bin/luci/", origin).href,
  };
}

export function parseScenario(value) {
  if (value == null || value === "") return null;

  const allowed = ["doc", "click", "back", "polling", "vt"];
  if (!allowed.includes(value))
    throw new Error(`ONLY must be one of: ${allowed.join(", ")}`);

  return value;
}

export function chromeExecutable(env, platform) {
  if (env.CHROME_BIN) return env.CHROME_BIN;
  if (platform === "darwin")
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (platform === "win32") return "chrome.exe";
  return "google-chrome";
}

export function assertAuthenticatedPage(state) {
  if (state.hasLoginForm || !state.hasMainContent)
    throw new Error(`authentication failed at ${state.url}`);

  return state;
}

export async function withCleanup(action, cleanup) {
  try {
    return await action();
  } finally {
    await cleanup();
  }
}

export function rejectPendingRequests(pending, error) {
  for (const request of pending.values()) request.rej(error);
  pending.clear();
}
