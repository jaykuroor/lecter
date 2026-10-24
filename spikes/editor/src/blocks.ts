// Block-level decorations (they change vertical layout, so CodeMirror needs them from a StateField):
// slide headers, gloss cards with a meta bar widget, own notes, display math. After an edit only the
// slides touched by the change are rescanned; the rest of the set is mapped through the change.
import { type EditorState, type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { MathWidget } from "./math";

class SlideHeader extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(o: SlideHeader): boolean {
    return o.label === this.label;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-slide-header";
    el.textContent = this.label;
    return el;
  }
}

class GlossBar extends WidgetType {
  constructor(
    readonly id: string,
    readonly kind: string,
    readonly vote: string,
  ) {
    super();
  }
  eq(o: GlossBar): boolean {
    return o.id === this.id && o.kind === this.kind && o.vote === this.vote;
  }
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-gloss-bar";
    const kind = document.createElement("span");
    kind.className = "cm-gloss-kind";
    kind.textContent = this.kind;
    const vote = document.createElement("button");
    vote.className = "cm-gloss-vote";
    vote.textContent = `▲ ${this.vote}`;
    const id = document.createElement("span");
    id.className = "cm-gloss-id";
    id.textContent = this.id;
    el.append(kind, vote, id);
    return el;
  }
}

const SLIDE_RE = /^::: \{\.slide #(s\d+) n=(\d+)[^}]*title="([^"]*)"/;
const GLOSS_RE = /^::: \{\.gloss #([\w-]+) kind=(\w+)[^}]*?(?:vote=([+-]?\d+))?[^}]*\}/;
const NOTE_RE = /^::: \{\.note /;
const DISPLAY_RE = /^\$\$(.+)\$\$$/;

/** Decorations for whole lines from `fromLine` to `toLine` (1-based, inclusive). */
function scan(doc: Text, fromLine: number, toLine: number): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  let inside: "gloss" | "note" | null = null;
  for (let n = fromLine; n <= toLine; n++) {
    const line = doc.line(n);
    const t = line.text;
    let m: RegExpExecArray | null;
    if ((m = SLIDE_RE.exec(t))) {
      out.push(Decoration.widget({ widget: new SlideHeader(`Slide ${m[2]} · ${m[3]}`), block: true, side: -1 }).range(line.from));
      out.push(Decoration.line({ class: "cm-slide-open" }).range(line.from));
    } else if ((m = GLOSS_RE.exec(t))) {
      inside = "gloss";
      out.push(Decoration.widget({ widget: new GlossBar(m[1], m[2], m[3] ?? "0"), block: true, side: -1 }).range(line.from));
      out.push(Decoration.line({ class: "cm-gloss-open" }).range(line.from));
    } else if (NOTE_RE.test(t)) {
      inside = "note";
      out.push(Decoration.line({ class: "cm-note-open" }).range(line.from));
    } else if (t === ":::" && inside) {
      out.push(Decoration.line({ class: `cm-${inside}-close` }).range(line.from));
      inside = null;
    } else if ((m = DISPLAY_RE.exec(t))) {
      out.push(Decoration.replace({ widget: new MathWidget(m[1], true), block: true }).range(line.from, line.to));
    } else if (inside) {
      out.push(Decoration.line({ class: `cm-${inside}-body` }).range(line.from));
    }
  }
  return out;
}

function slideStart(doc: Text, lineNo: number): number {
  for (let n = lineNo; n > 1; n--) if (doc.line(n).text.startsWith("::: {.slide ")) return n;
  return 1;
}

function slideEnd(doc: Text, lineNo: number): number {
  for (let n = lineNo + 1; n <= doc.lines; n++) if (doc.line(n).text.startsWith("::: {.slide ")) return n - 1;
  return doc.lines;
}

function build(state: EditorState): DecorationSet {
  return Decoration.set(scan(state.doc, 1, state.doc.lines), true);
}

export const blockField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (!tr.docChanged) return deco;
    const doc = tr.state.doc;
    let next = deco.map(tr.changes);
    tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
      const a = slideStart(doc, doc.lineAt(fromB).number);
      const b = slideEnd(doc, doc.lineAt(toB).number);
      const from = doc.line(a).from;
      const to = doc.line(b).to;
      next = next.update({
        filterFrom: from,
        filterTo: to,
        filter: () => false,
        add: scan(doc, a, b),
        sort: true,
      });
    });
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
