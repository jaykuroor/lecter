// The settings as `:set` sees them (12-settings-theme-onboarding.md#settings): every dotted key of
// the settings schema the core generates from its types (D-008), with what values it takes. The
// command line completes keys and values from it, and checks a value before the core does, so a
// wrong one is refused with its reason as soon as Enter is pressed.

/** What one setting holds. */
type SettingKind = "choice" | "boolean" | "integer" | "number" | "text" | "list";

/** One leaf setting of the schema. */
export interface SettingSpec {
  /** The dotted key: `ui.performance`. */
  key: string;
  kind: SettingKind;
  /** Whether `null` (unset) is a value. */
  nullable: boolean;
  /** For a `choice`, its values in schema order. */
  choices: readonly string[];
  /** For an `integer`, the smallest and largest value. */
  min: number;
  max: number;
  /** The schema's one-line description. */
  description: string;
}

/** A value as the core takes it (JSON text), or the reason it is refused. */
export type Checked = { ok: true; json: string } | { ok: false; reason: string };

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && !Array.isArray(v);

/** The largest value of an unsigned integer format; JavaScript holds integers exactly up to 2^53 − 1. */
const FORMAT_MAX: Record<string, number> = { uint8: 255, uint16: 65535, uint32: 4294967295 };

/** Follows a `$ref` into `$defs`. */
function deref(root: Node, node: Node): Node {
  const ref = node.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) return node;
  const defs = root.$defs;
  const target = isNode(defs) ? defs[ref.slice("#/$defs/".length)] : undefined;
  return isNode(target) ? target : node;
}

/** The node's `type` as a list (`["string", "null"]`, or one name). */
function types(node: Node): string[] {
  const t = node.type;
  if (typeof t === "string") return [t];
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
}

/** The string constants of an enum-like node (`enum`, `const`, `oneOf`/`anyOf` branches), and whether a branch is null. */
function constants(root: Node, node: Node, out: { values: string[]; nullable: boolean }): void {
  const n = deref(root, node);
  if (Array.isArray(n.enum)) out.values.push(...n.enum.filter((v): v is string => typeof v === "string"));
  if (typeof n.const === "string") out.values.push(n.const);
  if (types(n).includes("null")) out.nullable = true;
  for (const branch of [n.oneOf, n.anyOf]) {
    if (Array.isArray(branch)) for (const sub of branch) if (isNode(sub)) constants(root, sub, out);
  }
}

/** The setting at `key`, from its schema node. */
function leaf(root: Node, key: string, node: Node): SettingSpec {
  const n = deref(root, node);
  const description = typeof node.description === "string" ? node.description : "";
  const found = { values: [] as string[], nullable: false };
  constants(root, n, found);
  const t = types(n);
  const nullable = found.nullable || t.includes("null");
  const base = { key, nullable, choices: [] as string[], min: 0, max: 0, description };
  if (found.values.length > 0) return { ...base, kind: "choice", choices: found.values };
  if (t.includes("boolean")) return { ...base, kind: "boolean" };
  if (t.includes("integer")) {
    const min = typeof n.minimum === "number" ? n.minimum : Number.MIN_SAFE_INTEGER;
    const max = FORMAT_MAX[typeof n.format === "string" ? n.format : ""] ?? Number.MAX_SAFE_INTEGER;
    return { ...base, kind: "integer", min, max };
  }
  if (t.includes("number")) return { ...base, kind: "number" };
  if (t.includes("array")) return { ...base, kind: "list" };
  return { ...base, kind: "text" };
}

/** Every leaf setting under `node`, its keys starting with `prefix`. */
function walk(root: Node, node: Node, prefix: string, out: SettingSpec[]): void {
  const props = deref(root, node).properties;
  if (!isNode(props)) return;
  for (const [name, child] of Object.entries(props)) {
    if (!isNode(child)) continue;
    const key = prefix ? `${prefix}.${name}` : name;
    const target = deref(root, child);
    if (types(target).includes("object") && isNode(target.properties)) walk(root, target, key, out);
    else out.push(leaf(root, key, child));
  }
}

/** The settings of the schema text the core serves, sorted by key; none for text that isn't a schema. */
export function readSchema(text: string): SettingSpec[] {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isNode(root)) return [];
  const out: SettingSpec[] = [];
  walk(root, root, "", out);
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** What a value typed after `key=` must look like, said in the refusal. */
function expected(spec: SettingSpec): string {
  const orNull = spec.nullable ? ", or null" : "";
  switch (spec.kind) {
    case "choice":
      return `must be one of ${spec.choices.join(", ")}${orNull}`;
    case "boolean":
      return `must be true or false${orNull}`;
    case "integer":
      return `must be a whole number from ${spec.min} to ${spec.max}${orNull}`;
    default:
      return `must be a number${orNull}`;
  }
}

const WHOLE = /^-?\d+$/;
const DECIMAL = /^-?(\d+\.?\d*|\.\d+)$/;

/**
 * The value `text` (as typed after `key=`) for `spec`, as JSON text, or why the schema refuses it.
 * `null` unsets a nullable key (an empty value too, for text). A list is comma-separated.
 */
export function checkValue(spec: SettingSpec, raw: string): Checked {
  const text = raw.trim();
  if (spec.nullable && (text === "null" || (text === "" && spec.kind === "text"))) return { ok: true, json: "null" };
  const refuse = (): Checked => ({ ok: false, reason: `${spec.key} ${expected(spec)}` });
  switch (spec.kind) {
    case "choice":
      return spec.choices.includes(text) ? { ok: true, json: JSON.stringify(text) } : refuse();
    case "boolean":
      return text === "true" || text === "false" ? { ok: true, json: text } : refuse();
    case "integer": {
      const n = Number(text);
      return WHOLE.test(text) && n >= spec.min && n <= spec.max ? { ok: true, json: String(n) } : refuse();
    }
    case "number":
      return DECIMAL.test(text) ? { ok: true, json: String(Number(text)) } : refuse();
    case "list": {
      const items = text
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
      return { ok: true, json: JSON.stringify(items) };
    }
    default:
      return { ok: true, json: JSON.stringify(text) };
  }
}

/** A value the core sent (JSON text) as `:set` shows it: text without quotes, a list comma-separated. */
export function showValue(json: string): string {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return json;
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(",");
  return JSON.stringify(value);
}
