import { describe, expect, it } from "vitest";
import { SCHEMA_TEXT } from "./__tests__/schemaText";
import { checkValue, readSchema, type SettingSpec, showValue } from "./schema";

const specs = readSchema(SCHEMA_TEXT);
const spec = (key: string): SettingSpec => {
  const found = specs.find((s) => s.key === key);
  if (!found) throw new Error(`no ${key}`);
  return found;
};

describe("readSchema", () => {
  it("lists every leaf setting of the core's schema by dotted key, sorted", () => {
    const keys = specs.map((s) => s.key);
    // 12-settings-theme-onboarding.md#settings names these keys.
    for (const key of [
      "ui.performance",
      "ai.defaultFast",
      "ai.budget.daily",
      "ai.budget.monthlyTokens",
      "ai.search.allowDomains",
      "ai.search.service",
      "figures.mode.described",
      "parsing.vision",
      "index.embeddings",
      "index.contextLines",
      "privacy.shareFeedback",
      "feedback.endpoint",
    ]) {
      expect(keys).toContain(key);
    }
    // Groups are not settings.
    expect(keys).not.toContain("ai");
    expect(keys).not.toContain("ai.budget");
    expect(keys).not.toContain("figures.mode");
    expect(keys).toEqual([...keys].sort());
  });

  it("reads the kind and values of each setting", () => {
    // 12-settings-theme-onboarding.md#performance-preset: three presets.
    expect(spec("ui.performance")).toMatchObject({
      kind: "choice",
      choices: ["performance", "balanced", "quality"],
      nullable: false,
    });
    expect(spec("parsing.vision").choices).toEqual(["provider", "local", "auto", "off"]);
    expect(spec("ai.search.service")).toMatchObject({
      kind: "choice",
      choices: ["brave", "tavily", "exa", "searxng"],
      nullable: true,
    });
    expect(spec("index.contextLines")).toMatchObject({ kind: "boolean", nullable: false });
    expect(spec("ai.hedgeAfterMs")).toMatchObject({ kind: "integer", min: 0, max: 4294967295 });
    expect(spec("ai.budget.monthlyTokens")).toMatchObject({ kind: "integer", min: 0, max: Number.MAX_SAFE_INTEGER });
    expect(spec("ai.budget.daily")).toMatchObject({ kind: "number", nullable: false });
    expect(spec("ai.budget.perLecture")).toMatchObject({ kind: "number", nullable: true });
    expect(spec("ai.defaultFast")).toMatchObject({ kind: "text", nullable: true });
    expect(spec("ai.search.allowDomains")).toMatchObject({ kind: "list", nullable: false });
    expect(spec("ui.performance").description).toBe("The speed-or-looks preset.");
  });

  it("reads nothing from text that isn't a schema", () => {
    expect(readSchema("not json")).toEqual([]);
    expect(readSchema("[1,2]")).toEqual([]);
    expect(readSchema("null")).toEqual([]);
    expect(readSchema('{"properties": 3}')).toEqual([]);
    expect(readSchema("{}")).toEqual([]);
  });

  it("follows a $ref into $defs and keeps enum lists", () => {
    const text = JSON.stringify({
      properties: {
        a: { $ref: "#/$defs/A" },
        b: { $ref: "#/$defs/Missing", type: "boolean" },
        c: { $ref: "elsewhere", type: "string" },
      },
      $defs: { A: { type: "object", properties: { mode: { enum: ["x", "y", 3] } } } },
    });
    const read = readSchema(text);
    expect(read.map((s) => [s.key, s.kind, s.choices])).toEqual([
      ["a.mode", "choice", ["x", "y"]],
      ["b", "boolean", []],
      ["c", "text", []],
    ]);
    // A node without a description has none.
    expect(read.map((s) => s.description)).toEqual(["", "", ""]);
  });

  it("skips properties that aren't schema nodes, and keeps an object without properties as one setting", () => {
    const text = JSON.stringify({
      properties: {
        bad: 3,
        flag: { type: "boolean" },
        map: { type: "object" },
        group: { properties: { inner: { type: "boolean" } } },
      },
    });
    expect(readSchema(text).map((s) => [s.key, s.kind])).toEqual([
      ["flag", "boolean"],
      ["group", "text"],
      ["map", "text"],
    ]);
  });

  it("sorts keys whatever order the schema lists them in", () => {
    const text = JSON.stringify({
      properties: { zeta: { type: "boolean" }, alpha: { type: "boolean" }, mid: { type: "boolean" } },
    });
    expect(readSchema(text).map((s) => s.key)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("takes an integer's range from its minimum and format", () => {
    const text = JSON.stringify({
      properties: {
        small: { type: "integer", format: "uint8", minimum: 1 },
        wide: { type: "integer", format: "uint16" },
        xodd: { type: "integer", format: 32 },
      },
    });
    const [small, wide, odd] = readSchema(text);
    expect([small?.min, small?.max]).toEqual([1, 255]);
    expect([wide?.min, wide?.max]).toEqual([Number.MIN_SAFE_INTEGER, 65535]);
    expect(odd?.max).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("checkValue", () => {
  it("takes one of a choice's values, as a JSON string", () => {
    expect(checkValue(spec("ui.performance"), "quality")).toEqual({ ok: true, json: '"quality"' });
    expect(checkValue(spec("ui.performance"), " balanced ")).toEqual({ ok: true, json: '"balanced"' });
  });

  it("refuses any other value with the allowed ones (12-settings-theme-onboarding.md#performance-preset)", () => {
    expect(checkValue(spec("ui.performance"), "fast")).toEqual({
      ok: false,
      reason: "ui.performance must be one of performance, balanced, quality",
    });
    expect(checkValue(spec("ui.performance"), "Quality").ok).toBe(false);
    expect(checkValue(spec("ui.performance"), "").ok).toBe(false);
    expect(checkValue(spec("ui.performance"), "null").ok).toBe(false);
  });

  it("unsets a nullable choice with null and says so when refusing", () => {
    expect(checkValue(spec("ai.search.service"), "null")).toEqual({ ok: true, json: "null" });
    expect(checkValue(spec("ai.search.service"), "google")).toEqual({
      ok: false,
      reason: "ai.search.service must be one of brave, tavily, exa, searxng, or null",
    });
  });

  it("takes true or false for a flag", () => {
    expect(checkValue(spec("index.contextLines"), "true")).toEqual({ ok: true, json: "true" });
    expect(checkValue(spec("index.contextLines"), "false")).toEqual({ ok: true, json: "false" });
    expect(checkValue(spec("index.contextLines"), "yes")).toEqual({
      ok: false,
      reason: "index.contextLines must be true or false",
    });
  });

  it("takes a whole number in range", () => {
    const hedge = spec("ai.hedgeAfterMs");
    expect(checkValue(hedge, "2500")).toEqual({ ok: true, json: "2500" });
    expect(checkValue(hedge, "0")).toEqual({ ok: true, json: "0" });
    expect(checkValue(hedge, "4294967295")).toEqual({ ok: true, json: "4294967295" });
    const reason = "ai.hedgeAfterMs must be a whole number from 0 to 4294967295";
    expect(checkValue(hedge, "4294967296")).toEqual({ ok: false, reason });
    expect(checkValue(hedge, "-1")).toEqual({ ok: false, reason });
    expect(checkValue(hedge, "2.5")).toEqual({ ok: false, reason });
    expect(checkValue(hedge, "")).toEqual({ ok: false, reason });
    expect(checkValue(hedge, "1e3")).toEqual({ ok: false, reason });
  });

  it("takes a decimal number, or null where unset is allowed", () => {
    expect(checkValue(spec("ai.budget.daily"), "2.5")).toEqual({ ok: true, json: "2.5" });
    expect(checkValue(spec("ai.budget.daily"), "-3")).toEqual({ ok: true, json: "-3" });
    expect(checkValue(spec("ai.budget.daily"), ".5")).toEqual({ ok: true, json: "0.5" });
    expect(checkValue(spec("ai.budget.daily"), "5.")).toEqual({ ok: true, json: "5" });
    expect(checkValue(spec("ai.budget.daily"), "12.5")).toEqual({ ok: true, json: "12.5" });
    expect(checkValue(spec("ai.budget.daily"), ".25")).toEqual({ ok: true, json: "0.25" });
    expect(checkValue(spec("ai.budget.daily"), "a5").ok).toBe(false);
    expect(checkValue(spec("ai.budget.daily"), "5a").ok).toBe(false);
    // Nothing is not a number, even where null is allowed (only text takes nothing as null).
    expect(checkValue(spec("ai.budget.perLecture"), "").ok).toBe(false);
    expect(checkValue(spec("ai.budget.daily"), "five")).toEqual({
      ok: false,
      reason: "ai.budget.daily must be a number",
    });
    expect(checkValue(spec("ai.budget.daily"), "null").ok).toBe(false);
    expect(checkValue(spec("ai.budget.perLecture"), "null")).toEqual({ ok: true, json: "null" });
    expect(checkValue(spec("ai.budget.perLecture"), "x")).toEqual({
      ok: false,
      reason: "ai.budget.perLecture must be a number, or null",
    });
  });

  it("takes any text, and null or nothing to unset a nullable one", () => {
    expect(checkValue(spec("ai.defaultFast"), " gpt-small ")).toEqual({ ok: true, json: '"gpt-small"' });
    expect(checkValue(spec("ai.defaultFast"), 'say "hi"')).toEqual({ ok: true, json: '"say \\"hi\\""' });
    expect(checkValue(spec("ai.defaultFast"), "null")).toEqual({ ok: true, json: "null" });
    expect(checkValue(spec("ai.defaultFast"), "")).toEqual({ ok: true, json: "null" });
    const plain: SettingSpec = { ...spec("ai.defaultFast"), nullable: false };
    expect(checkValue(plain, "")).toEqual({ ok: true, json: '""' });
    expect(checkValue(plain, "null")).toEqual({ ok: true, json: '"null"' });
  });

  it("splits a list at commas", () => {
    const list = spec("ai.search.allowDomains");
    expect(checkValue(list, "a.org, b.com,,")).toEqual({ ok: true, json: '["a.org","b.com"]' });
    expect(checkValue(list, "")).toEqual({ ok: true, json: "[]" });
  });
});

describe("showValue", () => {
  it("shows text bare, lists comma-separated and the rest as JSON", () => {
    expect(showValue('"balanced"')).toBe("balanced");
    expect(showValue("false")).toBe("false");
    expect(showValue("2.5")).toBe("2.5");
    expect(showValue("null")).toBe("null");
    expect(showValue('["a.org","b.com"]')).toBe("a.org,b.com");
    expect(showValue("[1,true]")).toBe("1,true");
    expect(showValue('[{"a":1},"b"]')).toBe('{"a":1},b');
    expect(showValue('{"a":1}')).toBe('{"a":1}');
    expect(showValue("not json")).toBe("not json");
  });
});
