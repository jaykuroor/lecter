"""The result lines of a real-app run (tests/perf/app/run.sh) for tests/perf/harness.py.

    collect.py <results.jsonl> <budget id>...

The measurement files append one {"id", "value", "detail"} line per measurement. For each id this
prints one JSON line: the line itself when there is one; {"id", "samples", "details"} when there
are several (cold_open_ms: one per launch, D-152; the harness takes their median); an error when
there is none (that measurement file failed; its log is in tests/perf/logs/).
"""

import json
import sys
from pathlib import Path


def collect(lines: list[str], ids: list[str]) -> list[dict]:
    by: dict[str, list[dict]] = {i: [] for i in ids}
    for text in lines:
        try:
            r = json.loads(text)
        except ValueError:
            continue
        if isinstance(r, dict) and r.get("id") in by and isinstance(r.get("value"), (int, float)):
            by[r["id"]].append(r)
    out = []
    for bid, rows in by.items():
        if not rows:
            out.append({"id": bid, "error": "the real-app run measured nothing for it (log: tests/perf/logs/)"})
        elif len(rows) == 1:
            out.append(rows[0])
        else:
            out.append({"id": bid, "samples": [r["value"] for r in rows], "details": [r.get("detail", "") for r in rows]})
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.split("\n\n")[1], file=sys.stderr)
        return 2
    lines = Path(argv[0]).read_text(encoding="utf-8").splitlines()
    for r in collect(lines, argv[1:]):
        print(json.dumps(r))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
