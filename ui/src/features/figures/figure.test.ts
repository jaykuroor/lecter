// F-024 criteria 1 and 3 in the buffer: an answer from the (fake) provider that holds a function
// plot spec is saved as a gloss, and the gloss shows the plot, computed here; the plot is drawn
// only when it is in view, and again each time it comes back into view.
import type { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { ask, fakeBackend, mount, prompt, TEXT, useBuffer } from "../gloss/__tests__/kit";

useBuffer();

/** The sample provider's plot answer (crates/ai/src/figures/sample.rs, SAMPLE_PLOT_ANSWER). */
const SAMPLE_PLOT =
  "**Sample answer.** No AI provider is connected yet, so Lecter shows this built-in sample plot instead of a real answer: y = x² on [-1, 1], with 100 random points on the curve. Lecter draws it on this computer from the spec below; nothing is fetched.\n\n```fnplot\n" +
  '{"type": "fnplot", "exprs": ["x^2"], "x": [-1, 1], "params": {"n": {"min": 10, "max": 1000, "value": 100}}, "scatter": {"sample": "x ~ U(-1,1); y = x^2", "n": "n"}}\n```';

/** The gloss the core sends in `done` for it (lecter_ai::gloss::fenced_div). */
const PLOT_DIV = `::: {.gloss #g-0001 kind=ask key=Enter anchor=s1b1 model="sample" by=ai}\n**you asked:** can you plot it?\n\n${SAMPLE_PLOT}\n:::`;

// The browser's IntersectionObserver, faked at the edge: the test says what is in view.
// CodeMirror makes observers of its own, so each fake keeps its own callback and targets.
type Entry = { target: Element; isIntersecting: boolean };
const observers: FakeObserver[] = [];
class FakeObserver {
  readonly targets = new Set<Element>();
  constructor(readonly report: (entries: Entry[]) => void) {
    observers.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
}
vi.stubGlobal("IntersectionObserver", FakeObserver);

/** Whether any observer watches `el`. */
const watched = (el: Element) => observers.some((o) => o.targets.has(el));

/** Scrolls `el` into (or out of) view. */
function inView(el: Element, visible: boolean) {
  const mine = observers.filter((o) => o.targets.has(el));
  expect(mine.length).toBe(1);
  mine[0]?.report([{ target: el, isIntersecting: visible }]);
}

const figure = (view: EditorView) => view.dom.querySelector<HTMLElement>("figure.figure");

/** Asks about the first block and answers with `div`, as the core would. */
function answer(view: EditorView, f: ReturnType<typeof fakeBackend>, div = PLOT_DIV) {
  ask(view);
  prompt(view, "can you plot it?");
  const emit = f.asks[0]?.emit ?? (() => undefined);
  emit({ event: "started", data: { gloss: "g-0001", model: "sample" } });
  emit({ event: "done", data: { markdown: div } });
}

describe("a described figure in a gloss", () => {
  it("renders the answer's fnplot spec as a plot inside the gloss, computed locally", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const f = fakeBackend();
    const view = mount(f.backend);
    answer(view, f);
    expect(view.state.doc.toString()).toContain(PLOT_DIV);
    const fig = figure(view);
    if (!fig) throw new Error("no figure in the gloss");
    // Under the spec's closing fence, before the gloss's own closing fence.
    const line = view.lineBlockAt(view.posAtDOM(fig));
    const fence = view.state.doc.lineAt(line.from);
    expect(fence.text).toBe("```");
    expect(view.state.doc.line(fence.number + 1).text).toBe(":::");
    expect(fig.previousElementSibling?.textContent).toBe("```");
    expect(fig.dataset.figure).toBe("fnplot");
    expect(fig.firstElementChild?.className).toBe("figure-stage");
    inView(fig, true);
    await vi.waitFor(() => expect(fig.dataset.drawn).toBe("plot"));
    const svg = fig.querySelector(".figure-stage > svg.figure-plot");
    expect(svg?.getAttribute("aria-label")).toBe("Plot of y = x^2 for x from -1 to 1");
    expect(svg?.querySelector(".figure-legend")?.textContent).toBe("y = x^2");
    // y = x^2 over [-1, 1]: from the top-left corner down to the bottom at x = 0 and back up.
    const d = svg?.querySelector("path.figure-curve")?.getAttribute("d") ?? "";
    expect(d.startsWith("M44,10 L")).toBe(true);
    expect(d).toContain(" L296,198 ");
    expect(d.endsWith(" L548,10")).toBe(true);
    expect(svg?.querySelectorAll("circle.figure-point").length).toBe(100);
  });

  it("is drawn only when scrolled into view, and again each time it comes back", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const f = fakeBackend();
    const view = mount(f.backend);
    answer(view, f);
    const fig = figure(view);
    if (!fig) throw new Error("no figure in the gloss");
    // Out of view (as reported when it is first watched): nothing is drawn.
    inView(fig, false);
    await Promise.resolve();
    expect(fig.querySelector("svg")).toBe(null);
    expect(fig.dataset.renders).toBe("0");
    inView(fig, true);
    await vi.waitFor(() => expect(fig.dataset.renders).toBe("1"));
    expect(fig.querySelector("svg")).not.toBe(null);
    // Edits elsewhere while it is in view don't draw it again, and keep the same figure.
    const note = view.state.doc.toString().indexOf("my own note");
    view.dispatch({ changes: { from: note, insert: "x" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(figure(view)).toBe(fig);
    expect(fig.dataset.renders).toBe("1");
    // A new gloss elsewhere finds the figures again, but this one is the same and isn't redrawn.
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n::: {.note #n-1}\nmine\n:::\n" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(figure(view)).toBe(fig);
    expect(fig.dataset.renders).toBe("1");
    // Scrolled away: the drawing goes; edits while away draw nothing.
    inView(fig, false);
    expect(fig.querySelector("svg")).toBe(null);
    expect(fig.dataset.drawn).toBe(undefined);
    view.dispatch({ changes: { from: note, insert: "y" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(fig.dataset.renders).toBe("1");
    // Back in view: drawn again from its spec.
    inView(fig, true);
    await vi.waitFor(() => expect(fig.dataset.renders).toBe("2"));
    expect(fig.querySelectorAll("svg").length).toBe(1);
  });

  it("draws nothing for a load that ends after the figure left view", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const f = fakeBackend();
    const view = mount(f.backend);
    answer(view, f);
    const fig = figure(view);
    if (!fig) throw new Error("no figure in the gloss");
    inView(fig, true);
    inView(fig, false);
    await new Promise((r) => setTimeout(r, 20));
    expect(fig.querySelector("svg")).toBe(null);
    expect(fig.dataset.renders).toBe("0");
  });

  it("follows edits to the spec, and stops watching a figure that goes", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const f = fakeBackend();
    const view = mount(f.backend);
    answer(view, f);
    const first = figure(view);
    if (!first) throw new Error("no figure in the gloss");
    const at = view.state.doc.toString().indexOf('["x^2"]');
    view.dispatch({ changes: { from: at + 2, to: at + 5, insert: "2*x" } });
    const second = figure(view);
    if (!second) throw new Error("no figure after the edit");
    expect(second).not.toBe(first);
    expect(watched(first)).toBe(false);
    inView(second, true);
    await vi.waitFor(() => expect(second.dataset.drawn).toBe("plot"));
    expect(second.querySelector(".figure-legend")?.textContent).toBe("y = 2*x");
    // Undoing the whole gloss removes the figure.
    const mine = observers.find((o) => o.targets.has(second));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: TEXT } });
    expect(figure(view)).toBe(null);
    expect(watched(second)).toBe(false);
    // An entry that still arrives for it, or for anything not watched, changes nothing.
    mine?.report([{ target: second, isIntersecting: false }]);
    mine?.report([{ target: document.createElement("figure"), isIntersecting: true }]);
    expect(second.dataset.visible).toBe("true");
  });

  it("shows why a spec in a gloss can't be drawn, as text", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const f = fakeBackend();
    const view = mount(f.backend);
    const bad = PLOT_DIV.replace('"x": [-1, 1]', '"x": [1, -1]');
    answer(view, f, bad);
    const fig = figure(view);
    if (!fig) throw new Error("no figure in the gloss");
    inView(fig, true);
    await vi.waitFor(() => expect(fig.dataset.drawn).toBe("error"));
    expect(fig.textContent).toBe("This plot can't be drawn: x must go from a smaller to a larger number.");
  });
});
