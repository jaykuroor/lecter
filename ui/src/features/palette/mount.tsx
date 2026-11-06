// The palette at work in the page: a chunk of its own, loaded with the key engine after the first
// paint (register.ts), so the shell paints without it. It remembers where the focus was when it
// opened, gives it back when it closes, and runs a command from there as its key would
// (keys/dispatch.ts); the switcher opens a course or a lecture, runs a list's command, and reveals
// a list or a source in the sidebar while their views don't exist yet.
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import type { CourseOpened, KnownCourse } from "../../core/course";
import { hasCommand } from "../../keys/commands";
import { runWithoutKey, vimTakes } from "../../keys/dispatch";
import type { Binding } from "../../keys/keymap";
import { locate } from "../../keys/locate";
import { type CommandEntry, commandEntries, type SwitchEntry, switcherEntries } from "./entries";
import { PaletteBox } from "./PaletteBox";
import { createPalette, type Palette, type PaletteMode } from "./state";

/** What the palette needs from the app. */
export interface PaletteContext {
  /** Where the box shows. */
  host: HTMLElement;
  mac: boolean;
  /** The key engine's bindings now (keymaps.jsonc laid over the defaults). */
  bindings: () => readonly Binding[];
  /** The courses on the rail, and the course open now. */
  courses: () => KnownCourse[];
  course: () => CourseOpened | null;
  openCourse: (path: string) => void;
  /** Opens a lecture (its course-relative path) of the course (its path). */
  openLecture: (course: string, path: string) => void;
  sidebarShown: () => boolean;
  showSidebar: () => void;
}

export interface PaletteHandle {
  palette: Palette;
  open: (mode: PaletteMode) => void;
  stop: () => void;
}

/** The sidebar rows the switcher reveals: a list's button, a source's file row. */
const ROWS: Readonly<Record<"list" | "source", string>> = {
  list: "#sidebar .sidebar-view[aria-label]",
  source: "#sidebar li.course-file[title]",
};

export function startPalette(ctx: PaletteContext): PaletteHandle {
  /** Where the focus was when the palette opened. */
  let before: HTMLElement | null = null;

  const restore = () => {
    const el = before;
    before = null;
    if (el?.isConnected) el.focus();
  };

  /** Whether a command can run from where the focus was: its handler, or Vim in the buffer. */
  const canRun = (entry: CommandEntry) =>
    hasCommand(entry.binding.command) || (locate(before).buffer !== null && vimTakes(entry.tokens));

  /** Shows the sidebar and puts the focus on its row for `entry` (a list or a source). */
  const reveal = (kind: "list" | "source", label: string) => {
    if (!ctx.sidebarShown()) ctx.showSidebar();
    const attr = kind === "list" ? "aria-label" : "title";
    const rows = [...document.querySelectorAll<HTMLElement>(ROWS[kind])];
    const row = rows.find((r) => r.getAttribute(attr) === label);
    row?.focus();
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const onPlace = (entry: SwitchEntry) => {
    const course = ctx.course();
    if (entry.kind === "course") ctx.openCourse(entry.target);
    else if (entry.kind === "lecture") {
      if (course) ctx.openLecture(course.path, entry.target);
    } else if (entry.kind === "list") {
      // The list's own view once a feature handles its `␣x` command; until then its sidebar row.
      const binding = ctx.bindings().find((b) => b.command === entry.target);
      if (!binding || !runWithoutKey(binding, [], null)) reveal("list", entry.label);
    } else reveal("source", entry.target);
  };

  // Its own root: the palette starts from a promise, outside any component, and is disposed on stop.
  const [palette, disposeState] = createRoot(
    (d) =>
      [
        createPalette({
          commands: () => commandEntries(ctx.bindings(), ctx.mac),
          canRun,
          places: () => switcherEntries(ctx.courses(), ctx.course()),
          restore,
          onCommand: (entry) => {
            runWithoutKey(entry.binding, entry.tokens, locate(document.activeElement).buffer);
          },
          onPlace,
        }),
        d,
      ] as const,
  );
  const dispose = render(() => <PaletteBox palette={palette} />, ctx.host);

  return {
    palette,
    open: (mode) => {
      if (palette.mode() === null) {
        const active = document.activeElement;
        before = active instanceof HTMLElement && !ctx.host.contains(active) ? active : null;
      }
      palette.open(mode);
    },
    stop: () => {
      palette.close(false);
      dispose();
      disposeState();
    },
  };
}
