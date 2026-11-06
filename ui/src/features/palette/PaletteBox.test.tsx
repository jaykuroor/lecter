import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { commandEntries, type SwitchEntry } from "./entries";
import { PaletteBox } from "./PaletteBox";
import { createPalette, type Palette, SHOWN_MAX } from "./state";

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

function setup(places: SwitchEntry[] = PLACES) {
  const log: string[] = [];
  let palette!: Palette;
  createRoot(() => {
    palette = createPalette({
      commands: () => commandEntries(DEFAULT_KEYMAP, false),
      canRun: (e) => e.binding.command === "sidebar.toggle",
      places: () => places,
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
    expect(next.getAttribute("aria-keyshortcuts")).toBe("Ctrl-j ]]");
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

  it("opens on an empty list", () => {
    const { palette } = setup([]);
    palette.open("switch");
    expect(options()).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeTruthy();
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
    expect(picked()?.textContent).toContain("Gone");
    key("j", { ctrlKey: true });
    expect(picked()?.textContent).toContain("covariance");
    key("k", { ctrlKey: true });
    expect(picked()?.textContent).toContain("Gone");
    expect(input().getAttribute("aria-activedescendant")).toBe(picked()?.id);
    key("ArrowDown");
    key("Enter");
    expect(log).toEqual(["restore", "go lecture:l07"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves the arrows with Alt or Cmd, and other Ctrl keys, to the field", () => {
    const { palette } = setup();
    palette.open("switch");
    for (const init of [
      { key: "ArrowDown", altKey: true },
      { key: "ArrowDown", metaKey: true },
      { key: "a", ctrlKey: true },
    ]) {
      const e = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      input().dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
      expect(picked()?.textContent).toContain("Statistics");
    }
  });

  it("names its parts for each list, and ties the field to the list", () => {
    const { palette } = setup();
    palette.open("commands");
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-label")).toBe("Commands");
    expect(input().getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.id).toBe("palette-options");
    expect(input().getAttribute("placeholder")).toBe("Run a command");
    expect(input().getAttribute("autocomplete")).toBe("off");
    expect(input().getAttribute("spellcheck")).toBe("false");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe("palette-option-0");
    expect((options()[0] as HTMLElement).tabIndex).toBe(-1);
    expect(screen.queryByText("No matches")).toBeNull();
    palette.open("switch");
    expect(listbox.getAttribute("aria-label")).toBe("Places");
    expect(input().getAttribute("aria-label")).toBe("Go to");
    expect(input().getAttribute("placeholder")).toBe("Go to a course, lecture, list or source");
    expect(screen.getByRole("dialog").querySelector(".palette-notch")?.textContent).toBe("Go to");
    expect(options()[0]?.hasAttribute("aria-keyshortcuts")).toBe(false);
    fireEvent.input(input(), { target: { value: "zzz" } });
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("marks only the matched letters, the rest as plain text", () => {
    const { palette } = setup();
    palette.open("switch");
    fireEvent.input(input(), { target: { value: "l07" } });
    const label = options()[0]?.querySelector(".palette-label") as HTMLElement;
    expect([...label.childNodes].map((n) => [n.nodeName, n.textContent])).toEqual([
      ["#text", "2026-10-23-"],
      ["MARK", "l07"],
      ["#text", "-covariance.md"],
    ]);
  });

  it("keeps the picked row in view as it moves, and nothing once closed", () => {
    const scroll = vi.fn();
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { palette } = setup();
      palette.open("switch");
      scroll.mockClear();
      key("ArrowDown");
      expect(scroll.mock.contexts).toEqual([options()[1]]);
      expect(scroll.mock.calls).toEqual([[{ block: "nearest" }]]);
      scroll.mockClear();
      key("Escape");
      expect(scroll).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });

  it("says how many more rows match than show", () => {
    const many = Array.from({ length: SHOWN_MAX + 3 }, (_, i) => ({ ...(PLACES[0] as SwitchEntry), id: `c${i}` }));
    const { palette } = setup(many);
    palette.open("switch");
    expect(options()).toHaveLength(SHOWN_MAX);
    expect(screen.getByText("3 more: type to narrow")).toBeTruthy();
    fireEvent.input(input(), { target: { value: "zzz" } });
    expect(screen.queryByText(/more: type to narrow/)).toBeNull();
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
    expect(palette.mode()).toBe("switch");
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Quick switcher");
  });
});
