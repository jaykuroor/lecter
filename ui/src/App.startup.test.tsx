// F-179: the shell's first paint comes before any IPC call and before the buffer's chunk, and the
// UI reports its two startup paints to the core (14-quality.md#performance-budgets, cold_open_ms).
// Frames are stepped by hand: requestAnimationFrame callbacks run only when the test says so.
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFixture } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";

const l07 = { path: "lectures/l07.md", name: "l07.md", text: "[First block]{#s1b1}\n" };
const l08 = { path: "lectures/l08.md", name: "l08.md", text: "[Second block]{#s1b1}\n" };

let frames: FrameRequestCallback[] = [];
let asked: [string, unknown][] = [];

/** Runs the frames requested so far, as the browser does right before it paints. */
function paint(): void {
  for (const f of frames.splice(0)) f(performance.now());
}

/** Lets pending promises, messages and timers settle (no frame runs meanwhile). */
const settle = () => new Promise((r) => setTimeout(r, 30));

const calls = (cmd: string) => asked.filter(([c]) => c === cmd);

// The frames run CodeMirror's measures too; jsdom has no layout, so a range measures as nothing
// (as in src/features/buffer/__tests__/timeline.ts).
if (!("getClientRects" in Range.prototype)) {
  Object.assign(Range.prototype, { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() });
}

describe("startup", () => {
  beforeEach(() => {
    installMockCore({
      ...defaultFixture,
      courseOpen: { path: "/c/STAT311", name: "STAT311", lectures: [l07, l08], slides: [], trust: "trusted" },
      lectures: { [l07.path]: l07, [l08.path]: l08 },
    });
    asked = [];
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      asked.push([cmd, args ?? null]);
      return invoke(cmd, args);
    };
    frames = [];
    performance.clearMarks();
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks the core nothing and leaves the buffer out until the shell has painted", async () => {
    const { container } = render(() => <App />);
    await settle();
    expect(asked).toEqual([]);
    expect(container.querySelector(".lecture-buffer")).toBeNull();
    expect(performance.getEntriesByName("startup:shell_first_paint", "mark")).toHaveLength(0);
    expect(screen.getByRole("status", { name: "Status line" }).textContent).toBe("Connecting to core…");

    paint();
    await waitFor(() => expect(calls("app_info")).toHaveLength(1));
    // The mark is the first call, right after the paint; then the version, then the buffer.
    expect(asked[0]).toEqual(["app_mark_startup", { paint: "shell_first_paint" }]);
    expect(asked[1]?.[0]).toBe("app_info");
    // The page keeps a mark for the cold-open flow (tests/e2e/flows/cold-open.ts).
    expect(performance.getEntriesByName("startup:shell_first_paint", "mark")).toHaveLength(1);
    expect(await screen.findByText("v0.0.1")).toBeTruthy();
    await waitFor(() => expect(container.querySelector(".lecture-buffer")).not.toBeNull());
    // No lecture yet, so no buffer paint to report, however many frames follow.
    paint();
    await settle();
    paint();
    await settle();
    expect(calls("app_mark_startup")).toHaveLength(1);
  });

  it("marks the first lecture's paint once, after the frame that shows it", async () => {
    const { container } = render(() => <App />);
    paint();
    await waitFor(() => expect(container.querySelector(".lecture-buffer")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /open course folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")?.textContent).toBe("First block"));
    await settle();
    // On screen in the DOM, but no frame has been painted since.
    expect(calls("app_mark_startup")).toEqual([["app_mark_startup", { paint: "shell_first_paint" }]]);

    paint();
    await waitFor(() => expect(calls("app_mark_startup")).toHaveLength(2));
    expect(asked.at(-1)).toEqual(["app_mark_startup", { paint: "buffer_first_paint" }]);
    const opened = asked.findIndex(([c]) => c === "lecture_open");
    expect(opened).toBeGreaterThan(-1);
    expect(opened).toBeLessThan(asked.length - 1);

    // A second lecture is not the first paint.
    fireEvent.click(screen.getByRole("button", { name: "l08.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")?.textContent).toBe("Second block"));
    paint();
    await settle();
    paint();
    await settle();
    expect(calls("app_mark_startup")).toHaveLength(2);
  });

  it("a lecture opened straight after the first paint is marked once it shows", async () => {
    const { container } = render(() => <App />);
    paint();
    // Straight away, without waiting for the buffer.
    fireEvent.click(screen.getByRole("button", { name: /open course folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")?.textContent).toBe("First block"));
    paint();
    await waitFor(() =>
      expect(calls("app_mark_startup").map(([, a]) => a)).toEqual([
        { paint: "shell_first_paint" },
        { paint: "buffer_first_paint" },
      ]),
    );
  });

  it("an app gone before its lecture is painted doesn't mark it", async () => {
    const { container } = render(() => <App />);
    paint();
    fireEvent.click(screen.getByRole("button", { name: /open course folder/i }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    await waitFor(() => expect(container.querySelector(".cm-block")).not.toBeNull());
    cleanup();
    paint();
    await settle();
    expect(calls("app_mark_startup").map(([, a]) => a)).toEqual([{ paint: "shell_first_paint" }]);
  });

  it("an app gone before its first paint asks nothing", async () => {
    render(() => <App />);
    cleanup();
    paint();
    await settle();
    expect(asked).toEqual([]);
  });
});
