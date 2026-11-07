import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { registerCommand } from "../../keys/commands";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { KeysList } from "./KeysList";
import { PerformancePreset } from "./PerformancePreset";
import { SettingsButton } from "./SettingsButton";

// The Settings window's smaller parts: the Keys page's list, the performance presets' words, and
// the headerbar's button.

afterEach(cleanup);

describe("the Keys page", () => {
  it("lists every command with its keys, and only its first row is a Tab stop", () => {
    render(() => <KeysList bindings={DEFAULT_KEYMAP} mac={false} />);
    const rows = [...document.querySelectorAll<HTMLElement>(".settings-keys-row")];
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.map((r) => r.tabIndex)).toEqual([0, ...Array(rows.length - 1).fill(-1)]);
    const settings = rows.find((r) => r.querySelector(".settings-label")?.textContent === "Settings");
    expect(settings?.querySelector("kbd")?.textContent).toBe("Ctrl-,");
  });
});

describe("the performance presets (12-settings-theme-onboarding.md#performance-preset)", () => {
  it("say what each does, in the spec's words, and hand the pick on as JSON", () => {
    const picks: string[] = [];
    render(() => (
      <PerformancePreset json={'"balanced"'} name="p" labelledBy="l" disabled={false} onPick={(j) => picks.push(j)} />
    ));
    expect([...document.querySelectorAll(".settings-preset-detail")].map((d) => d.textContent)).toEqual([
      "No Markdown highlighting and no live math in notes and glosses; math shows as its source text.",
      "Highlighting runs after typing pauses for 200 ms; math loads when it first comes into view.",
      "Highlighting and math update on every keystroke.",
    ]);
    fireEvent.click(screen.getByRole("radio", { name: /^Performance/ }));
    expect(picks).toEqual(['"performance"']);
  });
});

describe("the headerbar's Settings button", () => {
  it("shows Ctrl-, (⌘, on macOS) and runs the same command as the key", () => {
    const runs: unknown[] = [];
    const drop = registerCommand("settings.open", (call) => {
      runs.push(call);
      return true;
    });
    try {
      render(() => <SettingsButton mac={false} />);
      const button = screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe("Ctrl-,");
      fireEvent.click(button);
      expect(runs).toEqual([
        {
          binding: { keys: "<Mod-,>", command: "settings.open", scope: "global", desc: "Settings" },
          count: 1,
          explicit: false,
        },
      ]);
      cleanup();
      render(() => <SettingsButton mac={true} />);
      const mac = screen.getByRole("button", { name: "Settings" });
      expect(mac.getAttribute("aria-keyshortcuts")).toBe("Meta+Comma");
      expect(mac.textContent).toBe("⌘,");
    } finally {
      drop();
    }
  });

  it("is disabled until Settings is registered", () => {
    render(() => <SettingsButton mac={false} />);
    const button = screen.getByRole("button", { name: "Settings" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const drop = registerCommand("settings.open", () => true);
    expect(button.disabled).toBe(false);
    drop();
    expect(button.disabled).toBe(true);
  });
});
