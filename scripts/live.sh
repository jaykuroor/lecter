#!/usr/bin/env bash
# Run ONE live-provider command with Jay's keys, for a live spike or the AI eval only.
#   scripts/live.sh F-0NN -- <command...>
# The keys never enter the agent session: this script reads ~/.config/lecter-dev/keys.env
# (or $LECTER_KEYS_FILE) and exports it only to the child command, with LECTER_LIVE_TESTS=1.
# Refuses unless F-0NN is in progress and declares needs: ["live-keys"] in docs/features.json.
# Rate limits for the child (Gemini free tier by default; override in keys.env):
#   LECTER_LIVE_RPM (requests/min, default 8), LECTER_LIVE_RPD (requests/day, default 200),
#   LECTER_LIVE_TPM (tokens/min, default 200000). Live scripts must honour them, back off on 429
#   with retry-after and jitter, and save partial results when the daily cap is reached.
set -euo pipefail
cd "$(dirname "$0")/.."
fid="${1:-}"; shift || true
[ "${1:-}" = "--" ] && shift
[ -n "$fid" ] && [ $# -gt 0 ] || { echo "usage: scripts/live.sh F-0NN -- <command...>"; exit 2; }
PY=$(command -v python3 || command -v python)
"$PY" - "$fid" <<'PYC' || exit 2
import json, sys
f = {x["id"]: x for x in json.load(open("docs/features.json"))["features"]}.get(sys.argv[1])
if not f:
    sys.exit(f"live.sh: unknown feature {sys.argv[1]}")
if "live-keys" not in f.get("needs", []):
    sys.exit(f"live.sh: {f['id']} is not a live feature (no needs: live-keys). Use the fake provider.")
if f["status"] != "in_progress":
    sys.exit(f"live.sh: {f['id']} is {f['status']}, not in_progress.")
PYC
keys="${LECTER_KEYS_FILE:-$HOME/.config/lecter-dev/keys.env}"
[ -r "$keys" ] || { echo "live.sh: $keys not found. Jay creates it (lecter-build-guide.md section 5)."; exit 3; }
mkdir -p .verify
echo "$(date -u +%FT%TZ) $fid $1" >> .verify/live-runs.log   # what ran live, never the keys
exec env LECTER_LIVE_TESTS=1 LECTER_LIVE_RPM="${LECTER_LIVE_RPM:-8}" LECTER_LIVE_RPD="${LECTER_LIVE_RPD:-200}" \
  LECTER_LIVE_TPM="${LECTER_LIVE_TPM:-200000}" bash -c 'set -a; . "$0"; set +a; exec "$@"' "$keys" "$@"
