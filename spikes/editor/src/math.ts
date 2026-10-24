// KaTeX rendering for the spike: inline `$…$` through a ViewPlugin, display `$$…$$` lines as block
// widgets (see blocks.ts).
//
// KaTeX is a separate chunk, loaded after the first paint (`loadKatex`). Until it arrives, math shows
// as its source; then `mathLoaded` makes both decoration sources rebuild once with rendered widgets.
//
// The inline plugin rebuilds all visible ranges only when the viewport changes or KaTeX arrives. On
// an edit or a cursor move it maps its set and rescans only the touched lines (the changed lines and
// the lines the old and new cursor are on, where math switches between source and widget).
import { type EditorState, type Range, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

type Katex = typeof import("katex").default;
let katex: Katex | null = null;
export const mathLoaded = StateEffect.define<null>();

/** Load KaTeX in the background, then tell the view to re-render math. */
export function loadKatex(view: EditorView): void {
  void import("katex").then((m) => {
    katex = m.default;
    view.dispatch({ effects: mathLoaded.of(null) });
  });
}

const cache = new Map<string, string>();

export function renderTex(tex: string, display: boolean): string | null {
  if (!katex) return null;
  const key = (display ? "D" : "I") + tex;
  let html = cache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, {
      displayMode: display,
      output: "mathml",
      trust: false,
      throwOnError: false,
      maxSize: 50,
      maxExpand: 200,
    });
    cache.set(key, html);
  }
  return html;
}

export class MathWidget extends WidgetType {
  readonly rendered = katex !== null;
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display && other.rendered === this.rendered;
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-math-display" : "cm-math-inline";
    const html = renderTex(this.tex, this.display);
    if (html === null) el.textContent = this.tex;
    else el.innerHTML = html;
    return el;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

// `$…$` not preceded or followed by another `$` (so `$$…$$` is left to the block field).
const INLINE_RE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;

function cursorTouches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.to >= from && r.from <= to) return true;
  return false;
}

function scanRange(state: EditorState, from: number, to: number, out: Range<Decoration>[]): void {
  const text = state.doc.sliceString(from, to);
  INLINE_RE.lastIndex = 0;
  for (let m = INLINE_RE.exec(text); m; m = INLINE_RE.exec(text)) {
    const start = from + m.index;
    const end = start + m[0].length;
    if (cursorTouches(state, start, end)) continue;
    out.push(Decoration.replace({ widget: new MathWidget(m[1], false) }).range(start, end));
  }
}

function fullBuild(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    const a = view.state.doc.lineAt(from).from;
    const b = view.state.doc.lineAt(to).to;
    scanRange(view.state, a, b, out);
  }
  return Decoration.set(out, true);
}

/** Lines (as [from, to] in the new doc) an update can change inline math on. */
function touchedLines(u: ViewUpdate): [number, number][] {
  const doc = u.state.doc;
  const spans: [number, number][] = [];
  const add = (pos: number) => {
    const l = doc.lineAt(Math.min(pos, doc.length));
    spans.push([l.from, l.to]);
  };
  u.changes.iterChangedRanges((_fa, _ta, fromB, toB) => {
    spans.push([doc.lineAt(fromB).from, doc.lineAt(toB).to]);
  });
  for (const r of u.startState.selection.ranges) add(u.changes.mapPos(r.head));
  for (const r of u.state.selection.ranges) add(r.head);
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  return merged;
}

export const inlineMath = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = fullBuild(view);
    }
    update(u: ViewUpdate) {
      const loaded = u.transactions.some((t) => t.effects.some((e) => e.is(mathLoaded)));
      if (loaded || u.viewportChanged) {
        this.decorations = fullBuild(u.view);
        return;
      }
      if (!u.docChanged && !u.selectionSet) return;
      let deco = this.decorations.map(u.changes);
      for (const [from, to] of touchedLines(u)) {
        const add: Range<Decoration>[] = [];
        scanRange(u.state, from, to, add);
        deco = deco.update({ filterFrom: from, filterTo: to, filter: () => false, add, sort: true });
      }
      this.decorations = deco;
    }
  },
  {
    decorations: (p) => p.decorations,
    provide: (p) =>
      EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
  },
);
