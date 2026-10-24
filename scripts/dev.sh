#!/usr/bin/env bash
# Runs Lecter in dev mode: Vite serves the UI with hot reload, and the debug Tauri shell opens one
# window on it (app/tauri.conf.json build.devUrl). Edits under ui/src reload in the window; edits
# under app/ or crates/ need a restart. Ctrl-C stops both.
#   scripts/dev.sh
# PORT must match devUrl and devCsp in app/tauri.conf.json (app/tests/config.rs checks it).
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=5173

if [ ! -d ui/node_modules ]; then
  echo "dev.sh: ui/node_modules is missing; run scripts/init.sh first" >&2
  exit 1
fi

pnpm -C ui exec vite --host 127.0.0.1 --port "$PORT" --strictPort &
VITE=$!
trap 'kill "$VITE" 2>/dev/null || true' EXIT INT TERM

# Wait until Vite accepts connections (at most 30 s), so the window never opens on an error page.
for _ in $(seq 1 150); do
  if ! kill -0 "$VITE" 2>/dev/null; then
    echo "dev.sh: Vite exited (is port $PORT already in use?)" >&2
    exit 1
  fi
  if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then break; fi
  sleep 0.2
done

cargo run -p lecter-app
