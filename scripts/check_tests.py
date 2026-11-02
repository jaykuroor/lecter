#!/usr/bin/env python3
"""Test-weakening lint (docs/spec/14-quality.md#protected-checks).

  python3 scripts/check_tests.py [--base REF] [--root DIR]

Compares the working tree with a base and fails when the change:
  - deletes a test file, or removes test functions (#[test], #[tokio::test], proptest!, it(), test());
  - adds #[ignore], .skip, .only, .fixme, xit, xdescribe, or test retries;
  - loosens or deletes a budget in tests/perf/budgets.json or a threshold in tests/corpus/thresholds.json;
  - changes or deletes an existing snapshot file;
  - adds a test that asserts nothing, asserts a constant or compares a value with itself, or only checks
    is_ok/is_some/toBeDefined/toBeTruthy/not.toBeNull (warns when a changed test file has more than 3 mocks).
Also fails on any `.only(` left in a tracked test file.
Deliberate exceptions need a commit trailer in the range (the reviewer judges the reason):
  Test-Removed: <path>[::name] - <reason>
  Snapshot-Changed: <path> - <reason>
  Test-Smell-Ok: <path>::<test name> - <reason>
  Budget-Changed: <id> - D-0NN          (D-0NN must be a decision by the maintainer)
Base, in order: --base; the `base` recorded by `feature.py start` for an in-progress feature;
the merge-base with main on another branch; HEAD's first parent; nothing (pass).
"""
import argparse, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_git import find_base, git, maintainer_decision, old_text, trailers as _trailers  # noqa: E402

TEST_FILE = re.compile(r"(^|/)(tests?|e2e|__tests__)/|\.(test|spec)\.[jt]sx?$|_test\.rs$")
SNAPSHOT = re.compile(r"\.snap$|(^|/)__snapshots__/|(^|/)tests/visual/baselines/")
TEST_FN = {
    ".rs": re.compile(r"#\[(tokio::)?test\b|#\[rstest\b|\bproptest!\s*\{"),
    ".ts": re.compile(r"(^|[^\w.])(it|test)\s*\(\s*['\"`]"),
}
TEST_FN[".tsx"] = TEST_FN[".js"] = TEST_FN[".ts"]
WEAKEN_RS = [(re.compile(r"#\[ignore\b"), "#[ignore]")]
WEAKEN_TS = [
    (re.compile(r"\b(it|test|describe)\.(skip|only|fixme)\s*\("), ".skip/.only/.fixme"),
    (re.compile(r"(^|[^\w.])(xit|xdescribe|xtest)\s*\("), "xit/xdescribe"),
    (re.compile(r"\bretries\s*:\s*[1-9]"), "test retries"),
    (re.compile(r"\.retries\s*\(\s*[1-9]"), "test retries"),
]
BUDGETS = "tests/perf/budgets.json"
THRESHOLDS = "tests/corpus/thresholds.json"


def count_tests(path, text):
    rx = TEST_FN.get(Path(path).suffix)
    return len(rx.findall(text)) if rx and text else 0


def budget_values(text):
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return {}
    items = data.get("budgets", data) if isinstance(data, dict) else data
    out = {}
    if isinstance(items, list):
        for b in items:
            if isinstance(b, dict) and "id" in b and isinstance(b.get("budget"), (int, float)):
                out[b["id"]] = (b["budget"], b.get("better", "lower"))
    return out


def threshold_values(text):
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return {}
    out = {}

    def walk(prefix, node):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(f"{prefix}.{k}" if prefix else k, v)
        elif isinstance(node, (int, float)):
            better = "higher" if prefix.endswith(("_min", "min")) else "lower"
            out[prefix] = (node, better)
    walk("", data)
    return out


def loosened(old, new):
    bad = []
    for key, (v, better) in old.items():
        if key not in new:
            bad.append(f"{key} deleted")
            continue
        nv = new[key][0]
        if (better == "lower" and nv > v) or (better == "higher" and nv < v):
            bad.append(f"{key} {v} → {nv}")
    return bad


def check(root, base):
    problems = []
    tracked = git(root, "ls-files").stdout.splitlines()
    for p in tracked:
        if TEST_FILE.search(p) and Path(p).suffix in (".ts", ".tsx", ".js") and (Path(root) / p).is_file():
            if re.search(r"\b(it|test|describe)\.only\s*\(", (Path(root) / p).read_text(encoding="utf-8", errors="ignore")):
                problems.append(f"{p}: .only( focuses tests and silently skips the rest")
    if base is None:
        return problems
    tr = _trailers(root, base, ("Test-Removed", "Snapshot-Changed", "Budget-Changed"))
    removed_ok = {t[0].split("::")[0] for t in tr["Test-Removed"]}
    snap_ok = {t[0] for t in tr["Snapshot-Changed"]}
    budget_ok = {t[0] for t in tr["Budget-Changed"] if re.search(r"D-\d+", t[1]) and maintainer_decision(root, re.search(r"D-\d+", t[1]).group(0))}
    status = git(root, "diff", "--name-status", "-M", base).stdout.splitlines()
    for line in status:
        parts = line.split("\t")
        code, path = parts[0], parts[-1]
        src = parts[1]
        if SNAPSHOT.search(src) and code[0] in "MDR" and src not in snap_ok:
            problems.append(f"{src}: existing snapshot changed (needs a Snapshot-Changed trailer the reviewer accepts)")
            continue
        if code[0] == "D" and TEST_FILE.search(src) and Path(src).suffix in (".rs", ".ts", ".tsx", ".js") and src not in removed_ok:
            problems.append(f"{src}: test file deleted")
        if code[0] in "MR" and src not in removed_ok:
            before = count_tests(src, old_text(root, base, src))
            fp = Path(root) / path
            after = count_tests(path, fp.read_text(encoding="utf-8", errors="ignore") if fp.is_file() else "")
            if after < before:
                problems.append(f"{path}: {before - after} test function(s) removed")
    diff = git(root, "diff", "-U0", base).stdout
    current = None
    for line in diff.splitlines():
        if line.startswith("+++ "):
            current = line[6:] if line.startswith("+++ b/") else None
        elif line.startswith("+") and not line.startswith("+++") and current:
            rules = WEAKEN_RS if current.endswith(".rs") else WEAKEN_TS if current.endswith((".ts", ".tsx", ".js", ".mjs")) else []
            if rules:
                for rx, what in rules:
                    if rx.search(line):
                        problems.append(f"{current}: adds {what}: {line[1:].strip()[:80]}")
    for path, fn in ((BUDGETS, budget_values), (THRESHOLDS, threshold_values)):
        old = old_text(root, base, path)
        fp = Path(root) / path
        if old is None:
            continue
        new = fp.read_text(encoding="utf-8") if fp.exists() else "{}"
        for b in loosened(fn(old), fn(new)):
            key = b.split()[0]
            if key not in budget_ok:
                problems.append(f"{path}: loosened {b} (needs Budget-Changed: {key} - D-0NN by the maintainer)")
    return problems


# ---- Test smells (14-quality.md#protected-checks, docs/TESTING.md#tests-that-catch-bugs) ----
# New tests must assert something real. Fails a NEW test (by name, compared with the base) that asserts nothing,
# asserts a tautology, or only checks that a call didn't fail or that a value exists. Warns (doesn't fail) when a
# changed test file uses more than MAX_MOCKS mocks. Exception: a `Test-Smell-Ok: <path>::<name> - <reason>` trailer
# the reviewer accepts. Warnings and findings also go to .verify/test-smells.txt for the reviewer.
MAX_MOCKS = 3
RS_ATTR = re.compile(r"#\[(?:tokio::)?test\b[^\]]*\]|#\[rstest\b[^\]]*\]")
RS_FN = re.compile(r"\bfn\s+(\w+)")
RS_ASSERT = re.compile(r"\b(?:prop_)?assert(?:_eq|_ne|_matches)?!\s*\(")
RS_STRONG = re.compile(r"\b(?:insta::)?assert_\w*snapshot!|\bpanic!|\.unwrap_err\(\)|\.expect_err\(|#\[should_panic")
TS_TEST = re.compile(r"(?<![\w.$])(?:it|test)(?:\.each\s*\(|\s*\()")
TS_EXPECT = re.compile(r"(?<![\w.$])expect\s*\(")
TS_STRONG = re.compile(r"toMatch(?:Inline)?Snapshot\(|toThrow\w*\(|(?<![\w.$])assert(?:\.\w+)?\s*\(|expect\.assertions\(")
TS_WEAK = {"toBeDefined", "toBeTruthy", "not.toBeNull", "not.toBeUndefined", "not.toBeFalsy"}
TS_EQ = {"toBe", "toEqual", "toStrictEqual"}
HELPER = re.compile(r"(?<![\w.$])((?:assert|check|expect|verify)_?\w+)\s*\(")
LITERAL = re.compile(r"^(?:true|false|null|undefined|-?\d+(?:\.\d+)?|'[^']*'|\"[^\"]*\"|`[^`$]*`)$")
MOCKS = re.compile(r"\bvi\.(?:mock|fn|spyOn)\s*\(|\bjest\.(?:mock|fn|spyOn)\s*\(|\bmock!\s*\{|#\[automock\]|\bMock\w+::new\s*\(")


def _match(text, i, open_ch, close_ch):
    """Index just past the bracket matching text[i] == open_ch; skips strings and // comments. -1 if unbalanced."""
    depth, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if c in "\"`":
            j = i + 1
            while j < n and text[j] != c:
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def _args(text, m):
    """The argument text of the call whose opening paren ends match m."""
    start = m.end() - 1
    end = _match(text, start, "(", ")")
    return (text[start + 1:end - 1], end) if end > 0 else ("", m.end())


def _norm(s):
    return re.sub(r"\s+", "", s).rstrip(",")


def rust_tests(text):
    """{name: body} for #[test]/#[tokio::test]/#[rstest] functions (attributes included in the body)."""
    out = {}
    for m in RS_ATTR.finditer(text):
        f = RS_FN.search(text, m.end())
        if not f:
            continue
        brace = text.find("{", f.end())
        end = _match(text, brace, "{", "}") if brace >= 0 else -1
        if end > 0:
            out[f.group(1)] = text[m.start():end]
    return out


def ts_tests(text):
    out = {}
    for m in TS_TEST.finditer(text):
        open_i = m.end() - 1
        if text[open_i] != "(":
            continue
        end = _match(text, open_i, "(", ")")
        if m.group(0).rstrip().endswith("each("):  # test.each(table)("name", fn)
            nxt = text.find("(", end)
            if nxt < 0 or text[end:nxt].strip():
                continue
            open_i, end = nxt, _match(text, nxt, "(", ")")
        if end < 0:
            continue
        body = text[open_i + 1:end - 1]
        name = re.match(r"\s*(['\"`])(.*?)\1", body)
        if name:
            out[name.group(2)] = body
    return out


def _helpers(text, lang):
    """Names of non-test functions in this file whose bodies assert (so calling them counts as asserting)."""
    found = set()
    if lang == "rs":
        for f in re.finditer(r"\bfn\s+(\w+)[^{;]*\{", text):
            end = _match(text, f.end() - 1, "{", "}")
            if end > 0 and (RS_ASSERT.search(text, f.end(), end) or RS_STRONG.search(text, f.end(), end)):
                found.add(f.group(1))
    else:
        for f in re.finditer(r"(?:function\s+(\w+)\s*\([^)]*\)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>)\s*\{", text):
            end = _match(text, f.end() - 1, "{", "}")
            if end > 0 and (TS_EXPECT.search(text, f.end(), end) or TS_STRONG.search(text, f.end(), end)):
                found.add(f.group(1) or f.group(2))
    return found


def smell(body, lang, helpers):
    """None if the test asserts something real, else a short reason."""
    called = set(re.findall(r"(?<![\w.$])(\w+)\s*\(", body))
    helper_call = bool(called & helpers) or bool(HELPER.search(body))
    if lang == "rs":
        strong = bool(RS_STRONG.search(body))
        kinds = []
        for m in RS_ASSERT.finditer(body):
            a, _ = _args(body, m)
            macro, parts = m.group(0).split("(")[0].strip(), _split_top(a)
            first = _norm(parts[0]) if parts else ""
            if macro in ("assert!", "prop_assert!") and first in ("true", "!false"):
                return f"asserts a constant: {macro}({first})"
            if macro in ("assert_eq!", "prop_assert_eq!") and len(parts) >= 2 and first == _norm(parts[1]):
                return f"compares a value with itself: {macro}({first}, {first})"
            weak = macro in ("assert!", "prop_assert!") and re.search(r"\.(is_ok|is_some)\(\)$", first) and "&&" not in first
            kinds.append("weak" if weak else "real")
    else:
        strong = bool(TS_STRONG.search(body))
        kinds = []
        for m in TS_EXPECT.finditer(body):
            a, end = _args(body, m)
            rest = body[end:]
            chain = re.match(r"\s*((?:\.(?:not|resolves|rejects))*)\.(\w+)\s*\(", rest)
            if not chain:
                continue
            mods, matcher = chain.group(1), chain.group(2)
            expected, _ = _args(rest, chain)
            if LITERAL.match(a.strip()) and not mods:
                return f"asserts on a literal: expect({a.strip()[:30]})"
            if matcher in TS_EQ and not mods and _norm(a) == _norm(expected):
                return f"compares a value with itself: expect({a.strip()[:30]}).{matcher}(...)"
            key = (mods.replace(".resolves", "").replace(".rejects", "") + "." + matcher).lstrip(".")
            kinds.append("weak" if key in TS_WEAK else "real")
    if strong or helper_call:
        return None
    if not kinds:
        return "asserts nothing"
    if all(k == "weak" for k in kinds):
        return ("only checks is_ok()/is_some(); assert the value it produced" if lang == "rs" else
                "only checks that a value exists (toBeDefined/toBeTruthy/not.toBeNull); assert the value")
    return None


def _split_top(a):
    """Split call arguments on top-level commas."""
    parts, depth, cur, i = [], 0, "", 0
    while i < len(a):
        c = a[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
        elif c == '"':
            j = i + 1
            while j < len(a) and a[j] != '"':
                j += 2 if a[j] == "\\" else 1
            cur += a[i:j + 1]
            i = j + 1
            continue
        if c == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    if cur.strip():
        parts.append(cur)
    return parts


def smells(root, base):
    """(problems, warnings) for test functions added since base."""
    problems, warnings = [], []
    ok = {t[0] for t in _trailers(root, base, ("Test-Smell-Ok",))["Test-Smell-Ok"]}
    for line in git(root, "diff", "--name-status", "-M", base).stdout.splitlines():
        parts = line.split("\t")
        code, path = parts[0], parts[-1]
        if code[0] not in "AMR":
            continue
        suffix = Path(path).suffix
        lang = "rs" if suffix == ".rs" else "ts" if suffix in (".ts", ".tsx", ".js") and TEST_FILE.search(path) else None
        fp = Path(root) / path
        if not lang or not fp.is_file():
            continue
        new = fp.read_text(encoding="utf-8", errors="ignore")
        old = old_text(root, base, parts[1]) or ""
        find = rust_tests if lang == "rs" else ts_tests
        before, tests = set(find(old)), find(new)
        helpers = _helpers(new, lang) - set(tests)  # a test calling another test is no helper
        for name, body in tests.items():
            if name in before or f"{path}::{name}" in ok:
                continue
            why = smell(body, lang, helpers)
            if why:
                problems.append(f"{path}::{name}: new test {why} (docs/TESTING.md#tests-that-catch-bugs)")
        mocks = len(MOCKS.findall(new))
        if mocks > MAX_MOCKS and (lang == "ts" or rust_tests(new)):
            warnings.append(f"WARN {path}: {mocks} mocks; mock only at process, network and OS edges (docs/TESTING.md#mocking)")
    return problems, warnings


def main(argv=None):
    ap = argparse.ArgumentParser(description="Test-weakening lint")
    ap.add_argument("--base")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    a = ap.parse_args(argv)
    root = Path(a.root).resolve()
    if git(root, "rev-parse", "--git-dir").returncode != 0:
        print("TESTS-GUARD SKIP (not a git repository)")
        return 0
    base = find_base(root, a.base)
    problems = check(root, base)
    found, warnings = smells(root, base) if base else ([], [])
    problems += found
    for p in problems + warnings:
        print(p)
    if (root / ".verify").is_dir():
        (root / ".verify" / "test-smells.txt").write_text("".join(f"{x}\n" for x in found + warnings))
    print(f"TESTS-GUARD OK (base {base or 'none'})" if not problems else f"{len(problems)} test-weakening problem(s) against {base}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
