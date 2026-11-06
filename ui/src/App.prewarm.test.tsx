// F-179: after the shell's first paint the app pre-warms the editor (features/buffer/prewarm.ts),
// unless a lecture is already open, which has warmed it for real. Frames are stepped by hand.
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFixture, trustScreen } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";

const warm = vi.hoisted(() => {
  const stop = vi.fn();
  return { stop, prewarmEditor: vi.fn(() => stop) };
});
vi.mock("./features/buffer/prewarm", () => warm);

const l07 = { path: "lectures/l07.md", name: "l07.md", text: "[First block]{#s1b1}\n" };
let frames: FrameRequestCallback[] = [];
const paint = () => {
  for (const f of frames.splice(0)) f(performance.now());
};
const marks = () => (window as unknown as { __mockStartup?: { paint: string }[] }).__mockStartup ?? [];

describe("editor pre-warm", () => {
  beforeEach(() => {
    installMockCore({
      ...defaultFixture,
      courseOpen: {
        path: "/c/STAT311",
        name: "STAT311",
        lectures: [l07],
        slides: [],
        sources: [],
        trust: "trusted",
        screen: trustScreen,
      },
      lectures: { [l07.path]: l07 },
    });
    (window as unknown as { __mockStartup?: unknown[] }).__mockStartup = [];
    warm.prewarmEditor.mockClear();
    warm.stop.mockClear();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("runs once the shell has painted and the editor has loaded, not before", async () => {
    const { container } = render(() => <App />);
    await new Promise((r) => setTimeout(r, 30));
    expect(warm.prewarmEditor).not.toHaveBeenCalled();
    paint();
    await waitFor(() => expect(container.querySelector(".lecture-buffer")).not.toBeNull());
    await waitFor(() => expect(warm.prewarmEditor).toHaveBeenCalledTimes(1));
  });

  it("removes the warm-up with the app, so nothing of it runs after the page is gone", async () => {
    const { container } = render(() => <App />);
    paint();
    await waitFor(() => expect(container.querySelector(".lecture-buffer")).not.toBeNull());
    await waitFor(() => expect(warm.prewarmEditor).toHaveBeenCalledTimes(1));
    expect(warm.stop).not.toHaveBeenCalled();
    cleanup();
    expect(warm.stop).toHaveBeenCalledTimes(1);
  });

  it("is skipped when a lecture opened before the editor loaded", async () => {
    const { container } = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    fireEvent.click(await screen.findByRole("button", { name: "l07.md" }));
    // The lecture is open before the first paint, so before the editor is asked for.
    await new Promise((r) => setTimeout(r, 30));
    paint();
    await waitFor(() => expect(container.querySelector(".cm-block")?.textContent).toBe("First block"));
    await waitFor(() => expect(marks().map((m) => m.paint)).toContain("shell_first_paint"));
    await new Promise((r) => setTimeout(r, 30));
    expect(warm.prewarmEditor).not.toHaveBeenCalled();
  });
});
