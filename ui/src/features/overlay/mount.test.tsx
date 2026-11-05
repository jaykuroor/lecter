import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../../keys/commands";
import { type Keys, startKeys } from "../../keys/install";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { setBufferTarget } from "../../keys/locate";
import { FADE_AFTER_MS, FADE_MS, type OverlayHandle, startOverlay } from "./mount";

// 09-ui.md#hint-bar-and-keystroke-overlay: the keystroke overlay shows the keys typed, including
// pending sequences, and fades after 1.5 s; ui.keystrokes (␣uk) turns it off and on; read mode
// hides it. It draws at most once per frame, never in the keydown itself (keystroke_p99_ms).

let keys: Keys;
let host: HTMLElement;
let buffer: HTMLElement;
let overlay: OverlayHandle;
let hidden = false;
let dropBuffer: () => void;
/** The engine's listener before the overlay started (which-key's). */
let whichKeyListener: (pending: readonly string[]) => void;

/** A keydown on `target` (the buffer by default), through the engine and then the overlay, as App does. */
function press(key: string, init: KeyboardEventInit = {}, target: Element = buffer): void {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  keys.handle(e);
  overlay.typed(e);
}

const frame = () => vi.advanceTimersToNextFrame();
/** The overlay's keycaps as they read, a pending one with a `*`; `[]` when it doesn't show. */
const shown = () =>
  [...host.querySelectorAll(".keystroke-overlay kbd.keystroke-key")].map(
    (k) => `${k.textContent}${k.classList.contains("keystroke-pending") ? "*" : ""}`,
  );
const fading = () => host.querySelector(".keystroke-overlay")?.classList.contains("keystroke-overlay-fading");
const binding = (command: string) => DEFAULT_KEYMAP.find((b) => b.command === command) as (typeof DEFAULT_KEYMAP)[0];

beforeEach(() => {
  vi.useFakeTimers();
  hidden = false;
  buffer = document.createElement("div");
  buffer.tabIndex = 0;
  host = document.createElement("div");
  document.body.append(buffer, host);
  dropBuffer = setBufferTarget({
    root: buffer,
    mode: () => "normal",
    element: () => "slide-line",
    replay: () => {},
    focus: () => buffer.focus(),
  });
  keys = startKeys({ mac: false, host });
  buffer.focus();
  whichKeyListener = keys.engine.onChange;
  overlay = startOverlay({ engine: keys.engine, host, mac: false, hidden: () => hidden });
});
afterEach(() => {
  overlay.stop();
  keys.stop();
  dropBuffer();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the keystroke overlay", () => {
  it("shows the keys typed as keycaps in the next frame, not in the keydown", () => {
    press("j");
    press("k");
    press("j", { ctrlKey: true, code: "KeyJ" });
    expect(shown()).toEqual([]);
    frame();
    expect(shown()).toEqual(["j", "k", "Ctrl-j"]);
    expect(host.querySelector(".keystroke-overlay")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows a pending sequence as it is typed, and marks the keys the engine still holds", () => {
    press("j");
    press(" ");
    frame();
    expect(shown()).toEqual(["j", "␣*"]);
    press("u");
    frame();
    expect(shown()).toEqual(["j", "␣*", "u*"]);
    press("Escape");
    frame();
    expect(shown()).toEqual(["j", "␣", "u", "Esc"]);
    // A count waits for its motion too.
    press("3");
    frame();
    expect(shown()).toEqual(["j", "␣", "u", "Esc", "3*"]);
  });

  it("drops the pending mark when a click ends the sequence", () => {
    press(" ");
    frame();
    expect(shown()).toEqual(["␣*"]);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    frame();
    expect(shown()).toEqual(["␣"]);
  });

  it("fades 1.5 s after the last key, then is gone; a key before that keeps it", () => {
    press("j");
    frame();
    vi.advanceTimersByTime(1000);
    press("k");
    frame();
    // 09-ui.md: 1.5 s.
    vi.advanceTimersByTime(1499);
    expect(fading()).toBe(false);
    expect(shown()).toEqual(["j", "k"]);
    vi.advanceTimersByTime(1);
    expect(fading()).toBe(true);
    vi.advanceTimersByTime(FADE_MS - 1);
    expect(shown()).toEqual(["j", "k"]);
    vi.advanceTimersByTime(1);
    expect(shown()).toEqual([]);
    expect(host.querySelector(".keystroke-overlay")).toBeNull();
  });

  it("starts afresh when a key comes while it fades", () => {
    press("j");
    frame();
    vi.advanceTimersByTime(FADE_AFTER_MS);
    expect(fading()).toBe(true);
    press("x");
    frame();
    expect(shown()).toEqual(["x"]);
    expect(fading()).toBe(false);
    // And it fades 1.5 s after that key, not after the first.
    vi.advanceTimersByTime(FADE_MS);
    expect(shown()).toEqual(["x"]);
  });

  it("draws once per frame, however many keys come in it", () => {
    const frames = vi.spyOn(window, "requestAnimationFrame");
    press("j");
    press("k");
    press(" ");
    expect(frames).toHaveBeenCalledTimes(1);
    frame();
    expect(shown()).toEqual(["j", "k", "␣*"]);
    press("Escape");
    expect(frames).toHaveBeenCalledTimes(2);
  });

  it("keeps its time when only the engine changes: a click doesn't hold the fade back", () => {
    press(" ");
    frame();
    vi.advanceTimersByTime(1000);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    frame();
    expect(shown()).toEqual(["␣"]);
    vi.advanceTimersByTime(500);
    expect(fading()).toBe(true);
  });

  it("shows the last eight keys", () => {
    for (const k of "abcdefghi") press(k);
    frame();
    expect(shown()).toEqual(["b", "c", "d", "e", "f", "g", "h", "i"]);
  });

  it("leaves out modifiers pressed alone, keys of an input method and keys typed into a password", () => {
    const secret = document.createElement("input");
    secret.type = "password";
    document.body.append(secret);
    press("Shift", { shiftKey: true });
    press("a", { isComposing: true });
    press("p", {}, secret);
    frame();
    expect(shown()).toEqual([]);
    const plain = document.createElement("input");
    document.body.append(plain);
    press("p", {}, plain);
    frame();
    expect(shown()).toEqual(["p"]);
  });

  it("is on by default; ␣uk (ui.keystrokes) turns it off and on again", () => {
    press("j");
    frame();
    runCommand({ binding: binding("ui.keystrokes"), count: 1, explicit: false });
    frame();
    expect(shown()).toEqual([]);
    press("k");
    frame();
    expect(shown()).toEqual([]);
    // By key: ␣uk turns it on, and shows the keys that did.
    press(" ");
    press("u");
    press("k");
    frame();
    expect(shown()).toEqual(["␣", "u", "k"]);
  });

  it("shows the whole ␣uk that turns it on when a frame comes between the keys (WebKit)", () => {
    press(" ");
    press("u");
    press("k");
    frame();
    expect(shown()).toEqual([]);
    // Off: each key is drawn (as nothing) in a frame of its own before the next one comes.
    press(" ");
    frame();
    press("u");
    frame();
    expect(shown()).toEqual([]);
    press("k");
    frame();
    expect(shown()).toEqual(["␣", "u", "k"]);
  });

  it("while off, keeps only the keys the engine still holds", () => {
    runCommand({ binding: binding("ui.keystrokes"), count: 1, explicit: false });
    frame();
    // A sequence that broke off, and a count that went with its motion: nothing is held after.
    press(" ");
    frame();
    press("Escape");
    frame();
    press("3");
    frame();
    press("j");
    frame();
    // A key and a leader in one frame: only the leader is held.
    press("x");
    press(" ");
    frame();
    press("u");
    frame();
    press("k");
    frame();
    expect(shown()).toEqual(["␣", "u", "k"]);
  });

  it("turned on by mouse, shows the keys the engine still holds; after a click ended them, none", () => {
    const toggle = () => runCommand({ binding: binding("ui.keystrokes"), count: 1, explicit: false });
    toggle();
    frame();
    press(" ");
    frame();
    toggle();
    frame();
    expect(shown()).toEqual(["␣*"]);
    hidden = true;
    press("Escape");
    press(" ");
    frame();
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    hidden = false;
    frame();
    expect(shown()).toEqual([]);
    press("j");
    frame();
    expect(shown()).toEqual(["j"]);
  });

  it("starts off when ui.keystrokes is off", () => {
    overlay.stop();
    overlay = startOverlay({ engine: keys.engine, host, mac: false, hidden: () => hidden, on: false });
    press("j");
    frame();
    expect(shown()).toEqual([]);
  });

  it("shows nothing while hidden (read mode), and what is typed after", () => {
    press("j");
    frame();
    hidden = true;
    press("k");
    frame();
    expect(shown()).toEqual([]);
    hidden = false;
    press("l");
    frame();
    expect(shown()).toEqual(["l"]);
  });

  it("names Cmd keys the macOS way on a Mac", () => {
    overlay.stop();
    overlay = startOverlay({ engine: keys.engine, host, mac: true, hidden: () => hidden });
    press("k", { metaKey: true, code: "KeyK" });
    frame();
    expect(shown()).toEqual(["⌘k"]);
  });

  it("stops with nothing left waiting: no frame, no timer, even for keys after it", () => {
    press("j");
    frame();
    press("k");
    overlay.stop();
    expect(vi.getTimerCount()).toBe(0);
    overlay.typed(new KeyboardEvent("keydown", { key: "l" }));
    expect(vi.getTimerCount()).toBe(0);
    overlay = startOverlay({ engine: keys.engine, host, mac: false, hidden: () => hidden });
  });

  it("hands the engine's listener back on stop, unless something else took it since", () => {
    expect(keys.engine.onChange).not.toBe(whichKeyListener);
    overlay.stop();
    expect(keys.engine.onChange).toBe(whichKeyListener);
    overlay = startOverlay({ engine: keys.engine, host, mac: false, hidden: () => hidden });
    const other = () => {};
    keys.engine.onChange = other;
    overlay.stop();
    expect(keys.engine.onChange).toBe(other);
    keys.engine.onChange = whichKeyListener;
    overlay = startOverlay({ engine: keys.engine, host, mac: false, hidden: () => hidden });
  });

  it("stops: no overlay, ␣uk no longer handled, and which-key still follows the engine", () => {
    press("j");
    frame();
    overlay.stop();
    expect(host.querySelector(".keystroke-overlay")).toBeNull();
    expect(runCommand({ binding: binding("ui.keystrokes"), count: 1, explicit: false })).toBe(false);
    press(" ");
    vi.advanceTimersByTime(300);
    expect(host.querySelector(".which-key")).not.toBeNull();
    // A key after the stop draws nothing.
    frame();
    expect(host.querySelector(".keystroke-overlay")).toBeNull();
    overlay = startOverlay({ engine: keys.engine, host, mac: false, hidden: () => hidden });
  });
});
