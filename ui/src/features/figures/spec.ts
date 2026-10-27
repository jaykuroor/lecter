// The function plot spec (08-figures.md#tiers), read from model output and so checked field by
// field (13-security.md): JSON only, with caps on its size, its expressions, its parameters and
// its number of points. Unknown fields are ignored. Expressions compile through ./expr.
//
//   { "type": "fnplot", "exprs": ["x^2"], "x": [-1, 1], "params": { "n": { "min": 10, "max": 1000, "value": 100 } },
//     "scatter": { "sample": "x ~ U(-1,1); y = x^2", "n": "n" } }
//
// Params take their `value` (sliders come with F-140). The scatter draws `n` points with x drawn
// uniformly from U(a, b) and y from its formula.
import { type Compiled, compile } from "./expr";

/** One curve: its text as written and its compiled form over [x, ...param values]. */
export interface Curve {
  text: string;
  fn: Compiled;
}

/** A parameter with its range and current value. */
export interface Param {
  name: string;
  min: number;
  max: number;
  value: number;
}

/** Random points: x ~ U(lo, hi), y = `y` over [x, ...param values]. */
export interface Scatter {
  lo: number;
  hi: number;
  y: Compiled;
  n: number;
}

/** A checked function plot spec. */
export interface FnplotSpec {
  exprs: Curve[];
  /** The x domain, lo < hi. */
  x: [number, number];
  params: Param[];
  scatter: Scatter | null;
}

/** A spec, or why the text isn't one. */
export type SpecResult = { ok: true; spec: FnplotSpec } | { ok: false; error: string };

/** The longest spec accepted, in characters. */
export const MAX_SPEC_LENGTH = 4096;
/** The most curves in one plot. */
export const MAX_EXPRS = 4;
/** The most parameters. */
export const MAX_PARAMS = 8;
/** The most scatter points. */
export const MAX_POINTS = 5000;
/** The largest magnitude of a domain end or a parameter number. */
export const MAX_MAGNITUDE = 1e9;

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;
const RESERVED = new Set(["x", "y", "pi", "e"]);
const UNIFORM = /^\s*x\s*~\s*U\s*\(([^,]*),([^)]*)\)\s*$/;
const Y_FORMULA = /^\s*y\s*=(.*)$/;

class Bad extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** `v` as a number within ±MAX_MAGNITUDE (so not NaN or infinite), or a failure naming `what`. */
function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !(Math.abs(v) <= MAX_MAGNITUDE)) {
    throw new Bad(`${what} must be a number within ±${MAX_MAGNITUDE}`);
  }
  return v;
}

function exprs(v: unknown, names: readonly string[]): Curve[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_EXPRS) {
    throw new Bad(`exprs must list 1 to ${MAX_EXPRS} expressions`);
  }
  return v.map((text, i) => {
    if (typeof text !== "string") throw new Bad(`exprs[${i}] must be text`);
    const c = compile(text, names);
    if (!c.ok) throw new Bad(`exprs[${i}]: ${c.error}`);
    return { text, fn: c.fn };
  });
}

function domain(v: unknown): [number, number] {
  if (!Array.isArray(v) || v.length !== 2) throw new Bad("x must be [from, to]");
  const lo = num(v[0], "x[0]");
  const hi = num(v[1], "x[1]");
  if (!(lo < hi)) throw new Bad("x must go from a smaller to a larger number");
  return [lo, hi];
}

function params(v: unknown): Param[] {
  if (v === undefined) return [];
  if (!isObject(v)) throw new Bad("params must be an object");
  const entries = Object.entries(v);
  if (entries.length > MAX_PARAMS) throw new Bad(`at most ${MAX_PARAMS} params`);
  return entries.map(([name, p]) => {
    if (!PARAM_NAME.test(name) || RESERVED.has(name)) throw new Bad(`"${name}" can't be a param name`);
    if (!isObject(p)) throw new Bad(`params.${name} must be an object`);
    const min = num(p.min, `params.${name}.min`);
    const max = num(p.max, `params.${name}.max`);
    const value = num(p.value, `params.${name}.value`);
    if (!(min <= value && value <= max)) throw new Bad(`params.${name} needs min ≤ value ≤ max`);
    return { name, min, max, value };
  });
}

/** `src` evaluated once with the params' values (a U(a, b) bound). */
function constant(src: string, ps: Param[], what: string): number {
  const c = compile(
    src,
    ps.map((p) => p.name),
  );
  if (!c.ok) throw new Bad(`${what}: ${c.error}`);
  return num(c.fn(ps.map((p) => p.value)), what);
}

function scatter(v: unknown, ps: Param[], names: readonly string[]): Scatter | null {
  if (v === undefined) return null;
  if (!isObject(v) || typeof v.sample !== "string") throw new Bad("scatter needs a sample");
  const parts = v.sample.split(";");
  const two = parts.length === 2;
  const u = two ? UNIFORM.exec(`${parts[0]}`) : null;
  const y = two ? Y_FORMULA.exec(`${parts[1]}`) : null;
  if (!u || !y) throw new Bad('scatter.sample must read "x ~ U(a, b); y = …"');
  const lo = constant(`${u[1]}`, ps, "U(a, b): a");
  const hi = constant(`${u[2]}`, ps, "U(a, b): b");
  if (!(lo <= hi)) throw new Bad("U(a, b) needs a ≤ b");
  const fn = compile(`${y[1]}`, names);
  if (!fn.ok) throw new Bad(`scatter y: ${fn.error}`);
  let n: unknown = v.n;
  if (typeof n === "string") {
    const name = n;
    n = ps.find((p) => p.name === name)?.value;
    if (n === undefined) throw new Bad("scatter.n names no param");
  }
  const count = Math.round(num(n, "scatter.n"));
  if (count < 1 || count > MAX_POINTS) throw new Bad(`scatter.n must be 1 to ${MAX_POINTS}`);
  return { lo, hi, y: fn.fn, n: count };
}

/** Reads the function plot spec in `source` (JSON). */
export function parseFnplot(source: string): SpecResult {
  if (source.length > MAX_SPEC_LENGTH) return { ok: false, error: `longer than ${MAX_SPEC_LENGTH} characters` };
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return { ok: false, error: "not JSON" };
  }
  try {
    if (!isObject(json) || json.type !== "fnplot") throw new Bad('type must be "fnplot"');
    const ps = params(json.params);
    const names = ["x", ...ps.map((p) => p.name)];
    return {
      ok: true,
      spec: {
        exprs: exprs(json.exprs, names),
        x: domain(json.x),
        params: ps,
        scatter: scatter(json.scatter, ps, names),
      },
    };
  } catch (e) {
    // Only Bad is thrown here: JSON.parse is caught above and compile() returns its errors.
    return { ok: false, error: (e as Bad).message };
  }
}
