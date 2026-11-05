import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { setBufferTarget } from "../../keys/locate";
import { createReadMode, type ReadMode } from "./readMode";

// Read mode (09-ui.md#hint-bar-and-keystroke-overlay: ␣ur, :read) hides the rail, the sidebar, the
// hint bar and the keystroke overlay; the same key or command shows them again.

const made: (() => void)[] = [];
const readMode = (): ReadMode =>
  createRoot((dispose) => {
    made.push(dispose);
    return createReadMode();
  });

afterEach(() => {
  for (const drop of made.splice(0)) drop();
  document.body.innerHTML = "";
});

describe("read mode", () => {
  it("starts off; each toggle turns it on, then off again", () => {
    const mode = readMode();
    expect(mode.on()).toBe(false);
    mode.toggle();
    expect(mode.on()).toBe(true);
    mode.toggle();
    expect(mode.on()).toBe(false);
  });

  it("moves the focus out of what it hides, into the lecture when one is open", () => {
    document.body.innerHTML =
      '<nav class="rail"><button id="row">L01</button></nav><div class="hint-bar-host"><button id="hint">s</button></div><div id="buffer" tabindex="0"></div>';
    const lecture = document.getElementById("buffer") as HTMLElement;
    const drop = setBufferTarget({
      root: lecture,
      mode: () => "normal",
      element: () => "slide-line",
      replay: () => {},
      focus: () => lecture.focus(),
    });
    const mode = readMode();
    (document.getElementById("row") as HTMLElement).focus();
    mode.toggle();
    expect(document.activeElement).toBe(lecture);
    mode.toggle();
    (document.getElementById("hint") as HTMLElement).focus();
    mode.toggle();
    expect(document.activeElement).toBe(lecture);
    drop();
  });

  it("leaves the page focused when no lecture is open, and the focus alone when it isn't hidden", () => {
    document.body.innerHTML = '<nav class="rail"><button id="row">L01</button></nav><input id="find" />';
    const mode = readMode();
    (document.getElementById("row") as HTMLElement).focus();
    mode.toggle();
    expect(document.activeElement).toBe(document.body);
    mode.toggle();
    const find = document.getElementById("find") as HTMLElement;
    find.focus();
    mode.toggle();
    expect(document.activeElement).toBe(find);
  });
});
