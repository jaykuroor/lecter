import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseOpened, KnownCourse } from "../../core/course";
import { registerCommand, runCommand } from "../../keys/commands";
import { type Binding, DEFAULT_KEYMAP } from "../../keys/keymap";
import { setBufferTarget } from "../../keys/locate";
import { type PaletteContext, type PaletteHandle, startPalette } from "./mount";
import { PaletteButtons } from "./PaletteButtons";
import { registerPalette } from "./register";

const COURSES: KnownCourse[] = [
  { path: "/courses/STAT311", name: "Statistics", icon: "S", color: "#3584e4", missing: false },
  { path: "/courses/MATH221", name: "Calculus", icon: "C", color: "#26a269", missing: false },
];

const OPEN = {
  path: "/courses/STAT311",
  name: "STAT311",
  lectures: [{ name: "2026-10-23-l07-covariance.md", path: "lectures/2026-10-23-l07-covariance.md" }],
  slides: [{ name: "07-covariance.pdf", path: "slides/07-covariance.pdf" }],
  sources: [{ name: "textbook.pdf", path: "sources/textbook.pdf" }],
} as CourseOpened;

/** A sidebar as Sidebar.tsx draws it: list buttons by name, file rows by path. */
function sidebar(): HTMLElement {
  const el = document.createElement("div");
  el.id = "sidebar";
  el.innerHTML = `
    <button class="sidebar-row sidebar-view" aria-label="Doubts" aria-disabled="true">Doubts</button>
    <button class="sidebar-row sidebar-view" aria-label="Flags" aria-disabled="true">Flags</button>
    <ul><li class="course-file sidebar-row" title="slides/07-covariance.pdf" tabindex="-1">07</li>
    <li class="course-file sidebar-row" title="sources/textbook.pdf" tabindex="-1">textbook</li></ul>`;
  document.body.append(el);
  return el;
}

let log: string[];
let drops: (() => void)[];
let shown: boolean;
let side: HTMLElement;
let handle: PaletteHandle | undefined;

function context(over: Partial<PaletteContext> = {}): PaletteContext {
  const host = document.createElement("div");
  document.body.append(host);
  return {
    host,
    mac: false,
    bindings: () => DEFAULT_KEYMAP,
    courses: () => COURSES,
    course: () => OPEN,
    openCourse: (path) => log.push(`course ${path}`),
    openLecture: (course, path) => log.push(`lecture ${course} ${path}`),
    sidebarShown: () => shown,
    showSidebar: () => {
      shown = true;
      side.hidden = false;
      log.push("show sidebar");
    },
    ...over,
  };
}

/** The lecture buffer as the key engine sees it, with Vim recording the keys it is handed. */
function buffer(): HTMLElement {
  const root = document.createElement("div");
  root.tabIndex = 0;
  document.body.append(root);
  drops.push(
    setBufferTarget({
      root,
      mode: () => "normal",
      element: () => "slide-line",
      replay: (tokens) => log.push(`vim ${tokens.join(" ")}`),
      focus: () => root.focus(),
    }),
  );
  return root;
}

/** The default binding of `name`. */
const command = (name: string) => DEFAULT_KEYMAP.find((b) => b.command === name) as Binding;

/** Opens `mode` and waits until its field has the focus, as it has in the page. */
async function open(mode: "commands" | "switch"): Promise<PaletteHandle> {
  const h = handle as PaletteHandle;
  h.open(mode);
  await Promise.resolve();
  expect(document.activeElement).toBe(input());
  return h;
}

/** Lets promises and their callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const input = () => screen.getByRole("combobox");
const type = (text: string) => fireEvent.input(input(), { target: { value: text } });
const enter = () => fireEvent.keyDown(input(), { key: "Enter" });

beforeEach(() => {
  log = [];
  drops = [];
  shown = false;
  side = sidebar();
  side.hidden = true;
});

afterEach(() => {
  handle?.stop();
  handle = undefined;
  for (const drop of drops) drop();
  cleanup();
  document.body.innerHTML = "";
});

describe("the palette in the page", () => {
  it("runs a command from where the focus was, as its key would: Vim gets ]] in the buffer", async () => {
    const root = buffer();
    root.focus();
    handle = startPalette(context());
    await open("commands");
    type("next slide");
    const row = screen.getAllByRole("option")[0] as HTMLElement;
    expect(row.getAttribute("aria-disabled")).toBeNull();
    enter();
    expect(document.activeElement).toBe(root);
    expect(log).toEqual(["vim <C-j>"]);
  });

  it("runs a command's handler, with its argument (Course 2)", async () => {
    const got: (number | undefined)[] = [];
    drops.push(
      registerCommand("course.go", ({ binding }) => {
        got.push(binding.arg);
      }),
    );
    handle = startPalette(context());
    await open("commands");
    type("course 2");
    enter();
    expect(got).toEqual([1]);
  });

  it("greys a command nobody handles off the buffer, and one Vim gave up in it", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    handle = startPalette(context());
    await open("commands");
    type("next slide");
    expect(screen.getAllByRole("option")[0]?.getAttribute("aria-disabled")).toBe("true");
    (handle as PaletteHandle).palette.close();
    expect(document.activeElement).toBe(outside);
    buffer().focus();
    await open("commands");
    type("steps");
    expect(screen.getAllByRole("option")[0]?.getAttribute("aria-disabled")).toBe("true");
  });

  it("opens a course and a lecture of the open course", async () => {
    handle = startPalette(context());
    await open("switch");
    type("calc");
    enter();
    await open("switch");
    type("l07");
    enter();
    expect(log).toEqual(["course /courses/MATH221", "lecture /courses/STAT311 lectures/2026-10-23-l07-covariance.md"]);
  });

  it("reveals a source in the sidebar, showing it first", async () => {
    handle = startPalette(context());
    await open("switch");
    type("textbook");
    enter();
    expect(log).toEqual(["show sidebar"]);
    expect(document.activeElement?.getAttribute("title")).toBe("sources/textbook.pdf");
  });

  it("runs a list's command once a feature handles it, else reveals its row", async () => {
    shown = true;
    side.hidden = false;
    handle = startPalette(context());
    await open("switch");
    type("flags");
    enter();
    expect(log).toEqual([]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Flags");
    drops.push(
      registerCommand("lists.doubts", () => {
        log.push("doubts view");
      }),
    );
    await open("switch");
    type("doubts");
    enter();
    expect(log).toEqual(["doubts view"]);
  });

  it("keeps the first focus when the other list opens over it", async () => {
    const root = buffer();
    root.focus();
    handle = startPalette(context());
    await open("switch");
    (handle as PaletteHandle).open("commands");
    expect((handle as PaletteHandle).palette.mode()).toBe("commands");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.activeElement).toBe(root);
  });

  it("gives nothing back when nothing had the focus", async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    handle = startPalette(context());
    await open("switch");
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("opens no lecture once the course is gone, and leaves a source with no row alone", async () => {
    let current: CourseOpened | null = OPEN;
    handle = startPalette(context({ course: () => current }));
    await open("switch");
    type("l07");
    current = null;
    enter();
    expect(log).toEqual([]);
    current = { ...OPEN, sources: [{ name: "notes.pdf", path: "sources/notes.pdf" }] };
    await open("switch");
    type("notes");
    enter();
    expect(log).toEqual(["show sidebar"]);
    expect(document.activeElement).toBe(document.body);
  });

  it("scrolls a revealed row into view", async () => {
    const scroll = vi.fn();
    const was = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      handle = startPalette(context());
      await open("switch");
      type("textbook");
      scroll.mockClear();
      enter();
      expect(scroll.mock.contexts).toEqual([side.querySelector('[title="sources/textbook.pdf"]')]);
      expect(scroll.mock.calls).toEqual([[{ block: "nearest" }]]);
    } finally {
      HTMLElement.prototype.scrollIntoView = was;
    }
  });

  it("stops: the box goes, the focus stays put, and the palette follows nothing more", async () => {
    const root = buffer();
    root.focus();
    handle = startPalette(context());
    const h = await open("switch");
    h.stop();
    handle = undefined;
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(document.body);
    h.open("switch");
    expect(h.palette.rows()).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("gives nothing back when the focus's element is gone", async () => {
    const gone = document.createElement("button");
    document.body.append(gone);
    gone.focus();
    handle = startPalette(context());
    await open("switch");
    gone.remove();
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
  });
});

describe("the keys and buttons that open it", () => {
  it("opens the palette and the switcher from their commands, once the chunk is in", async () => {
    const stop = registerPalette(context());
    drops.push(stop);
    expect(runCommand({ binding: command("palette.open"), count: 1, explicit: false })).toBe(true);
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeTruthy();
    runCommand({ binding: command("switcher.open"), count: 1, explicit: false });
    expect(await screen.findByRole("dialog", { name: "Quick switcher" })).toBeTruthy();
  });

  it("drops its commands and its box when stopped, even before the chunk is in", async () => {
    let resolve!: (m: typeof import("./mount")) => void;
    const loading = new Promise<typeof import("./mount")>((r) => {
      resolve = r;
    });
    const stop = registerPalette(context(), () => loading);
    const binding = command("switcher.open");
    expect(runCommand({ binding, count: 1, explicit: false })).toBe(true);
    stop();
    expect(runCommand({ binding, count: 1, explicit: false })).toBe(false);
    resolve(await import("./mount"));
    await loading;
    await Promise.resolve();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts the palette once its chunk is in, opens it only while registered, and stops it", async () => {
    const calls: string[] = [];
    const fake = {
      startPalette: () => {
        calls.push("start");
        return { open: (mode: string) => calls.push(`open ${mode}`), stop: () => calls.push("stop") };
      },
    } as unknown as typeof import("./mount");
    const stop = registerPalette(context(), () => Promise.resolve(fake));
    await flush();
    runCommand({ binding: command("switcher.open"), count: 1, explicit: false });
    await flush();
    expect(calls).toEqual(["start", "open switch"]);
    // A key just before the stop opens nothing.
    runCommand({ binding: command("palette.open"), count: 1, explicit: false });
    stop();
    await flush();
    expect(calls).toEqual(["start", "open switch", "stop"]);
  });

  it("never starts a palette stopped before its chunk is in", async () => {
    const calls: string[] = [];
    let resolve!: (m: typeof import("./mount")) => void;
    const loading = new Promise<typeof import("./mount")>((r) => {
      resolve = r;
    });
    const stop = registerPalette(context(), () => loading);
    stop();
    resolve({ startPalette: () => calls.push("start") } as unknown as typeof import("./mount"));
    await flush();
    expect(calls).toEqual([]);
  });

  it("runs the same command as the key on a click, enabled at once when the palette is in", () => {
    const got: unknown[] = [];
    for (const name of ["switcher.open", "palette.open"])
      drops.push(
        registerCommand(name, (call) => {
          got.push(call);
        }),
      );
    render(() => <PaletteButtons mac={false} />);
    const goTo = screen.getByRole("button", { name: "Go to" }) as HTMLButtonElement;
    const commands = screen.getByRole("button", { name: "Commands" }) as HTMLButtonElement;
    expect(goTo.disabled).toBe(false);
    goTo.click();
    commands.click();
    expect(got).toEqual([
      {
        binding: { keys: "<Mod-p>", command: "switcher.open", scope: "global", desc: "Quick switcher" },
        count: 1,
        explicit: false,
      },
      {
        binding: { keys: "<Mod-S-p>", command: "palette.open", scope: "global", desc: "Command palette" },
        count: 1,
        explicit: false,
      },
    ]);
    expect(commands.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+P");
  });

  it("shows headerbar buttons with their keys, disabled until the palette is registered", async () => {
    render(() => <PaletteButtons mac={false} />);
    const goTo = screen.getByRole("button", { name: "Go to" }) as HTMLButtonElement;
    const commands = screen.getByRole("button", { name: "Commands" }) as HTMLButtonElement;
    expect(goTo.disabled).toBe(true);
    expect(goTo.textContent).toBe("Ctrl-p");
    expect(commands.textContent).toBe("Ctrl-Shift-p");
    expect(goTo.getAttribute("aria-keyshortcuts")).toBe("Control+P");
    drops.push(registerPalette(context()));
    expect(goTo.disabled).toBe(false);
    goTo.click();
    expect(await screen.findByRole("dialog", { name: "Quick switcher" })).toBeTruthy();
    commands.click();
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeTruthy();
  });

  it("names Cmd on macOS", async () => {
    render(() => <PaletteButtons mac={true} />);
    expect(screen.getByRole("button", { name: "Go to" }).textContent).toBe("⌘p");
    expect(screen.getByRole("button", { name: "Go to" }).getAttribute("aria-keyshortcuts")).toBe("Meta+P");
    expect(screen.getByRole("button", { name: "Commands" }).textContent).toBe("⇧⌘p");
    expect(screen.getByRole("button", { name: "Commands" }).getAttribute("aria-keyshortcuts")).toBe("Meta+Shift+P");
  });
});
