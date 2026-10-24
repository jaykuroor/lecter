// Keystroke-to-paint probe (same code in every browser engine).
//
// For each keystroke (all key/input events between two `flush()` calls) it records:
//   raw  = first event's timeStamp → after the paint of the last frame that event handlers requested
//          (rAF, then a MessageChannel task, which runs after that frame's paint). Includes the idle
//          wait for the next vsync, so it is bounded below by the display's frame interval.
//   work = Σ per event (end of its listeners and their microtasks − its first capture listener)
//        + Σ per distinct frame (after paint − rAF start): the main-thread time the keystroke costs,
//          without the idle vsync wait or browser→renderer queueing. Compared with keystroke_p99_ms.
//          It misses the browser default action between beforeinput and input (text insertion).
//   handler / frame = the two parts of work, reported separately.
//   With `syncFlush` (the `?sync=1` pass), each event's end mark first runs it (CodeMirror's measure
//   cycle, then a forced style + layout), so `handler` becomes "sync": input handling through
//   layout with no rAF and no vsync. Paint, raster and composite are not in it. That pass changes
//   when CodeMirror measures, so its raw/work numbers are not reported.
const EVENTS = ["keydown", "keypress", "beforeinput", "input", "keyup"] as const;

interface Pending {
  start: number;
  eventWork: number;
  frames: Map<number, number>; // rAF timestamp → frame work
  lastPaint: number;
  open: number;
}

function afterTask(cb: () => void): void {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    ch.port1.close();
    cb();
  };
  ch.port2.postMessage(0);
}

export function installProbe(syncFlush?: () => void): void {
  const raw: number[] = [];
  const work: number[] = [];
  const handler: number[] = [];
  const frame: number[] = [];
  let missed = 0; // events whose end listener never ran (stopImmediatePropagation)
  let cur: Pending | null = null;
  let waiters: (() => void)[] = [];

  const settle = () => {
    if (cur && cur.open === 0) for (const w of waiters.splice(0)) w();
  };

  const onEvent = (e: Event) => {
    if (!cur) cur = { start: e.timeStamp, eventWork: 0, frames: new Map(), lastPaint: 0, open: 0 };
    const p = cur;
    // Handlers start when this capture listener on window runs. They end after the last listener on
    // the target (added now, so it runs after the editor's own listeners there; Vim stops propagation,
    // so a bubbling listener on window would never see it) plus the microtasks they queued (CodeMirror
    // reads DOM changes in a MutationObserver). A task posted from here is no use: Chromium runs the
    // next frame first, which would count the vsync wait.
    const tCap = performance.now();
    let tEnd = Number.NaN;
    let parts = 1;
    const part = () => {
      if (--parts > 0) return;
      if (Number.isNaN(tEnd)) missed++;
      else p.eventWork += tEnd - tCap;
      p.open--;
      settle();
    };
    p.open++;
    const target = e.target;
    if (target instanceof EventTarget) {
      target.addEventListener(
        e.type,
        () =>
          queueMicrotask(() => {
            syncFlush?.();
            tEnd = performance.now();
          }),
        { once: true },
      );
    }
    requestAnimationFrame((frameTs) => {
      const tRaf = performance.now();
      afterTask(() => {
        const tPaint = performance.now();
        if (!p.frames.has(frameTs)) p.frames.set(frameTs, tPaint - tRaf);
        p.lastPaint = Math.max(p.lastPaint, tPaint);
        part();
      });
    });
  };
  for (const name of EVENTS) window.addEventListener(name, onEvent, true);

  (window as unknown as Record<string, unknown>).__probe = {
    /** Resolves when the current keystroke's frames have painted; records one sample. */
    flush: () =>
      new Promise<void>((resolve) => {
        const done = () => {
          if (cur) {
            let frameWork = 0;
            for (const v of cur.frames.values()) frameWork += v;
            raw.push(cur.lastPaint - cur.start);
            work.push(cur.eventWork + frameWork);
            handler.push(cur.eventWork);
            frame.push(frameWork);
          }
          cur = null;
          resolve();
        };
        if (!cur || cur.open === 0) done();
        else waiters.push(done);
      }),
    reset: () => {
      raw.length = 0;
      work.length = 0;
      handler.length = 0;
      frame.length = 0;
      missed = 0;
      cur = null;
      waiters = [];
    },
    samples: () => ({ raw: [...raw], work: [...work], handler: [...handler], frame: [...frame], missed }),
  };
}
