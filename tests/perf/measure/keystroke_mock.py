"""The quick check of keystroke_p99_ms (14-quality.md#performance-budgets: "mocked core in
Playwright as the fast check"): runs `pnpm -C ui run test:perf` (ui/e2e/buffer-perf.spec.ts, the
F-001 method in Chromium with vsync off, D-080/D-120) and reports the p99 its report line prints
(`PASS keystroke_p99_ms 4.12 / 8.00 ...`). The harness applies the budget; the spec's own gate
only decides the exit status Playwright returns. Prints one JSON line."""

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REPORT = re.compile(r"^(?:PASS|FAIL) keystroke_p99_ms ([\d.]+)(?:, [\d.]+)? / ")


def p99_from(output: str) -> tuple[float, str] | None:
    """The first run's p99 and its detail line (`run 1: ...`) from the spec's report."""
    lines = output.splitlines()
    for i, text in enumerate(lines):
        m = REPORT.match(text.strip())
        if m:
            detail = next((t.strip() for t in lines[i + 1 : i + 3] if t.strip().startswith("run 1:")), text.strip())
            return float(m.group(1)), detail
    return None


def main() -> int:
    ids = sys.argv[1:] or ["keystroke_p99_ms"]
    proc = subprocess.run(["pnpm", "-C", "ui", "run", "test:perf", "--reporter=line"], cwd=ROOT, capture_output=True, text=True)
    sys.stderr.write(proc.stdout + proc.stderr)
    found = p99_from(proc.stdout)
    for bid in ids:
        if found is None:
            print(json.dumps({"id": bid, "error": f"test:perf printed no keystroke_p99_ms line (exit {proc.returncode})"}))
        else:
            print(json.dumps({"id": bid, "value": found[0], "detail": f"mocked core, Playwright Chromium: {found[1]}"}))
    # Over budget is the harness's call; only a run that measured nothing is a script failure.
    return 0 if found is not None else 1


if __name__ == "__main__":
    sys.exit(main())
