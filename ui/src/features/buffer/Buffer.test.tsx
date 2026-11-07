import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import type { Edit, Lecture } from "../../core/lecture";
import { runCommand } from "../../keys/commands";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { locate } from "../../keys/locate";
import { Buffer } from "./Buffer";
import { registerElementMotions } from "./vim";

const lecture: Lecture = { path: "lectures/l07.md", name: "l07.md", text: sampleLecture };

function mount(initial: Lecture | null = lecture, error: string | null = null) {
  const [current, setCurrent] = createSignal<Lecture | null>(initial);
  const { container } = render(() => <Buffer lecture={current()} error={error} />);
  const root = container.querySelector(".lecture-buffer") as HTMLElement;
  const view = () => {
    const content = container.querySelector(".cm-content");
    const v = content ? EditorView.findFromDOM(content as HTMLElement) : null;
    if (!v) throw new Error("no editor");
    return v;
  };
  return { root, view, setCurrent };
}

/** Presses Vim keys one by one, as the user would. */
function keys(view: EditorView, ...pressed: string[]) {
  const cm = getCM(view);
  if (!cm) throw new Error("no vim");
  for (const k of pressed) Vim.handleKey(cm, k, "user");
}

/** The 1-based line the cursor is on. */
const line = (view: EditorView) => view.state.doc.lineAt(view.state.selection.main.head).number;

describe("the lecture buffer", () => {
  afterEach(cleanup);

  it("shows a hint and no editor until a lecture is open", () => {
    const { root } = mount(null);
    expect(root.querySelector(".buffer-empty")?.textContent).toBe("Open a lecture from the rail.");
    expect(root.querySelector(".cm-editor")).toBeNull();
    expect(root.dataset.lecture).toBe("");
    expect(root.dataset.vimMode).toBe("normal");
  });

  it("shows the core's error for a lecture that failed to open", () => {
    const { root } = mount(null, "lectures/l08.md no longer exists.");
    expect(root.querySelector('[role="alert"]')?.textContent).toBe("lectures/l08.md no longer exists.");
  });

  it("renders the lecture's slides as headings and its blocks without their syntax", () => {
    const { root, view } = mount();
    expect(root.dataset.lecture).toBe("lectures/l07.md");
    expect(view().state.doc.toString()).toBe(sampleLecture);
    const labels = [...root.querySelectorAll(".slide-heading-label")].map((e) => e.textContent);
    expect(labels).toEqual(["Slide 1 / 3", "⚑ Slide 2 / 3", "Slide 3 / 3"]);
    const blocks = [...root.querySelectorAll(".cm-line.cm-block")].map((e) => e.textContent);
    expect(blocks[0]).toBe("Covariance measures how two variables move together.");
    expect(blocks).toHaveLength(5);
    expect(root.querySelectorAll(".cm-block-flagged")).toHaveLength(1);
    expect(view().contentDOM.getAttribute("aria-label")).toBe("Lecture l07.md");
  });

  it("starts on the first block, focused, in normal mode", () => {
    const { root, view } = mount();
    expect(line(view())).toBe(14);
    expect(view().hasFocus).toBe(true);
    expect(root.dataset.vimMode).toBe("normal");
    expect(root.querySelector(".cm-focused-line")?.textContent).toBe(
      "Covariance measures how two variables move together.",
    );
  });

  it("keeps the focus on the cursor's block when lines are added above it", () => {
    const { root, view } = mount();
    const v = view();
    v.dispatch({ changes: { from: v.state.doc.line(13).from, insert: "[A new block]{#s1b9}\n\n" } });
    expect(line(v)).toBe(16);
    const focused = root.querySelectorAll(".cm-focused-line");
    expect([...focused].map((e) => e.textContent)).toEqual(["Covariance measures how two variables move together."]);
  });

  it("moves between blocks with j, k, gg and G, and counts work", () => {
    const { view } = mount();
    const v = view();
    const visited: number[] = [];
    for (let i = 0; i < 7; i++) {
      keys(v, "j");
      visited.push(line(v));
    }
    expect(visited).toEqual([16, 23, 25, 28, 32, 39, 39]);
    keys(v, "k");
    expect(line(v)).toBe(32);
    keys(v, "g", "g");
    expect(line(v)).toBe(14);
    keys(v, "G");
    expect(line(v)).toBe(39);
    keys(v, "3", "k");
    expect(line(v)).toBe(25);
    keys(v, "2", "g", "g");
    expect(line(v)).toBe(16);
    keys(v, "4", "G");
    expect(line(v)).toBe(25);
  });

  // F-037: the buffer keeps only 10-keymap.md's Vim subset and tells the key engine about itself.
  it("drops the given-up Vim keys and registers with the key engine while it is shown", () => {
    const { view } = mount();
    const v = view();
    const note = v.state.doc.line(32);
    v.dispatch({ selection: { anchor: note.from } });
    keys(v, "S");
    expect(v.state.doc.line(32).text).toBe("Try it with numbers.");
    expect(getCM(v)?.state.vim?.insertMode).toBe(false);
    expect(locate(v.contentDOM)).toMatchObject({ el: "note-line", mode: "normal" });
    expect(locate(v.contentDOM).buffer?.root.contains(v.contentDOM)).toBe(true);
    cleanup();
    expect(locate(v.contentDOM).buffer).toBeNull();
  });

  it("switches to insert with i and back with Esc, typing into the block", () => {
    const { root, view } = mount();
    const v = view();
    keys(v, "j", "i");
    expect(root.dataset.vimMode).toBe("insert");
    v.dispatch(v.state.replaceSelection("Note: "));
    keys(v, "<Esc>");
    expect(root.dataset.vimMode).toBe("normal");
    expect(v.state.doc.line(16).text).toBe("[Note: It is zero for independent variables.]{#s1b2}");
  });

  it("keeps operators linewise over the real lines (dj deletes this line and the next)", () => {
    const { view } = mount();
    const v = view();
    keys(v, "d", "j");
    expect(v.state.doc.line(14).text).toBe("[It is zero for independent variables.]{#s1b2}");
    expect(v.state.doc.lines).toBe(40);
  });

  it("opens the next lecture in the same editor, back in normal mode", () => {
    const { root, view, setCurrent } = mount();
    const first = view();
    keys(first, "i");
    setCurrent({ path: "lectures/l08.md", name: "l08.md", text: "[Only block]{#s1b1}\n" });
    expect(view()).toBe(first);
    expect(first.state.doc.line(1).text).toBe("[Only block]{#s1b1}");
    expect(root.dataset.vimMode).toBe("normal");
    expect(root.dataset.lecture).toBe("lectures/l08.md");
    keys(first, "i");
    expect(root.dataset.vimMode).toBe("insert");
  });
});

describe("the element motions outside a lecture", () => {
  afterEach(cleanup);

  it("move by plain lines in any other Vim editor, and with an operator pending", () => {
    registerElementMotions();
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "a\n:::\n\nd\ne", extensions: [vim()] }),
    });
    keys(view, "j", "j");
    expect(line(view)).toBe(3);
    keys(view, "G");
    expect(line(view)).toBe(5);
    keys(view, "g", "g");
    expect(line(view)).toBe(1);
    keys(view, "2", "G");
    expect(line(view)).toBe(2);
    keys(view, "k", "k");
    expect(line(view)).toBe(1);
    view.destroy();
    parent.remove();
  });

  it("edits fine without an onEdits listener", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { view } = mount();
    view().dispatch(view().state.replaceSelection("x"));
    expect(view().state.doc.toString().includes("x")).toBe(true);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  /**
   * F-023, F-048: with its course, the buffer runs ask (Enter, or its hint clicked) on a block; without
   * one there is no ask. `a` on a block does nothing either way.
   */
  it("asks with a on a block of a lecture whose course is known", () => {
    const binding = DEFAULT_KEYMAP.find((b) => b.command === "ai.ask");
    if (!binding) throw new Error("no ask binding");
    const run = () => runCommand({ binding, count: 1, explicit: false });
    const { container } = render(() => <Buffer lecture={lecture} course="/c/STAT311" error={null} />);
    const v = EditorView.findFromDOM(container.querySelector(".cm-content") as HTMLElement);
    if (!v) throw new Error("no editor");
    keys(v, "a");
    expect(container.querySelector(".gloss")).toBeNull();
    expect(run()).toBe(true);
    expect(container.querySelector(".gloss")?.getAttribute("data-state")).toBe("prompt");
    cleanup();
    const plain = render(() => <Buffer lecture={lecture} error={null} />);
    const w = EditorView.findFromDOM(plain.container.querySelector(".cm-content") as HTMLElement);
    if (!w) throw new Error("no editor");
    expect(run()).toBe(false);
    keys(w, "a");
    expect(plain.container.querySelector(".gloss")).toBeNull();
    expect(plain.container.querySelector(".lecture-buffer")?.getAttribute("data-vim-mode")).toBe("normal");
  });

  /** F-021: what is typed in insert mode reaches `onEdits`, in the buffer's positions. */
  it("hands every edit to onEdits, and none for moving", () => {
    const sent: Edit[][] = [];
    const { container } = render(() => <Buffer lecture={lecture} error={null} onEdits={(e) => sent.push(e)} />);
    const content = container.querySelector(".cm-content") as HTMLElement;
    const v = EditorView.findFromDOM(content);
    if (!v) throw new Error("no editor");
    const start = v.state.selection.main.head;
    keys(v, "j", "k");
    expect(sent).toEqual([]);
    keys(v, "i");
    v.dispatch(v.state.replaceSelection("Hi "));
    expect(sent).toEqual([[{ from: start, to: start, text: "Hi " }]]);
    expect(v.state.doc.toString()).toBe(`${sampleLecture.slice(0, start)}Hi ${sampleLecture.slice(start)}`);
  });
});
