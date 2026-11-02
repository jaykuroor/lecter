// The lecture file's line structure (03-lecture-files.md), read line by line so the buffer can
// decorate and move without a full parse on the key path. The buffer's text is the file itself:
// front matter, `::: {.slide …}` divs with a `## title` line, and one `[text]{#s3b1}` span per
// slide block. Everything here is pure and works on a CodeMirror `Text`.
import type { Text } from "@codemirror/state";

/**
 * What a line is in the buffer:
 * - `front-matter`, `slide` (a slide's opening fence), `title` (its `## ` line), `fence` (any
 *   other `:::` line): structure, hidden from view;
 * - `block`: a slide block, shown as a block;
 * - `text`: any other text (glosses' and notes' bodies, the user's own lines), shown as is;
 * - `blank`: an empty line, shown as a small gap.
 */
export type LineKind = "front-matter" | "slide" | "title" | "fence" | "block" | "text" | "blank";

/** Lines j/k and gg/G move between: the ones that show text. */
export const isElement = (kind: LineKind): boolean => kind === "block" || kind === "text";

/** Lines that take no room on screen. */
export const isHidden = (kind: LineKind): boolean => !isElement(kind) && kind !== "blank";

/** Pandoc attributes `{#id .class key=value key="value"}`, as written in a lecture file. */
export interface Attrs {
  id: string;
  classes: string[];
  values: Record<string, string>;
}

const ATTR = /#([^\s}]+)|\.([^\s}=]+)|([\w-]+)=(?:"([^"]*)"|([^\s}]*))/g;

/** Parses the inside of a `{…}` attribute list. Unknown tokens are ignored. */
export function parseAttrs(inner: string): Attrs {
  const attrs: Attrs = { id: "", classes: [], values: {} };
  for (const m of inner.matchAll(ATTR)) {
    if (m[1] !== undefined) attrs.id = m[1];
    else if (m[2] !== undefined) attrs.classes.push(m[2]);
    // Otherwise the third alternative matched: a key, and a quoted or a bare value.
    else attrs.values[`${m[3]}`] = `${m[4] ?? m[5]}`;
  }
  return attrs;
}

/** A slide's opening fence: `::: {.slide #s3 n=3 src="A3" title="Properties"}`. */
export interface SlideFence {
  id: string;
  /** The slide number (`n=`); 0 when missing or not a number. */
  n: number;
  title: string;
  src: string;
  flagged: boolean;
}

const SLIDE = /^:::+\s*\{([^}]*)\}\s*$/;

/** The slide fence on this line, or `null` if the line isn't one. */
export function slideFence(text: string): SlideFence | null {
  const m = SLIDE.exec(text);
  if (!m?.[1]) return null;
  const attrs = parseAttrs(m[1]);
  if (!attrs.classes.includes("slide")) return null;
  const n = Number(attrs.values.n);
  return {
    id: attrs.id,
    n: Number.isInteger(n) && n >= 1 ? n : 0,
    title: attrs.values.title ?? "",
    src: attrs.values.src ?? "",
    flagged: attrs.classes.includes("flag"),
  };
}

/** A slide block's span, `[text]{#s3b1 .flag}`, with its text's offsets in the line. */
export interface BlockSpan {
  id: string;
  flagged: boolean;
  /** Offset in the line where the text starts (after `[`). */
  from: number;
  /** Offset in the line where the text ends (before `]{`). */
  to: number;
}

const BLOCK = /^\[(.*)\]\{(#s\d+b\d+(?:\s[^}]*)?)\}\s*$/;

/** The block span on this line, or `null` if the line isn't one. */
export function blockSpan(text: string): BlockSpan | null {
  const m = BLOCK.exec(text);
  if (!m) return null;
  const attrs = parseAttrs(`${m[2]}`);
  return { id: attrs.id, flagged: attrs.classes.includes("flag"), from: 1, to: 1 + `${m[1]}`.length };
}

/** The most lines front matter may take; a `---` line with no end in reach isn't front matter. */
const FRONT_MATTER_MAX_LINES = 1000;

/** The number of the line that closes the front matter, or 0 when the file has none. */
export function frontMatterEnd(doc: Text): number {
  if (doc.line(1).text !== "---") return 0;
  const last = Math.min(doc.lines, FRONT_MATTER_MAX_LINES);
  for (let n = 2; n <= last; n++) {
    const t = doc.line(n).text;
    if (t === "---" || t === "...") return n;
  }
  return 0;
}

/** The `slides:` list of the front matter (paths relative to the course), in order. */
export function frontMatterSlides(doc: Text, end: number): string[] {
  const out: string[] = [];
  let inList = false;
  if (end === 0) return out;
  // Lines 2 up to (not including) the closing line `end`.
  for (const t of doc.iterLines(2, end)) {
    if (/^slides:\s*$/.test(t)) {
      inList = true;
      continue;
    }
    const item = /^\s*-\s+(.+?)\s*$/.exec(t);
    if (inList && item?.[1]) out.push(item[1].replace(/^"(.*)"$/, "$1"));
    else if (inList && !/^\s/.test(t)) inList = false;
  }
  return out;
}

/** What line `n` is, given the front matter's last line `fmEnd` (from `frontMatterEnd`). */
export function lineKind(doc: Text, n: number, fmEnd: number): LineKind {
  if (n <= fmEnd) return "front-matter";
  const text = doc.line(n).text;
  if (text.startsWith(":::")) return slideFence(text) ? "slide" : "fence";
  if (text.startsWith("## ") && n > 1 && slideFence(doc.line(n - 1).text)) return "title";
  if (blockSpan(text)) return "block";
  return text.trim() === "" ? "blank" : "text";
}

/** Where the visible text of an element line starts and ends, as document offsets. */
export function visibleRange(doc: Text, n: number): { from: number; to: number } {
  const line = doc.line(n);
  const span = blockSpan(line.text);
  if (span) return { from: line.from + span.from, to: line.from + span.to };
  return { from: line.from, to: line.to };
}

/**
 * The source line of a slide heading: the slide file `src` names (`A3` = first file in the front
 * matter, slide 3) and the slide number, or `src` as written when it names no listed file.
 */
export function sourceLabel(src: string, slides: string[]): string {
  const m = /^([A-Z])(\d+)$/.exec(src);
  const file = m?.[1] ? slides[m[1].charCodeAt(0) - 65] : undefined;
  if (!m || file === undefined) return src;
  return `${file.slice(file.lastIndexOf("/") + 1)} · slide ${m[2]}`;
}
