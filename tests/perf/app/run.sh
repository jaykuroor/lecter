#!/usr/bin/env bash
# The real-app budgets (14-quality.md#performance-budgets), run by tests/perf/budgets.sh:
#   tests/perf/app/run.sh <budget id>...
# Builds ui/dist and the debug app with the embedded WebDriver server (`--features test-hooks`, as
# scripts/e2e-app.sh does), then runs each measurement file that one of the ids needs, each in a
# fresh app process with its own throwaway LECTER_TEST_HOME and a course holding one generated
# fixture lecture (tests/fixtures/lectures/gen_lecture.py). Prints one JSON line per id on stdout
# (a value, or an error); everything else goes to stderr, which budgets.sh keeps in
# tests/perf/logs/. On Linux without a display it re-runs itself under xvfb-run.
# LECTER_PERF_NO_BUILD=1 skips the build (the binary must exist).
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
[ "$(uname)" = Linux ] || fail_all "the real-app process readers need Linux procfs (F-174 adds macOS and Windows)"

# Same Node and pnpm settings as verify.sh (D-057), for runs outside it.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ ! -w "$XDG_RUNTIME_DIR" ]; then export XDG_RUNTIME_DIR="${TMPDIR:-/tmp}"; fi
if [ -n "${HTTPS_PROXY:-}" ]; then export npm_config_https_proxy="$HTTPS_PROXY"; fi
PY=$(command -v python3 || command -v python)

if [ "${LECTER_PERF_NO_BUILD:-0}" != 1 ]; then
  echo "== build: ui/dist and the debug app with test hooks" >&2
  { pnpm --silent -C ui run build && cargo build -p lecter-app --locked --features custom-protocol,test-hooks; } >&2 \
    || fail_all "build failed (see the log)"
fi
APP="$PWD/target/debug/lecter-app"
[ -x "$APP" ] || fail_all "no app binary at target/debug/lecter-app"
echo "== typecheck: tests/perf/app" >&2
pnpm -C ui exec tsc -p ../tests/perf/app/tsconfig.json >&2 || fail_all "tests/perf/app does not typecheck"

RUN=$(mktemp -d "${TMPDIR:-/tmp}/lecter-perf.XXXXXX") || fail_all "no temp dir"
trap 'rm -rf "$RUN"' EXIT
OUT="$RUN/results.jsonl"
: > "$OUT"
# WebKitGTK can't start its own bubblewrap sandbox inside the Claude Code sandbox (as e2e-app.sh).
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1

want() { local id; for id in "${IDS[@]}"; do [ "$id" = "$1" ] && return 0; done; return 1; }

# measure <spec> <slides> <ids of that spec...>: one fresh app process for the ids requested.
measure() {
  local spec="$1" slides="$2" id mine=()
  shift 2
  for id in "$@"; do want "$id" && mine+=("$id"); done
  [ ${#mine[@]} -gt 0 ] || return 0
  local dir="$RUN/$spec" name="2026-10-23-l07-fixture.md"
  mkdir -p "$dir/home" "$dir/out" "$dir/courses/Perf Course/lectures" "$dir/courses/Perf Course/slides"
  "$PY" tests/fixtures/lectures/gen_lecture.py "$slides" "$dir/courses/Perf Course/lectures/$name" || return 1
  echo "== $spec: ${mine[*]} ($slides-slide fixture)" >&2
  LECTER_TEST_HOME="$dir/home" LECTER_TEST_PICK="$dir/courses/Perf Course" LECTER_TEST_TRUST=1 \
    LECTER_PERF_IDS="${mine[*]}" LECTER_PERF_SPEC="$spec" LECTER_PERF_APP="$APP" LECTER_PERF_LECTURE="$name" \
    LECTER_PERF_OUT="$OUT" LECTER_E2E_OUT="$dir/out" \
    pnpm --silent -C ui exec wdio run ../tests/perf/app/wdio.conf.ts >&2
  local status=$?
  cat "$dir"/out/*.log >&2 2>/dev/null || true
  return $status
}

# A measurement file that fails leaves its ids without a value (an error line); the others count.
measure open-idle 200 cold_open_ms idle_rss_mb idle_cpu_pct
measure keystroke 200 keystroke_p99_ms
measure rss-300 300 rss_300_slides_mb
measure ttft 200 ttft_overhead_ms

for id in "${IDS[@]}"; do
  line=$(grep -F "\"id\":\"$id\"" "$OUT" | tail -n 1)
  if [ -n "$line" ]; then printf '%s\n' "$line"
  else printf '{"id": "%s", "error": "the real-app run measured nothing for it (log: tests/perf/logs/)"}\n' "$id"; fi
done
exit 0
