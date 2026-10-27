import { describe, expect, it } from "vitest";
import {
  MAX_EXPRS,
  MAX_MAGNITUDE,
  MAX_PARAMS,
  MAX_POINTS,
  MAX_SPEC_LENGTH,
  parseFnplot,
  type SpecResult,
} from "./spec";

/** The example of 08-figures.md#tiers, as written there. */
const SPEC_EXAMPLE = `{ "type": "fnplot", "exprs": ["x^2"], "x": [-1, 1], "params": { "n": { "min": 10, "max": 1000, "value": 100 } },
  "scatter": { "sample": "x ~ U(-1,1); y = x^2", "n": "n" } }`;

function error(r: SpecResult): string {
  return r.ok ? "accepted" : r.error;
}

/** A spec with `fields` over a minimal valid one. */
function spec(fields: Record<string, unknown>): string {
  return JSON.stringify({ type: "fnplot", exprs: ["x"], x: [0, 1], ...fields });
}

describe("the function plot spec", () => {
  it("reads the spec's example: y = x^2 on [-1, 1], param n = 100, 100 points from U(-1, 1)", () => {
    const r = parseFnplot(SPEC_EXAMPLE);
    if (!r.ok) throw new Error(r.error);
    const { exprs, x, params, scatter } = r.spec;
    expect(exprs.map((e) => e.text)).toEqual(["x^2"]);
    expect(exprs[0]?.fn([0.5, 100])).toBe(0.25);
    expect(x).toEqual([-1, 1]);
    expect(params).toEqual([{ name: "n", min: 10, max: 1000, value: 100 }]);
    expect(scatter?.lo).toBe(-1);
    expect(scatter?.hi).toBe(1);
    expect(scatter?.n).toBe(100);
    expect(scatter?.y([-0.5, 100])).toBe(0.25);
  });

  it("needs no params or scatter, and lets expressions and bounds use params", () => {
    const plain = parseFnplot(spec({ exprs: ["sin(x)", "cos(x)"], x: [-3, 3] }));
    expect(plain.ok && plain.spec.params).toEqual([]);
    expect(plain.ok && plain.spec.scatter).toBe(null);
    expect(plain.ok && plain.spec.exprs.length).toBe(2);
    const withK = parseFnplot(
      spec({
        exprs: ["k * x"],
        params: { k: { min: 0, max: 5, value: 2 }, m: { min: 1, max: 9, value: 3 } },
        scatter: { sample: " x ~ U( -k , m ) ; y = k*x + m ", n: 7.4 },
      }),
    );
    if (!withK.ok) throw new Error(withK.error);
    expect(withK.spec.exprs[0]?.fn([1.5, 2, 3])).toBe(3);
    expect(withK.spec.scatter).toMatchObject({ lo: -2, hi: 3, n: 7 });
    expect(withK.spec.scatter?.y([1, 2, 3])).toBe(5);
    // A point-like U(a, a) is allowed.
    expect(parseFnplot(spec({ scatter: { sample: "x~U(1,1);y=x", n: 1 } })).ok).toBe(true);
  });

  it("refuses what isn't a function plot spec", () => {
    expect(error(parseFnplot("not json"))).toBe("not JSON");
    expect(error(parseFnplot("[1]"))).toBe('type must be "fnplot"');
    expect(error(parseFnplot("null"))).toBe('type must be "fnplot"');
    expect(error(parseFnplot(spec({ type: "vega-lite" })))).toBe('type must be "fnplot"');
    expect(error(parseFnplot(" ".repeat(MAX_SPEC_LENGTH + 1)))).toBe(`longer than ${MAX_SPEC_LENGTH} characters`);
    expect(parseFnplot(`${spec({})}${" ".repeat(MAX_SPEC_LENGTH - spec({}).length)}`).ok).toBe(true);
  });

  it("checks the expressions", () => {
    const many = `exprs must list 1 to ${MAX_EXPRS} expressions`;
    expect(error(parseFnplot(spec({ exprs: [] })))).toBe(many);
    expect(error(parseFnplot(spec({ exprs: "x" })))).toBe(many);
    expect(error(parseFnplot(spec({ exprs: Array(MAX_EXPRS + 1).fill("x") })))).toBe(many);
    expect(parseFnplot(spec({ exprs: Array(MAX_EXPRS).fill("x") })).ok).toBe(true);
    expect(error(parseFnplot(spec({ exprs: ["x", 2] })))).toBe("exprs[1] must be text");
    expect(error(parseFnplot(spec({ exprs: ["x", "fetch(x)"] })))).toBe('exprs[1]: unknown name "fetch"');
    expect(error(parseFnplot(spec({ exprs: ["n"] })))).toBe('exprs[0]: unknown name "n"');
  });

  it("checks the domain", () => {
    expect(error(parseFnplot(spec({ x: [1] })))).toBe("x must be [from, to]");
    expect(error(parseFnplot(spec({ x: { from: 0 } })))).toBe("x must be [from, to]");
    expect(error(parseFnplot(spec({ x: [1, 1] })))).toBe("x must go from a smaller to a larger number");
    expect(error(parseFnplot(spec({ x: [2, 1] })))).toBe("x must go from a smaller to a larger number");
    expect(error(parseFnplot(spec({ x: ["0", 1] })))).toBe(`x[0] must be a number within ±${MAX_MAGNITUDE}`);
    expect(error(parseFnplot(spec({ x: [0, MAX_MAGNITUDE * 10] })))).toBe(
      `x[1] must be a number within ±${MAX_MAGNITUDE}`,
    );
    expect(parseFnplot(spec({ x: [-MAX_MAGNITUDE, MAX_MAGNITUDE] })).ok).toBe(true);
    // JSON can't say NaN or Infinity, but 1e999 parses as Infinity.
    expect(error(parseFnplot('{"type":"fnplot","exprs":["x"],"x":[0,1e999]}'))).toBe(
      `x[1] must be a number within ±${MAX_MAGNITUDE}`,
    );
  });

  it("checks the params", () => {
    const p = (params: unknown) => error(parseFnplot(spec({ params })));
    expect(p([1])).toBe("params must be an object");
    expect(p("n")).toBe("params must be an object");
    expect(p({ n: 5 })).toBe("params.n must be an object");
    expect(p({ x: { min: 0, max: 1, value: 0 } })).toBe('"x" can\'t be a param name');
    expect(p({ pi: { min: 0, max: 1, value: 0 } })).toBe('"pi" can\'t be a param name');
    expect(p({ "a b": { min: 0, max: 1, value: 0 } })).toBe('"a b" can\'t be a param name');
    expect(p({ a: { min: 0, max: 1 } })).toBe(`params.a.value must be a number within ±${MAX_MAGNITUDE}`);
    expect(p({ a: { min: 0, max: 1, value: 2 } })).toBe("params.a needs min ≤ value ≤ max");
    expect(p({ a: { min: 0, max: 1, value: -1 } })).toBe("params.a needs min ≤ value ≤ max");
    expect(parseFnplot(spec({ params: { a: { min: 0, max: 1, value: 1 } } })).ok).toBe(true);
    expect(parseFnplot(spec({ params: { a: { min: 0, max: 1, value: 0 } } })).ok).toBe(true);
    const params = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { min: 0, max: 1, value: 0 }]));
    expect(p(params(MAX_PARAMS + 1))).toBe(`at most ${MAX_PARAMS} params`);
    expect(parseFnplot(spec({ params: params(MAX_PARAMS) })).ok).toBe(true);
  });

  it("checks the scatter", () => {
    const s = (scatter: unknown) => error(parseFnplot(spec({ scatter, params: { n: { min: 1, max: 9, value: 4 } } })));
    const form = 'scatter.sample must read "x ~ U(a, b); y = …"';
    expect(s("x ~ U(0,1)")).toBe("scatter needs a sample");
    expect(s({ n: 3 })).toBe("scatter needs a sample");
    expect(s({ sample: "x ~ U(0,1)", n: 3 })).toBe(form);
    expect(s({ sample: "x ~ N(0,1); y = x", n: 3 })).toBe(form);
    expect(s({ sample: "x ~ U(0,1); z = x", n: 3 })).toBe(form);
    expect(s({ sample: "x ~ U(0,1); y = x; y = 2", n: 3 })).toBe(form);
    expect(s({ sample: "x ~ U(1,0); y = x", n: 3 })).toBe("U(a, b) needs a ≤ b");
    expect(s({ sample: "x ~ U(x,1); y = x", n: 3 })).toBe('U(a, b): a: unknown name "x"');
    expect(s({ sample: "x ~ U(0,1/0); y = x", n: 3 })).toBe(`U(a, b): b must be a number within ±${MAX_MAGNITUDE}`);
    expect(s({ sample: "x ~ U(0,1); y = q", n: 3 })).toBe('scatter y: unknown name "q"');
    expect(s({ sample: "x ~ U(0,1); y = x", n: "m" })).toBe("scatter.n names no param");
    expect(s({ sample: "x ~ U(0,1); y = x", n: 0 })).toBe(`scatter.n must be 1 to ${MAX_POINTS}`);
    expect(s({ sample: "x ~ U(0,1); y = x", n: MAX_POINTS + 1 })).toBe(`scatter.n must be 1 to ${MAX_POINTS}`);
    expect(s({ sample: "x ~ U(0,1); y = x", n: MAX_POINTS })).toBe("accepted");
    expect(s({ sample: "x ~ U(0,1); y = x", n: 1 })).toBe("accepted");
    expect(s({ sample: "x ~ U(0,1); y = x", n: "n" })).toBe("accepted");
    expect(s({ sample: "x ~ U(0,1); y = x" })).toBe(`scatter.n must be a number within ±${MAX_MAGNITUDE}`);
  });
});
