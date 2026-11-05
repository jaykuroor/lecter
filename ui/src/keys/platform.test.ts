import { describe, expect, it } from "vitest";
import { compileKeymap, KeyEngine } from "./engine";
import { DEFAULT_KEYMAP } from "./keymap";
import { eventToken } from "./notation";
import { isMacPlatform } from "./platform";

// Ctrl/Cmd-1…9 (10-keymap.md#global-os-conventions, D-190, D-192), as the rail's own listener had
// them before the key engine took them over: the course (0-based) a key opens, or null.
function courseSlot(e: KeyboardEvent, mac: boolean): number | null {
  const token = eventToken(e);
  if (token === null) return null;
  const out = new KeyEngine(compileKeymap(DEFAULT_KEYMAP, mac)).feed(token, "page", "normal", e.repeat);
  return out.kind === "run" && out.binding.command === "course.go" ? (out.binding.arg ?? null) : null;
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("course keys", () => {
  it("maps Ctrl-1…9 to the first to ninth course on Windows and Linux", () => {
    for (let n = 1; n <= 9; n++) {
      expect(courseSlot(key({ key: String(n), code: `Digit${n}`, ctrlKey: true }), false)).toBe(n - 1);
    }
  });

  it("maps Cmd-1…9 on macOS, where Ctrl-digit is left alone", () => {
    expect(courseSlot(key({ key: "1", code: "Digit1", metaKey: true }), true)).toBe(0);
    expect(courseSlot(key({ key: "9", code: "Digit9", metaKey: true }), true)).toBe(8);
    expect(courseSlot(key({ key: "1", code: "Digit1", ctrlKey: true }), true)).toBeNull();
    expect(courseSlot(key({ key: "1", code: "Digit1", metaKey: true }), false)).toBeNull();
  });

  it("ignores 0, a bare digit, letters and other modifiers", () => {
    expect(courseSlot(key({ key: "0", code: "Digit0", ctrlKey: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "1", code: "Digit1" }), false)).toBeNull();
    expect(courseSlot(key({ key: "j", code: "KeyJ", ctrlKey: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "1", code: "Digit1", ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "1", code: "Digit1", ctrlKey: true, metaKey: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "!", code: "Digit1", ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });

  it("goes by the digit key's place on layouts where it types something else (AZERTY &)", () => {
    expect(courseSlot(key({ key: "&", code: "Digit1", ctrlKey: true }), false)).toBe(0);
    expect(courseSlot(key({ key: "ç", code: "Digit9", ctrlKey: true }), false)).toBe(8);
  });

  it("goes by the character for a key without a code (a synthetic one)", () => {
    for (let n = 1; n <= 9; n++) {
      expect(courseSlot(key({ key: String(n), ctrlKey: true }), false)).toBe(n - 1);
    }
    expect(courseSlot(key({ key: "0", ctrlKey: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "a", ctrlKey: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "Digit1", ctrlKey: true }), false)).toBeNull();
    // With a code, the code decides: the digit row's place, not the keypad's.
    expect(courseSlot(key({ key: "1", code: "Numpad1", ctrlKey: true }), false)).toBeNull();
  });

  it("ignores a key held down (auto-repeat) and the keypad's other keys", () => {
    expect(courseSlot(key({ key: "2", code: "Digit2", ctrlKey: true, repeat: true }), false)).toBeNull();
    expect(courseSlot(key({ key: "+", code: "NumpadAdd", ctrlKey: true }), false)).toBeNull();
  });
});

describe("isMacPlatform", () => {
  it("is true only for an Apple platform", () => {
    expect(isMacPlatform({ platform: "MacIntel", userAgent: "" })).toBe(true);
    expect(isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)" })).toBe(true);
    expect(isMacPlatform({ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
    expect(isMacPlatform({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)" })).toBe(false);
    expect(isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
  });

  // WebKit on Linux (Playwright's Desktop Safari, some WebKitGTK builds) sends Safari's Mac user
  // agent: the platform wins, so Ctrl-1…9 keep working there.
  it("believes the platform over a user agent that claims a Mac", () => {
    const safari =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Safari/605.1.15";
    expect(isMacPlatform({ platform: "Linux x86_64", userAgent: safari })).toBe(false);
    expect(isMacPlatform({ platform: "Win32", userAgent: safari })).toBe(false);
    expect(isMacPlatform({ platform: "MacIntel", userAgent: safari })).toBe(true);
  });
});
