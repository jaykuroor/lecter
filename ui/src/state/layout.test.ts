import { describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import { createLayout } from "./layout";

// D-195: the sidebar's toggle survives restarts (app_layout_get / app_layout_save, state.db);
// the first start shows it.

type Internals = { __TAURI_INTERNALS__: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };
const saves = () => (window as unknown as { __mockLayout?: { sidebar: boolean }[] }).__mockLayout ?? [];

describe("createLayout", () => {
  it("shows the sidebar until the saved layout says otherwise", async () => {
    installMockCore({ ...defaultFixture, layout: { sidebar: false } });
    const layout = createLayout();
    expect(layout.sidebar()).toBe(true);
    await layout.load();
    expect(layout.sidebar()).toBe(false);
  });

  it("saves each toggle, and the next start reads it back", async () => {
    installMockCore({ ...defaultFixture, layout: { sidebar: true } });
    const first = createLayout();
    await first.load();
    first.toggleSidebar();
    expect(first.sidebar()).toBe(false);
    // The save goes out without being awaited; the mock records it.
    await Promise.resolve();
    expect(saves()).toEqual([{ sidebar: false }]);
    // A restart: a new layout state over the same core.
    const next = createLayout();
    await next.load();
    expect(next.sidebar()).toBe(false);
    next.toggleSidebar();
    await Promise.resolve();
    expect(next.sidebar()).toBe(true);
    expect(saves()).toEqual([{ sidebar: false }, { sidebar: true }]);
  });

  it("keeps a toggle made before the saved layout arrives", async () => {
    installMockCore({ ...defaultFixture, layout: { sidebar: true } });
    const layout = createLayout();
    const loading = layout.load();
    layout.toggleSidebar();
    await loading;
    expect(layout.sidebar()).toBe(false);
  });

  it("shows the sidebar when the core can't answer, and keeps toggling when it can't save", async () => {
    installMockCore({ ...defaultFixture, layout: { sidebar: false } });
    const w = window as unknown as Internals;
    // The core's own error (a broken state.db) …
    w.__TAURI_INTERNALS__.invoke = () =>
      Promise.reject({ code: "E_IO", message: "Lecter could not remember the window's layout.", retryable: false });
    const refused = createLayout();
    await refused.load();
    expect(refused.sidebar()).toBe(true);
    refused.toggleSidebar();
    await Promise.resolve();
    expect(refused.sidebar()).toBe(false);
    // … or no core at all.
    w.__TAURI_INTERNALS__.invoke = () => Promise.reject(new Error("no core"));
    const gone = createLayout();
    await gone.load();
    expect(gone.sidebar()).toBe(true);
    gone.toggleSidebar();
    await Promise.resolve();
    expect(gone.sidebar()).toBe(false);
  });
});
