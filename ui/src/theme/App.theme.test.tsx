import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import { App } from "../App";
import type { ThemeUpdate } from "../core/bindings";

// F-043: the app applies the core's GTK theme to the page root once it mounts, follows each
// `theme:changed`, and stops listening when it unmounts.

const greyish: ThemeUpdate = { theme: "Greyish", scheme: "light", tokens: [{ name: "window-bg", value: "#f7f7f7" }] };
const night: ThemeUpdate = { theme: "Nightish", scheme: "dark", tokens: [{ name: "window-bg", value: "#1e1e1e" }] };
const send = (update: ThemeUpdate) =>
  (window as unknown as { __mockThemeChanged: (u: ThemeUpdate) => void }).__mockThemeChanged(update);
const windowBg = () => document.documentElement.style.getPropertyValue("--window-bg");

describe("the app and the GTK theme", () => {
  afterEach(cleanup);
  afterAll(async () => {
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.theme;
    // The lazy chunks the app started loading must finish while jsdom is still here.
    await Promise.all([
      import("../keys/install"),
      import("../features/hints/mount"),
      import("../features/overlay/mount"),
    ]);
  });

  it("applies the core's theme on mount, follows changes, and stops when unmounted", async () => {
    installMockCore({ ...defaultFixture, theme: { update: greyish, installed: [] } });
    const { unmount } = render(() => <App />);
    await waitFor(() => expect(windowBg()).toBe("#f7f7f7"));
    expect(document.documentElement.dataset.theme).toBe("light");
    // The app keeps the follower once it has started (it only stops it after an unmount): let
    // the start-up chain and any unlisten it would do settle before the change arrives.
    await new Promise((resolve) => setTimeout(resolve, 0));
    send(night);
    expect(windowBg()).toBe("#1e1e1e");
    expect(document.documentElement.dataset.theme).toBe("dark");
    unmount();
    // The listener's unlisten is async underneath; let it run.
    await Promise.resolve();
    send(greyish);
    expect(windowBg()).toBe("#1e1e1e");
  });

  it("stops the follower that starts after the app is already gone", async () => {
    document.documentElement.removeAttribute("style");
    installMockCore({ ...defaultFixture, theme: { update: greyish, installed: [] } });
    // Unmount while the follower waits for the core's first answer: it already listens, and the
    // app is gone by the time it hands over its stopper.
    type Internals = { invoke: (cmd: string, args: unknown) => unknown };
    const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    let unmount: (() => void) | undefined;
    internals.invoke = (cmd, args) => {
      if (cmd === "theme_get") unmount?.();
      return invoke(cmd, args);
    };
    ({ unmount } = render(() => <App />));
    await waitFor(() => expect(windowBg()).toBe("#f7f7f7"));
    // Let the start-up chain hand over its stopper and the unlisten run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    send(night);
    expect(windowBg()).toBe("#f7f7f7");
  });
});
