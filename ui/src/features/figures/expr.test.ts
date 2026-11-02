import { describe, expect, it } from "vitest";
import { type CompileResult, compile, MAX_DEPTH, MAX_EXPR_LENGTH } from "./expr";

/** `src` compiled for x (and n), evaluated at `x` (and `n`). */
function at(src: string, x: number, n = 0): number {
  const r = compile(src, ["x", "n"]);
  if (!r.ok) throw new Error(`${src}: ${r.error}`);
  return r.fn([x, n]);
}

function error(r: CompileResult): string {
  return r.ok ? "compiled" : r.error;
}

describe("function plot expressions", () => {
  it("evaluate the spec's x^2 and plain arithmetic", () => {
    expect(at("x^2", 3)).toBe(9);
    expect(at("x^2", -0.5)).toBe(0.25);
    expect(at("1 + 2 * 3", 0)).toBe(7);
    expect(at("(1 + 2) * 3", 0)).toBe(9);
    expect(at("10 - 4 - 3", 0)).toBe(3);
    expect(at("24 / 4 / 3", 0)).toBe(2);
    expect(at("2 * x + 1", 4)).toBe(9);
    expect(at("7 / 2", 0)).toBe(3.5);
  });

  it("raise right to left, and a sign applies to the whole power", () => {
    expect(at("2^3^2", 0)).toBe(512);
    expect(at("-x^2", 3)).toBe(-9);
    expect(at("2^-1", 0)).toBe(0.5);
    expect(at("--x", 3)).toBe(3);
    expect(at("+x", 3)).toBe(3);
    expect(at("-(x - 1)", 3)).toBe(-2);
    expect(at("2 * -x", 3)).toBe(-6);
  });

  it("read numbers in every usual form", () => {
    expect(at(".5", 0)).toBe(0.5);
    expect(at("2.", 0)).toBe(2);
    expect(at("1.25e2", 0)).toBe(125);
    expect(at("1E-2", 0)).toBe(0.01);
    expect(at(".5e1", 0)).toBe(5);
    expect(at("  12  ", 0)).toBe(12);
    expect(at("12.5", 0)).toBe(12.5);
    expect(at("2e10", 0)).toBe(2e10);
    expect(at(".25", 0)).toBe(0.25);
    expect(at(".5e+1", 0)).toBe(5);
    expect(at(".5e12", 0)).toBe(5e11);
  });

  it("call functions and know pi and e", () => {
    expect(at("sin(pi / 2)", 0)).toBe(1);
    expect(at("cos(0)", 0)).toBe(1);
    expect(at("exp(1)", 0)).toBe(Math.E);
    expect(at("ln(e)", 0)).toBe(1);
    expect(at("log(e^2)", 0)).toBe(2);
    expect(at("log10(1000)", 0)).toBe(3);
    expect(at("sqrt(x)", 16)).toBe(4);
    expect(at("abs(x)", -2.5)).toBe(2.5);
    expect(at("floor(x) + ceil(x) + round(x)", 1.4)).toBe(1 + 2 + 1);
    expect(at("sign(x)", -3)).toBe(-1);
    expect(at("tan(0) + asin(0) + acos(1) + atan(0)", 0)).toBe(0);
    expect(at("sinh(0) + cosh(0) + tanh(0)", 0)).toBe(1);
  });

  it("take variables in the caller's order", () => {
    expect(at("x * 10 + n", 2, 5)).toBe(25);
    const r = compile("b - a", ["a", "b"]);
    expect(r.ok && r.fn([1, 10])).toBe(9);
    // A variable with no value given is NaN, never a stale number.
    expect(r.ok && r.fn([1])).toBeNaN();
  });

  it("give Infinity and NaN for undefined points instead of throwing", () => {
    expect(at("1 / x", 0)).toBe(Number.POSITIVE_INFINITY);
    expect(at("sqrt(x)", -1)).toBeNaN();
  });

  it("refuse anything outside the grammar, saying why", () => {
    expect(error(compile("", ["x"]))).toBe("empty expression");
    expect(error(compile("   ", ["x"]))).toBe("empty expression");
    expect(error(compile("y + 1", ["x"]))).toBe('unknown name "y"');
    expect(error(compile("x; alert(1)", ["x"]))).toBe("unexpected character at 2");
    expect(error(compile("x  $", ["x"]))).toBe("unexpected character at 4");
    expect(error(compile("x x", ["x"]))).toBe('unexpected "x"');
    expect(error(compile("2 3", ["x"]))).toBe("unexpected number 3");
    expect(error(compile("(x + 1", ["x"]))).toBe('expected ")"');
    expect(error(compile("x + 1)", ["x"]))).toBe('unexpected ")"');
    expect(error(compile("sin x", ["x"]))).toBe('"sin" needs "("');
    expect(error(compile("sin(x", ["x"]))).toBe('expected ")"');
    expect(error(compile("x +", ["x"]))).toBe("unexpected end");
    expect(error(compile("* x", ["x"]))).toBe('unexpected "*"');
    expect(error(compile("max(x, 1)", ["x"]))).toBe('unknown name "max"');
    expect(error(compile("constructor", ["x"]))).toBe('unknown name "constructor"');
    expect(error(compile("toString(x)", ["x"]))).toBe('unknown name "toString"');
  });

  it("count nesting, not how many groups follow each other", () => {
    const groups = Array.from({ length: MAX_DEPTH + 5 }, () => "(x)").join("+");
    expect(at(groups, 1)).toBe(MAX_DEPTH + 5);
  });

  it("cap the length and the nesting", () => {
    const long = `${"1+".repeat(MAX_EXPR_LENGTH / 2 - 1)}10`;
    expect(long.length).toBe(MAX_EXPR_LENGTH);
    expect(at(long, 0)).toBe(MAX_EXPR_LENGTH / 2 - 1 + 10);
    expect(error(compile(`${long} `, ["x"]))).toBe(`longer than ${MAX_EXPR_LENGTH} characters`);
    const deep = (n: number) => `${"(".repeat(n)}x${")".repeat(n)}`;
    expect(at(deep(MAX_DEPTH), 5)).toBe(5);
    expect(error(compile(deep(MAX_DEPTH + 1), ["x"]))).toBe("too deeply nested");
    expect(error(compile(`${"-".repeat(MAX_DEPTH + 1)}x`, ["x"]))).toBe("too deeply nested");
    expect(at(`${"-".repeat(MAX_DEPTH)}x`, 5)).toBe(5);
    expect(error(compile(`${"sin(".repeat(MAX_DEPTH + 1)}x${")".repeat(MAX_DEPTH + 1)}`, ["x"]))).toBe(
      "too deeply nested",
    );
    expect(error(compile(`x${"^x".repeat(MAX_DEPTH + 1)}`, ["x"]))).toBe("too deeply nested");
  });
});
