import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootKeys } from "./boot";
import { registerCommand } from "./commands";
import { scopesFor } from "./engine";
import { type Keys, startKeys } from "./install";
import { locate } from "./locate";

// 10-keymap.md#leader-groups: Space is the leader; ␣e toggles the sidebar; Ctrl/Cmd-1…9 open a
// course. These are the behaviours the rail's and the sidebar's own listeners had (D-190, D-196),
// now through the engine: Space is the leader only where it means nothing else.

/** Puts `html` in the page and returns its first element. */
function put(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

/** A keydown on `target` as a keypress sends it; returns whether the page let it through. */
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): boolean {
  return target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

/** Whether Space on `el` is the leader. */
const leaderTarget = (el: Element | null) => {
  const w = locate(el);
  return scopesFor(w.el, w.mode).includes("app");
};

describe("where Space is the leader", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("on the page itself", () => {
    expect(leaderTarget(document.body)).toBe(true);
    expect(leaderTarget(null)).toBe(true);
    expect(leaderTarget(put(`<div tabindex="-1">row</div>`))).toBe(true);
  });

  it("in the buffer in normal and visual mode only", () => {
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

  it("not in text fields, even inside the buffer (the : and / prompts)", () => {
    for (const field of [`<input>`, `<textarea></textarea>`, `<select></select>`]) {
      const buffer = put(`<div class="lecture-buffer" data-vim-mode="normal">${field}</div>`);
      expect(leaderTarget(buffer.firstElementChild), field).toBe(false);
    }
    expect(leaderTarget(put(`<div contenteditable="true">note</div>`))).toBe(false);
    expect(leaderTarget(put(`<div role="textbox" tabindex="0">note</div>`))).toBe(false);
  });

  it("not on buttons and links, which it activates (Q-030)", () => {
    expect(leaderTarget(put(`<button>Trust</button>`))).toBe(false);
    expect(leaderTarget(put(`<a href="#x">link</a>`))).toBe(false);
    expect(leaderTarget(put(`<div role="button" tabindex="0">row</div>`))).toBe(false);
  });
});

describe("the engine in the page", () => {
  let keys: Keys | undefined;
  let stopBoot: () => void = () => {};
  let toggles = 0;
  let opened: number[] = [];
  let courses = 2;
  const drops: (() => void)[] = [];

  /** Starts the engine on `window`, as App does after the first paint. */
  function start(mac = false): Keys {
    const boot = bootKeys(window, mac);
    stopBoot = boot.stop;
    keys = startKeys({ mac, host: document.body });
    boot.attach(keys.handle);
    return keys;
  }

  beforeEach(() => {
    toggles = 0;
    opened = [];
    courses = 2;
    drops.push(
      registerCommand("sidebar.toggle", () => {
        toggles += 1;
        return true;
      }),
      registerCommand("course.go", ({ binding }) => {
        opened.push(binding.arg ?? -1);
        return (binding.arg ?? 99) < courses;
      }),
    );
  });
  afterEach(() => {
    stopBoot();
    keys?.stop();
    keys = undefined;
    for (const drop of drops.splice(0)) drop();
    document.body.innerHTML = "";
  });

  it("toggles the sidebar on Space then e, taking both keys from the page", () => {
    start();
    expect(press(document.body, " ")).toBe(false);
    expect(toggles).toBe(0);
    expect(press(document.body, "e")).toBe(false);
    expect(toggles).toBe(1);
    press(document.body, " ");
    press(document.body, "e");
    expect(toggles).toBe(2);
  });

  it("keeps the keys from the buffer's own listeners in normal mode", () => {
    start();
    const content = put(`<div class="lecture-buffer" data-vim-mode="normal"><div contenteditable="true">x</div></div>`)
      .firstElementChild as HTMLElement;
    const seen: string[] = [];
    content.addEventListener("keydown", (e) => seen.push(e.key));
    press(content, " ");
    press(content, "e");
    expect(toggles).toBe(1);
    expect(seen).toEqual([]);
  });

  it("types Space and e in insert mode and in fields", () => {
    start();
    const content = put(`<div class="lecture-buffer" data-vim-mode="insert"><div contenteditable="true">x</div></div>`)
      .firstElementChild as HTMLElement;
    expect(press(content, " ")).toBe(true);
    expect(press(content, "e")).toBe(true);
    const field = put(`<input>`);
    expect(press(field, " ")).toBe(true);
    expect(press(field, "e")).toBe(true);
    expect(toggles).toBe(0);
  });

  it("does nothing for e alone, or for Space with a modifier", () => {
    start();
    expect(press(document.body, "e")).toBe(true);
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(press(document.body, " ", { [mod]: true }), mod).toBe(true);
      expect(press(document.body, "e"), mod).toBe(true);
    }
    expect(toggles).toBe(0);
  });

  it("drops a leader that another key follows, and that key with it when it is a letter", () => {
    start();
    press(document.body, " ");
    // ␣x is a group of its own (Lists), waiting for its key; ␣xz is nothing, and z is dropped.
    expect(press(document.body, "x")).toBe(false);
    expect(press(document.body, "z")).toBe(false);
    expect(press(document.body, "e")).toBe(true);
    // ␣z is no group at all: dropped at once.
    press(document.body, " ");
    expect(press(document.body, "z")).toBe(false);
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
    // A leader key nobody handles yet (␣r, the right panel) is dropped too.
    press(document.body, " ");
    expect(press(document.body, "r")).toBe(false);
    expect(toggles).toBe(0);
  });

  it("waits through a lone modifier, and needs a lowercase e", () => {
    start();
    press(document.body, " ");
    expect(press(document.body, "Shift", { shiftKey: true })).toBe(true);
    press(document.body, "e");
    expect(toggles).toBe(1);
    press(document.body, " ");
    press(document.body, "E", { shiftKey: true });
    expect(toggles).toBe(1);
  });

  it("waits through every modifier key pressed on its own", () => {
    start();
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
    expect(toggles).toBe(lone.length);
  });

  it("ignores keys of an input method's composition and a held Space", () => {
    start();
    expect(press(document.body, " ", { isComposing: true })).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(press(document.body, " ", { repeat: true })).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    // Composition ends whatever was pending.
    press(document.body, " ");
    expect(press(document.body, "Process")).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(toggles).toBe(0);
  });

  it("forgets a pending leader when the pointer goes down somewhere", () => {
    start();
    press(document.body, " ");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(press(document.body, "e")).toBe(true);
    expect(toggles).toBe(0);
  });

  it("stops listening once stopped", () => {
    start();
    stopBoot();
    expect(press(document.body, " ")).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(toggles).toBe(0);
  });

  it("opens a course before the focused element sees the key, and only when that course exists", () => {
    start();
    const field = put(`<input>`);
    let reached = 0;
    field.addEventListener("keydown", () => reached++);

    expect(press(field, "2", { code: "Digit2", ctrlKey: true })).toBe(false);
    expect(opened).toEqual([1]);
    expect(reached).toBe(0);

    // No third course: the key goes on to the element as if the engine weren't there.
    expect(press(field, "3", { code: "Digit3", ctrlKey: true })).toBe(true);
    expect(opened).toEqual([1, 2]);
    expect(reached).toBe(1);

    // Any other key is never a course key.
    press(field, "j", { code: "KeyJ", ctrlKey: true });
    expect(opened).toEqual([1, 2]);
    expect(reached).toBe(2);
  });

  it("uses Cmd for the course keys on macOS", () => {
    start(true);
    expect(press(document.body, "1", { code: "Digit1", ctrlKey: true })).toBe(true);
    expect(press(document.body, "1", { code: "Digit1", metaKey: true })).toBe(false);
    expect(opened).toEqual([0]);
  });

  it("lets a key through when its command has no handler yet", () => {
    start();
    drops.splice(0).forEach((drop) => {
      drop();
    });
    expect(press(document.body, "1", { code: "Digit1", ctrlKey: true })).toBe(true);
    expect(opened).toEqual([]);
  });

  it("reports nothing wrong without keymaps.jsonc, and the file's problems with one", () => {
    expect(start().warnings).toEqual([]);
    keys?.stop();
    const withFile = startKeys({
      mac: false,
      host: document.body,
      userKeymap: '{ "version": 1, "bindings": [{ "keys": "g", "command": "app.quit", "context": "line" }, 3] }',
    });
    expect(withFile.warnings).toEqual([
      "keymaps.jsonc binding 2: not an object; ignored",
      "Keys clash in line: g (app.quit) and gd (sources.goto)",
      "Keys clash in line: g (app.quit) and gx (parse.compare)",
    ]);
    withFile.stop();
  });

  it("keeps a pending key when keymaps.jsonc arrives, and reads the next key on the new keymap", () => {
    const keys = start();
    const seen: string[][] = [];
    const whichKey = keys.engine.onChange;
    keys.engine.onChange = (pending) => {
      seen.push([...pending]);
      whichKey(pending);
    };
    // ␣ pressed while keymaps.jsonc is still being read: the swap keeps it, and says so (which-key
    // shows the new keymap's choices), so ␣e still toggles the sidebar (F-041, WebKit e2e).
    press(document.body, " ");
    expect(keys.setUserKeymap(null)).toEqual([]);
    expect(keys.engine.pending()).toEqual(["<Space>"]);
    expect(seen).toEqual([["<Space>"], ["<Space>"]]);
    expect(press(document.body, "e")).toBe(false);
    expect(toggles).toBe(1);
    // The new keymap decides: ␣ then t, which only keymaps.jsonc binds.
    press(document.body, " ");
    keys.setUserKeymap(
      '{ "version": 1, "bindings": [{ "keys": "<leader>t", "command": "sidebar.toggle", "context": "app" }] }',
    );
    expect(press(document.body, "t")).toBe(false);
    expect(toggles).toBe(2);
  });

  it("uses keymaps.jsonc's bindings over the defaults", () => {
    const boot = bootKeys(window, false);
    stopBoot = boot.stop;
    keys = startKeys({
      mac: false,
      host: document.body,
      userKeymap:
        '{ "version": 1, "bindings": [{ "keys": "<leader>t", "command": "sidebar.toggle", "context": "app" }] }',
    });
    boot.attach(keys.handle);
    press(document.body, " ");
    press(document.body, "t");
    press(document.body, " ");
    press(document.body, "e");
    expect(toggles).toBe(2);
  });
});

describe("bootKeys before the engine is in", () => {
  let stop: () => void = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("holds back the leader, the key after it and course keys, and hands them over in order", () => {
    const boot = bootKeys(window, false);
    stop = boot.stop;
    expect(press(document.body, " ")).toBe(false);
    expect(press(document.body, "Shift", { shiftKey: true })).toBe(true);
    expect(press(document.body, "e")).toBe(false);
    expect(press(document.body, "2", { code: "Digit2", ctrlKey: true })).toBe(false);
    // Everything else goes on as usual meanwhile.
    expect(press(document.body, "j")).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    expect(press(document.body, "0", { code: "Digit0", ctrlKey: true })).toBe(true);
    const seen: string[] = [];
    boot.attach((e) => seen.push(e.key));
    expect(seen).toEqual([" ", "e", "2"]);
    // From then on every key goes to the engine.
    press(document.body, "j");
    expect(seen).toEqual([" ", "e", "2", "j"]);
  });

  it("holds nothing where Space types or activates, held down, composed or modified", () => {
    const boot = bootKeys(window, false);
    stop = boot.stop;
    expect(press(put(`<input>`), " ")).toBe(true);
    expect(press(put(`<button>b</button>`), " ")).toBe(true);
    const insert = put(`<div class="lecture-buffer" data-vim-mode="insert"><div contenteditable="true">x</div></div>`);
    expect(press(insert.firstElementChild as Element, " ")).toBe(true);
    expect(press(document.body, " ", { repeat: true })).toBe(true);
    expect(press(document.body, " ", { shiftKey: true })).toBe(true);
    expect(press(document.body, " ", { ctrlKey: true })).toBe(true);
    expect(press(document.body, " ", { metaKey: true })).toBe(true);
    expect(press(document.body, " ", { altKey: true })).toBe(true);
    expect(press(document.body, " ", { isComposing: true })).toBe(true);
    expect(press(document.body, "1", { code: "Digit1", metaKey: true })).toBe(true);
    expect(press(document.body, "1", { code: "Digit1", ctrlKey: true, metaKey: true })).toBe(true);
    expect(press(document.body, "1", { code: "Digit1", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(press(document.body, "1", { code: "Digit1", ctrlKey: true, repeat: true })).toBe(true);
    const seen: string[] = [];
    boot.attach((e) => seen.push(e.key));
    expect(seen).toEqual([]);
  });

  it("forgets a held leader when an input method starts composing", () => {
    const boot = bootKeys(window, false);
    stop = boot.stop;
    press(document.body, " ");
    expect(press(document.body, "a", { isComposing: true })).toBe(true);
    expect(press(document.body, "e")).toBe(true);
    const seen: string[] = [];
    boot.attach((e) => seen.push(e.key));
    expect(seen).toEqual([" "]);
  });

  it("uses Cmd for the course keys on macOS", () => {
    const boot = bootKeys(window, true);
    stop = boot.stop;
    expect(press(document.body, "1", { code: "Digit1", ctrlKey: true })).toBe(true);
    expect(press(document.body, "1", { code: "Digit1", metaKey: true })).toBe(false);
  });
});
