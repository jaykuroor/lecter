// The command line in the app (10-keymap.md#commands, F-040): `:` in the lecture buffer's normal
// mode opens it instead of Vim's own prompt. Vim's key table is global, so `:` is remapped once per
// page and opens the box for whichever buffer it was pressed in; a line that isn't `:set` runs on
// that buffer's Vim Ex table. In visual mode `:` stays Vim's (a range over the selection).
import { Vim } from "@replit/codemirror-vim";
import { render } from "solid-js/web";
import { getSetting, readSettingsSchema, setSetting } from "../../core/settings";
import { CommandLine } from "./CommandLine";
import { type Cmdline, createCmdline, type ExTarget } from "./state";

type ActionFn = Parameters<typeof Vim.defineAction>[1];
type ExCm = Parameters<typeof Vim.handleEx>[0];

/** The parts of Vim's API the command line uses: the real `Vim`, or a recording fake in tests. */
export interface ColonApi {
  defineAction(name: string, fn: ActionFn): void;
  mapCommand(keys: string, type: string, name: string, args: unknown, extra: Record<string, unknown>): void;
  handleEx(cm: ExCm, line: string): void;
}

/** The action `:` runs in normal mode. */
export const ACTION = "lecterCmdline";

let current: ((where: ExTarget) => void) | null = null;
const mapped = new WeakSet<ColonApi>();

/** `:` in normal mode opens the current command line, once per Vim API; returns the unsetter. */
export function mapColon(open: (where: ExTarget) => void, api: ColonApi = Vim as unknown as ColonApi): () => void {
  current = open;
  if (!mapped.has(api)) {
    mapped.add(api);
    api.defineAction(ACTION, (cm) => {
      current?.({ run: (line) => api.handleEx(cm as ExCm, line), focus: () => cm.focus() });
    });
    api.mapCommand(":", "action", ACTION, {}, { context: "normal" });
  }
  return () => {
    if (current === open) current = null;
  };
}

/** Shows the command line in `host`; `course` is the course open now. Returns the stopper. */
export function startCmdline(opts: { host: HTMLElement; course: () => string | null }): {
  cmdline: Cmdline;
  stop: () => void;
} {
  const cmdline = createCmdline({
    schema: readSettingsSchema,
    get: getSetting,
    set: setSetting,
    course: opts.course,
  });
  const dispose = render(() => <CommandLine cmdline={cmdline} />, opts.host);
  const unmap = mapColon(cmdline.open);
  return {
    cmdline,
    stop: () => {
      unmap();
      cmdline.dispose();
      dispose();
    },
  };
}
