import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commands";
import { type Keys, startKeys } from "./install";
import { setBufferTarget } from "./locate";
import { cyclePanes } from "./panes";

// D-200: F6 / Shift-F6 move the focus between rail, sidebar, editor and side panel, from any
// element and mode, so the editor (where Tab is "write for me") is no keyboard trap.

const FRAME = `
  <nav class="rail">
    <section class="course-rail"><button id="c1">One</button><button id="c2" aria-current="true">Two</button></section>
    <div id="sidebar"><button id="dash" aria-disabled="true">Dashboard</button><button id="lec">l07</button></div>
  </nav>
  <main class="buffer"><div class="lecture-buffer" id="buf"><div id="content" tabindex="-1"></div></div></main>
  <aside class="side-panel"><input id="find" /></aside>`;

let keys: Keys;
let dropBuffer: () => void;
let editorMode: "normal" | "insert" = "normal";

beforeEach(() => {
  document.body.innerHTML = FRAME;
  editorMode = "normal";
  const root = document.getElementById("buf") as HTMLElement;
  dropBuffer = setBufferTarget({
    root,
    mode: () => editorMode,
    element: () => "note-line",
    replay: () => {},
    focus: () => (document.getElementById("content") as HTMLElement).focus(),
  });
  keys = startKeys({ mac: false, host: document.body });
});
afterEach(() => {
  dropBuffer();
  keys.stop();
  document.body.innerHTML = "";
});

/** F6 (or Shift-F6) on whatever has the focus; whether the page let it through. */
function f6(shift = false): boolean {
  const e = new KeyboardEvent("keydown", { key: "F6", shiftKey: shift, bubbles: true, cancelable: true });
  Object.defineProperty(e, "target", { value: document.activeElement ?? document.body });
  keys.handle(e);
  return !e.defaultPrevented;
}
const focused = () => document.activeElement?.id;

describe("F6", () => {
  it("goes round rail, sidebar, editor and side panel, starting at the current rows", () => {
    expect(f6()).toBe(false);
    expect(focused()).toBe("c2");
    f6();
    expect(focused()).toBe("lec");
    f6();
    expect(focused()).toBe("content");
    f6();
    expect(focused()).toBe("find");
    f6();
    expect(focused()).toBe("c2");
  });

  it("goes the other way with Shift-F6, starting at the side panel", () => {
    expect(f6(true)).toBe(false);
    expect(focused()).toBe("find");
    f6(true);
    expect(focused()).toBe("content");
    f6(true);
    expect(focused()).toBe("lec");
    f6(true);
    expect(focused()).toBe("c2");
    f6(true);
    expect(focused()).toBe("find");
  });

  it("leaves the editor in insert mode too, and from a text field", () => {
    (document.getElementById("content") as HTMLElement).focus();
    editorMode = "insert";
    f6();
    expect(focused()).toBe("find");
    f6();
    expect(focused()).toBe("c2");
  });

  it("skips a hidden sidebar and an editor with no lecture", () => {
    (document.getElementById("sidebar") as HTMLElement).hidden = true;
    dropBuffer();
    (document.getElementById("c2") as HTMLElement).focus();
    f6();
    expect(focused()).toBe("find");
    f6(true);
    expect(focused()).toBe("c2");
  });

  it("passes over panes with nothing to focus, and stays put when no other pane can take the focus", () => {
    (document.querySelector(".side-panel") as HTMLElement).innerHTML = `<input id="gone" hidden />`;
    (document.getElementById("content") as HTMLElement).focus();
    f6();
    expect(focused()).toBe("c2");
    // Only the sidebar is left: F6 there goes nowhere and lets the key through.
    document.querySelector(".course-rail")?.remove();
    dropBuffer();
    (document.getElementById("lec") as HTMLElement).focus();
    expect(f6()).toBe(true);
    expect(focused()).toBe("lec");
  });

  it("reaches the last pane from nowhere when it is the only one", () => {
    document.querySelector(".rail")?.remove();
    dropBuffer();
    expect(f6()).toBe(false);
    expect(focused()).toBe("find");
  });

  it("finds a pane's other focusable things", () => {
    const side = document.querySelector(".side-panel") as HTMLElement;
    for (const html of [
      `<textarea id="x"></textarea>`,
      `<select id="x"></select>`,
      `<button id="x">b</button>`,
      `<div id="x" tabindex="-1"></div>`,
    ]) {
      side.innerHTML = html;
      (document.getElementById("c2") as HTMLElement).focus();
      f6(true);
      expect(focused(), html).toBe("x");
    }
    (document.getElementById("sidebar") as HTMLElement).innerHTML = `<div id="row" tabindex="-1">row</div>`;
    (document.getElementById("c2") as HTMLElement).focus();
    f6();
    expect(focused()).toBe("row");
  });

  it("stops with the engine", () => {
    keys.stop();
    expect(
      runCommand({
        binding: { keys: "<F6>", command: "focus.next", scope: "global", desc: "" },
        count: 1,
        explicit: false,
      }),
    ).toBe(false);
  });

  it("takes the first row when none is current, and lets F6 through when no pane can take it", () => {
    document.getElementById("c2")?.removeAttribute("aria-current");
    f6();
    expect(focused()).toBe("c1");
    document.body.innerHTML = "<p>nothing to focus</p>";
    expect(f6()).toBe(true);
    expect(cyclePanes(document, -1)).toBe(false);
  });
});
