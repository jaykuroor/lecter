import { describe, expect, it } from "vitest";
import { SCHEMA_TEXT } from "../cmdline/__tests__/schemaText";
import { readSchema, type SettingSpec } from "../cmdline/schema";
import { createFilter, type Entry, entriesOf } from "./filter";

const entries = entriesOf(readSchema(SCHEMA_TEXT));
const keys = (found: readonly Entry[]) => found.map((e) => e.spec.key);

/** A made-up setting, for searches at sizes the schema doesn't have yet. */
const spec = (key: string, description: string): SettingSpec => ({
  key,
  kind: "text",
  nullable: false,
  choices: [],
  min: 0,
  max: 0,
  description,
});

describe("the settings search (F-045 criterion 1)", () => {
  it("finds a setting by its key, label, description, page or values", () => {
    const find = createFilter(entries);
    expect(keys(find("hintbar"))).toEqual(["ui.hintBar"]);
    expect(keys(find("hint bar"))).toEqual(["ui.hintBar"]);
    expect(keys(find("speed-or-looks"))).toEqual(["ui.performance"]);
    expect(keys(find("KEYSTROKES"))).toEqual(["ui.keystrokes"]);
    expect(keys(find("searxng"))).toEqual(["ai.search.service"]);
    // Values are words of their own, never run together.
    expect(keys(find("bravetavily"))).toEqual([]);
    // The page's title: Privacy holds privacy.*, feedback.* and log.*.
    expect(keys(find("privacy")).sort()).toEqual(
      ["feedback.endpoint", "log.content", "privacy.shareFeedback", "privacy.shareFeedbackText"].sort(),
    );
  });

  it("needs every word, and gives everything back for a blank query", () => {
    const find = createFilter(entries);
    expect(keys(find("budget daily"))).toEqual(["ai.budget.daily"]);
    expect(keys(find("budget nothing-like-this"))).toEqual([]);
    expect(find("   ")).toBe(entries);
    expect(find("")).toBe(entries);
  });

  it("narrows as the query grows, and widens again when it shrinks", () => {
    const find = createFilter(entries);
    const wide = keys(find("b"));
    expect(wide.length).toBeGreaterThan(5);
    expect(keys(find("bu"))).toEqual(keys(createFilter(entries)("bu")));
    expect(keys(find("budget mont"))).toEqual(["ai.budget.monthly", "ai.budget.monthlyTokens"]);
    expect(keys(find("budget month"))).toEqual(["ai.budget.monthly", "ai.budget.monthlyTokens"]);
    // Shrinking (a backspace) and a different query look at every setting again.
    expect(keys(find("b"))).toEqual(wide);
    expect(keys(find("hint"))).toEqual(["ui.hintBar"]);
    expect(keys(find("theme"))).toEqual(["ui.theme"]);
  });

  it("looks only at the last matches when the query grew (D-237)", () => {
    let reads = 0;
    const counted = entries.map((e) => ({
      ...e,
      get text() {
        reads += 1;
        return e.text;
      },
    }));
    const find = createFilter(counted);
    find("budget");
    const matches = find("budget").length;
    reads = 0;
    find("budget mon");
    // Each of the last matches is read once per word, and no other.
    expect(reads).toBe(matches * 2);
    reads = 0;
    find("hint");
    expect(reads).toBe(counted.length);
  });

  it("narrows only from a query it grew from, not from one that merely starts the same", () => {
    const find = createFilter(entries);
    expect(keys(find("theme"))).toEqual(["ui.theme"]);
    // "the" isn't "theme" grown: every setting is looked at again.
    expect(keys(find("the")).length).toBeGreaterThan(1);
  });

  it("stays well inside a keystroke at 10 000 settings (D-237)", () => {
    const many = entriesOf(
      Array.from({ length: 10_000 }, (_, i) =>
        spec(`group${i % 40}.setting${i}Name`, `What setting number ${i} changes, in a sentence or so.`),
      ),
    );
    const typed = "setting 12 name changes";
    const times: number[] = [];
    for (let round = 0; round < 20; round += 1) {
      const find = createFilter(many);
      for (let n = 1; n <= typed.length; n += 1) {
        const t0 = performance.now();
        find(typed.slice(0, n));
        times.push(performance.now() - t0);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] as number;
    expect(keys(createFilter(many)(typed))).toContain("group12.setting12Name");
    expect(p95).toBeLessThan(4);
  });
});
