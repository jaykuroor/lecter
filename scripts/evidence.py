#!/usr/bin/env python3
"""Check the evidence a feature must attach (docs/spec/14-quality.md#evidence).

  scripts/evidence.py check F-0NN     exit 1 and list what is missing or empty
  scripts/evidence.py list F-0NN      the expected files
Files live in .evidence/<F-id>/ (git-ignored). Save screenshots with the drive-app skill,
command output with `… 2>&1 | tee .evidence/F-0NN/<name>.log`.
"""
import json, sys
from lib_features import ROOT, load, by_id

EXT = {"screenshot": ".png", "log": ".log", "harness": ".json"}


def expected(f):
    out = []
    for item in f.get("evidence", []):
        if item == "perf":
            out.append(("perf", "perf.txt"))
        else:
            kind, _, name = item.partition(":")
            out.append((item, name + EXT.get(kind, ".txt")))
    return out


def problem(item, path):
    if not path.is_file() or path.stat().st_size == 0:
        return "missing or empty"
    data = path.read_bytes()
    if item.startswith("screenshot:") and not data.startswith(b"\x89PNG"):
        return "not a PNG"
    if item.startswith("harness:"):
        try:
            json.loads(data)
        except ValueError:
            return "not JSON"
    if item == "perf" and b"FAIL" in data:
        return "perf output contains FAIL"
    return None


def main(argv):
    if len(argv) < 2 or argv[0] not in ("check", "list"):
        print(__doc__.strip())
        return 2
    idx = by_id(load())
    f = idx.get(argv[1])
    if not f:
        print(f"unknown feature {argv[1]}")
        return 2
    base = ROOT / ".evidence" / f["id"]
    if argv[0] == "list":
        for item, name in expected(f):
            print(f"{item:<28} {base / name}")
        return 0
    bad = [(item, base / name, problem(item, base / name)) for item, name in expected(f)]
    bad = [b for b in bad if b[2]]
    for item, path, why in bad:
        print(f"EVIDENCE {item}: {path.relative_to(ROOT)} {why}")
    print("EVIDENCE OK" if not bad else f"{len(bad)} evidence item(s) missing")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
