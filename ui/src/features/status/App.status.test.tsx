import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import { sampleLecture } from "../../../e2e/mock-core/lectures";
import { App } from "../../App";

// F-046 in the app: the status line follows the open lecture's buffer (Vim's mode, the cursor's
// slide), Lecter's command line (COMMAND) and the answers the buffer asks for (spinner, model).

type Cm = Parameters<typeof Vim.handleKey>[0];

if (!("getClientRects" in Range.prototype)) {
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });
}

const lecture = {
  path: "lectures/2026-10-23-l07-covariance.md",
  name: "2026-10-23-l07-covariance.md",
  text: sampleLecture,
};

/** The app with a course and its lecture open; the lecture's Vim. */
async function start(): Promise<{ container: HTMLElement; cm: Cm }> {
  installMockCore({
    ...defaultFixture,
    // No deltas: the mocked stream ends at once, so no timer of it outlives this file's jsdom.
    gloss: { deltas: [], deltaMs: 0 },
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
  });
  const { container } = render(() => <App />);
  fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
  fireEvent.click(await screen.findByRole("button", { name: lecture.name }));
  await waitFor(() => expect(container.querySelector(".cm-block")).not.toBeNull());
  const editor = container.querySelector(".cm-editor") as HTMLElement;
  return { container, cm: getCM(EditorView.findFromDOM(editor) as EditorView) as Cm };
}

/** The text of the status line's segment `part`, or `null` when it isn't shown. */
const seg = (part: string) =>
  screen.getByRole("status", { name: "Status line" }).querySelector(`.status-${part}`)?.textContent ?? null;

describe("the status line in the app", () => {
  afterEach(cleanup);
  // The hint bar's and overlay's chunks load after the key engine's; wait for them before jsdom goes.
  afterAll(async () => {
    await Promise.all([import("../hints/mount"), import("../overlay/mount")]);
  });

  it("shows the course/lecture and the slide, and follows Vim's mode and the cursor", async () => {
    const { cm } = await start();
    expect(seg("mode")).toBe("NORMAL");
    expect(seg("place")).toBe("STAT311/l07");
    expect(seg("slide")).toBe("1/3");
    Vim.handleKey(cm, "i", "user");
    expect(seg("mode")).toBe("INSERT");
    Vim.handleKey(cm, "<Esc>", "user");
    expect(seg("mode")).toBe("NORMAL");
    Vim.handleKey(cm, "G", "user");
    expect(seg("slide")).toBe("3/3");
  });

  it("is COMMAND while Lecter's command line is open", async () => {
    const { container, cm } = await start();
    // The command line's chunk comes after the editor's: press `:` until it is in.
    await waitFor(() => {
      if (!container.querySelector(".cmdline")) Vim.handleKey(cm, ":", "user");
      expect(container.querySelector(".cmdline-host .cmdline")).not.toBeNull();
    });
    expect(seg("mode")).toBe("COMMAND");
    const input = container.querySelector(".cmdline-input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(container.querySelector(".cmdline-host .cmdline")).toBeNull());
    expect(seg("mode")).toBe("NORMAL");
  });

  it("turns the spinner while an answer streams, then names the model it came from", async () => {
    const { container, cm } = await start();
    expect(seg("model")).toBeNull();
    Vim.handleKey(cm, "a", "user");
    const input = container.querySelector(".gloss-prompt-input") as HTMLTextAreaElement;
    input.value = "why?";
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("1 AI job running");
    await waitFor(() => expect(seg("jobs")).toBeNull());
    expect(seg("model")).toBe("sample");
  });
});
