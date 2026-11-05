/**
 * `Ctrl/Cmd-1…9` jumps to the nth course (09-ui.md#layout, 10-keymap.md#global-os-conventions):
 * Ctrl on Windows and Linux, Cmd on macOS, in every mode and element. Until the key engine
 * (F-037) owns global keys, the rail listens for them itself; F-037 takes over by calling
 * `courseSlot` from its own table and dropping `installCourseSlots`. Vim has no Ctrl-digit keys,
 * and no other binding uses them (10-keymap.md).
 */

/** The course (0-based) a key asks for, or `null` when it isn't a course key. */
export function courseSlot(e: KeyboardEvent, mac: boolean): number | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (!mod || other || e.altKey || e.shiftKey || e.repeat) return null;
  // The digit row by place, so layouts that type something else there (AZERTY's &) still work;
  // a synthetic key without a code goes by the character.
  const digit = e.code ? /^Digit([1-9])$/.exec(e.code)?.[1] : /^[1-9]$/.exec(e.key)?.[0];
  return digit ? Number(digit) - 1 : null;
}

/** Whether the app runs on macOS, where the course keys use Cmd. */
export function isMacPlatform(nav: Pick<Navigator, "platform" | "userAgent"> = navigator): boolean {
  return /^Mac/.test(nav.platform) || /Macintosh|Mac OS X/.test(nav.userAgent);
}

/**
 * Listens on `target` before any element does (capture), so the keys work while the buffer or a
 * field has focus. `onSlot` switches to that course and says whether there was one; only then is
 * the key taken from the element. Returns the function that stops listening.
 */
export function installCourseSlots(
  target: EventTarget,
  onSlot: (index: number) => boolean,
  mac: boolean = isMacPlatform(),
): () => void {
  const listener = (event: Event) => {
    const slot = courseSlot(event as KeyboardEvent, mac);
    if (slot === null || !onSlot(slot)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener("keydown", listener, { capture: true });
  return () => target.removeEventListener("keydown", listener, { capture: true });
}
