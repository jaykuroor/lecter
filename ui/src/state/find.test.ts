import { beforeEach, describe, expect, it } from "vitest";
import { defaultFixture } from "../../e2e/mock-core/fixture";
import { installMockCore } from "../../e2e/mock-core/install";
import type { FindHit } from "../core/search";
import { createFind } from "./find";

const hit = (block: string, text: string): FindHit => ({
  lecture: "lectures/l07.md",
  slide: block.slice(0, block.indexOf("b")),
  block,
  text,
  breadcrumb: "Covariance › Definition",
});

const hits = [hit("s1b2", "It is zero for independent variables."), hit("s1b1", "Covariance measures how.")];

type Internals = {
  __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
  __mockFinds?: unknown[];
};
const w = () => window as unknown as Internals;

describe("createFind", () => {
  beforeEach(() => {
    installMockCore({ ...defaultFixture, find: { variables: hits } });
    // The mock records calls on window, which outlives one test.
    delete w().__mockFinds;
  });

  it("asks search_find with the course and the trimmed words, and keeps the hits in order", async () => {
    const find = createFind();
    await find.run("/c/STAT311", "  variables ");
    expect(w().__mockFinds).toEqual([{ course: "/c/STAT311", query: "variables" }]);
    expect(find.query()).toBe("variables");
    expect(find.hits()).toEqual(hits);
    expect(find.error()).toBeNull();
    expect(find.busy()).toBe(false);
  });

  it("a search with no hits empties the list", async () => {
    const find = createFind();
    await find.run("/c/STAT311", "variables");
    await find.run("/c/STAT311", "eigenvalue");
    expect(find.hits()).toEqual([]);
    expect(find.query()).toBe("eigenvalue");
  });

  it("without a course or words it explains instead of calling the core", async () => {
    const find = createFind();
    await find.run(null, "variables");
    expect(find.error()).toBe("Open a course to search its lectures.");
    await find.run("/c/STAT311", "   ");
    expect(find.error()).toBe("Type the words to find, as in :find covariance.");
    expect(w().__mockFinds).toBeUndefined();
  });

  it("shows the core's error message and clears it on the next search", async () => {
    const find = createFind();
    const invoke = w().__TAURI_INTERNALS__.invoke;
    w().__TAURI_INTERNALS__.invoke = () =>
      Promise.reject({
        code: "E_INVALID_ARGUMENT",
        message: "Lecter could not accept that request.",
        retryable: false,
      });
    await find.run("/c/STAT311", "variables");
    expect(find.error()).toBe("Lecter could not accept that request.");
    expect(find.hits()).toEqual([]);
    w().__TAURI_INTERNALS__.invoke = invoke;
    await find.run("/c/STAT311", "variables");
    expect(find.error()).toBeNull();
    expect(find.hits()).toEqual(hits);
  });

  it("only the newest search fills the list", async () => {
    const find = createFind();
    const invoke = w().__TAURI_INTERNALS__.invoke;
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    w().__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      calls += 1;
      if (calls === 1) await firstGate;
      return invoke(cmd, args);
    };
    const first = find.run("/c/STAT311", "variables");
    await find.run("/c/STAT311", "eigenvalue");
    releaseFirst();
    await first;
    expect(find.query()).toBe("eigenvalue");
    expect(find.hits()).toEqual([]);
    expect(find.busy()).toBe(false);
  });

  it("starts empty and idle, and is busy while the core answers", async () => {
    const find = createFind();
    expect([find.query(), find.hits(), find.error(), find.busy()]).toEqual(["", [], null, false]);
    const pending = find.run("/c/STAT311", "variables");
    expect(find.busy()).toBe(true);
    await pending;
    expect(find.busy()).toBe(false);
  });

  it("an older search finishing doesn't end the newer one's wait", async () => {
    const find = createFind();
    const invoke = w().__TAURI_INTERNALS__.invoke;
    const gates: (() => void)[] = [];
    w().__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return invoke(cmd, args);
    };
    const first = find.run("/c/STAT311", "eigenvalue");
    const second = find.run("/c/STAT311", "variables");
    gates[0]?.();
    await first;
    expect(find.busy()).toBe(true);
    gates[1]?.();
    await second;
    expect(find.busy()).toBe(false);
    expect(find.hits()).toEqual(hits);
  });

  it("a core that can't be reached says so, unless a newer search took over", async () => {
    const find = createFind();
    const invoke = w().__TAURI_INTERNALS__.invoke;
    w().__TAURI_INTERNALS__.invoke = () => Promise.reject(new Error("IPC is down"));
    await find.run("/c/STAT311", "variables");
    expect(find.error()).toBe("Lecter could not reach the core to search.");

    let failFirst: () => void = () => undefined;
    let calls = 0;
    w().__TAURI_INTERNALS__.invoke = (cmd, args) => {
      calls += 1;
      if (calls === 1) return new Promise((_, reject) => (failFirst = () => reject(new Error("IPC is down"))));
      return invoke(cmd, args);
    };
    const first = find.run("/c/STAT311", "eigenvalue");
    await find.run("/c/STAT311", "variables");
    failFirst();
    await first;
    expect(find.error()).toBeNull();
    expect(find.hits()).toEqual(hits);
  });
});
