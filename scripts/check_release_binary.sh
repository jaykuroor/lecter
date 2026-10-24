#!/usr/bin/env bash
# Release-binary check (docs/spec/01-architecture.md#debug-only-test-hooks, CI job release-check).
#   scripts/check_release_binary.sh <path to release binary>
# Fails if the binary contains the embedded WebDriver server, the test hooks or devtools.
set -uo pipefail
BIN="${1:?path to the release binary}"
[ -f "$BIN" ] || { echo "no such file: $BIN"; exit 2; }
python3 - "$BIN" <<'PY'
import sys
data = open(sys.argv[1], "rb").read()
markers = [b"tauri-plugin-wdio-webdriver", b"tauri_plugin_wdio_webdriver", b"LECTER_TEST_PICK", b"LECTER_TEST_TRUST",
           b"LECTER_TEST_HOME", b"lecter-harness", b"__TAURI_DEVTOOLS__", b"tauri::devtools"]
found = [m.decode() for m in markers if m in data or m.decode().encode("utf-16-le") in data]
for m in found:
    print(f"release binary contains {m}: test-only code leaked into release")
print("RELEASE-CHECK OK" if not found else "RELEASE-CHECK FAILED")
sys.exit(1 if found else 0)
PY
