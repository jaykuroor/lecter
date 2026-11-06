// Writes the bundled "Lecter" theme (src/theme/tokens.css) from docs/design/tokens.json
// (12-settings-theme-onboarding.md#theme). Run by tokens.test.ts, which keeps the committed file
// equal to this output (`pnpm -C ui exec vitest run src/theme -u` rewrites it after a token change).
// The file is static CSS in the first-paint stylesheet: no JS runs to apply a theme (D-237).
//
// - `color` and `gloss-kind`: `--<name>`, light on :root; dark under the OS's
//   prefers-color-scheme: dark unless `data-theme="light"` pins light, and under `data-theme="dark"`.
// - `font` and `shadow`: `--font-<name>`, `--shadow-<name>`, as written.
// - `space.scale`: `--space-<n>: <n>px`. `radius`, `layout`, `motion`: `--<group>-<name>` with the
//   value's leading length or duration ("6-7px (buttons…)" → 6px); entries without one are rules
//   for components.md, not values, and are skipped. `type`, `mix`, `keycap` and `mode-colors` are
//   recipes over these tokens (components.md), so they have no property of their own.

type Group = Record<string, unknown>;

const NAME = /^[a-z0-9][a-z0-9-]*$/;
// A value can't end its declaration or block, or open a comment.
const UNSAFE = /[;{}]|\/\*/;
const LEADING = /^(\d+(?:\.\d+)?)(?:-\d+(?:\.\d+)?)?(px|s)\b/;

function group(tokens: Group, key: string): Group {
  const g = tokens[key] ?? {};
  if (typeof g !== "object") throw new Error(`tokens.json: ${key} is not an object`);
  return g as Group;
}

/** The entries of a group, `$comment` keys left out, names checked. */
function entries(tokens: Group, key: string): [string, unknown][] {
  return Object.entries(group(tokens, key)).filter(([name]) => {
    if (name.startsWith("$")) return false;
    if (!NAME.test(name)) throw new Error(`tokens.json: ${key} has a token named ${JSON.stringify(name)}`);
    return true;
  });
}

function value(v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "" || UNSAFE.test(v)) {
    throw new Error(`tokens.json: ${where} is not a plain CSS value`);
  }
  return v.trim();
}

interface Colour {
  name: string;
  light: string;
  dark: string;
}

function colours(tokens: Group): Colour[] {
  const out: Colour[] = [];
  for (const key of ["color", "gloss-kind"]) {
    for (const [name, pair] of entries(tokens, key)) {
      const p = Object(pair) as Record<string, unknown>;
      for (const scheme of ["light", "dark"]) {
        if (p[scheme] === undefined) throw new Error(`tokens.json: ${key}.${name} has no ${scheme} value`);
      }
      out.push({ name, light: value(p.light, `${key}.${name}`), dark: value(p.dark, `${key}.${name}`) });
    }
  }
  return out;
}

/** The scheme-independent properties: fonts, shadows, spacing, radii, layout and motion. */
function others(tokens: Group): string[] {
  const out: string[] = [];
  for (const key of ["font", "shadow"]) {
    for (const [name, v] of entries(tokens, key)) out.push(`--${key}-${name}: ${value(v, `${key}.${name}`)};`);
  }
  // Whole, non-negative pixels only: anything else isn't a step of the scale.
  const scale = group(tokens, "space").scale;
  if (Array.isArray(scale)) {
    for (const n of scale) if (Number.isInteger(n) && n >= 0) out.push(`--space-${n}: ${n}px;`);
  }
  for (const key of ["radius", "layout", "motion"]) {
    for (const [name, v] of entries(tokens, key)) {
      const m = LEADING.exec(String(v));
      if (m) out.push(`--${key}-${name}: ${m[1]}${m[2]};`);
    }
  }
  return out;
}

/** tokens.css for a parsed tokens.json. Throws on a file it can't turn into safe CSS. */
export function tokensCss(tokens: unknown): string {
  if (typeof tokens !== "object" || tokens === null) throw new Error("tokens.json is not an object of token groups");
  const t = tokens as Group;
  const cs = colours(t);
  const lines = (pad: string, decls: string[]) => decls.map((d) => `${pad}${d}\n`).join("");
  const dark = cs.map((c) => `--${c.name}: ${c.dark};`);
  return [
    "/* The bundled Lecter theme (12-settings-theme-onboarding.md#theme), generated from\n",
    "   docs/design/tokens.json by src/theme/generate.ts. Don't edit: change tokens.json and run\n",
    "   `pnpm -C ui exec vitest run src/theme -u`. */\n",
    "/* biome-ignore format: generated; values exactly as tokens.json writes them */\n",
    ":root {\n",
    "  color-scheme: light dark;\n",
    lines(
      "  ",
      cs.map((c) => `--${c.name}: ${c.light};`),
    ),
    lines("  ", others(t)),
    "}\n",
    ':root[data-theme="light"] {\n',
    "  color-scheme: light;\n",
    "}\n",
    "@media (prefers-color-scheme: dark) {\n",
    '  :root:not([data-theme="light"]) {\n',
    lines("    ", dark),
    "  }\n",
    "}\n",
    ':root[data-theme="dark"] {\n',
    "  color-scheme: dark;\n",
    lines("  ", dark),
    "}\n",
  ].join("");
}
