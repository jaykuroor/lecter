// F-042 criterion 1: every token in docs/design/tokens.json is a CSS custom property, light and
// dark, and the bundled "Lecter" theme (src/theme/tokens.css) uses exactly those values
// (12-settings-theme-onboarding.md#theme). The expected values come from tokens.json itself (the
// spec input), read by a parser of the committed CSS that shares nothing with the generator.
// Criterion 3's CSS half: the dark values apply under the OS's prefers-color-scheme: dark, and
// one attribute on :root (data-theme, D-237) pins either scheme.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { designTokens, filesUnder, uiSrc } from "./__tests__/repo";
import { tokensCss } from "./generate";

type Pair = { light: string; dark: string };
const tokens = designTokens() as Record<string, Record<string, unknown>>;
const CSS = readFileSync(join(uiSrc(), "theme", "tokens.css"), "utf8");
const LIGHT_FORCED = ':root[data-theme="light"] {';
const DARK_QUERY = "@media (prefers-color-scheme: dark)";
const DARK_FORCED = ':root[data-theme="dark"] {';

/** Colour tokens (the `color` and `gloss-kind` groups) as name → {light, dark}. */
function colourTokens(): Map<string, Pair> {
  const out = new Map<string, Pair>();
  for (const group of ["color", "gloss-kind"]) {
    for (const [name, value] of Object.entries(tokens[group] ?? {})) {
      if (!name.startsWith("$")) out.set(name, value as Pair);
    }
  }
  return out;
}

const colourNames = (): string[] => [...colourTokens().keys()].map((n) => `--${n}`).sort();

/** `name: value;` declarations of a CSS block, comments removed. */
function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([a-z-][a-z0-9-]*)\s*:\s*([^;{}]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim());
  }
  return out;
}

/** The file's four parts, in this order: light `:root`, pinned light, dark by the OS, pinned dark. */
function blocks() {
  const at = [LIGHT_FORCED, DARK_QUERY, DARK_FORCED].map((marker) => CSS.indexOf(marker));
  expect(at[0], "tokens.css has no pinned light block").toBeGreaterThan(0);
  expect(at[1], "the OS dark block comes after the pinned light one").toBeGreaterThan(at[0] as number);
  expect(at[2], "the pinned dark block comes last").toBeGreaterThan(at[1] as number);
  const [lf, dq, df] = at as [number, number, number];
  const lightText = CSS.slice(0, lf);
  return {
    lightText,
    light: declarations(lightText),
    lightForced: declarations(CSS.slice(lf, dq)),
    darkText: CSS.slice(dq, df),
    dark: declarations(CSS.slice(dq, df)),
    darkForced: declarations(CSS.slice(df)),
  };
}

describe("the bundled Lecter theme", () => {
  it("defines every colour token light and dark with the design values", () => {
    const { light, dark, darkForced } = blocks();
    const colours = colourTokens();
    expect(colours.size).toBe(29);
    for (const [name, value] of colours) {
      expect(light.get(`--${name}`), `--${name} light`).toBe(value.light);
      expect(dark.get(`--${name}`), `--${name} dark`).toBe(value.dark);
      expect(darkForced.get(`--${name}`), `--${name} pinned dark`).toBe(value.dark);
    }
  });

  it("follows the OS dark preference unless data-theme pins a scheme", () => {
    const { lightText, darkText, light, lightForced, dark, darkForced } = blocks();
    expect(lightText).toMatch(/^:root \{$/m);
    expect(lightText).not.toContain("@media");
    expect(lightText).not.toContain("data-theme");
    expect(light.get("color-scheme")).toBe("light dark");
    // The OS's dark values, unless data-theme="light" pins the light ones.
    expect(darkText).toMatch(/^@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\) \{$/m);
    expect([...dark.keys()].sort()).toEqual(colourNames());
    expect(lightForced).toEqual(new Map([["color-scheme", "light"]]));
    expect([...darkForced.keys()].sort()).toEqual(["color-scheme", ...colourNames()].sort());
    expect(darkForced.get("color-scheme")).toBe("dark");
  });

  it("uses no colour beyond the tokens' own", () => {
    const { light } = blocks();
    const hex = [...light].filter(([, v]) => /#[0-9a-f]{3,8}\b/i.test(v)).map(([k]) => k);
    expect(hex.sort()).toEqual(colourNames());
  });

  it("defines the fonts and shadows exactly as tokens.json writes them", () => {
    const { light } = blocks();
    for (const group of ["font", "shadow"]) {
      for (const [name, value] of Object.entries(tokens[group] ?? {})) {
        if (!name.startsWith("$")) expect(light.get(`--${group}-${name}`), `--${group}-${name}`).toBe(value);
      }
    }
    expect(light.get("--font-mono")).toBe(
      '"JetBrains Mono", "Adwaita Mono", "Source Code Pro", ui-monospace, Menlo, monospace',
    );
    expect(light.get("--shadow-popover")).toBe("0 14px 34px -16px rgba(0,0,0,.55)");
  });

  it("defines the spacing, radius, layout and motion lengths", () => {
    const { light } = blocks();
    for (const n of [2, 4, 6, 8, 10, 12, 14, 16, 24, 32]) expect(light.get(`--space-${n}`)).toBe(`${n}px`);
    const want: Record<string, string> = {
      "--radius-kbd": "5px",
      "--radius-small": "6px",
      "--radius-acts": "8px",
      "--radius-gloss": "10px",
      "--radius-card": "12px",
      "--radius-pill": "999px",
      "--layout-rail": "208px",
      "--layout-side-panel": "312px",
      "--layout-document-max": "800px",
      "--layout-gutter": "92px",
      "--layout-headerbar-min-height": "47px",
      "--layout-status-line-min-height": "27px",
      "--layout-headerbar-button": "34px",
      "--motion-gloss-enter": "0.35s",
      "--motion-keystroke-fade": "0.5s",
      "--motion-theme-switch": "0.25s",
    };
    for (const [name, value] of Object.entries(want)) expect(light.get(name), name).toBe(value);
    // "no animation; instant state changes" is a rule, not a length.
    expect(light.has("--motion-reduced-motion")).toBe(false);
  });

  it("defines every custom property the components read", () => {
    const files = filesUnder(uiSrc()).filter(([path]) => /\.(css|tsx?)$/.test(path) && !/\.test\./.test(path));
    const defined = new Set(declarations(CSS).keys());
    // Set per element: --k on a gloss, --c on a chip or course colour (tokens.json "mix").
    for (const [, text] of files)
      for (const m of text.matchAll(/["'\s{;](--[a-z0-9-]+)["']?\s*:/g)) defined.add(m[1] as string);
    const read = new Set(
      files.flatMap(([, text]) => [...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string)),
    );
    expect(read.size).toBeGreaterThan(20);
    expect([...read].filter((name) => !defined.has(name)).sort()).toEqual([]);
  });

  it("gives the page the base type of tokens.json (type.base: 14px / 1.5 ui) and the window colours", () => {
    expect(tokens.type?.base).toBe("14px / 1.5 ui");
    const html = declarations(readFileSync(join(uiSrc(), "theme", "base.css"), "utf8"));
    expect(html.get("font")).toBe("14px / 1.5 var(--font-ui)");
    expect(html.get("background")).toBe("var(--window-bg)");
    expect(html.get("color")).toBe("var(--window-fg)");
  });

  it("is the generator's output for the current tokens.json (rerun with -u after a token change)", async () => {
    await expect(tokensCss(designTokens())).toMatchFileSnapshot("./tokens.css");
  });
});

describe("tokensCss", () => {
  const base = { color: { "window-bg": { light: "#fafafb", dark: "#222226", gtk: "window_bg_color" } } };

  it("writes a colour's light value in :root and its dark value in both dark blocks", () => {
    const css = tokensCss(base);
    expect(css).toContain(":root {\n  color-scheme: light dark;\n  --window-bg: #fafafb;\n}\n");
    expect(css).toContain(`${LIGHT_FORCED}\n  color-scheme: light;\n}\n`);
    expect(css).toContain(`${DARK_QUERY} {\n  :root:not([data-theme="light"]) {\n    --window-bg: #222226;\n  }\n}\n`);
    expect(css).toContain(`${DARK_FORCED}\n  color-scheme: dark;\n  --window-bg: #222226;\n}\n`);
  });

  it("refuses a colour token without a dark value", () => {
    expect(() => tokensCss({ color: { "view-bg": { light: "#ffffff" } } })).toThrow("color.view-bg has no dark value");
  });

  it("refuses a value that would end the declaration or the block", () => {
    expect(() => tokensCss({ color: { x: { light: "#fff; }", dark: "#000" } } })).toThrow("color.x");
    expect(() => tokensCss({ color: { x: { light: "#fff", dark: "#000}" } } })).toThrow("color.x");
    expect(() => tokensCss({ ...base, font: { ui: "Inter} body{color:red" } })).toThrow("font.ui");
  });

  it("refuses a token name that isn't a CSS identifier", () => {
    expect(() => tokensCss({ color: { "a b": { light: "#fff", dark: "#000" } } })).toThrow('"a b"');
  });

  it("skips $comment entries and a length it can't read", () => {
    const css = tokensCss({
      ...base,
      $comment: "x",
      motion: { $comment: "y", fade: "0.5s ease-out", rule: "none at all" },
    });
    expect(css).toContain("--motion-fade: 0.5s;");
    expect(css).not.toContain("$");
    expect(css).not.toContain("--motion-rule");
  });

  it("refuses a file that isn't an object, or a group that isn't one", () => {
    expect(() => tokensCss("tokens")).toThrow("tokens.json is not an object of token groups");
    expect(() => tokensCss(null)).toThrow("tokens.json is not an object of token groups");
    expect(() => tokensCss({ color: "red" })).toThrow("tokens.json: color is not an object");
    expect(() => tokensCss({ ...base, radius: 5 })).toThrow("tokens.json: radius is not an object");
  });

  it("refuses a colour that isn't a light and dark pair of plain values", () => {
    expect(() => tokensCss({ color: { x: "#fff" } })).toThrow("color.x has no light value");
    expect(() => tokensCss({ color: { x: null } })).toThrow("color.x has no light value");
    expect(() => tokensCss({ color: { x: { light: 1, dark: "#000" } } })).toThrow("color.x is not a plain CSS value");
    expect(() => tokensCss({ color: { x: { light: "#fff", dark: "  " } } })).toThrow(
      "color.x is not a plain CSS value",
    );
    expect(() => tokensCss({ color: { x: { light: "#fff", dark: "#000 /* x" } } })).toThrow("color.x");
  });

  it("writes a value without the spaces around it", () => {
    expect(tokensCss({ color: { x: { light: " #fff ", dark: "#000" } } })).toContain("\n  --x: #fff;\n");
  });

  it("keeps whole, non-negative steps of the spacing scale", () => {
    const css = tokensCss({ space: { scale: [0, 2, -2, 1.5, "4"] } });
    expect(css.match(/--space-[^:]*: [^;]*;/g)).toEqual(["--space-0: 0px;", "--space-2: 2px;"]);
    expect(tokensCss({ space: { scale: { a: 2 } } })).not.toContain("--space");
  });

  it("takes a length or duration only from the start of a value, the lower end of a range", () => {
    const css = tokensCss({
      radius: { a: "6-12px (rows)", b: "about 6px", c: "3pxx", d: 5, e: "10px" },
      motion: { f: "0.25-0.35s fade", g: "1.5s" },
    });
    expect(css.match(/--(?:radius|motion)-[^:]*: [^;]*;/g)).toEqual([
      "--radius-a: 6px;",
      "--radius-e: 10px;",
      "--motion-f: 0.25s;",
      "--motion-g: 1.5s;",
    ]);
  });
});
