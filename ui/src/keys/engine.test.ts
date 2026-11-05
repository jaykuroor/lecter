import { describe, expect, it } from "vitest";
import { choices, compileKeymap, inBuffer, KeyEngine, resolve, scopesFor, unhandled } from "./engine";
import type { Binding } from "./keymap";

// A small keymap of the shape 10-keymap.md uses, so each rule shows on its own.
const B = (keys: string, command: string, scope: Binding["scope"], extra: Partial<Binding> = {}): Binding => ({
  keys,
  command,
  scope,
  desc: command,
  ...extra,
});
const KEYMAP: Binding[] = [
  B("<Mod-1>", "course.go", "global", { arg: 0 }),
  B("<leader>a", "+ai", "app"),
  B("<leader>ag", "ai.gaps", "app"),
  B("<leader>e", "sidebar.toggle", "app"),
  B("<leader>qq", "app.quit", "app"),
  B("]]", "slide.next", "buffer"),
  B("<C-j>", "slide.next", "buffer"),
  B("s", "ai.steps", "line"),
  B("gd", "sources.goto", "line"),
  B("<CR>", "ai.ask", "line", { modes: ["normal", "visual"] }),
  B("r", "gloss.regenerate", "gloss"),
  B("zg", "gloss.rateGood", "gloss"),
  B("dd", "gloss.delete", "gloss"),
];
const map = compileKeymap(KEYMAP, false);

describe("scopesFor", () => {
  it("puts the element's own scope first, then the buffer's, the leader's and the global keys", () => {
    expect(scopesFor("slide-line", "normal")).toEqual(["line", "buffer", "app", "global"]);
    expect(scopesFor("note-line", "visual")).toEqual(["line", "buffer", "app", "global"]);
    expect(scopesFor("gloss", "normal")).toEqual(["gloss", "buffer", "app", "global"]);
    expect(scopesFor("page", "normal")).toEqual(["app", "global"]);
  });

  it("keeps only the global keys in insert mode, in fields and on controls", () => {
    expect(scopesFor("slide-line", "insert")).toEqual(["global"]);
    expect(scopesFor("field", "normal")).toEqual(["global"]);
    expect(scopesFor("control", "normal")).toEqual(["global"]);
  });

  it("knows which elements are the buffer's lines", () => {
    expect(["slide-line", "note-line", "gloss"].every((e) => inBuffer(e as never))).toBe(true);
    expect(["field", "control", "page"].some((e) => inBuffer(e as never))).toBe(false);
  });
});

describe("resolve", () => {
  it("depends on the focused element", () => {
    expect(resolve(map, "slide-line", "normal", ["s"])?.command).toBe("ai.steps");
    expect(resolve(map, "gloss", "normal", ["s"])).toBeNull();
    expect(resolve(map, "gloss", "normal", ["r"])?.command).toBe("gloss.regenerate");
    expect(resolve(map, "note-line", "normal", ["r"])).toBeNull();
    expect(resolve(map, "page", "normal", ["s"])).toBeNull();
    expect(resolve(map, "page", "normal", ["<Space>", "e"])?.command).toBe("sidebar.toggle");
    expect(resolve(map, "control", "normal", ["<Space>", "e"])).toBeNull();
  });

  it("depends on the mode", () => {
    expect(resolve(map, "slide-line", "visual", ["<CR>"])?.command).toBe("ai.ask");
    expect(resolve(map, "slide-line", "visual", ["s"])).toBeNull();
    expect(resolve(map, "slide-line", "insert", ["s"])).toBeNull();
    expect(resolve(map, "field", "insert", ["<C-1>"])?.command).toBe("course.go");
  });

  it("names nothing for a prefix or a group", () => {
    expect(resolve(map, "page", "normal", ["<Space>"])).toBeNull();
    expect(resolve(map, "page", "normal", ["<Space>", "a"])).toBeNull();
  });

  it("lets the most specific scope win a key", () => {
    const both = compileKeymap([B("x", "buffer.x", "buffer"), B("x", "line.x", "line")], false);
    expect(resolve(both, "slide-line", "normal", ["x"])?.command).toBe("line.x");
    expect(resolve(both, "gloss", "normal", ["x"])?.command).toBe("buffer.x");
  });

  it("leaves out a binding whose keys don't parse", () => {
    const bad = compileKeymap([B("<Bogus>", "x", "global"), B("y", "y", "global")], false);
    expect(resolve(bad, "page", "normal", ["y"])?.command).toBe("y");
    expect(choices(bad, "page", "normal", []).map((c) => c.key)).toEqual(["y"]);
  });
});

describe("choices", () => {
  it("lists what can follow the leader: bindings and groups, in keymap order", () => {
    const next = choices(map, "page", "normal", ["<Space>"]);
    expect(next.map((c) => [c.key, c.binding.command, c.group])).toEqual([
      ["a", "+ai", true],
      ["e", "sidebar.toggle", false],
    ]);
    expect(choices(map, "page", "normal", ["<Space>", "a"]).map((c) => c.binding.command)).toEqual(["ai.gaps"]);
  });

  it("lists a scope's keys only where that scope applies, the most specific first", () => {
    const keys = choices(map, "slide-line", "normal", []).map((c) => c.key);
    // Keys that only start a sequence (`g`, `]`, the leader) name nothing yet.
    expect(keys).toEqual(["s", "<CR>", "<C-j>", "<C-1>"]);
    expect(choices(map, "slide-line", "visual", []).map((c) => c.key)).toEqual(["<CR>", "<C-1>"]);
    const shadow = compileKeymap([B("x", "line.x", "line"), B("x", "app.x", "app")], false);
    expect(choices(shadow, "note-line", "normal", []).map((c) => c.binding.command)).toEqual(["line.x"]);
  });

  it("is empty after keys nothing starts with", () => {
    expect(choices(map, "page", "normal", ["q"])).toEqual([]);
  });
});

/** Feeds keys one by one, returning each outcome's kind (and the command for a run). */
function feed(
  engine: KeyEngine,
  el: Parameters<KeyEngine["feed"]>[1],
  mode: Parameters<KeyEngine["feed"]>[2],
  keys: string[],
) {
  return keys.map((k) => {
    const out = engine.feed(k, el, mode);
    return out.kind === "run" ? `run ${out.binding.command} ×${out.count}${out.explicit ? "!" : ""}` : out.kind;
  });
}

describe("KeyEngine", () => {
  it("runs a one-key binding at once and passes keys it doesn't know", () => {
    const e = new KeyEngine(map);
    expect(feed(e, "slide-line", "normal", ["s", "j", "<C-j>"])).toEqual([
      "run ai.steps ×1",
      "pass",
      "run slide.next ×1",
    ]);
  });

  it("waits through a sequence, then runs it", () => {
    const e = new KeyEngine(map);
    expect(feed(e, "page", "normal", ["<Space>", "e"])).toEqual(["pending", "run sidebar.toggle ×1"]);
    expect(feed(e, "page", "normal", ["<Space>", "q", "q"])).toEqual(["pending", "pending", "run app.quit ×1"]);
    expect(feed(e, "slide-line", "normal", ["]", "]"])).toEqual(["pending", "run slide.next ×1"]);
    expect(e.pending()).toEqual([]);
  });

  it("takes a count in the buffer and hands it to the binding", () => {
    const e = new KeyEngine(map);
    expect(feed(e, "slide-line", "normal", ["3", "]", "]"])).toEqual(["pending", "pending", "run slide.next ×3!"]);
    expect(feed(e, "note-line", "normal", ["1", "0", "s"])).toEqual(["pending", "pending", "run ai.steps ×10!"]);
    expect(feed(e, "gloss", "normal", ["2", "<C-j>"])).toEqual(["pending", "run slide.next ×2!"]);
    // A count before a key with no binding in this mode goes back to Vim.
    expect(feed(e, "gloss", "visual", ["2", "<C-j>"])).toEqual(["pending", "miss"]);
  });

  it("leaves 0 to Vim unless it goes on a count, and counts only in the buffer outside insert mode", () => {
    const e = new KeyEngine(map);
    expect(feed(e, "slide-line", "normal", ["0"])).toEqual(["pass"]);
    expect(feed(e, "page", "normal", ["3"])).toEqual(["pass"]);
    expect(feed(e, "slide-line", "insert", ["3"])).toEqual(["pass"]);
    // After the first key of a sequence a digit is a key, not a count.
    expect(feed(e, "slide-line", "normal", ["]", "3"])).toEqual(["pending", "miss"]);
  });

  it("hands back the count and keys it held when a sequence breaks off", () => {
    const e = new KeyEngine(map);
    e.feed("3", "slide-line", "normal");
    e.feed("g", "slide-line", "normal");
    expect(e.pending()).toEqual(["3", "g"]);
    expect(e.feed("g", "slide-line", "normal")).toEqual({ kind: "miss", replay: ["3", "g"], take: false });
    expect(e.feed("3", "slide-line", "normal")).toEqual({ kind: "pending" });
    expect(e.feed("j", "slide-line", "normal")).toEqual({ kind: "miss", replay: ["3"], take: false });
    expect(e.pending()).toEqual([]);
  });

  it("drops a letter that follows the leader without a binding, but lets other keys through", () => {
    const e = new KeyEngine(map);
    e.feed("<Space>", "page", "normal");
    expect(e.feed("x", "page", "normal")).toEqual({ kind: "miss", replay: [], take: true });
    e.feed("<Space>", "page", "normal");
    expect(e.feed("<Down>", "page", "normal")).toEqual({ kind: "miss", replay: [], take: false });
    e.feed("<Space>", "page", "normal");
    expect(e.feed("<C-e>", "page", "normal")).toEqual({ kind: "miss", replay: [], take: false });
    expect(e.pending()).toEqual([]);
  });

  it("cancels anything pending on Esc, and lets Esc through when nothing is", () => {
    const e = new KeyEngine(map);
    e.feed("<Space>", "page", "normal");
    expect(e.feed("<Esc>", "page", "normal")).toEqual({ kind: "miss", replay: [], take: true });
    e.feed("2", "slide-line", "normal");
    e.feed("]", "slide-line", "normal");
    expect(e.feed("<Esc>", "slide-line", "normal")).toEqual({ kind: "miss", replay: [], take: true });
    expect(e.pending()).toEqual([]);
    expect(e.feed("<Esc>", "slide-line", "normal")).toEqual({ kind: "pass" });
  });

  it("never starts a sequence from a held key, and repeats only the buffer's keys", () => {
    const e = new KeyEngine(map);
    expect(e.feed("<Space>", "page", "normal", true)).toEqual({ kind: "pass" });
    expect(e.pending()).toEqual([]);
    expect(e.feed("<C-1>", "page", "normal", true)).toEqual({ kind: "pass" });
    expect(e.feed("j", "slide-line", "normal", true)).toEqual({ kind: "pass" });
    expect(e.feed("3", "slide-line", "normal", true)).toEqual({ kind: "pass" });
    expect(e.feed("<C-j>", "slide-line", "normal", true).kind).toBe("run");
    expect(e.feed("s", "note-line", "normal", true).kind).toBe("run");
    // Held while a sequence waits, a key still goes on with it.
    e.feed("<Space>", "page", "normal");
    expect(e.feed("e", "page", "normal", true).kind).toBe("run");
  });

  it("reports the keys of a run, count first", () => {
    const e = new KeyEngine(map);
    e.feed("2", "gloss", "normal");
    e.feed("d", "gloss", "normal");
    expect(e.feed("d", "gloss", "normal")).toMatchObject({ kind: "run", keys: ["2", "d", "d"], count: 2 });
  });

  it("tells a listener whenever the pending keys change", () => {
    const e = new KeyEngine(map);
    const seen: string[][] = [];
    e.onChange = (p) => seen.push([...p]);
    feed(e, "slide-line", "normal", ["2", "<Space>", "q", "x"]);
    e.reset();
    feed(e, "slide-line", "normal", ["s"]);
    expect(seen).toEqual([["2"], ["2", "<Space>"], ["2", "<Space>", "q"], [], []]);
  });

  it("continues from a prefix set from outside (which-key's mouse path)", () => {
    const e = new KeyEngine(map);
    const seen: string[][] = [];
    e.onChange = (p) => seen.push([...p]);
    e.feed("<Space>", "page", "normal");
    e.setPrefix(["<Space>", "a"]);
    expect(e.sequence()).toEqual(["<Space>", "a"]);
    expect(seen.at(-1)).toEqual(["<Space>", "a"]);
    expect(e.feed("g", "page", "normal")).toMatchObject({ kind: "run", binding: { command: "ai.gaps" } });
  });
});

describe("unhandled", () => {
  it("lets a key whose command nobody runs go on, its count and keys handed back first", () => {
    expect(unhandled({ keys: ["d", "d"] })).toEqual({ kind: "miss", replay: ["d"], take: false });
    expect(unhandled({ keys: ["3", "s"] })).toEqual({ kind: "miss", replay: ["3"], take: false });
    expect(unhandled({ keys: ["<C-1>"] })).toEqual({ kind: "miss", replay: [], take: false });
  });

  it("drops a letter after the leader, even with a count, and lets a named key through", () => {
    expect(unhandled({ keys: ["<Space>", "e"] })).toEqual({ kind: "miss", replay: [], take: true });
    expect(unhandled({ keys: ["2", "<Space>", "a", "g"] })).toEqual({ kind: "miss", replay: [], take: true });
    expect(unhandled({ keys: ["<Space>", "<Tab>"] })).toEqual({ kind: "miss", replay: [], take: false });
  });
});
