import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCommand } from "./commands";
import { type Keys, startKeys } from "./install";

// 09-ui.md#hint-bar-and-keystroke-overlay: pressing ␣ opens which-key with all groups after 300 ms.

let keys: Keys;
let host: HTMLElement;
const ran: string[] = [];
const drops: (() => void)[] = [];

/** A keydown on the page, through the engine. */
function press(key: string, init: KeyboardEventInit = {}): void {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  keys.handle(e);
}

const popover = () => host.querySelector(".which-key");
const items = () => [...host.querySelectorAll(".which-key-item")].map((b) => b.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  keys = startKeys({ mac: false, host });
  ran.length = 0;
  for (const command of ["sidebar.toggle", "ai.gaps"]) {
    drops.push(
      registerCommand(command, () => {
        ran.push(command);
        return true;
      }),
    );
  }
});
afterEach(() => {
  keys.stop();
  for (const drop of drops.splice(0)) drop();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("which-key", () => {
  it("opens 300 ms after the leader, with every group and leader key", () => {
    press(" ");
    vi.advanceTimersByTime(299);
    expect(popover()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(popover()?.getAttribute("role")).toBe("dialog");
    expect(host.querySelector(".which-key-prefix")?.textContent).toBe("␣");
    expect(items()).toEqual([
      "a+AI",
      "s+Search",
      "x+Lists",
      "f+Files",
      "u+UI",
      "eToggle sidebar",
      "rToggle right panel",
      "␣Find lecture",
      ",Switch buffers",
      "?Keys for this element",
      "q+Quit",
    ]);
    expect([...host.querySelectorAll(".which-key-group")].map((b) => b.querySelector("kbd")?.textContent)).toEqual([
      "a",
      "s",
      "x",
      "f",
      "u",
      "q",
    ]);
  });

  it("never opens when the next key comes in time", () => {
    press(" ");
    vi.advanceTimersByTime(200);
    press("e");
    vi.advanceTimersByTime(1000);
    expect(popover()).toBeNull();
    expect(ran).toEqual(["sidebar.toggle"]);
  });

  it("waits again for a group typed before it opened, then lists the group", () => {
    press(" ");
    vi.advanceTimersByTime(200);
    press("a");
    vi.advanceTimersByTime(299);
    expect(popover()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.querySelector(".which-key-prefix")?.textContent).toBe("␣a");
    expect(items()).toEqual(["gGap finder", "mPick model", "fFigure mode", "cCourse chat"]);
  });

  it("shows a group at once once it is open, and closes when a key runs", () => {
    press(" ");
    vi.advanceTimersByTime(300);
    press("a");
    expect(items()).toEqual(["gGap finder", "mPick model", "fFigure mode", "cCourse chat"]);
    press("g");
    expect(ran).toEqual(["ai.gaps"]);
    expect(popover()).toBeNull();
  });

  it("closes on Esc and on a key that ends the leader", () => {
    press(" ");
    vi.advanceTimersByTime(300);
    press("Escape");
    expect(popover()).toBeNull();
    press(" ");
    vi.advanceTimersByTime(300);
    press("z");
    expect(popover()).toBeNull();
    // Nothing reopens it later.
    vi.advanceTimersByTime(1000);
    expect(popover()).toBeNull();
  });

  it("takes the mouse: a group opens its keys, a key runs, and the focus stays put", () => {
    press(" ");
    vi.advanceTimersByTime(300);
    const button = (label: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(".which-key-item")].find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button("a+AI").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    // A pointer going down on it doesn't end the leader.
    button("a+AI").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button("a+AI").click();
    expect(items()).toEqual(["gGap finder", "mPick model", "fFigure mode", "cCourse chat"]);
    expect(keys.engine.sequence()).toEqual(["<Space>", "a"]);
    button("gGap finder").click();
    expect(ran).toEqual(["ai.gaps"]);
    expect(popover()).toBeNull();
    expect(keys.engine.sequence()).toEqual([]);
  });

  it("lists only what works where the focus is (no leader in a field)", () => {
    const field = document.createElement("input");
    document.body.append(field);
    keys.handle(new KeyboardEvent("keydown", { key: " " }));
    vi.advanceTimersByTime(300);
    expect(items()).toContain("eToggle sidebar");
    press("Escape");
    // Typed in a field, Space is text: no leader, nothing shows.
    field.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    const e = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    Object.defineProperty(e, "target", { value: field });
    keys.handle(e);
    vi.advanceTimersByTime(300);
    expect(popover()).toBeNull();
  });

  it("keeps its buttons out of the Tab order and runs a clicked key once, with no count", () => {
    const calls: string[] = [];
    drops.push(
      registerCommand("ai.gaps", ({ count, explicit }) => {
        calls.push(`${count} ${explicit}`);
        return true;
      }),
    );
    press("3", {});
    press(" ");
    vi.advanceTimersByTime(300);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".which-key-item")];
    expect(buttons.every((b) => b.getAttribute("tabindex") === "-1")).toBe(true);
    (buttons[0] as HTMLButtonElement).click();
    (host.querySelector(".which-key-item") as HTMLButtonElement).click();
    expect(calls).toEqual(["1 false"]);
  });

  it("says which key moves to the next pane, as the keymap has it", () => {
    press(" ");
    vi.advanceTimersByTime(300);
    expect(host.querySelector(".which-key-hint")?.textContent).toBe("Esc to close · F6 next pane");
    press("Escape");
    keys.setUserKeymap(
      '{"version": 1, "bindings": [{"keys": "<F6>", "command": null}, {"keys": "<C-S-n>", "command": "focus.next"}]}',
    );
    press(" ");
    vi.advanceTimersByTime(300);
    expect(host.querySelector(".which-key-hint")?.textContent).toBe("Esc to close · Ctrl-Shift-n next pane");
    press("Escape");
    keys.setUserKeymap('{"version": 1, "bindings": [{"keys": "<F6>", "command": null}]}');
    press(" ");
    vi.advanceTimersByTime(300);
    expect(host.querySelector(".which-key-hint")?.textContent).toBe("Esc to close");
  });

  it("is gone with the engine", () => {
    press(" ");
    keys.stop();
    vi.advanceTimersByTime(300);
    expect(popover()).toBeNull();
    expect(host.children).toHaveLength(0);
  });
});
