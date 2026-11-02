// The keystroke-to-paint probe of the F-001 editor spike (spikes/editor/src/probe.ts), installed
// into the page by `page.addInitScript`, which serialises it: keep it self-contained.
//
// For each keystroke (all key and input events until the next `flush()`) it records `raw`: the
// first event's timeStamp → after the paint of the last frame those events requested (rAF, then a
// MessageChannel task, which runs after that frame's paint). With vsync off (Chromium
// `--disable-gpu-vsync --disable-frame-rate-limit`) a frame is produced as soon as it is needed, so
// `raw` is the end-to-end keystroke-to-paint time the keystroke_p99_ms budget means (D-080).
//
// It also splits each sample in two, to show where the time goes on a slow machine: `toFrame`,
// the first event → the start of the last rAF callback (event handlers, the editor's update and
// the wait for a frame), and `painted`, that rAF → after its paint (style, layout, paint).

/** What the probe exposes on `window.__probe`. */
export interface Probe {
  /** Resolves once the current keystroke's frames have painted, recording one sample. */
  flush(): Promise<void>;
  /** Drops the samples so far. */
  reset(): void;
  /** The recorded keystroke-to-paint times, in ms. */
  samples(): number[];
  /** The same samples split in two (see the top of this file); toFrame + painted = the sample. */
  phases(): { toFrame: number; painted: number }[];
}

export function installProbe(): void {
  const EVENTS = ["keydown", "keypress", "beforeinput", "input", "keyup"];
  const raw: number[] = [];
  const split: { toFrame: number; painted: number }[] = [];
  let current: { start: number; lastFrame: number; lastPaint: number; open: number } | null = null;
  let waiters: (() => void)[] = [];

  const afterTask = (cb: () => void) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      cb();
    };
    ch.port2.postMessage(0);
  };
  const settle = () => {
    if (current && current.open === 0) for (const w of waiters.splice(0)) w();
  };
  const onEvent = (e: Event) => {
    if (!current) current = { start: e.timeStamp, lastFrame: 0, lastPaint: 0, open: 0 };
    const p = current;
    p.open++;
    requestAnimationFrame(() => {
      p.lastFrame = Math.max(p.lastFrame, performance.now());
      afterTask(() => {
        p.lastPaint = Math.max(p.lastPaint, performance.now());
        p.open--;
        settle();
      });
    });
  };
  for (const name of EVENTS) window.addEventListener(name, onEvent, true);

  const probe: Probe = {
    flush: () =>
      new Promise<void>((resolve) => {
        const done = () => {
          if (current) {
            raw.push(current.lastPaint - current.start);
            split.push({ toFrame: current.lastFrame - current.start, painted: current.lastPaint - current.lastFrame });
          }
          current = null;
          resolve();
        };
        if (!current || current.open === 0) done();
        else waiters.push(done);
      }),
    reset: () => {
      raw.length = 0;
      split.length = 0;
      current = null;
      waiters = [];
    },
    samples: () => [...raw],
    phases: () => split.map((x) => ({ ...x })),
  };
  (window as unknown as { __probe: Probe }).__probe = probe;
}
