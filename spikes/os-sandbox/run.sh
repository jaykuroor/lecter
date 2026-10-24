#!/usr/bin/env bash
# F-005: run the sandbox tests on this OS and print each probe's result (control and sandboxed).
# Usage: spikes/os-sandbox/run.sh            (from the repo root; Linux, macOS or Windows Git Bash)
set -euo pipefail
cd "$(dirname "$0")/../.."
echo "os: $(uname -srm)"
cargo nextest run -p lecter-spike-os-sandbox --locked --no-capture 2>&1 |
  grep -E '^(unsandboxed|sandboxed) |PASS|FAIL|Summary' || true
