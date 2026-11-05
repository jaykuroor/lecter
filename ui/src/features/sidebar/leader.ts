/**
 * `␣e` toggles the sidebar (10-keymap.md#leader-groups, 09-ui.md#layout). Until the key engine
 * (F-037) owns the leader, the sidebar listens for it itself, the way the rail listens for
 * Ctrl/Cmd-1…9 (rail/keys.ts). F-037 takes over by binding `␣e` to the toggle in its own table
 * and dropping `installSidebarToggle`; `leaderTarget` is the rule it can keep.
 */

/** Fields where Space types a space, wherever they are (the buffer's `:` and `/` prompts too). */
const TEXT_FIELD = "input, textarea, select";
/** Elements Space already does something on: it types into them or activates them. */
const SPACE_TAKEN =
  '[contenteditable]:not([contenteditable="false"]), [role="textbox"], button, a[href], [role="button"]';

/** Whether Space on `el` (the focused element) starts a leader key rather than doing its own thing. */
export function leaderTarget(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest(TEXT_FIELD)) return false;
  // The lecture is an editable CodeMirror buffer; Vim's mode decides (Buffer.tsx data-vim-mode).
  // Space is the leader in normal and visual mode, and types in insert and replace mode.
  const buffer = el.closest(".lecture-buffer");
  if (buffer) {
    const mode = buffer.getAttribute("data-vim-mode");
    return mode === "normal" || mode === "visual";
  }
  return !el.closest(SPACE_TAKEN);
}

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);

/**
 * Listens on `target` before any element does (capture), so `␣e` works while the buffer has focus
 * in normal mode. Space where it is the leader is taken from the page; the next key ends the
 * leader: `e` toggles, Escape cancels, another letter is an unbound leader key and is dropped (as
 * which-key would), and anything else (arrows, Ctrl keys) goes on as usual. Returns the function
 * that stops listening.
 */
export function installSidebarToggle(target: EventTarget, onToggle: () => void): () => void {
  let armed = false;
  const take = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const listener = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.isComposing) {
      armed = false;
      return;
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (armed) {
      if (MODIFIERS.has(e.key)) return;
      armed = false;
      if (plain && e.key === "e") {
        take(event);
        onToggle();
      } else if (e.key === "Escape" || (plain && e.key.length === 1)) {
        take(event);
      }
      return;
    }
    if (e.key !== " " || !plain || e.shiftKey || e.repeat) return;
    if (!leaderTarget(e.target instanceof Element ? e.target : null)) return;
    armed = true;
    take(event);
  };
  target.addEventListener("keydown", listener, { capture: true });
  return () => target.removeEventListener("keydown", listener, { capture: true });
}
