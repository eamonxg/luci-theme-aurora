import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/* PWA icons intentionally use an opaque black canvas. The standalone logo
   must use its dedicated transparent source instead. */
const imagePath = resolve("src/assets/logo-mark-192x192.png");
const logoPath = resolve("public/aurora/images/logo.svg");
const encoded = (await readFile(imagePath)).toString("base64");
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
  `<image width="512" height="512" href="data:image/png;base64,${encoded}"/>` +
  "</svg>\n";

await writeFile(logoPath, svg);
console.log(`logo.svg: ${Buffer.byteLength(svg)} B`);
