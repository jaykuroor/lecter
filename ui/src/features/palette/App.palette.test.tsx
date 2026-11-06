import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { App } from "../../App";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { commandEntries } from "./entries";

// F-041 in the app: the headerbar's buttons and Ctrl-Shift-P / Ctrl-p open the palette on the key
// engine's keymap and the switcher on the rail's courses and the open course's lectures; picking
// one opens it through the app's course and lecture state.

const l07 = { path: "lectures/l07-covariance.md", name: "l07-covariance.md", text: "[Zero.]{#s1b1}\n" };
const stat = {
  path: "/c/STAT311",
  name: "STAT311",
  lectures: [{ name: l07.name, path: l07.path }],
  slides: [],
  sources: [],
  trust: "trusted" as const,
  screen: trustScreen,
};
const calc = { ...stat, path: "/c/MATH221", name: "MATH221", lectures: [] };

const input = () => screen.getByRole("combobox") as HTMLInputElement;

/** Types `text` in the open box and presses Enter there. */
function pick(text: string): void {
  fireEvent.input(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: "Enter" });
}

describe("the palette in the app", () => {
  afterEach(cleanup);
  // Chunks the app loads after the engine's; they must run while the page is still here.
  afterAll(async () => {
    await Promise.all([import("../hints/mount"), import("../overlay/mount"), import("./mount")]);
  });

  it("lists the engine's commands, and jumps to a lecture and a course", async () => {
    installMockCore({
      ...defaultFixture,
      courseOpen: stat,
      rail: [{ path: calc.path, name: "Calculus II", icon: "C", color: "#26a269", missing: false }],
      switch: { [calc.path]: calc },
      lectures: { [l07.path]: l07 },
    });
    const { container } = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    await screen.findByRole("region", { name: "Course STAT311" });
    const goTo = screen.getByRole("button", { name: "Go to" }) as HTMLButtonElement;
    await waitFor(() => expect(goTo.disabled).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "Commands" }));
    const box = await screen.findByRole("dialog", { name: "Command palette" });
    expect(box.querySelectorAll('[role="option"]')).toHaveLength(commandEntries(DEFAULT_KEYMAP, false).length);
    fireEvent.keyDown(input(), { key: "Escape" });

    fireEvent.click(goTo);
    await screen.findByRole("dialog", { name: "Quick switcher" });
    pick("l07");
    await waitFor(() =>
      expect(container.querySelector(".lecture-buffer")?.getAttribute("data-lecture")).toBe(l07.path),
    );

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    await screen.findByRole("dialog", { name: "Quick switcher" });
    pick("calculus");
    await screen.findByRole("region", { name: "Course MATH221" });
  });
});
