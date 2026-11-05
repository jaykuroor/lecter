import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { defaultFixture } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";
import { runCommand } from "./keys/commands";
import { DEFAULT_KEYMAP } from "./keys/keymap";

// F-038: the hint bar's chunk loads after the engine's. An app closed while it loads never starts
// the bar: nothing is left behind (no ␣uh handler).

const gate = vi.hoisted(() => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open: () => open() };
});

vi.mock("./features/hints/mount", async (load) => {
  await gate.opened;
  return load();
});

const press = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

describe("the app's hint bar", () => {
  it("isn't started by an app that is gone by the time its chunk is in", async () => {
    installMockCore({ ...defaultFixture, keymaps: null });
    render(() => <App />);
    // The engine is in once Ctrl-9 goes through (src/App.keys.test.tsx); the bar's chunk waits.
    await waitFor(() => expect(press({ key: "9", code: "Digit9", ctrlKey: true })).toBe(true));
    expect(document.querySelector(".hint-bar")).toBeNull();
    cleanup();
    gate.open();
    await import("./features/hints/mount");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const hintDetail = DEFAULT_KEYMAP.find((b) => b.command === "ui.hintDetail");
    expect(hintDetail?.keys).toBe("<leader>uh");
    expect(runCommand({ binding: hintDetail as never, count: 1, explicit: false })).toBe(false);
  });
});
