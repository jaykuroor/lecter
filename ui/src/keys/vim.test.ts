import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sampleLecture } from "../../e2e/mock-core/lectures";
import { lectureState } from "../features/buffer/editorState";
import { registerElementMotions } from "../features/buffer/vim";
import { registerAppendKey } from "./append";
import { bootKeys } from "./boot";
import { type Invocation, registerCommand } from "./commands";
import { type Keys, startKeys } from "./install";
import { setBufferTarget } from "./locate";
import { bufferTarget, lineElement, trimVimKeys, VIM_DROPPED, type VimKeyApi } from "./vim";

// Sample lines (1-based): 14, 16 and 23 slide blocks, 28 a gloss's line, 29 its closing fence,
// 32 an own note's line, 30 the gap between them, 10 the blank line before the first slide.
const BLOCK = 14;
const GLOSS = 28;
const NOTE = 32;

describe("trimVimKeys", () => {
  it("drops every listed Vim key once, and moves Page Up/Down and the jump list", () => {
    const calls: string[] = [];
    const api: VimKeyApi = {
      unmap: (lhs, ctx) => calls.push(`unmap ${lhs} ${ctx ?? "-"}`),
      mapCommand: (keys, type, name, args) => calls.push(`map ${keys} ${type} ${name} ${JSON.stringify(args)}`),
    };
    trimVimKeys(api);
    trimVimKeys(api);
    expect(calls).toEqual([
      ...VIM_DROPPED.map(([k, c]) => `unmap ${k} ${c ?? "-"}`),
      'map <PageDown> motion moveByPage {"forward":true}',
      'map <PageUp> motion moveByPage {"forward":false}',
      'map <A-Left> action jumpListWalk {"forward":false}',
      'map <A-Right> action jumpListWalk {"forward":true}',
    ]);
  });

  it("drops the given-up keys of 10-keymap.md in normal mode", () => {
    const dropped = VIM_DROPPED.filter(([, ctx]) => ctx === undefined || ctx === "normal").map(([k]) => k);
    for (const key of ["s", "S", "q<register>", "t<character>", "T<character>", "m<register>"]) {
      expect(dropped, key).toContain(key);
    }
    for (const key of ["'<register>", "`<register>", "=", "<CR>", "R", "H", "M", "L", "#"]) {
      expect(dropped, key).toContain(key);
    }
  });
});

describe("lineElement", () => {
  const doc = lectureState(sampleLecture, "x").doc;

  it("tells slide lines, gloss lines and own-note lines apart", () => {
    expect(lineElement(doc, BLOCK)).toBe("slide-line");
    expect(lineElement(doc, 16)).toBe("slide-line");
    expect(lineElement(doc, GLOSS)).toBe("gloss");
    expect(lineElement(doc, 29)).toBe("gloss");
    expect(lineElement(doc, NOTE)).toBe("note-line");
    expect(lineElement(doc, 30)).toBe("note-line");
    expect(lineElement(doc, 10)).toBe("note-line");
    expect(lineElement(doc, 1)).toBe("note-line");
  });

  it("looks past divs that open and close above the line, and stops after 5000 lines", () => {
    const text = (lines: string[]) => lectureState(lines.join("\n"), "x").doc;
    const nested = text(["::: {.gloss #g}", "::: {.note #n}", "inner", ":::", "after", ":::"]);
    expect(lineElement(nested, 3)).toBe("note-line");
    expect(lineElement(nested, 5)).toBe("gloss");
    const far = text(["::: {.gloss #g}", ...Array.from({ length: 5000 }, () => "text"), "end"]);
    expect(lineElement(far, 5000)).toBe("gloss");
    expect(lineElement(far, 5001)).toBe("note-line");
  });
});

/** A lecture buffer in the page, with Lecter's Vim keys. */
function open(): EditorView {
  registerElementMotions();
  registerAppendKey();
  trimVimKeys();
  const parent = document.createElement("div");
  parent.className = "lecture-buffer";
  document.body.append(parent);
  return new EditorView({ state: lectureState(sampleLecture, "Lecture"), parent });
}

/** Puts the cursor at the start of line `n`'s text. */
function at(view: EditorView, n: number, ch = 1): void {
  const line = view.state.doc.line(n);
  view.dispatch({ selection: { anchor: line.from + Math.min(ch, line.length) } });
}

const head = (view: EditorView) => view.state.selection.main.head;
const vimState = (view: EditorView) =>
  (getCM(view)?.state as { vim: { insertMode: boolean } } | undefined)?.vim ?? { insertMode: false };
const keys = (view: EditorView, ...ks: string[]) => {
  const cm = getCM(view);
  if (!cm) throw new Error("no Vim");
  for (const k of ks) Vim.handleKey(cm, k, "user");
};

describe("Vim in the lecture buffer", () => {
  let view: EditorView;
  beforeEach(() => {
    view = open();
  });
  afterEach(() => {
    keys(view, "<Esc>");
    view.destroy();
    document.body.innerHTML = "";
  });

  it("does nothing for the given-up keys (10-keymap.md#vim-subset-kept)", () => {
    const given = [["s"], ["S"], ["q", "Q"], ["t", "Q"], ["T", "Q"], ["m", "Q"], ["'", "Q"], ["`", "Q"]];
    const more = [["=", "="], ["<Tab>"], ["<CR>"], ["R"], ["H"], ["M"], ["L"], ["#"]];
    for (const seq of [...given, ...more]) {
      at(view, NOTE, 4);
      const before = { doc: view.state.doc.toString(), head: head(view) };
      keys(view, ...seq);
      expect({ doc: view.state.doc.toString(), head: head(view) }, seq.join("")).toEqual(before);
      expect(vimState(view).insertMode, seq.join("")).toBe(false);
    }
    expect(Vim.getVimGlobalState_().macroModeState.isRecording).toBe(false);
  });

  it("does nothing for Vim keys outside the kept subset", () => {
    for (const seq of [["W"], ["D"], ["%"], ["X"], ["g", "q", "q"], ["F", "T"], ["<C-o>"], ["+"], ["~"]]) {
      at(view, NOTE, 4);
      const before = { doc: view.state.doc.toString(), head: head(view) };
      keys(view, ...seq);
      expect({ doc: view.state.doc.toString(), head: head(view) }, seq.join("")).toEqual(before);
    }
  });

  it("keeps the subset's keys working", () => {
    const note = () => view.state.doc.line(NOTE).text;
    at(view, NOTE, 0);
    keys(view, "x");
    expect(note()).toBe("ry it with numbers.");
    keys(view, "u");
    expect(note()).toBe("Try it with numbers.");
    keys(view, "<C-r>");
    expect(note()).toBe("ry it with numbers.");
    keys(view, "u");
    keys(view, "w");
    expect(head(view) - view.state.doc.line(NOTE).from).toBe(4);
    keys(view, "f", "w", ";");
    expect(view.state.doc.sliceString(head(view), head(view) + 4)).toBe("with");
    keys(view, "c", "i", "w");
    expect(note()).toBe("Try it  numbers.");
    expect(vimState(view).insertMode).toBe(true);
    keys(view, "<Esc>");
    keys(view, "d", "d");
    expect(view.state.doc.line(NOTE).text).toBe(":::");
  });

  it("keeps >> and << indenting a line", () => {
    const note = () => view.state.doc.line(NOTE).text;
    at(view, NOTE, 0);
    keys(view, ">", ">");
    expect(note()).toMatch(/^\s+Try it with numbers\.$/);
    keys(view, "<", "<");
    expect(note()).toBe("Try it with numbers.");
  });

  it("scrolls by page with Page Down and Page Up, and walks the jump list with Alt-←", () => {
    at(view, BLOCK);
    const start = head(view);
    keys(view, "G");
    expect(head(view)).not.toBe(start);
    keys(view, "<A-Left>");
    expect(head(view)).toBe(start);
  });
});

describe("bufferTarget", () => {
  let view: EditorView;
  beforeEach(() => {
    view = open();
  });
  afterEach(() => {
    view.destroy();
    document.body.innerHTML = "";
  });

  it("reports Vim's mode, with a command in progress counted as insert", () => {
    const t = bufferTarget(view, view.dom);
    expect(t.root).toBe(view.dom);
    expect(t.mode()).toBe("normal");
    keys(view, "v");
    expect(t.mode()).toBe("visual");
    keys(view, "<Esc>", "d");
    expect(t.mode()).toBe("insert");
    keys(view, "<Esc>", "f");
    expect(t.mode()).toBe("insert");
    keys(view, "<Esc>", "i");
    expect(t.mode()).toBe("insert");
    keys(view, "<Esc>");
    expect(t.mode()).toBe("normal");
  });

  it("reports the kind of line under the cursor", () => {
    const t = bufferTarget(view, view.dom);
    at(view, BLOCK);
    expect(t.element()).toBe("slide-line");
    at(view, GLOSS);
    expect(t.element()).toBe("gloss");
    at(view, NOTE);
    expect(t.element()).toBe("note-line");
  });

  it("hands held-back keys to Vim in order", () => {
    const t = bufferTarget(view, view.dom);
    at(view, BLOCK);
    t.replay(["2", "j"]);
    expect(view.state.doc.lineAt(head(view)).number).toBe(23);
  });
});

describe("the engine on the buffer", () => {
  let view: EditorView;
  let engine: Keys;
  let stopBoot: () => void;
  let dropTarget: () => void;
  const calls: string[] = [];
  const drops: (() => void)[] = [];
  const record = (call: Invocation) => {
    calls.push(`${call.binding.command} ×${call.count} line ${view.state.doc.lineAt(head(view)).number}`);
    return true;
  };

  beforeAll(() => {
    for (const command of ["ai.steps", "slide.next", "ai.ask", "gloss.regenerate"]) {
      drops.push(registerCommand(command, record));
    }
  });
  afterAll(() => {
    for (const drop of drops) drop();
  });
  beforeEach(() => {
    calls.length = 0;
    view = open();
    const boot = bootKeys(window, false);
    stopBoot = boot.stop;
    engine = startKeys({ mac: false, host: document.body });
    boot.attach(engine.handle);
    dropTarget = setBufferTarget(bufferTarget(view, view.dom));
  });
  afterEach(() => {
    dropTarget();
    stopBoot();
    engine.stop();
    keys(view, "<Esc>");
    view.destroy();
    document.body.innerHTML = "";
  });

  /** Presses `key` in the buffer; whether the key reached the editor (the engine let it through). */
  const press = (key: string, init: KeyboardEventInit = {}) => {
    let reached = false;
    const seen = () => {
      reached = true;
    };
    view.contentDOM.addEventListener("keydown", seen);
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
    view.contentDOM.removeEventListener("keydown", seen);
    return reached;
  };

  it("runs the same command for a line key on a slide line and on an own-note line", () => {
    at(view, BLOCK);
    expect(press("s")).toBe(false);
    at(view, NOTE);
    expect(press("s")).toBe(false);
    expect(calls).toEqual([`ai.steps ×1 line ${BLOCK}`, `ai.steps ×1 line ${NOTE}`]);
  });

  it("leaves line keys to type text in insert mode", () => {
    at(view, NOTE);
    keys(view, "i");
    expect(press("s")).toBe(true);
    expect(press("Enter")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("asks about a selection with Enter in visual mode", () => {
    at(view, NOTE);
    keys(view, "v", "l");
    expect(press("Enter")).toBe(false);
    expect(calls).toEqual([`ai.ask ×1 line ${NOTE}`]);
  });

  it("uses a gloss's own keys on a gloss", () => {
    at(view, GLOSS);
    expect(press("r")).toBe(false);
    expect(press("s")).toBe(true);
    expect(calls).toEqual([`gloss.regenerate ×1 line ${GLOSS}`]);
  });

  it("gives a count to a Lecter key and hands a count back to Vim's own keys", () => {
    at(view, BLOCK);
    press("3");
    press("]");
    press("]");
    expect(calls).toEqual([`slide.next ×3 line ${BLOCK}`]);
    // `2j`: the engine holds the 2, then Vim gets 2 and j.
    expect(press("2")).toBe(false);
    expect(press("j")).toBe(true);
    expect(view.state.doc.lineAt(head(view)).number).toBe(23);
  });

  it("hands a held prefix back to Vim when no Lecter key follows (gg)", () => {
    at(view, NOTE);
    expect(press("g")).toBe(false);
    // The engine gives Vim its `g`, then lets this one through; Vim's `gg` ends on the first element.
    expect(press("g")).toBe(true);
    expect(view.state.doc.lineAt(head(view)).number).toBe(BLOCK);
  });

  it("takes a given-up key whose command isn't there yet, and leaves Vim's own keys to Vim", () => {
    const drop = registerCommand("ai.ask", () => false);
    at(view, NOTE);
    // Enter (ai.ask declines here) and Tab (ai.write, no handler): taken, so the cursor stays.
    expect(press("Enter")).toBe(false);
    expect(press("Tab")).toBe(false);
    expect(press("3")).toBe(false);
    expect(press("Enter")).toBe(false);
    // `.` (repeat, no handler yet) and `o` are still Vim's.
    expect(press(".")).toBe(true);
    expect(press("o")).toBe(true);
    drop();
    expect(calls).toEqual([]);
  });

  it("leaves keys to Vim while Vim waits for more (d, then s)", () => {
    at(view, NOTE);
    keys(view, "d");
    expect(press("s")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("toggles nothing and runs nothing for keys aimed at a field inside the buffer", () => {
    const field = document.createElement("input");
    view.dom.append(field);
    at(view, NOTE);
    expect(field.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }))).toBe(true);
    expect(calls).toEqual([]);
  });
});
