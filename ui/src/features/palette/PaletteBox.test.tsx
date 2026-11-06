import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { commandEntries, type SwitchEntry } from "./entries";
import { PaletteBox } from "./PaletteBox";
import { createPalette, type Palette } from "./state";

afterEach(cleanup);

const PLACES: SwitchEntry[] = [
  { id: "course:/s", kind: "course", label: "Statistics", detail: "/courses/STAT311", target: "/s", disabled: false },
  { id: "course:/g", kind: "course", label: "Gone", detail: "missing: /g", target: "/g", disabled: true },
  {
    id: "lecture:l07",
    kind: "lecture",
    label: "2026-10-23-l07-covariance.md",
    detail: "STAT311",
    target: "lectures/l07.md",
    disabled: false,
  },
];

function setup() {
  const log: string[] = [];
  let palette!: Palette;
  createRoot(() => {
    palette = createPalette({
      commands: () => commandEntries(DEFAULT_KEYMAP, false),
      canRun: (e) => e.binding.command === "sidebar.toggle",
      places: () => PLACES,
      restore: () => log.push("restore"),
      onCommand: (e) => log.push(`run ${e.id}`),
      onPlace: (e) => log.push(`go ${e.id}`),
    });
  });
  const outside = document.createElement("button");
  document.body.append(outside);
  render(() => <PaletteBox palette={palette} />);
  return { palette, log, outside };
}

const input = () => screen.getByRole("combobox");
const options = () => screen.queryAllByRole("option");
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(input(), { key: k, ...init });
const picked = () => options().find((o) => o.getAttribute("aria-selected") === "true");

describe("the palette box", () => {
  it("shows nothing until it opens, then a dialog with the field focused", async () => {
    const { palette } = setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    palette.open("commands");
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    await Promise.resolve();
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-label")).toBe("Command");
    expect(dialog.querySelector(".palette-notch")?.textContent).toBe("Commands");
  });

  it("lists every command with its keys as keycaps, and greys those that can't run", () => {
    const { palette } = setup();
    palette.open("commands");
    expect(options()).toHaveLength(commandEntries(DEFAULT_KEYMAP, false).length);
    const next = options().find((o) => o.querySelector(".palette-label")?.textContent === "Next slide") as HTMLElement;
    expect([...next.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl-j", "]]"]);
    expect(next.querySelector(".palette-detail")?.textContent).toBe("in the lecture");
    expect(next.getAttribute("aria-disabled")).toBe("true");
    const sidebar = options().find((o) => o.textContent?.includes("Toggle sidebar")) as HTMLElement;
    expect(sidebar.getAttribute("aria-disabled")).toBeNull();
    expect(sidebar.getAttribute("aria-keyshortcuts")).toBe("␣e");
  });

  it("filters as you type and marks the matched letters", () => {
    const { palette } = setup();
    palette.open("switch");
    expect(screen.getByRole("dialog", { name: "Quick switcher" })).toBeTruthy();
    fireEvent.input(input(), { target: { value: "l07" } });
    expect(options()).toHaveLength(1);
    const marks = [...(options()[0] as HTMLElement).querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["l07"]);
    expect(options()[0]?.querySelector(".palette-label")?.textContent).toBe("2026-10-23-l07-covariance.md");
    expect(options()[0]?.querySelector(".palette-kind")?.textContent).toBe("Lecture");
  });

  it("says when nothing matches", () => {
    const { palette } = setup();
    palette.open("switch");
    fireEvent.input(input(), { target: { value: "zzz" } });
    expect(options()).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("moves the pick with ↓/↑, Tab/Shift-Tab and Ctrl-j/Ctrl-k, and Enter takes it", () => {
    const { palette, log } = setup();
    palette.open("switch");
    expect(picked()?.textContent).toContain("Statistics");
    key("ArrowDown");
    expect(picked()?.textContent).toContain("Gone");
    key("Tab");
    expect(picked()?.textContent).toContain("covariance");
    key("Tab", { shiftKey: true });
    key("ArrowUp");
    expect(picked()?.textContent).toContain("Statistics");
    key("j", { ctrlKey: true });
    key("j", { ctrlKey: true });
    key("k", { ctrlKey: true });
    expect(picked()?.textContent).toContain("Gone");
    expect(input().getAttribute("aria-activedescendant")).toBe(picked()?.id);
    key("ArrowDown");
    key("Enter");
    expect(log).toEqual(["restore", "go lecture:l07"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves other keys to the field: they type", () => {
    const { palette } = setup();
    palette.open("switch");
    const e = new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true });
    input().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    const down = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    input().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("closes on Esc and gives the focus back", () => {
    const { palette, log } = setup();
    palette.open("commands");
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(log).toEqual(["restore"]);
  });

  it("takes a row on a click, keeping the focus in the field until then", () => {
    const { palette, log } = setup();
    palette.open("commands");
    const row = options().find((o) => o.textContent?.includes("Toggle sidebar")) as HTMLElement;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(log).toEqual(["restore", "run sidebar.toggle"]);
  });

  it("closes without taking the focus back when it moves out of the box", async () => {
    const { palette, log, outside } = setup();
    palette.open("switch");
    await Promise.resolve();
    outside.focus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(log).toEqual([]);
  });

  it("stays open while the focus moves inside it", async () => {
    const { palette } = setup();
    palette.open("switch");
    await Promise.resolve();
    (options()[0] as HTMLElement).focus();
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });
});
