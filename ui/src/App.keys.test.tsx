import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../e2e/mock-core/fixture";
import { installMockCore } from "../e2e/mock-core/install";
import { App } from "./App";
import type { CourseOpened, KnownCourse } from "./core/bindings";

// The key engine (F-037) owns the app's keys: ␣e toggles the sidebar (D-196) and Ctrl/Cmd-1…9 open
// the nth course on the rail (D-190, D-192), from anywhere, through App's commands.

const course = (path: string, name: string): CourseOpened => ({
  path,
  name,
  lectures: [{ name: "l01.md", path: "lectures/l01.md" }],
  slides: [],
  sources: [],
  trust: "trusted",
  screen: trustScreen,
});
const stat = course("/c/stat", "STAT311");
const calc = course("/c/calc", "MATH221");
const onRail = (c: CourseOpened): KnownCourse => ({
  path: c.path,
  name: c.name,
  icon: c.name.charAt(0),
  color: "#3584e4",
  missing: false,
});

/** A keydown on `target`; whether the page let it through. */
const press = (target: EventTarget, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

const rows = () => screen.getAllByRole("button", { name: /^Course\b/ });
const toggle = () => within(screen.getByRole("banner")).getByRole("button", { name: "Sidebar" });

/** The app with two courses on the rail, the engine's chunk in. */
async function start(): Promise<void> {
  installMockCore({
    ...defaultFixture,
    rail: [onRail(stat), onRail(calc)],
    switch: { [stat.path]: stat, [calc.path]: calc },
  });
  render(() => <App />);
  await waitFor(() => expect(rows()).toHaveLength(2));
  // The engine loads after the first paint; until then Ctrl-9 is held back for it, and from then
  // on it goes through (there is no ninth course).
  await waitFor(() => expect(press(document.body, { key: "9", code: "Digit9", ctrlKey: true })).toBe(true));
}

describe("App keys", () => {
  afterEach(cleanup);

  it("switches courses with Ctrl-2 and Ctrl-1, by the order on screen", async () => {
    await start();
    const current = () => rows().map((r) => r.getAttribute("aria-current"));
    expect(press(document.body, { key: "2", code: "Digit2", ctrlKey: true })).toBe(false);
    const calcPanel = await screen.findByRole("region", { name: "Course MATH221" });
    expect(within(calcPanel).getByRole("heading", { level: 2 }).textContent).toBe("MATH221");
    expect(current()).toEqual([null, "true"]);
    press(document.body, { key: "1", code: "Digit1", ctrlKey: true });
    await screen.findByRole("region", { name: "Course STAT311" });
    expect(current()).toEqual(["true", null]);
    // After a reorder, Ctrl-1 is the course now on top.
    fireEvent.keyDown(rows()[0] as HTMLElement, { key: "J", shiftKey: true });
    await waitFor(() =>
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Course MATH221", "Course STAT311"]),
    );
    press(document.body, { key: "1", code: "Digit1", ctrlKey: true });
    await screen.findByRole("region", { name: "Course MATH221" });
  });

  it("takes Ctrl-n from the focused element only for a course that exists", async () => {
    await start();
    const field = document.createElement("input");
    document.body.append(field);
    expect(press(field, { key: "3", code: "Digit3", ctrlKey: true })).toBe(true);
    expect(press(field, { key: "2", code: "Digit2", ctrlKey: true })).toBe(false);
    await screen.findByRole("region", { name: "Course MATH221" });
    field.remove();
  });

  it("toggles the sidebar with ␣e from the page, and stops once the app is gone", async () => {
    await start();
    press(document.body, { key: "1", code: "Digit1", ctrlKey: true });
    await screen.findByRole("region", { name: "Course STAT311" });
    expect(press(document.body, { key: " " })).toBe(false);
    expect(press(document.body, { key: "e" })).toBe(false);
    expect(screen.queryByRole("region", { name: "Course STAT311" })).toBeNull();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    press(document.body, { key: " " });
    press(document.body, { key: "e" });
    expect(screen.getByRole("region", { name: "Course STAT311" })).toBeTruthy();
    cleanup();
    expect(press(document.body, { key: " " })).toBe(true);
    expect(press(document.body, { key: "2", code: "Digit2", ctrlKey: true })).toBe(true);
  });

  it("holds ␣e pressed before the engine is in, and toggles once it is", async () => {
    installMockCore({ ...defaultFixture });
    render(() => <App />);
    // Before the first paint the engine can't be in yet.
    expect(press(document.body, { key: " " })).toBe(false);
    expect(press(document.body, { key: "e" })).toBe(false);
    await waitFor(() => expect(toggle().getAttribute("aria-expanded")).toBe("false"));
  });
});
