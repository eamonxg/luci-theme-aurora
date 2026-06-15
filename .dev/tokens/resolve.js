import { DERIVATIONS } from "./spec.js";
import { DEFAULTS } from "./defaults.js";
import { mix, shade, set, alpha, konst, toOklch } from "./engine.js";

// inputs: {name: oklchString}. Returns flat {name: oklchString} values.
export function resolveTokens(mode, inputs) {
  const derivs = DERIVATIONS[mode];
  const resolved = { ...inputs };

  const ref = (name) => {
    if (resolved[name] === undefined) compute(name);
    return resolved[name];
  };

  function compute(name) {
    const rule = derivs[name];
    if (!rule) throw new Error(`unknown derived token: ${name}`);
    const [op, ...args] = rule;
    let color;
    switch (op) {
      case "mix":
        color = mix(ref(args[0]), ref(args[1]), args[2]);
        break;
      case "shade":
        color = shade(ref(args[0]), args[1]);
        break;
      case "set":
        color = set(ref(args[0]), args[1], args[2]);
        break;
      case "alpha":
        color = alpha(ref(args[0]), args[1]);
        break;
      case "const":
        if (args[0].startsWith("var:")) {
          resolved[name] = ref(args[0].slice(4));
          return;
        }
        color = konst(args[0]);
        break;
      default:
        throw new Error(`unknown op: ${op}`);
    }
    resolved[name] = toOklch(color);
  }

  for (const name of Object.keys(derivs)) compute(name);
  return resolved;
}

export const resolveMode = (mode) =>
  resolveTokens(mode, { ...DEFAULTS[mode] });
