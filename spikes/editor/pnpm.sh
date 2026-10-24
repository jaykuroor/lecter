#!/usr/bin/env bash
# Run pnpm in this spike with the same environment scripts/init.sh sets up (sandbox proxy, writable
# runtime dir for the store lock, home store). Usage: spikes/editor/pnpm.sh install | run measure | exec …
set -euo pipefail
cd "$(dirname "$0")"
if [ -n "${HTTPS_PROXY:-}" ]; then
  export npm_config_https_proxy="$HTTPS_PROXY" npm_config_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" npm_config_noproxy="${NO_PROXY:-}"
fi
if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ ! -w "$XDG_RUNTIME_DIR" ]; then export XDG_RUNTIME_DIR="${TMPDIR:-/tmp}"; fi
case "$(pnpm store path 2>/dev/null)" in
  "$(git rev-parse --show-toplevel)"/*) export pnpm_config_store_dir="${XDG_DATA_HOME:-$HOME/.local/share}/pnpm/store" ;;
esac
exec pnpm "$@"
