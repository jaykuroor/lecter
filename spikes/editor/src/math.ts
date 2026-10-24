// KaTeX rendering for the spike: inline `$…$` through a ViewPlugin over the visible ranges only
// (raw text while the cursor is inside), display `$$…$$` lines as block widgets (see blocks.ts).
import { type EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";

const cache = new Map<string, string>();

export function renderTex(tex: string, display: boolean): string {
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
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-math-display" : "cm-math-inline";
    el.innerHTML = renderTex(this.tex, this.display);
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

function inlineDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    INLINE_RE.lastIndex = 0;
    for (let m = INLINE_RE.exec(text); m; m = INLINE_RE.exec(text)) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (cursorTouches(state, start, end)) continue;
      builder.add(start, end, Decoration.replace({ widget: new MathWidget(m[1], false) }));
    }
  }
  return builder.finish();
}

export const inlineMath = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = inlineDecos(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) this.decorations = inlineDecos(u.view);
    }
  },
  {
    decorations: (p) => p.decorations,
    provide: (p) =>
      EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
  },
);
