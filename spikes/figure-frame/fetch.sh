#!/usr/bin/env bash
# Collects one CI run's figure-frame results (F-028) into .evidence/F-028/.
#   spikes/figure-frame/fetch.sh <run-id> [summary.txt | artifacts-dir ...]
# Start the run with `gh workflow run ci.yml --ref <branch>` (workflow_dispatch adds macOS and
# Windows to the e2e-app matrix); it must have finished.
#
# Where the flow's `FRAME ...` lines are: verify.sh keeps e2e-app's output in .verify/e2e-app/, and
# CI uploads .verify/ after every shard, passing or not, as the artifact e2e-app-<os>-<shard>
# (D-154; runs before that uploaded only failing jobs, whose lines a job summary file can supply:
# copy the run page's "F-028 figure-frame checks" block into a text file and pass it). A directory
# argument holds artifacts already downloaded (`gh run download <run-id> -p 'e2e-app-*' -D <dir>`).
# This script joins the artifacts' logs, the e2e-app job logs and those files into
# .evidence/F-028/e2e-app.log (after any local lines already there), then prints the per-webview
# tally from spikes/figure-frame/summary.py and saves it as summary.txt.
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN="${1:?usage: spikes/figure-frame/fetch.sh <run-id> [summary.txt | artifacts-dir ...]}"
shift
[[ "$RUN" =~ ^[0-9]+$ ]] || { echo "run ids are numbers: $RUN"; exit 2; }
for extra in "$@"; do [ -e "$extra" ] || { echo "no such file or folder: $extra"; exit 2; }; done
# gh caches under XDG_CACHE_HOME, which is read-only in the Claude sandbox.
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-${TMPDIR:-/tmp}/cache}"
OUT=.evidence/F-028
TMP=$(mktemp -d "${TMPDIR:-/tmp}/frame-fetch.XXXXXX")
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
LOG="$OUT/e2e-app.log"
echo "== CI run $RUN: e2e-app artifacts, job logs and job summaries" >> "$LOG"

# Artifacts (failed jobs only). The wdio output is .verify/e2e-app/e2e-app.log inside each.
gh run download "$RUN" -p 'e2e-app-*' -D "$TMP/art" >/dev/null 2>&1 || true
DIRS=("$TMP"/art/e2e-app-*)
for extra in "$@"; do [ -d "$extra" ] && DIRS+=("$extra"/e2e-app-*); done
for dir in "${DIRS[@]}"; do
  [ -d "$dir" ] || continue
  f="$dir/e2e-app/e2e-app.log"; [ -f "$f" ] || f="$dir/e2e-app.log"
  # Only the shard that ran the figure-frame flow has its lines.
  [ -f "$f" ] && grep -q "FRAME " "$f" || continue
  { echo "== artifact $(basename "$dir")"; cat "$f"; } >> "$LOG"
  # The app's own lines about the filter (armed; on WebView2 each refused URL), from its log.
  a="$dir/e2e-app/app.log"; [ -f "$a" ] || a="$dir/app.log"
  [ -f "$a" ] && { echo "== app log $(basename "$dir"): figure filter lines"; grep -a "figure filter" "$a" || echo "(none)"; } >> "$LOG"
done
# Job logs ("<job>\t<step>\t<line>"): the verify summary, and the failure tail.
{ echo "== job logs"; gh run view "$RUN" --log 2>/dev/null | grep -a '^e2e-app' || true; } >> "$LOG"
for extra in "$@"; do [ -f "$extra" ] && { echo "== job summary $extra"; cat "$extra"; } >> "$LOG"; done

{
  echo "CI run $RUN"
  gh run view "$RUN" --json jobs -q '.jobs[] | select(.name | startswith("e2e-app")) | "  job \(.name): \(.conclusion)"' 2>/dev/null || true
} > "$OUT/summary.txt"
set +e
python3 spikes/figure-frame/summary.py "$LOG" >> "$OUT/summary.txt"
STATUS=$?
set -e
cat "$OUT/summary.txt"
echo "(runs before D-154 uploaded failing jobs only: pass a passing job's summary block as a file)"
exit "$STATUS"
