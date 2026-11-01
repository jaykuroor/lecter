#!/usr/bin/env bash
# The perf harness (14-quality.md#perf-harness, F-025).
#   tests/perf/budgets.sh [--ci] [--quick] [--nightly] [--only <id>]...   measure and gate
#   tests/perf/budgets.sh --self-test                                      only the harness's own tests
# Runs the measurement scripts listed in tests/perf/budgets.json, prints one line per budget
# (`PASS keystroke_p99_ms 5.1 / 8`), writes tests/perf/report.json and exits 1 on a breach. The
# logic is in harness.py. Before measuring it runs its own tests (test_budgets.py), so a broken
# gate can't pass quietly; LECTER_PERF_SELFTEST=0 skips them (the tests themselves set it).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
PY=$(command -v python3 || command -v python) || { echo "budgets.sh: needs Python 3"; exit 2; }

if [ "${1:-}" = "--self-test" ] || [ "${LECTER_PERF_SELFTEST:-1}" != 0 ]; then
  if ! out=$("$PY" -m unittest -q tests/perf/test_budgets.py 2>&1); then
    printf '%s\n' "$out" | tail -n 40
    echo "SELFTEST FAILED (tests/perf/test_budgets.py)"
    exit 1
  fi
  echo "SELFTEST ok ($(printf '%s\n' "$out" | sed -n 's/^Ran \([0-9]*\) tests.*/\1/p') harness tests)"
  [ "${1:-}" = "--self-test" ] && exit 0
fi
exec "$PY" tests/perf/harness.py "$@"
