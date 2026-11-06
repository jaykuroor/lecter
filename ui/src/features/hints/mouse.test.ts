import { describe, expect, it } from "vitest";
import { compileKeymap } from "../../keys/engine";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { hintsFor } from "./hints";
import { mouseAction } from "./mouse";

// 09-ui.md#hint-bar-and-keystroke-overlay: the full hint bar shows the mouse action next to each
// key. The mouse paths are 09-ui.md's: right-click any element for its menu, a gloss's keycap
// buttons, double-click to edit, the sidebar's Flags list and the right panel's Doubts tab, the course rail.

const map = compileKeymap(DEFAULT_KEYMAP, false);

/** Each hint where the cursor is, as `words: mouse action`. */
const actions = (el: "slide-line" | "gloss" | "page") => {
  const hints = hintsFor(map, el, "normal");
  return [...hints.main, ...hints.tail].map((h) => `${h.desc}: ${mouseAction(h)}`);
};

describe("mouseAction", () => {
  it("gives a slide line's keys its menu, and editing a double-click", () => {
    const line = actions("slide-line");
    expect(line.slice(0, 3)).toEqual([
      "Ask about this line: right-click the line",
      "Steps: right-click the line",
      "Park a doubt: right-click the line",
    ]);
    expect(line).toContain("Edit / fix the line: double-click");
  });

  it("gives a gloss's keys its keycap buttons, and editing a double-click", () => {
    const gloss = actions("gloss");
    expect(gloss.slice(0, 2)).toEqual([
      "Reply in thread (keep a draft): click its keycap",
      "Regenerate: click its keycap",
    ]);
    expect(gloss).toContain("Edit the gloss: double-click");
  });

  it("gives the moves scrolling, the sidebar's Flags and the right panel's Doubts", () => {
    const moves = actions("slide-line").filter((a) => /^(Next|Previous) /.test(a));
    expect(moves).toEqual([
      "Next slide: scroll",
      "Previous slide: scroll",
      "Next gloss: scroll",
      "Previous gloss: scroll",
      "Next flag: the Flags list",
      "Previous flag: the Flags list",
      "Next doubt: Doubts tab",
      "Previous doubt: Doubts tab",
      "Next build step: scroll",
      "Previous build step: scroll",
      "Previous pane: click a pane",
      "Next pane: click a pane",
    ]);
  });

  it("gives the global keys the rail and the panes, and ␣ More a click on it", () => {
    expect(actions("page")).toEqual([
      "Course: click the course",
      "Previous pane: click a pane",
      "Command palette: click here",
      "Quick switcher: click here",
      "Settings: click here",
      "Next pane: click a pane",
      "More: click here",
    ]);
  });

  it("falls back to the scope's way for a command with none of its own", () => {
    const hint = { keys: ["x"], desc: "x", prefix: [], binding: null, family: false };
    expect(mouseAction({ ...hint, scope: "line" })).toBe("right-click the line");
    expect(mouseAction({ ...hint, scope: "gloss" })).toBe("click its keycap");
    expect(mouseAction({ ...hint, scope: "buffer" })).toBe("right-click");
    expect(mouseAction({ ...hint, scope: "app" })).toBe("click here");
    expect(mouseAction({ ...hint, scope: "global" })).toBe("click here");
  });
});
