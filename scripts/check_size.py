#!/usr/bin/env python3
"""File-size lint (docs/spec/01-architecture.md#repository-layout, D-054).

  python3 scripts/check_size.py [--root DIR]

Fails when a tracked source file is over 500 lines, a spec file over 300, or AGENTS.md plus CLAUDE.md
over 150 together. Generated and data files are exempt (bindings, lockfiles, snapshots, fixtures).
Split a long file by responsibility; don't raise the limit.
"""
import argparse, re, subprocess, sys
from pathlib import Path

SOURCE = re.compile(r"\.(rs|ts|tsx|js|mjs|py|sh|css)$")
EXEMPT = re.compile(r"(^|/)(bindings\.ts|.*\.gen\.\w+|.*\.snap|Cargo\.lock|pnpm-lock\.yaml)$|(^|/)(fixtures|snapshots|corpus|node_modules|target|dist)/")
LIMITS = [(re.compile(r"^docs/spec/.*\.md$"), 300, "spec file"), (SOURCE, 500, "source file")]
ALWAYS_LOADED = ("AGENTS.md", "CLAUDE.md")
ALWAYS_LOADED_MAX = 150


def files(root):
    r = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=root, capture_output=True, text=True)
    if r.returncode == 0:
        return r.stdout.splitlines()
    return [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and ".git" not in p.parts]


def lines(p):
    try:
        return p.read_bytes().count(b"\n")
    except OSError:
        return 0


def check(root):
    problems = []
    for rel in files(root):
        if EXEMPT.search(rel):
            continue
        for rx, limit, what in LIMITS:
            if rx.search(rel):
                n = lines(root / rel)
                if n > limit:
                    problems.append(f"{rel}: {n} lines (limit {limit} for a {what}); split it by responsibility")
                break
    total = sum(lines(root / f) for f in ALWAYS_LOADED if (root / f).exists())
    if total > ALWAYS_LOADED_MAX:
        problems.append(f"AGENTS.md + CLAUDE.md: {total} lines (limit {ALWAYS_LOADED_MAX}); move detail to a folder CLAUDE.md or a skill")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="File-size lint")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    root = Path(ap.parse_args(argv).root).resolve()
    problems = check(root)
    for p in problems:
        print(p)
    print("SIZE OK" if not problems else f"{len(problems)} file(s) too long")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
