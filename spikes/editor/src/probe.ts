// Keystroke-to-paint probe (same code in every browser engine).
//
// For each keystroke (all key/input events between two `flush()` calls) it records:
//   raw  = first event's timeStamp → after the paint of the last frame that event handlers requested
//          (rAF, then a MessageChannel task, which runs after that frame's paint). Includes the idle
//          wait for the next vsync, so it is bounded below by the display's frame interval.
//   work = Σ per event (end of the event's task − event.timeStamp)
//        + Σ per distinct frame (after paint − rAF start): the main-thread time the keystroke costs,
//          without the idle vsync wait. This is the number compared with keystroke_p99_ms.
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

export function installProbe(): void {
  const raw: number[] = [];
  const work: number[] = [];
  let cur: Pending | null = null;
  let waiters: (() => void)[] = [];

  const settle = () => {
    if (cur && cur.open === 0) for (const w of waiters.splice(0)) w();
  };

  const onEvent = (e: Event) => {
    if (!cur) cur = { start: e.timeStamp, eventWork: 0, frames: new Map(), lastPaint: 0, open: 0 };
    const p = cur;
    const t0 = e.timeStamp;
    p.open += 2;
    afterTask(() => {
      p.eventWork += performance.now() - t0;
      p.open--;
      settle();
    });
    requestAnimationFrame((frameTs) => {
      const tRaf = performance.now();
      afterTask(() => {
        const tPaint = performance.now();
        if (!p.frames.has(frameTs)) p.frames.set(frameTs, tPaint - tRaf);
        p.lastPaint = Math.max(p.lastPaint, tPaint);
        p.open--;
        settle();
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
      cur = null;
      waiters = [];
    },
    samples: () => ({ raw: [...raw], work: [...work] }),
  };
}
