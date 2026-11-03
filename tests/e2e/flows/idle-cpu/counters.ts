// The page side of the idle attribution (F-180, D-161): counters installed in the app's window
// before the idle wait and read after it with WebDriver, so nothing talks to the page in between.
// They count what the page itself does: requestAnimationFrame callbacks (wrapped, with the caller's
// stack), MutationObserver records, and CSS animation and transition events, plus the animations
// `document.getAnimations()` lists at the end. A compositor-only animation fires its start and
// iteration events but no frame callback; a native caret blink shows in none of them, only in the
// web process's CPU. Each function's body runs in the page, so it uses only page globals.

/** What the page keeps on `window.__idleCount`. Times are epoch ms (timeOrigin + now). */
interface Counts {
  frames: { t: number; stack: string }[];
  mutations: { t: number; what: string }[];
  events: { t: number; what: string }[];
  observer: MutationObserver;
}

/** Installs the counters; each starts empty. */
export function installCounters(): Promise<void> {
  return browser.execute(() => {
    const w = window as unknown as { __idleCount?: Counts; requestAnimationFrame: typeof requestAnimationFrame };
    w.__idleCount?.observer.disconnect();
    const epoch = () => performance.timeOrigin + performance.now();
    const describe = (n: EventTarget | Node | null) =>
      n instanceof Element ? `${n.nodeName.toLowerCase()}.${n.className}` : n instanceof Node ? n.nodeName : "?";
    const counts: Counts = {
      frames: [],
      mutations: [],
      events: [],
      observer: new MutationObserver((records) => {
        const t = epoch();
        for (const r of records)
          counts.mutations.push({ t, what: `${r.type} ${r.attributeName ?? ""} on ${describe(r.target)}` });
      }),
    };
    w.__idleCount = counts;
    counts.observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    for (const type of ["animationstart", "animationiteration", "transitionrun", "transitionstart"]) {
      document.addEventListener(
        type,
        (e) => {
          const name =
            "animationName" in e ? String(e.animationName) : "propertyName" in e ? String(e.propertyName) : "";
          counts.events.push({ t: epoch(), what: `${type} ${name} on ${describe(e.target)}` });
        },
        true,
      );
    }
    const wrapped = w.requestAnimationFrame as typeof requestAnimationFrame & { __idleCount?: boolean };
    if (wrapped.__idleCount) return;
    const raf = window.requestAnimationFrame.bind(window);
    const counting = (cb: FrameRequestCallback) => {
      // The stack names who asked for the frame; only the first few are kept in full.
      const stack = counts.frames.length < 20 ? (new Error().stack ?? "").split("\n").slice(1, 4).join(" < ") : "";
      return raf((t) => {
        (window as unknown as { __idleCount?: Counts }).__idleCount?.frames.push({ t: epoch(), stack });
        cb(t);
      });
    };
    (counting as unknown as { __idleCount: boolean }).__idleCount = true;
    w.requestAnimationFrame = counting;
  });
}

/** What the counters saw between `from` and `to` (epoch ms), and the page's state now. */
export interface PageCounts {
  frames: number;
  frameStacks: string[];
  mutations: number;
  firstMutations: string[];
  animationEvents: number;
  firstAnimationEvents: string[];
  /** Per sample interval of `stepMs` from `from`: frames, mutations and animation events. */
  perSample: { frames: number[]; mutations: number[]; events: number[] };
  running: string[];
  focus: {
    document: boolean;
    active: string;
    editorFocused: boolean;
    /** .cm-content's contenteditable: "false" while the editor is parked (nativeCaret.ts). */
    editable: string | null;
    selection: string;
  };
  reducedMotion: boolean | null;
  userAgent: string;
}

/** Reads the counters for the window [from, to] in `stepMs` intervals. */
export function readCounters(from: number, to: number, stepMs: number): Promise<PageCounts> {
  return browser.execute(
    (from: number, to: number, step: number) => {
      const c = (window as unknown as { __idleCount?: Counts }).__idleCount;
      const inside = <T extends { t: number }>(xs: T[]) => xs.filter((x) => x.t >= from && x.t <= to);
      const n = Math.max(1, Math.ceil((to - from) / step));
      const buckets = (xs: { t: number }[]) => {
        const out = new Array<number>(n).fill(0);
        for (const x of xs) out[Math.min(n - 1, Math.floor((x.t - from) / step))] += 1;
        return out;
      };
      const frames = inside(c?.frames ?? []);
      const mutations = inside(c?.mutations ?? []);
      const events = inside(c?.events ?? []);
      const sel = getSelection();
      const active = document.activeElement;
      return {
        frames: frames.length,
        frameStacks: [...new Set(frames.map((f) => f.stack).filter(Boolean))].slice(0, 3),
        mutations: mutations.length,
        firstMutations: mutations.slice(0, 5).map((m) => m.what),
        animationEvents: events.length,
        firstAnimationEvents: events.slice(0, 5).map((e) => e.what),
        perSample: { frames: buckets(frames), mutations: buckets(mutations), events: buckets(events) },
        running: document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) => {
            const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
            return `${a.constructor.name} on ${target instanceof Element ? target.className : "?"}`;
          }),
        focus: {
          document: document.hasFocus(),
          active: active ? `${active.nodeName.toLowerCase()}.${active.className}` : "none",
          editorFocused: document.querySelector(".cm-editor")?.classList.contains("cm-focused") ?? false,
          editable: document.querySelector(".cm-content")?.getAttribute("contenteditable") ?? null,
          selection: sel ? `${sel.type}, ${sel.rangeCount} range(s)` : "none",
        },
        reducedMotion: typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : null,
        userAgent: navigator.userAgent,
      };
    },
    from,
    to,
    stepMs,
  );
}

/** The `idle-attribution` lines for the page part. */
export function pageLines(p: PageCounts): string[] {
  const series = (xs: number[]) => xs.join(" ");
  return [
    `idle-attribution page: ${p.frames} frame callbacks, ${p.mutations} mutations, ${p.animationEvents} animation/transition events; running animations at the end: ${p.running.length ? p.running.join("; ") : "none"}`,
    `idle-attribution page per sample: frames ${series(p.perSample.frames)} | mutations ${series(p.perSample.mutations)} | animation events ${series(p.perSample.events)}`,
    ...(p.frameStacks.length ? [`idle-attribution page frame requests from: ${p.frameStacks.join(" || ")}`] : []),
    ...(p.firstMutations.length ? [`idle-attribution page first mutations: ${p.firstMutations.join("; ")}`] : []),
    ...(p.firstAnimationEvents.length
      ? [`idle-attribution page first animation events: ${p.firstAnimationEvents.join("; ")}`]
      : []),
    `idle-attribution page state: focus ${JSON.stringify(p.focus)}; reduced motion ${p.reducedMotion}; ${p.userAgent}`,
  ];
}
