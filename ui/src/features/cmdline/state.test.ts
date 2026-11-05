import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeCore, settle } from "./__tests__/fakeCore";
import { type Cmdline, createCmdline, type ExTarget, MESSAGE_MS, UNREAD } from "./state";

function buffer() {
  const ran: string[] = [];
  let focused = 0;
  const target: ExTarget = { run: (line) => ran.push(line), focus: () => focused++ };
  return { target, ran, focused: () => focused };
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.useRealTimers();
});

function make(core = fakeCore()): { c: Cmdline; core: ReturnType<typeof fakeCore> } {
  return createRoot((d) => {
    dispose = d;
    return { c: createCmdline(core), core };
  });
}

describe("the command line", () => {
  it("opens empty and loads the settings once (F-040 criterion 1)", async () => {
    const { c, core } = make();
    const b = buffer();
    expect(c.isOpen()).toBe(false);
    c.open(b.target);
    expect(c.isOpen()).toBe(true);
    expect(c.text()).toBe("");
    expect(c.completions().map((x) => x.label)).toEqual(["find", "read", "set"]);
    await settle();
    c.setText("set ui.");
    expect(c.completions().map((x) => x.label)).toEqual(["ui.performance"]);
    c.close();
    c.open(b.target);
    await settle();
    expect(core.calls).toEqual(["schema"]);
  });

  it("asks for the schema again after a failed ask", async () => {
    const core = fakeCore();
    core.failSchema = true;
    const { c } = make(core);
    c.open(buffer().target);
    await settle();
    c.setText("set ui.");
    expect(c.completions()).toEqual([]);
    c.close();
    c.open(buffer().target);
    await settle();
    c.setText("set ui.");
    expect(c.completions().map((x) => x.label)).toEqual(["ui.performance"]);
    expect(core.calls).toEqual(["schema", "schema"]);
  });

  it("Tab takes the picked completion, else the first; arrows move the pick and wrap", async () => {
    const { c } = make();
    c.open(buffer().target);
    await settle();
    c.setText("set ui.performance=");
    expect(c.picked()).toBe(-1);
    c.move(1);
    c.move(1);
    expect(c.picked()).toBe(1);
    c.take();
    expect(c.text()).toBe("set ui.performance=balanced");
    expect(c.picked()).toBe(-1);
    c.setText("set ui.performance=");
    c.take();
    expect(c.text()).toBe("set ui.performance=performance");
    c.setText("set ui.performance=");
    c.move(-1);
    expect(c.picked()).toBe(2);
    c.move(1);
    expect(c.picked()).toBe(-1);
    c.move(1);
    c.move(1);
    c.move(1);
    c.move(1);
    expect(c.picked()).toBe(-1);
    // From the first, up goes back to none.
    c.move(1);
    c.move(-1);
    expect(c.picked()).toBe(-1);
    c.move(-1);
    c.move(-1);
    expect(c.picked()).toBe(1);
    c.move(1);
    c.move(1);
    c.take(2);
    expect(c.text()).toBe("set ui.performance=quality");
    c.setText("set zzz");
    c.move(1);
    expect(c.picked()).toBe(-1);
    c.take();
    expect(c.text()).toBe("set zzz");
  });

  it("hands a line that isn't :set to the buffer's Vim, after closing", () => {
    const { c } = make();
    const b = buffer();
    c.open(b.target);
    c.setText("find covariance of sums");
    c.submit();
    expect(b.ran).toEqual(["find covariance of sums"]);
    expect(c.isOpen()).toBe(false);
    expect(b.focused()).toBe(1);
    c.open(b.target);
    c.setText("   ");
    c.submit();
    expect(b.ran).toEqual(["find covariance of sums"]);
    expect(c.isOpen()).toBe(false);
  });

  it("does nothing on Enter while shut", () => {
    const { c, core } = make();
    c.setText("set ui.performance?");
    c.submit();
    expect(core.calls).toEqual([]);
  });

  it("`:set key?` shows the value and its level (F-040 criterion 3)", async () => {
    const core = fakeCore({ "ui.performance": { value: '"balanced"', source: "default" } });
    const { c } = make(core);
    const b = buffer();
    c.open(b.target);
    await settle();
    c.setText("set ui.performance?");
    c.submit();
    expect(c.isOpen()).toBe(false);
    await settle();
    expect(core.calls).toEqual(["schema", "get ui.performance /courses/STAT311"]);
    expect(c.message()).toEqual({ line: "ui.performance=balanced (default)", note: null, error: false });
    expect(b.ran).toEqual([]);
  });

  it("`:set key=value` writes the checked value and shows the note (F-040 criterion 4)", async () => {
    const core = fakeCore({ "ui.performance": { value: '"balanced"', source: "default" } });
    const { c } = make(core);
    c.open(buffer().target);
    await settle();
    c.setText("set ui.performance=quality");
    c.submit();
    expect(c.isOpen()).toBe(false);
    await settle();
    expect(core.calls).toEqual(["schema", 'set ui.performance "quality" /courses/STAT311']);
    expect(c.message()).toEqual({
      line: "ui.performance=quality (global)",
      note: "Can add input lag on slower machines.",
      error: false,
    });
    c.open(buffer().target);
    expect(c.message()).toBe(null);
    c.setText("set ui.performance?");
    c.submit();
    await settle();
    expect(c.message()?.line).toBe("ui.performance=quality (global)");
  });

  it("refuses a value outside the schema in the box, and writes nothing (F-040 criteria 2 and 4)", async () => {
    const { c, core } = make();
    c.open(buffer().target);
    await settle();
    c.setText("set ui.performance=fast");
    c.submit();
    expect(c.isOpen()).toBe(true);
    expect(c.refusal()).toBe("ui.performance must be one of performance, balanced, quality");
    expect(core.calls).toEqual(["schema"]);
    // Typing again clears it.
    c.setText("set ui.performance=f");
    expect(c.refusal()).toBe(null);
  });

  it("checks against the schema even when Enter comes before it is in", async () => {
    const { c, core } = make();
    c.open(buffer().target);
    c.setText("set ui.performance=fast");
    c.submit();
    expect(c.refusal()).toBe(null);
    await settle();
    expect(c.refusal()).toBe("ui.performance must be one of performance, balanced, quality");
    expect(core.calls).toEqual(["schema"]);
  });

  it("says so when the schema can't be had", async () => {
    const core = fakeCore();
    core.failSchema = true;
    const { c } = make(core);
    c.open(buffer().target);
    c.setText("set ui.performance?");
    c.submit();
    await settle();
    expect(c.isOpen()).toBe(true);
    expect(c.refusal()).toBe(UNREAD);
    expect(UNREAD).toBe("Lecter could not read the settings; try again.");
  });

  it("shows the core's refusal as an error message", async () => {
    const core = fakeCore();
    core.failSet = { code: "E_IO", message: "could not write config.jsonc (PermissionDenied)", retryable: true };
    const { c } = make(core);
    c.open(buffer().target);
    await settle();
    c.setText("set index.contextLines=true");
    c.submit();
    await settle();
    expect(c.message()).toEqual({
      line: "could not write config.jsonc (PermissionDenied)",
      note: null,
      error: true,
    });
  });

  it("closes the message after a while, and a newer one restarts the wait", async () => {
    vi.useFakeTimers();
    const core = fakeCore({ "ui.performance": { value: '"balanced"', source: "default" } });
    const { c } = make(core);
    c.open(buffer().target);
    await vi.runOnlyPendingTimersAsync();
    c.setText("set ui.performance?");
    c.submit();
    await vi.advanceTimersByTimeAsync(MESSAGE_MS - 1000);
    expect(c.message()).not.toBe(null);
    c.open(buffer().target);
    c.setText("set ui.performance?");
    c.submit();
    await vi.advanceTimersByTimeAsync(MESSAGE_MS - 1000);
    expect(c.message()).not.toBe(null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.message()).toBe(null);
  });

  it("Escape-like close gives the keys back to the buffer and forgets the line", () => {
    const { c } = make();
    const b = buffer();
    c.open(b.target);
    c.setText("set ui");
    c.close();
    expect(c.isOpen()).toBe(false);
    expect(c.text()).toBe("");
    expect(b.focused()).toBe(1);
    c.close();
    expect(b.focused()).toBe(1);
  });
});
