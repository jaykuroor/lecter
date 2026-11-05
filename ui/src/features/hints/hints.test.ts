import { describe, expect, it } from "vitest";
import { compileKeymap } from "../../keys/engine";
import { type Binding, DEFAULT_KEYMAP } from "../../keys/keymap";
import { mergeKeymap, parseUserKeymap } from "../../keys/user";
import { type Hint, hintsFor } from "./hints";

// 09-ui.md#hint-bar-and-keystroke-overlay: the hint bar lists the keys that work now, for the
// cursor's element and the mode, from the key engine's own keymap (10-keymap.md, D-199 overrides).

const defaults = compileKeymap(DEFAULT_KEYMAP, false);
const mac = compileKeymap(DEFAULT_KEYMAP, true);

/** A hint as it reads on the bar: its keycaps, then its words. */
const read = (h: Hint) => `${h.keys.join(" ")} ${h.desc}`;

/** A binding in `line` named by its command, as keymaps.jsonc's are, unless `extra` says otherwise. */
const B = (keys: string, command: string, extra: Partial<Binding> = {}): Binding => ({
  keys,
  command,
  scope: "line",
  desc: command,
  ...extra,
});

/** The defaults with keymaps.jsonc's `bindings` laid over them. */
function withUser(bindings: unknown[]) {
  const user = parseUserKeymap(JSON.stringify({ version: 1, bindings }), false);
  expect(user.warnings).toEqual([]);
  return compileKeymap(mergeKeymap(DEFAULT_KEYMAP, user.bindings, false).bindings, false);
}

// The keys every element shows at the right end, the ways on to every other key: F6 (D-200)
// and the leader; and the other global keys, which end the element's list.
const TAIL = ["F6 Next pane", "␣ More"];
const GLOBAL = ["Ctrl-1…9 Course", "Shift-F6 Previous pane"];

describe("hintsFor", () => {
  it("lists a slide line's keys (10-keymap.md#on-a-slide-line), then the moves, in the keymap's order", () => {
    const hints = hintsFor(defaults, "slide-line", "normal");
    expect(hints.main.map(read)).toEqual([
      "↵ Ask about this line",
      "s Steps",
      "q Park a doubt",
      "t Define terms",
      "' Worked example",
      "= Plot",
      "Tab Write for me",
      "m Flag line",
      "M Flag slide",
      ". Repeat the last action",
      "o Own note below",
      "O Own note above",
      "gd Go to this idea in your sources",
      "gx Compare parse with original",
      "i Edit / fix the line",
      "Ctrl-j ]] Next slide",
      "Ctrl-k [[ Previous slide",
      "]g Next gloss",
      "[g Previous gloss",
      "]f Next flag",
      "[f Previous flag",
      "]d Next doubt",
      "[d Previous doubt",
      "]b Next build step",
      "[b Previous build step",
      ...GLOBAL,
    ]);
    expect(hints.tail.map(read)).toEqual(TAIL);
  });

  it("lists a gloss's own keys there (10-keymap.md#on-a-gloss), and none of a line's", () => {
    const main = hintsFor(defaults, "gloss", "normal").main.map(read);
    expect(main.slice(0, 6)).toEqual([
      "↵ Reply in thread (keep a draft)",
      "r Regenerate",
      "- Less detail",
      "= More detail",
      "< Older variant",
      "> Newer variant",
    ]);
    expect(main).toContain("zg Rate good");
    expect(main).toContain("Esc Stop a streaming answer");
    expect(main).toContain("]g Next gloss");
    expect(main).not.toContain("s Steps");
    expect(main).not.toContain("= Plot");
    expect(main).not.toContain("↵ Ask about this line");
  });

  it("shows an own-note line the same keys as a slide line", () => {
    expect(hintsFor(defaults, "note-line", "normal")).toEqual(hintsFor(defaults, "slide-line", "normal"));
  });

  it("follows the mode: in visual mode only the keys that work on a selection, in insert mode only the global ones", () => {
    const visual = hintsFor(defaults, "slide-line", "visual");
    expect(visual.main.map(read)).toEqual(["↵ Ask about this line", ...GLOBAL]);
    expect(visual.tail.map(read)).toEqual(TAIL);
    const insert = hintsFor(defaults, "slide-line", "insert");
    expect(insert.main.map(read)).toEqual(GLOBAL);
    expect(insert.tail.map(read)).toEqual(["F6 Next pane"]);
  });

  it("shows only the global keys in a field and on a control, and the leader too elsewhere on the page", () => {
    for (const el of ["field", "control"] as const) {
      const hints = hintsFor(defaults, el, "normal");
      expect(hints.main.map(read)).toEqual(GLOBAL);
      expect(hints.tail.map(read)).toEqual(["F6 Next pane"]);
    }
    const page = hintsFor(defaults, "page", "normal");
    expect(page.main.map(read)).toEqual(GLOBAL);
    expect(page.tail.map(read)).toEqual(TAIL);
  });

  it("gives each hint the binding a click runs, and none to the leader's, which opens which-key", () => {
    const hints = hintsFor(defaults, "slide-line", "normal");
    const steps = hints.main.find((h) => h.desc === "Steps");
    expect(steps?.binding).toMatchObject({ keys: "s", command: "ai.steps", scope: "line" });
    const course = hints.main.at(-2);
    expect(course?.binding).toMatchObject({ command: "course.go", arg: 0 });
    expect(hints.tail[0]?.binding).toMatchObject({ keys: "<F6>", command: "focus.next" });
    const more = hints.tail[1];
    expect(more?.binding).toBeNull();
    expect(more?.prefix).toEqual(["<Space>"]);
    expect(steps?.prefix).toEqual([]);
  });

  it("names Cmd on macOS", () => {
    const main = hintsFor(mac, "slide-line", "normal").main.map(read);
    expect(main.slice(-2)).toEqual(["⌘1…9 Course", "⇧F6 Previous pane"]);
  });

  it("takes keymaps.jsonc's bindings: a rebound key, an unbound one and a new one", () => {
    const map = withUser([
      { keys: "s", command: null, context: "line" },
      { keys: "x", command: "ai.steps", context: "line" },
      { keys: "<F6>", command: null },
      { keys: "<F7>", command: "focus.next" },
      { keys: "<Mod-5>", command: null },
    ]);
    const hints = hintsFor(map, "slide-line", "normal");
    const main = hints.main.map(read);
    // A user binding reads as the default it replaces did, in the default's place.
    expect(main[1]).toBe("x Steps");
    expect(main).not.toContain("s Steps");
    expect(main.slice(-2)).toEqual(["Ctrl-1…4 Ctrl-6…9 Course", "Shift-F6 Previous pane"]);
    expect(hints.tail.map(read)).toEqual(["F7 Next pane", "␣ More"]);
  });

  it("drops a binding another one shadows where the cursor is, and one for another mode", () => {
    const map = withUser([
      { keys: "r", command: "ai.steps", context: "buffer" },
      { keys: "w", command: "ai.define", context: "line", modes: ["visual"] },
    ]);
    // On a gloss its own `r` wins over the buffer's; on a line the buffer's `r` is the one.
    expect(hintsFor(map, "gloss", "normal").main.map(read)).toContain("r Regenerate");
    expect(hintsFor(map, "gloss", "normal").main.map(read)).not.toContain("r Steps");
    expect(hintsFor(map, "slide-line", "normal").main.map(read)).toContain("s r Steps");
    expect(hintsFor(map, "slide-line", "normal").main.map(read)).toContain("t Define terms");
    expect(hintsFor(map, "slide-line", "visual").main.map(read)).toEqual([
      "↵ Ask about this line",
      "w Define terms",
      ...GLOBAL,
    ]);
  });

  it("names a command no default has by its id, keeps a single numbered key whole, and leaves out keys that don't parse", () => {
    const map = compileKeymap(
      [
        B("<Mod-3>", "course.go", { scope: "global", desc: "Course 3", arg: 2 }),
        B("<Mod-1>", "course.go", { scope: "global", desc: "Course 1", arg: 0 }),
        // The buffer's binding of a command comes after the line's, wherever it is in the map.
        B("y", "made.up", { scope: "buffer" }),
        B("z1", "made.up"),
        B("<Nope>", "ai.steps", { desc: "Steps" }),
        B("z2", "ai.steps", { desc: "My steps" }),
        B("z3", "lecture.two", { desc: "Lecture 2" }),
        B("<leader>x", "+lists", { scope: "app", desc: "Lists" }),
      ],
      false,
    );
    const hints = hintsFor(map, "slide-line", "normal");
    // A default's command keeps the default's place, before ones the defaults don't have; a
    // binding's own words win; a number ends the words of a key that isn't one of a family.
    // Two numbers apart are two keycaps, lowest first; the leader has only a group, so no "more".
    expect(hints.main.map(read)).toEqual(["z2 My steps", "z1 y made.up", "z3 Lecture 2", "Ctrl-1 Ctrl-3 Course"]);
    expect(hints.tail).toEqual([]);
  });

  it("names a numbered family once, dropping only the number at the end", () => {
    const map = compileKeymap(
      [
        B("<F1>", "room.go", { scope: "global", desc: "Room 2 slot11", arg: 0 }),
        B("<F2>", "room.go", { scope: "global", desc: "Room 2 slot12", arg: 1 }),
        B("<F12>", "room.go", { scope: "global", desc: "Room 2 slot22", arg: 11 }),
        B("<F11>", "room.go", { scope: "global", desc: "Room 2 slot21", arg: 10 }),
        B("<F10>", "room.go", { scope: "global", desc: "Room 2 slot20", arg: 9 }),
        B("<F3>", "pane.go", { scope: "global", desc: "Pane11", arg: 0 }),
        B("<S-F1>", "zoom.go", { scope: "global", desc: "Zoom 1", arg: 0 }),
        B("<S-F12>", "zoom.go", { scope: "global", desc: "Zoom 2", arg: 1 }),
        B("<A-a>", "tab.go", { scope: "global", desc: "Tab 1", arg: 0 }),
        B("<A-b>", "tab.go", { scope: "global", desc: "Tab 2", arg: 1 }),
      ],
      false,
    );
    // F10…F12 share "F1", and Shift-F1 is all of Shift-F12's start, but a number is never split.
    expect(hintsFor(map, "page", "normal").main.map(read)).toEqual([
      "F1…2 F10…12 Room 2 slot",
      "F3 Pane",
      "Shift-F1…12 Zoom",
      "Alt-a…b Tab",
    ]);
  });

  it("joins two numbered keys in a row into one range", () => {
    const map = compileKeymap(
      DEFAULT_KEYMAP.filter((b) => b.command !== "course.go" || (b.arg as number) < 2),
      false,
    );
    expect(hintsFor(map, "page", "normal").main.map(read)[0]).toBe("Ctrl-1…2 Course");
  });
});
