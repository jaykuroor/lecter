#!/usr/bin/env bash
# Collects one CI run's IME results (F-027) into .evidence/F-027/.
#   spikes/ime/fetch.sh <run-id>
# Saves the e2e-app jobs' logs (all OSes the run had) as .evidence/F-027/e2e-app.log, then prints
# the per-webview tally from spikes/ime/summary.py and saves it as summary.txt next to it.
# Start the run with `gh workflow run ci.yml --ref <branch>` (workflow_dispatch adds macOS and
# Windows to the e2e-app matrix); the run must have finished.
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN="${1:?usage: spikes/ime/fetch.sh <run-id>}"
[[ "$RUN" =~ ^[0-9]+$ ]] || { echo "run ids are numbers: $RUN"; exit 2; }
# gh caches under XDG_CACHE_HOME, which is read-only in the Claude sandbox.
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${TMPDIR:-/tmp}/cache}"
OUT=.evidence/F-027
mkdir -p "$OUT"
# `gh run view --log` prefixes every line with "<job>\t<step>\t"; keep the e2e-app jobs.
gh run view "$RUN" --log | grep -a '^e2e-app' > "$OUT/e2e-app.log" || true
[ -s "$OUT/e2e-app.log" ] || { echo "run $RUN has no e2e-app job log (still running, or the job was skipped)"; exit 1; }
echo "CI run $RUN ($(wc -l < "$OUT/e2e-app.log") e2e-app log lines)" > "$OUT/summary.txt"
set +e
python3 spikes/ime/summary.py "$OUT/e2e-app.log" >> "$OUT/summary.txt"
STATUS=$?
set -e
cat "$OUT/summary.txt"
exit "$STATUS"
