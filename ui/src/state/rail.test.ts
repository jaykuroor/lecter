import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFixture, trustScreen } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { KnownCourse } from "../core/bindings";
import { openCourse } from "../core/course";
import { createRail, type RailState } from "./rail";

const known = (path: string, name: string): KnownCourse => ({
  path,
  name,
  icon: name[0] ?? "C",
  color: "#3584e4",
  missing: false,
});
const stat = known("/c/stat", "Statistics");
const calc = known("/c/calc", "Calculus");
const bio = known("/c/bio", "Biology");

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;
const internals = () => (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } }).__TAURI_INTERNALS__;

let dispose: (() => void) | undefined;
function rail(): RailState {
  return createRoot((d) => {
    dispose = d;
    return createRail();
  });
}

/** Lets the mocked core's queued work (its events, sent from a timeout) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const paths = (r: RailState) => r.courses().map((c) => c.path);

describe("rail state", () => {
  beforeEach(() => installMockCore({ ...defaultFixture, rail: [stat, calc] }));
  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("is empty until it loads, then shows the core's courses in order", async () => {
    const r = rail();
    expect(r.courses()).toEqual([]);
    await r.load();
    expect(r.courses()).toEqual([stat, calc]);
    expect(r.error()).toBeNull();
  });

  it("follows course:changed: a course opened elsewhere joins the rail", async () => {
    installMockCore({
      ...defaultFixture,
      rail: [stat],
      courseOpen: {
        path: "/c/bio",
        name: "Biology",
        lectures: [],
        slides: [],
        sources: [],
        trust: "ask",
        screen: trustScreen,
      },
    });
    const r = rail();
    await r.load();
    await openCourse();
    await settle();
    expect(paths(r)).toEqual(["/c/stat", "/c/bio"]);
    expect(r.courses()[1]).toEqual(bio);
  });

  it("stops following course:changed once its owner goes", async () => {
    installMockCore({
      ...defaultFixture,
      rail: [stat],
      courseOpen: {
        path: "/c/bio",
        name: "Biology",
        lectures: [],
        slides: [],
        sources: [],
        trust: "ask",
        screen: trustScreen,
      },
    });
    const r = rail();
    await r.load();
    dispose?.();
    dispose = undefined;
    await openCourse();
    await settle();
    expect(paths(r)).toEqual(["/c/stat"]);
  });

  it("shows a new order at once and keeps the core's answer", async () => {
    const r = rail();
    await r.load();
    const saving = r.reorder(["/c/calc", "/c/stat"]);
    expect(paths(r)).toEqual(["/c/calc", "/c/stat"]);
    await saving;
    expect(paths(r)).toEqual(["/c/calc", "/c/stat"]);
    // Saved in the core: a fresh read has the same order.
    const again = rail();
    await again.load();
    expect(paths(again)).toEqual(["/c/calc", "/c/stat"]);
  });

  it("puts the old order back with the core's message when it refuses one", async () => {
    const r = rail();
    await r.load();
    await r.reorder(["/c/calc", "/c/elsewhere"]);
    expect(paths(r)).toEqual(["/c/stat", "/c/calc"]);
    expect(r.error()).toBe("The new order must list each course on the rail exactly once.");
    // The next one that works clears it.
    await r.reorder(["/c/calc", "/c/stat"]);
    expect(r.error()).toBeNull();
  });

  it("says so when the core can't be reached, and keeps the order", async () => {
    const r = rail();
    await r.load();
    internals().invoke = () => Promise.reject(new Error("gone"));
    await r.reorder(["/c/calc", "/c/stat"]);
    expect(paths(r)).toEqual(["/c/stat", "/c/calc"]);
    expect(r.error()).toBe("Lecter could not reach the core to save the order.");
    await r.load();
    expect(r.error()).toBe("Lecter could not reach the core to list the courses.");
  });

  it("shows the core's message when the list can't be read", async () => {
    internals().invoke = (cmd) =>
      cmd === "course_list"
        ? Promise.reject({ code: "E_IO", message: "Lecter could not use its list of courses.", retryable: false })
        : Promise.resolve(1);
    const r = rail();
    await r.load();
    expect(r.courses()).toEqual([]);
    expect(r.error()).toBe("Lecter could not use its list of courses.");
  });

  it("doesn't show an order that isn't the rail's own courses while the core judges it", async () => {
    const r = rail();
    await r.load();
    for (const bad of [["/c/calc", "/c/elsewhere"], ["/c/calc"], ["/c/calc", "/c/stat", "/c/bio"]]) {
      const saving = r.reorder(bad);
      expect(paths(r), bad.join()).toEqual(["/c/stat", "/c/calc"]);
      await saving;
      expect(paths(r), bad.join()).toEqual(["/c/stat", "/c/calc"]);
    }
  });

  it("keeps what the core answers, which may differ from what was sent", async () => {
    const r = rail();
    await r.load();
    const renamed = { ...calc, name: "Calculus II" };
    internals().invoke = (cmd) => (cmd === "course_reorder" ? Promise.resolve([renamed, stat]) : Promise.resolve(1));
    await r.reorder(["/c/calc", "/c/stat"]);
    expect(r.courses()).toEqual([renamed, stat]);
  });

  it("puts the old order back when the core refuses a new order of the same courses", async () => {
    const r = rail();
    await r.load();
    internals().invoke = (cmd) =>
      cmd === "course_reorder"
        ? Promise.reject({ code: "E_IO", message: "Lecter could not use its list of courses.", retryable: false })
        : Promise.resolve(1);
    const saving = r.reorder(["/c/calc", "/c/stat"]);
    expect(paths(r)).toEqual(["/c/calc", "/c/stat"]);
    await saving;
    expect(paths(r)).toEqual(["/c/stat", "/c/calc"]);
    expect(r.error()).toBe("Lecter could not use its list of courses.");
  });

  it("clears an earlier error once the list reads", async () => {
    const invoke = internals().invoke;
    internals().invoke = () =>
      Promise.reject({ code: "E_IO", message: "Lecter could not use its list of courses.", retryable: false });
    const r = rail();
    await r.load();
    expect(r.error()).toBe("Lecter could not use its list of courses.");
    internals().invoke = invoke;
    await r.load();
    expect(r.error()).toBeNull();
    expect(paths(r)).toEqual(["/c/stat", "/c/calc"]);
  });

  it("drops the listener that arrives after its owner went", async () => {
    installMockCore({
      ...defaultFixture,
      rail: [stat],
      courseOpen: {
        path: "/c/bio",
        name: "Biology",
        lectures: [],
        slides: [],
        sources: [],
        trust: "ask",
        screen: trustScreen,
      },
    });
    const r = rail();
    const loading = r.load();
    dispose?.();
    dispose = undefined;
    await loading;
    await openCourse();
    await settle();
    expect(paths(r)).toEqual(["/c/stat"]);
  });

  it("listens once however often it loads", async () => {
    let listens = 0;
    const invoke = internals().invoke;
    internals().invoke = (cmd, args) => {
      if (cmd === "plugin:event|listen") listens += 1;
      return invoke(cmd, args);
    };
    const r = rail();
    await r.load();
    await r.load();
    expect(listens).toBe(1);
  });
});
