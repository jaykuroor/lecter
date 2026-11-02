// Expressions of a function plot spec (08-figures.md#tiers: "exprs": ["x^2"]). Model output is
// untrusted (13-security.md), so an expression is parsed by this small grammar into a tree of
// arithmetic closures, never evaluated as code:
//
//   sum     = product (("+" | "-") product)*
//   product = unary (("*" | "/") unary)*
//   unary   = ("-" | "+") unary | power
//   power   = atom ("^" unary)?            (right-associative: 2^3^2 = 2^9, -x^2 = -(x^2))
//   atom    = number | name | name "(" sum ")" | "(" sum ")"
//
// Names are the caller's variables (x, the spec's params), the constants pi and e, and the
// one-argument functions below. Length and nesting are capped.

/** An expression compiled for variables `names`: call it with their values, in the same order. */
export type Compiled = (values: readonly number[]) => number;

/** A compiled expression, or why the text isn't one. */
export type CompileResult = { ok: true; fn: Compiled } | { ok: false; error: string };

/** The longest expression accepted, in characters. */
export const MAX_EXPR_LENGTH = 200;

/** The deepest nesting accepted (parentheses, signs, powers and calls). */
export const MAX_DEPTH = 32;

// Maps, not object literals: a name like "constructor" must not find Object.prototype members.
const FUNCTIONS: ReadonlyMap<string, (v: number) => number> = new Map(
  Object.entries({
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    exp: Math.exp,
    ln: Math.log,
    log: Math.log,
    log10: Math.log10,
    sqrt: Math.sqrt,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sign: Math.sign,
  }),
);

const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ["pi", Math.PI],
  ["e", Math.E],
]);

type Token = { kind: "num"; value: number } | { kind: "name"; name: string } | { kind: "op"; op: string };

// A number, a name or an operator, after optional white space.
const TOKEN = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;

/** The tokens of `src`, or the offset of the first character that starts none. */
function tokenize(src: string): Token[] | number {
  const out: Token[] = [];
  const re = new RegExp(TOKEN);
  let at = 0;
  while (src.slice(at).trim() !== "") {
    re.lastIndex = at;
    const m = re.exec(src);
    if (!m) return src.length - src.slice(at).trimStart().length;
    at = re.lastIndex;
    if (m[1] !== undefined) out.push({ kind: "num", value: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ kind: "name", name: m[2] });
    else out.push({ kind: "op", op: `${m[3]}` });
  }
  return out;
}

class Fail extends Error {}

/** A recursive-descent parser over `tokens` that builds closures. */
class Parser {
  private at = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly names: readonly string[],
  ) {}

  parse(): Compiled {
    const fn = this.sum();
    const extra = this.tokens[this.at];
    if (extra) throw new Fail(`unexpected ${tokenText(extra)}`);
    return fn;
  }

  private isOp(op: string): boolean {
    const t = this.tokens[this.at];
    return t?.kind === "op" && t.op === op;
  }

  private expect(op: string): void {
    if (!this.isOp(op)) throw new Fail(`expected "${op}"`);
    this.at++;
  }

  /** Runs `f` one level deeper, failing past MAX_DEPTH. */
  private nested(f: () => Compiled): Compiled {
    if (++this.depth > MAX_DEPTH) throw new Fail("too deeply nested");
    const fn = f();
    this.depth--;
    return fn;
  }

  private sum(): Compiled {
    let left = this.product();
    while (this.isOp("+") || this.isOp("-")) {
      const minus = this.isOp("-");
      this.at++;
      const a = left;
      const b = this.product();
      left = minus ? (v) => a(v) - b(v) : (v) => a(v) + b(v);
    }
    return left;
  }

  private product(): Compiled {
    let left = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const divide = this.isOp("/");
      this.at++;
      const a = left;
      const b = this.unary();
      left = divide ? (v) => a(v) / b(v) : (v) => a(v) * b(v);
    }
    return left;
  }

  private unary(): Compiled {
    if (this.isOp("-") || this.isOp("+")) {
      const minus = this.isOp("-");
      this.at++;
      return this.nested(() => {
        const a = this.unary();
        return minus ? (v) => -a(v) : a;
      });
    }
    return this.power();
  }

  private power(): Compiled {
    const base = this.atom();
    if (!this.isOp("^")) return base;
    this.at++;
    return this.nested(() => {
      const exponent = this.unary();
      return (v) => base(v) ** exponent(v);
    });
  }

  private atom(): Compiled {
    const t = this.tokens[this.at];
    if (!t) throw new Fail("unexpected end");
    this.at++;
    if (t.kind === "num") {
      const value = t.value;
      return () => value;
    }
    if (t.kind === "op") {
      if (t.op !== "(") throw new Fail(`unexpected ${tokenText(t)}`);
      return this.nested(() => {
        const inner = this.sum();
        this.expect(")");
        return inner;
      });
    }
    return this.name(t.name);
  }

  private name(name: string): Compiled {
    const fn = FUNCTIONS.get(name);
    if (fn && this.isOp("(")) {
      this.at++;
      return this.nested(() => {
        const arg = this.sum();
        this.expect(")");
        return (v) => fn(arg(v));
      });
    }
    const index = this.names.indexOf(name);
    if (index >= 0) return (v) => v[index] ?? Number.NaN;
    const constant = CONSTANTS.get(name);
    if (constant !== undefined) return () => constant;
    throw new Fail(fn ? `"${name}" needs "("` : `unknown name "${name}"`);
  }
}

function tokenText(t: Token): string {
  if (t.kind === "num") return `number ${t.value}`;
  return t.kind === "name" ? `"${t.name}"` : `"${t.op}"`;
}

/** Compiles `src` for the variables `names` (their values are passed in this order). */
export function compile(src: string, names: readonly string[]): CompileResult {
  if (src.length > MAX_EXPR_LENGTH) return { ok: false, error: `longer than ${MAX_EXPR_LENGTH} characters` };
  const tokens = tokenize(src);
  if (typeof tokens === "number") return { ok: false, error: `unexpected character at ${tokens + 1}` };
  if (tokens.length === 0) return { ok: false, error: "empty expression" };
  try {
    return { ok: true, fn: new Parser(tokens, names).parse() };
  } catch (e) {
    // The parser throws only Fail (its depth is capped, so no stack overflow).
    return { ok: false, error: (e as Fail).message };
  }
}
