import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import type { CourseOpened } from "../../core/bindings";
import { setSetting } from "../../core/settings";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { SCHEMA_TEXT } from "../cmdline/__tests__/schemaText";
import { type SettingsHandle, startSettings } from "./mount";

// The window in the page, over the mocked core: it opens on its search, gives the focus back when
// it closes, reads the open course's values, lists the installed themes, follows
// `settings:changed`, and stops listening when it stops.

const listening = () => (window as unknown as { __mockSettingsListeners: () => number }).__mockSettingsListeners();

const course = (trust: CourseOpened["trust"]): CourseOpened => ({
  path: "/c/STAT311",
  name: "STAT311",
  lectures: [],
  slides: [],
  sources: [],
  trust,
  screen: trustScreen,
});

let handle: SettingsHandle | null = null;
afterEach(() => {
  handle?.stop();
  handle = null;
  document.body.innerHTML = "";
  cleanup();
});

function start(open: CourseOpened | null = null) {
  installMockCore({
    ...defaultFixture,
    settings: {
      schema: SCHEMA_TEXT,
      values: {
        "ui.hintBar": { value: '"full"', source: "default" },
        "ui.keystrokes": { value: "true", source: "default" },
        "ui.theme": { value: "null", source: "default" },
      },
    },
    theme: {
      update: defaultFixture.theme.update,
      installed: [{ name: "Adwaita", folder: "/usr/share/themes/Adwaita" }],
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const [opened, setOpened] = createSignal<CourseOpened | null>(open);
  handle = startSettings({ host, mac: false, bindings: () => DEFAULT_KEYMAP, course: opened });
  return { host, handle, setOpened };
}

describe("startSettings", () => {
  it("opens on its search, and gives the focus back to where it was when it closes", async () => {
    const { handle: h } = start();
    const before = document.createElement("button");
    document.body.append(before);
    before.focus();
    h.open();
    const search = await screen.findByRole("searchbox", { name: "Search settings" });
    expect(document.activeElement).toBe(search);
    await screen.findByRole("radiogroup", { name: "Hint bar" });
    // Opening it again while it is open puts the focus back in its search; it stays one window.
    screen.getByRole("checkbox", { name: "Keystrokes" }).focus();
    fireEvent.input(search, { target: { value: "hint" } });
    h.open();
    expect(document.activeElement).toBe(search);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(before);
    // The next open starts with an empty search.
    h.open("performance");
    expect(((await screen.findByRole("searchbox", { name: "Search settings" })) as HTMLInputElement).value).toBe("");
    expect(await screen.findByRole("tabpanel", { name: "Performance" })).not.toBeNull();
  });

  it("lists the installed themes by name", async () => {
    start().handle.open();
    const theme = (await screen.findByRole("combobox", { name: "Theme" })) as HTMLSelectElement;
    await waitFor(() =>
      expect([...theme.options].map((o) => o.textContent)).toEqual(["Follow the desktop", "Adwaita"]),
    );
  });

  it("offers the course's own file only for a trusted course", async () => {
    const { handle: h, setOpened } = start(course("read_only"));
    h.open();
    const choice = (await screen.findByRole("radio", { name: "This course" })) as HTMLInputElement;
    expect(choice.disabled).toBe(true);
    setOpened(course("trusted"));
    expect((screen.getByRole("radio", { name: "This course (STAT311)" }) as HTMLInputElement).disabled).toBe(false);
    setOpened(null);
    expect((screen.getByRole("radio", { name: "This course" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("follows a change made elsewhere (settings:changed) while it is open", async () => {
    const { handle: h } = start();
    await waitFor(() => expect(listening()).toBe(1));
    h.open();
    const box = (await screen.findByRole("checkbox", { name: "Keystrokes" })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    await setSetting("ui.keystrokes", "false", null);
    await waitFor(() => expect(box.checked).toBe(false));
    expect(document.querySelector('[data-key="ui.keystrokes"] .settings-source')?.textContent).toBe("global");
  });

  it("takes its window away when it stops", async () => {
    const { handle: h } = start();
    h.open();
    await screen.findByRole("dialog", { name: "Settings" });
    h.stop();
    handle = null;
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stops listening when it stops, even before the listener was in", async () => {
    const { handle: h } = start();
    await waitFor(() => expect(listening()).toBe(1));
    h.stop();
    await waitFor(() => expect(listening()).toBe(0));
    handle = null;
    const { handle: early } = start();
    early.stop();
    handle = null;
    await waitFor(() => expect(listening()).toBe(0));
    await new Promise((r) => setTimeout(r, 0));
    expect(listening()).toBe(0);
  });
});
