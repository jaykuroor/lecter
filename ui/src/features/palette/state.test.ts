import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_KEYMAP } from "../../keys/keymap";
import { type CommandEntry, commandEntries, type SwitchEntry } from "./entries";
import { createPalette, type PaletteOptions, SHOWN_MAX } from "./state";

const place = (kind: SwitchEntry["kind"], label: string, disabled = false): SwitchEntry => ({
  id: `${kind}:${label}`,
  kind,
  label,
  detail: `${label} detail`,
  target: `/${label}`,
  disabled,
});

const PLACES = [
  place("course", "Statistics"),
  place("course", "Gone", true),
  place("lecture", "2026-10-23-l07-covariance.md"),
  place("list", "Doubts"),
  place("source", "textbook.pdf"),
];

function setup(over: Partial<PaletteOptions> = {}) {
  const log: string[] = [];
  const [places, setPlaces] = createSignal(PLACES);
  const runnable = new Set(["palette.open", "switcher.open", "sidebar.toggle"]);
  const opts: PaletteOptions = {
    commands: () => commandEntries(DEFAULT_KEYMAP, false),
    canRun: (e: CommandEntry) => runnable.has(e.binding.command),
    places,
    restore: () => log.push("restore"),
    onCommand: (e) => log.push(`run ${e.id}`),
    onPlace: (e) => log.push(`go ${e.id}`),
    ...over,
  };
  let palette!: ReturnType<typeof createPalette>;
  const dispose = createRoot((d) => {
    palette = createPalette(opts);
    return d;
  });
  return { palette, log, setPlaces, runnable, dispose };
}

const labels = (p: ReturnType<typeof createPalette>) => p.rows().map((r) => r.label);

describe("the command palette", () => {
  it("opens on every command with its keys, closed until then", () => {
    const { palette } = setup();
    expect(palette.mode()).toBeNull();
    expect(palette.query()).toBe("");
    expect(palette.rows()).toEqual([]);
    palette.open("commands");
    expect(palette.mode()).toBe("commands");
    const all = commandEntries(DEFAULT_KEYMAP, false);
    expect(palette.rows().map((r) => r.id)).toEqual(all.map((e) => e.id));
    expect(palette.rows().find((r) => r.label === "Next slide")).toMatchObject({
      keys: ["Ctrl-j", "]]"],
      kind: "",
      detail: "in the lecture",
      disabled: true,
    });
    expect(palette.rows().find((r) => r.label === "Toggle sidebar")).toMatchObject({ keys: ["␣e"], disabled: false });
  });

  it("filters by fuzzy match as you type, best first, and starts the pick at the top again", () => {
    const { palette } = setup();
    palette.open("commands");
    palette.move(3);
    palette.setQuery("tgsb");
    expect(palette.picked()).toBe(0);
    expect(labels(palette)[0]).toBe("Toggle sidebar");
    expect(palette.rows()[0]?.hits).toEqual([0, 2, 7, 11]);
    palette.setQuery("qqqq");
    expect(palette.rows()).toEqual([]);
  });

  it("runs the picked command after giving the focus back, and closes", () => {
    const { palette, log } = setup();
    palette.open("commands");
    palette.setQuery("toggle sidebar");
    palette.pick();
    expect(log).toEqual(["restore", "run sidebar.toggle"]);
    expect(palette.mode()).toBeNull();
    expect(palette.query()).toBe("");
  });

  it("does nothing on a command that can't run here, and stays open", () => {
    const { palette, log } = setup();
    palette.open("commands");
    palette.setQuery("next slide");
    expect(palette.rows()[0]?.disabled).toBe(true);
    palette.pick();
    expect(log).toEqual([]);
    expect(palette.mode()).toBe("commands");
  });

  it("asks what can run only when the palette opens, not the switcher", () => {
    let asked = 0;
    const { palette } = setup({
      canRun: () => {
        asked++;
        return true;
      },
    });
    palette.open("switch");
    expect(asked).toBe(0);
    palette.open("commands");
    expect(asked).toBe(commandEntries(DEFAULT_KEYMAP, false).length);
  });

  it("asks what can run each time it opens", () => {
    const { palette, runnable } = setup();
    palette.open("commands");
    palette.close();
    runnable.add("slide.next");
    palette.open("commands");
    palette.setQuery("next slide");
    expect(palette.rows()[0]?.disabled).toBe(false);
  });

  it("wraps the pick round the ends of the list", () => {
    const { palette } = setup();
    palette.open("switch");
    expect(palette.picked()).toBe(0);
    palette.move(-1);
    expect(palette.picked()).toBe(PLACES.length - 1);
    palette.move(1);
    expect(palette.picked()).toBe(0);
    palette.move(2);
    expect(palette.picked()).toBe(2);
    palette.setQuery("zzz");
    palette.move(1);
    expect(palette.picked()).toBe(0);
  });

  it("closes on Esc's call, giving the focus back, or without it when the focus went elsewhere", () => {
    const { palette, log } = setup();
    palette.open("switch");
    palette.close();
    expect(log).toEqual(["restore"]);
    palette.open("switch");
    palette.close(false);
    expect(log).toEqual(["restore"]);
    expect(palette.mode()).toBeNull();
    // Closing a closed palette gives nothing back.
    palette.close();
    expect(log).toEqual(["restore"]);
  });

  it("switches between the palette and the switcher, keeping neither's query", () => {
    const { palette } = setup();
    palette.open("switch");
    palette.setQuery("stat");
    palette.open("commands");
    expect(palette.mode()).toBe("commands");
    expect(palette.query()).toBe("");
  });
});

describe("the quick switcher", () => {
  it("lists courses, lectures, lists and sources with what each is", () => {
    const { palette } = setup();
    palette.open("switch");
    expect(palette.rows().every((r) => r.keys.length === 0)).toBe(true);
    expect(palette.rows().map((r) => [r.label, r.kind, r.detail, r.disabled])).toEqual([
      ["Statistics", "Course", "Statistics detail", false],
      ["Gone", "Course", "Gone detail", true],
      ["2026-10-23-l07-covariance.md", "Lecture", "2026-10-23-l07-covariance.md detail", false],
      ["Doubts", "List", "Doubts detail", false],
      ["textbook.pdf", "Source", "textbook.pdf detail", false],
    ]);
  });

  it("jumps to a lecture typed by part of its name", () => {
    const { palette, log } = setup();
    palette.open("switch");
    palette.setQuery("l07");
    expect(labels(palette)).toEqual(["2026-10-23-l07-covariance.md"]);
    palette.pick();
    expect(log).toEqual(["restore", "go lecture:2026-10-23-l07-covariance.md"]);
  });

  it("picks the row clicked, and not a missing course", () => {
    const { palette, log } = setup();
    palette.open("switch");
    palette.pick(1);
    expect(log).toEqual([]);
    palette.pick(4);
    expect(log).toEqual(["restore", "go source:textbook.pdf"]);
    // Out of range: nothing.
    palette.open("switch");
    palette.pick(99);
    expect(log).toEqual(["restore", "go source:textbook.pdf"]);
  });

  it("follows the places as they change while it is open", () => {
    const { palette, setPlaces } = setup();
    palette.open("switch");
    setPlaces([place("course", "Calculus")]);
    expect(labels(palette)).toEqual(["Calculus"]);
  });

  it(`shows at most ${SHOWN_MAX} rows and says how many more match`, () => {
    const many = Array.from({ length: SHOWN_MAX + 5 }, (_, i) => place("source", `file${i}.pdf`));
    const { palette } = setup({ places: () => many });
    palette.open("switch");
    expect(palette.rows()).toHaveLength(SHOWN_MAX);
    expect(palette.more()).toBe(5);
    palette.setQuery("file1");
    expect(palette.more()).toBe(0);
  });
});
