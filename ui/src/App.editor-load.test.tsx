// F-179: `:find` comes with the buffer's chunk, after the first paint. An app closed while that
// chunk is still loading must not define `:find` for itself once it arrives. The load is held
// back here (the exCommand module waits for `release`) so the close lands inside it.
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultFixture } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";

const gate = vi.hoisted(() => {
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  return { held, release: () => release(), registered: vi.fn() };
});

vi.mock("./features/find/exCommand", async (original) => {
  await gate.held;
  const real = await original<typeof import("./features/find/exCommand")>();
  return {
    ...real,
    registerFindCommand: (...args: Parameters<typeof real.registerFindCommand>) => {
      gate.registered(...args);
      return real.registerFindCommand(...args);
    },
  };
});

let frames: FrameRequestCallback[] = [];

describe("loading the editor", () => {
  beforeEach(() => {
    installMockCore(defaultFixture);
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("an app closed while the editor loads doesn't define :find; an open one does", async () => {
    const marks = () => (window as unknown as { __mockStartup?: unknown[] }).__mockStartup?.length ?? 0;
    const before = marks();
    render(() => <App />);
    for (const f of frames.splice(0)) f(performance.now());
    // The shell has painted and asked for the editor, which is held back.
    await waitFor(() => expect(marks()).toBe(before + 1));
    cleanup();

    const { container } = render(() => <App />);
    for (const f of frames.splice(0)) f(performance.now());
    await waitFor(() => expect(marks()).toBe(before + 2));

    gate.release();
    await waitFor(() => expect(container.querySelector(".lecture-buffer")).not.toBeNull());
    await waitFor(() => expect(gate.registered).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    // Only the open app's `:find` handler.
    expect(gate.registered).toHaveBeenCalledTimes(1);
  });
});
