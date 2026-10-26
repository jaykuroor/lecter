// Stream updates are batched to one paint per animation frame (ui/CLAUDE.md, 06-ai-harness.md#loop
// step 2): deltas that arrive between two frames are joined and written to the DOM once.

/** Schedules a callback for the next frame and returns a handle; `requestAnimationFrame` in the app. */
export type Schedule = (callback: () => void) => number;
/** Drops a scheduled callback; `cancelAnimationFrame` in the app. */
export type Unschedule = (handle: number) => void;

/** Collects text and hands it to `write` at most once per frame. */
export class FrameBatcher {
  private pending = "";
  private frame: number | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly schedule: Schedule = (cb) => requestAnimationFrame(cb),
    private readonly unschedule: Unschedule = (h) => cancelAnimationFrame(h),
  ) {}

  /** Adds `text`; it is written on the next frame together with everything else added before it. */
  push(text: string): void {
    if (text === "") return;
    this.pending += text;
    if (this.frame === null) this.frame = this.schedule(() => this.flush());
  }

  /** Writes what is pending now (the stream ended) and drops the scheduled frame. */
  flush(): void {
    this.cancelFrame();
    if (this.pending === "") return;
    const text = this.pending;
    this.pending = "";
    this.write(text);
  }

  /** Drops what is pending without writing it (the stream was stopped). */
  discard(): void {
    this.cancelFrame();
    this.pending = "";
  }

  private cancelFrame(): void {
    if (this.frame === null) return;
    this.unschedule(this.frame);
    this.frame = null;
  }
}
