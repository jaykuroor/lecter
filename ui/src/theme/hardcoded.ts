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

const HEX = /(?<![\w&/-])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
const FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi;
const WORD = /(?<![\w-])[a-z]+(?![\w(-])/gi;
// `prop: value` up to `;`, `}` or the end; a selector's `a:hover {` never reaches one.
const DECLARATION = /([-\w]+)\s*:([^;{}]*)(?=[;}]|$)/g;
// A CSS property or object key that takes a colour.
const COLOUR_KEY = /^(?:--[-\w]+|[-\w]*(?:colou?r|background|fill|stroke|border|outline|shadow|caret|accent)[-\w]*)$/i;
// Code right before a string literal that hands it to a colour.
const COLOUR_CONTEXT =
  /(?:(?:colou?r|background|fill|stroke|border|outline|shadow|caret|accent)[-\w]*["'`]?\s*[:=]|setProperty\([^)]*,)\s*$/i;

/** Whether the lint covers this ui/src-relative path: component CSS and code, not tests or generated files. */
export function isLinted(path: string): boolean {
  if (!/\.(css|ts|tsx)$/.test(path) || /\.test\.tsx?$/.test(path) || /(^|\/)__tests__\//.test(path)) return false;
  return path !== "theme/tokens.css" && path !== "core/bindings.ts";
}

/** Every hard-coded colour in a ui/src file. */
export function hardCodedColours(path: string, text: string): Finding[] {
  const out: { at: number; colour: string }[] = [];
  if (path.endsWith(".css")) cssColours(blankCss(text), 0, out);
  else for (const lit of literals(text)) literalColours(text, lit, out);
  out.sort((a, b) => a.at - b.at);
  return out.map(({ at, colour }) => ({ line: lineAt(text, at), colour }));
}

function lineAt(text: string, at: number): number {
  let line = 1;
  for (let i = 0; i < at; i++) if (text[i] === "\n") line++;
  return line;
}

/** Spaces over comments and quoted strings, so offsets and lines stay put. */
function blankCss(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Colours in the values of the declarations of `css` (which starts at `offset` in the file). */
function cssColours(css: string, offset: number, out: { at: number; colour: string }[], keys?: RegExp): void {
  for (const d of css.matchAll(DECLARATION)) {
    if (keys && !keys.test(d[1] as string)) continue;
    const value = d[2] as string;
    const start = offset + (d.index as number) + d[0].length - value.length;
    for (const m of value.matchAll(HEX)) out.push({ at: start + (m.index as number), colour: m[0] });
    for (const m of value.matchAll(FUNCTION)) out.push({ at: start + (m.index as number), colour: m[0] });
    for (const m of value.matchAll(WORD)) {
      if (NAMED.has(m[0].toLowerCase())) out.push({ at: start + (m.index as number), colour: m[0] });
    }
  }
}

interface Literal {
  /** Offset of the first character inside the quotes. */
  at: number;
  body: string;
}

function literalColours(text: string, lit: Literal, out: { at: number; colour: string }[]): void {
  for (const m of lit.body.matchAll(FUNCTION)) out.push({ at: lit.at + (m.index as number), colour: m[0] });
  const before = out.length;
  // An inline style string: its colour declarations, as in CSS.
  cssColours(lit.body, lit.at, out, COLOUR_KEY);
  if (out.length > before) return;
  for (const m of lit.body.matchAll(HEX)) out.push({ at: lit.at + (m.index as number), colour: m[0] });
  const word = lit.body.trim();
  const lineStart = text.lastIndexOf("\n", lit.at - 1) + 1;
  if (NAMED.has(word.toLowerCase()) && COLOUR_CONTEXT.test(text.slice(lineStart, lit.at - 1))) {
    out.push({ at: lit.at + lit.body.indexOf(word), colour: word });
  }
}

// After one of these (or at the start), a `/` starts a regular expression, not a division.
const BEFORE_REGEX = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

/** The string and template literals of TypeScript source, skipping comments and regular expressions. */
function literals(src: string): Literal[] {
  const out: Literal[] = [];
  let last = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      i = src.indexOf("\n", i);
      if (i < 0) break;
    } else if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
    } else if (c === "/" && BEFORE_REGEX.has(last)) {
      i = skipRegex(src, i + 1);
      last = "/";
    } else if (c === '"' || c === "'" || c === "`") {
      i = readLiteral(src, i, out);
      last = c;
    } else {
      if (!/\s/.test(c)) last = /[\w$)\]]/.test(c) ? "a" : c;
      if (/[\w$]/.test(c) && /^(?:return|typeof|case|in|of)$/.test(wordEndingAt(src, i))) last = "";
      i++;
    }
  }
  return out;
}

function wordEndingAt(src: string, i: number): string {
  if (/[\w$]/.test(src[i + 1] ?? "")) return "";
  let s = i;
  while (s > 0 && /[\w$]/.test(src[s - 1] as string)) s--;
  return src.slice(s, i + 1);
}

function skipRegex(src: string, i: number): number {
  let inClass = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if ((c === "/" && !inClass) || c === "\n") return i + 1;
  }
  return i;
}

/** Reads the literal opening at `start`; pushes its text (a template's `${…}` parts left out). Returns the offset after it. */
function readLiteral(src: string, start: number, out: Literal[]): number {
  const quote = src[start];
  let i = start + 1;
  let from = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === quote) break;
    else if (quote === "`" && c === "$" && src[i + 1] === "{") {
      out.push({ at: from, body: src.slice(from, i) });
      let depth = 0;
      for (i += 1; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}" && --depth === 0) break;
      }
      from = i + 1;
    } else if (c === "\n" && quote !== "`") break;
  }
  out.push({ at: from, body: src.slice(from, i) });
  return i + 1;
}
