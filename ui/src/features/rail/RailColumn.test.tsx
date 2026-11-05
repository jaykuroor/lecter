import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../../e2e/mock-core/fixture";
import { installMockCore } from "../../../e2e/mock-core/install";
import type { CourseOpened, KnownCourse } from "../../core/bindings";
import { createCourse } from "../../state/course";
import { createRail, type RailState } from "../../state/rail";
import { RailColumn } from "./RailColumn";

const course = (path: string, name: string): CourseOpened => ({
  path,
  name,
  lectures: [{ name: "l01.md", path: "lectures/l01.md" }],
  slides: [],
  trust: "trusted",
  screen: trustScreen,
});
const stat = course("/c/stat", "STAT311");
const calc = course("/c/calc", "MATH221");
const onRail = (c: CourseOpened, extra: Partial<KnownCourse> = {}): KnownCourse => ({
  path: c.path,
  name: c.name,
  icon: c.name.charAt(0),
  color: "#3584e4",
  missing: false,
  ...extra,
});

/** The column as the app mounts it, with the rail loaded. */
async function mount(): Promise<RailState> {
  let rail: RailState | undefined;
  render(() => {
    const state = createCourse();
    rail = createRail();
    return <RailColumn course={state} rail={rail} onOpenLecture={() => {}} openLecture={null} />;
  });
  if (!rail) throw new Error("no rail");
  await rail.load();
  return rail;
}

const rows = () => screen.getAllByRole("button", { name: /^Course\b/ });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("RailColumn", () => {
  afterEach(cleanup);

  it("lists the rail's courses and opens one by click, showing its files below", async () => {
    installMockCore({
      ...defaultFixture,
      rail: [onRail(stat), onRail(calc)],
      switch: { [stat.path]: stat, [calc.path]: calc },
    });
    await mount();
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Course STAT311", "Course MATH221"]);
    fireEvent.click(rows()[1] as HTMLElement);
    const panel = await screen.findByRole("region", { name: "Course MATH221" });
    expect(within(panel).getByRole("region", { name: "Lectures" })).toBeTruthy();
    expect(rows()[1]?.getAttribute("aria-current")).toBe("true");
  });

  it("switches with Ctrl-2 and Ctrl-1", async () => {
    installMockCore({
      ...defaultFixture,
      rail: [onRail(stat), onRail(calc)],
      switch: { [stat.path]: stat, [calc.path]: calc },
    });
    await mount();
    const current = () => rows().map((r) => r.getAttribute("aria-current"));
    fireEvent.keyDown(document.body, { key: "2", code: "Digit2", ctrlKey: true });
    const calcPanel = await screen.findByRole("region", { name: "Course MATH221" });
    expect(within(calcPanel).getByRole("heading", { level: 2 }).textContent).toBe("MATH221");
    expect(current()).toEqual([null, "true"]);
    fireEvent.keyDown(document.body, { key: "1", code: "Digit1", ctrlKey: true });
    const statPanel = await screen.findByRole("region", { name: "Course STAT311" });
    expect(within(statPanel).getByRole("heading", { level: 2 }).textContent).toBe("STAT311");
    expect(current()).toEqual(["true", null]);
  });

  it("adds a picked course to the end of the rail", async () => {
    installMockCore({ ...defaultFixture, rail: [onRail(stat)], courseOpen: calc });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    expect(await screen.findByRole("region", { name: "Course MATH221" })).toBeTruthy();
    await settle();
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Course STAT311", "Course MATH221"]);
  });

  it("saves a reorder by Shift-J in the core", async () => {
    installMockCore({ ...defaultFixture, rail: [onRail(stat), onRail(calc)] });
    const rail = await mount();
    fireEvent.keyDown(rows()[0] as HTMLElement, { key: "J", shiftKey: true });
    await settle();
    expect(rail.courses().map((c) => c.path)).toEqual([calc.path, stat.path]);
    expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Course MATH221", "Course STAT311"]);
  });

  it("shows a missing course dimmed, and why it won't open", async () => {
    installMockCore({
      ...defaultFixture,
      rail: [onRail(stat), onRail(calc, { missing: true })],
      switch: { [stat.path]: stat },
    });
    await mount();
    const missing = rows()[1] as HTMLElement;
    expect(missing.classList.contains("missing")).toBe(true);
    fireEvent.click(missing);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That course folder is missing or has moved; add it again with +.");
    expect(screen.queryByRole("region", { name: /^Course / })).toBeNull();
  });

  it("shows the image icon's course by its first letter for now", async () => {
    installMockCore({ ...defaultFixture, rail: [onRail(stat, { icon: ".lecter/icon.png" })] });
    await mount();
    expect(rows()[0]?.querySelector(".rail-icon")?.textContent).toBe("S");
    expect(rows()[0]?.querySelector("img")).toBeNull();
  });
});
