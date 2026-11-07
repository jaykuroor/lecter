// What the status line shows (09-ui.md#layout), as signals: the buffer reports Vim's mode, the
// cursor's slide and its answers' jobs; the command lines make it COMMAND. Nothing here runs on a
// timer or per frame: each value changes only when what it follows does, and an equal value
// changes nothing on screen.
import { type Accessor, createMemo, createSignal } from "solid-js";
import type { JobSink } from "./jobs";
import { type SlidePos, type StatusMode, statusMode, type VimMode } from "./labels";

/** What the lecture buffer tells the status line. */
export interface BufferStatus {
  /** Vim's mode changed. */
  mode(mode: VimMode): void;
  /** The cursor is in `slide` now (`null`: above the first slide). */
  slide(slide: SlidePos | null): void;
  /** The answers it asks for. */
  jobs: JobSink;
}

export interface StatusState {
  mode: Accessor<StatusMode>;
  slide: Accessor<SlidePos | null>;
  /** The model the last answer streamed from this session; `null` before one has. */
  model: Accessor<string | null>;
  /** How many answers are streaming. */
  running: Accessor<number>;
  buffer: BufferStatus;
  /** Lecter's command line (F-040), once its chunk is in: COMMAND while `open()`. */
  followCommandLine(open: Accessor<boolean>): void;
  /** Stops following the focus. */
  stop(): void;
}

/** Vim's own prompt (`/`, `?`, `:` over a selection) in @replit/codemirror-vim. */
const VIM_PROMPT = ".cm-vim-panel";

const sameSlide = (a: SlidePos | null, b: SlidePos | null) =>
  a === b || (a !== null && b !== null && a.n === b.n && a.total === b.total);

/** The status line's state; it watches the focus in `win` for Vim's own prompt until stopped. */
export function createStatus(win: Window): StatusState {
  const [vim, setVim] = createSignal<VimMode>("normal");
  const [slide, setSlide] = createSignal<SlidePos | null>(null, { equals: sameSlide });
  const [model, setModel] = createSignal<string | null>(null);
  const [running, setRunning] = createSignal(0);
  const [cmdline, setCmdline] = createSignal<Accessor<boolean> | null>(null);
  const [vimPrompt, setVimPrompt] = createSignal(false);
  const mode = createMemo(() => {
    const open = cmdline();
    return statusMode(vim(), (open !== null && open()) || vimPrompt());
  });

  // Where the focus goes: into Vim's prompt, or anywhere else (a blur to nothing has no target).
  const onFocus = (e: FocusEvent) => {
    const to = e.type === "focusin" ? e.target : e.relatedTarget;
    setVimPrompt(to instanceof Element && to.closest(VIM_PROMPT) !== null);
  };
  win.addEventListener("focusin", onFocus);
  win.addEventListener("focusout", onFocus);

  const jobs: JobSink = {
    begin() {
      setRunning((n) => n + 1);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        setRunning((n) => n - 1);
      };
    },
    model: setModel,
  };

  return {
    mode,
    slide,
    model,
    running,
    buffer: { mode: setVim, slide: setSlide, jobs },
    followCommandLine: (open) => setCmdline(() => open),
    stop() {
      win.removeEventListener("focusin", onFocus);
      win.removeEventListener("focusout", onFocus);
    },
  };
}
