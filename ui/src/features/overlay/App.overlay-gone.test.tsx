import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { defaultFixture } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { App } from "../../App";
import { runCommand } from "../../keys/commands";
import { DEFAULT_KEYMAP } from "../../keys/keymap";

// F-039: the keystroke overlay's chunk loads after the engine's. An app closed while it loads never
// starts the overlay: nothing is left behind (no ␣uk handler).

const gate = vi.hoisted(() => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
});

vi.mock("./mount", async (load) => {
  await gate.opened;
  return load();
});

const press = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

describe("the app's keystroke overlay", () => {
  it("isn't started by an app that is gone by the time its chunk is in", async () => {
    installMockCore({ ...defaultFixture, keymaps: null });
    render(() => <App />);
    // The engine is in once Ctrl-9 goes through (src/App.keys.test.tsx); the overlay's chunk waits.
    await waitFor(() => expect(press({ key: "9", code: "Digit9", ctrlKey: true })).toBe(true));
    cleanup();
    gate.open();
    await import("./mount");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const keystrokes = DEFAULT_KEYMAP.find((b) => b.command === "ui.keystrokes");
    expect(keystrokes?.keys).toBe("<leader>uk");
    expect(runCommand({ binding: keystrokes as never, count: 1, explicit: false })).toBe(false);
  });
});
