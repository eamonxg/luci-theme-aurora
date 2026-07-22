import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("../src/resource/menu-aurora.js", import.meta.url),
  "utf8",
);

const E = (tagName, attributes, children) => ({
  tagName,
  attributes,
  children,
});

const loadMenuModule = () => {
  const baseclass = {
    extend(module) {
      return module;
    },
  };
  const ui = { menu: { getChildren: () => [] } };
  const L = {
    env: { dispatchpath: [], requestpath: [] },
    url: (...segments) => `/${segments.join("/")}`,
  };

  return new Function(
    "baseclass",
    "ui",
    "E",
    "L",
    "_",
    "document",
    "window",
    "localStorage",
    source,
  )(baseclass, ui, E, L, (value) => value, {}, {}, {});
};

const menu = loadMenuModule();

const score = (query, text) => menu.fuzzyMatch(query, text)?.score ?? null;

const sliced = (text, ranges) =>
  ranges.map(([from, to]) => text.slice(from, to));

test("matches a scattered subsequence and reports its ranges", () => {
  const match = menu.fuzzyMatch("dns", "DHCP and DNS");

  assert.ok(match);
  assert.deepEqual(sliced("DHCP and DNS", match.ranges), ["DNS"]);
});

test("returns null when the query is not a subsequence", () => {
  assert.equal(menu.fuzzyMatch("zzz", "Firewall"), null);
});

test("retries from every first-character occurrence instead of staying greedy", () => {
  // A single greedy pass anchors "dns" to the leading D of "DHCP and DNS" and
  // scatters, scoring the real hit below shorter near-misses.
  assert.ok(score("dns", "DHCP and DNS") > score("dns", "Diagnostics"));
});

test("scores an adjacency run above the same characters scattered", () => {
  assert.ok(score("fir", "Firewall") > score("fir", "Failover in Routing"));
});

test("rewards word starts", () => {
  assert.ok(score("s", "Status") > score("s", "Wireless"));
});

test("penalises longer targets so the tighter title wins", () => {
  assert.ok(score("log", "Logout") > score("log", "Logging and reporting"));
});

test("matches CJK titles", () => {
  const match = menu.fuzzyMatch("防火墙", "防火墙设置");

  assert.ok(match);
  assert.deepEqual(sliced("防火墙设置", match.ranges), ["防火墙"]);
});

test("keeps astral characters whole in the reported ranges", () => {
  // `at` is a UTF-16 offset while for...of yields code points: advancing by 1
  // would end the range inside the surrogate pair and slice it into mojibake.
  const title = "🚀 Passwall";
  const match = menu.fuzzyMatch("🚀", title);

  assert.ok(match);
  assert.deepEqual(match.ranges, [[0, 2]]);
  assert.deepEqual(sliced(title, match.ranges), ["🚀"]);
});

test("merges adjacent astral matches into one range", () => {
  const title = "𠀀𠀁 Extension";
  const match = menu.fuzzyMatch("𠀀𠀁", title);

  assert.ok(match);
  assert.deepEqual(match.ranges, [[0, 4]]);
  assert.deepEqual(sliced(title, match.ranges), ["𠀀𠀁"]);
});

test("an empty query matches every entry unranked and unhighlighted", () => {
  assert.deepEqual(menu.matchPaletteEntry("", { title: "Status" }), {
    score: 0,
    ranges: null,
  });
});

test("title hits outrank name hits and are the only highlighted ones", () => {
  const title = menu.matchPaletteEntry("dns", {
    title: "DNS",
    name: "dns",
    group: "Network",
  });
  const viaName = menu.matchPaletteEntry("dhcp", {
    title: "DNS",
    name: "dhcp",
    group: "Network",
  });

  assert.ok(title.ranges);
  assert.equal(viaName.ranges, null);
  assert.ok(title.score > viaName.score);
});

test("falls back to the group when neither title nor name matches", () => {
  const match = menu.matchPaletteEntry("netw", {
    title: "DNS",
    name: "dns",
    group: "Network",
  });

  assert.ok(match);
  assert.equal(match.ranges, null);
});

test("returns falsy when nothing on the entry matches", () => {
  assert.ok(
    !menu.matchPaletteEntry("zzz", {
      title: "DNS",
      name: "dns",
      group: "Network",
    }),
  );
});

test("wraps matched ranges in <mark> and keeps the surrounding text", () => {
  const parts = menu.highlightPaletteMatch("DHCP and DNS", [[9, 12]]);

  assert.deepEqual(
    parts.map((part) => (typeof part === "string" ? part : part.children[0])),
    ["DHCP and ", "DNS", ""],
  );
  assert.equal(parts[1].tagName, "mark");
});

test("highlights astral characters without splitting the surrogate pair", () => {
  const parts = menu.highlightPaletteMatch("🚀 Passwall", [[0, 2]]);

  assert.equal(parts[1].children[0], "🚀");
  assert.ok(!parts.some((part) => String(part).includes("�")));
});

test("skips highlighting when case folding would skew the offsets", () => {
  // "İ".toLowerCase() is two code units, so ranges measured on the lowercased
  // copy no longer index the original.
  assert.deepEqual(menu.highlightPaletteMatch("İnterface", [[0, 1]]), [
    "İnterface",
  ]);
});

test("renders the plain title when there are no ranges", () => {
  assert.deepEqual(menu.highlightPaletteMatch("Status", null), ["Status"]);
});
