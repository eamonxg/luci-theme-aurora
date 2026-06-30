import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Regenerates the PATCH_PAGES allow-list inside header.ut from the set of
// per-page patch files in src/media/patches/. Keeps the on-demand patch loader
// in sync with the patches that actually exist, with no manual bookkeeping.
// Source: src/media/patches/<page>.css  ->  header.ut //#patch-pages markers

const PATCHES_DIR = resolve(import.meta.dirname, "../src/media/patches");
const HEADER_UT = resolve(
  import.meta.dirname,
  "../../ucode/template/themes/aurora/header.ut",
);

const MARKER = /\t\/\/#patch-pages-start\n[\s\S]*?\t\/\/#patch-pages-end/;

const pages = readdirSync(PATCHES_DIR)
  .filter((f) => f.endsWith(".css"))
  .map((f) => f.slice(0, -4))
  .sort();

const block =
  "\t//#patch-pages-start\n" +
  "\tconst PATCH_PAGES = [\n" +
  pages.map((p) => `\t\t'${p}',`).join("\n") +
  (pages.length ? "\n" : "") +
  "\t];\n" +
  "\t//#patch-pages-end";

const src = await readFile(HEADER_UT, "utf-8");

if (!MARKER.test(src)) {
  console.error(
    "gen-patch-pages: //#patch-pages-start.../#patch-pages-end markers not found in header.ut",
  );
  process.exit(1);
}

const next = src.replace(MARKER, block);

if (next !== src) {
  await writeFile(HEADER_UT, next, "utf-8");
  console.log(`gen-patch-pages: wrote ${pages.length} page(s) to header.ut`);
} else {
  console.log("gen-patch-pages: header.ut already up to date");
}
