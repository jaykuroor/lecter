import { describe, expect, it } from "vitest";
import { compileKeymap, resolve } from "./engine";
import { type Binding, DEFAULT_KEYMAP } from "./keymap";
import { mergeKeymap, parseUserKeymap, prefixClashes, stripJsonc } from "./user";

const file = (bindings: unknown[]) => JSON.stringify({ version: 1, bindings });

describe("stripJsonc", () => {
  it("drops comments and trailing commas but never inside strings", () => {
    const text = `{
      // a comment
      "a": "x // not a comment", /* block
      comment */ "b": [1, 2,],
      "c": "say \\"/*\\"",
    }`;
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: "x // not a comment", b: [1, 2], c: 'say "/*"' });
  });

  it("copes with a comment or a string left open at the end", () => {
    expect(stripJsonc('{"a": 1} /* open')).toBe('{"a": 1} ');
    expect(stripJsonc('{"a": 1} // end')).toBe('{"a": 1} ');
    expect(stripJsonc('"open')).toBe('"open');
  });
});

describe("parseUserKeymap", () => {
  it("reads bindings, unbindings, contexts and modes", () => {
    const text = `{
      "version": 1,
      // My keys
      "bindings": [
        { "keys": "<leader>t", "command": "sidebar.toggle", "context": "app" },
        { "keys": "gd", "command": null, "context": "line" },
        { "keys": "<C-l>", "command": "slide.next", "modes": ["normal", "insert"] },
      ],
    }`;
    expect(parseUserKeymap(text, false)).toEqual({
      bindings: [
        { keys: "<leader>t", command: "sidebar.toggle", context: "app" },
        { keys: "gd", command: null, context: "line" },
        { keys: "<C-l>", command: "slide.next", context: "global", modes: ["normal", "insert"] },
      ],
      warnings: [],
    });
  });

  it("refuses a whole file that is too large, not JSONC, or of another shape", () => {
    const big = " ".repeat(256 * 1024 + 1);
    expect(parseUserKeymap(big, false)).toEqual({
      bindings: [],
      warnings: ["keymaps.jsonc is larger than 262144 bytes; not read"],
    });
    expect(parseUserKeymap(`${file([])}${" ".repeat(256 * 1024 - file([]).length)}`, false).warnings).toEqual([]);
    expect(parseUserKeymap("{ nope", false).warnings).toEqual(["keymaps.jsonc is not valid JSONC; not read"]);
    const shape = ['keymaps.jsonc needs "version": 1 and a "bindings" list; not read'];
    expect(parseUserKeymap("[]", false).warnings).toEqual(shape);
    expect(parseUserKeymap("null", false).warnings).toEqual(shape);
    expect(parseUserKeymap('"text"', false).warnings).toEqual(shape);
    expect(parseUserKeymap('{"version": 2, "bindings": []}', false).warnings).toEqual(shape);
    expect(parseUserKeymap('{"version": 1, "bindings": {}}', false).warnings).toEqual(shape);
  });

  it("skips each bad entry with a warning naming it, and keeps the good ones", () => {
    const { bindings, warnings } = parseUserKeymap(
      file([
        "x",
        null,
        { command: "a" },
        { keys: "<Bogus>", command: "a" },
        { keys: "", command: "a" },
        { keys: "x", command: 3 },
        { keys: "x", command: "" },
        { keys: "x", command: "+group" },
        { keys: "x" },
        { keys: "x", command: "slide.next", context: "nowhere" },
        { keys: "x", command: "slide.next", modes: [] },
        { keys: "x", command: "slide.next", modes: ["normal", "command"] },
        { keys: "x", command: "slide.next", modes: "normal" },
        { keys: "x", command: "no.such.command" },
        { keys: "y", command: "gloss.more", context: "gloss", modes: ["visual"] },
      ]),
      false,
    );
    expect(bindings).toEqual([{ keys: "y", command: "gloss.more", context: "gloss", modes: ["visual"] }]);
    expect(warnings).toEqual([
      "keymaps.jsonc binding 1: not an object; ignored",
      "keymaps.jsonc binding 2: not an object; ignored",
      'keymaps.jsonc binding 3: "keys" must be a string; ignored',
      'keymaps.jsonc binding 4: "keys" "<Bogus>": unknown key name <Bogus>; ignored',
      'keymaps.jsonc binding 5: "keys" "": empty keys; ignored',
      'keymaps.jsonc binding 6: "command" must be a command id or null; ignored',
      'keymaps.jsonc binding 7: "command" must be a command id or null; ignored',
      'keymaps.jsonc binding 8: "command" must be a command id or null; ignored',
      'keymaps.jsonc binding 9: "command" must be a command id or null; ignored',
      'keymaps.jsonc binding 10: unknown "context" "nowhere"; ignored',
      'keymaps.jsonc binding 11: "modes" must list normal, visual or insert; ignored',
      'keymaps.jsonc binding 12: "modes" must list normal, visual or insert; ignored',
      'keymaps.jsonc binding 13: "modes" must list normal, visual or insert; ignored',
      'keymaps.jsonc binding 14: unknown command "no.such.command"; ignored',
    ]);
  });

  it("reads at most 2000 bindings", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      keys: "x",
      command: i < 2000 ? "slide.next" : "slide.prev",
    }));
    const { bindings, warnings } = parseUserKeymap(file(many), false);
    expect(bindings).toHaveLength(2000);
    expect(bindings.filter((b) => b.command === "slide.prev")).toEqual([]);
    expect(warnings).toEqual(["keymaps.jsonc has more than 2000 bindings; the rest are ignored"]);
    expect(parseUserKeymap(file(many.slice(0, 2000)), false).warnings).toEqual([]);
  });
});

const B = (keys: string, command: string, scope: Binding["scope"]): Binding => ({
  keys,
  command,
  scope,
  desc: command,
});

describe("mergeKeymap", () => {
  it("loads the defaults, then the user's bindings on top", () => {
    const user = parseUserKeymap(
      file([
        { keys: "<leader>e", command: "panel.toggle", context: "app" },
        { keys: "gd", command: null, context: "line" },
        { keys: "<C-l>", command: "slide.next", context: "buffer" },
      ]),
      false,
    ).bindings;
    const { bindings, warnings } = mergeKeymap(DEFAULT_KEYMAP, user, false);
    expect(warnings).toEqual([]);
    const map = compileKeymap(bindings, false);
    // A rebind replaces the default with the same keys in that context.
    expect(resolve(map, "page", "normal", ["<Space>", "e"])?.command).toBe("panel.toggle");
    expect(bindings.filter((b) => b.keys === "<leader>e")).toHaveLength(1);
    // null removes the default; a new key works.
    expect(resolve(map, "slide-line", "normal", ["g", "d"])).toBeNull();
    expect(resolve(map, "slide-line", "normal", ["<C-l>"])?.command).toBe("slide.next");
    // The rest of the defaults stay.
    expect(resolve(map, "slide-line", "normal", ["s"])?.command).toBe("ai.steps");
    expect(bindings).toHaveLength(DEFAULT_KEYMAP.length + 1 - 1);
  });

  it("matches keys however they are written, and only in the same context", () => {
    const { bindings } = mergeKeymap(
      [B("<C-j>", "slide.next", "buffer"), B("<C-j>", "other", "line")],
      [{ keys: "<c-J>", command: "mine", context: "buffer" }],
      false,
    );
    expect(bindings.map((b) => `${b.scope} ${b.keys} ${b.command}`)).toEqual(["line <C-j> other", "buffer <c-J> mine"]);
  });

  it("keeps a user binding's modes and gives it its command as description", () => {
    const { bindings } = mergeKeymap([], [{ keys: "x", command: "a", context: "line", modes: ["visual"] }], false);
    expect(bindings).toEqual([{ keys: "x", command: "a", scope: "line", desc: "a", modes: ["visual"] }]);
  });

  it("never drops a leader group's name with a rebind of its key", () => {
    const { bindings } = mergeKeymap(DEFAULT_KEYMAP, [{ keys: "<leader>a", command: null, context: "app" }], false);
    expect(bindings.find((b) => b.keys === "<leader>a")?.command).toBe("+ai");
  });

  it("warns, listing both, when the user binds the same keys twice in one context", () => {
    const { bindings, warnings } = mergeKeymap(
      [],
      [
        { keys: "x", command: "first", context: "line" },
        { keys: "x", command: "second", context: "line" },
        { keys: "x", command: "elsewhere", context: "gloss" },
      ],
      false,
    );
    expect(warnings).toEqual(["Keys clash in line: x (first) and x (second)"]);
    expect(bindings.map((b) => b.command)).toEqual(["second", "elsewhere"]);
  });

  it("doesn't warn when the second one only removes the first", () => {
    const { bindings, warnings } = mergeKeymap(
      [],
      [
        { keys: "x", command: "first", context: "line" },
        { keys: "x", command: null, context: "line" },
        { keys: "x", command: "again", context: "line" },
      ],
      false,
    );
    expect(warnings).toEqual([]);
    expect(bindings.map((b) => b.command)).toEqual(["again"]);
  });

  it("warns, listing both, when one binding's keys start another's in one context", () => {
    const { warnings } = mergeKeymap(DEFAULT_KEYMAP, [{ keys: "g", command: "mine", context: "line" }], false);
    expect(warnings).toEqual([
      "Keys clash in line: g (mine) and gd (sources.goto)",
      "Keys clash in line: g (mine) and gx (parse.compare)",
    ]);
  });
});

describe("prefixClashes", () => {
  it("compares keys by token, within one scope only", () => {
    expect(prefixClashes([B("<C-j>", "a", "buffer"), B("<C-j>x", "b", "buffer")], false)).toEqual([
      "Keys clash in buffer: <C-j> (a) and <C-j>x (b)",
    ]);
    // `<C-j>` is one key: `<C` doesn't start it.
    expect(prefixClashes([B("<lt>", "a", "gloss"), B("<C-j>", "b", "gloss")], false)).toEqual([]);
    expect(prefixClashes([B("g", "a", "line"), B("gd", "b", "gloss")], false)).toEqual([]);
    expect(prefixClashes([B("gd", "a", "line"), B("gx", "b", "line")], false)).toEqual([]);
    expect(prefixClashes([B("<leader>a", "+ai", "app"), B("<leader>ag", "x", "app")], false)).toEqual([]);
  });
});
