// F-036: the sidebar is a chunk of its own (features/sidebar/load.ts): nothing of it loads before
// the shell's first paint (cold_open_ms, 14-quality.md#performance-budgets), and it starts loading
// right after that paint, so it is in by the time a course opens. Frames are stepped by hand.
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFixture, trustScreen } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";
import { loadSidebar } from "./features/sidebar/load";

vi.mock("./features/sidebar/load", async (original) => {
  const real = await original<typeof import("./features/sidebar/load")>();
  return { loadSidebar: vi.fn(real.loadSidebar) };
});

let frames: FrameRequestCallback[] = [];
const paint = () => {
  for (const f of frames.splice(0)) f(performance.now());
};
const settle = () => new Promise((r) => setTimeout(r, 30));

describe("the sidebar's chunk", () => {
  beforeEach(() => {
    installMockCore({
      ...defaultFixture,
      courseOpen: {
        path: "/c/STAT311",
        name: "STAT311",
        lectures: [{ name: "l07.md", path: "lectures/l07.md", date: "2026-10-23" }],
        slides: [],
        sources: [],
        trust: "trusted",
        screen: trustScreen,
      },
    });
    vi.mocked(loadSidebar).mockClear();
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads only after the shell's first paint, and shows the course from it", async () => {
    const { container } = render(() => <App />);
    await settle();
    expect(loadSidebar).not.toHaveBeenCalled();
    paint();
    await waitFor(() => expect(loadSidebar).toHaveBeenCalled());
    // The buffer's chunk loads after the paint too; the test ends only once it is in.
    await waitFor(() => expect(container.querySelector(".lecture-buffer")).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    const row = await screen.findByRole("button", { name: "l07.md, Oct 23" });
    expect(row.getAttribute("data-path")).toBe("lectures/l07.md");
  });
});
