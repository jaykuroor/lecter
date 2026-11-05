import { describe, expect, it } from "vitest";
import { choices, compileKeymap, resolve } from "./engine";
import { bindingModes, DEFAULT_KEYMAP, VIM_GIVEN_UP, VIM_KEPT } from "./keymap";
import { parseKeys } from "./notation";
import { prefixClashes } from "./user";

const map = compileKeymap(DEFAULT_KEYMAP, false);
const run = (el: Parameters<typeof resolve>[1], mode: Parameters<typeof resolve>[2], keys: string) =>
  resolve(map, el, mode, parseKeys(keys, false))?.command ?? null;

// 10-keymap.md#vim-subset-kept, word for word.
const SPEC_KEPT =
  "h j k l w b e 0 ^ $ gg G Ctrl-d Ctrl-u f ; , / ? n N * i a I A o O x d c y p P r u Ctrl-r v V . J >> << Esc zz zt zb za zM zR";
const SPEC_GIVEN_UP = ["s", "S", "q", "t", "T", "m", "'", "`", "=", "Tab", "Enter", "R", "H", "M", "L", "#"];
const vimName = (k: string) =>
  k
    .replace(/^Ctrl-(.)$/, "<C-$1>")
    .replace(/^(Esc|Tab)$/, "<$1>")
    .replace("Enter", "<CR>");

describe("the default keymap", () => {
  it("keeps exactly the Vim subset 10-keymap.md lists", () => {
    expect([...VIM_KEPT].sort()).toEqual(SPEC_KEPT.split(" ").map(vimName).sort());
  });

  it("lists the given-up Vim keys of 10-keymap.md, none of them kept", () => {
    expect([...VIM_GIVEN_UP].sort()).toEqual(SPEC_GIVEN_UP.map(vimName).sort());
    expect(VIM_GIVEN_UP.filter((k) => VIM_KEPT.includes(k))).toEqual([]);
  });

  it("binds the given-up keys to their Lecter meaning on a slide line (Vim drops its own: vim.test.ts)", () => {
    // The ones 10-keymap.md#on-a-slide-line gives a Lecter meaning, on a slide line.
    expect(["s", "q", "t", "'", "=", "<Tab>", "m", "M", "<CR>"].map((k) => run("slide-line", "normal", k))).toEqual([
      "ai.steps",
      "ai.doubt",
      "ai.define",
      "ai.example",
      "ai.plot",
      "ai.write",
      "flag.line",
      "flag.slide",
      "ai.ask",
    ]);
  });

  it("has keys that all parse, and no two that clash in one scope", () => {
    for (const b of DEFAULT_KEYMAP) {
      expect(() => parseKeys(b.keys, false), b.keys).not.toThrow();
      expect(() => parseKeys(b.keys, true), b.keys).not.toThrow();
    }
    expect(prefixClashes(DEFAULT_KEYMAP, false)).toEqual([]);
    expect(prefixClashes(DEFAULT_KEYMAP, true)).toEqual([]);
  });

  it("gives every binding a description", () => {
    expect(DEFAULT_KEYMAP.filter((b) => b.desc.trim() === "")).toEqual([]);
  });
});

describe("slide lines and own-note lines (10-keymap.md#on-a-slide-line)", () => {
  // Key → command, as 10-keymap.md's table has them (v1 keys left out).
  const TABLE: [string, string][] = [
    ["<CR>", "ai.ask"],
    ["s", "ai.steps"],
    ["q", "ai.doubt"],
    ["t", "ai.define"],
    ["'", "ai.example"],
    ["=", "ai.plot"],
    ["<Tab>", "ai.write"],
    ["m", "flag.line"],
    ["M", "flag.slide"],
    [".", "repeat"],
    ["o", "note.below"],
    ["O", "note.above"],
    ["gd", "sources.goto"],
    ["gx", "parse.compare"],
    ["i", "line.edit"],
  ];

  it("resolves each key to the same command on both", () => {
    for (const [key, command] of TABLE) {
      expect(run("slide-line", "normal", key), key).toBe(command);
      expect(run("note-line", "normal", key), key).toBe(command);
    }
  });

  it("asks about a selection with Enter in visual mode, on both", () => {
    expect(run("slide-line", "visual", "<CR>")).toBe("ai.ask");
    expect(run("note-line", "visual", "<CR>")).toBe("ai.ask");
  });

  it("leaves every one of them to type text in insert mode", () => {
    for (const [key] of TABLE) {
      expect(run("slide-line", "insert", key), key).toBeNull();
      expect(run("note-line", "insert", key), key).toBeNull();
    }
  });

  it("means something else on a gloss", () => {
    expect(run("gloss", "normal", "<CR>")).toBe("gloss.reply");
    expect(run("gloss", "normal", "=")).toBe("gloss.more");
    expect(run("gloss", "normal", "s")).toBeNull();
    expect(run("gloss", "normal", "<lt>")).toBe("gloss.older");
  });
});

describe("the leader (10-keymap.md#leader-groups)", () => {
  it("offers all the groups and the single leader keys", () => {
    const top = choices(map, "page", "normal", ["<Space>"]);
    expect(top.filter((c) => c.group).map((c) => `${c.key} ${c.binding.desc}`)).toEqual([
      "a AI",
      "s Search",
      "x Lists",
      "f Files",
      "u UI",
      "q Quit",
    ]);
    expect(top.filter((c) => !c.group).map((c) => `${c.key} ${c.binding.command}`)).toEqual([
      "e sidebar.toggle",
      "r panel.toggle",
      "<Space> lecture.find",
      ", buffer.switch",
      "? keys.help",
    ]);
  });

  it("holds each group's keys", () => {
    const group = (g: string) =>
      choices(map, "page", "normal", ["<Space>", g])
        .map((c) => c.key)
        .join(" ");
    expect(group("a")).toBe("g m f c");
    expect(group("s")).toBe("g s n w");
    expect(group("x")).toBe("x f l o r");
    expect(group("f")).toBe("f r n s R");
    expect(group("u")).toBe("C b r k h");
    expect(group("q")).toBe("q");
  });

  it("works in normal and visual mode", () => {
    expect(bindingModes(DEFAULT_KEYMAP.find((b) => b.command === "sidebar.toggle") as never)).toEqual([
      "normal",
      "visual",
    ]);
    expect(run("slide-line", "visual", "<leader>e")).toBe("sidebar.toggle");
    expect(run("slide-line", "insert", "<leader>e")).toBeNull();
  });
});

describe("Ctrl/Cmd-1…9 (10-keymap.md#global-os-conventions)", () => {
  it("open the first to ninth course, in every mode and element", () => {
    for (let n = 1; n <= 9; n++) {
      const b = resolve(map, "field", "insert", [`<C-${n}>`]);
      expect(b?.command).toBe("course.go");
      expect(b?.arg).toBe(n - 1);
    }
    expect(resolve(map, "control", "normal", ["<C-0>"])).toBeNull();
    expect(resolve(compileKeymap(DEFAULT_KEYMAP, true), "page", "normal", ["<D-3>"])?.arg).toBe(2);
    expect(resolve(compileKeymap(DEFAULT_KEYMAP, true), "page", "normal", ["<C-3>"])).toBeNull();
  });

  it("apply in every mode by default, as global keys", () => {
    const course = DEFAULT_KEYMAP.find((b) => b.command === "course.go");
    expect(course && bindingModes(course)).toEqual(["normal", "visual", "insert"]);
    const line = DEFAULT_KEYMAP.find((b) => b.command === "ai.steps");
    expect(line && bindingModes(line)).toEqual(["normal"]);
  });
});
