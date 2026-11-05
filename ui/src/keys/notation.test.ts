import { describe, expect, it } from "vitest";
import { eventToken, keyLabel, parseKeys } from "./notation";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("eventToken", () => {
  it("gives a typed character as itself, Shift included in it", () => {
    expect(eventToken(key({ key: "s", code: "KeyS" }))).toBe("s");
    expect(eventToken(key({ key: "S", code: "KeyS", shiftKey: true }))).toBe("S");
    expect(eventToken(key({ key: "?", code: "Slash", shiftKey: true }))).toBe("?");
    expect(eventToken(key({ key: "'", code: "Quote" }))).toBe("'");
    expect(eventToken(key({ key: "é" }))).toBe("é");
  });

  it("names the special keys, with Shift written out", () => {
    expect(eventToken(key({ key: " ", code: "Space" }))).toBe("<Space>");
    expect(eventToken(key({ key: "Enter" }))).toBe("<CR>");
    expect(eventToken(key({ key: "Tab" }))).toBe("<Tab>");
    expect(eventToken(key({ key: "Tab", shiftKey: true }))).toBe("<S-Tab>");
    expect(eventToken(key({ key: " ", shiftKey: true }))).toBe("<S-Space>");
    expect(eventToken(key({ key: "Escape" }))).toBe("<Esc>");
    expect(eventToken(key({ key: "Backspace" }))).toBe("<BS>");
    expect(eventToken(key({ key: "Delete" }))).toBe("<Del>");
    expect(eventToken(key({ key: "Insert" }))).toBe("<Ins>");
    expect(eventToken(key({ key: "ArrowLeft" }))).toBe("<Left>");
    expect(eventToken(key({ key: "ArrowRight" }))).toBe("<Right>");
    expect(eventToken(key({ key: "ArrowUp" }))).toBe("<Up>");
    expect(eventToken(key({ key: "ArrowDown" }))).toBe("<Down>");
    expect(eventToken(key({ key: "Home" }))).toBe("<Home>");
    expect(eventToken(key({ key: "End" }))).toBe("<End>");
    expect(eventToken(key({ key: "PageUp" }))).toBe("<PageUp>");
    expect(eventToken(key({ key: "PageDown" }))).toBe("<PageDown>");
    expect(eventToken(key({ key: "F5" }))).toBe("<F5>");
    expect(eventToken(key({ key: "F12", ctrlKey: true }))).toBe("<C-F12>");
  });

  it("is null for a modifier alone and for keys that type nothing nameable", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "OS", "Hyper", "Super"]) {
      expect(eventToken(key({ key: k })), k).toBeNull();
    }
    expect(eventToken(key({ key: "Dead" }))).toBeNull();
    expect(eventToken(key({ key: "Unidentified" }))).toBeNull();
    expect(eventToken(key({ key: "Process" }))).toBeNull();
    expect(eventToken(key({ key: "F123" }))).toBeNull();
    expect(eventToken(key({ key: "Unidentified", ctrlKey: true }))).toBeNull();
  });

  it("writes modifiers in the order C A S D", () => {
    expect(eventToken(key({ key: "d", code: "KeyD", ctrlKey: true }))).toBe("<C-d>");
    expect(eventToken(key({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }))).toBe("<C-S-p>");
    expect(eventToken(key({ key: "1", code: "Digit1", metaKey: true }))).toBe("<D-1>");
    expect(eventToken(key({ key: "ArrowLeft", altKey: true }))).toBe("<A-Left>");
    expect(
      eventToken(key({ key: "x", code: "KeyX", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true })),
    ).toBe("<C-A-S-D-x>");
  });

  it("goes by the key's place with a modifier held (AZERTY digits, Cyrillic letters)", () => {
    expect(eventToken(key({ key: "&", code: "Digit1", ctrlKey: true }))).toBe("<C-1>");
    expect(eventToken(key({ key: "ç", code: "Digit9", ctrlKey: true }))).toBe("<C-9>");
    expect(eventToken(key({ key: "з", code: "KeyP", ctrlKey: true }))).toBe("<C-p>");
    expect(eventToken(key({ key: "1", code: "Numpad1", ctrlKey: true }))).toBe("<C-k1>");
    expect(eventToken(key({ key: "+", code: "NumpadAdd", ctrlKey: true }))).toBe("<C-+>");
    expect(eventToken(key({ key: "/", code: "Slash", ctrlKey: true }))).toBe("<C-/>");
  });

  it("goes by the character for a synthetic key without a code", () => {
    expect(eventToken(key({ key: "1", ctrlKey: true }))).toBe("<C-1>");
    expect(eventToken(key({ key: "J", ctrlKey: true }))).toBe("<C-j>");
    expect(eventToken(key({ key: "Digit1", ctrlKey: true }))).toBeNull();
  });
});

describe("parseKeys", () => {
  it("splits plain keys into one token each", () => {
    expect(parseKeys("gd", false)).toEqual(["g", "d"]);
    expect(parseKeys("]]", false)).toEqual(["]", "]"]);
    expect(parseKeys("'", false)).toEqual(["'"]);
    expect(parseKeys("S", false)).toEqual(["S"]);
  });

  it("reads <leader>, named keys in any case and <lt>", () => {
    expect(parseKeys("<leader>e", false)).toEqual(["<Space>", "e"]);
    expect(parseKeys("<Leader><leader>", false)).toEqual(["<Space>", "<Space>"]);
    expect(parseKeys("<cr><Enter><Return>", false)).toEqual(["<CR>", "<CR>", "<CR>"]);
    expect(parseKeys("<tab><esc><bs><del><ins>", false)).toEqual(["<Tab>", "<Esc>", "<BS>", "<Del>", "<Ins>"]);
    expect(parseKeys("<left><right><up><down>", false)).toEqual(["<Left>", "<Right>", "<Up>", "<Down>"]);
    expect(parseKeys("<home><end><pageup><pagedown>", false)).toEqual(["<Home>", "<End>", "<PageUp>", "<PageDown>"]);
    expect(parseKeys("<space>", false)).toEqual(["<Space>"]);
    expect(parseKeys("<lt>", false)).toEqual(["<"]);
    expect(parseKeys("<f5><k3>", false)).toEqual(["<F5>", "<k3>"]);
  });

  it("takes a < that starts no name as the key itself", () => {
    expect(parseKeys("<<", false)).toEqual(["<", "<"]);
    expect(parseKeys("<", false)).toEqual(["<"]);
    expect(parseKeys(">>", false)).toEqual([">", ">"]);
    expect(parseKeys("<<>", false)).toEqual(["<", "<", ">"]);
  });

  it("normalises modifiers: order, case, and the letter under them", () => {
    expect(parseKeys("<C-D>", false)).toEqual(["<C-d>"]);
    expect(parseKeys("<s-c-P>", false)).toEqual(["<C-S-p>"]);
    expect(parseKeys("<D-A-x>", false)).toEqual(["<A-D-x>"]);
    expect(parseKeys("<A-left>", false)).toEqual(["<A-Left>"]);
  });

  it("turns <Mod-…> into Ctrl, or Cmd on macOS", () => {
    expect(parseKeys("<Mod-1>", false)).toEqual(["<C-1>"]);
    expect(parseKeys("<Mod-1>", true)).toEqual(["<D-1>"]);
    expect(parseKeys("<Mod-S-p>", true)).toEqual(["<S-D-p>"]);
    expect(parseKeys("<mod-,>", false)).toEqual(["<C-,>"]);
  });

  it("matches what eventToken makes of the same key", () => {
    const pairs: [string, KeyboardEventInit][] = [
      ["<C-S-p>", { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }],
      ["<Mod-1>", { key: "1", code: "Digit1", ctrlKey: true }],
      ["<CR>", { key: "Enter" }],
      ["<A-Right>", { key: "ArrowRight", altKey: true }],
    ];
    for (const [keys, init] of pairs) expect(parseKeys(keys, false), keys).toEqual([eventToken(key(init))]);
  });

  it("refuses an empty binding and unknown names", () => {
    expect(() => parseKeys("", false)).toThrow("empty keys");
    expect(() => parseKeys("<C-bogus>", false)).toThrow("unknown key name <C-bogus>");
    expect(() => parseKeys("<Bogus>", false)).toThrow("unknown key name <Bogus>");
  });
});

describe("keyLabel", () => {
  it("shows Space, Enter and arrows as symbols and letters as typed", () => {
    expect(keyLabel("<Space>", false)).toBe("␣");
    expect(keyLabel("<CR>", false)).toBe("↵");
    expect(keyLabel("<BS>", false)).toBe("⌫");
    expect(keyLabel("<Left>", false)).toBe("←");
    expect(keyLabel("<Right>", false)).toBe("→");
    expect(keyLabel("<Esc>", false)).toBe("Esc");
    expect(keyLabel("<Tab>", false)).toBe("Tab");
    expect(keyLabel("e", false)).toBe("e");
    expect(keyLabel("<", false)).toBe("<");
  });

  it("spells out modifiers on Windows and Linux and uses symbols on macOS", () => {
    expect(keyLabel("<C-d>", false)).toBe("Ctrl-d");
    expect(keyLabel("<C-A-S-D-x>", false)).toBe("Ctrl-Alt-Shift-Super-x");
    expect(keyLabel("<A-Left>", false)).toBe("Alt-←");
    expect(keyLabel("<D-1>", true)).toBe("⌘1");
    expect(keyLabel("<C-A-S-D-x>", true)).toBe("⌃⌥⇧⌘x");
  });
});
