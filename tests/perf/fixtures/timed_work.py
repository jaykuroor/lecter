"""A real timing measurement for the harness's own tests (tests/perf/test_budgets.py): it times a
small fixed workload, which `PERF_FIXTURE_DELAY_MS` deliberately slows (a sleep inside the timed
region). With `PERF_FIXTURE_SLOW_RUNS=<n>` only the first n calls are slowed; the calls are counted
in the file `PERF_FIXTURE_COUNTER`. Prints one JSON line per id it is asked for, as every
measurement script does."""

import json
import os
import sys
import time


def calls_so_far() -> int:
    """This call's index (0 for the first), counted in PERF_FIXTURE_COUNTER when it is set."""
    path = os.environ.get("PERF_FIXTURE_COUNTER")
    if not path:
        return 0
    n = int(open(path).read() or 0) if os.path.exists(path) else 0
    with open(path, "w") as f:
        f.write(str(n + 1))
    return n


def main() -> int:
    delay = float(os.environ.get("PERF_FIXTURE_DELAY_MS", "0"))
    slow_runs = int(os.environ.get("PERF_FIXTURE_SLOW_RUNS", "1000000"))
    slowed = calls_so_far() < slow_runs
    for bid in sys.argv[1:]:
        t0 = time.perf_counter()
        sorted(range(20_000, 0, -1))  # the workload: a few ms at most
        if slowed and delay > 0:
            time.sleep(delay / 1000)
        ms = (time.perf_counter() - t0) * 1000
        print(json.dumps({"id": bid, "value": round(ms, 2), "detail": f"slowed by {delay:g} ms" if slowed else "fast"}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
