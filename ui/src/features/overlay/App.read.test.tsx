import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { App } from "../../App";

// F-039 in the app: the keystroke overlay shows the keys typed over the document, and read mode
// (␣ur, or the headerbar's Read mode button) hides the rail, the sidebar, the hint bar and the
// overlay and shows them again (09-ui.md#hint-bar-and-keystroke-overlay).

/** A keydown on the page; whether the page let it through. */
const press = (init: KeyboardEventInit) =>
  document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
const typeKeys = (...keys: string[]) => {
  for (const key of keys) press({ key });
};
const frame = () => document.querySelector(".app-frame") as HTMLElement;
const readButton = () => within(screen.getByRole("banner")).getByRole("button", { name: "Read mode" });
const keycaps = () => [...document.querySelectorAll(".keystroke-overlay kbd")].map((k) => k.textContent);

/** The app with its key engine, hint bar and overlay in. */
async function start(): Promise<void> {
  installMockCore({ ...defaultFixture, keymaps: null });
  render(() => <App />);
  await waitFor(() => expect(document.querySelector(".hint-bar")).not.toBeNull());
  await waitFor(() => expect(press({ key: "9", code: "Digit9", ctrlKey: true })).toBe(true));
}

describe("read mode and the keystroke overlay in the app", () => {
  afterEach(cleanup);

  it("shows the keys typed in the overlay, in the document", async () => {
    await start();
    typeKeys("x", "y");
    await waitFor(() => expect(keycaps().slice(-2)).toEqual(["x", "y"]));
    const overlay = document.querySelector(".keystroke-overlay");
    expect(overlay?.closest(".buffer")).not.toBeNull();
  });

  it("␣ur turns read mode on and off; the headerbar button shows it and does the same", async () => {
    await start();
    expect(frame().classList.contains("read-mode")).toBe(false);
    expect(readButton().getAttribute("aria-pressed")).toBe("false");
    expect(readButton().title).toBe("Read mode: hide the rail, sidebar and hints (␣ur)");
    typeKeys(" ", "u", "r");
    expect(frame().classList.contains("read-mode")).toBe(true);
    expect(readButton().getAttribute("aria-pressed")).toBe("true");
    expect(readButton().title).toBe("Leave read mode (␣ur)");
    // What read mode hides: the rail column (rail and sidebar), the hint bar and the overlay.
    expect(document.querySelector(".read-mode .rail #sidebar")).not.toBeNull();
    expect(document.querySelector(".read-mode .hint-bar-host .hint-bar")).not.toBeNull();
    expect(document.querySelector(".read-mode .keystroke-overlay-host")).not.toBeNull();
    typeKeys(" ", "u", "r");
    expect(frame().classList.contains("read-mode")).toBe(false);

    fireEvent.click(readButton());
    expect(frame().classList.contains("read-mode")).toBe(true);
    fireEvent.click(readButton());
    expect(frame().classList.contains("read-mode")).toBe(false);
    expect(readButton().getAttribute("aria-keyshortcuts")).toBe("Space u r");
  });
});
