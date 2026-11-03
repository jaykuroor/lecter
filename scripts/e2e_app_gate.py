#!/usr/bin/env python3
"""The `e2e-app (<os>)` status check (16-ci-cd.md rule 4, D-154).

The real-app flows run in parallel `e2e-app-shard (<os>, <i>)` jobs; this check keeps the old name
and passes only when exactly <shards> shard jobs for <os> ran in this workflow run and every one
of them succeeded. A missing, skipped, cancelled or failed shard fails it.

    gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs?filter=latest&per_page=100" \\
      --jq '.jobs[] | {name, conclusion}' | python3 scripts/e2e_app_gate.py <os> <shards>

Reads one JSON object per line ({"name": ..., "conclusion": ...}); prints one line per shard.
"""
import json
import re
import sys


def verdict(lines, os_name, shards):
    """Returns (ok, report lines) for the jobs in `lines` (JSON text, one object per line)."""
    pattern = re.compile(r"^e2e-app-shard \(" + re.escape(os_name) + r", (\d+)\)$")
    found = {}
    for line in lines:
        line = line.strip()
        if not line:
            continue
        job = json.loads(line)
        m = pattern.match(job.get("name") or "")
        if m:
            found[int(m.group(1))] = job.get("conclusion") or "unfinished"
    report, ok = [], True
    for i in range(1, shards + 1):
        state = found.get(i, "missing")
        ok = ok and state == "success"
        report.append(f"e2e-app-shard ({os_name}, {i}): {state}")
    extra = sorted(set(found) - set(range(1, shards + 1)))
    if extra:
        ok = False
        report.append(f"unexpected shards for {os_name}: {extra} (the matrix and the gate disagree on the count)")
    return ok, report


def main(argv):
    if len(argv) != 3 or not argv[2].isdigit() or int(argv[2]) < 1:
        print("usage: e2e_app_gate.py <os> <shards>  (job JSON lines on stdin)", file=sys.stderr)
        return 2
    ok, report = verdict(sys.stdin.read().splitlines(), argv[1], int(argv[2]))
    print("\n".join(report))
    print(f"e2e-app ({argv[1]}): {'every shard passed' if ok else 'FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
