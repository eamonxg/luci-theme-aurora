import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveMode, FIXED } from "@eamonxg/aurora-tokens";

const kebab = (s) => s.replace(/_/g, "-");

function block(selector, colors, fixed) {
  const lines = [];
  for (const [k, v] of Object.entries(colors)) {
    lines.push(`  --${kebab(k)}: ${v};`);
  }
  for (const [k, v] of Object.entries(fixed)) {
    lines.push(`  --${kebab(k)}: ${v};`);
  }
  return `${selector} {\n${lines.join("\n")}\n`;
}

const light = resolveMode("light");
const dark = resolveMode("dark");

const STRUCTURE = `
  --font-sans: "Lato", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace;
  --spacing: 0.25rem;
  --container-max-width: 80rem;
  --radius-base: 0.5rem;
`;

const THEME = `@theme inline {
${Object.keys(light)
  .map((k) => `  --color-${kebab(k)}: var(--${kebab(k)});`)
  .join("\n")}

  --shadow-sm: var(--app-shadow-sm);
  --shadow-md: var(--app-shadow-md);
  --shadow-lg: var(--app-shadow-md);
  --shadow-xl: var(--app-shadow-lg);
  --shadow-2xl: var(--app-shadow-lg);

  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
  --spacing: var(--spacing);
  --container-max-width: var(--container-max-width);

  --radius-sm: calc(var(--radius-base) * 0.25);
  --radius: calc(var(--radius-base) * 0.5);
  --radius-md: calc(var(--radius-base) * 0.75);
  --radius-lg: var(--radius-base);
  --radius-xl: calc(var(--radius-base) * 1.5);
  --radius-2xl: calc(var(--radius-base) * 2);
  --radius-3xl: calc(var(--radius-base) * 3);
  --radius-4xl: calc(var(--radius-base) * 4);
}
`;

const HEADER = `/**
 * luci-theme-aurora: design tokens -- GENERATED, DO NOT EDIT.
 * Run \`pnpm gen:tokens\`. Source: @eamonxg/aurora-tokens (spec.js + defaults.js)
 * All color values are flat; lightningcss adds legacy fallbacks.
 * ORDER MATTERS: [data-darkmode="true"] must stay after :root.
 */
`;

const css =
  HEADER +
  "\n" +
  block(":root", light, FIXED.light) +
  STRUCTURE +
  "}\n\n" +
  block('[data-darkmode="true"]', dark, FIXED.dark) +
  "}\n\n" +
  THEME;

await writeFile(
  resolve(import.meta.dirname, "../src/media/_tokens.css"),
  css,
  "utf-8",
);
console.log("gen-tokens: wrote src/media/_tokens.css");
