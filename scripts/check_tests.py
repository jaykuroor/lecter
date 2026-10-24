#!/usr/bin/env python3
"""Test-weakening lint (docs/spec/14-quality.md#protected-checks).

  python3 scripts/check_tests.py [--base REF] [--root DIR]

Compares the working tree with a base and fails when the change:
  - deletes a test file, or removes test functions (#[test], #[tokio::test], proptest!, it(), test());
  - adds #[ignore], .skip, .only, .fixme, xit, xdescribe, or test retries;
  - loosens or deletes a budget in tests/perf/budgets.json or a threshold in tests/corpus/thresholds.json;
  - changes or deletes an existing snapshot file.
Also fails on any `.only(` left in a tracked test file.
Deliberate exceptions need a commit trailer in the range (the reviewer judges the reason):
  Test-Removed: <path>[::name] - <reason>
  Snapshot-Changed: <path> - <reason>
  Budget-Changed: <id> - D-0NN          (D-0NN must be a decision by Jay)
Base, in order: --base; the `base` recorded by `feature.py start` for an in-progress feature;
the merge-base with main on another branch; HEAD's first parent; nothing (pass).
"""
import argparse, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib_git import find_base, git, jay_decision, old_text, trailers as _trailers  # noqa: E402

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
    budget_ok = {t[0] for t in tr["Budget-Changed"] if re.search(r"D-\d+", t[1]) and jay_decision(root, re.search(r"D-\d+", t[1]).group(0))}
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
                problems.append(f"{path}: loosened {b} (needs Budget-Changed: {key} - D-0NN by Jay)")
    return problems


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
    for p in problems:
        print(p)
    print(f"TESTS-GUARD OK (base {base or 'none'})" if not problems else f"{len(problems)} test-weakening problem(s) against {base}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
