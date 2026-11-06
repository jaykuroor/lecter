import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { ThemeUpdate } from "../core/bindings";
import { applyTheme, followTheme } from "./gtk";

const night: ThemeUpdate = {
  theme: "Nightish",
  scheme: "dark",
  tokens: [
    { name: "window-bg", value: "#1e1e1e" },
    { name: "borders", value: "rgba(0, 0, 0, 0.15)" },
  ],
};

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
});

const prop = (name: string) => root.style.getPropertyValue(`--${name}`);

describe("applyTheme", () => {
  it("sets each token as a custom property and the scheme as data-theme", () => {
    applyTheme(night, root);
    expect(prop("window-bg")).toBe("#1e1e1e");
    expect(prop("borders")).toBe("rgba(0, 0, 0, 0.15)");
    expect(root.dataset.theme).toBe("dark");
  });

  it("clears the tokens the next update no longer sets, and the scheme it set", () => {
    applyTheme(night, root);
    applyTheme({ theme: null, scheme: null, tokens: [{ name: "accent-bg", value: "#e62d42" }] }, root);
    expect(prop("window-bg")).toBe("");
    expect(prop("borders")).toBe("");
    expect(prop("accent-bg")).toBe("#e62d42");
    expect(root.dataset.theme).toBeUndefined();
    applyTheme({ theme: null, scheme: null, tokens: [] }, root);
    expect(root.style.length).toBe(0);
  });

  it("leaves a data-theme it didn't set alone when the update has no scheme", () => {
    root.dataset.theme = "light";
    applyTheme({ theme: null, scheme: null, tokens: [] }, root);
    expect(root.dataset.theme).toBe("light");
    // Still not its own after a second update without a scheme.
    applyTheme({ theme: null, scheme: null, tokens: [] }, root);
    expect(root.dataset.theme).toBe("light");
    applyTheme({ theme: "Variant", scheme: "dark", tokens: [] }, root);
    expect(root.dataset.theme).toBe("dark");
  });

  it("refuses a name or value that isn't one the core formats", () => {
    const bad = [
      { name: "window-bg", value: "red" },
      { name: "window-bg", value: "#fff" },
      { name: "window-bg", value: "url(https://example.com/x.png)" },
      { name: "window-bg", value: "#1e1e1e; background: url(x)" },
      { name: "window-bg", value: "rgba(0, 0, 0, 0.15) !important" },
      { name: "window-bg", value: "rgba(0, 0, 0, 2)" },
      { name: "Window-bg", value: "#1e1e1e" },
      { name: "-window", value: "#1e1e1e" },
      { name: "a".repeat(41), value: "#1e1e1e" },
      { name: "x;y", value: "#1e1e1e" },
      { name: "window-bg", value: "url(x) #1e1e1e" },
      { name: "window-bg", value: "red; rgba(0, 0, 0, 0.5)" },
      { name: "y;window-bg", value: "#1e1e1e" },
    ];
    applyTheme({ theme: "Hostile", scheme: null, tokens: bad }, root);
    expect(root.style.length).toBe(0);
    applyTheme(
      {
        theme: "Edge",
        scheme: null,
        tokens: [
          { name: "a".repeat(40), value: "rgba(255, 255, 255, 1)" },
          { name: "k-derive", value: "rgba(1, 2, 3, .5)" },
          { name: "k2", value: "rgba(1, 2, 3, 0)" },
        ],
      },
      root,
    );
    expect(prop("a".repeat(40))).toBe("rgba(255, 255, 255, 1)");
    expect(prop("k-derive")).toBe("rgba(1, 2, 3, .5)");
    expect(prop("k2")).toBe("rgba(1, 2, 3, 0)");
  });

  it("keeps each root's own record", () => {
    const other = document.createElement("div");
    applyTheme(night, root);
    applyTheme({ theme: null, scheme: null, tokens: [] }, other);
    expect(prop("window-bg")).toBe("#1e1e1e");
  });
});

describe("followTheme", () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());
  const send = (update: ThemeUpdate) =>
    (window as unknown as { __mockThemeChanged: (u: ThemeUpdate) => void }).__mockThemeChanged(update);

  it("applies the core's current theme, then each change", async () => {
    installMockCore({ ...defaultFixture, theme: { update: night, installed: [] } });
    stop = await followTheme(root);
    expect(prop("window-bg")).toBe("#1e1e1e");
    send({ theme: "Greyish", scheme: "light", tokens: [{ name: "window-bg", value: "#f7f7f7" }] });
    expect(prop("window-bg")).toBe("#f7f7f7");
    expect(root.dataset.theme).toBe("light");
    stop();
    send(night);
    expect(prop("window-bg")).toBe("#f7f7f7");
  });

  it("drops a first answer older than a change that came before it", async () => {
    installMockCore({ ...defaultFixture, theme: { update: night, installed: [] } });
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, a?: unknown) => Promise<unknown> } };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === "theme_get")
        send({ theme: "Greyish", scheme: "light", tokens: [{ name: "window-bg", value: "#f7f7f7" }] });
      return invoke(cmd, args);
    };
    stop = await followTheme(root);
    expect(prop("window-bg")).toBe("#f7f7f7");
  });

  it("leaves the Lecter theme when the core can't answer", async () => {
    installMockCore(defaultFixture);
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, a?: unknown) => Promise<unknown> } };
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = (cmd, args) =>
      cmd === "theme_get" ? Promise.reject({ code: "E_INTERNAL", message: "no", retryable: false }) : invoke(cmd, args);
    stop = await followTheme(root);
    expect(root.style.length).toBe(0);
  });
});
