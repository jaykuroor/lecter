import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { App } from "../../App";
import { SCHEMA_TEXT } from "./__tests__/schemaText";

// F-040 in the app: `:` in the open lecture opens the command line, and `:set` reaches the core
// through the settings commands, for the course open now.

type Cm = Parameters<typeof Vim.handleEx>[0];

if (!("getClientRects" in Range.prototype)) {
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });
}

const lecture = { path: "lectures/l07.md", name: "l07.md", text: "[Zero for independent variables.]{#s1b1}\n" };

/** The app with a course and its lecture open; the lecture's Vim. */
async function start(): Promise<{ container: HTMLElement; cm: Cm }> {
  installMockCore({
    ...defaultFixture,
    courseOpen: {
      path: "/c/STAT311",
      name: "STAT311",
      lectures: [lecture],
      slides: [],
      sources: [],
      trust: "trusted",
      screen: trustScreen,
    },
    lectures: { [lecture.path]: lecture },
    settings: { schema: SCHEMA_TEXT, values: { "ui.performance": { value: '"balanced"', source: "default" } } },
  });
  const { container } = render(() => <App />);
  fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
  fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
  await waitFor(() => expect(container.querySelector(".cm-block")).not.toBeNull());
  const editor = container.querySelector(".cm-editor") as HTMLElement;
  return { container, cm: getCM(EditorView.findFromDOM(editor) as EditorView) as Cm };
}

/** Presses `:` until the command line is in (its chunk comes after the editor's), then runs `line`. */
async function run(container: HTMLElement, cm: Cm, line: string): Promise<void> {
  await waitFor(() => {
    if (!container.querySelector(".cmdline")) Vim.handleKey(cm, ":", "user");
    expect(container.querySelector(".cmdline-host .cmdline")).not.toBeNull();
  });
  const input = container.querySelector(".cmdline-input") as HTMLInputElement;
  input.value = line;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

describe("the command line in the app", () => {
  afterEach(cleanup);
  // The app loads the hint bar's and the overlay's chunks after the key engine's; the test can end
  // first. Their modules must run while the page is still here (Solid's event delegation reads
  // `window` as a module loads), so the file waits for them before jsdom goes.
  afterAll(async () => {
    await Promise.all([import("../hints/mount"), import("../overlay/mount")]);
  });

  it(":set writes for the open course and :set key? reads it back (F-040 criteria 3 and 4)", async () => {
    const { container, cm } = await start();
    await run(container, cm, "set ui.performance?");
    await waitFor(() =>
      expect(container.querySelector(".cmdline-message-line")?.textContent).toBe("ui.performance=balanced (default)"),
    );
    await run(container, cm, "set ui.performance=quality");
    await waitFor(() =>
      expect(container.querySelector(".cmdline-message-line")?.textContent).toBe("ui.performance=quality (global)"),
    );
    expect(container.querySelector(".cmdline-message-note")?.textContent).toBe("Can add input lag on slower machines.");
    const w = window as unknown as { __mockSettings?: unknown[] };
    expect(w.__mockSettings).toEqual([{ key: "ui.performance", value: '"quality"', course: "/c/STAT311" }]);
  });
});
