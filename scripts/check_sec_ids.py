#!/usr/bin/env python3
"""Security coverage lint (docs/spec/14-quality.md#protected-checks): every SEC-xx and ROB-xx requirement in
docs/spec/13-security.md and 17-robustness.md is cited by at least one feature card (criteria or title, ranges
like "SEC-10 to SEC-14" count), or listed below. A requirement no card names is never read by a builder.

  python3 scripts/check_sec_ids.py [--root DIR]
"""
import argparse, json, re, sys
from pathlib import Path

# Requirements built by the kit itself, not by a feature.
KIT_ONLY = {
    "SEC-15": "scripts/live.sh",
    "SEC-54": "scripts/add_dep.py",
}
# Cards that implement a requirement without naming it (a card may already be done, so its text can't change).
COVERED_BY = {
    "SEC-01": ["F-052", "F-053", "F-054"], "SEC-05": ["F-055", "F-168"], "SEC-32": ["F-017"], "SEC-40": ["F-084"],
    "SEC-50": ["F-010", "F-013"], "SEC-53": ["F-170", "F-171", "F-172"], "SEC-61": ["F-163"], "SEC-62": ["F-073"],
    "ROB-20": ["F-071"],
}
ID = re.compile(r"\b((?:SEC|ROB)-\d+)")
RANGE = re.compile(r"\b(SEC|ROB)-(\d+)\s*(?:to|–)\s*(?:(?:SEC|ROB)-)?(\d+)")


def defined(root):
    text = "".join((root / "docs" / "spec" / f).read_text(encoding="utf-8") for f in ("13-security.md", "17-robustness.md"))
    return set(re.findall(r"\*\*((?:SEC|ROB)-\d+)", text))


def cited(features):
    out = {}
    for f in features:
        text = " ".join(f.get("acceptance", [])) + " " + f.get("title", "")
        for i in ID.findall(text):
            out.setdefault(i, set()).add(f["id"])
        for kind, a, b in RANGE.findall(text):
            for n in range(int(a), int(b) + 1):
                out.setdefault(f"{kind}-{n:02d}", set()).add(f["id"])
    return out


def check(root):
    features = json.loads((root / "docs" / "features.json").read_text(encoding="utf-8"))["features"]
    ids, have, cards = defined(root), cited(features), {f["id"] for f in features}
    problems = []
    for i in sorted(ids):
        if i in have or (i in KIT_ONLY and (root / KIT_ONLY[i]).exists()):
            continue
        if i in COVERED_BY:
            missing = [c for c in COVERED_BY[i] if c not in cards]
            if not missing:
                continue
            problems.append(f"{i}: listed as covered by {', '.join(missing)}, which no longer exist")
            continue
        problems.append(f"{i}: no feature card cites it (add it to the criterion that implements it, or list it in "
                        "scripts/check_sec_ids.py with the maintainer's OK)")
    for i in sorted(set(KIT_ONLY) | set(COVERED_BY)):
        if i not in ids:
            problems.append(f"{i}: listed in scripts/check_sec_ids.py but not defined in the spec")
    return problems


def main(argv=None):
    ap = argparse.ArgumentParser(description="Security coverage lint")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parent.parent))
    root = Path(ap.parse_args(argv).root)
    problems = check(root)
    for p in problems:
        print(p)
    print("SEC-COVERAGE OK" if not problems else f"{len(problems)} uncovered requirement(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
