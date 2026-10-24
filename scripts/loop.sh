#!/usr/bin/env bash
# Run fresh-context agent sessions back to back, one feature each.
#   scripts/loop.sh build [N]   build features from PROMPT.md, at most N sessions (default 30)
#   scripts/loop.sh init        one session from PROMPT.init.md (first run only)
#   scripts/loop.sh plan        one session from PROMPT.plan.md (after spec changes or answers)
#   scripts/loop.sh garden      one session from PROMPT.garden.md (cleanup; also runs every 6 features)
# Stop any time: touch STOP (the current session finishes first) or Ctrl-C.
# Agent command: LECTER_AGENT_CMD (default: claude -p). Extra flags: LECTER_CLAUDE_FLAGS.
# Sessions push main after each feature only if LECTER_ALLOW_PUSH=1. Questions go to docs/QUESTIONS.md.
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-build}"; MAX="${2:-30}"
case "$MODE" in
  build) PROMPT=PROMPT.md ;; init) PROMPT=PROMPT.init.md; MAX=1 ;;
  plan) PROMPT=PROMPT.plan.md; MAX=1; export LECTER_PLANNING=1 ;;
  garden) PROMPT=PROMPT.garden.md; MAX=1 ;;
  *) echo "unknown mode $MODE"; exit 2 ;;
esac
export LECTER_STRICT=1   # Stop hook enforces the handoff
FLAGS="${LECTER_CLAUDE_FLAGS:---permission-mode acceptEdits}"
mkdir -p .loop/logs
idle=0; done_since_garden=0

session() { # prompt file, label
  local log=".loop/logs/$(date +%Y%m%d-%H%M%S)-$2.jsonl"
  echo "[$(date +%H:%M:%S)] session $2 → $log"
  if [ -n "${LECTER_AGENT_CMD:-}" ]; then
    $LECTER_AGENT_CMD "$(cat "$1")" </dev/null >"$log" 2>&1
  else
    # shellcheck disable=SC2086
    claude -p "$(cat "$1")" --output-format stream-json --verbose $FLAGS </dev/null >"$log" 2>&1
  fi
  echo "[$(date +%H:%M:%S)] exit $?"
}

for i in $(seq 1 "$MAX"); do
  [ -f STOP ] && { echo "STOP file found; stopping."; rm -f STOP; break; }
  if [ "$MODE" = build ]; then
    python3 scripts/next.py >/dev/null; rc=$?
    [ $rc -eq 3 ] && { echo "All features done."; break; }
    [ $rc -eq 4 ] && { echo "Everything left is blocked: see docs/QUESTIONS.md"; break; }
    [ $rc -eq 5 ] && { python3 scripts/feature.py gate; echo "Milestone gate: try the app, then: python3 scripts/feature.py gate <M> --pass"; break; }
  fi
  before=$(git rev-parse HEAD 2>/dev/null || echo none)
  done_before=$(python3 -c 'import sys;sys.path.insert(0,"scripts");import lib_features as l;print(l.counts(l.load())["done"])')
  session "$PROMPT" "$MODE-$i"
  after=$(git rev-parse HEAD 2>/dev/null || echo none)
  done_after=$(python3 -c 'import sys;sys.path.insert(0,"scripts");import lib_features as l;print(l.counts(l.load())["done"])')
  python3 scripts/feature.py summary
  if [ "$before" = "$after" ]; then idle=$((idle+1)); else idle=0; fi
  [ $idle -ge 3 ] && { echo "Three sessions without a commit; stopping. Read the last logs in .loop/logs."; break; }
  done_since_garden=$((done_since_garden + done_after - done_before))
  if [ "$MODE" = build ] && [ $done_since_garden -ge 6 ]; then
    session PROMPT.garden.md "garden"; done_since_garden=0
  fi
done
