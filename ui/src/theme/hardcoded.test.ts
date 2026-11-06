// F-042 criterion 2: a lint check fails on hard-coded colours in ui/src components
// ("All UI colours are CSS custom properties", 12-settings-theme-onboarding.md#theme). The scan
// at the bottom runs over the real tree in the ui-tests stage; the cases above it pin what the
// check catches and what it leaves alone.
import { describe, expect, it } from "vitest";
import { filesUnder, uiSrc } from "./__tests__/repo";
import { hardCodedColours, isLinted } from "./hardcoded";

const found = (file: string, text: string) => hardCodedColours(file, text).map((f) => `${f.line}:${f.colour}`);

describe("hard-coded colours in CSS", () => {
  it("finds hex colours of every length in a declaration", () => {
    const css = ".a {\n  color: #fff;\n  background: #FAFAFB;\n  border-color: #0001;\n  fill: #11223344;\n}\n";
    expect(found("x.css", css)).toEqual(["2:#fff", "3:#FAFAFB", "4:#0001", "5:#11223344"]);
  });

  it("finds colour functions but not color-mix over tokens", () => {
    const css = [
      ".a {",
      "  color: rgb(0 0 0);",
      "  box-shadow: 0 1px 2px rgba(0,0,0,.5);",
      "  background: hsl(10 20% 30%);",
      "  outline-color: oklch(0.5 0.1 200);",
      "  caret-color: color(srgb 1 0 0);",
      "  border-color: color-mix(in srgb, var(--k) 24%, var(--borders));",
      "}",
    ].join("\n");
    expect(found("x.css", css)).toEqual(["2:rgb(", "3:rgba(", "4:hsl(", "5:oklch(", "6:color("]);
  });

  it("finds named and system colours, whatever their case", () => {
    const css = ".a {\n  color: White;\n  background: var(--x, Canvas);\n  border: 1px solid red;\n}\n";
    expect(found("x.css", css)).toEqual(["2:White", "3:Canvas", "4:red"]);
  });

  it("finds a colour in a custom property's value", () => {
    expect(found("x.css", ".g {\n  --k: #15772e;\n}")).toEqual(["2:#15772e"]);
  });

  it("leaves tokens, keywords, selectors, comments and look-alike words alone", () => {
    const css = [
      "/* was #fff and rgb(0 0 0), red */",
      "#root, .tan:hover, .a[data-x='red'] {",
      "  color: var(--window-fg);",
      "  background: transparent;",
      "  border-color: currentColor;",
      "  white-space: nowrap;",
      "  width: calc(tan(45deg) * 1px);",
      '  font-family: "Linen Sans", var(--font-ui);',
      "  --k-red-ish: var(--k-prof);",
      "  color: inherit;",
      "}",
    ].join("\n");
    expect(found("x.css", css)).toEqual([]);
  });

  it("counts lines across multi-line comments and declarations", () => {
    expect(found("x.css", "/* a\n b\n */\n.a {\n  box-shadow:\n    0 0 1px black;\n}")).toEqual(["6:black"]);
  });
});

describe("hard-coded colours in TypeScript", () => {
  it("finds a hex colour or colour function in a string", () => {
    const ts = 'const a = "#3584e4";\nconst b = `0 0 4px rgba(0, 0, 0, 0.5)`;\nel.style.background = "hsl(0 0% 0%)";';
    expect(found("x.ts", ts)).toEqual(["1:#3584e4", "2:rgba(", "3:hsl("]);
  });

  it("finds a named colour given to a colour property or attribute", () => {
    const tsx = [
      "const s = { color: 'red', backgroundColor: \"Black\" };",
      "ctx.fillStyle = 'white';",
      '<circle fill="navy" stroke="currentColor" />',
      "el.style.setProperty('--k', 'teal');",
    ].join("\n");
    expect(found("x.tsx", tsx)).toEqual(["1:red", "1:Black", "2:white", "3:navy", "4:teal"]);
  });

  it("finds a colour inside an inline style string", () => {
    expect(found("x.tsx", '<div style="padding: 2px; color: orange" />')).toEqual(["1:orange"]);
  });

  it("leaves ids, words, comments and token references alone", () => {
    const ts = [
      "// colour was #fff, rgb(0,0,0)",
      "/* fill: red */",
      'document.querySelector("#s1b1");',
      'const kind = "red";',
      'const label = "Mark as done";',
      'const url = "https://example.com/#fed";',
      "const re = /[\"'#]rgb\\(/g;",
      'const s = { color: "var(--accent)", fill: "none", stroke: "currentColor" };',
      'const t = "white-space";',
    ].join("\n");
    expect(found("x.ts", ts)).toEqual([]);
  });

  it("keeps line numbers after a template literal that spans lines", () => {
    expect(found("x.ts", "const a = `one\ntwo`;\nconst b = '#abcdef';")).toEqual(["3:#abcdef"]);
  });

  it("reads strings with escaped quotes, and a lone quote in a regular expression ends nothing", () => {
    expect(found("x.ts", 'const a = "say \\"hi\\" #abc";')).toEqual(["1:#abc"]);
    expect(found("x.ts", "const b = 'it\\'s #def';")).toEqual(["1:#def"]);
    expect(found("x.ts", 'const re = /"/;\nconst c = "#fff";')).toEqual(["2:#fff"]);
    expect(found("x.ts", "const re = /'/;\nconst c = '#fff';")).toEqual(["2:#fff"]);
    expect(found("x.ts", "const t = `a \\` b`;\nconst c = `#fff`;")).toEqual(["2:#fff"]);
  });

  it("finds a named colour under a quoted key or after an unrelated string, not handed to something else", () => {
    expect(found("x.ts", 'const s = { "color": "red" };')).toEqual(["1:red"]);
    expect(found("x.ts", 'const s = { color: " red " };')).toEqual(["1:red"]);
    expect(found("x.ts", 'const s = { color: c, label: "red" };')).toEqual([]);
    expect(found("x.ts", 'el.setAttribute("title", "red");')).toEqual([]);
  });

  it("checks only the colour declarations of an inline style", () => {
    const tsx = [
      '<p style="text-decoration-color: red" />',
      '<p style="--k: teal" />',
      '<p style="a--b: red; padding: tan" />',
      '<p style="color :navy" />',
    ].join("\n");
    expect(found("x.tsx", tsx)).toEqual(["1:red", "2:teal", "4:navy"]);
  });
});

describe("the colour words and hex forms", () => {
  it("knows every group of CSS named and system colours", () => {
    const names = [
      "aliceblue",
      "burlywood",
      "darkgoldenrod",
      "darksalmon",
      "deepskyblue",
      "goldenrod",
      "lawngreen",
      "lightpink",
      "lime",
      "mediumslateblue",
      "navajowhite",
      "palevioletred",
      "saddlebrown",
      "springgreen",
      "yellowgreen",
      "accentcolor",
      "graytext",
      "visitedtext",
    ];
    const css = `.a {\n${names.map((n) => `  color: ${n};`).join("\n")}\n}`;
    expect(found("x.css", css)).toEqual(names.map((n, i) => `${i + 2}:${n}`));
  });

  it("takes hex colours of 3, 4, 6 or 8 digits that stand alone", () => {
    const css = [
      ".a {",
      "  background: linear-gradient(#fff, #000 50%);",
      "  --x: #12345 #1234567 #abcg url(a#fff) x-#fff;",
      "  color: red-ish x-red 1red redx;",
      "  color: myrgb(1) x-hsl(2) rgb (3);",
      "  color: black",
      "}",
    ].join("\n");
    expect(found("x.css", css)).toEqual(["2:#fff", "2:#000", "6:black"]);
  });

  it("lists colours in file order within one declaration", () => {
    expect(found("x.css", ".a { box-shadow: 0 0 1px black, 0 0 2px #fff, 0 0 3px rgb(0 0 0); }")).toEqual([
      "1:black",
      "1:#fff",
      "1:rgb(",
    ]);
  });
});

describe("which files the check covers", () => {
  it("covers component CSS and code, not tests, the token file or generated bindings", () => {
    expect(isLinted("features/gloss/Gloss.css")).toBe(true);
    expect(isLinted("features/gloss/card.ts")).toBe(true);
    expect(isLinted("App.tsx")).toBe(true);
    expect(isLinted("theme/tokens.css")).toBe(false);
    expect(isLinted("core/bindings.ts")).toBe(false);
    expect(isLinted("App.test.tsx")).toBe(false);
    expect(isLinted("keys/dispatch.test.ts")).toBe(false);
    expect(isLinted("features/buffer/__tests__/timeline.ts")).toBe(false);
    expect(isLinted("features/figures/fig.svg")).toBe(false);
    expect(isLinted("features/figures/fig.css.map")).toBe(false);
    expect(isLinted("features/figures/fig.ts.snap")).toBe(false);
    expect(isLinted("features/a.test.tsx.ts")).toBe(true);
    expect(isLinted("theme/tokens.css.ts")).toBe(true);
  });
});

describe("ui/src", () => {
  it("has no hard-coded colours outside the theme tokens", () => {
    const files = filesUnder(uiSrc()).filter(([path]) => isLinted(path));
    expect(files.length).toBeGreaterThan(50);
    const all = files.flatMap(([path, text]) =>
      hardCodedColours(path, text).map((f) => `${path}:${f.line} ${f.colour}`),
    );
    expect(all).toEqual([]);
  });
});
