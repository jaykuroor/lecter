import { describe, expect, it } from "vitest";
import type { CourseOpened, KnownCourse } from "../../core/course";
import { compileKeymap, resolve } from "../../keys/engine";
import { type Binding, DEFAULT_KEYMAP } from "../../keys/keymap";
import { commandEntries, type SwitchEntry, switcherEntries } from "./entries";

const byTitle = (title: string, mac = false) => commandEntries(DEFAULT_KEYMAP, mac).find((e) => e.title === title);

describe("commandEntries (Ctrl/Cmd-Shift-P lists every command with its key)", () => {
  it("lists every command of the keymap once, leader groups left out", () => {
    const entries = commandEntries(DEFAULT_KEYMAP, false);
    const ids = (list: readonly { command: string; arg?: number }[]) =>
      list.map((b) => `${b.command}#${b.arg ?? ""}`).sort();
    const expected = [...new Set(ids(DEFAULT_KEYMAP.filter((b) => !b.command.startsWith("+"))))];
    expect(ids(entries.map((e) => e.binding))).toEqual(expected);
    expect(entries.some((e) => e.binding.command.startsWith("+"))).toBe(false);
  });

  it("shows each command's keys as keycaps, every binding of it", () => {
    expect(byTitle("Command palette")?.keys).toEqual(["Ctrl-Shift-p"]);
    expect(byTitle("Quick switcher")?.keys).toEqual(["Ctrl-p"]);
    expect(byTitle("Next slide")?.keys).toEqual(["Ctrl-j", "]]"]);
    expect(byTitle("Gap finder")?.keys).toEqual(["␣ag"]);
    expect(byTitle("Ask about this line")?.keys).toEqual(["↵"]);
    expect(byTitle("Course 3")?.keys).toEqual(["Ctrl-3"]);
    expect(byTitle("Next pane")?.keys).toEqual(["F6"]);
  });

  it("shows macOS keys with Cmd", () => {
    expect(byTitle("Command palette", true)?.keys).toEqual(["⇧⌘p"]);
    expect(byTitle("Quick switcher", true)?.keys).toEqual(["⌘p"]);
  });

  it("runs a numbered command with its own argument, and keeps the spec's order", () => {
    expect(byTitle("Course 3")?.binding.arg).toBe(2);
    const titles = commandEntries(DEFAULT_KEYMAP, false).map((e) => e.title);
    expect(titles.indexOf("Course 1")).toBeLessThan(titles.indexOf("Gap finder"));
    expect(titles.indexOf("Gap finder")).toBeLessThan(titles.indexOf("Next slide"));
  });

  it("says where a command works, and its tokens for a click", () => {
    expect(byTitle("Regenerate")?.where).toBe("on a gloss");
    expect(byTitle("Steps")?.where).toBe("on a line");
    expect(byTitle("Next slide")?.where).toBe("in the lecture");
    expect(byTitle("Toggle sidebar")?.where).toBe("");
    expect(byTitle("Command palette")?.where).toBe("");
    expect(byTitle("Next slide")?.tokens).toEqual(["<C-j>"]);
  });

  it("keeps the default words for a command keymaps.jsonc binds again, and adds its key", () => {
    const user: Binding = { keys: "<F2>", command: "palette.open", scope: "global", desc: "palette.open" };
    const entries = commandEntries([...DEFAULT_KEYMAP, user], false);
    const palette = entries.filter((e) => e.binding.command === "palette.open");
    expect(palette).toHaveLength(1);
    expect(palette[0]?.title).toBe("Command palette");
    expect(palette[0]?.keys).toEqual(["Ctrl-Shift-p", "F2"]);
  });

  it("takes a binding's own words over the default's, from whichever binding has them", () => {
    const user = (keys: string, command: string, desc: string, arg?: number): Binding =>
      arg === undefined ? { keys, command, scope: "global", desc } : { keys, command, scope: "global", desc, arg };
    // keymaps.jsonc's binding first: the default after it still names the command.
    const first = commandEntries([user("<F2>", "palette.open", "palette.open"), ...DEFAULT_KEYMAP], false);
    expect(first.find((e) => e.binding.command === "palette.open")?.title).toBe("Command palette");
    expect(commandEntries([user("z2", "ai.steps", "My steps")], false)[0]?.title).toBe("My steps");
    const own = commandEntries([user("<F3>", "my.thing", "my.thing"), user("<F4>", "my.thing", "My thing")], false);
    expect(own.map((e) => [e.title, e.keys])).toEqual([["My thing", ["F3", "F4"]]]);
    // A numbered command keymaps.jsonc binds alone takes the default words for its argument.
    expect(commandEntries([user("<F9>", "course.go", "course.go", 2)], false)[0]?.title).toBe("Course 3");
  });

  it("names a command only keymaps.jsonc has by its id, and leaves out keys that don't parse", () => {
    const own: Binding = { keys: "<F3>", command: "my.thing", scope: "global", desc: "my.thing" };
    const bad: Binding = { keys: "<Nope>", command: "bad.keys", scope: "global", desc: "Bad" };
    const entries = commandEntries([own, bad], false);
    expect(entries.map((e) => [e.title, e.keys])).toEqual([["my.thing", ["F3"]]]);
  });
});

describe("the switcher's keys", () => {
  it("binds Ctrl/Cmd-Shift-P and Ctrl/Cmd-p everywhere, even while typing, and not Ctrl/Cmd-K", () => {
    for (const mac of [false, true]) {
      const map = compileKeymap(DEFAULT_KEYMAP, mac);
      const mod = mac ? "D" : "C";
      const shiftP = mac ? "<S-D-p>" : "<C-S-p>";
      for (const [el, mode] of [
        ["page", "normal"],
        ["field", "normal"],
        ["note-line", "insert"],
        ["slide-line", "normal"],
      ] as const) {
        expect(resolve(map, el, mode, [shiftP])?.command).toBe("palette.open");
        expect(resolve(map, el, mode, [`<${mod}-p>`])?.command).toBe("switcher.open");
        expect(String(resolve(map, el, mode, [`<${mod}-k>`])?.command)).not.toMatch(/palette|switcher/);
      }
      // Off the buffer, Ctrl/Cmd-K means nothing at all.
      expect(resolve(map, "page", "normal", [`<${mod}-k>`])).toBeNull();
    }
  });
});

const course = (path: string, name: string, missing = false): KnownCourse => ({
  path,
  name,
  icon: name[0] as string,
  color: "#3584e4",
  missing,
});

const opened: CourseOpened = {
  path: "/courses/STAT311",
  name: "STAT311",
  lectures: [{ name: "2026-10-23-l07-covariance.md", path: "lectures/2026-10-23-l07-covariance.md" }],
  slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
  sources: [{ name: "textbook.pdf", path: "sources/textbook.pdf" }],
  trust: "trusted",
  screen: {
    lectures: 1,
    slides: 1,
    sources: 1,
    provider: "sample",
    webSearch: true,
    agents: [],
    roles: [],
    skills: [],
    overrides: [],
    changed: false,
    blocked: null,
  },
};

const brief = (e: SwitchEntry) => [e.kind, e.label, e.target, e.disabled];

describe("switcherEntries (Ctrl/Cmd-p: courses, lectures, lists and sources)", () => {
  it("lists the rail's courses, then the open course's lectures, lists and sources", () => {
    const entries = switcherEntries([course("/courses/STAT311", "Statistics"), course("/m", "Calculus")], opened);
    expect(entries.map(brief)).toEqual([
      ["course", "Statistics", "/courses/STAT311", false],
      ["course", "Calculus", "/m", false],
      ["lecture", "2026-10-23-l07-covariance.md", "lectures/2026-10-23-l07-covariance.md", false],
      ["list", "Doubts", "lists.doubts", false],
      ["list", "Flags", "lists.flags", false],
      ["list", "Office hours", "lists.officeHours", false],
      ["list", "Later", "lists.later", false],
      ["list", "Revise", "lists.revise", false],
      ["source", "07-covariance.pdf", "slides/07-covariance.pdf", false],
      ["source", "textbook.pdf", "sources/textbook.pdf", false],
    ]);
  });

  it("says what each is and where it lives", () => {
    const entries = switcherEntries([course("/courses/STAT311", "Statistics")], opened);
    expect(entries.map((e) => e.detail)).toEqual([
      "/courses/STAT311",
      "STAT311",
      "␣xx",
      "␣xf",
      "␣xo",
      "␣xl",
      "␣xr",
      "slides/07-covariance.pdf",
      "sources/textbook.pdf",
    ]);
  });

  it("lists only courses before one is open, and a missing course can't be picked", () => {
    const entries = switcherEntries([course("/gone", "Gone", true), course("/here", "Here")], null);
    expect(entries.map(brief)).toEqual([
      ["course", "Gone", "/gone", true],
      ["course", "Here", "/here", false],
    ]);
    expect(entries[0]?.detail).toBe("missing: /gone");
  });

  it("names each entry by its kind and target", () => {
    const entries = switcherEntries([course("/courses/STAT311", "Statistics")], opened);
    expect(entries.map((e) => e.id)).toEqual([
      "course:/courses/STAT311",
      "lecture:lectures/2026-10-23-l07-covariance.md",
      "list:lists.doubts",
      "list:lists.flags",
      "list:lists.officeHours",
      "list:lists.later",
      "list:lists.revise",
      "source:slides/07-covariance.pdf",
      "source:sources/textbook.pdf",
    ]);
  });

  it("gives every entry its own id", () => {
    const entries = switcherEntries([course("/courses/STAT311", "Statistics")], {
      ...opened,
      slides: [{ name: "a.pdf", path: "slides/a.pdf" }],
      sources: [{ name: "a.pdf", path: "sources/a.pdf" }],
    });
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });
});
