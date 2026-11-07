// F-048 criteria 1 and 2: Enter asks, through the key engine as the user presses it, on a slide line
// and on an own-note line alike (10-keymap.md#on-a-slide-line). On a note the gloss is anchored to
// the note's id and saved after the note's div (03-lecture-files.md#body).
import { getCM } from "@replit/codemirror-vim";
import { describe, expect, it } from "vitest";
import type { Edit } from "../../core/lecture";
import { hasCommand } from "../../keys/commands";
import { ask, card, fakeBackend, keys, mount, press, prompt, useBuffer } from "./__tests__/kit";
import { ASK_COMMAND } from "./askKey";
import { cardsField } from "./field";

useBuffer();

const NOTED = [
  '::: {.slide #s1 n=1 title="Covariance"}', // 1
  "## Covariance", // 2
  "", // 3
  "[Covariance measures co-movement.]{#s1b1}", // 4
  "", // 5
  "::: {.note #n-91c0 anchor=s1b1}", // 6
  "Try it with numbers.", // 7
  "And with letters.", // 8
  ":::", // 9
  "", // 10
  "a loose line", // 11
  ":::", // 12
  "",
].join("\n");

const NOTE_DIV =
  '::: {.gloss #g-0001 kind=ask key=Enter anchor=n-91c0 model="sample" by=ai}\n**you asked:** which numbers?\n\nTwo dice.\n:::';

/** Puts the cursor on line `n`, `ch` characters in. */
function at(view: ReturnType<typeof mount>, n: number, ch = 1): void {
  view.dispatch({ selection: { anchor: view.state.doc.line(n).from + ch } });
}

describe("Enter on a slide line", () => {
  it("is taken by the key engine and opens the prompt under that block, Vim staying in normal mode", () => {
    const f = fakeBackend();
    const view = mount(f.backend, [], NOTED);
    at(view, 4);
    const e = ask(view);
    expect(e.defaultPrevented).toBe(true);
    expect([card(view)?.dataset.state, card(view)?.dataset.anchor]).toEqual(["prompt", "s1b1"]);
    expect(getCM(view)?.state.vim?.insertMode).toBe(false);
    expect(view.state.doc.toString()).toBe(NOTED);
    prompt(view, "why?");
    expect(f.asks.map((a) => [a.block, a.question])).toEqual([["s1b1", "why?"]]);
  });
});

describe("Enter on an own-note line", () => {
  it("opens the prompt under the line, and the question goes to the core anchored to the note's id", () => {
    const f = fakeBackend();
    const view = mount(f.backend, [], NOTED);
    at(view, 8, 4);
    ask(view);
    expect([card(view)?.dataset.state, card(view)?.dataset.anchor]).toEqual(["prompt", "n-91c0"]);
    // Under the line Enter was pressed on, as on a slide line.
    expect(view.state.field(cardsField).map((p) => p.pos)).toEqual([view.state.doc.line(8).to]);
    expect(document.activeElement?.className).toBe("gloss-prompt-input");
    prompt(view, "which numbers?");
    expect(f.asks.map((a) => [a.block, a.question])).toEqual([["n-91c0", "which numbers?"]]);
    expect(card(view)?.dataset.state).toBe("streaming");
  });

  it("saves the finished gloss after the note's div, after the glosses already on that note", () => {
    const f = fakeBackend();
    const edits: Edit[][] = [];
    const earlier = "::: {.gloss #g-00aa kind=ask key=Enter anchor=n-91c0 by=ai}\n**you asked:** old\n:::";
    const text = NOTED.replace("And with letters.\n:::\n", `And with letters.\n:::\n\n${earlier}\n`);
    const view = mount(f.backend, edits, text);
    at(view, 7);
    ask(view);
    prompt(view, "which numbers?");
    f.asks[0]?.emit({ event: "done", data: { markdown: NOTE_DIV } });
    const after = text.indexOf(earlier) + earlier.length;
    expect(view.state.doc.toString()).toBe(`${text.slice(0, after)}\n\n${NOTE_DIV}${text.slice(after)}`);
    expect(edits).toEqual([[{ from: after, to: after, text: `\n\n${NOTE_DIV}` }]]);
    expect(card(view)).toBeNull();
  });

  it("an answer whose note was deleted meanwhile isn't saved, and says so", () => {
    const f = fakeBackend();
    const view = mount(f.backend, [], NOTED);
    at(view, 7);
    ask(view);
    prompt(view, "why?");
    const open = view.state.doc.line(6);
    view.dispatch({ changes: { from: open.from, to: view.state.doc.line(9).to + 1 } });
    const left = view.state.doc.toString();
    f.asks[0]?.emit({ event: "done", data: { markdown: NOTE_DIV } });
    expect(view.state.doc.toString()).toBe(left);
    expect(card(view)?.querySelector("[role=alert]")?.textContent).toBe(
      "The line was deleted, so the answer was not saved.",
    );
  });
});

describe("Enter where it can't ask", () => {
  it("does nothing on a line in no note, and leaves the text and cursor alone", () => {
    const f = fakeBackend();
    const view = mount(f.backend, [], NOTED);
    at(view, 11, 2);
    const e = ask(view);
    expect(e.defaultPrevented).toBe(true);
    expect(card(view)).toBeNull();
    expect([view.state.doc.toString(), view.state.selection.main.head]).toEqual([
      NOTED,
      view.state.doc.line(11).from + 2,
    ]);
  });

  it("does nothing in a buffer that can't ask, which has no ask command", () => {
    const view = mount(null, [], NOTED);
    at(view, 4);
    expect(hasCommand(ASK_COMMAND)).toBe(false);
    ask(view);
    expect(card(view)).toBeNull();
    expect(view.state.doc.toString()).toBe(NOTED);
  });

  it("declines a selection (v…Enter is F-103's) and leaves Enter to the editor in insert mode", () => {
    const f = fakeBackend();
    const view = mount(f.backend, [], NOTED);
    at(view, 7, 0);
    keys(view, "v", "l");
    ask(view);
    expect(card(view)).toBeNull();
    keys(view, "<Esc>", "i");
    const e = press(view, "Enter");
    expect(card(view)).toBeNull();
    expect(e.defaultPrevented).toBe(false);
    expect(f.asks).toEqual([]);
  });

  it("goes with the buffer: the command is there while it is on screen, and not after", () => {
    const view = mount(fakeBackend().backend, [], NOTED);
    expect(hasCommand(ASK_COMMAND)).toBe(true);
    view.destroy();
    expect(hasCommand(ASK_COMMAND)).toBe(false);
  });
});
