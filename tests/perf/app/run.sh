#!/usr/bin/env bash
# The real-app budgets (14-quality.md#performance-budgets), run by tests/perf/budgets.sh:
#   tests/perf/app/run.sh <budget id>...
# Builds ui/dist and a release-profile app with the embedded WebDriver server (`--features
# custom-protocol,test-hooks`; D-069, D-138) in its own target dir, target/perf/, so the release
# build that tests/e2e/release-check.sh checks for test hooks (target/release/) is never this one.
# Then it runs each measurement file that one of the ids needs, each in a fresh app process with
# its own throwaway LECTER_TEST_HOME and a course holding one generated fixture lecture
# (tests/fixtures/lectures/gen_lecture.py). cold_open_ms is 5 launches (D-152), each started once
# the previous launch's processes have all ended; its result line carries the 5 samples and the
# harness gates their median. Prints one JSON line per id on stdout (a value or samples, or an
# error); everything else goes to stderr, which budgets.sh keeps in tests/perf/logs/.
# Linux, macOS and Windows (Git Bash): the processes are read by procs.py. On Linux without a
# display it re-runs itself under xvfb-run. LECTER_PERF_NO_BUILD=1 skips the build.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2

[ $# -gt 0 ] || { echo "usage: tests/perf/app/run.sh <budget id>..." >&2; exit 2; }
IDS=("$@")
fail_all() { # every requested id gets the error $1, then exit 1
  local id; for id in "${IDS[@]}"; do printf '{"id": "%s", "error": "%s"}\n' "$id" "$1"; done; exit 1
}

if [ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ -z "${LECTER_E2E_XVFB:-}" ]; then
  command -v xvfb-run >/dev/null 2>&1 || fail_all "no display and no xvfb-run (install the Xvfb package)"
  LECTER_E2E_XVFB=1 exec xvfb-run -a -s "-screen 0 1280x800x24" bash "$0" "$@"
fi

# Same Node and pnpm settings as verify.sh (D-057), for runs outside it.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ ! -w "$XDG_RUNTIME_DIR" ]; then export XDG_RUNTIME_DIR="${TMPDIR:-/tmp}"; fi
if [ -n "${HTTPS_PROXY:-}" ]; then export npm_config_https_proxy="$HTTPS_PROXY"; fi
# The first launcher that really is Python 3 (Windows may have a python3 that is a Store stub).
PY=""
for py in python3 python py; do
  command -v "$py" >/dev/null 2>&1 || continue
  [ "$("$py" -c 'import sys; print(sys.version_info[0])' 2>/dev/null | tr -d '\r')" = 3 ] && { PY=$(command -v "$py"); break; }
done
[ -n "$PY" ] || fail_all "needs Python 3"
# Native paths for the app, Node and Python: on Windows (Git Bash) /tmp/... means nothing to them.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

if [ "${LECTER_PERF_NO_BUILD:-0}" != 1 ]; then
  echo "== build: ui/dist and the release-profile app with test hooks (target/perf/)" >&2
  { pnpm --silent -C ui run build \
      && CARGO_TARGET_DIR="$PWD/target/perf" cargo build -p lecter-app --release --locked --features custom-protocol,test-hooks; } >&2 \
    || fail_all "build failed (see the log)"
fi
EXE=lecter-app
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=lecter-app.exe ;; esac
APP="$PWD/target/perf/release/$EXE"
[ -x "$APP" ] || fail_all "no app binary at target/perf/release/$EXE"
echo "== typecheck: tests/perf/app" >&2
pnpm -C ui exec tsc -p ../tests/perf/app/tsconfig.json >&2 || fail_all "tests/perf/app does not typecheck"

RUN=$(mktemp -d "${TMPDIR:-/tmp}/lecter-perf.XXXXXX") || fail_all "no temp dir"
trap 'rm -rf "$RUN"' EXIT
OUT="$RUN/results.jsonl"
PIDS="$RUN/pids.txt"
: > "$OUT"
# WebKitGTK can't start its own bubblewrap sandbox inside the Claude Code sandbox (as e2e-app.sh).
if [ "$(uname)" = Linux ]; then export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1; fi

want() { local id; for id in "${IDS[@]}"; do [ "$id" = "$1" ] && return 0; done; return 1; }

# quiet: waits until every process the last launch's snapshots saw has ended (cold starts must
# not share the machine with the previous app's teardown).
quiet() {
  [ -s "$PIDS" ] || return 0
  # shellcheck disable=SC2046
  "$PY" tests/perf/app/procs.py wait-gone $(tr ' ' '\n' < "$PIDS" | sort -u) --timeout 60 >&2
  : > "$PIDS"
}

# measure <spec> <slides> <ids of that spec...>: one fresh app process for the ids requested.
measure() {
  local spec="$1" slides="$2" id mine=()
  shift 2
  for id in "$@"; do want "$id" && mine+=("$id"); done
  [ ${#mine[@]} -gt 0 ] || return 0
  quiet
  local dir name="2026-10-23-l07-fixture.md"
  dir=$(mktemp -d "$RUN/$spec.XXXX")
  mkdir -p "$dir/home" "$dir/out" "$dir/courses/Perf Course/lectures" "$dir/courses/Perf Course/slides"
  "$PY" tests/fixtures/lectures/gen_lecture.py "$slides" "$dir/courses/Perf Course/lectures/$name" || return 1
  echo "== $spec: ${mine[*]} ($slides-slide fixture)" >&2
  LECTER_TEST_HOME="$(native "$dir/home")" LECTER_TEST_PICK="$(native "$dir/courses/Perf Course")" LECTER_TEST_TRUST=1 \
    LECTER_PERF_IDS="${mine[*]}" LECTER_PERF_SPEC="$spec" LECTER_PERF_APP="$(native "$APP")" LECTER_PERF_LECTURE="$name" \
    LECTER_PERF_OUT="$(native "$OUT")" LECTER_PERF_PIDS="$(native "$PIDS")" LECTER_PERF_PY="$(native "$PY")" \
    LECTER_PY="$(native "$PY")" \
    LECTER_E2E_OUT="$(native "$dir/out")" \
    pnpm --silent -C ui exec wdio run ../tests/perf/app/wdio.conf.ts >&2
  local status=$?
  cat "$dir"/out/*.log >&2 2>/dev/null || true
  return $status
}

# A measurement file that fails leaves its ids without a value (an error line); the others count.
for _ in 1 2 3 4 5; do measure cold-open 200 cold_open_ms; done
measure open-idle 200 idle_rss_mb idle_cpu_pct
measure keystroke 200 keystroke_p99_ms
measure rss-300 300 rss_300_slides_mb
measure ttft 200 ttft_overhead_ms
quiet

"$PY" tests/perf/app/collect.py "$OUT" "${IDS[@]}"
exit 0
