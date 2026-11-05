import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCommand, runCommand } from "../../keys/commands";
import { type Keys, startKeys } from "../../keys/install";
import { DEFAULT_KEYMAP, type Mode } from "../../keys/keymap";
import { setBufferTarget } from "../../keys/locate";
import { type HintBarHandle, startHintBar } from "./mount";

// 09-ui.md#hint-bar-and-keystroke-overlay: the hint bar lists the keys that work now and changes
// with the cursor's element and the mode; its detail follows ui.hintBar (full shows the mouse
// action too, compact the keys only, off hides it); ␣uh steps through the details (10-keymap.md).

let keys: Keys;
let host: HTMLElement;
let bar: HintBarHandle;
let buffer: HTMLElement;
let field: HTMLInputElement;
const drops: (() => void)[] = [];
/** Where the fake buffer's cursor is, and Vim's mode. */
const cursor: { element: "slide-line" | "note-line" | "gloss"; mode: Mode } = { element: "slide-line", mode: "normal" };
/** The keys the fake buffer's Vim was handed; `i` puts it in insert mode. */
const replayed: string[][] = [];

/** A keydown on the focused element, through the engine as the page would send it. */
function press(key: string, init: KeyboardEventInit = {}): void {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  (document.activeElement ?? document.body).dispatchEvent(e);
  keys.handle(e);
}

/** The next frame, where the bar looks again. */
const frame = () => vi.advanceTimersToNextFrame();

/** The bar's hints as they read: keycaps, then words (and the mouse action in full). */
const shown = (part: "main" | "tail") =>
  [...host.querySelectorAll(`.hint-${part} .hint`)].map((b) =>
    [...b.children].map((c) => `${c.className}=${c.textContent}`).join(" "),
  );
/** The hint whose words are `desc`. */
const hintFor = (desc: string) =>
  [...host.querySelectorAll(".hint")].find((h) => h.querySelector(".hint-desc")?.textContent === desc);
/** The hint whose words are `desc`, as a button; throws when it isn't one. */
function button(desc: string): HTMLButtonElement {
  const hint = hintFor(desc);
  if (!(hint instanceof HTMLButtonElement)) throw new Error(`${desc} is not a button`);
  return hint;
}
/** Whether the hint whose words are `desc` is a button (clickable) or text (a span). */
const clickable = (desc: string) => hintFor(desc)?.tagName;
const words = (part: "main" | "tail" = "main") =>
  [...host.querySelectorAll(`.hint-${part} .hint-desc`)].map((d) => d.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  cursor.element = "slide-line";
  cursor.mode = "normal";
  replayed.length = 0;
  buffer = document.createElement("div");
  buffer.tabIndex = 0;
  field = document.createElement("input");
  host = document.createElement("div");
  document.body.append(buffer, field, host);
  drops.push(
    setBufferTarget({
      root: buffer,
      mode: () => cursor.mode,
      element: () => cursor.element,
      replay: (tokens) => {
        replayed.push([...tokens]);
        if (tokens[0] === "i") cursor.mode = "insert";
      },
      focus: () => buffer.focus(),
    }),
  );
  keys = startKeys({ mac: false, host });
  buffer.focus();
  bar = startHintBar({ engine: keys.engine, host });
});
afterEach(() => {
  bar.stop();
  keys.stop();
  for (const drop of drops.splice(0)) drop();
  // A spy on requestAnimationFrame would outlive this test's fake clock.
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/** The bar again, at `detail`. */
function restart(detail: "full" | "compact" | "off"): void {
  bar.stop();
  bar = startHintBar({ engine: keys.engine, host, detail });
}

describe("the hint bar", () => {
  it("lists a slide line's keys with their words and mouse actions at the start, in full", () => {
    expect(host.querySelector(".hint-bar")?.getAttribute("aria-label")).toBe("Keys that work now");
    expect(shown("main").slice(0, 3)).toEqual([
      "hint-key=↵ hint-desc=Ask about this line hint-mouse=right-click the line",
      "hint-key=s hint-desc=Steps hint-mouse=right-click the line",
      "hint-key=q hint-desc=Park a doubt hint-mouse=right-click the line",
    ]);
    expect(shown("main")).toContain("hint-key=i hint-desc=Edit / fix the line hint-mouse=double-click");
    expect(shown("main")).toContain("hint-key=Ctrl-j hint-key=]] hint-desc=Next slide hint-mouse=scroll");
    expect(shown("main")).toContain("hint-key=]d hint-desc=Next doubt hint-mouse=Doubts tab");
    expect(shown("main").slice(-2)).toEqual([
      "hint-key=Ctrl-1…9 hint-desc=Course hint-mouse=click the course",
      "hint-key=Shift-F6 hint-desc=Previous pane hint-mouse=click a pane",
    ]);
    expect(shown("tail")).toEqual([
      "hint-key=F6 hint-desc=Next pane hint-mouse=click a pane",
      "hint-key=␣ hint-desc=More hint-mouse=click here",
    ]);
  });

  it("changes when the cursor moves from a slide line onto a gloss and back, in the next frame", () => {
    expect(words()[1]).toBe("Steps");
    cursor.element = "gloss";
    press("j");
    // Not before the key is done with: the bar looks in the next frame.
    expect(words()[1]).toBe("Steps");
    frame();
    expect(words().slice(0, 2)).toEqual(["Reply in thread (keep a draft)", "Regenerate"]);
    expect(shown("main")[1]).toBe("hint-key=r hint-desc=Regenerate hint-mouse=click its keycap");
    expect(shown("main")).toContain("hint-key=i hint-desc=Edit the gloss hint-mouse=double-click");
    cursor.element = "note-line";
    buffer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    frame();
    expect(words()[1]).toBe("Steps");
  });

  it("follows the mode: insert mode leaves the global keys, visual mode the ask", () => {
    cursor.mode = "insert";
    press("i");
    frame();
    expect(words()).toEqual(["Course", "Previous pane"]);
    expect(words("tail")).toEqual(["Next pane"]);
    cursor.mode = "visual";
    buffer.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    frame();
    expect(words()).toEqual(["Ask about this line", "Course", "Previous pane"]);
    expect(words("tail")).toEqual(["Next pane", "More"]);
  });

  it("follows the focus out of the buffer into a field and onto the page", () => {
    field.focus();
    frame();
    expect(words()).toEqual(["Course", "Previous pane"]);
    expect(words("tail")).toEqual(["Next pane"]);
    field.blur();
    frame();
    expect(words()).toEqual(["Course", "Previous pane"]);
    expect(words("tail")).toEqual(["Next pane", "More"]);
    buffer.focus();
    frame();
    expect(words()[0]).toBe("Ask about this line");
  });

  it("looks once per frame however many keys came in it", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    press("j");
    press("k");
    buffer.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(raf).toHaveBeenCalledTimes(1);
    frame();
    press("j");
    expect(raf).toHaveBeenCalledTimes(2);
  });

  it("shows the keys and their words but no mouse actions in compact, and nothing when off", () => {
    restart("compact");
    expect(host.querySelector(".hint-bar")?.getAttribute("data-detail")).toBe("compact");
    expect(shown("main")[1]).toBe("hint-key=s hint-desc=Steps");
    expect(host.querySelector(".hint-mouse")).toBeNull();
    restart("off");
    expect(host.querySelector(".hint-bar")).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("steps through full, compact and off with ␣uh, and back to full", () => {
    const details = () => host.querySelector(".hint-bar")?.getAttribute("data-detail") ?? "none";
    const leaderUh = () => {
      press(" ");
      press("u");
      press("h");
    };
    expect(details()).toBe("full");
    leaderUh();
    expect(details()).toBe("compact");
    leaderUh();
    expect(details()).toBe("none");
    leaderUh();
    expect(details()).toBe("full");
    expect(host.querySelectorAll(".hint-mouse").length).toBeGreaterThan(0);
  });

  it("runs a hint's command on a click without taking the focus, and ␣ More leaves the leader pending", () => {
    const ran: string[] = [];
    drops.push(
      registerCommand("ai.steps", ({ binding, count }) => {
        ran.push(`${binding.command} ${count}`);
        return true;
      }),
    );
    const steps = [...host.querySelectorAll<HTMLButtonElement>(".hint-main .hint")][1] as HTMLButtonElement;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    steps.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    steps.click();
    expect(ran).toEqual(["ai.steps 1"]);
    expect(document.activeElement).toBe(buffer);
    const more = [...host.querySelectorAll<HTMLButtonElement>(".hint-tail .hint")][1] as HTMLButtonElement;
    more.click();
    expect(keys.engine.sequence()).toEqual(["<Space>"]);
  });

  it("drops a pending count when a hint runs, so the next key starts afresh", () => {
    press("3");
    expect(keys.engine.pending()).toEqual(["3"]);
    button("Edit / fix the line").click();
    expect(keys.engine.pending()).toEqual([]);
    expect(replayed).toEqual([["i"]]);
  });

  it("reads keymaps.jsonc's bindings once refreshed", () => {
    keys.setUserKeymap(JSON.stringify({ version: 1, bindings: [{ keys: "x", command: "ai.steps", context: "line" }] }));
    expect(shown("main")[1]).toBe("hint-key=s hint-desc=Steps hint-mouse=right-click the line");
    bar.refresh();
    expect(shown("main")[1]).toBe("hint-key=s hint-key=x hint-desc=Steps hint-mouse=right-click the line");
  });

  it("follows a change of mode alone: insert on an own note keeps the note but drops its keys", () => {
    cursor.element = "note-line";
    press("j");
    frame();
    expect(words()[1]).toBe("Steps");
    cursor.mode = "insert";
    press("i");
    frame();
    expect(words()).toEqual(["Course", "Previous pane"]);
    cursor.mode = "normal";
    press("Escape");
    frame();
    expect(words()[1]).toBe("Steps");
  });

  it("keeps its buttons when the element and the mode stay the same", () => {
    const before = host.querySelector(".hint-main .hint");
    press("j");
    frame();
    expect(host.querySelector(".hint-main .hint")).toBe(before);
    cursor.element = "gloss";
    press("j");
    frame();
    expect(host.querySelector(".hint-main .hint")).not.toBe(before);
  });

  it("keeps its buttons out of the Tab order: the keys are the keyboard's way", () => {
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button.hint")];
    expect(buttons.length).toBeGreaterThan(3);
    expect(buttons.every((b) => b.tabIndex === -1 && b.type === "button")).toBe(true);
  });

  it("looks again after a click ran a hint that moved the cursor", () => {
    drops.push(
      registerCommand("ai.steps", ({ explicit }) => {
        expect(explicit).toBe(false);
        cursor.element = "gloss";
        return true;
      }),
    );
    ([...host.querySelectorAll<HTMLButtonElement>(".hint-main .hint")][1] as HTMLButtonElement).click();
    frame();
    expect(words()[1]).toBe("Regenerate");
  });

  it("goes away when stopped: no bar, no ␣uh, no more looking", () => {
    bar.stop();
    const hintDetail = DEFAULT_KEYMAP.find((b) => b.command === "ui.hintDetail");
    expect(hintDetail?.keys).toBe("<leader>uh");
    expect(runCommand({ binding: hintDetail as never, count: 1, explicit: false })).toBe(false);
    expect(host.textContent).toBe("");
    const raf = vi.spyOn(window, "requestAnimationFrame");
    press("j");
    expect(raf).not.toHaveBeenCalled();
    press(" ");
    press("u");
    press("h");
    expect(host.textContent).toBe("");
    bar = startHintBar({ engine: keys.engine, host });
  });

  it("cancels a look still waiting when stopped", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    press("j");
    bar.stop();
    expect(cancel).toHaveBeenCalledTimes(1);
    bar = startHintBar({ engine: keys.engine, host });
  });

  it("hands a hint's keys to Vim on a click when no handler runs it, as the key does: i edits", () => {
    expect(clickable("Edit / fix the line")).toBe("BUTTON");
    button("Edit / fix the line").click();
    expect(replayed).toEqual([["i"]]);
    expect(document.activeElement).toBe(buffer);
    frame();
    expect(words()).toEqual(["Course", "Previous pane"]);
    cursor.mode = "normal";
    press("Escape");
    frame();
    button("Next slide").click();
    expect(replayed).toEqual([["i"], ["<C-j>"]]);
  });

  it("shows a hint that a click can't run as text: a given-up key with no handler, a numbered family", () => {
    // `s` gave up its Vim meaning, so with nobody handling ai.steps neither the key nor a click does anything.
    expect(clickable("Steps")).toBe("SPAN");
    expect(clickable("Write for me")).toBe("SPAN");
    // A click can't say which course: Ctrl-1…9 stays text though course.go has a handler.
    drops.push(registerCommand("course.go", () => true));
    expect(clickable("Course")).toBe("SPAN");
    expect(clickable("Next pane")).toBe("BUTTON");
    expect(clickable("More")).toBe("BUTTON");
  });

  it("makes a hint clickable once its command gets a handler, and text again when it goes", () => {
    expect(clickable("Steps")).toBe("SPAN");
    const drop = registerCommand("ai.steps", () => true);
    expect(clickable("Steps")).toBe("BUTTON");
    drop();
    expect(clickable("Steps")).toBe("SPAN");
  });

  it("off the buffer leaves Vim out: only hints with a handler are clickable", () => {
    keys.setUserKeymap(JSON.stringify({ version: 1, bindings: [{ keys: "<F9>", command: "line.edit" }] }));
    bar.refresh();
    field.focus();
    frame();
    expect(clickable("Previous pane")).toBe("BUTTON");
    expect(clickable("Edit / fix the line")).toBe("SPAN");
    buffer.focus();
    frame();
    expect(clickable("Edit / fix the line")).toBe("BUTTON");
  });

  it("keeps its buttons between a slide line and an own note, which have the same keys", () => {
    const before = host.querySelector(".hint-main .hint");
    cursor.element = "note-line";
    press("j");
    frame();
    expect(host.querySelector(".hint-main .hint")).toBe(before);
  });

  it("keeps what it shows while Vim waits for the rest of a command (d, y, f)", () => {
    const before = host.querySelector(".hint-main .hint");
    buffer.setAttribute("data-vim-mode", "normal");
    cursor.mode = "insert";
    press("d");
    frame();
    expect(host.querySelector(".hint-main .hint")).toBe(before);
    expect(words()[1]).toBe("Steps");
    buffer.setAttribute("data-vim-mode", "visual");
    press("f");
    frame();
    // In visual mode Vim waiting on `"` or `f` keeps the selection's keys.
    expect(words()).toEqual(["Ask about this line", "Course", "Previous pane"]);
    buffer.setAttribute("data-vim-mode", "insert");
    press("i");
    frame();
    expect(words()).toEqual(["Course", "Previous pane"]);
  });

  it("starts at the detail it is given (ui.hintBar), and ␣uh steps on from there", () => {
    const details = () => host.querySelector(".hint-bar")?.getAttribute("data-detail") ?? "none";
    restart("compact");
    expect(details()).toBe("compact");
    press(" ");
    press("u");
    press("h");
    expect(details()).toBe("none");
    restart("off");
    expect(details()).toBe("none");
    press(" ");
    press("u");
    press("h");
    expect(details()).toBe("full");
  });
});
