// The command line's state (10-keymap.md#commands): open or shut, the line typed, the completions
// and which is picked, a refusal shown in the box, and the message a command leaves behind. `:set`
// runs here against the core; any other line goes to Vim's Ex table as typed, so `:find` and
// `:read` keep their own parsing (features/find, features/overlay).
import { createSignal } from "solid-js";
import type { IpcError, Setting } from "../../core/bindings";
import { type Completion, complete, ownCommand } from "./complete";
import { readSchema, type SettingSpec } from "./schema";
import { describeSetting, planSet } from "./set";

/** A command's answer from the core: the data, or the core's error. */
type Answer<T> = { status: "ok"; data: T } | { status: "error"; error: IpcError };

/** Where the command line was opened: the buffer whose Vim runs other commands and gets focus back. */
export interface ExTarget {
  run(line: string): void;
  focus(): void;
}

/** The core and the app as the command line uses them; tests pass fakes. */
export interface CmdlineDeps {
  schema(): Promise<Answer<string>>;
  get(key: string, course: string | null): Promise<Answer<Setting>>;
  set(key: string, json: string, course: string | null): Promise<Answer<Setting>>;
  /** The course open now, whose trusted settings count. */
  course(): string | null;
}

/** What the last command said: a line, a note under it, and whether it was a refusal. */
export interface Message {
  line: string;
  note: string | null;
  error: boolean;
}

/** The refusal when the core's schema couldn't be had. */
export const UNREAD = "Lecter could not read the settings; try again.";

/** How long a message stays when nothing replaces it. */
export const MESSAGE_MS = 6000;

export type Cmdline = ReturnType<typeof createCmdline>;

export function createCmdline(deps: CmdlineDeps) {
  const [target, setTarget] = createSignal<ExTarget | null>(null);
  const [text, setTextSignal] = createSignal("");
  const [picked, setPicked] = createSignal(-1);
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const [message, setMessageSignal] = createSignal<Message | null>(null);
  const [specs, setSpecs] = createSignal<readonly SettingSpec[]>([]);
  let loading: Promise<readonly SettingSpec[]> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** The settings from the core's schema, asked for once; a failed ask is asked again next time. */
  const loadSpecs = (): Promise<readonly SettingSpec[]> => {
    loading ??= deps.schema().then((answer) => {
      if (answer.status !== "ok") {
        loading = null;
        return [];
      }
      const read = readSchema(answer.data);
      setSpecs(read);
      return read;
    });
    return loading;
  };

  const unsay = () => {
    clearTimeout(timer);
    setMessageSignal(null);
  };
  const say = (m: Message) => {
    clearTimeout(timer);
    setMessageSignal(m);
    timer = setTimeout(() => setMessageSignal(null), MESSAGE_MS);
  };

  const completions = (): Completion[] => complete(text(), specs());

  const setText = (value: string) => {
    setTextSignal(value);
    setPicked(-1);
    setRefusal(null);
  };

  /** Shuts the box and gives the keys back to the buffer. */
  const close = () => {
    const was = target();
    setTarget(null);
    setText("");
    was?.focus();
  };

  const showSetting = (answer: Answer<Setting>) => {
    if (answer.status === "ok") say({ ...describeSetting(answer.data), error: false });
    else say({ line: answer.error.message, note: null, error: true });
  };

  /** Runs `:set` on the checked plan; a refusal keeps the box open with its reason. */
  const runSet = (args: string, all: readonly SettingSpec[]) => {
    if (all.length === 0) {
      setRefusal(UNREAD);
      return;
    }
    const plan = planSet(args, all);
    if (plan.op === "refuse") {
      setRefusal(plan.reason);
      return;
    }
    close();
    const course = deps.course();
    const asked = plan.op === "show" ? deps.get(plan.key, course) : deps.set(plan.key, plan.json, course);
    void asked.then(showSetting);
  };

  return {
    /** Whether the box is open. */
    isOpen: () => target() !== null,
    text,
    setText,
    completions,
    picked,
    refusal,
    message,
    /** Opens the box for `where`, empty; the settings load in the background. */
    open(where: ExTarget) {
      unsay();
      setText("");
      setTarget(where);
      void loadSpecs();
    },
    close,
    /** Moves the pick through the completions, wrapping; `-1` (none) sits between the ends. */
    move(step: 1 | -1) {
      const n = completions().length;
      const next = picked() + step;
      setPicked(next < -1 ? n - 1 : next >= n ? -1 : next);
    },
    /** Takes completion `index` (Tab: the picked one, else the first) into the line. */
    take(index = Math.max(picked(), 0)) {
      const c = completions()[index];
      if (c) setText(c.line);
    },
    /** Enter: runs the line as typed. */
    submit() {
      const where = target();
      const line = text();
      if (!where) return;
      const own = ownCommand(line);
      if (!own) {
        close();
        if (line.trim() !== "") where.run(line);
        return;
      }
      const all = specs();
      if (all.length > 0) runSet(own.args, all);
      else void loadSpecs().then((loaded) => runSet(own.args, loaded));
    },
    /** Stops the message timer. */
    dispose: () => clearTimeout(timer),
  };
}
