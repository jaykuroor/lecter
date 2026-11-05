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

/** The defaults with keymaps.jsonc's `bindings` laid over them. */
function withUser(bindings: unknown[]) {
  const user = parseUserKeymap(JSON.stringify({ version: 1, bindings }), false);
  expect(user.warnings).toEqual([]);
  return compileKeymap(mergeKeymap(DEFAULT_KEYMAP, user.bindings, false).bindings, false);
}

// The keys every element shows at the right end: Ctrl-1…9, F6 (D-200) and the leader.
const TAIL = ["Ctrl-1…9 Course", "F6 Next pane", "Shift-F6 Previous pane", "␣ More"];

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
    expect(visual.main.map(read)).toEqual(["↵ Ask about this line"]);
    expect(visual.tail.map(read)).toEqual(TAIL);
    const insert = hintsFor(defaults, "slide-line", "insert");
    expect(insert.main).toEqual([]);
    expect(insert.tail.map(read)).toEqual(TAIL.slice(0, 3));
  });

  it("shows only the global keys in a field and on a control, and the leader too elsewhere on the page", () => {
    for (const el of ["field", "control"] as const) {
      const hints = hintsFor(defaults, el, "normal");
      expect(hints.main).toEqual([]);
      expect(hints.tail.map(read)).toEqual(TAIL.slice(0, 3));
    }
    const page = hintsFor(defaults, "page", "normal");
    expect(page.main).toEqual([]);
    expect(page.tail.map(read)).toEqual(TAIL);
  });

  it("gives each hint the binding a click runs, and none to the leader's, which opens which-key", () => {
    const hints = hintsFor(defaults, "slide-line", "normal");
    const steps = hints.main.find((h) => h.desc === "Steps");
    expect(steps?.binding).toMatchObject({ keys: "s", command: "ai.steps", scope: "line" });
    const course = hints.tail[0];
    expect(course?.binding).toMatchObject({ command: "course.go", arg: 0 });
    const more = hints.tail[3];
    expect(more?.binding).toBeNull();
    expect(more?.prefix).toEqual(["<Space>"]);
    expect(steps?.prefix).toEqual([]);
  });

  it("names Cmd on macOS", () => {
    const tail = hintsFor(mac, "slide-line", "normal").tail.map(read);
    expect(tail[0]).toBe("⌘1…9 Course");
    expect(tail[2]).toBe("⇧F6 Previous pane");
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
    expect(hints.tail.map(read)).toEqual([
      "Ctrl-1…4 Ctrl-6…9 Course",
      "F7 Next pane",
      "Shift-F6 Previous pane",
      "␣ More",
    ]);
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
    expect(hintsFor(map, "slide-line", "visual").main.map(read)).toEqual(["↵ Ask about this line", "w Define terms"]);
  });

  it("names a command no default has by its id, keeps a single numbered key whole, and leaves out keys that don't parse", () => {
    const B = (keys: string, command: string, extra: Partial<Binding> = {}): Binding => ({
      keys,
      command,
      scope: "line",
      desc: command,
      ...extra,
    });
    const map = compileKeymap(
      [
        B("<Mod-3>", "course.go", { scope: "global", desc: "Course 3", arg: 2 }),
        B("<Mod-1>", "course.go", { scope: "global", desc: "Course 1", arg: 0 }),
        B("z1", "made.up"),
        B("<Nope>", "ai.steps", { desc: "Steps" }),
        B("<leader>x", "+lists", { scope: "app", desc: "Lists" }),
      ],
      false,
    );
    const hints = hintsFor(map, "slide-line", "normal");
    expect(hints.main.map(read)).toEqual(["z1 made.up"]);
    // Two numbers apart are two keycaps, lowest first; the leader has only a group, so no "more".
    expect(hints.tail.map(read)).toEqual(["Ctrl-1 Ctrl-3 Course"]);
  });

  it("joins two numbered keys in a row into one range", () => {
    const map = compileKeymap(
      DEFAULT_KEYMAP.filter((b) => b.command !== "course.go" || (b.arg as number) < 2),
      false,
    );
    expect(hintsFor(map, "page", "normal").tail.map(read)[0]).toBe("Ctrl-1…2 Course");
  });
});
