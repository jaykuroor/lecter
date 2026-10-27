// Stream updates are batched to one paint per animation frame (ui/CLAUDE.md, 06-ai-harness.md#loop
// step 2): deltas that arrive between two frames are joined and written to the DOM once.

/** Runs a callback on the next frame; `requestAnimationFrame` in the app. */
export type Schedule = (callback: () => void) => unknown;

/** Collects text and hands it to `write` at most once per frame. */
export class FrameBatcher {
  private pending = "";
  private scheduled = false;

  constructor(
    private readonly write: (text: string) => void,
    private readonly schedule: Schedule = (cb) => requestAnimationFrame(cb),
  ) {}

  /** Adds `text`; it is written on the next frame together with everything else added before it. */
  push(text: string): void {
    this.pending += text;
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => this.paint());
  }

  /** Drops what is pending without writing it (the stream was stopped). */
  discard(): void {
    this.pending = "";
  }

  private paint(): void {
    this.scheduled = false;
    if (this.pending === "") return;
    const text = this.pending;
    this.pending = "";
    this.write(text);
  }
}
