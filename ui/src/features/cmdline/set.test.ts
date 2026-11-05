import { describe, expect, it } from "vitest";
import { SCHEMA_TEXT } from "./__tests__/schemaText";
import { readSchema } from "./schema";
import { describeSetting, noteFor, planSet, SET_USAGE } from "./set";

const specs = readSchema(SCHEMA_TEXT);

describe("planSet", () => {
  it("reads `key?` as a question", () => {
    expect(planSet("ui.performance?", specs)).toEqual({ op: "show", key: "ui.performance" });
    expect(planSet("  ui.performance?  ", specs)).toEqual({ op: "show", key: "ui.performance" });
  });

  it("reads `key=value` as a write of the checked value", () => {
    expect(planSet("ui.performance=quality", specs)).toEqual({
      op: "write",
      key: "ui.performance",
      json: '"quality"',
    });
    expect(planSet("index.contextLines=true", specs)).toEqual({
      op: "write",
      key: "index.contextLines",
      json: "true",
    });
    // Only the first `=` splits: the rest is the value.
    expect(planSet("ai.defaultFast=a=b", specs)).toEqual({ op: "write", key: "ai.defaultFast", json: '"a=b"' });
  });

  it("refuses a value the schema refuses, with the reason (F-040 criteria 2 and 4)", () => {
    expect(planSet("ui.performance=fast", specs)).toEqual({
      op: "refuse",
      reason: "ui.performance must be one of performance, balanced, quality",
    });
  });

  it("refuses a key no setting has", () => {
    expect(planSet("ui.speed=1", specs)).toEqual({ op: "refuse", reason: "ui.speed is not a setting" });
    expect(planSet("ui?", specs)).toEqual({ op: "refuse", reason: "ui is not a setting" });
    expect(planSet("ui.performance", [])).toEqual({ op: "refuse", reason: SET_USAGE });
  });

  it("refuses anything that is neither form", () => {
    for (const args of ["", "  ", "ui.performance", "?", "=quality", "ui performance?", "ui. performance=x"]) {
      expect(planSet(args, specs), args).toEqual({ op: "refuse", reason: SET_USAGE });
    }
  });
});

describe("describeSetting", () => {
  it("shows the value and its level", () => {
    expect(describeSetting({ key: "ui.performance", value: '"balanced"', source: "default" })).toEqual({
      line: "ui.performance=balanced (default)",
      note: null,
    });
    expect(describeSetting({ key: "index.contextLines", value: "true", source: "course" })).toEqual({
      line: "index.contextLines=true (course)",
      note: null,
    });
  });

  it("adds the Quality preset's note (12-settings-theme-onboarding.md#performance-preset)", () => {
    expect(describeSetting({ key: "ui.performance", value: '"quality"', source: "global" })).toEqual({
      line: "ui.performance=quality (global)",
      note: "Can add input lag on slower machines.",
    });
    expect(noteFor("ui.performance", '"performance"')).toBe(null);
    expect(noteFor("parsing.vision", '"quality"')).toBe(null);
  });
});
