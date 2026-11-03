// The page side of the idle flow (tests/e2e/flows/idle.ts, F-029): what it installs and reads in
// the app's window through WebDriver. Each function's body runs in the page, so it uses only page
// globals and its arguments. Kept out of flows/*.ts so wdio doesn't take it for a flow.

/** What the page keeps for these checks, on `window.__idle`. */
export interface Probe {
  /** performance.now() of the last keydown or mousedown anywhere in the window. */
  lastInput: number;
  /** Set while a window is open: its start, and each mutation and frame callback in it. */
  watch?: { start: number; mutations: { t: number; what: string }[]; frames: number[] };
}

/** Starts the page's input clock and the frame counter (requestAnimationFrame, wrapped). */
export function installProbe(): Promise<void> {
  return browser.execute(() => {
    const w = window as unknown as { __idle?: Probe; requestAnimationFrame: typeof requestAnimationFrame };
    if (w.__idle) return;
    const probe: Probe = { lastInput: performance.now() };
    w.__idle = probe;
    const input = () => {
      probe.lastInput = performance.now();
    };
    window.addEventListener("keydown", input, true);
    window.addEventListener("mousedown", input, true);
    const raf = window.requestAnimationFrame.bind(window);
    w.requestAnimationFrame = (cb: FrameRequestCallback) =>
      raf((t) => {
        probe.watch?.frames.push(performance.now());
        cb(t);
      });
  });
}

/** Milliseconds since the last key or click, as the page saw it. */
export function sinceInput(): Promise<number> {
  return browser.execute(() => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    return probe ? performance.now() - probe.lastInput : -1;
  });
}

/** Keeps still until `ms` have passed since the later of the last input and `since` (page time). */
export async function idleFor(ms: number, since = 0): Promise<void> {
  const elapsed = await browser.execute((from: number) => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    return performance.now() - Math.max(probe?.lastInput ?? 0, from);
  }, since);
  if (elapsed < ms) await browser.pause(Math.ceil(ms - elapsed) + 50);
}

/**
 * Waits (in the page, at most 15 s) for every animation and transition now in the window to
 * finish, and returns how long after the later of the last input and `since` the last one ended
 * (0 when none was left), and any still running.
 */
export async function animationsEnd(since: number): Promise<{ endedAfterInput: number; stillRunning: string[] }> {
  return await browser.execute(async (since: number) => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    const from = Math.max(probe?.lastInput ?? 0, since);
    const animations = document.getAnimations();
    let last = from;
    const ends = animations.map((a) =>
      a.finished.then(
        () => {
          last = Math.max(last, performance.now());
        },
        () => undefined, // cancelled: it ends too
      ),
    );
    const timeout = new Promise((resolve) => setTimeout(resolve, 15_000));
    await Promise.race([Promise.all(ends), timeout]);
    const stillRunning = animations
      .filter((a) => a.playState === "running")
      .map((a) => {
        const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        return target instanceof Element ? target.className : "?";
      });
    return { endedAfterInput: last - from, stillRunning };
  }, since);
}

/** Whether the window and the editor have focus: the caret only blinks in a focused editor. */
export function focus(): Promise<{ document: boolean; editor: boolean }> {
  return browser.execute(() => ({
    document: document.hasFocus(),
    editor: document.querySelector(".cm-editor")?.classList.contains("cm-focused") ?? false,
  }));
}

/**
 * Clicks the editor line that reads `text` once, as a mouse does: pointerdown, mousedown,
 * pointerup, mouseup, click, all with `detail: 1` (a single click), at the centre of the line's
 * second character, measured in the page so it holds whatever the fonts make of the line. Before
 * dispatching it checks that the element at that point is inside the line, and throws if not.
 * The embedded WebDriver can't click like this: its element click (`$(…).click()`) sends only a
 * lone `click`, which no real mouse sends and which neither CodeMirror (selection on mousedown)
 * nor the caret (restart on mousedown) acts on; its pointer actions send `detail: 0`, which
 * CodeMirror counts as a triple click and turns into a whole-line selection, so Vim leaves normal
 * mode.
 */
export async function clickLine(text: string): Promise<void> {
  const result = await browser.execute((want: string) => {
    const line = [...document.querySelectorAll<HTMLElement>(".cm-line")].find((l) => l.textContent === want);
    if (!line) return { error: `no editor line reads "${want}"` };
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let textNode: Text | null = null;
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      if (n instanceof Text && n.data.trim().length >= 3) {
        textNode = n;
        break;
      }
    }
    if (!textNode) return { error: `the line "${want}" has no text to click` };
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 2);
    const char = range.getBoundingClientRect();
    const x = char.left + char.width / 2;
    const y = char.top + char.height / 2;
    const hit = document.elementFromPoint(x, y);
    const point = `(${Math.round(x)}, ${Math.round(y)})`;
    if (!hit || !line.contains(hit)) {
      const on = hit ? `${hit.nodeName.toLowerCase()}.${hit.className}` : "nothing";
      return { error: `the point ${point} is on ${on}, not on the line "${want}"` };
    }
    const at = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, detail: 1 };
    const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
    hit.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }));
    hit.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
    hit.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    hit.dispatchEvent(new MouseEvent("mouseup", { ...at, buttons: 0 }));
    hit.dispatchEvent(new MouseEvent("click", { ...at, buttons: 0 }));
    return { point };
  }, text);
  if ("error" in result) throw new Error(`clickLine: ${result.error}`);
  console.log(`IDLE click at ${result.point} on "${text}"`);
}

/** The buffer's Vim mode and the focused line's text. */
export function cursor(): Promise<{ mode: string; line: string }> {
  return browser.execute(() => ({
    mode: document.querySelector<HTMLElement>(".lecture-buffer")?.dataset.vimMode ?? "",
    line: document.querySelector(".cm-focused-line")?.textContent ?? "",
  }));
}

/**
 * What decides whether the caret can blink, read in the page: the reduced-motion preference
 * (caret.ts never blinks under it), the caret layers CodeMirror made, whether the webview has
 * `Element.animate`, and every animation `document.getAnimations()` lists.
 */
export function caretDiagnosis(): Promise<{
  reducedMotion: boolean | null;
  layers: string[];
  animate: boolean;
  animations: string[];
}> {
  return browser.execute(() => ({
    reducedMotion: typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : null,
    layers: [...document.querySelectorAll(".cm-scroller > .cm-cursorLayer")].map((l) => l.className),
    animate: typeof Element.prototype.animate === "function",
    animations: document.getAnimations().map((a) => {
      const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
      const on = target instanceof Element ? target.className : "?";
      return `${a.constructor.name} ${a.playState} on ${on}`;
    }),
  }));
}

/** Running animations and transitions in the main window: kind and target. */
export function running(): Promise<string[]> {
  return browser.execute(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
        const name = "animationName" in a ? `css-animation ${String(a.animationName)}` : "";
        const prop = "transitionProperty" in a ? `transition ${String(a.transitionProperty)}` : "";
        return `${name || prop || "animation"} on ${target instanceof Element ? target.className : "?"}`;
      }),
  );
}

/** How many running animations are on CodeMirror's caret layers. */
export async function caretBlinks(): Promise<number> {
  return (await running()).filter((a) => a.includes("cm-cursorLayer")).length;
}

/** The caret as drawn: Vim's block cursor in normal mode (opacity of its layer, size, display). */
export function caret(): Promise<{ opacity: string; display: string; width: number; height: number } | null> {
  return browser.execute(() => {
    const layer = document.querySelector<HTMLElement>(".cm-vimCursorLayer");
    const cursor = layer?.querySelector<HTMLElement>(".cm-fat-cursor");
    if (!layer || !cursor) return null;
    const box = cursor.getBoundingClientRect();
    return {
      opacity: getComputedStyle(layer).opacity,
      display: getComputedStyle(cursor).display,
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
}

/** Opens the mutation and frame window now. */
export function openWindow(): Promise<void> {
  return browser.execute(() => {
    const probe = (window as unknown as { __idle?: Probe }).__idle;
    if (!probe) return;
    const watch = { start: performance.now(), mutations: [] as { t: number; what: string }[], frames: [] as number[] };
    probe.watch = watch;
    const observer = new MutationObserver((records) => {
      const t = performance.now();
      for (const r of records) {
        const target = r.target instanceof Element ? r.target.className : r.target.nodeName;
        watch.mutations.push({ t, what: `${r.type} ${r.attributeName ?? ""} on ${target}` });
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    (window as unknown as { __idleObserver?: MutationObserver }).__idleObserver = observer;
  });
}

/** Closes the window and returns what happened within its first `ms`. */
export function closeWindow(ms: number): Promise<{ lasted: number; mutations: string[]; frames: number }> {
  return browser.execute((length: number) => {
    const w = window as unknown as { __idle?: Probe; __idleObserver?: MutationObserver };
    w.__idleObserver?.disconnect();
    const watch = w.__idle?.watch;
    if (!w.__idle || !watch) return { lasted: 0, mutations: ["no window was open"], frames: 0 };
    w.__idle.watch = undefined;
    const end = watch.start + length;
    return {
      lasted: performance.now() - watch.start,
      mutations: watch.mutations.filter((m) => m.t <= end).map((m) => m.what),
      frames: watch.frames.filter((t) => t <= end).length,
    };
  }, ms);
}
