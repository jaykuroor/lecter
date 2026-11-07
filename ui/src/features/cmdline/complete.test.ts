import { describe, expect, it } from "vitest";
import { SCHEMA_TEXT } from "./__tests__/schemaText";
import { COMMANDS, complete, MAX_COMPLETIONS, ownCommand } from "./complete";
import { readSchema } from "./schema";

const specs = readSchema(SCHEMA_TEXT);
const lines = (line: string) => complete(line, specs).map((c) => c.line);

describe("complete", () => {
  it("offers the commands for the first word (10-keymap.md#commands)", () => {
    expect(lines("")).toEqual(["find ", "read", "set "]);
    expect(lines("s")).toEqual(["set "]);
    expect(lines("  re")).toEqual(["read"]);
    expect(lines("x")).toEqual([]);
    expect(complete("f", specs)).toEqual([{ label: "find", detail: "Search sources, cite page", line: "find " }]);
    expect(COMMANDS.map((c) => c.name)).toEqual(["find", "read", "set"]);
  });

  it("offers setting keys after `set `", () => {
    expect(lines("set ui.")).toEqual(["set ui.hintBar", "set ui.keystrokes", "set ui.performance", "set ui.theme"]);
    expect(lines("set ai.budget.")).toEqual([
      "set ai.budget.daily",
      "set ai.budget.monthly",
      "set ai.budget.monthlyTokens",
      "set ai.budget.perLecture",
    ]);
    expect(complete("set ui.p", specs)).toEqual([
      { label: "ui.performance", detail: "The speed-or-looks preset.", line: "set ui.performance" },
    ]);
    expect(lines("set zz")).toEqual([]);
    expect(lines("set ").length).toBe(Math.min(specs.length, MAX_COMPLETIONS));
  });

  it("caps the keys offered at once", () => {
    const many = Array.from({ length: MAX_COMPLETIONS + 5 }, (_, i) => ({
      ...(specs[0] as (typeof specs)[number]),
      key: `k${i}`,
    }));
    expect(complete("set k", many)).toHaveLength(MAX_COMPLETIONS);
  });

  it("offers a choice's values, or true and false, after `set key=`", () => {
    expect(lines("set ui.performance=")).toEqual([
      "set ui.performance=performance",
      "set ui.performance=balanced",
      "set ui.performance=quality",
    ]);
    expect(complete("set ui.performance=q", specs)).toEqual([
      { label: "quality", detail: "ui.performance", line: "set ui.performance=quality" },
    ]);
    expect(lines("set index.contextLines=")).toEqual(["set index.contextLines=true", "set index.contextLines=false"]);
    expect(lines("set index.contextLines=f")).toEqual(["set index.contextLines=false"]);
    expect(lines("set ai.hedgeAfterMs=")).toEqual([]);
    expect(lines("set nothing.here=")).toEqual([]);
  });

  it("leaves out what is typed out already", () => {
    expect(lines("read")).toEqual([]);
    expect(lines("set")).toEqual(["set "]);
    expect(lines("set ui.performance")).toEqual([]);
    expect(lines("set ai.budget.monthly")).toEqual(["set ai.budget.monthlyTokens"]);
    expect(lines("set ui.performance=quality")).toEqual([]);
  });

  it("offers nothing past the arguments it knows", () => {
    expect(lines("set ui.performance=quality now")).toEqual([]);
    expect(lines("find covariance")).toEqual([]);
    expect(lines("find s")).toEqual([]);
    expect(complete("set ", [])).toEqual([]);
  });
});

describe("ownCommand", () => {
  it("takes `set` and its arguments, nothing else", () => {
    expect(ownCommand("set ui.performance?")).toEqual({ name: "set", args: "ui.performance?" });
    expect(ownCommand("  set   a=b")).toEqual({ name: "set", args: "a=b" });
    expect(ownCommand("set")).toEqual({ name: "set", args: "" });
    expect(ownCommand("setlocal x")).toBe(null);
    expect(ownCommand("find set")).toBe(null);
    expect(ownCommand("read")).toBe(null);
  });
});
