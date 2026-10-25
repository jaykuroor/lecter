#!/usr/bin/env bash
# The real-app e2e (16-ci-cd.md e2e-app job; drive-app skill; D-049).
#   scripts/e2e-app.sh [flow] [--evidence F-0NN]
# Builds the debug app with the embedded WebDriver server (`--features test-hooks`) and runs the
# WebdriverIO flows in tests/e2e/flows/ (all of them, or just <flow>) against it. On Linux without
# a display it re-runs itself under xvfb-run. Each run gets a throwaway LECTER_TEST_HOME and a
# synthetic course folder that LECTER_TEST_PICK hands to the next folder dialog; LECTER_TEST_TRUST=1
# answers the trust question. With --evidence F-0NN it saves every shot('<state>') as <state>.png,
# the app's log as app.log and this run's output as e2e-app.log in .evidence/F-0NN/.
set -uo pipefail
cd "$(dirname "$0")/.."

FLOW="" EVIDENCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --evidence) EVIDENCE="${2:-}"; shift 2 || { echo "--evidence needs F-0NN"; exit 2; } ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1"; exit 2 ;;
    *) [ -z "$FLOW" ] || { echo "one flow at a time"; exit 2; }; FLOW="$1"; shift ;;
  esac
done
if [ -n "$EVIDENCE" ] && ! [[ "$EVIDENCE" =~ ^F-[0-9]{3}$ ]]; then echo "--evidence takes a feature id like F-016"; exit 2; fi
if [ -n "$FLOW" ]; then
  [[ "$FLOW" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "flow names are lower-case words: $FLOW"; exit 2; }
  [ -f "tests/e2e/flows/$FLOW.ts" ] || { echo "no flow tests/e2e/flows/$FLOW.ts (have: $(cd tests/e2e/flows && ls *.ts | sed 's/\.ts$//' | tr '\n' ' '))"; exit 2; }
fi

# WebKitGTK needs a display. Without one, run the whole script under a virtual X server.
if [ "$(uname)" = Linux ] && [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ -z "${LECTER_E2E_XVFB:-}" ]; then
  command -v xvfb-run >/dev/null 2>&1 || { echo "no display and no xvfb-run (Fedora: sudo dnf install xorg-x11-server-Xvfb)"; exit 1; }
  LECTER_E2E_XVFB=1 exec xvfb-run -a -s "-screen 0 1280x800x24" bash "$0" ${FLOW:+"$FLOW"} ${EVIDENCE:+--evidence "$EVIDENCE"}
fi

# Same Node and pnpm settings as verify.sh (D-057, D-061), for runs outside it.
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ ! -w "$XDG_RUNTIME_DIR" ]; then export XDG_RUNTIME_DIR="${TMPDIR:-/tmp}"; fi
if [ -n "${HTTPS_PROXY:-}" ]; then export npm_config_https_proxy="$HTTPS_PROXY"; fi

RUN=$(mktemp -d "${TMPDIR:-/tmp}/lecter-e2e-app.XXXXXX") || exit 1
trap 'rm -rf "$RUN"' EXIT
mkdir -p "$RUN/home" "$RUN/out" "$RUN/shots" "$RUN/courses/Sample Course/slides" "$RUN/courses/Sample Course/lectures"
LOG="$RUN/e2e-app.log"
say() { echo "$*" | tee -a "$LOG"; }

say "== build: ui/dist and the debug app with test hooks"
{ pnpm --silent -C ui run build && cargo build -p lecter-app --locked --features custom-protocol,test-hooks; } >>"$LOG" 2>&1 \
  || { tail -n 40 "$LOG"; echo "build failed (full log above)"; exit 1; }
say "== typecheck: tests/e2e"
pnpm -C ui exec tsc -p ../tests/e2e/tsconfig.json >>"$LOG" 2>&1 || { tail -n 40 "$LOG"; exit 1; }

# Native paths for the app and Node: on Windows (Git Bash) /tmp/... means nothing to them.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
export LECTER_TEST_HOME="$(native "$RUN/home")"
export LECTER_TEST_PICK="$(native "$RUN/courses/Sample Course")"
export LECTER_TEST_TRUST=1
export LECTER_E2E_OUT="$(native "$RUN/out")" LECTER_E2E_SHOTS="$(native "$RUN/shots")" LECTER_E2E_FLOW="$FLOW"
# WebKitGTK can't start its own bubblewrap sandbox inside the Claude Code sandbox. Set only here,
# for these debug test runs; never in dev.sh, the app or a release build.
if [ "$(uname)" = Linux ]; then export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1; fi

say "== wdio: ${FLOW:-all flows}"
pnpm --silent -C ui run test:e2e:app 2>&1 | tee -a "$LOG"
STATUS=${PIPESTATUS[0]}

# keep <dir>: the run's screenshots, app.log (the wdio logs, which hold the app's stdout and
# stderr through captureBackendLogs) and e2e-app.log.
keep() {
  mkdir -p "$1"
  cp "$RUN"/shots/*.png "$1"/ 2>/dev/null || true
  cat "$RUN"/out/*.log > "$1/app.log" 2>/dev/null || echo "(no wdio log: the app did not start)" > "$1/app.log"
  cp "$LOG" "$1/e2e-app.log"
}
# Always in .verify/e2e-app/ (git-ignored; CI uploads it when the job fails).
rm -rf .verify/e2e-app && keep .verify/e2e-app
if [ -n "$EVIDENCE" ]; then
  keep ".evidence/$EVIDENCE"
  echo "evidence: $(cd ".evidence/$EVIDENCE" && ls | tr '\n' ' ')in .evidence/$EVIDENCE"
fi
[ "$STATUS" = 0 ] && echo "E2E-APP OK" || echo "E2E-APP FAILED"
exit "$STATUS"
