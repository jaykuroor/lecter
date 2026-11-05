// The key engine's listener, from the first paint on. The engine itself (its keymap, which-key)
// is a chunk of its own that loads right after the first paint (install.ts), so the shell paints
// without it (cold_open_ms). Until it is in, the listener holds back the few keys the engine
// would take, the leader and the key after it, and Ctrl/Cmd-1…9, and hands them over once it is.
import { locate } from "./locate";

type Handler = (e: KeyboardEvent) => void;

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/** Whether a key pressed before the engine is in is one to hold back for it. */
function holds(e: KeyboardEvent, armed: boolean, mac: boolean): boolean {
  if (armed) return true;
  if (e.repeat || e.altKey || e.shiftKey) return false;
  if (e.key === " " && !e.ctrlKey && !e.metaKey) {
    const where = locate(e.target);
    return where.mode !== "insert" && where.el !== "field" && where.el !== "control";
  }
  const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return mod && /^Digit[1-9]$/.test(e.code);
}

/**
 * Listens on `target` before any element does (capture). Returns `attach`, which hands keys to the
 * engine from then on (the held ones first), and `stop`.
 */
export function bootKeys(target: EventTarget, mac: boolean): { attach: (handler: Handler) => void; stop: () => void } {
  let handler: Handler | null = null;
  let held: KeyboardEvent[] = [];
  let armed = false;
  const listener = (event: Event) => {
    const e = event as KeyboardEvent;
    if (handler) {
      handler(e);
      return;
    }
    if (e.isComposing || MODIFIERS.has(e.key)) {
      if (e.isComposing) armed = false;
      return;
    }
    if (!holds(e, armed, mac)) return;
    armed = !armed && e.key === " ";
    e.preventDefault();
    e.stopPropagation();
    held.push(e);
  };
  target.addEventListener("keydown", listener, { capture: true });
  return {
    attach: (h) => {
      handler = h;
      const keys = held;
      held = [];
      for (const e of keys) h(e);
    },
    stop: () => target.removeEventListener("keydown", listener, { capture: true }),
  };
}
