import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { App } from "../../App";
import { SCHEMA_TEXT } from "../cmdline/__tests__/schemaText";

// F-045 in the app: Ctrl-, and the headerbar's button open Settings; a change is written through
// the core and applies at once (the hint bar's detail, the keystroke overlay); ␣uh and ␣uk write
// their settings; Esc closes the window and gives the focus back.

/** A keydown on `target`; whether the page let it through. */
const press = (target: EventTarget, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

const writes = () => (window as unknown as { __mockSettings?: unknown[] }).__mockSettings ?? [];
const reads = () => (window as unknown as { __mockSettingsReads?: string[] }).__mockSettingsReads ?? [];
const detail = () => document.querySelector(".hint-bar")?.getAttribute("data-detail") ?? "off";

async function start(values: Record<string, string> = {}): Promise<void> {
  const held = {
    "ui.performance": '"balanced"',
    "ui.hintBar": '"full"',
    "ui.keystrokes": "true",
    "ui.theme": "null",
    ...values,
  };
  installMockCore({
    ...defaultFixture,
    settings: {
      schema: SCHEMA_TEXT,
      values: Object.fromEntries(Object.entries(held).map(([k, v]) => [k, { value: v, source: "default" as const }])),
    },
  });
  render(() => <App />);
  // The engine loads after the first paint; until then Ctrl-9 is held back for it.
  await waitFor(() => expect(press(document.body, { key: "9", code: "Digit9", ctrlKey: true })).toBe(true));
  await waitFor(() => expect(document.querySelector(".hint-bar")).not.toBeNull());
}

const settingsButton = () => within(screen.getByRole("banner")).getByRole("button", { name: "Settings" });

describe("Settings in the app", () => {
  afterEach(cleanup);
  // The window's chunk may still be loading when a test ends.
  afterAll(async () => {
    await import("./mount");
  });

  it("opens with Ctrl-, and closes with Esc, giving the focus back (F-045 criterion 3)", async () => {
    await start();
    const button = settingsButton();
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Control+Comma");
    expect(button.textContent).toContain("Ctrl-,");
    button.focus();
    expect(press(button, { key: ",", code: "Comma", ctrlKey: true })).toBe(false);
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole("searchbox")));
    await waitFor(() => expect(within(dialog).getByRole("radiogroup", { name: "Hint bar" })).not.toBeNull());
    press(document.activeElement as HTMLElement, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("opens from the headerbar's button too, and applies a change at once (F-045 criterion 2)", async () => {
    await start();
    expect(detail()).toBe("full");
    await waitFor(() => expect((settingsButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(settingsButton());
    const group = await screen.findByRole("radiogroup", { name: "Hint bar" });
    fireEvent.click(within(group).getByRole("radio", { name: "Compact" }));
    await waitFor(() => expect(detail()).toBe("compact"));
    expect(writes()).toEqual([{ key: "ui.hintBar", value: '"compact"', course: null, scope: "global" }]);
    fireEvent.click(within(group).getByRole("radio", { name: "Off" }));
    await waitFor(() => expect(document.querySelector(".hint-bar")).toBeNull());
    fireEvent.click(screen.getByRole("checkbox", { name: "Keystrokes" }));
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[2]).toEqual({ key: "ui.keystrokes", value: "false", course: null, scope: "global" });
  });

  it("starts the hint bar at ui.hintBar, and ␣uh writes the next detail (F-038 note)", async () => {
    await start({ "ui.hintBar": '"compact"' });
    await waitFor(() => expect(detail()).toBe("compact"));
    press(document.body, { key: " ", code: "Space" });
    press(document.body, { key: "u", code: "KeyU" });
    press(document.body, { key: "h", code: "KeyH" });
    expect(detail()).toBe("off");
    await waitFor(() =>
      expect(writes()).toEqual([{ key: "ui.hintBar", value: '"off"', course: null, scope: "global" }]),
    );
  });

  it("starts the keystroke overlay at ui.keystrokes, and ␣uk writes it", async () => {
    await start({ "ui.keystrokes": "false" });
    // The overlay reads the setting after it starts; the answer applies in the same task.
    await waitFor(() => expect(reads()).toContain("ui.keystrokes"));
    await new Promise((r) => setTimeout(r, 0));
    press(document.body, { key: " ", code: "Space" });
    press(document.body, { key: "u", code: "KeyU" });
    press(document.body, { key: "k", code: "KeyK" });
    await waitFor(() =>
      expect(writes()).toEqual([{ key: "ui.keystrokes", value: "true", course: null, scope: "global" }]),
    );
  });
});
