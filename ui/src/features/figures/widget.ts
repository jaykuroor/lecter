// A figure in the buffer: a block widget under its spec that draws the plot only while it is in
// view (08-figures.md#memory: described figures re-render from their spec when visible). Out of
// view its drawing is dropped and its stage keeps its size, so the layout doesn't move; back in
// view it is drawn again. The figure runtime (spec reader, plot, SVG) is a separate chunk loaded
// the first time any figure comes into view (ui/CLAUDE.md).
import { WidgetType } from "@codemirror/view";
import "./Figure.css";

type Runtime = typeof import("./runtime");

let runtime: Promise<Runtime> | null = null;

/** The figure runtime, loaded once. */
function loadRuntime(): Promise<Runtime> {
  runtime ??= import("./runtime");
  return runtime;
}

/** Called with true when an element comes into view and false when it leaves. */
type OnView = (visible: boolean) => void;

const watched = new WeakMap<Element, OnView>();
let observer: IntersectionObserver | null = null;

/** One observer for every figure (no polling): tells each figure when it enters or leaves view. */
function watch(el: Element, onView: OnView): void {
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) watched.get(e.target)?.(e.isIntersecting);
  });
  watched.set(el, onView);
  observer.observe(el);
}

function unwatch(el: Element): void {
  watched.delete(el);
  observer?.unobserve(el);
}

/** A function plot drawn from `source` (the spec between the fences). */
export class FigureWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  override eq(other: FigureWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "figure";
    figure.dataset.figure = "fnplot";
    figure.dataset.renders = "0";
    const stage = document.createElement("div");
    stage.className = "figure-stage";
    figure.append(stage);
    // Each time it comes into view counts; a load that finishes after the figure left view (or
    // came back again, or left the buffer) draws nothing.
    let shown = 0;
    const show = (visible: boolean): void => {
      figure.dataset.visible = String(visible);
      const turn = ++shown;
      if (!visible) {
        stage.replaceChildren();
        delete figure.dataset.drawn;
        return;
      }
      void loadRuntime().then((r) => {
        if (turn !== shown || !figure.isConnected) return;
        figure.dataset.drawn = r.renderFnplot(stage, this.source);
        figure.dataset.renders = String(Number(figure.dataset.renders) + 1);
      });
    };
    watch(figure, show);
    return figure;
  }

  override destroy(dom: HTMLElement): void {
    unwatch(dom);
  }

  override get estimatedHeight(): number {
    return 240;
  }
}
