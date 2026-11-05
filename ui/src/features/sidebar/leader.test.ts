import { afterEach, describe, expect, it } from "vitest";
import { installSidebarToggle, leaderTarget } from "./leader";

// 10-keymap.md#leader-groups: Space is the leader; ␣e toggles the sidebar. Until the key engine
// (F-037) owns the leader, the sidebar listens for ␣e itself, only where Space means nothing else.

/** Puts `html` in the page and returns its first element. */
function put(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

/** A keydown on `target` as a keypress sends it; returns whether the page let it through. */
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): boolean {
  return target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

describe("leaderTarget", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("takes Space as the leader on the page itself", () => {
    expect(leaderTarget(document.body)).toBe(true);
    expect(leaderTarget(null)).toBe(true);
    expect(leaderTarget(put(`<div tabindex="-1">row</div>`))).toBe(true);
  });

  it("takes Space as the leader in the buffer in normal and visual mode only", () => {
    for (const [mode, leader] of [
      ["normal", true],
      ["visual", true],
      ["insert", false],
      ["replace", false],
    ] as const) {
      const buffer = put(
        `<div class="lecture-buffer" data-vim-mode="${mode}"><div contenteditable="true">x</div></div>`,
      );
      expect(leaderTarget(buffer.firstElementChild), mode).toBe(leader);
    }
  });

  it("leaves Space to text fields, even inside the buffer (the : and / prompts)", () => {
    for (const field of [`<input>`, `<textarea></textarea>`, `<select></select>`]) {
      const buffer = put(`<div class="lecture-buffer" data-vim-mode="normal">${field}</div>`);
      expect(leaderTarget(buffer.firstElementChild), field).toBe(false);
    }
    expect(leaderTarget(put(`<div contenteditable="true">note</div>`))).toBe(false);
    expect(leaderTarget(put(`<div role="textbox" tabindex="0">note</div>`))).toBe(false);
  });

  it("leaves Space to buttons and links, which it activates", () => {
    expect(leaderTarget(put(`<button>Trust</button>`))).toBe(false);
    expect(leaderTarget(put(`<a href="#x">link</a>`))).toBe(false);
    expect(leaderTarget(put(`<div role="button" tabindex="0">row</div>`))).toBe(false);
  });
});

describe("installSidebarToggle", () => {
  let remove: () => void = () => {};
  afterEach(() => {
    remove();
    document.body.innerHTML = "";
  });

  function install(): { toggles: () => number } {
    let n = 0;
    remove = installSidebarToggle(window, () => {
      n += 1;
    });
    return { toggles: () => n };
  }

  it("toggles on Space then e, taking both keys from the page", () => {
    const { toggles } = install();
    expect(press(document.body, " ")).toBe(false);
    expect(toggles()).toBe(0);
    expect(press(document.body, "e")).toBe(false);
    expect(toggles()).toBe(1);
    press(document.body, " ");
    press(document.body, "e");
    expect(toggles()).toBe(2);
  });

  it("keeps the keys from the buffer's own listeners in normal mode", () => {
    const { toggles } = install();
    const content = put(`<div class="lecture-buffer" data-vim-mode="normal"><div contenteditable="true">x</div></div>`)
      .firstElementChild as HTMLElement;
    const seen: string[] = [];
    content.addEventListener("keydown", (e) => seen.push(e.key));
    press(content, " ");
    press(content, "e");
    expect(toggles()).toBe(1);
    expect(seen).toEqual([]);
  });

  it("types Space and e in insert mode and in fields", () => {
    const { toggles } = install();
    const content = put(`<div class="lecture-buffer" data-vim-mode="insert"><div contenteditable="true">x</div></div>`)
      .firstElementChild as HTMLElement;
    expect(press(content, " ")).toBe(true);
    expect(press(content, "e")).toBe(true);
    const field = put(`<input>`);
    expect(press(field, " ")).toBe(true);
    expect(press(field, "e")).toBe(true);
    expect(toggles()).toBe(0);
  });

  it("does nothing for e alone, or for Space with a modifier", () => {
    const { toggles } = install();
    expect(press(document.body, "e")).toBe(true);
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(press(document.body, " ", { [mod]: true }), mod).toBe(true);
      expect(press(document.body, "e"), mod).toBe(true);
    }
    expect(toggles()).toBe(0);
  });

  it("drops a leader that another key follows, and that key with it when it is a letter", () => {
    const { toggles } = install();
    press(document.body, " ");
    // ␣x is a group of its own (Lists): not the sidebar, and not a key for the page either.
    expect(press(document.body, "x")).toBe(false);
    expect(press(document.body, "e")).toBe(true);
    press(document.body, " ");
    expect(press(document.body, "Escape")).toBe(false);
    expect(press(document.body, "e")).toBe(true);
    press(document.body, " ");
    // A key that isn't a letter goes on to the page.
    expect(press(document.body, "ArrowDown")).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    press(document.body, " ");
    expect(press(document.body, "e", { ctrlKey: true })).toBe(true);
    expect(toggles()).toBe(0);
  });

  it("waits through a lone modifier, and needs a lowercase e", () => {
    const { toggles } = install();
    press(document.body, " ");
    expect(press(document.body, "Shift", { shiftKey: true })).toBe(true);
    press(document.body, "e");
    expect(toggles()).toBe(1);
    press(document.body, " ");
    press(document.body, "E", { shiftKey: true });
    expect(toggles()).toBe(1);
  });

  it("waits through every modifier key pressed on its own", () => {
    const { toggles } = install();
    const lone: [string, KeyboardEventInit][] = [
      ["Control", { ctrlKey: true }],
      ["Alt", { altKey: true }],
      ["Meta", { metaKey: true }],
      ["AltGraph", {}],
      ["CapsLock", {}],
    ];
    for (const [key, init] of lone) {
      press(document.body, " ");
      expect(press(document.body, key, init), key).toBe(true);
      press(document.body, "e");
    }
    expect(toggles()).toBe(lone.length);
  });

  it("ignores keys of an input method's composition and a held Space", () => {
    const { toggles } = install();
    expect(press(document.body, " ", { isComposing: true })).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(press(document.body, " ", { repeat: true })).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(toggles()).toBe(0);
  });

  it("stops listening once removed", () => {
    const { toggles } = install();
    remove();
    expect(press(document.body, " ")).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(toggles()).toBe(0);
  });
});
