/**
 * Pure helpers for the on-device bench harness (scripts/bench.mjs).
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

export function assertOkStatus(sample) {
  if (!Number.isInteger(sample.status) || sample.status < 200 || sample.status >= 400) {
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
