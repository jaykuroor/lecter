"""A measurement script with scripted values, for the harness's own tests: `PERF_FIXTURE_VALUES` is
a JSON object of id -> list of values, one per call (the last repeats), counted in the file
`PERF_FIXTURE_COUNTER`. An id with no values is left out of the output (a script that failed to
measure it); a value that is itself a list is printed as that call's samples (a median_of
budget); `PERF_FIXTURE_EXIT` sets the exit status."""

import json
import os
import sys


def main() -> int:
    values = json.loads(os.environ.get("PERF_FIXTURE_VALUES", "{}"))
    counter = os.environ["PERF_FIXTURE_COUNTER"]
    n = int(open(counter).read() or 0) if os.path.exists(counter) else 0
    with open(counter, "w") as f:
        f.write(str(n + 1))
    for bid in sys.argv[1:]:
        seq = values.get(bid) or []
        if seq:
            v = seq[min(n, len(seq) - 1)]
            key = "samples" if isinstance(v, list) else "value"
            print(json.dumps({"id": bid, key: v, "detail": f"call {n + 1}"}))
    print("measurement log line that is not JSON")
    return int(os.environ.get("PERF_FIXTURE_EXIT", "0"))


if __name__ == "__main__":
    sys.exit(main())
