import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const footer = readFileSync(
  new URL("../../ucode/template/themes/aurora/footer.ut", import.meta.url),
  "utf8",
);
const boot = [...footer.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((script) => script.includes("L.require('menu-aurora')"));

for (const navigation of [undefined, {}]) {
  test(`theme modules start without waiting for menu resolution (Navigation API: ${!!navigation})`, () => {
    const requested = [];
    const L = {
      require(name) {
        requested.push(name);
        return new Promise(() => {});
      },
    };
    new Function("L", "window", boot)(L, { navigation });
    assert.ok(requested.includes("menu-aurora"));
    assert.equal(requested.includes("router-aurora"), !!navigation);
  });
}
