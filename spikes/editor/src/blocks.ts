// Block-level decorations (they change vertical layout, so CodeMirror needs them from a StateField):
// slide headers, gloss cards with a meta bar widget, own notes, display math. After an edit the set
// is mapped through the change and only the changed lines are rescanned (the whole slide when a
// `:::` fence line was touched). KaTeX arriving (`mathLoaded`) rebuilds everything once.
import { type EditorState, type Range, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { MathWidget, mathLoaded } from "./math";

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
type Inside = "gloss" | "note" | null;

function scan(doc: Text, fromLine: number, toLine: number, start: Inside = null): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  let inside: Inside = start;
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

/** Whether line `lineNo` is inside a gloss or note div: walk back to the nearest fence line. */
function insideAt(doc: Text, lineNo: number): Inside {
  for (let n = lineNo - 1; n >= 1; n--) {
    const t = doc.line(n).text;
    if (!t.startsWith(":::")) continue;
    if (GLOSS_RE.test(t)) return "gloss";
    if (NOTE_RE.test(t)) return "note";
    return null; // a closing fence or a slide opener
  }
  return null;
}

const hasFence = (text: string) => text.startsWith(":::") || text.includes("\n:::");

function build(state: EditorState): DecorationSet {
  return Decoration.set(scan(state.doc, 1, state.doc.lines), true);
}

export const blockField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (tr.effects.some((e) => e.is(mathLoaded))) return build(tr.state);
    if (!tr.docChanged) return deco;
    const doc = tr.state.doc;
    const before = tr.startState.doc;
    let next = deco.map(tr.changes);
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      const la = doc.lineAt(fromB);
      const lb = doc.lineAt(toB);
      // Only the changed lines, unless a fence line (`:::`) was touched before or after the edit:
      // then the gloss/note structure may have changed, so rescan the whole slide.
      const oldText = before.sliceString(before.lineAt(fromA).from, before.lineAt(toA).to);
      const newText = doc.sliceString(la.from, lb.to);
      let a = la.number;
      let b = lb.number;
      let start = insideAt(doc, a);
      if (hasFence(oldText) || hasFence(newText)) {
        a = slideStart(doc, a);
        b = slideEnd(doc, b);
        start = null;
      }
      next = next.update({
        filterFrom: doc.line(a).from,
        filterTo: doc.line(b).to,
        filter: () => false,
        add: scan(doc, a, b, start),
        sort: true,
      });
    });
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
