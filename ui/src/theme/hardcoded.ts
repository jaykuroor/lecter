// The hard-coded-colour lint (F-042; 12-settings-theme-onboarding.md#theme: "All UI colours are
// CSS custom properties; no hard-coded colours in components"). hardcoded.test.ts runs it over
// ui/src in the ui-tests stage. Colours live only in src/theme/tokens.css, generated from
// docs/design/tokens.json; components use the tokens through var() and color-mix() over tokens.
//
// CSS: every declaration's value (selectors, comments and quoted strings are skipped) is checked
// for hex colours, colour functions and named or system colours. TypeScript: string literals are
// checked for hex colours and colour functions, and for a named colour where the code hands the
// string to a colour (a `color:`/`fill=` key, `fillStyle =`, `setProperty(…, …)`, or a
// declaration inside an inline style string).

/** One hard-coded colour: its 1-based line and the colour as written (a function as `rgb(`). */
export interface Finding {
  line: number;
  colour: string;
}

// CSS Color 4 named colours and system colours (lower case).
const NAMED = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " +
    "darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink " +
    "deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold " +
    "goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush " +
    "lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey " +
    "lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow " +
    "lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin " +
    "navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
    "palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue " +
    "saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow " +
    "springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen " +
    "accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext " +
    "graytext highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext"
  ).split(" "),
);

const HEX = /(?<![\w/-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const WORD = /(?<![\w-])[a-z]+(?![\w(-])/gi;
// `prop: value` up to `;`, `}` or the end; a selector's `a:hover {` never reaches one.
const DECLARATION = /([-\w]+)\s*:([^;{}]*)(?=[;}]|$)/g;
// A CSS property or object key that takes a colour (a custom property may hold one).
const COLOUR_KEY = /^(?:--|[-\w]*(?:colou?r|background|fill|stroke|border|outline|shadow|caret|accent))/i;
// Code right before a string literal that hands it to a colour.
const COLOUR_CONTEXT =
  /(?:(?:colou?r|background|fill|stroke|border|outline|shadow|caret|accent)[-\w]*\W?\s*[:=]|setProperty\([^)]*,)\s*$/i;
// In CSS: a comment or a quoted string, blanked before the scan.
const CSS_SKIP = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
// In TypeScript: a one-line string, a template literal (group 1, 2 or 3: the text inside) or a
// comment (no group). Left to right, so a `//` inside a string stays in it; a quote inside a
// regular expression finds no closing one on its line and is passed over.
const TS_LITERAL =
  /"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|\x60((?:\\.|[^\x60\\])*)\x60|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Whether the lint covers this ui/src-relative path: component CSS and code, not tests or generated files. */
export function isLinted(path: string): boolean {
  if (!/\.(css|tsx?)$/.test(path) || /\.test\.tsx?$/.test(path) || path.includes("__tests__/")) return false;
  return path !== "theme/tokens.css" && path !== "core/bindings.ts";
}

/** Colours found so far, by offset in the file (one per offset). */
type Found = Map<number, string>;

/** Every hard-coded colour in a ui/src file, in file order. */
export function hardCodedColours(path: string, text: string): Finding[] {
  const found: Found = new Map();
  if (path.endsWith(".css")) {
    cssColours(
      text.replace(CSS_SKIP, (m) => m.replace(/[^\n]/g, " ")),
      0,
      found,
    );
  } else {
    for (const m of text.matchAll(TS_LITERAL)) {
      const body = m[1] ?? m[2] ?? m[3];
      if (body !== undefined) literalColours(text, (m.index as number) + 1, body, found);
    }
  }
  return [...found]
    .sort((a, b) => a[0] - b[0])
    .map(([at, colour]) => ({ line: text.slice(0, at).split("\n").length, colour }));
}

/** Hex colours, colour functions and (with `named`) named colours in `value`, which starts at `at`. */
function valueColours(value: string, at: number, found: Found, named: boolean): void {
  for (const re of [HEX, FUNCTION]) for (const m of value.matchAll(re)) found.set(at + (m.index as number), m[0]);
  if (!named) return;
  for (const m of value.matchAll(WORD)) {
    if (NAMED.has(m[0].toLowerCase())) found.set(at + (m.index as number), m[0]);
  }
}

/** Colours in the values of `css`'s declarations (`keys` picks which); `css` starts at `at`. */
function cssColours(css: string, at: number, found: Found, keys?: RegExp): void {
  for (const d of css.matchAll(DECLARATION)) {
    if (keys?.test(d[1] as string) === false) continue;
    const value = d[2] as string;
    valueColours(value, at + (d.index as number) + d[0].length - value.length, found, true);
  }
}

/** Colours in a TypeScript string literal whose text `body` starts at `at`. */
function literalColours(text: string, at: number, body: string, found: Found): void {
  valueColours(body, at, found, false);
  // An inline style string: its colour declarations, as in CSS.
  cssColours(body, at, found, COLOUR_KEY);
  // A named colour on its own, handed to a colour.
  const word = body.trim();
  const before = text.slice(text.lastIndexOf("\n", at) + 1, at - 1);
  if (NAMED.has(word.toLowerCase()) && COLOUR_CONTEXT.test(before)) found.set(at + body.indexOf(word), word);
}
