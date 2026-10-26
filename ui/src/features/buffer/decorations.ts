// How the lecture file looks in the buffer (docs/design/components.md#slide-heading, #block):
// front matter and `:::` fences are hidden, each slide's opening fence and `## title` line become
// a slide heading, each `[text]{#id}` span shows as a block with its brackets and attributes
// hidden, and blank lines are small gaps. These decorations change the vertical layout, so they
// come from a StateField. After an edit that touches only text lines, just those lines are
// rescanned; an edit that touches structure (front matter, fences, titles) rebuilds the set,
// since slide numbers ("SLIDE n / N") and sources may change.
import { type EditorState, type Range, StateField, type Text, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  blockSpan,
  frontMatterEnd,
  frontMatterSlides,
  isHidden,
  type LineKind,
  lineKind,
  slideFence,
  sourceLabel,
} from "./syntax";

/** What a slide heading shows. */
export interface Heading {
  n: number;
  total: number;
  title: string;
  source: string;
  flagged: boolean;
}

/** A slide heading: gutter label `SLIDE n / N` (⚑ when flagged), title and source line. */
export class SlideHeading extends WidgetType {
  constructor(readonly heading: Heading) {
    super();
  }

  override eq(other: SlideHeading): boolean {
    const a = this.heading;
    const b = other.heading;
    return (
      a.n === b.n && a.total === b.total && a.title === b.title && a.source === b.source && a.flagged === b.flagged
    );
  }

  toDOM(): HTMLElement {
    const h = this.heading;
    const el = document.createElement("div");
    el.className = h.flagged ? "slide-heading slide-heading-flagged" : "slide-heading";
    const label = document.createElement("div");
    label.className = "slide-heading-label";
    label.textContent = `${h.flagged ? "⚑ " : ""}Slide ${h.n} / ${h.total}`;
    const main = document.createElement("div");
    main.className = "slide-heading-main";
    const title = document.createElement("div");
    title.className = "slide-heading-title";
    title.textContent = h.title;
    main.append(title);
    if (h.source) {
      const source = document.createElement("div");
      source.className = "slide-heading-source";
      source.textContent = h.source;
      main.append(source);
    }
    el.append(label, main);
    return el;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

const hidden = Decoration.replace({ block: true });
const inlineHidden = Decoration.replace({});
const gap = Decoration.line({ class: "cm-gap" });
const textLine = Decoration.line({ class: "cm-text" });
const block = Decoration.line({ class: "cm-block" });
const flaggedBlock = Decoration.line({ class: "cm-block cm-block-flagged" });

/** The decorations of one element or blank line (`text` and `blank` and `block` kinds). */
function lineDecorations(doc: Text, n: number, kind: LineKind, out: Range<Decoration>[]): void {
  const line = doc.line(n);
  const span = blockSpan(line.text);
  if (kind === "blank") out.push(gap.range(line.from));
  else if (!span) out.push(textLine.range(line.from));
  else {
    out.push((span.flagged ? flaggedBlock : block).range(line.from));
    out.push(inlineHidden.range(line.from, line.from + span.from));
    out.push(inlineHidden.range(line.from + span.to, line.to));
  }
}

/** Every decoration of the buffer. */
export function buildDecorations(doc: Text): DecorationSet {
  const fm = frontMatterEnd(doc);
  const slides = frontMatterSlides(doc, fm);
  let total = 0;
  for (let n = 1; n <= doc.lines; n++) if (lineKind(doc, n, fm) === "slide") total++;
  const out: Range<Decoration>[] = [];
  if (fm > 0) out.push(hidden.range(0, doc.line(fm).to));
  let slide = 0;
  for (let n = fm + 1; n <= doc.lines; n++) {
    // After the front matter, a line is a slide fence exactly when `slideFence` reads one.
    const fence = slideFence(doc.line(n).text);
    const kind = lineKind(doc, n, fm);
    if (fence) {
      slide++;
      const next = n < doc.lines ? doc.line(n + 1) : null;
      const titled = next !== null && lineKind(doc, n + 1, fm) === "title";
      const title = fence.title || (titled && next ? next.text.slice(3).trim() : "");
      const heading: Heading = {
        n: fence.n || slide,
        total,
        title,
        source: sourceLabel(fence.src, slides),
        flagged: fence.flagged,
      };
      const end = titled && next ? next.to : doc.line(n).to;
      out.push(Decoration.replace({ widget: new SlideHeading(heading), block: true }).range(doc.line(n).from, end));
      if (titled) n++;
    } else if (isHidden(kind)) {
      const line = doc.line(n);
      out.push(hidden.range(line.from, line.to));
    } else {
      lineDecorations(doc, n, kind, out);
    }
  }
  // Pushed in document order (a line's line decoration before its inline ones), so no sort.
  return Decoration.set(out);
}

/** Whether lines `from`–`to` of `doc` hold any structure (front matter, a fence or a title). */
function touchesStructure(doc: Text, from: number, to: number): boolean {
  const fm = frontMatterEnd(doc);
  // A title's role depends on the fence above it, and a fence is structure itself, so the
  // changed lines alone tell whether any line's role changed.
  for (let n = from; n <= to; n++) if (isHidden(lineKind(doc, n, fm))) return true;
  return false;
}

/** The decorations after `tr`: mapped, with the changed lines rescanned or, for structure, rebuilt. */
function update(deco: DecorationSet, tr: Transaction): DecorationSet {
  // Without changes nothing below runs: there are no changed ranges, and mapping returns `deco`.
  const before = tr.startState.doc;
  const doc = tr.state.doc;
  let structural = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    structural ||=
      touchesStructure(before, before.lineAt(fromA).number, before.lineAt(toA).number) ||
      touchesStructure(doc, doc.lineAt(fromB).number, doc.lineAt(toB).number);
  });
  if (structural) return buildDecorations(doc);
  let next = deco.map(tr.changes);
  tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const fm = frontMatterEnd(doc);
    const first = doc.lineAt(fromB);
    const last = doc.lineAt(toB);
    const add: Range<Decoration>[] = [];
    for (let n = first.number; n <= last.number; n++) lineDecorations(doc, n, lineKind(doc, n, fm), add);
    next = next.update({ filterFrom: first.from, filterTo: last.to, filter: () => false, add });
  });
  return next;
}

/** The lecture's decorations. */
export const lectureDecorations = StateField.define<DecorationSet>({
  create: (state: EditorState) => buildDecorations(state.doc),
  update,
  provide: (field) => EditorView.decorations.from(field),
});
