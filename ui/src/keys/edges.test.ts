import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { bootKeys } from "./boot";
import { registerCommand, runCommand } from "./commands";
import { compileKeymap, KeyEngine } from "./engine";
import { startKeys } from "./install";
import type { Binding } from "./keymap";
import { type BufferTarget, locate, setBufferTarget } from "./locate";
import { eventToken, keyLabel, parseKeys } from "./notation";
import { mergeKeymap, parseUserKeymap, stripJsonc } from "./user";
import { bufferTarget, lineElement } from "./vim";

// Edge cases of each part of the engine: inputs just off what the rules accept.

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

describe("notation at its edges", () => {
  it("takes only whole function-key names and whole key places", () => {
    expect(eventToken(key({ key: "XF1" }))).toBeNull();
    expect(eventToken(key({ key: "F1X" }))).toBeNull();
    expect(eventToken(key({ key: "a", code: "XKeyQ", ctrlKey: true }))).toBe("<C-a>");
    expect(eventToken(key({ key: "a", code: "KeyQX", ctrlKey: true }))).toBe("<C-a>");
  });

  it("reads a name only where a < starts one", () => {
    expect(parseKeys("<x<C-a>", false)).toEqual(["<", "x", "<C-a>"]);
    expect(parseKeys("<A>", false)).toEqual(["A"]);
    expect(() => parseKeys("<F1x>", false)).toThrow("unknown key name <F1x>");
    expect(() => parseKeys("<k12>", false)).toThrow("unknown key name <k12>");
    expect(() => parseKeys("<xk1>", false)).toThrow("unknown key name <xk1>");
    expect(() => parseKeys("<xF1>", false)).toThrow("unknown key name <xF1>");
    expect(parseKeys("<F12>", false)).toEqual(["<F12>"]);
  });

  it("labels only a whole token", () => {
    expect(keyLabel("a<b>", false)).toBe("a<b>");
    expect(keyLabel("<b>x", false)).toBe("<b>x");
    expect(keyLabel("<C-S-p>", false)).toBe("Ctrl-Shift-p");
  });
});

describe("keymaps.jsonc at its edges", () => {
  it("leaves a lone / or * outside strings alone, and ends a block comment at its own */", () => {
    expect(stripJsonc("[1]/x")).toBe("[1]/x");
    expect(stripJsonc("2*3")).toBe("2*3");
    expect(stripJsonc("/*/ x */1")).toBe("1");
    expect(stripJsonc("1 // a\n2")).toBe("1 \n2");
  });

  it("reads nothing at all from a file it refuses", () => {
    const none = (warning: string) => ({ bindings: [], warnings: [warning] });
    expect(parseUserKeymap("{ nope", false)).toEqual(none("keymaps.jsonc is not valid JSONC; not read"));
    const shape = 'keymaps.jsonc needs "version": 1 and a "bindings" list; not read';
    expect(parseUserKeymap("null", false)).toEqual(none(shape));
    expect(parseUserKeymap("7", false)).toEqual(none(shape));
  });

  it("gives a user binding without modes no modes at all", () => {
    const { bindings } = mergeKeymap([], [{ keys: "x", command: "a", context: "line" }], false);
    expect(bindings).toStrictEqual([{ keys: "x", command: "a", scope: "line", desc: "a" }]);
  });
});

const B = (keys: string, command: string, extra: Partial<Binding> = {}): Binding => ({
  keys,
  command,
  scope: "line",
  desc: command,
  ...extra,
});

describe("the engine at its edges", () => {
  it("waits through a sequence whose binding is several keys deep", () => {
    const e = new KeyEngine(compileKeymap([B("abc", "deep")], false));
    expect(e.feed("a", "note-line", "normal").kind).toBe("pending");
    expect(e.feed("b", "note-line", "normal").kind).toBe("pending");
    expect(e.feed("c", "note-line", "normal")).toMatchObject({ kind: "run", binding: { command: "deep" } });
  });

  it("doesn't wait for a sequence that has no binding in this mode", () => {
    const e = new KeyEngine(compileKeymap([B("abc", "deep")], false));
    expect(e.feed("a", "note-line", "visual").kind).toBe("pass");
  });

  it("starts afresh after a reset", () => {
    const e = new KeyEngine(compileKeymap([B("ab", "x"), B("e", "e")], false));
    e.feed("a", "note-line", "normal");
    e.reset();
    expect(e.feed("e", "note-line", "normal")).toMatchObject({ kind: "run", binding: { command: "e" } });
  });

  it("takes every digit for a count", () => {
    const e = new KeyEngine(compileKeymap([B("s", "steps")], false));
    for (let n = 1; n <= 9; n++) {
      expect(e.feed(`${n}`, "note-line", "normal").kind, `${n}`).toBe("pending");
      expect(e.feed("0", "note-line", "normal").kind).toBe("pending");
      expect(e.feed("s", "note-line", "normal")).toMatchObject({ kind: "run", count: n * 10 });
    }
  });

  it("tells its listener when a reset drops pending keys", () => {
    const e = new KeyEngine(compileKeymap([B("ab", "x")], false));
    const seen: string[][] = [];
    e.onChange = (p) => seen.push([...p]);
    e.feed("a", "note-line", "normal");
    e.reset();
    expect(seen).toEqual([["a"], []]);
  });

  it("repeats a held gloss key", () => {
    const e = new KeyEngine(compileKeymap([B("r", "again", { scope: "gloss" })], false));
    expect(e.feed("r", "gloss", "normal", true).kind).toBe("run");
  });
});

describe("commands", () => {
  it("keeps a newer handler when an older one is removed", () => {
    const binding = B("x", "edge.cmd");
    const seen: string[] = [];
    const dropOld = registerCommand("edge.cmd", () => {
      seen.push("old");
    });
    const dropNew = registerCommand("edge.cmd", () => {
      seen.push("new");
    });
    dropOld();
    expect(runCommand({ binding, count: 1, explicit: false })).toBe(true);
    dropNew();
    expect(runCommand({ binding, count: 1, explicit: false })).toBe(false);
    expect(seen).toEqual(["new"]);
  });
});

/** A buffer target over `root` that records whether its line was asked for. */
function fake(root: Element, mode: "normal" | "visual" | "insert"): BufferTarget & { asked: number } {
  const t = {
    asked: 0,
    root,
    mode: () => mode,
    element: () => {
      t.asked += 1;
      return "gloss" as const;
    },
    replay: () => {},
  };
  return t;
}

describe("locate", () => {
  const drops: (() => void)[] = [];
  afterEach(() => {
    for (const drop of drops.splice(0)) drop();
    document.body.innerHTML = "";
  });

  it("says exactly where a key lands outside the buffer", () => {
    document.body.innerHTML = `<div id="p"></div><input id="f"><button id="b"></button><div class="lecture-buffer" data-vim-mode="visual"><i id="v"></i></div>`;
    const at = (id: string) => locate(document.getElementById(id));
    expect(locate(null)).toEqual({ el: "page", mode: "normal", buffer: null });
    expect(at("p")).toEqual({ el: "page", mode: "normal", buffer: null });
    expect(at("f")).toEqual({ el: "field", mode: "normal", buffer: null });
    expect(at("b")).toEqual({ el: "control", mode: "normal", buffer: null });
    expect(at("v")).toEqual({ el: "page", mode: "visual", buffer: null });
  });

  it("asks the registered buffer, but not for its line in insert mode", () => {
    document.body.innerHTML = `<div id="buf"><p id="line"></p><textarea id="t"></textarea><select id="s"></select><input id="i"></div>`;
    const root = document.getElementById("buf") as Element;
    const normal = fake(root, "normal");
    drops.push(setBufferTarget(normal));
    expect(locate(document.getElementById("line"))).toEqual({ el: "gloss", mode: "normal", buffer: normal });
    for (const id of ["t", "s", "i"]) expect(locate(document.getElementById(id)).el, id).toBe("field");
    const insert = fake(root, "insert");
    drops.push(setBufferTarget(insert));
    expect(locate(document.getElementById("line"))).toEqual({ el: "note-line", mode: "insert", buffer: insert });
    expect(insert.asked).toBe(0);
  });

  it("treats fields inside a buffer not yet registered as fields", () => {
    document.body.innerHTML = `<div class="lecture-buffer" data-vim-mode="replace"><i id="r"></i></div>`;
    expect(locate(document.getElementById("r"))).toEqual({ el: "field", mode: "insert", buffer: null });
    document.body.innerHTML = `<div class="lecture-buffer" data-vim-mode="normal"><textarea id="t"></textarea><select id="s"></select></div>`;
    expect(locate(document.getElementById("t")).el).toBe("field");
    expect(locate(document.getElementById("s")).el).toBe("field");
  });

  it("keeps a newer buffer when an older one unregisters", () => {
    document.body.innerHTML = `<div id="buf"><p id="line"></p></div>`;
    const root = document.getElementById("buf") as Element;
    const dropOld = setBufferTarget(fake(root, "normal"));
    const newer = fake(root, "visual");
    drops.push(setBufferTarget(newer));
    dropOld();
    expect(locate(document.getElementById("line")).buffer).toBe(newer);
    (drops.pop() as () => void)();
    expect(locate(document.getElementById("line")).buffer).toBeNull();
  });
});

describe("bootKeys at its edges", () => {
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("waits through each modifier after a held leader, and holds every course digit", () => {
    const boot = bootKeys(window, false);
    stop = boot.stop;
    for (const k of ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]) {
      document.body.dispatchEvent(key({ key: " " }));
      expect(document.body.dispatchEvent(key({ key: k })), k).toBe(true);
      expect(document.body.dispatchEvent(key({ key: "e" })), k).toBe(false);
    }
    for (let n = 1; n <= 9; n++) {
      expect(document.body.dispatchEvent(key({ key: `${n}`, code: `Digit${n}`, ctrlKey: true })), `${n}`).toBe(false);
    }
  });

  it("holds no Space typed into a registered buffer in insert mode", () => {
    const boot = bootKeys(window, false);
    stop = boot.stop;
    const root = document.createElement("div");
    const line = document.createElement("p");
    root.append(line);
    document.body.append(root);
    const drop = setBufferTarget(fake(root, "insert"));
    expect(line.dispatchEvent(key({ key: " " }))).toBe(true);
    drop();
    expect(line.dispatchEvent(key({ key: " " }))).toBe(false);
  });

  it("keeps a held key from the element, and leaves Cmd-Ctrl-1 alone on macOS", () => {
    const boot = bootKeys(window, true);
    stop = boot.stop;
    const field = document.createElement("div");
    document.body.append(field);
    let reached = 0;
    field.addEventListener("keydown", () => reached++);
    field.dispatchEvent(key({ key: "1", code: "Digit1", metaKey: true }));
    expect(reached).toBe(0);
    expect(field.dispatchEvent(key({ key: "1", code: "Digit1", metaKey: true, ctrlKey: true }))).toBe(true);
    expect(reached).toBe(1);
  });
});

describe("the engine in the page at its edges", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lets an unhandled given-up key through outside the buffer, and replays a prefix in it", () => {
    const keys = startKeys({
      mac: false,
      host: document.body,
      userKeymap:
        '{"version": 1, "bindings": [{"keys": "t", "command": "edge.none", "context": "app"}, {"keys": "gs", "command": "edge.none", "context": "line"}]}',
    });
    expect(keys.warnings).toEqual([]);
    const page = key({ key: "t" });
    keys.handle(page);
    expect(page.defaultPrevented).toBe(false);
    const root = document.createElement("div");
    const line = document.createElement("p");
    root.append(line);
    document.body.append(root);
    const replayed: string[] = [];
    const drop = setBufferTarget({
      ...fake(root, "normal"),
      element: () => "note-line",
      replay: (t) => replayed.push(...t),
    });
    /** A keydown aimed at the buffer's line. */
    const onLine = (k: string) => {
      const e = key({ key: k });
      Object.defineProperty(e, "target", { value: line });
      return e;
    };
    const g2 = onLine("g");
    const s = onLine("s");
    keys.handle(g2);
    keys.handle(s);
    expect(replayed).toEqual(["g"]);
    expect(s.defaultPrevented).toBe(false);
    drop();
    keys.stop();
  });

  it("drops a pending key on any pointer press, even one an element stops, until stopped", () => {
    const keys = startKeys({ mac: false, host: document.body });
    const child = document.createElement("div");
    document.body.append(child);
    child.addEventListener("pointerdown", (e) => e.stopPropagation());
    keys.engine.feed("<Space>", "page", "normal");
    child.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(keys.engine.pending()).toEqual([]);
    keys.stop();
    keys.engine.feed("<Space>", "page", "normal");
    child.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(keys.engine.pending()).toEqual(["<Space>"]);
  });
});

describe("the buffer side at its edges", () => {
  it("reads a fence of more colons and no space", () => {
    const doc = EditorState.create({ doc: "::::{.gloss #g}\ntext\n::::" }).doc;
    expect(lineElement(doc, 2)).toBe("gloss");
  });

  it("copes with an editor that has no Vim", () => {
    const view = new EditorView({ state: EditorState.create({ doc: "x" }), parent: document.body });
    const t = bufferTarget(view, view.dom);
    expect(t.mode()).toBe("normal");
    expect(() => t.replay(["j"])).not.toThrow();
    view.destroy();
  });
});
