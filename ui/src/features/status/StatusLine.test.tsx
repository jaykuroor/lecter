import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { SlidePos, StatusMode } from "./labels";
import { StatusLine } from "./StatusLine";

// 09-ui.md#layout: mode, course/lecture, slide, active model, lecture cost, job spinner;
// components.md#status-line: mode first (mode-colors), course/lecture next, position n/N last.

afterEach(cleanup);

interface Shown {
  mode?: StatusMode;
  place?: string | null;
  slide?: SlidePos | null;
  model?: string | null;
  cost?: number | null;
  running?: number;
}

function show(p: Shown = {}) {
  return render(() => (
    <StatusLine
      mode={p.mode ?? "normal"}
      place={p.place ?? null}
      slide={p.slide ?? null}
      model={p.model ?? null}
      cost={p.cost ?? null}
      running={p.running ?? 0}
    >
      <span class="status-version">v1.2.3</span>
    </StatusLine>
  ));
}

const line = () => screen.getByRole("status", { name: "Status line" });
/** The segments in order, as `class=text`. */
const segments = () => [...line().children].map((c) => `${c.className}=${c.textContent}`);

describe("StatusLine", () => {
  it("shows every segment in order: mode, course/lecture, the rest, model, cost, jobs, slide", () => {
    show({ mode: "insert", place: "STAT311/l07", slide: { n: 3, total: 6 }, model: "sample", cost: 0.04, running: 1 });
    expect(segments()).toEqual([
      "status-mode=INSERT",
      "status-place=STAT311/l07",
      "status-fill=v1.2.3",
      "status-model=sample",
      "status-cost=$0.04",
      "status-jobs=",
      "status-slide=3/6",
    ]);
  });

  it("names its parts (titles: the text the mouse shows)", () => {
    show({ slide: { n: 3, total: 6 }, model: "sample", cost: 0.04, running: 2 });
    expect(screen.getByTitle("Slide 3 of 6").textContent).toBe("3/6");
    expect(screen.getByTitle("Active model").textContent).toBe("sample");
    expect(screen.getByTitle("Lecture cost").textContent).toBe("$0.04");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("2 AI jobs running");
  });

  it("says one job in the singular", () => {
    show({ running: 1 });
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("1 AI job running");
  });

  it("leaves out what isn't known yet: course, slide, model, cost, and the spinner when idle", () => {
    show();
    expect(segments()).toEqual(["status-mode=NORMAL", "status-fill=v1.2.3"]);
    expect(line().querySelector(".status-spinner")).toBeNull();
  });

  it.each([
    ["normal", "NORMAL"],
    ["insert", "INSERT"],
    ["visual", "VISUAL"],
    ["command", "COMMAND"],
  ] as const)("marks the %s mode for its colour (tokens.json mode-colors)", (mode, label) => {
    show({ mode });
    const seg = line().querySelector(".status-mode") as HTMLElement;
    expect(seg.dataset.mode).toBe(mode);
    expect(seg.textContent).toBe(label);
  });

  it("changes the mode segment in place as the mode changes", () => {
    const [mode, setMode] = createSignal<StatusMode>("normal");
    render(() => (
      <StatusLine mode={mode()} place={null} slide={null} model={null} cost={null} running={0}>
        {null}
      </StatusLine>
    ));
    const seg = line().querySelector(".status-mode") as HTMLElement;
    setMode("command");
    expect(line().querySelector(".status-mode")).toBe(seg);
    expect(seg.dataset.mode).toBe("command");
    expect(seg.textContent).toBe("COMMAND");
  });

  it("starts the spinner only while a job runs, and stops it after", () => {
    const [running, setRunning] = createSignal(0);
    render(() => (
      <StatusLine mode="normal" place={null} slide={null} model={null} cost={null} running={running()}>
        {null}
      </StatusLine>
    ));
    expect(line().querySelector(".status-spinner")).toBeNull();
    setRunning(1);
    expect(line().querySelector(".status-jobs .status-spinner")).not.toBeNull();
    setRunning(0);
    expect(line().querySelector(".status-jobs")).toBeNull();
  });
});
