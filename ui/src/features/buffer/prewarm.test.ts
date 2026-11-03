// F-179: the editor pre-warm builds one hidden throwaway buffer, once per page, and removes it
// after its first frame. Frames are stepped by hand.
import { afterEach, describe, expect, it, vi } from "vitest";
import { prewarmEditor } from "./prewarm";
import "./__tests__/timeline";

describe("prewarmEditor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds a hidden lecture buffer off screen, once, and removes it after a frame", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));

    prewarmEditor();
    const hosts = document.querySelectorAll<HTMLElement>(".buffer-prewarm");
    expect(hosts).toHaveLength(1);
    const host = hosts[0] as HTMLElement;
    expect(host.parentElement).toBe(document.body);
    // Never seen or read: hidden from assistive tools, inert, not drawn, off screen.
    expect(host.getAttribute("aria-hidden")).toBe("true");
    expect(host.inert).toBe(true);
    expect(host.style.visibility).toBe("hidden");
    expect(host.style.position).toBe("fixed");
    expect(host.style.left).toBe("-10000px");
    // A real lecture buffer: the decorations drew its slide heading and blocks.
    expect(host.querySelector(".cm-editor .cm-content")?.getAttribute("aria-label")).toBe("Warm-up");
    expect(host.querySelector(".slide-heading")?.textContent).toContain("Expectation");
    expect(host.querySelectorAll(".cm-block").length).toBeGreaterThanOrEqual(2);

    // A second call on the same page builds nothing.
    prewarmEditor();
    expect(document.querySelectorAll(".buffer-prewarm")).toHaveLength(1);

    // Still there until its first frame has run, then gone with the task after it.
    await new Promise((r) => setTimeout(r, 10));
    expect(host.isConnected).toBe(true);
    for (const f of frames.splice(0)) f(performance.now());
    await new Promise((r) => setTimeout(r, 10));
    expect(host.isConnected).toBe(false);
    expect(document.querySelector(".cm-editor")).toBeNull();
  });
});
