import { cleanup, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture, type MockFixture } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";

// D-199: the app reads keymaps.jsonc (`keymaps_read`) once the key engine is in, lays it over the
// default keys, and shows what was wrong with it once in the status line; the defaults work
// before it arrives and stay when it can't be used.

const press = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
const toggle = () => within(screen.getByRole("banner")).getByRole("button", { name: "Sidebar" });
const notice = () => document.querySelector(".status-line .keys-notice");

/** The app with keymaps.jsonc as `keymaps`, once the engine is in (Ctrl-9 goes through). */
async function start(keymaps: MockFixture["keymaps"]): Promise<void> {
  installMockCore({ ...defaultFixture, keymaps });
  render(() => <App />);
  await waitFor(() => expect(press({ key: "9", code: "Digit9", ctrlKey: true })).toBe(true));
}

/** Whether ␣e (the default) still toggles the sidebar. */
async function defaultsWork(): Promise<void> {
  const before = toggle().getAttribute("aria-expanded");
  press({ key: " " });
  press({ key: "e" });
  await waitFor(() => expect(toggle().getAttribute("aria-expanded")).not.toBe(before));
}

describe("keymaps.jsonc", () => {
  afterEach(cleanup);

  it("lays the user's bindings over the defaults, with nothing to report", async () => {
    await start(
      '{ "version": 1, "bindings": [{ "keys": "<leader>t", "command": "sidebar.toggle", "context": "app" }] }',
    );
    await waitFor(() => {
      press({ key: " " });
      press({ key: "t" });
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
    });
    await defaultsWork();
    expect(notice()).toBeNull();
  });

  it("keeps the defaults and says so for a file that isn't JSONC", async () => {
    await start("{ nope");
    await waitFor(() => expect(notice()?.textContent).toBe("keymaps.jsonc is not valid JSONC; not read"));
    await defaultsWork();
  });

  it("keeps the defaults and says so for a file of another version", async () => {
    await start('{ "version": 2, "bindings": [] }');
    await waitFor(() =>
      expect(notice()?.textContent).toBe('keymaps.jsonc needs "version": 1 and a "bindings" list; not read'),
    );
    await defaultsWork();
  });

  it("skips a binding to an unknown command, and lists every problem in the notice's title", async () => {
    await start(
      '{ "version": 1, "bindings": [{ "keys": "<leader>e", "command": "no.such", "context": "app" }, { "keys": "<Bogus>", "command": "app.quit" }] }',
    );
    await waitFor(() =>
      expect(notice()?.textContent).toBe('keymaps.jsonc binding 1: unknown command "no.such"; ignored (+1 more)'),
    );
    expect(notice()?.getAttribute("title")).toBe(
      'keymaps.jsonc binding 1: unknown command "no.such"; ignored\nkeymaps.jsonc binding 2: "keys" "<Bogus>": unknown key name <Bogus>; ignored',
    );
    await defaultsWork();
  });

  it("keeps the defaults and shows the core's message for a file it refused", async () => {
    await start({ error: "keymaps.jsonc is larger than 256 KB; the default keys are used." });
    await waitFor(() =>
      expect(notice()?.textContent).toBe("keymaps.jsonc is larger than 256 KB; the default keys are used."),
    );
    await defaultsWork();
  });

  it("runs the default keys while the file is still on its way", async () => {
    installMockCore({ ...defaultFixture });
    const core = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, ...a: unknown[]) => unknown } })
      .__TAURI_INTERNALS__;
    const invoke = core.invoke;
    let asked = false;
    core.invoke = (cmd, ...a) => {
      if (cmd !== "keymaps_read") return invoke(cmd, ...a);
      asked = true;
      return new Promise(() => {});
    };
    render(() => <App />);
    await waitFor(() => expect(asked).toBe(true));
    await defaultsWork();
    expect(notice()).toBeNull();
  });
});
