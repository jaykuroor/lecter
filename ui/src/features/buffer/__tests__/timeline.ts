// A fake Web Animations timeline for jsdom, which has no `Element.prototype.animate`. It is an
// in-memory implementation of the parts the caret uses (animate, currentTime, play, cancel, finite
// iterations, keyframes with `step-end` easing, no fill) on the test's own clock, so a test can ask
// what the browser would show at any moment: is anything animating, and how opaque is an element.

interface Running {
  element: Element;
  keyframes: Keyframe[];
  duration: number;
  iterations: number;
  fill: string;
  /** Clock time at which the current play started; null once cancelled. */
  start: number | null;
}

/** The fake timeline, installed on `Element.prototype` until `uninstall()`. */
export interface Timeline {
  /** Moves the clock on by `ms`. */
  advance(ms: number): void;
  /** Animations that are running now on `element` (or anywhere), as `getAnimations()` lists them. */
  running(element?: Element): number;
  /** The opacity `element` shows now: its animated value while one runs, else 1 (no fill). */
  opacity(element: Element): number;
  /** Every animation ever created, for checks on how many were made. */
  created(): number;
  uninstall(): void;
}

/** The value of `keyframes` at `progress` (0..1) through one iteration. */
function valueAt(keyframes: Keyframe[], progress: number): number {
  const frames = keyframes.map((k, i) => ({
    offset: k.offset ?? (keyframes.length === 1 ? 1 : i / (keyframes.length - 1)),
    opacity: Number(k.opacity ?? 1),
    easing: k.easing ?? "linear",
  }));
  for (let i = frames.length - 1; i >= 0; i--) {
    const from = frames[i];
    if (from === undefined || progress < from.offset) continue;
    const to = frames[i + 1];
    if (to === undefined || to.offset === from.offset) return from.opacity;
    if (from.easing === "step-end") return from.opacity;
    const t = (progress - from.offset) / (to.offset - from.offset);
    return from.opacity + (to.opacity - from.opacity) * t;
  }
  return 1;
}

export function installTimeline(): Timeline {
  let now = 0;
  const all: Running[] = [];
  const proto = Element.prototype as unknown as { animate?: unknown };
  const before = proto.animate;

  const isRunning = (r: Running) => r.start !== null && now - r.start < r.duration * r.iterations;

  proto.animate = function animate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    const r: Running = {
      element: this,
      keyframes,
      duration: Number(options.duration ?? 0),
      iterations: options.iterations ?? 1,
      fill: options.fill ?? "auto",
      start: now,
    };
    all.push(r);
    return {
      get currentTime() {
        return r.start === null ? null : now - r.start;
      },
      set currentTime(t: number | null) {
        r.start = t === null ? null : now - t;
      },
      play() {
        if (r.start === null || !isRunning(r)) r.start = now;
      },
      cancel() {
        r.start = null;
      },
    } as unknown as Animation;
  };

  return {
    advance(ms) {
      now += ms;
    },
    running(element) {
      return all.filter((r) => isRunning(r) && (element === undefined || r.element === element)).length;
    },
    opacity(element) {
      const r = all.find((x) => x.element === element && isRunning(x));
      if (!r) {
        const ended = all.find((x) => x.element === element && x.start !== null);
        // A finished animation that fills forwards keeps its last value.
        if (ended && (ended.fill === "forwards" || ended.fill === "both")) {
          const total = ended.duration * ended.iterations;
          return valueAt(ended.keyframes, (total / ended.duration) % 1 || 1);
        }
        return 1;
      }
      const elapsed = now - (r.start ?? now);
      return valueAt(r.keyframes, (elapsed % r.duration) / r.duration);
    },
    created() {
      return all.length;
    },
    uninstall() {
      if (before === undefined) delete proto.animate;
      else proto.animate = before;
    },
  };
}

// CodeMirror measures text ranges to draw the caret; jsdom has no layout, so a range measures as
// nothing (otherwise CodeMirror logs a TypeError for each).
if (!("getClientRects" in Range.prototype)) {
  Object.assign(Range.prototype, {
    getClientRects: () => [],
    getBoundingClientRect: () => new DOMRect(),
  });
}
